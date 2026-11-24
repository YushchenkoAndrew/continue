import { CRITERIA, Criterion, EvidenceItem, Proposal, Review } from "./types";

/** Small models sometimes leak reasoning tags or fences into the answer. */
export function cleanModelText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .replace(/```[a-z]*\n?/gi, "")
    .trim();
}

const PROPOSAL_KEYS = [
  "SUMMARY",
  "APPROACH",
  "STEPS",
  "FILES",
  "EVIDENCE",
  "RISKS",
] as const;
type ProposalKey = (typeof PROPOSAL_KEYS)[number];

function headerOf(
  line: string,
  keys: readonly string[],
): { key: string; rest: string } | undefined {
  const names = keys.join("|");
  // Accepts "SUMMARY: x", "**SUMMARY:** x", "**SUMMARY**: x", "## Summary",
  // "1. Summary:", "* **Summary:** x". A bullet counts as a prefix only before bold,
  // so a step like "- Files: update a.ts" is not mistaken for a section.
  const m = new RegExp(
    `^\\s*(?:#{1,6}\\s*|\\d+[.)]\\s*|[-*•]\\s+(?=\\*\\*))*\\**(${names})\\**\\s*([:：])?\\s*\\**\\s*(.*)$`,
    "i",
  ).exec(line);
  if (!m) return undefined;
  const rest = m[3].trim();
  // "Steps to take..." in prose has neither a colon nor an empty remainder
  if (!m[2] && rest) return undefined;
  return { key: m[1].toUpperCase(), rest };
}

function sectionsOf(
  text: string,
  keys: readonly string[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string | undefined;
  for (const line of text.split("\n")) {
    const h = headerOf(line, keys);
    if (h) {
      current = h.key;
      out[current] ??= [];
      if (h.rest) out[current].push(h.rest);
      continue;
    }
    if (current && line.trim()) out[current].push(line.trim());
  }
  return out;
}

function listItems(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter((l) => l && !/^\(?none\)?\.?$/i.test(l));
}

export function parseEvidenceLine(line: string): EvidenceItem | undefined {
  const sep = line.indexOf("::");
  let loc: string;
  let claim: string;
  if (sep >= 0) {
    loc = line.slice(0, sep);
    claim = line.slice(sep + 2).trim();
  } else {
    const m = /^`?(\S+?)`?\s+(.*)$/.exec(line.trim());
    if (!m) return undefined;
    loc = m[1];
    claim = m[2];
  }
  loc = loc.trim().replace(/^`+|`+$/g, "");
  const m = /^(.+?)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/.exec(loc);
  if (!m) return undefined;
  const file = m[1].trim();
  // A real path has no spaces and looks like a path or filename.
  if (!file || /\s/.test(file) || !/[./\\]/.test(file)) return undefined;
  return {
    file,
    startLine: m[2] ? Number(m[2]) : undefined,
    endLine: m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : undefined,
    claim,
  };
}

function fileOf(line: string): string | undefined {
  const head = line
    .split("::")[0]
    .trim()
    .replace(/^`+|`+$/g, "");
  const file = head.replace(/:\d+(?:\s*[-–]\s*\d+)?$/, "");
  return file && !/\s/.test(file) ? file : undefined;
}

export function parseProposal(
  rawText: string,
  agentId: string,
  label: string,
): Proposal {
  const text = cleanModelText(rawText);
  const s = sectionsOf(text, PROPOSAL_KEYS);
  const get = (k: ProposalKey) => s[k];

  const summary = (get("SUMMARY") ?? []).join(" ").trim();
  const steps = listItems(get("STEPS"));
  const malformed = !summary && steps.length === 0;

  const approach = malformed
    ? text.slice(0, 1500)
    : (get("APPROACH") ?? []).join(" ").trim();

  const evidenceRaw = listItems(get("EVIDENCE"));
  const evidence = evidenceRaw
    .map(parseEvidenceLine)
    .filter((e): e is EvidenceItem => !!e)
    .map((e) => ({ ...e, status: "unchecked" as const }));

  const files = listItems(get("FILES"))
    .map(fileOf)
    .filter((f): f is string => !!f);

  return {
    agentId,
    label,
    summary: summary || (malformed ? firstSentence(text) : ""),
    approach,
    steps,
    files,
    risks: listItems(get("RISKS")),
    evidence,
    malformed,
  };
}

function firstSentence(t: string): string {
  const m = /^[\s\S]{1,200}?[.!?](?:\s|$)/.exec(t);
  return (m ? m[0] : t.slice(0, 200)).trim();
}

function normLabel(raw: string): string {
  return raw
    .replace(/\*+/g, "")
    .replace(/^proposal\s+/i, "")
    .trim()
    .toUpperCase();
}

const REVIEW_KEYS = ["SCORES", "ISSUES", "BEST"] as const;

export function parseReview(
  rawText: string,
  reviewerId: string,
  labels: string[],
): Review {
  const text = cleanModelText(rawText);
  const s = sectionsOf(text, REVIEW_KEYS);
  const valid = new Set(labels.map((l) => l.toUpperCase()));

  const scores: Review["scores"] = {};
  for (const line of s.SCORES ?? []) {
    const m = /^[-*•\s]*([^:=]+?)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const label = normLabel(m[1]);
    if (!valid.has(label)) continue;
    const entry: Partial<Record<Criterion, number>> = {};
    for (const c of CRITERIA) {
      const sm = new RegExp(`${c}\\s*[=:]\\s*(\\d+(?:\\.\\d+)?)`, "i").exec(
        m[2],
      );
      if (sm) entry[c] = Math.min(10, Math.max(1, Number(sm[1])));
    }
    if (Object.keys(entry).length)
      scores[label] = { ...scores[label], ...entry };
  }

  const issues: Review["issues"] = {};
  let last: string | undefined;
  for (const line of s.ISSUES ?? []) {
    const m = /^[-*•\s]*(?:proposal\s+)?\**([A-Z])\**\s*[:)\]-]\s*(.*)$/i.exec(
      line,
    );
    if (m && valid.has(m[1].toUpperCase())) {
      last = m[1].toUpperCase();
      const txt = m[2].trim();
      if (txt && !/^none\.?$/i.test(txt)) (issues[last] ??= []).push(txt);
    } else if (last) {
      const txt = line.replace(/^[-*•\s]+/, "").trim();
      if (txt && !/^none\.?$/i.test(txt)) (issues[last] ??= []).push(txt);
    }
  }

  let best: string | undefined;
  const bestRaw = (s.BEST ?? []).join(" ");
  const bm = /(?:proposal\s+)?\**([A-Z])\**\b/i.exec(bestRaw);
  if (bm && !/^none/i.test(bestRaw.trim()) && valid.has(bm[1].toUpperCase())) {
    best = bm[1].toUpperCase();
  }

  return { reviewerId, scores, issues, best };
}

export function parseJudge(
  rawText: string,
  labels: string[],
): {
  winner?: string;
  reason: string;
} {
  const text = cleanModelText(rawText);
  const s = sectionsOf(text, ["WINNER", "REASON"]);
  const w = (s.WINNER ?? []).join(" ");
  const wm = /(?:proposal\s+)?\**([A-Z])\**\b/i.exec(w);
  const valid = new Set(labels.map((l) => l.toUpperCase()));
  const winner =
    wm && !/^none/i.test(w.trim()) && valid.has(wm[1].toUpperCase())
      ? wm[1].toUpperCase()
      : undefined;
  return { winner, reason: (s.REASON ?? []).join(" ").trim() };
}
