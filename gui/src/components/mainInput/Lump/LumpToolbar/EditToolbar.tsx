import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useContext } from "react";
import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import { exitEdit } from "../../../../redux/thunks/edit";
import { getEditFilenameAndRangeText } from "../../util";

export function EditToolbar() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const mode = useAppSelector((state) => state.session.mode);
  const codeToEdit = useAppSelector(
    (state) => state.editModeState.codeToEdit[0],
  );

  const handleBackClick = async () => {
    void dispatch(exitEdit({}));
    ideMessenger.post("focusEditor", undefined);
  };

  const target = getEditFilenameAndRangeText(codeToEdit);

  // The back control never shrinks; the status label takes whatever width is left and
  // truncates, with the full text in the tooltip. min-w-0 lets both flex children and the
  // row itself go below their content width, so a long filename cannot widen the sidebar.
  return (
    <div className="text-description-muted flex w-full min-w-0 items-center justify-between gap-3 text-xs">
      <span
        className="flex shrink-0 cursor-pointer items-center whitespace-nowrap hover:brightness-125"
        onClick={handleBackClick}
      >
        <ArrowLeftIcon className="mr-1 h-2.5 w-2.5" />
        Back to {mode.charAt(0).toUpperCase() + mode.slice(1)}
      </span>
      <span className="min-w-0 truncate" title={`Editing: ${target}`}>
        Editing: <span className="italic">{target}</span>
      </span>
    </div>
  );
}
