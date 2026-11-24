import { ToolImpl } from ".";
import { ToolExtras } from "../..";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { resolveInputPath } from "../../util/pathResolver";
import { getUriPathBasename } from "../../util/uri";
import { getStringArg } from "../parseArgs";
import {
  buildContinuationNote,
  formatNumberedLines,
  readBudgetChars,
  splitLines,
  takeLineWindow,
} from "./readBudget";
import {
  buildOutline,
  findSymbolEntries,
  formatOutline,
  OutlineEntry,
  TreeSymbol,
} from "./outlineCore";

async function loadOutline(filepath: string, extras: ToolExtras) {
  const resolved = await resolveInputPath(extras.ide, filepath);
  if (!resolved) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File "${filepath}" does not exist or is not accessible. Check the path and try again.`,
    );
  }
  throwIfFileIsSecurityConcern(resolved.displayPath);
  const content = await extras.ide.readFile(resolved.uri);

  let treeSymbols: TreeSymbol[] = [];
  try {
    const { getSymbolsForFile } = await import("../../util/treeSitter");
    const symbols = await getSymbolsForFile(resolved.uri, content);
    treeSymbols = (symbols ?? []).map((s) => ({
      name: s.name,
      startLine: s.range.start.line + 1,
      endLine: s.range.end.line,
    }));
  } catch {
    // tree-sitter is optional; regex outline still works
  }
  const entries = buildOutline(content, resolved.displayPath, treeSymbols);
  return { resolved, content, entries };
}

export const fileOutlineImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  const { resolved, content, entries } = await loadOutline(filepath, extras);
  const total = splitLines(content).length;

  let shown: OutlineEntry[] = entries;
  if (query) {
    shown = findSymbolEntries(entries, query);
  }

  const budget = Math.floor(
    readBudgetChars(extras.config.selectedModelByRole.chat?.contextLength) / 2,
  );
  let text = formatOutline(shown);
  let note = "";
  if (text.length > budget) {
    let n = shown.length;
    while (n > 1 && formatOutline(shown.slice(0, n)).length > budget) {
      n = Math.floor(n * 0.8);
    }
    text = formatOutline(shown.slice(0, n));
    note = `\n[${shown.length - n} more entries not shown. Pass query="name" to filter.]`;
  }
  if (shown.length === 0) {
    text =
      entries.length === 0
        ? "(no declarations recognised; use read_file with startLine/endLine)"
        : `(no symbol matching "${query}")`;
  }

  return [
    {
      name: getUriPathBasename(resolved.uri),
      description: `Outline of ${resolved.displayPath}`,
      content: `${resolved.displayPath} (${total} lines). Format: start-end kind name\n${text}${note}`,
      uri: { type: "file", value: resolved.uri },
    },
  ];
};

export const readSymbolImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  const symbol = getStringArg(args, "symbol");
  const { resolved, content, entries } = await loadOutline(filepath, extras);
  const matches = findSymbolEntries(entries, symbol);

  if (matches.length === 0) {
    const names = [...new Set(entries.map((e) => e.name))].slice(0, 25);
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Symbol "${symbol}" not found in ${resolved.displayPath}.` +
        (names.length ? ` Known symbols: ${names.join(", ")}.` : " Use file_outline or read_file."),
    );
  }

  const idx =
    typeof args?.index === "number" && args.index >= 1 && args.index <= matches.length
      ? args.index - 1
      : 0;
  const entry = matches[idx];
  const lines = splitLines(content);
  const window = takeLineWindow(
    lines,
    entry.startLine,
    readBudgetChars(extras.config.selectedModelByRole.chat?.contextLength),
    entry.endLine,
  );
  const note = buildContinuationNote({
    displayPath: resolved.displayPath,
    window,
    totalLines: lines.length,
    requestedEnd: entry.endLine,
  });
  const others =
    matches.length > 1
      ? `\n[${matches.length - 1} other match(es): ${matches
          .filter((_, i) => i !== idx)
          .slice(0, 6)
          .map((m, i) => `#${i + (i >= idx ? 2 : 1)} ${m.kind} ${m.name} @${m.declLine}`)
          .join("; ")}. Pass index to choose.]`
      : "";

  return [
    {
      name: `${entry.name} (${getUriPathBasename(resolved.uri)})`,
      description: `${resolved.displayPath} (lines ${window.startLine}-${window.endLine})`,
      content: `${formatNumberedLines(window.lines, window.startLine)}\n${note}${others}`,
      uri: { type: "file", value: resolved.uri },
    },
  ];
};
