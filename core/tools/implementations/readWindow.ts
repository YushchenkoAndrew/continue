import { ContextItem, ToolExtras } from "../..";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { resolveInputPath } from "../../util/pathResolver";
import { getUriPathBasename } from "../../util/uri";
import {
  buildContinuationNote,
  formatNumberedLines,
  readBudgetChars,
  splitLines,
  takeLineWindow,
} from "./readBudget";

/**
 * Shared implementation for read_file / read_file_range: returns a numbered,
 * budget-bounded window of the file. Never fails because a file is "too large".
 */
export async function readWindowedFile(
  filepath: string,
  extras: ToolExtras,
  startLine = 1,
  endLine?: number,
): Promise<ContextItem[]> {
  if (startLine < 1 || (endLine !== undefined && endLine < startLine)) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      `Invalid range: startLine=${startLine}${endLine !== undefined ? `, endLine=${endLine}` : ""}. Lines are 1-based and endLine must be >= startLine.`,
    );
  }

  const resolved = await resolveInputPath(extras.ide, filepath);
  if (!resolved) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File "${filepath}" does not exist or is not accessible. Check the path and try again.`,
    );
  }
  throwIfFileIsSecurityConcern(resolved.displayPath);

  const content = await extras.ide.readFile(resolved.uri);
  const lines = splitLines(content);
  const total = lines.length;

  const contextLength = extras.config.selectedModelByRole.chat?.contextLength;
  const window = takeLineWindow(
    lines,
    startLine,
    readBudgetChars(contextLength),
    endLine,
  );
  const note = buildContinuationNote({
    displayPath: resolved.displayPath,
    window,
    totalLines: total,
    requestedEnd: endLine,
  });

  const body =
    window.lines.length > 0
      ? formatNumberedLines(window.lines, window.startLine)
      : "";

  return [
    {
      name: getUriPathBasename(resolved.uri),
      description: `${resolved.displayPath} (lines ${window.startLine}-${window.endLine})`,
      content: body ? `${body}\n${note}` : note,
      uri: { type: "file", value: resolved.uri },
    },
  ];
}
