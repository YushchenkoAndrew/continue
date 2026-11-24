import { ApplyToFilePayload } from "core";
import { v4 as uuid } from "uuid";

export interface PendingFileApply {
  filepath: string;
  text: string;
  label: string; // human readable summary line, e.g. "src/a.ts (lines 10-14)"
}

interface Queue {
  files: PendingFileApply[];
  index: number;
  done: string[];
}

const queues = new Map<string, Queue>();
const finished = new Map<string, string[]>();

export function toPayload(
  toolCallId: string,
  file: PendingFileApply,
): ApplyToFilePayload & { toolCallId: string } {
  return {
    streamId: uuid(),
    toolCallId,
    filepath: file.filepath,
    text: file.text,
    isSearchAndReplace: true,
  };
}

/** Register a multi-file apply; returns the payload for the first file. */
export function startMultiFileApply(
  toolCallId: string,
  files: PendingFileApply[],
) {
  queues.set(toolCallId, { files, index: 0, done: [] });
  finished.delete(toolCallId);
  return toPayload(toolCallId, files[0]);
}

/**
 * Called when one file's diff was accepted. Returns the payload for the next
 * file, or undefined when the whole tool call is complete.
 */
export function nextMultiFileApply(toolCallId: string) {
  const q = queues.get(toolCallId);
  if (!q) return undefined;
  q.done.push(q.files[q.index].label);
  q.index++;
  if (q.index >= q.files.length) {
    queues.delete(toolCallId);
    finished.set(toolCallId, q.done);
    return undefined;
  }
  return toPayload(toolCallId, q.files[q.index]);
}

export function abortMultiFileApply(toolCallId: string) {
  const q = queues.get(toolCallId);
  queues.delete(toolCallId);
  if (q && q.done.length > 0) finished.set(toolCallId, q.done);
}

export function takeMultiFileSummary(toolCallId: string): string[] | undefined {
  const s = finished.get(toolCallId);
  finished.delete(toolCallId);
  return s;
}
