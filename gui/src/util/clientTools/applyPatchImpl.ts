import { planPatchFromIde } from "core/edit/applyPatch/planFromIde";
import { applyForEditTool } from "../../redux/thunks/handleApplyStateUpdate";
import { ClientToolImpl } from "./callClientTool";
import { startMultiFileApply } from "./multiFileApply";

export const applyPatchImpl: ClientToolImpl = async (
  args,
  toolCallId,
  extras,
) => {
  // Re-planned now (not reused from preprocessing): files may have changed
  // while the call was waiting for approval. Any failure aborts everything.
  const files = await planPatchFromIde(
    String(args.patch ?? ""),
    extras.ideMessenger.ide,
  );
  const first = startMultiFileApply(
    toolCallId,
    files.map((f) => ({ filepath: f.uri, text: f.content, label: f.label })),
  );
  void extras.dispatch(applyForEditTool(first));
  return { respondImmediately: false, output: undefined };
};
