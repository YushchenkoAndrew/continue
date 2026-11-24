import { useEffect, useState } from "react";
import { useAppSelector } from "../../../../redux/hooks";
import { selectActivityTitle } from "../../../../util/activityTitle";
import { getAltKeyLabel, getMetaKeyLabel, isJetBrains } from "../../../../util";
import { GeneratingIndicator } from "./GeneratingIndicator";

// Seconds the current request has produced nothing, or undefined once output has started.
// Purely local: it only looks at the chat state, so waiting for a local model that is still
// loading costs no extra requests.
function useSecondsWaitingForModel(): number | undefined {
  const waiting = useAppSelector((state) => {
    if (!state.session.isStreaming) {
      return false;
    }
    const last = state.session.history.at(-1);
    if (!last || last.isGatheringContext || last.reasoning) {
      return false;
    }
    const message = last.message;
    if (message.role !== "assistant") {
      return false;
    }
    const hasText = Array.isArray(message.content)
      ? message.content.length > 0
      : !!message.content;
    return (
      !hasText && !message.toolCalls?.length && !last.toolCallStates?.length
    );
  });
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!waiting) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [waiting]);

  return waiting ? seconds : undefined;
}

const SHOW_WAITING_AFTER_SECONDS = 4;

interface StreamingToolbarProps {
  onStop: () => void;
  displayText?: string;
}

export function StreamingToolbar({
  onStop,
  displayText = "Stop",
}: StreamingToolbarProps) {
  const jetbrains = isJetBrains();
  const waited = useSecondsWaitingForModel();
  const activity = useAppSelector(selectActivityTitle);
  const label = activity ?? "Generating";
  const text =
    waited !== undefined && waited >= SHOW_WAITING_AFTER_SECONDS
      ? `${label} · waiting for the model (${waited}s)`
      : label;

  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-2">
      <GeneratingIndicator text={text} />
      <div
        onClick={onStop}
        className="text-2xs shrink-0 cursor-pointer whitespace-nowrap px-1.5 py-0.5 hover:brightness-125"
      >
        <span className="text-description">{displayText}</span>
        {/* JetBrains overrides cmd+backspace, so we have to use another shortcut */}
        <span className="text-description-muted ml-1 opacity-75">
          {jetbrains ? getAltKeyLabel() : getMetaKeyLabel()}⌫
        </span>
      </div>
    </div>
  );
}
