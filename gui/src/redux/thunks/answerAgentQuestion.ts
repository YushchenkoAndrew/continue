import { createAsyncThunk } from "@reduxjs/toolkit";
import { formatAnswers, normalizeQuestions } from "core/tools/askUser";
import { acceptToolCall, updateToolCallOutput } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { findToolCallById } from "../util";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

/** Completes a pending ask_user tool call with the user's answers and resumes the same task. */
export const answerAgentQuestion = createAsyncThunk<
  void,
  { toolCallId: string; answers: string[] },
  ThunkApiType
>(
  "chat/answerAgentQuestion",
  async ({ toolCallId, answers }, { dispatch, getState }) => {
    const toolCallState = findToolCallById(
      getState().session.history,
      toolCallId,
    );
    if (!toolCallState || toolCallState.status !== "calling") {
      return;
    }
    const questions = normalizeQuestions(toolCallState.parsedArgs?.questions);
    dispatch(
      updateToolCallOutput({
        toolCallId,
        contextItems: [
          {
            name: "Your answers",
            description: "Answers to the agent's questions",
            content: formatAnswers(questions, answers),
            hidden: true,
          },
        ],
      }),
    );
    dispatch(acceptToolCall({ toolCallId }));
    await dispatch(streamResponseAfterToolCall({ toolCallId, depth: 1 }));
  },
);
