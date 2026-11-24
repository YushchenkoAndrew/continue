import { ToolImpl } from ".";
import { RangeInFile, ToolExtras } from "../..";
import { retrieveContextItemsFromEmbeddings } from "../../context/retrieval/retrieval";
import { buildOutline, findSymbolEntries } from "./outlineCore";
import { resolvePosition } from "../languageIntel/position";
import { memoryPaths } from "../memory/memoryStore";
import {
  getProjectIndex,
  ProjectIndex,
  toFileUri,
  toRelative,
} from "../projectIndex/projectIndex";
import { readBudgetChars } from "./readBudget";

const DOC_FILES =
  /^(README|CONTRIBUTING|ARCHITECTURE|CLAUDE|AGENTS|CONVENTIONS)(\.[a-z]+)?$|^docs\/[^/]+\.md$/i;
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "add",
  "fix",
  "make",
  "use",
  "new",
  "when",
  "should",
  "need",
  "please",
  "update",
  "change",
  "implement",
  "function",
  "class",
  "file",
  "code",
]);

/** Identifier-like and path-like tokens mentioned in the task text. */
export function extractTaskTerms(task: string): {
  paths: string[];
  identifiers: string[];
} {
  const paths = [...task.matchAll(/[\w@./-]+\.[a-z]{1,5}\b/gi)]
    .map((m) => m[0])
    .filter(
      (p) =>
        p.includes("/") ||
        /\.(ts|tsx|js|jsx|py|go|rs|java|kt|rb|php|cs|json|md|ya?ml)$/i.test(p),
    );
  const ids = new Set<string>();
  for (const m of task.matchAll(/`([^`\s]{2,60})`/g)) ids.add(m[1]);
  for (const m of task.matchAll(
    /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[a-z]+(?:[A-Z][a-z0-9]*)+|[a-z0-9]+(?:_[a-z0-9]+)+)\b/g,
  ))
    ids.add(m[1]);
  return {
    paths: [...new Set(paths)],
    identifiers: [...ids]
      .filter((i) => !STOP.has(i.toLowerCase()))
      .slice(0, 12),
  };
}

function snippet(text: string, lines = 3): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("#"),
    )
    .slice(0, lines)
    .map((l) => (l.length > 100 ? l.slice(0, 100) + "…" : l))
    .join(" ⏎ ");
}

async function semantic(
  task: string,
  extras: ToolExtras,
): Promise<{ path: string; range: string; why: string; snip: string }[]> {
  try {
    const items = await retrieveContextItemsFromEmbeddings(
      {
        config: extras.config,
        fullInput: task,
        embeddingsProvider: extras.config.selectedModelByRole.embed,
        reranker: extras.config.selectedModelByRole.rerank,
        llm: extras.llm,
        ide: extras.ide,
        selectedCode: [] as RangeInFile[],
        fetch: extras.fetch,
        isInAgentMode: true,
      },
      undefined,
      undefined,
    );
    return items.slice(0, 6).map((it) => ({
      path: it.description,
      range: it.name.match(/\(([\d-]+)\)/)?.[1] ?? "",
      why: "semantic match for the task",
      snip: snippet(it.content),
    }));
  } catch {
    return [];
  }
}

async function conventions(
  index: ProjectIndex,
  extras: ToolExtras,
): Promise<string[]> {
  const rows: string[] = [];
  try {
    const mem = memoryPaths(index.rootUri).project;
    if (await extras.ide.fileExists(mem)) {
      const text = await extras.ide.readFile(mem);
      const lines = text
        .split("\n")
        .filter((l) => /^\s*-\s+\[verified\]/.test(l))
        .slice(0, 8);
      if (lines.length)
        rows.push(
          `Project memory (verified, ${lines.length} shown; full: get_project_memory):`,
          ...lines.map((l) => `  ${l.trim()}`),
        );
    }
  } catch {
    /* ignore */
  }
  const docs = index.files.filter((f) => DOC_FILES.test(f)).slice(0, 6);
  if (docs.length) rows.push(`Docs to consult if needed: ${docs.join(", ")}`);
  const rules = index.files
    .filter((f) => f.startsWith(".continue/rules/"))
    .slice(0, 5);
  if (rules.length)
    rows.push(`Rules: ${rules.join(", ")} (already applied by the system)`);
  return rows;
}

export const prepareContextImpl: ToolImpl = async (args, extras) => {
  const task = String(args?.task ?? "").trim();
  if (!task) throw new Error("`task` is required.");
  const index = await getProjectIndex(extras.ide);
  const out: string[] = [];

  const given = (
    Array.isArray(args?.files) ? args.files : args?.files ? [args.files] : []
  ).map((f: unknown) => toRelative(index, String(f)));
  const terms = extractTaskTerms(task);
  const explicitSymbols: string[] = (
    Array.isArray(args?.symbols)
      ? args.symbols
      : args?.symbols
        ? [args.symbols]
        : []
  ).map(String);
  const identifiers = [...new Set([...explicitSymbols, ...terms.identifiers])];

  // 1. files: explicit + mentioned in task + semantic
  const mentioned = terms.paths
    .map((p) => toRelative(index, p))
    .map((p) => index.files.find((f) => f === p || f.endsWith("/" + p)))
    .filter((f): f is string => !!f);
  const focus = [...new Set([...given, ...mentioned])]
    .filter((f) => index.files.includes(f))
    .slice(0, 4);
  const hits = await semantic(task, extras);

  out.push("Relevant files:");
  const seen = new Set<string>();
  for (const f of focus) {
    seen.add(f);
    out.push(`  ${f}  — ${given.includes(f) ? "given" : "named in task"}`);
  }
  for (const h of hits) {
    const key = `${h.path}${h.range}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      `  ${h.path}${h.range ? `:${h.range}` : ""}  — ${h.why}: ${h.snip}`,
    );
  }
  if (out.length === 1)
    out.push("  (none found; try codebase or grep_search with specific terms)");

  // 2. per-file outline + dependencies
  const deps: string[] = [];
  const symbolRows: string[] = [];
  for (const f of focus) {
    let content = "";
    try {
      content = await extras.ide.readFile(toFileUri(index, f));
    } catch {
      continue;
    }
    const outline = buildOutline(content, f);
    const top = outline
      .filter((e) => e.depth === 0)
      .slice(0, 12)
      .map((e) => `${e.kind} ${e.name} ${e.declLine}-${e.endLine}`);
    if (top.length) symbolRows.push(`  ${f}: ${top.join("; ")}`);
    const imps = (index.importsOf.get(f) ?? [])
      .slice(0, 6)
      .map((e) => `${e.to}:${e.line}`);
    const by = index.importedBy.get(f) ?? [];
    deps.push(
      `  ${f}: imports ${imps.join(", ") || "none in project"}; imported by ${by.length}${
        by.length
          ? ` (${by
              .slice(0, 5)
              .map((e) => e.from)
              .join(", ")}${by.length > 5 ? ", …" : ""})`
          : ""
      }`,
    );

    // 3. named symbols located in this file (verified by outline; references via provider)
    for (const id of identifiers) {
      const entry = findSymbolEntries(outline, id).find(
        (e) => e.name === id.split(/[.#:]/).pop(),
      );
      if (!entry) continue;
      let refs = "";
      if (extras.ide.languageQuery) {
        try {
          const pos = resolvePosition(content, f, {
            symbol: entry.name,
            line: entry.declLine,
          });
          const res = await extras.ide.languageQuery({
            kind: "references",
            filepath: toFileUri(index, f),
            line: pos.line,
            character: pos.character,
          });
          if (res.supported && res.locations) {
            const files = new Set(
              res.locations.map((l) => toRelative(index, l.filepath)),
            );
            refs = `; ${res.locations.length} references in ${files.size} files (verified)`;
          }
        } catch {
          /* provider optional */
        }
      }
      symbolRows.push(
        `  ${entry.kind} ${entry.name} at ${f}:${entry.declLine}-${entry.endLine}${refs}`,
      );
    }
  }
  if (symbolRows.length) out.push("Symbols:", ...symbolRows.slice(0, 20));
  if (deps.length) out.push("Dependencies (verified from imports):", ...deps);

  // 4. tests that likely cover the focus files (name based; run only if the user asks)
  const tests = focus.flatMap((f) => {
    const base = (f.split("/").pop() ?? f).replace(/\.[^.]+$/, "");
    return index.files
      .filter(
        (t) =>
          /(\.|_)(test|spec)\.|(^|\/)(tests?|__tests__)\//i.test(t) &&
          (t.split("/").pop() ?? "").includes(base),
      )
      .slice(0, 2);
  });
  if (tests.length)
    out.push(
      `Related tests (name match, not run): ${[...new Set(tests)].join(", ")}`,
    );

  const conv = await conventions(index, extras);
  if (conv.length)
    out.push(
      "Conventions:",
      ...conv.map((c) => (c.startsWith("  ") ? c : `  ${c}`)),
    );

  out.push("Next: read_symbol/read_file only for the parts you will change.");

  let text = out.join("\n");
  const max = Math.floor(
    readBudgetChars(extras.config.selectedModelByRole.chat?.contextLength) *
      0.8,
  );
  if (text.length > max) text = text.slice(0, max) + "\n…[truncated]";
  return [
    { name: "Prepared context", description: "Task context", content: text },
  ];
};
