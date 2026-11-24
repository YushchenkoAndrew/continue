import {
  CRITERIA,
  Criterion,
  CriterionWeights,
  Proposal,
  ProposalScore,
  Review,
} from "./types";

const NEUTRAL = 5;
/** Below this weighted score nothing is adequate. */
export const MIN_ACCEPTABLE = 4.5;
/** Top two within this gap count as "close" and may need a judge. */
export const CLOSE_GAP = 0.75;
/** The judge may prefer a lower-scored proposal only within this many points. */
export const JUDGE_MAX_OVERRIDE = 1.5;

function avg(xs: number[]): number | undefined {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Weighted, normalized scoring. No majority vote and no reward for agreement:
 * reviewer numbers are averaged per criterion, then correctness is adjusted by
 * what the tool could actually verify.
 */
export function scoreProposals(
  proposals: Proposal[],
  reviews: Review[],
  weights: CriterionWeights,
): ProposalScore[] {
  const wSum = CRITERIA.reduce((a, c) => a + Math.max(0, weights[c]), 0) || 1;

  return proposals.map((p) => {
    const adjustments: string[] = [];
    const per: Partial<Record<Criterion, number>> = {};

    let reviewed = false;
    for (const c of CRITERIA) {
      const vals = reviews
        .map((r) => r.scores[p.label]?.[c])
        .filter((v): v is number => typeof v === "number");
      if (vals.length) reviewed = true;
      per[c] = avg(vals) ?? NEUTRAL;
    }
    if (!reviewed)
      adjustments.push("not scored by any reviewer; neutral scores used");

    const total = p.evidence.length;
    const verified = p.evidence.filter((e) => e.status === "verified").length;
    const unchecked = p.evidence.filter((e) => e.status === "unchecked").length;
    const invalid = total - verified - unchecked;

    if (total === 0) {
      per.correctness = Math.min(per.correctness ?? NEUTRAL, NEUTRAL);
      adjustments.push("no evidence cited; correctness capped at 5");
    } else {
      const ratio = (verified + 0.5 * unchecked) / total;
      per.correctness = (per.correctness ?? NEUTRAL) * (0.5 + 0.5 * ratio);
      if (invalid > 0) {
        adjustments.push(
          `${invalid} of ${total} references do not exist or are out of range`,
        );
      }
    }

    if (p.malformed) {
      per.correctness = (per.correctness ?? NEUTRAL) * 0.7;
      per.requirements = (per.requirements ?? NEUTRAL) * 0.8;
      adjustments.push("answer did not follow the requested structure");
    }

    const weighted =
      CRITERIA.reduce(
        (a, c) => a + Math.max(0, weights[c]) * (per[c] ?? NEUTRAL),
        0,
      ) / wSum;

    return {
      agentId: p.agentId,
      label: p.label,
      perCriterion: Object.fromEntries(
        CRITERIA.map((c) => [c, round2(per[c] ?? NEUTRAL)]),
      ),
      total: round2(weighted),
      evidenceVerified: verified,
      evidenceTotal: total,
      adjustments,
    };
  });
}

export interface Decision {
  /** Best proposal by score, or undefined if none is adequate. */
  winner?: ProposalScore;
  ranked: ProposalScore[];
  insufficient: boolean;
  close: boolean;
  /** A reviewer's own pick differs from the score leader. */
  disagreement: boolean;
}

export function decide(
  scores: ProposalScore[],
  reviews: Review[],
  priority: (agentId: string) => number,
): Decision {
  const ranked = [...scores].sort(
    (a, b) =>
      b.total - a.total ||
      b.evidenceVerified - a.evidenceVerified || // tie-break 1: more verified evidence
      priority(b.agentId) - priority(a.agentId), // tie-break 2: configured priority
  );
  const top = ranked[0];
  const second = ranked[1];
  const insufficient = !top || top.total < MIN_ACCEPTABLE;
  const close = !!top && !!second && top.total - second.total < CLOSE_GAP;
  const disagreement =
    !!top && reviews.some((r) => r.best !== undefined && r.best !== top.label);
  return {
    winner: insufficient ? undefined : top,
    ranked,
    insufficient,
    close,
    disagreement,
  };
}
