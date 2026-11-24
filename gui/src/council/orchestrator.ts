import { consolidate } from "./consolidate";
import { isProposer } from "./defaults";
import { decide, JUDGE_MAX_OVERRIDE, scoreProposals } from "./evaluation";
import { verifyProposalEvidence } from "./evidence";
import {
  cleanModelText,
  parseJudge,
  parseProposal,
  parseReview,
} from "./parse";
import { judgeMessages, proposalMessages, reviewMessages } from "./prompts";
import {
  CouncilAgent,
  CouncilAgentStatus,
  CouncilResult,
  CouncilRuntime,
  Proposal,
  Review,
  ResolvedCouncilConfig,
} from "./types";

export interface RunCouncilArgs {
  task: string;
  /** Text the user attached to the request (selected code, files); shared with every agent. */
  extraContext?: string;
  config: ResolvedCouncilConfig;
  runtime: CouncilRuntime;
  /** Cancels the whole council (user stop). */
  signal: AbortSignal;
}

class CouncilAbort extends Error {
  constructor(readonly reason: "cancelled" | "timeout") {
    super(reason);
  }
}

const TEXT_EVENT_INTERVAL_MS = 250;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function labelFor(i: number): string {
  return String.fromCharCode(65 + i);
}

/**
 * Sequential council: independent proposals -> blind cross-review ->
 * deterministic scoring and evidence checks -> optional judge ->
 * deterministic consolidation. It never edits files; implementation goes
 * through the normal agent turn.
 */
