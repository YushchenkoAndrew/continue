/**
 * Cheap structural context for the current file.
 *
 * Autocomplete only sends a small window around the cursor. In a large file that window
 * says nothing about *where* the cursor is: which class/function it is inside, what the
 * parameters are, what is imported, what sibling declarations exist. This module recovers
 * that from plain text in microseconds, with no parsing, no I/O and no LLM:
 *
 *   - enclosing scope headers (found by walking up to lines with smaller indentation)
 *   - the file's imports (only those that fell outside the window)
 *   - nearby sibling declarations (only those outside the window)
 *
 * Everything inside the caret window is skipped on purpose; the model already sees it.
 */

const MAX_SCAN_UP = 2000;
const MAX_SCAN_DOWN = 400;
const MAX_IMPORT_SCAN = 150;
const MAX_CHAIN = 6;
const MAX_SIBLINGS_UP = 5;
const MAX_SIBLINGS_DOWN = 3;
const MAX_IMPORTS = 20;
const MAX_LINE = 160;
const MAX_CONTINUATION_LINES = 12;

// Keyword-led declarations. Deliberately simple (no nested quantifiers) so it cannot backtrack badly.
const DECL =
  /^\s*(?:export\s+|default\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|abstract\s+|async\s+|final\s+|override\s+|readonly\s+|pub\s+|pub\([^)]*\)\s+|unsafe\s+|extern\s+|sealed\s+|open\s+|data\s+)*(?:class|interface|enum|struct|trait|impl|object|namespace|module|type|function\*?|def|fn|func|fun|sub|proc)\b/;

const CONTROL =
  /^\s*(?:if|else|for|while|switch|try|catch|finally|do|elif|with|case|default|return|await|throw)\b/;

