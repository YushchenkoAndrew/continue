import {
  applyInsertLines,
  applyReplaceLines,
} from "core/edit/lineEdits/lineEdits";
import { validateSearchAndReplaceFilepath } from "core/edit/searchAndReplace/validateArgs";
import { v4 as uuid } from "uuid";
import { applyForEditTool } from "../../redux/thunks/handleApplyStateUpdate";
import { ClientToolImpl } from "./callClientTool";

async function applyLineEdit(
  args: any,
  toolCallId: string,
  extras: Parameters<ClientToolImpl>[2],
  compute: (current: string) => string,
) {
  // Recomputed at call time: the file may have changed while the call was pending.
  const fileUri = await validateSearchAndReplaceFilepath(
    args.filepath,
    extras.ideMessenger.ide,
  );
  const current = await extras.ideMessenger.ide.readFile(fileUri);
  const text = compute(current);
  void extras.dispatch(
    applyForEditTool({
      streamId: uuid(),
      toolCallId,
      text,
      filepath: fileUri,
      isSearchAndReplace: true,
    }),
  );
  return { respondImmediately: false, output: undefined };
}

export const replaceLinesImpl: ClientToolImpl = (args, toolCallId, extras) =>
  applyLineEdit(args, toolCallId, extras, (current) =>
    applyReplaceLines(
      current,
      args.startLine,
      args.endLine,
      String(args.newText ?? ""),
    ),
  );

export const insertLinesImpl: ClientToolImpl = (args, toolCallId, extras) =>
  applyLineEdit(args, toolCallId, extras, (current) =>
    applyInsertLines(current, args.afterLine, String(args.newText ?? "")),
  );
