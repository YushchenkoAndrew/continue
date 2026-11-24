/**
 * Pure, dependency-free outline builder used by file_outline and read_symbol.
 * Regex finds declarations; brace/indent scanning finds their extent. Optional
 * tree-sitter symbols (accurate ranges) are merged in by the caller.
 */

export type OutlineKind =
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "function"
  | "method"
  | "const"
  | "struct"
  | "trait"
  | "impl"
  | "module";

export interface OutlineEntry {
  name: string;
  kind: OutlineKind;
  startLine: number; // 1-based, includes leading decorators/comments
  declLine: number; // 1-based line of the declaration itself
  endLine: number; // 1-based, inclusive
  depth: number; // nesting level (0 = top level)
  signature: string; // trimmed declaration line, bounded
}

export interface TreeSymbol {
  name: string;
  startLine: number; // 1-based
  endLine: number; // 1-based
}

const INDENT_LANGS = new Set([
  "py",
  "pyi",
  "rb",
  "nix",
  "yaml",
  "yml",
  "coffee",
]);

const NOT_A_METHOD = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "else",
  "function",
  "constructor_call",
  "super",
  "await",
  "typeof",
  "new",
  "with",
  "do",
  "try",
]);

interface Rule {
  re: RegExp;
  kind: OutlineKind;
  nameGroup: number;
}

const TS_JS_RULES: Rule[] = [
  {
    re: /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    kind: "class",
    nameGroup: 1,
  },
  {
    re: /^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/,
    kind: "interface",
    nameGroup: 1,
  },
  {
    re: /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/,
    kind: "type",
    nameGroup: 1,
  },
  {
    re: /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
    kind: "enum",
    nameGroup: 1,
  },
  {
    re: /^(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$.]*)/,
    kind: "module",
    nameGroup: 1,
  },
  {
    re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    kind: "function",
    nameGroup: 1,
  },
  {
    re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>/,
    kind: "function",
    nameGroup: 1,
  },
  {
    re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?function/,
    kind: "function",
    nameGroup: 1,
  },
  {
    re: /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    kind: "const",
    nameGroup: 1,
  },
];

const TS_METHOD_RULE =
  /^(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\([^;]*$/;

const PY_RULES: Rule[] = [
  { re: /^class\s+([A-Za-z_]\w*)/, kind: "class", nameGroup: 1 },
  { re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function", nameGroup: 1 },
];

const GO_RULES: Rule[] = [
  {
    re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
    kind: "function",
    nameGroup: 1,
  },
  { re: /^type\s+([A-Za-z_]\w*)\s+struct/, kind: "struct", nameGroup: 1 },
  { re: /^type\s+([A-Za-z_]\w*)\s+interface/, kind: "interface", nameGroup: 1 },
  { re: /^type\s+([A-Za-z_]\w*)\b/, kind: "type", nameGroup: 1 },
];

const RUST_RULES: Rule[] = [
  {
    re: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([A-Za-z_]\w*)/,
    kind: "function",
    nameGroup: 1,
  },
  {
    re: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/,
    kind: "struct",
    nameGroup: 1,
  },
  {
    re: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/,
    kind: "enum",
    nameGroup: 1,
  },
  {
    re: /^(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/,
    kind: "trait",
    nameGroup: 1,
  },
  {
    re: /^impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([A-Za-z_][\w:]*)/,
    kind: "impl",
    nameGroup: 1,
  },
  {
    re: /^(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/,
    kind: "module",
    nameGroup: 1,
  },
];

const RUBY_RULES: Rule[] = [
  { re: /^class\s+([A-Z]\w*)/, kind: "class", nameGroup: 1 },
  { re: /^module\s+([A-Z]\w*)/, kind: "module", nameGroup: 1 },
  {
    re: /^def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/,
    kind: "function",
    nameGroup: 1,
  },
];

// C-family (java, kotlin, c#, c, c++, php, swift, scala, dart)
const C_FAMILY_RULES: Rule[] = [
  {
    re: /^(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export)\s+)*(?:class|interface|enum|struct|trait|object|record)\s+([A-Za-z_]\w*)/,
    kind: "class",
    nameGroup: 1,
  },
  {
    re: /^(?:(?:public|private|protected|internal)\s+)?(?:suspend\s+)?(?:fun|func|function)\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?([A-Za-z_]\w*)/,
    kind: "function",
    nameGroup: 1,
  },
];

const C_METHOD_RULE =
  /^(?:(?:public|private|protected|internal|static|final|virtual|override|abstract|synchronized|async|inline|extern|const|unsigned|signed)\s+)*[\w:<>,\[\]*&?\s]+?[\s*&]([A-Za-z_~]\w*)\s*\([^;]*$/;

function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i + 1).toLowerCase();
}

function rulesFor(ext: string): { rules: Rule[]; methodRe?: RegExp } {
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "mts":
    case "cts":
    case "vue":
    case "svelte":
      return { rules: TS_JS_RULES, methodRe: TS_METHOD_RULE };
    case "py":
    case "pyi":
      return { rules: PY_RULES };
    case "go":
      return { rules: GO_RULES };
    case "rs":
      return { rules: RUST_RULES };
    case "rb":
      return { rules: RUBY_RULES };
    case "java":
    case "kt":
    case "kts":
    case "cs":
    case "c":
    case "h":
    case "cc":
    case "cpp":
    case "hpp":
    case "php":
    case "swift":
    case "scala":
    case "dart":
      return { rules: C_FAMILY_RULES, methodRe: C_METHOD_RULE };
    default:
      return {
        rules: [...TS_JS_RULES, ...PY_RULES, ...GO_RULES, ...C_FAMILY_RULES],
      };
  }
}

function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 2;
    else break;
  }
  return n;
}

