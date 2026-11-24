import { ChatHistoryItem, ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { PlanStep } from "core/tools/memory/plan";
import {
  findLatestPlan,
  isChangeMade,
  lastUserIndex,
  userMessageText,
} from "./agentPlan";

/**
 * Execution state of the current agent task, derived from what actually happened: finished
 * tool calls, their errors, pending questions and the stream state. It is the authority for the
 * progress display. The model's own plan (update_plan) only supplies the step list; the model
 * cannot make the roadmap show "Review" or "Report" as done by saying so, and a started or
 * failed tool call never counts as finished work.
 *
 * Pure function of the chat history: no model calls, no IDE calls, nothing stored twice.
 */

export type RunStatus =
  "running" | "waiting_input" | "paused" | "failed" | "completed";

export type StepState = "done" | "active" | "pending" | "blocked" | "failed";

export interface RunStep {
  label: string;
  state: StepState;
  /** Blocker explanation, shown for blocked steps. */
  note?: string;
}

export interface AgentRun {
  status: RunStatus;
  steps: RunStep[];
  done: number;
  total: number;
  hasPlan: boolean;
  reads: number;
  changes: number;
  failed: number;
}

const WAITING = new Set<ToolCallState["status"]>([
  "generating",
  "generated",
  "calling",
]);

const PHASE_ANALYZE = "Analyze the request and the code";
const PHASE_PLAN = "Create the implementation plan";
const PHASE_IMPLEMENT = "Implement the changes";
const PHASE_REVIEW = "Review the changes";
const PHASE_REPORT = "Report what was done";

function isReadOnlyProgress(st: ToolCallState): boolean {
  const name = st.toolCall.function?.name;
  return (
    st.status === "done" &&
    !!st.tool?.readonly &&
    name !== BuiltInToolNames.UpdatePlan &&
    name !== BuiltInToolNames.AskUser
  );
}

function stepState(s: PlanStep): StepState {
  switch (s.status) {
    case "done":
      return "done";
    case "in_progress":
      return "active";
    case "blocked":
      return "blocked";
    default:
      return "pending";
  }
}

export function deriveAgentRun(
  history: ChatHistoryItem[],
  isStreaming: boolean,
): AgentRun | undefined {
  const u = lastUserIndex(history);
  if (u < 0) {
    return undefined;
  }
  const turn = history.slice(u + 1);
  const plan = findLatestPlan(history);

  // Walk the turn once, in order.
  let reads = 0;
  let changes = 0;
  let failed = 0;
  let lastChange = -1;
  let readAfterChange = false;
  let asking = false;
  let lastState: ToolCallState | undefined;
  let calls = 0;
  let order = 0;
  for (const item of turn) {
    for (const st of item.toolCallStates ?? []) {
      calls++;
      order++;
      lastState = st;
      if (st.status === "errored") {
        failed++;
      }
      if (
        st.toolCall.function?.name === BuiltInToolNames.AskUser &&
        WAITING.has(st.status)
      ) {
        asking = true;
      }
      if (isChangeMade(st)) {
        changes++;
        lastChange = order;
        readAfterChange = false;
      } else if (isReadOnlyProgress(st)) {
        reads++;
        if (lastChange >= 0) {
          readAfterChange = true;
        }
      }
    }
  }

  const last = history[history.length - 1];
  const finalText =
    !isStreaming &&
    last?.message.role === "assistant" &&
    !!userMessageText(last).trim() &&
    !(last.toolCallStates?.length ?? 0);

  // Nothing to show for a plain chat answer with no tools and no plan.
  if (!plan && calls === 0) {
    return undefined;
  }

  const noFailure = isStreaming || lastState?.status !== "errored";

  const analyzeDone = !!plan || changes > 0 || (!isStreaming && reads > 0);
  const planDone = !!plan;
  // Implementation is finished only by real changes: all plan steps done (and at least one
  // change this turn or an earlier verified completion), or, with no plan, a turn that made
  // changes and ended cleanly.
  const implementDone = plan
    ? plan.done === plan.total && (plan.complete || changes > 0)
    : changes > 0 && !isStreaming && noFailure && !asking;
  // The final answer closes the review when no separate re-read was made.
  const reviewDone = implementDone && (readAfterChange || finalText);
  const reportDone = implementDone && finalText && !asking && noFailure;

  const steps: RunStep[] = [];
  steps.push({ label: PHASE_ANALYZE, state: analyzeDone ? "done" : "active" });
  steps.push({
    label: PHASE_PLAN,
    state: planDone ? "done" : analyzeDone ? "active" : "pending",
  });
  if (plan) {
    for (const s of plan.steps) {
      steps.push({ label: s.text, state: stepState(s), note: s.note });
    }
  } else {
    steps.push({
      label: PHASE_IMPLEMENT,
      state: implementDone ? "done" : changes > 0 ? "active" : "pending",
    });
  }
  steps.push({
    label: PHASE_REVIEW,
    state: reviewDone ? "done" : implementDone ? "active" : "pending",
  });
  steps.push({
    label: PHASE_REPORT,
    state: reportDone ? "done" : reviewDone ? "active" : "pending",
  });

  // Without a plan, only the leading phase that is still open may be active.
  if (!plan) {
    let seenActive = false;
    for (const s of steps) {
      if (s.state === "active") {
        if (seenActive) {
          s.state = "pending";
        }
        seenActive = true;
      }
    }
  } else if (!steps.some((s) => s.state === "active")) {
    // The model has not marked a step in progress: the first open one is the current one.
    const open = steps.find(
      (s) =>
        s.state === "pending" &&
        s.label !== PHASE_REVIEW &&
        s.label !== PHASE_REPORT,
    );
    if (open && isStreaming) {
      open.state = "active";
    }
  }

  let status: RunStatus;
  if (asking) {
    status = "waiting_input";
  } else if (reportDone) {
    status = "completed";
  } else if (isStreaming) {
    status = "running";
  } else if (lastState?.status === "errored") {
    status = "failed";
  } else {
    status = "paused";
  }
  if (status === "failed") {
    const active = steps.find((s) => s.state === "active");
    if (active) {
      active.state = "failed";
    }
  }

  const done = steps.filter((s) => s.state === "done").length;
  return {
    status,
    steps,
    done,
    total: steps.length,
    hasPlan: !!plan,
    reads,
    changes,
    failed,
  };
}
