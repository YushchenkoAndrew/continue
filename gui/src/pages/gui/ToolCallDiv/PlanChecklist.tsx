import { ToolCallState } from "core";
import { useMemo } from "react";
import {
  normalizeStatus,
  parseChecklist,
  planProgress,
  PlanStep,
} from "core/tools/memory/plan";
import { getStatusIcon } from "./utils";

const GLYPH: Record<PlanStep["status"], string> = {
  pending: "☐",
  in_progress: "◐",
  done: "☑",
  blocked: "⊘",
};

/**
 * Checklist for update_plan. The result of the call (the persisted plan) is authoritative;
 * while the call is still streaming/running it falls back to the steps in the arguments.
 */
export function PlanChecklist({
  toolCallState,
}: {
  toolCallState: ToolCallState;
}) {
  const steps = useMemo<PlanStep[]>(() => {
    const fromOutput = parseChecklist(toolCallState.output?.[0]?.content ?? "");
    if (fromOutput) return fromOutput.steps;
    const raw = toolCallState.parsedArgs?.steps;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s: any) => s && typeof s.text === "string")
      .map((s: any) => ({
        text: s.text,
        status: normalizeStatus(s.status) ?? "pending",
      }));
  }, [toolCallState.output, toolCallState.parsedArgs]);

  const objective = toolCallState.parsedArgs?.objective;
  if (steps.length === 0) {
    return null;
  }
  const { done, total } = planProgress(steps);

  return (
    <div className="text-description flex flex-col gap-1 px-3 py-2 text-xs">
      <div className="flex items-center gap-1 font-semibold">
        {getStatusIcon(toolCallState.status)}
        <span>
          Progress: {done}/{total}
        </span>
        {typeof objective === "string" && objective && (
          <span className="truncate font-normal opacity-80">— {objective}</span>
        )}
      </div>
      {steps.map((s, i) => (
        <div
          key={i}
          className={`flex gap-1.5 ${s.status === "done" ? "line-through opacity-60" : ""} ${s.status === "in_progress" ? "font-semibold" : ""}`}
        >
          <span className="w-4 flex-shrink-0">{GLYPH[s.status]}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{s.text}</span>
        </div>
      ))}
    </div>
  );
}
