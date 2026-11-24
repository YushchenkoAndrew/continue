import { createAsyncThunk } from "@reduxjs/toolkit";
import {
  buildCompactionPrompt,
  finalizeSummary,
  pickCompactionIndex,
} from "../../util/autoCompaction";
import {
  setCompactionLoading,
  updateHistoryItemAtIndex,
} from "../slices/sessionSlice";
import { selectSelectedChatModel } from "../slices/configSlice";
import { ThunkApiType } from "../store";

// One compaction per history length: prevents compaction loops when the kept
// steps themselves are already large.
const compactedAt = new Map<string, number>();

/** Returns true when a summary was attached and the caller should rebuild the prompt. */
export const autoCompact = createAsyncThunk<boolean, void, ThunkApiType>(
  "chat/autoCompact",
  async (_, { dispatch, getState, extra }) => {
    const state = getState();
    const model = selectSelectedChatModel(state);
    const history = state.session.history;
    const sessionId = state.session.id;
    if (!model) return false;
    if (compactedAt.get(sessionId) === history.length) return false;

    const idx = pickCompactionIndex(history);
    if (idx === undefined) return false;
    compactedAt.set(sessionId, history.length);

    dispatch(setCompactionLoading({ index: idx, loading: true }));
    try {
      const prompt = buildCompactionPrompt(
        history,
        idx,
        model.contextLength ?? 8192,
      );
      const res = await extra.ideMessenger.request("llm/complete", {
        prompt,
        title: model.title,
        completionOptions: { temperature: 0.2, maxTokens: 900 },
      });
      if (res.status !== "success" || !res.content?.trim()) return false;
      dispatch(
        updateHistoryItemAtIndex({
          index: idx,
          updates: {
            conversationSummary: finalizeSummary(res.content, history, idx),
          },
        }),
      );
      return true;
    } catch (e) {
      console.warn("Auto-compaction failed", e);
      return false;
    } finally {
      dispatch(setCompactionLoading({ index: idx, loading: false }));
    }
  },
);
