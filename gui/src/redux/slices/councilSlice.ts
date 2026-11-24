import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type {
  CouncilAgentRole,
  CouncilAgentStatus,
  CouncilEvent,
  CouncilPhase,
  CouncilResult,
  Proposal,
  ProposalScore,
  Review,
} from "../../council/types";

export interface CouncilAgentState {
  id: string;
  name: string;
  role: CouncilAgentRole;
  model?: string;
  status: CouncilAgentStatus;
  detail?: string;
  /** Latest streamed size, so the UI can tell thinking from output. */
  chars: number;
  kind?: "content" | "thinking";
  startedAt?: number;
  endedAt?: number;
}

export interface CouncilRunState {
  /** Id of the user message this run belongs to. */
  turnKey: string;
  startedAt: number;
  phase: CouncilPhase;
  running: boolean;
  agents: CouncilAgentState[];
  contextChars?: number;
  proposals: Proposal[];
  reviews: Review[];
  scores: ProposalScore[];
  result?: CouncilResult;
}

export interface CouncilState {
  /** User toggle: run the council before agent turns. Off by default. */
  enabled: boolean;
  run?: CouncilRunState;
}

export const INITIAL_COUNCIL_STATE: CouncilState = { enabled: false };

const TERMINAL: CouncilAgentStatus[] = ["completed", "failed", "cancelled"];

export const councilSlice = createSlice({
  name: "council",
  initialState: INITIAL_COUNCIL_STATE,
  reducers: {
    setCouncilEnabled: (state, { payload }: PayloadAction<boolean>) => {
      state.enabled = payload;
    },
    startCouncilRun: (
      state,
      { payload }: PayloadAction<{ turnKey: string }>,
    ) => {
      state.run = {
        turnKey: payload.turnKey,
        startedAt: Date.now(),
        phase: "context",
        running: true,
        agents: [],
        proposals: [],
        reviews: [],
        scores: [],
      };
    },
    clearCouncilRun: (state) => {
      state.run = undefined;
    },
    applyCouncilEvent: (state, { payload: e }: PayloadAction<CouncilEvent>) => {
      const run = state.run;
      if (!run) return;
      switch (e.type) {
        case "start":
          run.agents = e.agents.map((a) => ({
            ...a,
            status: "queued" as const,
            chars: 0,
          }));
          break;
        case "phase":
          run.phase = e.phase;
          break;
        case "agent-status": {
          const a = run.agents.find((x) => x.id === e.agentId);
          if (!a) break;
          a.status = e.status;
          a.detail = e.detail;
          if (e.status === "analyzing") {
            a.startedAt = Date.now();
            a.endedAt = undefined;
            a.chars = 0;
            a.kind = undefined;
          }
          if (TERMINAL.includes(e.status)) a.endedAt = Date.now();
          break;
        }
        case "agent-text": {
          const a = run.agents.find((x) => x.id === e.agentId);
          if (a) {
            a.chars = e.chars;
            a.kind = e.kind;
          }
          break;
        }
        case "context-ready":
          run.contextChars = e.chars;
          break;
        case "proposal":
          run.proposals.push(e.proposal);
          break;
        case "review":
          run.reviews.push(e.review);
          break;
        case "scores":
          run.scores = e.scores;
          break;
        case "result":
          run.result = e.result;
          run.running = false;
          run.proposals = e.result.proposals.length
            ? e.result.proposals
            : run.proposals;
          break;
      }
    },
  },
});

export const {
  setCouncilEnabled,
  startCouncilRun,
  clearCouncilRun,
  applyCouncilEvent,
} = councilSlice.actions;

export default councilSlice.reducer;
