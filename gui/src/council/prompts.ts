import type { CouncilAgentRole } from "core";
import { CRITERIA, CouncilAgent, Proposal } from "./types";

export const ROLE_PROMPTS: Record<CouncilAgentRole, string> = {
  architect:
    "You are the primary design agent. Propose the most direct, correct way to do the task in this codebase. Prefer existing patterns and files over new abstractions.",
  implementer:
    "You are an implementation-focused agent. Propose concrete, ordered code changes with exact files and symbols to touch.",
  "code-reviewer":
    "You are a strict code reviewer. Judge proposals on evidence, not on style or confidence. A claim with no file reference is unverified. Do not reward agreement between proposals.",
  "alternative-thinker":
    "You are an independent second opinion. Solve the task your own way and deliberately consider a different approach from the obvious one, but only if it is not worse.",
  performance:
    "You are a performance-focused agent. Propose a solution and call out hot paths, queries, allocations and complexity.",
  security:
    "You are a security-focused agent. Propose a solution and call out validation, authorization, injection and data-exposure risks.",
  judge:
    "You are the judge. Decide which proposal is best supported by evidence, or state that none is. Never pick a proposal only because it is longer or more confident.",
};

const PROPOSAL_FORMAT = `Reply in exactly this plain-text format and nothing else. Be concise.

SUMMARY: <one sentence>
APPROACH: <2-5 sentences>
STEPS:
- <ordered concrete step>
FILES:
- <relative/path.ext> :: <why it changes>
EVIDENCE:
- <relative/path.ext>:<start>-<end> :: <what that code shows>
RISKS:
- <risk or open question>

Rules: EVIDENCE must cite real files and line ranges you were given or read. If you have no evidence for a claim, say so in RISKS instead of inventing a reference.`;

const REVIEW_FORMAT = `Reply in exactly this plain-text format and nothing else.

SCORES:
<label>: correctness=<1-10> requirements=<1-10> maintainability=<1-10> performance=<1-10> security=<1-10> simplicity=<1-10>
ISSUES:
<label>: <specific problem with evidence, or "none">
BEST: <label or NONE>

Score every proposal. Use NONE if no proposal is adequately supported. Cite file references when you raise an issue.`;

export function proposalMessages(
  agent: CouncilAgent,
  task: string,
  sharedContext: string,
): { system: string; user: string } {
  // Shared context goes FIRST and is identical for every agent, so llama.cpp can
  // reuse its prompt cache. Only the role prompt (system) differs.
  const user = [
    sharedContext ? `# Shared context\n${sharedContext}` : "",
    `# Task\n${task}`,
    PROPOSAL_FORMAT,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: agent.systemPrompt, user };
}

export function renderProposalForReview(p: Proposal): string {
  const list = (xs: string[]) =>
    xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (none)";
  const evidence = p.evidence.length
    ? p.evidence
        .map(
          (e) =>
            `- ${e.file}${e.startLine ? `:${e.startLine}${e.endLine ? `-${e.endLine}` : ""}` : ""} :: ${e.claim} [${e.status}]`,
        )
        .join("\n")
    : "- (none)";
  return [
    `## Proposal ${p.label}`,
    `SUMMARY: ${p.summary}`,
    `APPROACH: ${p.approach}`,
    `STEPS:\n${list(p.steps)}`,
    `FILES:\n${list(p.files)}`,
    `EVIDENCE (status checked by the tool, not by the author):\n${evidence}`,
    `RISKS:\n${list(p.risks)}`,
  ].join("\n");
}

export function reviewMessages(
  agent: CouncilAgent,
  task: string,
  sharedContext: string,
  proposals: Proposal[],
): { system: string; user: string } {
  const user = [
    sharedContext ? `# Shared context\n${sharedContext}` : "",
    `# Task\n${task}`,
    `# Proposals (authors are hidden)\n${proposals.map(renderProposalForReview).join("\n\n")}`,
    `Criteria: ${CRITERIA.join(", ")}. Evidence marked file-missing or out-of-range is wrong; score correctness accordingly.`,
    REVIEW_FORMAT,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: agent.systemPrompt, user };
}

export function judgeMessages(
  agent: CouncilAgent,
  task: string,
  proposals: Proposal[],
  summary: string,
): { system: string; user: string } {
  const user = [
    `# Task\n${task}`,
    `# Proposals\n${proposals.map(renderProposalForReview).join("\n\n")}`,
    `# Scoring so far\n${summary}`,
    `Reply in exactly this format:\nWINNER: <label or NONE>\nREASON: <one or two sentences citing evidence>`,
  ].join("\n\n");
  return { system: agent.systemPrompt, user };
}
