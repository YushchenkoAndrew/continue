import { ChatHistoryItem, ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { parseChecklist, PlanStep } from "core/tools/memory/plan";

/**
 * Structured view of the agent's progress, read from state that already exists: the
 * update_plan tool results in the chat history (and the plan carried through a compaction
 * summary). Nothing here calls a model or the IDE.
 */

export interface PlanSnapshot {
  steps: PlanStep[];
  done: number;
  total: number;
  /** The tool result text, used as a cheap change key for selectors. */
  content: string;
  /** All steps done AND no unfinished-work markers were reported. */
  complete: boolean;
}

export function userMessageText(item: ChatHistoryItem | undefined): string {
  const content = item?.message.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
  }
  return "";
}

export function lastUserIndex(history: ChatHistoryItem[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user") {
      return i;
    }
  }
  return -1;
}

export function planFromContent(content: string): PlanSnapshot | undefined {
  const parsed = parseChecklist(content);
  if (!parsed) {
    return undefined;
  }
  const allDone = parsed.done === parsed.total;
  return {
    steps: parsed.steps,
    done: parsed.done,
    total: parsed.total,
    content,
    complete: allDone && !content.includes("Not complete:"),
  };
}

/** Newest plan: an update_plan result, or the checklist inside a compaction summary. */
export function findLatestPlan(
  history: ChatHistoryItem[],
  fromIndex = 0,
): PlanSnapshot | undefined {
  for (let i = history.length - 1; i >= fromIndex; i--) {
    const item = history[i];
    const states = item.toolCallStates ?? [];
    for (let j = states.length - 1; j >= 0; j--) {
      const st = states[j];
      if (
        st.toolCall.function?.name !== BuiltInToolNames.UpdatePlan ||
        st.status !== "done"
      ) {
        continue;
      }
      const content = st.output?.[0]?.content;
      const snap = content ? planFromContent(content) : undefined;
      if (snap) {
        return snap;
      }
    }
    if (item.conversationSummary) {
      const snap = planFromContent(item.conversationSummary);
      if (snap) {
        return snap;
      }
    }
  }
  return undefined;
}

/** Index of the newest successful update_plan call, or -1. */
export function lastPlanUpdateIndex(history: ChatHistoryItem[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (
      (history[i].toolCallStates ?? []).some(
        (st) =>
          st.toolCall.function?.name === BuiltInToolNames.UpdatePlan &&
          st.status === "done",
      )
    ) {
      return i;
    }
  }
  return -1;
}

const NOT_PROGRESS_TOOLS = new Set<string>([
  BuiltInToolNames.UpdatePlan,
  BuiltInToolNames.AskUser,
  BuiltInToolNames.SaveTaskState,
  BuiltInToolNames.UpdateProjectMemory,
  BuiltInToolNames.CreateRuleBlock,
  BuiltInToolNames.RequestRule,
]);

/**
 * A finished tool call that can have changed the project. Read-only built-ins never count;
 * anything not marked read-only (edit tools, terminal, MCP tools) does, so a legitimate change
 * is never rejected.
 */
export function isChangeMade(st: ToolCallState): boolean {
  return (
    st.status === "done" &&
    !NOT_PROGRESS_TOOLS.has(st.toolCall.function?.name ?? "") &&
    !!st.tool &&
    !st.tool.readonly
  );
}

export function countChanges(items: ChatHistoryItem[]): number {
  let n = 0;
  for (const item of items) {
    for (const st of item.toolCallStates ?? []) {
      if (isChangeMade(st)) {
        n++;
      }
    }
  }
  return n;
}

export function countReads(items: ChatHistoryItem[]): number {
  let n = 0;
  for (const item of items) {
    for (const st of item.toolCallStates ?? []) {
      if (
        st.status === "done" &&
        st.tool?.readonly &&
        !NOT_PROGRESS_TOOLS.has(st.toolCall.function?.name ?? "")
      ) {
        n++;
      }
    }
  }
  return n;
}

export function usedTool(items: ChatHistoryItem[], name: string): boolean {
  return items.some((item) =>
    (item.toolCallStates ?? []).some(
      (st) => st.toolCall.function?.name === name,
    ),
  );
}
