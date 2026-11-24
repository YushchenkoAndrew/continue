import Spinner from "./gui/Spinner";
import { useAppSelector } from "../redux/hooks";
import { selectActivityTitle } from "../util/activityTitle";

/**
 * Shown only while a response is streaming and nothing else in the conversation shows what is
 * happening yet: no reasoning, no tool call, no answer text. It uses the same derived activity
 * title as the progress panel, so it needs no model output and costs no extra requests.
 */
export function LiveActivity() {
  const idle = useAppSelector((s) => {
    if (!s.session.isStreaming) return false;
    // the council panel shows its own live status
    if (s.council.run?.running) return false;
    const last = s.session.history.at(-1);
    if (!last) return false;
    if (last.message.role === "user") return true;
    if (last.message.role !== "assistant") return false;
    const c = last.message.content;
    const hasText = Array.isArray(c) ? c.length > 0 : !!c;
    return (
      !hasText && !last.toolCallStates?.length && !last.reasoning?.text?.trim()
    );
  });
  const title = useAppSelector(selectActivityTitle);

  if (!idle) return null;

  return (
    <div
      className="border-chat-border relative ml-[17px] mr-2 min-w-0 max-w-full border-0 border-l border-solid"
      data-testid="live-activity"
    >
      <div className="text-description relative flex min-w-0 items-center gap-2 py-1 pl-4 pr-1 text-xs">
        <span
          aria-hidden
          className="bg-border-focus ring-chat-border absolute -left-[3.5px] top-[10px] h-[7px] w-[7px] rounded-full ring-2"
        />
        <Spinner />
        <span className="min-w-0 truncate" title={title}>
          {title ?? "Waiting for the model"}
        </span>
      </div>
    </div>
  );
}
