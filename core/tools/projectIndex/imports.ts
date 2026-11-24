/** Static import extraction + resolution to workspace files. Only resolved edges are reported. */

export interface RawImport {
  spec: string;
  line: number; // 1-based
}

const JS_EXT = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "vue", "svelte"];

export const SOURCE_EXTENSIONS = new Set([
  ...JS_EXT,
  "py", "go", "rs", "rb", "java", "kt", "cs", "c", "h", "cc", "cpp", "hpp", "php", "swift", "scala", "dart",
]);

function ext(path: string): string {
  const base = path.split("/").pop() ?? path;
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i + 1).toLowerCase();
}

export function extractImports(content: string, path: string): RawImport[] {
  const e = ext(path);
  const out: RawImport[] = [];
  const lines = content.split(/\r?\n/);
  const push = (spec: string | undefined, i: number) => {
    if (spec) out.push({ spec, line: i + 1 });
  };

  if (JS_EXT.includes(e)) {
    const re =
      /(?:^|[;\s])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g;
    // multi-line `import {\n a,\n} from "x"` is handled by scanning the whole text
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const spec = m[1] ?? m[2] ?? m[3];
      const lead = m[0].length - m[0].replace(/^[;\s]+/, "").length; // leading separator is not part of the statement
      const line = content.slice(0, m.index + lead).split("\n").length;
      push(spec, line - 1);
    }
    return out;
  }
  lines.forEach((l, i) => {
    const t = l.trim();
    let m: RegExpMatchArray | null;
    switch (e) {
      case "py":
        if ((m = t.match(/^from\s+(\.*[\w.]*)\s+import\s+(.+)/))) {
          const base = m[1];
          if (/^\.+$/.test(base)) {
            // `from . import a, b` -> each name may be a sibling module
            for (const name of m[2].split(",")) {
              const n = name.trim().split(/\s+as\s+/)[0].replace(/[()]/g, "");
              if (/^\w+$/.test(n)) push(base + n, i);
            }
          } else push(base, i);
        } else if ((m = t.match(/^import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/))) {
          for (const mod of m[1].split(",")) push(mod.trim().split(/\s+as\s+/)[0], i);
        }
        break;
      case "go":
        if ((m = t.match(/^(?:import\s+)?(?:\w+\s+)?"([^"]+)"$/)) && !t.startsWith("//")) push(m[1], i);
        break;
      case "rs":
        if ((m = t.match(/^(?:pub\s+)?mod\s+(\w+)\s*;/))) push(`mod:${m[1]}`, i);
        else if ((m = t.match(/^(?:pub\s+)?use\s+((?:crate|super|self)(?:::\w+)+)/))) push(`use:${m[1]}`, i);
        break;
      case "rb":
        if ((m = t.match(/^require_relative\s+["']([^"']+)["']/))) push(`./${m[1]}`, i);
        break;
      case "java":
      case "kt":
      case "scala":
        if ((m = t.match(/^import\s+(?:static\s+)?([\w.]+)/))) push(m[1], i);
        break;
      case "cs":
        break;
      case "c":
      case "h":
      case "cc":
      case "cpp":
      case "hpp":
        if ((m = t.match(/^#\s*include\s+"([^"]+)"/))) push(`./${m[1]}`, i);
        break;
      case "php":
        if ((m = t.match(/^(?:require|include)(?:_once)?\s*\(?\s*["']([^"']+)["']/))) push(m[1], i);
        break;
      case "dart":
        if ((m = t.match(/^(?:import|export)\s+["']([^"']+)["']/))) push(m[1], i);
        break;
    }
  });
  return out;
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function normalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

const JS_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".vue", ".svelte", ".json", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

/**
 * Resolve an import specifier to a workspace-relative file, or undefined for
 * external/unresolvable imports (never guessed).
 */
export function resolveImport(
  spec: string,
  fromPath: string,
  files: Set<string>,
  ctx: { goModule?: string; byBase?: Map<string, string[]>; byDir?: Map<string, string[]> },
): string | undefined {
  const e = ext(fromPath);
  const dir = dirname(fromPath);
  const tryList = (base: string, suffixes: string[]) => {
    for (const s of suffixes) if (files.has(base + s)) return base + s;
    return undefined;
  };

  if (JS_EXT.includes(e) || e === "dart" || e === "php" || e === "rb" || ["c", "h", "cc", "cpp", "hpp"].includes(e)) {
    if (!spec.startsWith(".") && !spec.startsWith("/")) {
      // bare specifiers: try workspace-root and src-relative (tsconfig baseUrl style), else external
      if (JS_EXT.includes(e)) {
        for (const root of ["", "src/"]) {
          const hit = tryList(normalize(root + spec), JS_CANDIDATES);
          if (hit) return hit;
        }
      }
      return undefined;
    }
    const base = normalize(`${dir}/${spec}`);
    // TS ESM style: "./x.js" may refer to x.ts
    const stripped = base.replace(/\.(m?js|cjs)$/, "");
    return (
      tryList(base, e === "rb" ? ["", ".rb"] : e === "php" ? [""] : JS_CANDIDATES) ??
      (stripped !== base ? tryList(stripped, JS_CANDIDATES) : undefined)
    );
  }

  if (e === "py") {
    const dots = spec.match(/^\.+/)?.[0].length ?? 0;
    const rest = spec.slice(dots).replace(/\./g, "/");
    let baseDir = dir;
    for (let i = 1; i < dots; i++) baseDir = dirname(baseDir);
    const candidates = dots > 0 ? [baseDir] : ["", "src", dir];
    for (const root of candidates) {
      const base = normalize(`${root}/${rest}`);
      const hit = tryList(base, [".py", "/__init__.py"]);
      if (hit && rest) return hit;
    }
    return undefined;
  }

  if (e === "go") {
    const mod = ctx.goModule;
    if (!mod || !spec.startsWith(mod)) return undefined;
    const sub = spec.slice(mod.length).replace(/^\//, "");
    // a Go import names a package (directory): pick a non-test .go file in it
    const inDir = (ctx.byDir?.get(sub) ?? []).filter(
      (f) => f.endsWith(".go") && !f.endsWith("_test.go"),
    );
    return inDir.sort()[0];
  }

  if (e === "rs") {
    if (spec.startsWith("mod:")) {
      const name = spec.slice(4);
      const siblingDir = fromPath.endsWith("/mod.rs") || fromPath.endsWith("/lib.rs") || fromPath.endsWith("/main.rs") ? dir : `${dir}/${fromPath.split("/").pop()!.replace(/\.rs$/, "")}`;
      return tryList(normalize(`${siblingDir}/${name}`), [".rs", "/mod.rs"]) ?? tryList(normalize(`${dir}/${name}`), [".rs", "/mod.rs"]);
    }
    if (spec.startsWith("use:crate::")) {
      const segs = spec.slice(11).split("::");
      const crateRoot = fromPath.includes("/src/") ? fromPath.slice(0, fromPath.indexOf("/src/") + 4) : "src";
      for (let n = segs.length; n >= 1; n--) {
        const hit = tryList(normalize(`${crateRoot}/${segs.slice(0, n).join("/")}`), [".rs", "/mod.rs"]);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  if (e === "java" || e === "kt" || e === "scala") {
    const path = spec.replace(/\./g, "/");
    // try progressively shorter prefixes (nested classes / wildcard / static members)
    const parts = path.split("/");
    for (let n = parts.length; n >= 2; n--) {
      const tail = parts.slice(0, n).join("/");
      const candidates = ctx.byBase?.get(parts[n - 1]) ?? [];
      for (const f of candidates) {
        if (f.endsWith(`/${tail}.${e}`) || f === `${tail}.${e}`) return f;
      }
    }
  }
  return undefined;
}
