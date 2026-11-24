import type { IDE } from "core";
import { validateSearchAndReplaceFilepath } from "core/edit/searchAndReplace/validateArgs";
import { BuiltInToolNames } from "core/tools/builtIn";
import { formatNumberedLines } from "core/tools/implementations/readBudget";

/**
 * Remembers what the model last read or wrote of each file, so an edit can be
 * refused when the file changed in between (format on save, the user typing).
 * It costs one file read per edit and no model call.
 */

/** Edits that depend on the file still looking the way the model last saw it. */
const GUARDED = new Set<string>([
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
  BuiltInToolNames.ReplaceLines,
  BuiltInToolNames.InsertLines,
]);

/** Tools after which the model knows the file's content. */
const READS = new Set<string>([
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.ReadFileRange,
]);

const MAX_ENTRIES = 300;
/** Inline the fresh content in the refusal only up to this size. */
const INLINE_MAX_LINES = 400;
const INLINE_MAX_CHARS = 24000;

const seen = new Map<string, string>();

/** Same text regardless of line endings or trailing blank space at the end. */
export function fingerprint(text: string): string {
  const t = text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${t.length}:${h.toString(16)}`;
}

function remember(key: string, fp: string) {
  seen.delete(key); // keep insertion order = recency
  seen.set(key, fp);
  while (seen.size > MAX_ENTRIES) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
}

async function resolve(
  ide: IDE,
  filepath: unknown,
): Promise<string | undefined> {
  if (typeof filepath !== "string" || !filepath.trim()) return undefined;
  try {
    return await validateSearchAndReplaceFilepath(filepath, ide);
  } catch {
    return undefined; // missing file etc.: nothing to guard
  }
}

/**
 * Call after a tool finished successfully. Records what the model now knows:
 * for a new file the exact text it wrote (so a later format-on-save counts as a
 * change); otherwise the file's content at this moment.
 */
export async function recordFileKnowledge(
  ide: IDE,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
): Promise<void> {
  try {
    const isCreate = toolName === BuiltInToolNames.CreateNewFile;
    if (!isCreate && !GUARDED.has(toolName) && !READS.has(toolName)) return;
    const uri = await resolve(ide, args?.filepath);
    if (!uri) return;
    const text =
      isCreate && typeof args?.contents === "string"
        ? args.contents
        : await ide.readFile(uri);
    remember(`${sessionId}|${uri}`, fingerprint(text));
  } catch {
    // best effort: never break a tool call over bookkeeping
  }
}

/**
 * Before a guarded edit: if the file differs from what the model last saw,
 * return a message to hand back instead of editing. Small files come with their
 * current content so the model can retry in the next step.
 */
export async function staleFileRefusal(
  ide: IDE,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
): Promise<string | undefined> {
  if (!GUARDED.has(toolName)) return undefined;
  try {
    const uri = await resolve(ide, args?.filepath);
    if (!uri) return undefined;
    const key = `${sessionId}|${uri}`;
    const known = seen.get(key);
    if (known === undefined) return undefined; // never saw it here: nothing to compare

    const current = await ide.readFile(uri);
    if (fingerprint(current) === known) return undefined;

    const name = String(args?.filepath);
    const head =
      `${name} changed since you last read or wrote it (it was probably formatted on save or edited by the user), ` +
      `so this edit was NOT applied, to avoid editing the wrong place.`;
    const lines = current.split("\n");
    if (
      lines.length <= INLINE_MAX_LINES &&
      current.length <= INLINE_MAX_CHARS
    ) {
      remember(key, fingerprint(current)); // the model sees it now
      return (
        `${head} Its current content is below, with line numbers. Redo the edit against this text.\n\n` +
        formatNumberedLines(lines, 1)
      );
    }
    return (
      `${head} Read the part you need first (read_file_range, read_symbol or file_outline), ` +
      `then redo the edit with the current text and line numbers.`
    );
  } catch {
    return undefined;
  }
}

/** For tests and new sessions. */
export function resetFileKnowledge() {
  seen.clear();
}
