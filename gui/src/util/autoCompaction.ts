import { ChatHistoryItem } from "core";
import { renderChatMessage } from "core/util/messageContent";

/** Compact when the prompt uses this share of the usable context, or core already pruned. */
export const COMPACTION_THRESHOLD = 0.7;
/** Number of most recent assistant steps (with their tool results) that stay verbatim. */
export const KEEP_RECENT_ASSISTANT_STEPS = 2;

export const COMPACTION_PROMPT =
  "Write a compact working brief so a coding agent can continue this task after older messages are dropped. " +
  "Use these sections, in order: GOAL, DONE (files changed, with paths), FINDINGS (exact file paths, symbols, line numbers), " +
  "DECISIONS AND CONSTRAINTS (including rules the user stated), NEXT STEPS. " +
  "Be specific and terse (under 350 words). Only state facts present in the transcript; never invent paths or results.";

export function shouldCompact(params: {
  contextPercentage: number | undefined;
  didPrune: boolean;
}): boolean {
  return (
    params.didPrune ||
    (params.contextPercentage !== undefined &&
      params.contextPercentage >= COMPACTION_THRESHOLD)
  );
}

/**
 * Index of the history item that should carry the summary: everything up to and
 * including it is replaced by the summary. Returns undefined when there is not
 * enough older history to be worth summarising.
 */
export function pickCompactionIndex(
  history: ChatHistoryItem[],
  keepSteps = KEEP_RECENT_ASSISTANT_STEPS,
): number | undefined {
  // Start after any previous summary so we only summarise new material.
  const assistantIdx: number[] = [];
  history.forEach((h, i) => {
    if (h.message.role === "assistant") assistantIdx.push(i);
  });
  if (assistantIdx.length <= keepSteps) return undefined;
  const firstKept = assistantIdx[assistantIdx.length - keepSteps];
  const idx = firstKept - 1;
  // Must contain at least a user message and one assistant step to summarise.
  return idx >= 1 ? idx : undefined;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+\n/g, "\n").trim();
  return t.length > max ? `${t.slice(0, max)} …[+${t.length - max} chars]` : t;
}

function lastUserTextBefore(
  history: ChatHistoryItem[],
  endIdx: number,
): string | undefined {
  for (let i = endIdx; i >= 0; i--) {
    const m = history[i].message;
    if (m.role === "user") return renderChatMessage(m);
  }
  return undefined;
}

export function buildTranscript(
  history: ChatHistoryItem[],
  endIdx: number,
  maxChars: number,
): string {
  // Begin after the previous summary, which is passed separately.
  let start = 0;
  for (let i = endIdx; i >= 0; i--) {
    if (history[i].conversationSummary) {
      start = i + 1;
      break;
    }
  }
  const parts: string[] = [];
  for (let i = start; i <= endIdx; i++) {
    const item = history[i];
    const m = item.message;
    if (m.role === "user") {
      parts.push(`USER: ${clip(renderChatMessage(m), 2000)}`);
    } else if (m.role === "assistant") {
      const text = renderChatMessage(m);
      if (text.trim()) parts.push(`ASSISTANT: ${clip(text, 1000)}`);
      for (const tc of item.toolCallStates ?? []) {
        const args = clip(JSON.stringify(tc.parsedArgs ?? {}), 240);
        const out = (tc.output ?? [])
          .map((o) => o.content)
          .join("\n");
        parts.push(
          `TOOL ${tc.toolCall.function.name}(${args}) -> ${tc.status}${out ? `: ${clip(out, 450)}` : ""}`,
        );
      }
    }
  }
  let text = parts.join("\n");
  if (text.length > maxChars) {
    // Keep the head (original goal) and the tail (latest progress).
    const head = Math.floor(maxChars * 0.25);
    text = `${text.slice(0, head)}\n…[middle omitted]…\n${text.slice(text.length - (maxChars - head))}`;
  }
  return text;
}

export function buildCompactionPrompt(
  history: ChatHistoryItem[],
  endIdx: number,
  contextLength: number,
): string {
  const maxChars = Math.max(6000, Math.floor(contextLength * 3.2 * 0.5));
  let previous = "";
  for (let i = endIdx; i >= 0; i--) {
    const s = history[i].conversationSummary;
    if (s) {
      previous = s;
      break;
    }
  }
  return [
    COMPACTION_PROMPT,
    previous ? `\nPREVIOUS BRIEF (merge, drop outdated details):\n${clip(previous, 4000)}` : "",
    `\nTRANSCRIPT:\n${buildTranscript(history, endIdx, maxChars)}`,
  ].join("\n");
}

/**
 * The latest user request is re-attached verbatim: a summariser can distort it,
 * and it is the single most important thing to preserve.
 */
export function finalizeSummary(
  briefing: string,
  history: ChatHistoryItem[],
  endIdx: number,
): string {
  const lastUser = lastUserTextBefore(history, endIdx);
  const body = briefing.trim();
  return lastUser
    ? `${body}\n\nLATEST USER REQUEST (verbatim):\n${clip(lastUser, 3000)}`
    : body;
}
