import type { CouncilConfig } from "core";
import {
  CouncilAgent,
  CouncilAgentRole,
  CriterionWeights,
  ResolvedCouncilConfig,
} from "./types";
import { ROLE_PROMPTS } from "./prompts";

export const DEFAULT_WEIGHTS: CriterionWeights = {
  correctness: 35,
  requirements: 25,
  maintainability: 15,
  performance: 10,
  security: 10,
  simplicity: 5,
};

const ROLE_NAMES: Record<CouncilAgentRole, string> = {
  architect: "Architect",
  implementer: "Implementer",
  "code-reviewer": "Reviewer",
  "alternative-thinker": "Alternative",
  performance: "Performance",
  security: "Security",
  judge: "Judge",
};

const ROLE_TEMPERATURE: Record<CouncilAgentRole, number> = {
  architect: 0.3,
  implementer: 0.3,
  "code-reviewer": 0.1,
  "alternative-thinker": 0.6,
  performance: 0.3,
  security: 0.2,
  judge: 0.1,
};

/** Roles that write a proposal. Reviewers and the judge never do. */
export function isProposer(role: CouncilAgentRole): boolean {
  return role !== "code-reviewer" && role !== "judge";
}

function makeAgent(
  role: CouncilAgentRole,
  id: string,
  overrides: Partial<CouncilAgent> = {},
  maxOutputTokens: number,
  index: number,
): CouncilAgent {
  return {
    id,
    name: overrides.name ?? ROLE_NAMES[role],
    role,
    model: overrides.model,
    systemPrompt: overrides.systemPrompt ?? ROLE_PROMPTS[role],
    temperature: overrides.temperature ?? ROLE_TEMPERATURE[role],
    maxOutputTokens: overrides.maxOutputTokens ?? maxOutputTokens,
    priority: overrides.priority ?? 100 - index,
  };
}

/**
 * Merge user config over defaults. With no `council` block (or no agents) the
 * default council is three agents on the selected chat model: a primary
 * proposal, an independent alternative and a reviewer.
 */
export function resolveCouncilConfig(
  cfg: CouncilConfig | undefined,
  opts: { chatContextLength?: number } = {},
): ResolvedCouncilConfig {
  const maxOutputTokens = cfg?.context?.maxOutputTokens ?? 2048;

  // Budget in characters (~4 chars/token). Never hardcode over the model's own
  // window: keep room for output, role prompt and the other proposals.
  const configuredChars = (cfg?.context?.maxContextPerAgent ?? 12000) * 4;
  const windowChars =
    opts.chatContextLength && opts.chatContextLength > 0
      ? Math.max(
          4000,
          Math.floor(opts.chatContextLength * 4 * 0.4) - maxOutputTokens * 4,
        )
      : Infinity;
  const maxContextChars = Math.min(configuredChars, windowChars);

  const rawAgents = cfg?.agents ?? [];
  const agents: CouncilAgent[] =
    rawAgents.length > 0
      ? rawAgents.map((a, i) =>
          makeAgent(
            a.role,
            a.id,
            {
              name: a.name,
              model: a.model,
              systemPrompt: a.systemPrompt,
              temperature: a.temperature,
              maxOutputTokens: a.maxOutputTokens,
              priority: a.priority,
            },
            maxOutputTokens,
            i,
          ),
        )
      : [
          makeAgent("architect", "primary", {}, maxOutputTokens, 0),
          makeAgent(
            "alternative-thinker",
            "alternative",
            {},
            maxOutputTokens,
            1,
          ),
          makeAgent("code-reviewer", "reviewer", {}, maxOutputTokens, 2),
        ];

  const maxAgents = cfg?.execution?.maxAgents ?? 3;
  const w = { ...DEFAULT_WEIGHTS, ...(cfg?.evaluation?.weights ?? {}) };

  return {
    executionMode: cfg?.execution?.mode ?? "sequential",
    maxConcurrency: cfg?.execution?.maxConcurrency ?? 1,
    maxAgents,
    maxRounds: cfg?.execution?.maxRounds ?? 1,
    timeoutMs: cfg?.execution?.timeout ?? 300000,
    sharedContext: cfg?.context?.sharedContext ?? true,
    maxContextChars,
    requireJudge: cfg?.selection?.requireJudge ?? false,
    blindEvaluation: cfg?.selection?.blindEvaluation ?? true,
    weights: w,
    // keep highest priority first, then cap; the judge is exempt from the cap
    agents: capAgents(agents, maxAgents),
  };
}

function capAgents(agents: CouncilAgent[], max: number): CouncilAgent[] {
  const sorted = [...agents].sort((a, b) => b.priority - a.priority);
  const judge = sorted.filter((a) => a.role === "judge");
  const rest = sorted.filter((a) => a.role !== "judge");
  // always keep at least one reviewer if present, so a cap can't drop scoring
  const reviewer = rest.find((a) => a.role === "code-reviewer");
  const proposers = rest.filter((a) => a.role !== "code-reviewer");
  const room = reviewer ? Math.max(2, max - 1) : Math.max(2, max);
  return [
    ...proposers.slice(0, room),
    ...(reviewer ? [reviewer] : []),
    ...judge,
  ];
}
