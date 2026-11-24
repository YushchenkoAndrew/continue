import type { CouncilAgentRole } from "core";

export type { CouncilAgentRole };

/** Scoring criteria; weights come from config (defaults in defaults.ts). */
export const CRITERIA = [
  "correctness",
  "requirements",
  "maintainability",
  "performance",
  "security",
  "simplicity",
] as const;
export type Criterion = (typeof CRITERIA)[number];
export type CriterionWeights = Record<Criterion, number>;

export interface CouncilAgent {
  id: string;
  name: string;
  role: CouncilAgentRole;
  /** Title of a chat-role model; undefined = the selected chat model. */
  model?: string;
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  priority: number;
}

export interface ResolvedCouncilConfig {
  executionMode: "sequential" | "parallel" | "hybrid";
  maxConcurrency: number;
  maxAgents: number;
  maxRounds: number;
  timeoutMs: number;
  sharedContext: boolean;
  maxContextChars: number;
  requireJudge: boolean;
  blindEvaluation: boolean;
  weights: CriterionWeights;
  agents: CouncilAgent[];
}

export type CouncilAgentStatus =
  | "queued"
  | "analyzing"
  | "thinking"
  | "preparing"
  | "reviewing"
  | "revising"
  | "completed"
  | "failed"
  | "waiting"
  | "cancelled";

export type CouncilPhase =
  "context" | "proposals" | "review" | "judge" | "consolidate" | "done";

export interface EvidenceItem {
  /** Path as the agent wrote it. */
  file: string;
  startLine?: number;
  endLine?: number;
  claim: string;
}

export type EvidenceStatus =
  "verified" | "file-missing" | "out-of-range" | "unchecked";

export interface VerifiedEvidence extends EvidenceItem {
  status: EvidenceStatus;
}

export interface Proposal {
  agentId: string;
  /** Neutral label shown to reviewers ("A", "B", ...). */
  label: string;
  summary: string;
  approach: string;
  steps: string[];
  files: string[];
  risks: string[];
  evidence: VerifiedEvidence[];
  /** True when the model output did not follow the requested structure. */
  malformed: boolean;
}

export interface Review {
  reviewerId: string;
  /** label -> criterion -> 1..10 */
  scores: Record<string, Partial<Record<Criterion, number>>>;
  /** label -> issues */
  issues: Record<string, string[]>;
  best?: string;
}

export interface ProposalScore {
  agentId: string;
  label: string;
  perCriterion: Partial<Record<Criterion, number>>;
  /** Weighted total, 0..10. */
  total: number;
  evidenceVerified: number;
  evidenceTotal: number;
  /** Why the total was lowered, in plain words (shown in the UI). */
  adjustments: string[];
}

export type CouncilOutcome =
  "selected" | "insufficient-evidence" | "fallback" | "cancelled" | "failed";

export interface CouncilResult {
  outcome: CouncilOutcome;
  winnerAgentId?: string;
  scores: ProposalScore[];
  proposals: Proposal[];
  reviews: Review[];
  /** Deterministic plan text injected into the agent turn. */
  consolidated?: string;
  judgeNote?: string;
  note?: string;
  durationMs: number;
}

export type CouncilEvent =
  | {
      type: "start";
      agents: Pick<CouncilAgent, "id" | "name" | "role" | "model">[];
    }
  | { type: "phase"; phase: CouncilPhase }
  | {
      type: "agent-status";
      agentId: string;
      status: CouncilAgentStatus;
      detail?: string;
    }
  | {
      type: "agent-text";
      agentId: string;
      kind: "content" | "thinking";
      chars: number;
    }
  | { type: "context-ready"; chars: number; items: number }
  | { type: "proposal"; proposal: Proposal }
  | { type: "review"; review: Review }
  | { type: "scores"; scores: ProposalScore[] }
  | { type: "result"; result: CouncilResult };

export interface CouncilChatRequest {
  modelTitle?: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  signal: AbortSignal;
  /** Called with running totals so the UI can show thinking vs output. */
  onProgress?: (p: { contentChars: number; thinkingChars: number }) => void;
}

export interface CouncilChatResponse {
  text: string;
  thinkingChars: number;
  /** True when the stream was cut by the length/loop guard. */
  truncated: boolean;
}

export interface FileInfo {
  exists: boolean;
  lineCount?: number;
}

/** Everything the orchestrator needs from its host. Keeps it provider-agnostic. */
export interface CouncilRuntime {
  chat(req: CouncilChatRequest): Promise<CouncilChatResponse>;
  /** Read-only context preparation (e.g. prepare_context). Returns plain text. */
  prepareContext(task: string, signal: AbortSignal): Promise<string>;
  fileInfo(path: string): Promise<FileInfo>;
  emit(event: CouncilEvent): void;
}
