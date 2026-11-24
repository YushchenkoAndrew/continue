import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { stripLineNumberPrefixes } from "../../tools/implementations/readBudget";

function detectEol(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function splitForEdit(content: string): {
  lines: string[];
  eol: string;
  trailingNewline: boolean;
} {
  const eol = detectEol(content);
  const trailingNewline = content.length > 0 && content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  if (trailingNewline) lines.pop();
  if (content.length === 0) lines.length = 0;
  return { lines, eol, trailingNewline };
}

function textToLines(text: string): string[] {
  const cleaned = stripLineNumberPrefixes(text).replace(/\r\n/g, "\n");
  if (cleaned === "") return [];
  return (cleaned.endsWith("\n") ? cleaned.slice(0, -1) : cleaned).split("\n");
}

function join(
  lines: string[],
  eol: string,
  trailingNewline: boolean,
  wasEmpty: boolean,
): string {
  if (lines.length === 0) return "";
  const body = lines.join(eol);
  return trailingNewline || wasEmpty ? body + eol : body;
}

function requireInt(value: unknown, name: string): number {
  const n = typeof value === "string" ? parseInt(value, 10) : (value as number);
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      `${name} must be an integer line number`,
    );
  }
  return n;
}

/** Replace lines startLine..endLine (1-based, inclusive). Empty newText deletes them. */
export function applyReplaceLines(
  file: string,
  startLine: unknown,
  endLine: unknown,
  newText: string,
): string {
  const start = requireInt(startLine, "startLine");
  const end = requireInt(endLine, "endLine");
  const { lines, eol, trailingNewline } = splitForEdit(file);
  if (start < 1 || end < start) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      `Invalid range ${start}-${end}. Lines are 1-based and endLine must be >= startLine.`,
    );
  }
  if (end > lines.length) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      `Range ${start}-${end} is outside the file (${lines.length} lines). Re-read the file; line numbers may have shifted after an earlier edit.`,
    );
  }
  const next = [
    ...lines.slice(0, start - 1),
    ...textToLines(newText ?? ""),
    ...lines.slice(end),
  ];
  return join(next, eol, trailingNewline, false);
}

/** Insert newText after line `afterLine` (0 = top of file). */
export function applyInsertLines(
  file: string,
  afterLine: unknown,
  newText: string,
): string {
  const after = requireInt(afterLine, "afterLine");
  const { lines, eol, trailingNewline } = splitForEdit(file);
  if (after < 0 || after > lines.length) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      `afterLine ${after} is outside the file (${lines.length} lines). Use 0 to insert at the top. Re-read the file if line numbers may have shifted.`,
    );
  }
  const inserted = textToLines(newText ?? "");
  if (inserted.length === 0) {
    throw new ContinueError(ContinueErrorReason.Unspecified, "newText is empty; nothing to insert.");
  }
  const next = [...lines.slice(0, after), ...inserted, ...lines.slice(after)];
  return join(next, eol, trailingNewline, lines.length === 0);
}

export { stripLineNumberPrefixes };
