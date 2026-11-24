import { createAsyncThunk } from "@reduxjs/toolkit";
import { renderChatMessage } from "core/util/messageContent";
import { councilContextMessage } from "../../council/consolidate";
import { resolveCouncilConfig } from "../../council/defaults";
import { createGuiCouncilRuntime } from "../../council/guiRuntime";
import { runCouncil } from "../../council/orchestrator";
import type { CouncilResult } from "../../council/types";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { selectSelectedChatModel } from "../slices/configSlice";
import { applyCouncilEvent, startCouncilRun } from "../slices/councilSlice";
import type { RootState, ThunkApiType } from "../store";

/** Id of the most recent user message: the turn a council run belongs to. */
export function lastUserMessageId(
  history: RootState["session"]["history"],
): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i].message;
    if (m.role === "user") return (m as { id?: string }).id ?? String(i);
  }
  return undefined;
}

/**
 * System-prompt note for the agent turn, or "" when there is no usable council
 * plan for the current user message. Read on every agent step so the plan
 * survives the tool-call loop, and it expires with the next user message.
 */
export function selectCouncilNote(state: RootState): string {
  const run = state.council.run;
  if (!run || run.running) return "";
  const result = run.result;
  if (result?.outcome !== "selected" || !result.consolidated) return "";
  if (run.turnKey !== lastUserMessageId(state.session.history)) return "";
  return "\n\n" + councilContextMessage(result.consolidated);
}

export const runCouncilThunk = createAsyncThunk<
  CouncilResult,
  { task: string; extraContext?: string; turnKey: string },
  ThunkApiType
>(
  "council/run",
  async ({ task, extraContext, turnKey }, { dispatch, extra, getState }) => {
    const state = getState();
    const selected = selectSelectedChatModel(state);
    const chatModels = state.config.config.modelsByRole.chat ?? [];

    // first pass only to learn which models the agents use
    const preview = resolveCouncilConfig(state.config.config.council);

    // Budget against the smallest window among the models that will actually run.
    const titles = new Set(
      preview.agents.map((a) => a.model ?? selected?.title).filter(Boolean),
    );
    const windows = [...titles]
      .map((t) => chatModels.find((m) => m.title === t)?.contextLength)
      .filter((n): n is number => typeof n === "number" && n > 0);
    const smallest = windows.length
      ? Math.min(...windows)
      : selected?.contextLength;
    const config = resolveCouncilConfig(state.config.config.council, {
      chatContextLength: smallest,
    });

    dispatch(startCouncilRun({ turnKey }));

    const runtime = createGuiCouncilRuntime({
      ideMessenger: extra.ideMessenger,
      emit: (event) => dispatch(applyCouncilEvent(event)),
      defaultTitle: selected?.title ?? "council",
      contextLength: smallest,
      hasContextTool: selectActiveTools(state).some(
        (t) => t.function.name === "prepare_context",
      ),
    });

    try {
      return await runCouncil({
        task,
        extraContext,
        config,
        runtime,
        signal: state.session.streamAborter.signal,
      });
    } finally {
      await runtime.release?.(selected?.title);
    }
  },
);

/** Plain text of a user message, for the council's task statement. */
export function userTaskText(
  message: Parameters<typeof renderChatMessage>[0],
): string {
  return renderChatMessage(message).trim();
}
