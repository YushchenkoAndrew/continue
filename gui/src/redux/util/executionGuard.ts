import { ChatHistoryItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import {
  countChanges,
  countReads,
  findLatestPlan,
  lastPlanUpdateIndex,
  lastUserIndex,
  usedTool,
  userMessageText,
} from "../../util/agentPlan";

/**
 * Keeps the agent from ending an implementation request with analysis.
 *
 * Everything here is deterministic and reads the existing chat history: no model calls, and
 * the extra prompt text is added only when a rule fires, never to every request.
 */

const IMPLEMENT_VERB =
  /\b(implement|fix|add|update|modify|change|refactor|create|write|build|remove|delete|rename|migrate|replace|set up|integrate|extend|convert|rewrite|apply|patch|make)\b/i;
// Questions and review requests that ask for an answer, not for a change.
const ANALYSIS_LEAD =
  /^\s*(what|why|how\s+(does|do|is|are|can|would|should)|where|which|who|when|explain|describe|summari[sz]e|review|analy[sz]e|list|tell me|show me|is there|are there|does|do you)\b/i;
const CONTINUE_LEAD =
  /^\s*(continue|resume|keep going|go on|finish( it| this)?)\b/i;

const EXPLORE_READS_COMPLEX = 6;
const EXPLORE_READS_SIMPLE = 10;
export const MAX_EXECUTION_NUDGES = 2;

export function isImplementationRequest(text: string): boolean {
  return IMPLEMENT_VERB.test(text) && !ANALYSIS_LEAD.test(text);
}

/** Long or list-shaped requests are worth an explicit plan; short ones are just done. */
export function isComplexRequest(text: string): boolean {
  if (text.length >= 500) {
    return true;
  }
  const listItems = text.match(/^\s*(?:[-*•]|\d+[.)])\s+\S/gm)?.length ?? 0;
  const tableRows = text.match(/^\s*\|.+\|\s*$/gm)?.length ?? 0;
  return listItems >= 3 || tableRows >= 4;
}

interface TurnView {
  request: string;
  implement: boolean;
  complex: boolean;
  turn: ChatHistoryItem[];
  changes: number;
  reads: number;
  askedUser: boolean;
}

function viewTurn(history: ChatHistoryItem[]): TurnView | undefined {
  const u = lastUserIndex(history);
  if (u < 0) {
    return undefined;
  }
  const request = userMessageText(history[u]);
  const turn = history.slice(u + 1);
  const earlierPlan = findLatestPlan(history.slice(0, u + 1));
  const resuming =
    CONTINUE_LEAD.test(request) &&
    !!earlierPlan &&
    earlierPlan.done < earlierPlan.total;
  return {
    request,
    implement: isImplementationRequest(request) || resuming,
    complex: isComplexRequest(request),
    turn,
    changes: countChanges(turn),
    reads: countReads(turn),
    askedUser: usedTool(turn, BuiltInToolNames.AskUser),
  };
}

/**
 * Extra system-prompt text for the next model turn. Empty unless the request is an
 * implementation request that needs a push: a plan for a complex request, or a stop to
 * exploring that is not leading anywhere.
 */
export function executionNotes(history: ChatHistoryItem[]): string {
  const view = viewTurn(history);
  if (!view || !view.implement) {
    return "";
  }
  const planInTurn = findLatestPlan(view.turn);
  if (planInTurn || view.changes > 0) {
    return "";
  }
  const limit = view.complex ? EXPLORE_READS_COMPLEX : EXPLORE_READS_SIMPLE;
  if (view.reads >= limit) {
    return `\n\nYou have read ${view.reads} times without planning or changing anything. Stop exploring: ${
      view.complex
        ? "call update_plan now with the remaining steps, then start step 1"
        : "make the first change now"
    }. Read more only for one specific missing detail.`;
  }
  if (view.complex && view.reads === 0) {
    return "\n\nThis is a multi-part implementation request. Read what you need, then call update_plan before editing, then implement the steps in order.";
  }
  return "";
}

/**
 * Called when a model turn ended without tool calls. Returns a system-prompt note for one
 * more attempt when the turn stopped short of the work, otherwise undefined.
 */
export function executionNudge(
  history: ChatHistoryItem[],
  nudgesUsed: number,
): string | undefined {
  if (nudgesUsed >= MAX_EXECUTION_NUDGES) {
    return undefined;
  }
  const view = viewTurn(history);
  if (!view || view.askedUser) {
    return undefined;
  }

  const plan = findLatestPlan(view.turn);
  if (plan) {
    const blocked = plan.steps.some((s) => s.status === "blocked");
    const next = plan.steps.findIndex(
      (s) => s.status === "pending" || s.status === "in_progress",
    );
    if (!blocked && next >= 0) {
      return `\n\nThe plan still has unfinished steps (next: step ${next + 1}, "${plan.steps[next].text.slice(0, 120)}"). Continue with it now. Stop only if a step is blocked: then mark it blocked with a note via update_plan and say what is needed.`;
    }
    return undefined;
  }

  if (view.implement && view.changes === 0 && nudgesUsed === 0) {
    return "\n\nThe user asked you to implement this and nothing has been changed yet. Exploring is preparation, not the answer: do not say you are ready and do not ask the user to repeat the request. If the work has several steps, call update_plan, then start step 1 now. If the change already exists, say where. If something is truly missing, say exactly what (or use ask_user).";
  }
  return undefined;
}

const EDIT_STEP =
  /^\s*(implement|update|add|create|write|fix|modify|change|refactor|remove|rename|extend|replace|migrate|convert|integrate|build)\b/i;

/**
 * update_plan is rejected when it marks an edit step done although nothing has been changed
 * since the previous plan update: reading a file is not doing the step.
 */
export function unearnedCompletion(
  history: ChatHistoryItem[],
  args: any,
): string | undefined {
  const plan = findLatestPlan(history);
  const sinceUpdate = history.slice(Math.max(lastPlanUpdateIndex(history), 0));
  if (countChanges(sinceUpdate) > 0) {
    return undefined;
  }
  const candidates: { n: number | undefined; text: string }[] = [];
  for (const u of Array.isArray(args?.set) ? args.set : []) {
    const n = Number(u?.step);
    const step = plan?.steps[n - 1];
    if (String(u?.status) === "done" && step && step.status !== "done") {
      candidates.push({ n, text: step.text });
    }
  }
  for (const s of Array.isArray(args?.steps) ? args.steps : []) {
    const text = String(s?.text ?? "");
    const known = plan?.steps.find((p) => p.text === text);
    if (String(s?.status) === "done" && known?.status !== "done") {
      candidates.push({ n: undefined, text });
    }
  }
  const bad = candidates.find((c) => EDIT_STEP.test(c.text));
  return bad
    ? `Not marked done: "${bad.text.slice(0, 80)}" is an edit step but no file has been changed since the last plan update. Make the change first, or mark the step blocked with a note.`
    : undefined;
}