const IMPORT_START =
  /^\s*(?:import\b|from\s+\S+\s+import\b|export\s+(?:\*|\{)|#include\b|#import\b|using\s+\S+;|use\s+\S+|require\b|(?:const|let|var)\s+\S.*=\s*require\()/;

function indentOf(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 32) n += 1;
    else if (c === 9) n += 4;
    else break;
  }
  return n;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function clip(text: string): string {
  const t = text.replace(/\s+$/, "");
  return t.length > MAX_LINE ? t.slice(0, MAX_LINE) + "…" : t;
}

function opensScope(trimmed: string): boolean {
  return (
    trimmed.endsWith("{") || trimmed.endsWith(":") || trimmed.endsWith("(")
  );
}

/** A line that opens a named scope worth showing (class, function, method, describe block...). */
function isScopeHeader(line: string): boolean {
  const t = line.trim();
  if (t === "") return false;
  if (
    t.startsWith("//") ||
    t.startsWith("*") ||
    t.startsWith("/*") ||
    t.startsWith("#") ||
    t.startsWith("}") ||
    t.startsWith("]") ||
    t.startsWith("@")
  ) {
    return false;
  }
  // End of a multi-line signature: `): Promise<void> {`
  if (t.startsWith(")")) return t.endsWith("{") || t.endsWith(":");
  if (DECL.test(t)) return true;
  if (CONTROL.test(t)) return false;
  return t.endsWith("{") || t.endsWith(":") || t.endsWith("=> {");
}

/** Declaration worth listing as a sibling: has a name and a parameter list or a declaration keyword. */
function isSiblingDeclaration(line: string): boolean {
  if (!isScopeHeader(line)) return false;
  return DECL.test(line.trim()) || line.includes("(");
}

/**
 * Multi-line signatures end on a line like `): Promise<void> {`. Walk up to the line that
 * opened the parameter list and return the joined signature.
 */
function joinSignature(lines: string[], index: number): string {
  const first = lines[index];
  if (!first.trim().startsWith(")")) return clip(first);
  const indent = indentOf(first);
  for (let i = index - 1; i >= 0 && index - i <= MAX_CONTINUATION_LINES; i--) {
    const l = lines[i];
    if (isBlank(l)) continue;
    if (
      indentOf(l) === indent &&
      l.includes("(") &&
      !l.trim().startsWith(")")
    ) {
      const joined = lines
        .slice(i, index + 1)
        .map((x) => x.trim())
        .join(" ");
      return clip(" ".repeat(indent) + joined);
    }
    if (indentOf(l) < indent) break;
  }
  return clip(first);
}

function collectImports(lines: string[], limit: number): string[] {
  const out: string[] = [];
  const end = Math.min(lines.length, limit, MAX_IMPORT_SCAN);
  for (let i = 0; i < end && out.length < MAX_IMPORTS; i++) {
    const line = lines[i];
    if (line.length > 300 || !IMPORT_START.test(line)) continue;

    let statement = line.trim();
    // `import {\n  a,\n  b,\n} from "x"` -> one line
    const opensBlock =
      /[{(]\s*$/.test(statement) && !/\bfrom\b/.test(statement);
    if (opensBlock) {
      let j = i + 1;
      while (j < end && j - i <= MAX_CONTINUATION_LINES) {
        statement += " " + lines[j].trim();
        if (/\bfrom\b|;\s*$|\)\s*$/.test(lines[j])) break;
        j++;
      }
      i = j;
    }
    out.push(clip(statement.replace(/\s+/g, " ")));
  }
  return out;
}

export interface SkeletonInput {
  fullPrefix: string;
  fullSuffix: string;
  /** Number of lines of the prefix that are inside the prompt window (already visible). */
  prunedPrefixLines: number;
  /** Number of lines of the suffix that are inside the prompt window. */
  prunedSuffixLines: number;
  /** Character budget for the whole skeleton. */
  maxChars: number;
}

/** Returns the skeleton text, or undefined when there is nothing useful outside the window. */
export function buildFileSkeleton(input: SkeletonInput): string | undefined {
  const { fullPrefix, fullSuffix, prunedPrefixLines, prunedSuffixLines } =
    input;
  let budget = input.maxChars;
  if (budget < 120) return undefined;

  const prefixLines = fullPrefix.split("\n");
  const cursorLine = prefixLines.length - 1;
  // Lines before this index are outside the visible window.
  const windowStart = Math.max(0, prefixLines.length - prunedPrefixLines);

  // --- enclosing scope chain -------------------------------------------------------------
  let probe = cursorLine;
  let cursorIndent = indentOf(prefixLines[cursorLine]);
  if (isBlank(prefixLines[cursorLine])) {
    // Empty current line: inherit from the nearest previous code line (+1 level when it opens a scope).
    let p = cursorLine - 1;
    while (p >= 0 && isBlank(prefixLines[p])) p--;
    if (p >= 0) {
      const prevTrim = prefixLines[p].trim();
      cursorIndent = indentOf(prefixLines[p]) + (opensScope(prevTrim) ? 1 : 0);
      probe = p + 1;
    }
  }

  const chainIdx: number[] = [];
  let minIndent = cursorIndent;
  const lowest = Math.max(0, probe - MAX_SCAN_UP);
  for (
    let i = probe - 1;
    i >= lowest && chainIdx.length < MAX_CHAIN && minIndent > 0;
    i--
  ) {
    const line = prefixLines[i];
    if (isBlank(line)) continue;
    const ind = indentOf(line);
    if (ind >= minIndent) continue;
    if (isScopeHeader(line)) {
      chainIdx.push(i);
      minIndent = ind;
    }
  }
  chainIdx.reverse(); // outermost first

  const sections: string[] = [];

  // Headers inside the window are already visible; only keep those that scrolled out.
  const hiddenChain = chainIdx.filter((i) => i < windowStart);
  if (hiddenChain.length > 0) {
    const text = hiddenChain
      .map((i) => joinSignature(prefixLines, i))
      .join("\n");
    if (text.length <= budget) {
      sections.push("Enclosing scope:\n" + text);
      budget -= text.length + 17;
    }
  }

  // --- imports (only if the top of the file is outside the window) -----------------------
  if (windowStart > 0 && budget > 80) {
    const imports = collectImports(prefixLines, windowStart);
    const kept: string[] = [];
    let used = 0;
    for (const imp of imports) {
      if (used + imp.length + 1 > budget * 0.6) break;
      kept.push(imp);
      used += imp.length + 1;
    }
    if (kept.length > 0) {
      sections.push("Imports:\n" + kept.join("\n"));
      budget -= used + 9;
    }
  }

  // --- nearby sibling declarations --------------------------------------------------------
  if (budget > 80) {
    const targetIndent =
      chainIdx.length > 0
        ? indentOf(prefixLines[chainIdx[chainIdx.length - 1]])
        : 0;
    const chainSet = new Set(chainIdx);
    const siblings: string[] = [];

    for (
      let i = windowStart - 1, scanned = 0;
      i >= 0 && scanned < MAX_SCAN_UP && siblings.length < MAX_SIBLINGS_UP;
      i--, scanned++
    ) {
      const line = prefixLines[i];
      if (chainSet.has(i) || isBlank(line) || indentOf(line) !== targetIndent)
        continue;
      if (isSiblingDeclaration(line))
        siblings.unshift(joinSignature(prefixLines, i));
    }

    const suffixLines = fullSuffix.split("\n");
    const down: string[] = [];
    const downStart = Math.max(0, prunedSuffixLines);
    for (
      let i = downStart;
      i < suffixLines.length &&
      i - downStart < MAX_SCAN_DOWN &&
      down.length < MAX_SIBLINGS_DOWN;
      i++
    ) {
      const line = suffixLines[i];
      if (isBlank(line) || indentOf(line) !== targetIndent) continue;
      if (isSiblingDeclaration(line)) down.push(clip(line));
    }

    const all = [...siblings, ...down];
    const kept: string[] = [];
    let used = 0;
    for (const sig of all) {
      if (used + sig.length + 1 > budget) break;
      kept.push(sig);
      used += sig.length + 1;
    }
    if (kept.length > 0) {
      sections.push("Nearby declarations:\n" + kept.join("\n"));
    }
  }

  if (sections.length === 0) return undefined;
  return sections.join("\n");
}