export async function runCouncil(args: RunCouncilArgs): Promise<CouncilResult> {
  const { task, config, runtime } = args;
  const started = Date.now();

  const ctl = new AbortController();
  let timedOut = false;
  const onUserAbort = () => ctl.abort();
  if (args.signal.aborted) ctl.abort();
  args.signal.addEventListener("abort", onUserAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, config.timeoutMs);

  const result = (r: Omit<CouncilResult, "durationMs">): CouncilResult => {
    const full = { ...r, durationMs: Date.now() - started };
    runtime.emit({ type: "result", result: full });
    return full;
  };

  const proposers = config.agents.filter((a) => isProposer(a.role));
  const reviewers = config.agents.filter((a) => a.role === "code-reviewer");
  const judge = config.agents.find((a) => a.role === "judge");
  const notes: string[] = [];

  const status = (agentId: string, s: CouncilAgentStatus, detail?: string) =>
    runtime.emit({ type: "agent-status", agentId, status: s, detail });

  const check = () => {
    if (ctl.signal.aborted) {
      throw new CouncilAbort(timedOut ? "timeout" : "cancelled");
    }
  };

  /** One model call with live status transitions and throttled text events. */
  const ask = async (
    agent: CouncilAgent,
    msgs: { system: string; user: string },
    idleStatus: CouncilAgentStatus,
  ): Promise<{ text: string; thinkingChars: number }> => {
    check();
    status(agent.id, "analyzing");
    let phase: CouncilAgentStatus = "analyzing";
    let lastEmit = 0;
    const res = await runtime.chat({
      modelTitle: agent.model,
      system: msgs.system,
      user: msgs.user,
      temperature: agent.temperature,
      maxTokens: agent.maxOutputTokens,
      signal: ctl.signal,
      onProgress: ({ contentChars, thinkingChars }) => {
        const next: CouncilAgentStatus =
          contentChars > 0
            ? idleStatus
            : thinkingChars > 0
              ? "thinking"
              : phase;
        if (next !== phase) {
          phase = next;
          status(agent.id, phase);
        }
        const now = Date.now();
        if (now - lastEmit >= TEXT_EVENT_INTERVAL_MS) {
          lastEmit = now;
          runtime.emit({
            type: "agent-text",
            agentId: agent.id,
            kind: contentChars > 0 ? "content" : "thinking",
            chars: contentChars > 0 ? contentChars : thinkingChars,
          });
        }
      },
    });
    check();
    // An empty answer is a failure, not "Done": most often the model spent the
    // whole output limit reasoning, so say that and what to change.
    if (!cleanModelText(res.text)) {
      const kb = (n: number) =>
        n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
      if (res.loop === "repetition") {
        throw new Error(
          `no answer: the model started repeating itself and was stopped (${kb(res.thinkingChars)} chars of thinking).`,
        );
      }
      throw new Error(
        res.thinkingChars > 0 || res.truncated
          ? `no answer: it spent its output limit thinking (${kb(res.thinkingChars)} chars). Raise council.context.maxOutputTokens or reduce reasoning.`
          : "the model returned an empty answer",
      );
    }
    return { text: res.text, thinkingChars: res.thinkingChars };
  };

  try {
    if (proposers.length < 2) {
      runtime.emit({ type: "start", agents: [] });
      return result({
        outcome: "fallback",
        scores: [],
        proposals: [],
        reviews: [],
        note: "The council needs at least two proposing agents. Continuing with the normal agent.",
      });
    }

    runtime.emit({
      type: "start",
      agents: config.agents.map(({ id, name, role, model }) => ({
        id,
        name,
        role,
        model,
      })),
    });
    for (const a of config.agents) status(a.id, "queued");
    if (config.executionMode !== "sequential") {
      notes.push(
        `${config.executionMode} mode is not available yet; ran sequentially.`,
      );
    }

    // Phase 0/1: context, prepared once and shared (identical prefix for every agent)
    runtime.emit({ type: "phase", phase: "context" });
    let context = args.extraContext?.trim() ?? "";
    if (config.sharedContext) {
      try {
        const prepared = await runtime.prepareContext(task, ctl.signal);
        context = [context, prepared].filter(Boolean).join("\n\n");
      } catch {
        check();
        notes.push(
          "Context preparation failed; agents worked from the task alone.",
        );
      }
    }
    if (context.length > config.maxContextChars) {
      context =
        context.slice(0, config.maxContextChars) +
        "\n[context truncated to fit the budget]";
    }
    runtime.emit({
      type: "context-ready",
      chars: context.length,
      items: context ? 1 : 0,
    });

    // Phase 2: independent proposals (agents never see each other's output)
    runtime.emit({ type: "phase", phase: "proposals" });
    const authored: { agent: CouncilAgent; proposal: Proposal }[] = [];
    const evidenceCache = new Map();
    for (const agent of proposers) {
      try {
        const { text, thinkingChars } = await ask(
          agent,
          proposalMessages(agent, task, context),
          "preparing",
        );
        let proposal = parseProposal(text, agent.id, "");
        proposal.raw = text.trim().slice(0, 800);
        proposal.thinkingChars = thinkingChars;
        proposal = await verifyProposalEvidence(
          proposal,
          runtime,
          evidenceCache,
        );
        authored.push({ agent, proposal });
        runtime.emit({ type: "proposal", proposal });
        status(
          agent.id,
          proposal.malformed ? "failed" : "completed",
          proposal.malformed
            ? "answer was not in the requested format"
            : undefined,
        );
      } catch (e) {
        if (e instanceof CouncilAbort) throw e;
        check(); // an aborted request is a cancel, not an agent failure
        status(agent.id, "failed", e instanceof Error ? e.message : String(e));
      }
    }
    check();

    const usable = authored.filter((a) => !a.proposal.malformed);
    if (authored.length >= 2 && usable.length < 2) {
      // Reviewing unstructured answers only burns time: say what came back instead.
      return result({
        outcome: "insufficient-evidence",
        scores: [],
        proposals: authored.map((a, i) => ({
          ...a.proposal,
          label: labelFor(i),
        })),
        reviews: [],
        note: `Fewer than two answers followed the requested format, so the review was skipped (open the proposals to see what each model returned). Continuing with the normal agent.`,
      });
    }
    if (authored.length < 2) {
      return result({
        outcome: "fallback",
        scores: [],
        proposals: authored.map((a) => a.proposal),
        reviews: [],
        note: "Fewer than two proposals were produced. Continuing with the normal agent.",
      });
    }

    // Blind labels in randomized order: reviewers cannot infer author or priority
    const order = config.blindEvaluation ? shuffle(authored) : authored;
    const proposals: Proposal[] = order.map((a, i) => ({
      ...a.proposal,
      label: labelFor(i),
    }));
    const agentById = new Map(config.agents.map((a) => [a.id, a]));
    const labels = proposals.map((p) => p.label);

    // Phase 4: cross-review
    runtime.emit({ type: "phase", phase: "review" });
    const reviews: Review[] = [];
    if (reviewers.length === 0) {
      notes.push("No reviewer configured; ranked by verified evidence only.");
    }
    for (const reviewer of reviewers) {
      try {
        const { text } = await ask(
          reviewer,
          reviewMessages(reviewer, task, context, proposals),
          "reviewing",
        );
        const review = parseReview(text, reviewer.id, labels);
        if (Object.keys(review.scores).length === 0) {
          throw new Error("review could not be parsed");
        }
        reviews.push(review);
        runtime.emit({ type: "review", review });
        status(reviewer.id, "completed");
      } catch (e) {
        if (e instanceof CouncilAbort) throw e;
        check(); // an aborted request is a cancel, not an agent failure
        status(
          reviewer.id,
          "failed",
          e instanceof Error ? e.message : String(e),
        );
        notes.push(
          `Reviewer ${reviewer.name} failed; scores rely on evidence checks.`,
        );
      }
    }
    check();

    // Phase 5: deterministic weighted evaluation
    const scores = scoreProposals(proposals, reviews, config.weights);
    runtime.emit({ type: "scores", scores });
    const priority = (id: string) => agentById.get(id)?.priority ?? 0;
    const decision = decide(scores, reviews, priority);

    if (decision.insufficient) {
      return result({
        outcome: "insufficient-evidence",
        scores,
        proposals,
        reviews,
        note: [
          "No proposal was adequately supported. Continuing with the normal agent.",
          ...notes,
        ].join(" "),
      });
    }

    // Optional judge: only when asked for, or scores are close, or a reviewer disagrees
    let winnerLabel = decision.winner!.label;
    let judgeNote: string | undefined;
    const needJudge =
      !!judge &&
      (config.requireJudge || decision.close || decision.disagreement);
    if (judge && needJudge) {
      runtime.emit({ type: "phase", phase: "judge" });
      try {
        const summary = decision.ranked
          .map(
            (s) =>
              `${s.label}: ${s.total}/10 (${s.evidenceVerified}/${s.evidenceTotal} references verified)`,
          )
          .join("\n");
        const { text } = await ask(
          judge,
          judgeMessages(judge, task, proposals, summary),
          "reviewing",
        );
        const verdict = parseJudge(text, labels);
        judgeNote = verdict.reason || undefined;
        status(judge.id, "completed");
        if (!verdict.winner) {
          return result({
            outcome: "insufficient-evidence",
            scores,
            proposals,
            reviews,
            judgeNote,
            note: "The judge found no adequately supported proposal. Continuing with the normal agent.",
          });
        }
        const chosen = scores.find((s) => s.label === verdict.winner);
        // The judge breaks ties; it cannot promote a proposal that scored as inadequate
        if (
          chosen &&
          chosen.total >= decision.winner!.total - JUDGE_MAX_OVERRIDE
        ) {
          winnerLabel = chosen.label;
        } else {
          judgeNote =
            `${judgeNote ?? ""} (judge preference overruled by evidence scores)`.trim();
        }
      } catch (e) {
        if (e instanceof CouncilAbort) throw e;
        check(); // an aborted request is a cancel, not an agent failure
        status(judge.id, "failed", e instanceof Error ? e.message : String(e));
        notes.push("Judge failed; kept the score leader.");
      }
    }
    check();

    // Phase 7: deterministic consolidation
    runtime.emit({ type: "phase", phase: "consolidate" });
    const winner = proposals.find((p) => p.label === winnerLabel)!;
    const winnerScore = scores.find((s) => s.label === winnerLabel)!;
    const consolidated = consolidate({
      winner,
      score: winnerScore,
      agent: agentById.get(winner.agentId),
      others: proposals.filter((p) => p.label !== winnerLabel),
      reviews,
      judgeNote,
    });
    runtime.emit({ type: "phase", phase: "done" });
    return result({
      outcome: "selected",
      winnerAgentId: winner.agentId,
      scores,
      proposals,
      reviews,
      consolidated,
      judgeNote,
      note: notes.length ? notes.join(" ") : undefined,
    });
  } catch (e) {
    if (e instanceof CouncilAbort || ctl.signal.aborted) {
      for (const a of config.agents) status(a.id, "cancelled");
      if (timedOut) {
        return result({
          outcome: "fallback",
          scores: [],
          proposals: [],
          reviews: [],
          note: `The council timed out after ${Math.round(config.timeoutMs / 1000)}s. Continuing with the normal agent.`,
        });
      }
      return result({
        outcome: "cancelled",
        scores: [],
        proposals: [],
        reviews: [],
      });
    }
    return result({
      outcome: "failed",
      scores: [],
      proposals: [],
      reviews: [],
      note: `The council failed: ${e instanceof Error ? e.message : String(e)}. Continuing with the normal agent.`,
    });
  } finally {
    clearTimeout(timer);
    args.signal.removeEventListener("abort", onUserAbort);
  }
}
