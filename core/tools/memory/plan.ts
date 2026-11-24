/**
 * Plan checklist helpers shared by core (persistence), the compaction step and the chat UI.
 * Pure string logic with no Node imports, so the GUI bundle can use it.
 */

export type StepStatus = "pending" | "in_progress" | "done" | "blocked";

export interface PlanStep {
  text: string;
  status: StepStatus;
  /** Short reason, only for blocked steps. */
  note?: string;
}

export const MAX_PLAN_STEPS = 20;
export const MAX_STEP_CHARS = 240;
export const MAX_NOTE_CHARS = 160;

const NOTE_SEP = " :: ";

function splitNote(raw: string): { text: string; note?: string } {
  const at = raw.indexOf(NOTE_SEP);
  if (at < 0) return { text: raw };
  const note = raw.slice(at + NOTE_SEP.length).trim();
  return { text: raw.slice(0, at).trim(), note: note || undefined };
}

function withNote(step: PlanStep): string {
  // the separator must stay unambiguous, so it is not allowed inside the text itself
  const text = step.text.split(NOTE_SEP).join(" : ");
  return step.status === "blocked" && step.note
    ? `${text}${NOTE_SEP}${step.note}`
    : text;
}

const MARK: Record<StepStatus, string> = {
  pending: " ",
  in_progress: "~",
  done: "x",
  blocked: "!",
};
const FROM_MARK: Record<string, StepStatus> = {
  " ": "pending",
  "~": "in_progress",
  x: "done",
  "!": "blocked",
};

export function normalizeStatus(value: unknown): StepStatus | undefined {
  const v = String(value ?? "")
    .toLowerCase()
    .replace(/[\s-]/g, "_");
  if (v === "pending" || v === "todo") return "pending";
  if (v === "in_progress" || v === "active" || v === "doing")
    return "in_progress";
  if (v === "done" || v === "complete" || v === "completed") return "done";
  if (v === "blocked") return "blocked";
  return undefined;
}

/** `[x] text` entries as stored in .continue/memory/task.md */
export function stepToLine(step: PlanStep): string {
  return `[${MARK[step.status]}] ${withNote(step)}`;
}

export function lineToStep(line: string): PlanStep | undefined {
  const m = line.match(/^\[([ ~x!])\]\s+(.+)$/);
  return m ? { status: FROM_MARK[m[1]], ...splitNote(m[2]) } : undefined;
}

export function planProgress(steps: PlanStep[]): {
  done: number;
  total: number;
} {
  return {
    done: steps.filter((s) => s.status === "done").length,
    total: steps.length,
  };
}

/** Compact checklist the model and the UI both read. */
export function renderChecklist(steps: PlanStep[]): string {
  const { done, total } = planProgress(steps);
  return [
    `Progress: ${done}/${total}`,
    ...steps.map((s, i) => `[${MARK[s.status]}] ${i + 1}. ${withNote(s)}`),
  ].join("\n");
}

/** Inverse of renderChecklist, tolerant of extra lines after the list. */
export function parseChecklist(
  text: string,
): { steps: PlanStep[]; done: number; total: number } | undefined {
  const steps: PlanStep[] = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\[([ ~x!])\]\s+\d+\.\s+(.+)$/);
    if (m) steps.push({ status: FROM_MARK[m[1]], ...splitNote(m[2]) });
  }
  if (steps.length === 0) return undefined;
  const { done, total } = planProgress(steps);
  return { steps, done, total };
}

/**
 * The newest plan in a chat history (from update_plan tool results), for carrying it through
 * compaction without asking the model to remember it.
 */
export function latestPlanFromHistory(
  history: {
    toolCallStates?: {
      toolCall: { function: { name: string } };
      output?: { content: string }[];
    }[];
  }[],
): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const states = history[i].toolCallStates ?? [];
    for (let j = states.length - 1; j >= 0; j--) {
      const st = states[j];
      if (st.toolCall.function.name !== "update_plan") continue;
      const content = st.output?.[0]?.content;
      const parsed = content ? parseChecklist(content) : undefined;
      if (parsed) return renderChecklist(parsed.steps);
    }
  }
  return undefined;
}
