import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";
import { useAppSelector } from "../redux/hooks";
import { selectActivityTitle } from "../util/activityTitle";
import {
  AgentRun,
  deriveAgentRun,
  RunStatus,
  StepState,
} from "../util/agentRun";

// The selectors return strings only, so the panel re-renders when the task state or the
// activity changes, not on every streamed token.
const GLYPH: Record<StepState, string> = {
  done: "✓",
  active: "●",
  pending: "○",
  blocked: "!",
  failed: "✗",
};
const GLYPH_COLOR: Record<StepState, string> = {
  done: "var(--vscode-descriptionForeground)",
  active: "var(--vscode-progressBar-background, #0e70c0)",
  pending: "var(--vscode-descriptionForeground)",
  blocked: "var(--vscode-list-warningForeground, #cca700)",
  failed: "var(--vscode-errorForeground, #f14c4c)",
};
const STATE_LABEL: Record<StepState, string> = {
  done: "Completed",
  active: "In progress",
  pending: "Pending",
  blocked: "Blocked",
  failed: "Failed",
};
const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Executing",
  waiting_input: "Waiting for your input",
  paused: "Paused",
  failed: "Failed",
  completed: "Completed",
};

function ProgressBar({ run }: { run: AgentRun }) {
  const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
  const color = run.steps.some((s) => s.state === "failed")
    ? GLYPH_COLOR.failed
    : run.steps.some((s) => s.state === "blocked")
      ? GLYPH_COLOR.blocked
      : run.status === "completed"
        ? "var(--vscode-charts-green, #3fb950)"
        : GLYPH_COLOR.active;
  return (
    <div
      className="bg-chat-border h-0.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full transition-all duration-300"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

/**
 * Progress overview above the input. It shows the derived execution state of the task (see
 * util/agentRun.ts), not text written by the model: a step is "Completed" only after the work
 * behind it happened. Small tasks get a one-line summary instead of a roadmap.
 */
export function PlanRoadmap() {
  const mode = useAppSelector((s) => s.session.mode);
  const key = useAppSelector((s) => {
    const run = deriveAgentRun(s.session.history, s.session.isStreaming);
    return run ? JSON.stringify(run) : "";
  });
  const activity = useAppSelector(selectActivityTitle);
  const [open, setOpen] = useState(true);

  const run = useMemo<AgentRun | undefined>(
    () => (key ? (JSON.parse(key) as AgentRun) : undefined),
    [key],
  );

  if (mode !== "agent" || !run) return null;

  // Small tasks: a lightweight line, no roadmap.
  const compact =
    !run.hasPlan && run.reads + run.changes < 3 && run.status === "running";
  const active = run.steps.find(
    (s) => s.state === "active" || s.state === "failed",
  );
  const blocked = run.steps.filter((s) => s.state === "blocked");
  const header = `Agent task — ${
    blocked.length && run.status !== "running"
      ? `${blocked.length} blocked`
      : STATUS_LABEL[run.status]
  }`;

  if (compact) {
    return (
      <div
        className="border-chat-border text-description rounded-chat mx-2 mb-1.5 min-w-0 truncate border border-solid px-3 py-1 text-xs"
        data-testid="plan-roadmap"
        title={activity}
      >
        {header}
        {activity ? ` · ${activity}` : ""}
      </div>
    );
  }

  return (
    <div
      className="border-chat-border rounded-chat mx-2 mb-1.5 min-w-0 border border-solid text-xs"
      data-testid="plan-roadmap"
    >
      <button
        className="text-foreground flex w-full min-w-0 cursor-pointer items-center gap-1.5 border-none bg-transparent px-3 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 flex-shrink-0" />
        )}
        <span className="min-w-0 truncate font-medium" title={header}>
          {header}
        </span>
        <span className="text-description ml-auto flex-shrink-0 tabular-nums">
          {run.done} / {run.total}
        </span>
      </button>

      <div className="px-3 pb-1.5">
        <ProgressBar run={run} />
      </div>

      {!open && active && (
        <div
          className="text-description truncate px-3 pb-1.5"
          title={active.label}
        >
          {active.state === "failed" ? "Failed: " : "Now: "}
          {active.label}
        </div>
      )}

      {open && (
        <div className="max-h-44 overflow-y-auto px-3 pb-1.5">
          {run.steps.map((s, i) => (
            <div
              key={i}
              className={`flex min-w-0 gap-1.5 py-0.5 ${s.state === "active" ? "font-medium" : ""} ${s.state === "done" ? "opacity-60" : ""}`}
            >
              <span
                className="w-3 flex-shrink-0 text-center"
                style={{ color: GLYPH_COLOR[s.state] }}
                title={STATE_LABEL[s.state]}
              >
                {GLYPH[s.state]}
              </span>
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span>{s.label}</span>
                {s.state !== "pending" && s.state !== "done" && (
                  <span className="text-description font-normal">
                    {" "}
                    — {STATE_LABEL[s.state]}
                  </span>
                )}
                {s.state === "active" &&
                  activity &&
                  run.status === "running" && (
                    <div
                      className="text-description truncate font-normal"
                      title={activity}
                    >
                      {activity}
                    </div>
                  )}
                {s.state === "blocked" && s.note && (
                  <div
                    className="font-normal"
                    style={{ color: GLYPH_COLOR.blocked }}
                  >
                    Blocked: {s.note}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
