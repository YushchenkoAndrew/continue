import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import type { CouncilAgentStatus, CouncilPhase } from "../../council/types";
import { useAppSelector } from "../../redux/hooks";
import type {
  CouncilAgentState,
  CouncilRunState,
} from "../../redux/slices/councilSlice";
import Spinner from "../gui/Spinner";

const PHASE_LABEL: Record<CouncilPhase, string> = {
  context: "Preparing context",
  proposals: "Writing proposals",
  review: "Cross-reviewing",
  judge: "Judging",
  consolidate: "Consolidating",
  done: "Done",
};

const STATUS_LABEL: Record<CouncilAgentStatus, string> = {
  queued: "Queued",
  analyzing: "Analyzing",
  thinking: "Thinking",
  preparing: "Preparing proposal",
  reviewing: "Reviewing",
  revising: "Revising",
  completed: "Done",
  failed: "Failed",
  waiting: "Waiting",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<CouncilAgentStatus, string> = {
  queued: "var(--vscode-descriptionForeground)",
  analyzing: "var(--vscode-progressBar-background, #0e70c0)",
  thinking: "var(--vscode-progressBar-background, #0e70c0)",
  preparing: "var(--vscode-progressBar-background, #0e70c0)",
  reviewing: "var(--vscode-progressBar-background, #0e70c0)",
  revising: "var(--vscode-progressBar-background, #0e70c0)",
  completed: "var(--vscode-charts-green, #3fb950)",
  failed: "var(--vscode-errorForeground, #f14c4c)",
  waiting: "var(--vscode-list-warningForeground, #cca700)",
  cancelled: "var(--vscode-descriptionForeground)",
};

const fmtChars = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const fmtSecs = (ms: number) =>
  ms >= 60000
    ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
    : `${Math.max(1, Math.round(ms / 1000))}s`;

function agentDetail(a: CouncilAgentState): string | undefined {
  const active = [
    "analyzing",
    "thinking",
    "preparing",
    "reviewing",
    "revising",
  ];
  if (active.includes(a.status) && a.chars > 0) {
    // thinking and output are different things: say which one is growing
    return `${a.kind === "thinking" ? "thinking" : "writing"} ${fmtChars(a.chars)} chars`;
  }
  if (a.endedAt && a.startedAt) return fmtSecs(a.endedAt - a.startedAt);
  return a.detail;
}

function headline(run: CouncilRunState): string {
  const r = run.result;
  if (run.running || !r) return PHASE_LABEL[run.phase];
  const winner = run.agents.find((a) => a.id === r.winnerAgentId);
  const score = r.scores.find((s) => s.agentId === r.winnerAgentId);
  switch (r.outcome) {
    case "selected":
      return `Plan from ${winner?.name ?? "council"}${score ? ` · ${score.total}/10` : ""}`;
    case "insufficient-evidence":
      return "No proposal was well supported";
    case "cancelled":
      return "Stopped";
    case "failed":
      return "Council failed";
    default:
      return "Skipped";
  }
}

function AgentRow({ a }: { a: CouncilAgentState }) {
  const detail = agentDetail(a);
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 py-0.5 text-xs">
      <span
        aria-hidden
        className="h-[7px] w-[7px] shrink-0 self-center rounded-full"
        style={{ backgroundColor: STATUS_COLOR[a.status] }}
      />
      <span className="min-w-0 max-w-full truncate font-medium" title={a.name}>
        {a.name}
      </span>
      <span
        className="text-description min-w-0 truncate"
        title={a.model ?? "selected model"}
      >
        {a.model ?? a.role}
      </span>
      <span className="text-description ml-auto shrink-0 whitespace-nowrap">
        {STATUS_LABEL[a.status]}
        {detail ? ` · ${detail}` : ""}
      </span>
    </li>
  );
}

