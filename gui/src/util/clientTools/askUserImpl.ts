import {
  MAX_QUESTIONS_PER_TASK,
  normalizeQuestions,
  questionsAskedThisTask,
} from "core/tools/askUser";
import { ClientToolImpl } from "./callClientTool";

/**
 * The question form is rendered from the tool call itself. Nothing is returned here: the tool call
 * stays open until the user answers (see answerAgentQuestion), then the same task continues.
 */
export const askUserImpl: ClientToolImpl = async (args, toolCallId, extras) => {
  const questions = normalizeQuestions(args?.questions);
  if (questions.length === 0) {
    throw new Error("ask_user needs at least one question.");
  }
  const asked = questionsAskedThisTask(
    extras.getState().session.history,
    toolCallId,
  );
  if (asked + questions.length > MAX_QUESTIONS_PER_TASK) {
    throw new Error(
      `Question limit reached (${MAX_QUESTIONS_PER_TASK} per task). Pick a sensible default, state the assumption, and continue.`,
    );
  }
  return { respondImmediately: false, output: undefined };
};
