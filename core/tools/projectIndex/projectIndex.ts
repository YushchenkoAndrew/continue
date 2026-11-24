import type { IDE } from "../..";
import { walkDirs } from "../../indexing/walkDir";
import {
  extractImports,
  RawImport,
  resolveImport,
  SOURCE_EXTENSIONS,
} from "./imports";

export interface Edge {
  from: string; // workspace-relative path
  to: string;
  line: number; // line of the import statement in `from`
}

export interface ProjectIndex {
  rootUri: string;
  files: string[];
  sourceFiles: string[];
  manifests: string[];
  importsOf: Map<string, Edge[]>;
  importedBy: Map<string, Edge[]>;
  externals: Map<string, string[]>; // file -> unresolved (external) specifiers
  truncated: boolean;
  builtAt: number;
}

const MAX_SOURCE_FILES = 4000;
const FRESH_MS = 5000;
const GENERATED =
  /(^|\/)(dist|build|out|target|vendor|coverage|\.next|\.nuxt|__pycache__|generated|\.venv|venv)\/|\.min\.(js|css)$|\.d\.ts$|\.pb\.go$|_pb2\.py$|\.generated\./;

export const MANIFEST_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "pubspec.yaml",
  "flake.nix",
  "CMakeLists.txt",
  "Makefile",
  "Package.swift",
]);

interface FileEntry {
  mtime: number;
  imports: RawImport[];
}

interface CacheState {
  perFile: Map<string, FileEntry>;
  fingerprint: string;
  statFingerprint: string;
  index: ProjectIndex;
}

const caches = new Map<string, CacheState>();

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function extOf(p: string): string {
  const b = p.split("/").pop() ?? p;
  const i = b.lastIndexOf(".");
  return i === -1 ? "" : b.slice(i + 1).toLowerCase();
}

function isManifest(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return MANIFEST_NAMES.has(base) || base.endsWith(".csproj");
}

async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export async function getProjectIndex(
  ide: IDE,
  opts: { force?: boolean } = {},
): Promise<ProjectIndex> {
  const dirs = await ide.getWorkspaceDirs();
  const rootUri = dirs[0];
  if (!rootUri) throw new Error("No workspace folder is open.");

  const cached = caches.get(rootUri);
  if (cached && !opts.force && Date.now() - cached.index.builtAt < FRESH_MS) {
    return cached.index;
  }

  const files = (
    await walkDirs(ide, { returnRelativeUrisPaths: true, include: "files" }, [
      rootUri,
    ])
  ).filter((f) => !GENERATED.test(f));
  files.sort();
  const fingerprint = `${files.length}:${hash(files.join("\n"))}`;

  let sourceFiles = files.filter((f) => SOURCE_EXTENSIONS.has(extOf(f)));
  const truncated = sourceFiles.length > MAX_SOURCE_FILES;
  if (truncated) {
    // keep shallow files first: they are the structural ones
    sourceFiles = [...sourceFiles]
      .sort(
        (a, b) =>
          a.split("/").length - b.split("/").length || a.localeCompare(b),
      )
      .slice(0, MAX_SOURCE_FILES)
      .sort();
  }

  const toUri = (rel: string) =>
    `${rootUri.replace(/\/$/, "")}/${rel.split("/").map(encodeURIComponent).join("/")}`;

  // mtimes: only changed files are re-read
  const stats = new Map<string, number>();
  for (let i = 0; i < sourceFiles.length; i += 500) {
    const chunk = sourceFiles.slice(i, i + 500);
    try {
      const res = await ide.getFileStats(chunk.map(toUri));
      chunk.forEach((rel) =>
        stats.set(rel, res[toUri(rel)]?.lastModified ?? 0),
      );
    } catch {
      chunk.forEach((rel) => stats.set(rel, Date.now()));
    }
  }
  const statFingerprint = hash(
    [...stats.entries()].map(([k, v]) => `${k}@${v}`).join("|"),
  );

  if (
    cached &&
    cached.fingerprint === fingerprint &&
    cached.statFingerprint === statFingerprint &&
    !opts.force
  ) {
    cached.index.builtAt = Date.now();
    return cached.index;
  }

  const perFile = cached?.perFile ?? new Map<string, FileEntry>();
  const stale = sourceFiles.filter(
    (f) => perFile.get(f)?.mtime !== stats.get(f),
  );
  await inBatches(stale, 40, async (rel) => {
    try {
      const content = await ide.readFile(toUri(rel));
      perFile.set(rel, {
        mtime: stats.get(rel) ?? 0,
        imports: extractImports(content, rel),
      });
    } catch {
      perFile.set(rel, { mtime: stats.get(rel) ?? 0, imports: [] });
    }
  });
  for (const k of [...perFile.keys()]) if (!stats.has(k)) perFile.delete(k);

  // resolution context
  const fileSet = new Set(files);
  const byBase = new Map<string, string[]>();
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const base = (f.split("/").pop() ?? f).replace(/\.[^.]+$/, "");
    (byBase.get(base) ?? byBase.set(base, []).get(base)!).push(f);
    const d = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
    (byDir.get(d) ?? byDir.set(d, []).get(d)!).push(f);
  }
  let goModule: string | undefined;
  if (fileSet.has("go.mod")) {
    try {
      goModule = (await ide.readFile(toUri("go.mod"))).match(
        /^module\s+(\S+)/m,
      )?.[1];
    } catch {
      /* ignore */
    }
  }

  const importsOf = new Map<string, Edge[]>();
  const importedBy = new Map<string, Edge[]>();
  const externals = new Map<string, string[]>();
  for (const [from, entry] of perFile) {
    const seen = new Set<string>();
    for (const imp of entry.imports) {
      const to = resolveImport(imp.spec, from, fileSet, {
        goModule,
        byBase,
        byDir,
      });
      if (!to) {
        if (
          !imp.spec.startsWith(".") &&
          !imp.spec.startsWith("mod:") &&
          !imp.spec.startsWith("use:")
        ) {
          const list =
            externals.get(from) ?? externals.set(from, []).get(from)!;
          if (!list.includes(imp.spec)) list.push(imp.spec);
        }
        continue;
      }
      if (to === from || seen.has(to)) continue;
      seen.add(to);
      const edge = { from, to, line: imp.line };
      (importsOf.get(from) ?? importsOf.set(from, []).get(from)!).push(edge);
      (importedBy.get(to) ?? importedBy.set(to, []).get(to)!).push(edge);
    }
  }

  const index: ProjectIndex = {
    rootUri,
    files,
    sourceFiles,
    manifests: files.filter(isManifest),
    importsOf,
    importedBy,
    externals,
    truncated,
    builtAt: Date.now(),
  };
  caches.set(rootUri, { perFile, fingerprint, statFingerprint, index });
  return index;
}

export function toFileUri(index: ProjectIndex, rel: string): string {
  return `${index.rootUri.replace(/\/$/, "")}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

/** Convert user/model input (relative, absolute or URI) into a workspace-relative path. */
export function toRelative(index: ProjectIndex, input: string): string {
  let p = input.trim();
  if (p.startsWith("file://")) {
    const root = index.rootUri.replace(/\/$/, "") + "/";
    p = p.startsWith(root) ? decodeURIComponent(p.slice(root.length)) : p;
  }
  return p.replace(/^\.\//, "").replace(/\\/g, "/");
}
