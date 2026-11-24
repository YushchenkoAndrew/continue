import { ToolImpl } from ".";
import { ToolExtras } from "../..";
import { readBudgetChars } from "./readBudget";
import {
  getProjectIndex,
  ProjectIndex,
  toFileUri,
  toRelative,
} from "../projectIndex/projectIndex";

const ENTRY_NAMES =
  /(^|\/)(main|index|app|server|cli|__main__|manage|program|lib)\.(ts|tsx|js|mjs|py|go|rs|java|kt|cs|rb|php|dart)$|(^|\/)cmd\/[^/]+\/main\.go$|(^|\/)src\/main\/.*Application\.(java|kt)$/;
const CONFIG_FILES =
  /(^|\/)(tsconfig[^/]*\.json|\.eslintrc[^/]*|eslint\.config\.[^/]+|\.prettierrc[^/]*|Dockerfile|docker-compose[^/]*\.ya?ml|\.github\/workflows\/[^/]+|vite\.config\.[^/]+|webpack\.config\.[^/]+|jest\.config\.[^/]+|vitest\.config\.[^/]+|nest-cli\.json|\.env\.example|openapi\.[^/]+|schema\.prisma)$/;

function topDir(path: string, scope: string): string {
  const rest = scope ? path.slice(scope.length + 1) : path;
  const i = rest.indexOf("/");
  return i === -1 ? "." : rest.slice(0, i);
}

async function describeManifest(
  rel: string,
  index: ProjectIndex,
  extras: ToolExtras,
): Promise<string> {
  let text = "";
  try {
    text = await extras.ide.readFile(toFileUri(index, rel));
  } catch {
    return rel;
  }
  const base = rel.split("/").pop()!;
  try {
    if (base === "package.json") {
      const j = JSON.parse(text);
      const scripts = Object.keys(j.scripts ?? {})
        .slice(0, 10)
        .join(", ");
      const deps = Object.keys({ ...j.dependencies }).length;
      const dev = Object.keys({ ...j.devDependencies }).length;
      const entry = [
        j.main,
        j.module,
        typeof j.bin === "string" ? j.bin : Object.values(j.bin ?? {})[0],
      ].filter(Boolean)[0];
      return `${rel}: ${j.name ?? "(unnamed)"}${entry ? `, entry ${entry}` : ""}; ${deps} deps, ${dev} dev; scripts: ${scripts || "none"}`;
    }
    if (base === "go.mod")
      return `${rel}: module ${text.match(/^module\s+(\S+)/m)?.[1] ?? "?"}, go ${text.match(/^go\s+(\S+)/m)?.[1] ?? "?"}`;
    if (base === "Cargo.toml" || base === "pyproject.toml") {
      return `${rel}: ${text.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "(no name)"}`;
    }
  } catch {
    /* fall through to bare path */
  }
  return rel;
}

export const projectMapImpl: ToolImpl = async (args, extras) => {
  const index = await getProjectIndex(extras.ide);
  const scope = args?.path
    ? toRelative(index, String(args.path)).replace(/\/$/, "")
    : "";
  const inScope = (p: string) =>
    !scope || p === scope || p.startsWith(scope + "/");
  const files = index.files.filter(inScope);
  const sources = index.sourceFiles.filter(inScope);
  if (files.length === 0) {
    return [
      {
        name: "Project map",
        description: "Project map",
        content: `No files found under "${scope}".`,
      },
    ];
  }

  // 1. Directories (one level below scope)
  const dirs = new Map<string, Map<string, number>>();
  for (const f of files) {
    const d = topDir(f, scope);
    const e = f.includes(".") ? (f.split(".").pop() ?? "").toLowerCase() : "";
    const m = dirs.get(d) ?? dirs.set(d, new Map()).get(d)!;
    m.set(e, (m.get(e) ?? 0) + 1);
  }
  const dirLines = [...dirs.entries()]
    .sort(
      (a, b) =>
        [...b[1].values()].reduce((x, y) => x + y, 0) -
        [...a[1].values()].reduce((x, y) => x + y, 0),
    )
    .slice(0, 20)
    .map(([d, exts]) => {
      const total = [...exts.values()].reduce((x, y) => x + y, 0);
      const top = [...exts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([e, n]) => `${e || "no-ext"} ${n}`)
        .join(", ");
      return `${d === "." ? "(root files)" : d + "/"}  ${total} files (${top})`;
    });

  // 2. Manifests (bounded reads)
  const manifests = index.manifests
    .filter(inScope)
    .sort((a, b) => a.split("/").length - b.split("/").length)
    .slice(0, 8);
  const manifestLines = await Promise.all(
    manifests.map((m) => describeManifest(m, index, extras)),
  );

  // 3. Entry points + config
  const entries = sources
    .filter((f) => ENTRY_NAMES.test(f))
    .sort((a, b) => a.split("/").length - b.split("/").length)
    .slice(0, 10);
  const configs = files.filter((f) => CONFIG_FILES.test(f)).slice(0, 10);

  // 4. Hubs (most imported files) and module-level relationships
  const hubs = sources
    .map((f) => ({ f, n: index.importedBy.get(f)?.length ?? 0 }))
    .filter((x) => x.n > 1)
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
    .map((x) => `${x.f}  (imported by ${x.n})`);

  const rel = new Map<string, number>();
  for (const f of sources) {
    const from = topDir(f, scope);
    for (const e of index.importsOf.get(f) ?? []) {
      if (!inScope(e.to)) continue;
      const to = topDir(e.to, scope);
      if (to !== from)
        rel.set(`${from} → ${to}`, (rel.get(`${from} → ${to}`) ?? 0) + 1);
    }
  }
  const relLines = [...rel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, n]) => `${k}  (${n} imports)`);

  const section = (title: string, rows: string[]) =>
    rows.length ? `${title}\n${rows.map((r) => `  ${r}`).join("\n")}\n` : "";
  let text =
    `Project map${scope ? ` of ${scope}/` : ""}: ${files.length} files, ${sources.length} source files${index.truncated ? " (graph limited to the shallowest 4000 source files)" : ""}\n` +
    section("Directories:", dirLines) +
    section("Manifests:", manifestLines) +
    section("Entry points (by name/convention):", entries) +
    section("Config:", configs) +
    section("Most imported files (verified from import statements):", hubs) +
    section("Module relationships (import counts):", relLines) +
    (scope
      ? ""
      : "Zoom in with path=<dir>. Details: file_outline, dependency_graph, prepare_context.");

  const max = readBudgetChars(
    extras.config.selectedModelByRole.chat?.contextLength,
  );
  if (text.length > max)
    text = text.slice(0, max) + "\n…[truncated; pass path=<dir> to zoom]";
  return [
    { name: "Project map", description: "Project overview", content: text },
  ];
};
