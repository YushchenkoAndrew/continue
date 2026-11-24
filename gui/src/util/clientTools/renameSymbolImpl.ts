import { ContinueError, ContinueErrorReason } from "core/util/errors";
import { validateSearchAndReplaceFilepath } from "core/edit/searchAndReplace/validateArgs";
import { resolvePosition } from "core/tools/languageIntel/position";
import { applyTextEdits } from "core/tools/languageIntel/textEdits";
import { applyForEditTool } from "../../redux/thunks/handleApplyStateUpdate";
import { ClientToolImpl } from "./callClientTool";
import { startMultiFileApply } from "./multiFileApply";

const MAX_FILES = 40;

export const renameSymbolImpl: ClientToolImpl = async (
  args,
  toolCallId,
  extras,
) => {
  const ide = extras.ideMessenger.ide;
  if (!ide.languageQuery) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "Rename is not available in this IDE.",
    );
  }
  const newName = String(args.newName ?? "").trim();
  if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(newName)) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `"${newName}" is not a valid identifier.`,
    );
  }
  const uri = await validateSearchAndReplaceFilepath(args.filepath, ide);
  const content = await ide.readFile(uri);
  const pos = resolvePosition(content, String(args.filepath), args);

  const res = await ide.languageQuery({
    kind: "rename",
    filepath: uri,
    line: pos.line,
    character: pos.character,
    newName,
  });
  if (!res.supported || !res.edits) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `${res.message ?? "Rename is not supported here."} Nothing was changed.`,
    );
  }
  if (res.edits.length === 0) {
    return {
      respondImmediately: true,
      output: [
        { name: "Rename", description: "Rename", content: "The provider produced no changes." },
      ],
    };
  }
  if (res.edits.length > MAX_FILES) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Rename touches ${res.edits.length} files (limit ${MAX_FILES}); nothing was changed. Rename manually in the editor.`,
    );
  }

  const files = [];
  for (const fileEdit of res.edits) {
    const current = await ide.readFile(fileEdit.filepath);
    files.push({
      filepath: fileEdit.filepath,
      text: applyTextEdits(current, fileEdit.edits),
      label: `${fileEdit.filepath.split("/").pop()} (${fileEdit.edits.length} change${fileEdit.edits.length === 1 ? "" : "s"})`,
    });
  }
  void extras.dispatch(applyForEditTool(startMultiFileApply(toolCallId, files)));
  return { respondImmediately: false, output: undefined };
};
