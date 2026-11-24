/** Pure helpers for the ask_user tool; shared by the chat UI and the client tool. */

export const MAX_QUESTIONS_PER_TASK = 6;
const MAX_QUESTIONS_PER_CALL = 3;
const MAX_OPTIONS = 8;

export interface AskedQuestion {
  question: string;
  options: string[];
  multiple: boolean;
}

/** Tolerant of partial / malformed model output: unusable entries are dropped. */
export function normalizeQuestions(raw: unknown): AskedQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: AskedQuestion[] = [];
  for (const item of raw) {
    const question = String(
      (typeof item === "string" ? item : item?.question) ?? "",
    ).trim();
    if (!question) continue;
    const options = Array.isArray(item?.options)
      ? item.options
          .map((o: unknown) => String(o).trim())
          .filter(Boolean)
          .slice(0, MAX_OPTIONS)
      : [];
    out.push({
      question: question.slice(0, 400),
      options,
      multiple: !!item?.multiple && options.length > 0,
    });
    if (out.length >= MAX_QUESTIONS_PER_CALL) break;
  }
  return out;
}

export function formatAnswers(
  questions: AskedQuestion[],
  answers: string[],
): string {
  return questions
    .map(
      (q, i) =>
        `Q${i + 1}: ${q.question}\nA${i + 1}: ${answers[i]?.trim() || "(no answer)"}`,
    )
    .join("\n\n");
}

/** Questions asked since the user's last typed message (one "task"), excluding `exceptToolCallId`. */
export function questionsAskedThisTask(
  history: {
    message: { role: string };
    toolCallStates?: {
      toolCallId: string;
      toolCall: { function: { name: string } };
      parsedArgs?: any;
    }[];
  }[],
  exceptToolCallId?: string,
): number {
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user") {
      lastUser = i;
      break;
    }
  }
  let count = 0;
  for (let i = lastUser + 1; i < history.length; i++) {
    for (const tc of history[i].toolCallStates ?? []) {
      if (
        tc.toolCall.function.name === "ask_user" &&
        tc.toolCallId !== exceptToolCallId
      ) {
        count += normalizeQuestions(tc.parsedArgs?.questions).length;
      }
    }
  }
  return count;
}
