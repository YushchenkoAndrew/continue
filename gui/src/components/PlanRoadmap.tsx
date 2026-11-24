import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { PlanStep } from "core/tools/memory/plan";
import { useMemo, useState } from "react";
import { useAppSelector } from "../redux/hooks";
import {
  findLatestPlan,
  PlanSnapshot,
  planFromContent,
} from "../util/agentPlan";
import { selectActivityTitle } from "../util/activityTitle";

// Selectors return strings only, so the panel re-renders when the plan or the activity
// changes, not on every streamed token.
const GLYPH: Record<PlanStep["status"], string> = {
  done: "✓",
  in_progress: "●",
  pending: "○",
  blocked: "!",
};
const GLYPH_COLOR: Record<PlanStep["status"], string> = {
  done: "var(--vscode-charts-green, #3fb950)",
  in_progress: "var(--vscode-progressBar-background, #0e70c0)",
  pending: "var(--vscode-descriptionForeground)",
  blocked: "var(--vscode-list-warningForeground, #cca700)",
};

function ProgressBar({ plan }: { plan: PlanSnapshot }) {
  const pct = plan.total ? Math.round((plan.done / plan.total) * 100) : 0;
  const hasBlocked = plan.steps.some((s) => s.status === "blocked");
  return (
    <div
      className="h-1 w-full overflow-hidden rounded"
      style={{
        backgroundColor:
          "var(--vscode-editorWidget-border, rgba(128,128,128,0.3))",
      }}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full transition-all duration-300"
        style={{
          width: `${pct}%`,
          backgroundColor: hasBlocked
            ? GLYPH_COLOR.blocked
            : plan.complete
              ? GLYPH_COLOR.done
              : GLYPH_COLOR.in_progress,
        }}
      />
    </div>
  );
}

/**
 * Roadmap of the agent's plan, shown above the input so it stays visible while the agent
 * works. It reads the structured update_plan results already in the chat; the agent is not
 * asked to resend or reconstruct it.
 */
export function PlanRoadmap() {
  const mode = useAppSelector((s) => s.session.mode);
  const content = useAppSelector(
    (s) => findLatestPlan(s.session.history)?.content,
  );
  const activity = useAppSelector(selectActivityTitle);
  const [open, setOpen] = useState(true);

  const plan = useMemo(
    () => (content ? planFromContent(content) : undefined),
    [content],
  );

  if (mode !== "agent" || !plan) return null;

  const current = plan.steps.find((s) => s.status === "in_progress");
  const next = plan.steps.find((s) => s.status === "pending");
  const blocked = plan.steps.filter((s) => s.status === "blocked");
  const markersLeft = plan.done === plan.total && !plan.complete;
  const status = plan.complete
    ? "Complete"
    : markersLeft
      ? "Steps done, unfinished markers remain"
      : blocked.length
        ? `${blocked.length} blocked`
        : activity
          ? undefined
          : "Paused";

  return (
    <div
      className="border-border mx-2 mb-1 rounded border border-solid text-xs"
      style={{ backgroundColor: "var(--vscode-editor-background)" }}
      data-testid="plan-roadmap"
    >
      <button
        className="text-foreground flex w-full min-w-0 cursor-pointer items-center gap-1.5 border-none bg-transparent px-2 py-1 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 flex-shrink-0" />
        )}
        <span className="flex-shrink-0 font-semibold">
          Implementation Progress
        </span>
        <span className="text-description flex-shrink-0">
          {plan.done}/{plan.total}
        </span>
        {status && (
          <span className="text-description min-w-0 truncate">· {status}</span>
        )}
      </button>

      <div className="px-2 pb-1">
        <ProgressBar plan={plan} />
      </div>

      {!open && (current ?? next) && (
        <div
          className="text-description truncate px-2 pb-1"
          title={(current ?? next)?.text}
        >
          {current ? "Now: " : "Next: "}
          {(current ?? next)?.text}
        </div>
      )}

      {open && (
        <div className="max-h-44 overflow-y-auto px-2 pb-1">
          {plan.steps.map((s, i) => (
            <div
              key={i}
              className={`flex min-w-0 gap-1.5 py-0.5 ${s.status === "in_progress" ? "font-semibold" : ""} ${s.status === "done" ? "opacity-70" : ""}`}
            >
              <span
                className="w-3 flex-shrink-0 text-center"
                style={{ color: GLYPH_COLOR[s.status] }}
              >
                {GLYPH[s.status]}
              </span>
              <div className="min-w-0 break-words">
                {s.text}
                {s.status === "blocked" && s.note && (
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
          {activity && (
            <div className="text-description border-border mt-1 break-words border-0 border-t border-solid pt-1">
              Currently working: {activity}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