/** Find the last line of a brace-delimited block starting at `declIdx` (0-based). */
function braceEnd(lines: string[], declIdx: number): number {
  let depth = 0;
  let seenOpen = false;
  let inBlockComment = false;
  const maxScan = Math.min(lines.length, declIdx + 4000);
  for (let i = declIdx; i < maxScan; i++) {
    const line = lines[i];
    let inStr: string | null = null;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const next = line[j + 1];
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          j++;
        }
        continue;
      }
      if (inStr) {
        if (ch === "\\") j++;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "{") {
        depth++;
        seenOpen = true;
      } else if (ch === "}") {
        depth--;
        if (seenOpen && depth <= 0) return i;
      }
    }
    // Declaration without a body (e.g. `type X = string;`, abstract signature)
    if (!seenOpen && i >= declIdx && /;\s*$/.test(line)) return i;
    if (!seenOpen && i - declIdx >= 6) return declIdx;
  }
  return seenOpen ? maxScan - 1 : declIdx;
}

function indentEnd(lines: string[], declIdx: number): number {
  const base = indentOf(lines[declIdx]);
  let last = declIdx;
  for (let i = declIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    if (indentOf(l) <= base) {
      // ruby "end" belongs to the block
      if (/^\s*end\b/.test(l) && indentOf(l) === base) return i;
      break;
    }
    last = i;
  }
  return last;
}

function extendOverLeadingTrivia(lines: string[], declIdx: number): number {
  let start = declIdx;
  for (let i = declIdx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (
      t.startsWith("@") ||
      t.startsWith("//") ||
      t.startsWith("/*") ||
      t.startsWith("*") ||
      t.startsWith("*/") ||
      t.startsWith("#[") ||
      (t.startsWith("#") && !t.startsWith("#!")) ||
      t.startsWith('"""')
    ) {
      start = i;
    } else {
      break;
    }
  }
  return start;
}

