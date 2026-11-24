import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { buildOutline, findSymbolEntries } from "../implementations/outlineCore";

export interface PositionArgs {
  symbol?: string;
  line?: number; // 1-based
  column?: number; // 1-based
}

export interface ResolvedPosition {
  line: number; // 0-based
  character: number; // 0-based
}

function wordIndex(text: string, word: string, from = 0): number {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "g");
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? m.index : -1;
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? parseInt(v, 10) : (v as number);
  return Number.isFinite(n) ? Math.trunc(n as number) : undefined;
}

/**
 * Turn model-friendly arguments (symbol name and/or 1-based line/column) into a
 * 0-based provider position. A symbol name plus a line is the most reliable form.
 */
export function resolvePosition(
  content: string,
  filepath: string,
  args: PositionArgs,
): ResolvedPosition {
  const lines = content.split(/\r?\n/);
  const line = num(args.line);
  const column = num(args.column);
  const symbol = typeof args.symbol === "string" ? args.symbol.trim() : "";
  const leaf = symbol.split(/[.#:]+/).filter(Boolean).pop() ?? "";

  if (line !== undefined && (line < 1 || line > lines.length)) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      `line ${line} is outside the file (${lines.length} lines).`,
    );
  }

  if (line !== undefined && column !== undefined) {
    return { line: line - 1, character: Math.max(0, column - 1) };
  }

  if (line !== undefined && leaf) {
    // Look on the given line first, then a few lines around it.
    for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
      const i = line - 1 + delta;
      if (i < 0 || i >= lines.length) continue;
      const idx = wordIndex(lines[i], leaf);
      if (idx !== -1) return { line: i, character: idx };
    }
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Symbol "${leaf}" not found near line ${line}. Line ${line} is: ${lines[line - 1].trim().slice(0, 120)}`,
    );
  }

  if (leaf) {
    const entries = findSymbolEntries(buildOutline(content, filepath), symbol);
    const decl = entries[0];
    if (decl) {
      const i = decl.declLine - 1;
      const idx = wordIndex(lines[i], leaf);
      if (idx !== -1) return { line: i, character: idx };
    }
    for (let i = 0; i < lines.length; i++) {
      const idx = wordIndex(lines[i], leaf);
      if (idx !== -1) return { line: i, character: idx };
    }
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Symbol "${leaf}" not found in the file.`,
    );
  }

  throw new ContinueError(
    ContinueErrorReason.Unspecified,
    "Provide `symbol` (with `line` if the name appears several times), or both `line` and `column`.",
  );
}
