/**
 * Read budget: how much of a file a single read may return, derived from the
 * chat model's context window so one read can never blow up a small context.
 */

const CHARS_PER_TOKEN = 3.2;
const MIN_BUDGET_TOKENS = 1200;
const MAX_BUDGET_TOKENS = 12000;
const BUDGET_FRACTION = 0.18;
const DEFAULT_CONTEXT_LENGTH = 8192;

export function computeReadBudgetTokens(contextLength?: number): number {
  const ctx =
    contextLength && contextLength > 0 ? contextLength : DEFAULT_CONTEXT_LENGTH;
  return Math.round(
    Math.min(
      MAX_BUDGET_TOKENS,
      Math.max(MIN_BUDGET_TOKENS, ctx * BUDGET_FRACTION),
    ),
  );
}

export function budgetTokensToChars(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN);
}

export function readBudgetChars(contextLength?: number): number {
  return budgetTokensToChars(computeReadBudgetTokens(contextLength));
}

export function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  // A trailing newline is not an extra empty line
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export interface LineWindow {
  startLine: number; // 1-based, inclusive
  endLine: number; // 1-based, inclusive
  lines: string[];
  truncated: boolean; // true when more lines remain after endLine
}

/**
 * Take as many whole lines as fit in maxChars starting at startLine (1-based).
 * Always returns at least one line so progress is guaranteed.
 */
export function takeLineWindow(
  allLines: string[],
  startLine: number,
  maxChars: number,
  endLine?: number,
): LineWindow {
  const first = Math.max(1, startLine);
  const last = Math.min(allLines.length, endLine ?? allLines.length);
  const out: string[] = [];
  let used = 0;
  let i = first;
  for (; i <= last; i++) {
    const line = allLines[i - 1];
    const cost = line.length + 8; // newline + "NNNNN| " prefix
    if (out.length > 0 && used + cost > maxChars) break;
    out.push(line.length > 2000 ? line.slice(0, 2000) + " …[line cut]" : line);
    used += cost;
  }
  const end = first + out.length - 1;
  return {
    startLine: first,
    endLine: Math.max(end, first - 1),
    lines: out,
    truncated: end < allLines.length,
  };
}

export function formatNumberedLines(
  lines: string[],
  startLine: number,
): string {
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((l, i) => `${String(startLine + i).padStart(width, " ")}| ${l}`)
    .join("\n");
}

export function buildContinuationNote(params: {
  displayPath: string;
  window: LineWindow;
  totalLines: number;
  requestedEnd?: number;
}): string {
  const { window, totalLines, requestedEnd } = params;
  if (window.lines.length === 0) {
    return `[${params.displayPath} has ${totalLines} lines; nothing in that range]`;
  }
  const limit = requestedEnd ? Math.min(requestedEnd, totalLines) : totalLines;
  if (window.endLine >= limit) {
    return `[lines ${window.startLine}-${window.endLine} of ${totalLines}]`;
  }
  return (
    `[lines ${window.startLine}-${window.endLine} of ${totalLines}; output cut to fit the context budget. ` +
    `Continue with startLine=${window.endLine + 1}, or use file_outline / read_symbol to jump to a specific function.]`
  );
}

/** Remove the "  12| " prefixes added by numbered reads, if the text has them on every line. */
export function stripLineNumberPrefixes(text: string): string {
  const lines = text.split("\n");
  const prefix = /^\s*\d+\| ?/;
  const nonEmpty = lines.filter((l) => l.length > 0);
  if (nonEmpty.length === 0 || !nonEmpty.every((l) => prefix.test(l))) {
    return text;
  }
  return lines.map((l) => l.replace(prefix, "")).join("\n");
}