export function buildOutline(
  content: string,
  filepath: string,
  treeSymbols: TreeSymbol[] = [],
): OutlineEntry[] {
  const ext = extOf(filepath);
  const lines = content.split(/\r?\n/);
  const { rules, methodRe } = rulesFor(ext);
  const indentBased = INDENT_LANGS.has(ext);

  const raw: OutlineEntry[] = [];
  const blockStack: { endLine: number; isContainer: boolean }[] = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (inBlockComment) {
      if (t.includes("*/")) inBlockComment = false;
      continue;
    }
    if (t.startsWith("/*") && !t.includes("*/")) {
      inBlockComment = true;
      continue;
    }
    if (t === "" || t.startsWith("//") || t.startsWith("*")) continue;
    if (!indentBased && t.startsWith("#") && !t.startsWith("#[")) continue;

    while (
      blockStack.length > 0 &&
      blockStack[blockStack.length - 1].endLine < i + 1
    ) {
      blockStack.pop();
    }
    const depth = blockStack.length;

    let match: { name: string; kind: OutlineKind } | null = null;
    // Top-of-file rules apply at any depth for indent languages, and at depth<=1
    // (namespaces, classes) for brace languages to keep noise low.
    if (indentBased || depth <= 1 || ext === "") {
      for (const rule of rules) {
        const m = t.match(rule.re);
        if (m && m[rule.nameGroup]) {
          match = { name: m[rule.nameGroup], kind: rule.kind };
          break;
        }
      }
    }
    if (
      !match &&
      methodRe &&
      depth >= 1 &&
      /[{]\s*$/.test(t) &&
      !t.endsWith(";")
    ) {
      const m = t.match(methodRe);
      if (m && m[1] && !NOT_A_METHOD.has(m[1])) {
        match = { name: m[1], kind: "method" };
      }
    }
    if (!match) continue;
    if (indentBased && depth >= 1 && match.kind === "function") {
      match.kind = "method";
    }

    const endIdx = indentBased ? indentEnd(lines, i) : braceEnd(lines, i);
    const startIdx = extendOverLeadingTrivia(lines, i);
    const entry: OutlineEntry = {
      name: match.name,
      kind: match.kind,
      startLine: startIdx + 1,
      declLine: i + 1,
      endLine: endIdx + 1,
      depth,
      signature: t.length > 140 ? t.slice(0, 140) + "…" : t,
    };
    raw.push(entry);

    const isContainer =
      match.kind === "class" ||
      match.kind === "interface" ||
      match.kind === "struct" ||
      match.kind === "trait" ||
      match.kind === "impl" ||
      match.kind === "module" ||
      match.kind === "enum";
    if (isContainer && entry.endLine > entry.declLine) {
      blockStack.push({ endLine: entry.endLine, isContainer });
    }
  }

  // Prefer accurate tree-sitter extents where the same symbol is found.
  for (const entry of raw) {
    const hit = treeSymbols.find(
      (s) =>
        s.name === entry.name && Math.abs(s.startLine - entry.declLine) <= 1,
    );
    if (hit && hit.endLine >= entry.declLine) {
      entry.endLine = hit.endLine;
    }
  }
  return raw;
}

export function formatOutline(entries: OutlineEntry[]): string {
  return entries
    .map((e) => {
      const indent = "  ".repeat(Math.min(e.depth, 4));
      return `${indent}${e.declLine}-${e.endLine} ${e.kind} ${e.name}`;
    })
    .join("\n");
}

export interface SymbolMatch {
  entry: OutlineEntry;
  exact: boolean;
}

/**
 * Find entries by name. Supports "Class.method" and "method" queries.
 * Results ordered: exact qualified match, exact name, then case-insensitive/partial.
 */
export function findSymbolEntries(
  entries: OutlineEntry[],
  query: string,
): OutlineEntry[] {
  const q = query.trim();
  if (!q) return [];
  const parts = q.split(/[.#:]+/).filter(Boolean);
  const leaf = parts[parts.length - 1];
  const parent = parts.length > 1 ? parts[parts.length - 2] : undefined;

  const parentOf = (e: OutlineEntry): OutlineEntry | undefined => {
    let best: OutlineEntry | undefined;
    for (const c of entries) {
      if (
        c !== e &&
        c.depth < e.depth &&
        c.declLine <= e.declLine &&
        c.endLine >= e.endLine
      ) {
        if (!best || c.depth > best.depth) best = c;
      }
    }
    return best;
  };

  const exact = entries.filter((e) => e.name === leaf);
  const qualified = parent
    ? exact.filter((e) => parentOf(e)?.name === parent)
    : exact;
  if (qualified.length > 0) return qualified;
  if (exact.length > 0 && !parent) return exact;
  const lower = leaf.toLowerCase();
  return entries.filter((e) => e.name.toLowerCase().includes(lower));
}
