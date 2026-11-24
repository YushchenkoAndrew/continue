import { DiffLine } from "core";

export function getFirstChangedLine(
  diff: DiffLine[],
  startLine: number,
): number | null {
  for (let i = 0; i < diff.length; i++) {
    const item = diff[i];
    if (item.type === "old" || item.type === "new") {
      return startLine + i;
    }
  }
  return null;
}

export interface SpanEdit {
  /** index (in the diff, and in the pre-edit text) of the first changed line */
  firstLine: number;
  /** how many pre-edit lines the changed span currently occupies */
  oldLineCount: number;
  /** replacement text: old lines blanked (decoration placeholders), new/same lines kept */
  text: string;
}

/**
 * Smallest contiguous replacement that turns the original text into the diff-annotated text.
 * Lines outside the span are "same" and already correct in the document, so rewriting them (as a
 * whole-range replace does) only makes the editor re-tokenize and re-sync the entire file.
 * Returns undefined when there is nothing to replace or the span is a pure insertion.
 */
export function planSpanEdit(diffs: DiffLine[]): SpanEdit | undefined {
  let first = -1;
  let last = -1;
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i].type !== "same") {
      if (first < 0) {
        first = i;
      }
      last = i;
    }
  }
  if (first < 0) {
    return undefined;
  }

  let oldLineCount = 0;
  const lines: string[] = [];
  for (let i = first; i <= last; i++) {
    const d = diffs[i];
    if (d.type !== "new") {
      oldLineCount++;
    }
    lines.push(d.type === "old" ? "" : d.line);
  }
  if (oldLineCount === 0) {
    return undefined;
  }
  return { firstLine: first, oldLineCount, text: lines.join("\n") };
}
