import { CouncilRuntime, Proposal, VerifiedEvidence } from "./types";

/**
 * Deterministic evidence check: do the cited files exist and are the cited
 * line ranges inside them? No model is involved, so a confident but invented
 * reference cannot score well.
 */
export async function verifyProposalEvidence(
  proposal: Proposal,
  runtime: Pick<CouncilRuntime, "fileInfo">,
  cache: Map<string, ReturnType<CouncilRuntime["fileInfo"]>> = new Map(),
): Promise<Proposal> {
  const evidence: VerifiedEvidence[] = [];
  for (const e of proposal.evidence) {
    let infoPromise = cache.get(e.file);
    if (!infoPromise) {
      infoPromise = runtime.fileInfo(e.file).catch(() => ({ exists: false }));
      cache.set(e.file, infoPromise);
    }
    const info = await infoPromise;
    let status: VerifiedEvidence["status"];
    if (!info.exists) {
      status = "file-missing";
    } else if (e.startLine === undefined) {
      status = "unchecked"; // file exists but no range to check
    } else if (
      info.lineCount !== undefined &&
      (e.startLine < 1 ||
        e.startLine > info.lineCount ||
        (e.endLine ?? e.startLine) > info.lineCount ||
        (e.endLine ?? e.startLine) < e.startLine)
    ) {
      status = "out-of-range";
    } else {
      status = "verified";
    }
    evidence.push({ ...e, status });
  }
  return { ...proposal, evidence };
}
