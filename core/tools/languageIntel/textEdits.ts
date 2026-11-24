import type { LanguageQueryTextEdit } from "../..";

function offsetAt(lineStarts: number[], text: string, line: number, ch: number) {
  if (line >= lineStarts.length) return text.length;
  const start = lineStarts[line];
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
  return Math.min(start + ch, end);
}

/** Apply provider edits (0-based line/character ranges) to file contents. */
export function applyTextEdits(
  content: string,
  edits: LanguageQueryTextEdit[],
): string {
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") lineStarts.push(i + 1);
  }
  const resolved = edits
    .map((e) => ({
      start: offsetAt(lineStarts, content, e.line, e.character),
      end: offsetAt(lineStarts, content, e.endLine, e.endCharacter),
      text: e.newText,
    }))
    .sort((a, b) => b.start - a.start); // apply back to front
  let out = content;
  for (const e of resolved) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
