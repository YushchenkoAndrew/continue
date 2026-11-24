import { PlusIcon } from "@heroicons/react/24/outline";
import { NEW_SESSION_TITLE } from "core/util/constants";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { selectSelectedChatModel } from "../redux/slices/configSlice";
import { saveCurrentSession } from "../redux/thunks/session";
import { ToolTip } from "./gui/Tooltip";

/**
 * Slim header for an ongoing conversation: its title, the model in use, and the same
 * "new session" action the view title offers. It never grows past one line, so it is safe in
 * the narrowest sidebar.
 */
export function ChatHeader() {
  const dispatch = useAppDispatch();
  const title = useAppSelector((s) => s.session.title);
  const hasHistory = useAppSelector((s) => s.session.history.length > 0);
  const isInEdit = useAppSelector((s) => s.session.isInEdit);
  const model = useAppSelector(selectSelectedChatModel);

  if (!hasHistory || isInEdit) return null;

  const label =
    title && title !== NEW_SESSION_TITLE ? title : "New conversation";
  const modelName = model?.title ?? model?.model ?? "";

  return (
    <div
      className="border-chat-border text-description flex min-w-0 shrink-0 items-center gap-2 border-0 border-b border-solid px-3 py-1 text-xs"
      data-testid="chat-header"
    >
      <span
        className="text-foreground min-w-0 flex-1 truncate font-medium"
        title={label}
      >
        {label}
      </span>
      {modelName && (
        <span
          className="xs:inline hidden min-w-0 max-w-[40%] truncate"
          title={modelName}
        >
          {modelName}
        </span>
      )}
      <ToolTip place="bottom" content="New session">
        <button
          type="button"
          aria-label="New session"
          className="text-description hover:text-foreground flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0.5"
          onClick={() =>
            void dispatch(
              saveCurrentSession({ openNewSession: true, generateTitle: true }),
            )
          }
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </ToolTip>
    </div>
  );
}
