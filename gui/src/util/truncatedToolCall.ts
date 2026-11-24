import type { ToolCallState } from "core";

/**
 * The model's output limit can end a stream in the middle of a tool call, which
 * leaves arguments that are not valid JSON. Nothing ran, so say that plainly
 * and tell the model to work in smaller pieces instead of repeating it.
 */
export function truncatedArgsMessage(
  tcState: ToolCallState,
): string | undefined {
  const raw = tcState.toolCall.function.arguments;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    JSON.parse(raw);
    return undefined;
  } catch {
    return (
      `${tcState.toolCall.function.name} was cut off before its arguments were complete ` +
      `(the output limit was probably reached), so nothing was changed. ` +
      `Do not repeat the same call. Split the work: for a new file, create it with a short first part ` +
      `and add the rest in later edits; for an edit, change one small section at a time.`
    );
  }
}
