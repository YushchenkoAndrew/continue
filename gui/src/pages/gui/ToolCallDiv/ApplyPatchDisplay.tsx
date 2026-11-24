import { useMemo } from "react";
import { getStatusIcon } from "./utils";
import { useAppSelector } from "../../../redux/hooks";
import { selectToolCallById } from "../../../redux/selectors/selectToolCalls";

/** Lists the files and ranges a multi-file edit will touch; diffs open per file in the editor. */
export function ApplyPatchDisplay({
  toolCallId,
  summary,
  patch,
}: {
  toolCallId: string;
  summary?: string[];
  patch?: string;
}) {
  const toolCallState = useAppSelector((s) => selectToolCallById(s, toolCallId));
  const lines = useMemo(() => {
    if (summary?.length) return summary;
    // While streaming, show the files named so far
    return (patch ?? "")
      .split("\n")
      .filter((l) => /^\*\*\* (Update|Add) File:/.test(l))
      .map((l) => l.replace(/^\*\*\* /, ""));
  }, [summary, patch]);

  return (
    <div className="text-description flex flex-col gap-1 px-3 py-2 text-xs">
      <div className="flex items-center gap-1">
        {toolCallState && getStatusIcon(toolCallState.status)}
        <span>Patch affecting {lines.length} file(s). Review each diff in the editor.</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="font-mono">
          {l}
        </div>
      ))}
    </div>
  );
}