function Details({ run }: { run: CouncilRunState }) {
  const r = run.result;
  if (!r) return null;
  const nameOf = (id: string) =>
    run.agents.find((a) => a.id === id)?.name ?? id;
  return (
    <div className="mt-2 min-w-0 space-y-2 text-xs">
      {r.note && <p className="text-description m-0 break-words">{r.note}</p>}
      {r.scores.length > 0 && (
        <ul className="m-0 list-none space-y-0.5 p-0">
          {[...r.scores]
            .sort((a, b) => b.total - a.total)
            .map((s) => (
              <li
                key={s.label}
                className="flex min-w-0 flex-wrap items-baseline gap-x-2"
                title={s.adjustments.join("; ")}
              >
                <span className="min-w-0 truncate">
                  {nameOf(s.agentId)}
                  {s.agentId === r.winnerAgentId ? " (selected)" : ""}
                </span>
                <span className="text-description ml-auto shrink-0 whitespace-nowrap">
                  {s.total}/10 · {s.evidenceVerified}/{s.evidenceTotal} refs
                  verified
                </span>
              </li>
            ))}
        </ul>
      )}
      {r.scores.some((s) => s.adjustments.length > 0) && (
        <ul className="text-description m-0 list-disc space-y-0.5 pl-4">
          {r.scores.flatMap((s) =>
            s.adjustments.map((adj, i) => (
              <li key={`${s.label}-${i}`} className="break-words">
                {nameOf(s.agentId)}: {adj}
              </li>
            )),
          )}
        </ul>
      )}
      {r.judgeNote && (
        <p className="text-description m-0 break-words">Judge: {r.judgeNote}</p>
      )}
      {r.proposals.map((p) => (
        <details key={p.label} className="min-w-0">
          <summary className="cursor-pointer break-words">
            {nameOf(p.agentId)}: {p.summary || "(no summary)"}
          </summary>
          <div className="text-description mt-1 min-w-0 space-y-1 break-words pl-3">
            {p.approach && <p className="m-0">{p.approach}</p>}
            {p.steps.length > 0 && (
              <ol className="m-0 list-decimal pl-4">
                {p.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
            {p.evidence.length > 0 && (
              <ul className="m-0 list-disc pl-4">
                {p.evidence.map((e, i) => (
                  <li key={i}>
                    {e.file}
                    {e.startLine ? `:${e.startLine}` : ""} ({e.status}){" "}
                    {e.claim}
                  </li>
                ))}
              </ul>
            )}
            {p.risks.length > 0 && (
              <p className="m-0">Risks: {p.risks.join("; ")}</p>
            )}
            {p.malformed && (
              <div className="min-w-0">
                <p className="m-0">
                  Not in the requested format. What the model returned
                  {p.thinkingChars
                    ? ` (after ${fmtChars(p.thinkingChars)} chars of reasoning)`
                    : ""}
                  :
                </p>
                <pre className="bg-chat-surface m-0 mt-1 box-border max-h-40 min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words rounded p-1">
                  {p.raw || "(empty)"}
                </pre>
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/** Live and final view of one council run. Driven by events, no polling. */
export function CouncilPanel() {
  const run = useAppSelector((s) => s.council.run);
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  if (!run) return null;

  // open while it works; collapsed once a plan was chosen unless the user opened it
  const expanded = open ?? (run.running || run.result?.outcome !== "selected");
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      className="border-chat-border bg-chat-fill rounded-chat mx-2 my-1 box-border min-w-0 max-w-full border border-solid p-2"
      data-testid="council-panel"
    >
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        className="text-foreground flex w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-xs"
        aria-expanded={expanded}
      >
        <Chevron className="text-description h-3 w-3 shrink-0" />
        <span className="font-medium">Council</span>
        <span
          className="text-description min-w-0 truncate"
          title={headline(run)}
        >
          {headline(run)}
        </span>
        {run.running ? (
          <span className="ml-auto shrink-0">
            <Spinner />
          </span>
        ) : (
          run.result && (
            <span className="text-description ml-auto shrink-0 whitespace-nowrap text-xs">
              {fmtSecs(run.result.durationMs)}
            </span>
          )
        )}
      </button>
      {expanded && (
        <div className="mt-1 min-w-0">
          <ul className="m-0 list-none p-0">
            {run.agents.map((a) => (
              <AgentRow key={a.id} a={a} />
            ))}
          </ul>
          <Details run={run} />
        </div>
      )}
    </div>
  );
}
