import { UserGroupIcon as UserGroupOutline } from "@heroicons/react/24/outline";
import { UserGroupIcon as UserGroupSolid } from "@heroicons/react/24/solid";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { setCouncilEnabled } from "../../redux/slices/councilSlice";
import { ToolTip } from "../gui/Tooltip";
import HoverItem from "../mainInput/InputToolbar/HoverItem";

/** Opt-in switch: analyse the task with several agents before the agent starts. */
export function CouncilToggle() {
  const dispatch = useAppDispatch();
  const enabled = useAppSelector((s) => s.council.enabled);
  return (
    <ToolTip
      place="top"
      content={
        enabled
          ? "Council on: several agents plan and check before the agent starts"
          : "Council off: turn on to have several agents plan and check first"
      }
    >
      <HoverItem
        className="!p-0"
        onClick={() => dispatch(setCouncilEnabled(!enabled))}
      >
        {enabled ? (
          <UserGroupSolid
            className="h-3 w-3 brightness-200 hover:brightness-150"
            aria-label="Council on"
          />
        ) : (
          <UserGroupOutline
            className="h-3 w-3 hover:brightness-150"
            aria-label="Council off"
          />
        )}
      </HoverItem>
    </ToolTip>
  );
}
