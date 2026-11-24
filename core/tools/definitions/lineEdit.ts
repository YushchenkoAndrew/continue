import { Tool } from "../..";
import {
  applyInsertLines,
  applyReplaceLines,
} from "../../edit/lineEdits/lineEdits";
import { validateSearchAndReplaceFilepath } from "../../edit/searchAndReplace/validateArgs";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { NO_PARALLEL_TOOL_CALLING_INSTRUCTION } from "./editFile";

const common = {
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  isInstant: false,
  defaultToolPolicy: "allowedWithPermission" as const,
};

export const replaceLinesTool: Tool = {
  type: "function",
  displayTitle: "Replace Lines",
  wouldLikeTo:
    "edit lines {{{ startLine }}}-{{{ endLine }}} of {{{ filepath }}}",
  isCurrently:
    "editing lines {{{ startLine }}}-{{{ endLine }}} of {{{ filepath }}}",
  hasAlready:
    "edited lines {{{ startLine }}}-{{{ endLine }}} of {{{ filepath }}}",
  ...common,
  function: {
    name: BuiltInToolNames.ReplaceLines,
    description: `Replace lines startLine-endLine with newText (empty newText deletes). Use line numbers from the latest read; re-read after each edit. Send only the changed lines. ${NO_PARALLEL_TOOL_CALLING_INSTRUCTION}`,
    parameters: {
      type: "object",
      required: ["filepath", "startLine", "endLine", "newText"],
      properties: {
        filepath: {
          type: "string",
          description: "Path relative to workspace root",
        },
        startLine: {
          type: "number",
          description: "First line to replace (1-based)",
        },
        endLine: {
          type: "number",
          description: "Last line to replace (inclusive)",
        },
        newText: {
          type: "string",
          description: "Replacement text, without line-number prefixes",
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To replace a line range, use ${BuiltInToolNames.ReplaceLines}:`,
    exampleArgs: [
      ["filepath", "path/to/file.ts"],
      ["startLine", 10],
      ["endLine", 12],
      ["newText", "new code"],
    ],
  },
  preprocessArgs: async (args, extras) => {
    const fileUri = await validateSearchAndReplaceFilepath(
      args.filepath,
      extras.ide,
    );
    const editingFileContents = await extras.ide.readFile(fileUri);
    const newFileContents = applyReplaceLines(
      editingFileContents,
      args.startLine,
      args.endLine,
      String(args.newText ?? ""),
    );
    return { ...args, fileUri, editingFileContents, newFileContents };
  },
};

export const insertLinesTool: Tool = {
  type: "function",
  displayTitle: "Insert Lines",
  wouldLikeTo: "insert after line {{{ afterLine }}} of {{{ filepath }}}",
  isCurrently: "inserting after line {{{ afterLine }}} of {{{ filepath }}}",
  hasAlready: "inserted after line {{{ afterLine }}} of {{{ filepath }}}",
  ...common,
  function: {
    name: BuiltInToolNames.InsertLines,
    description: `Insert newText after line afterLine (0 = top of file). Use line numbers from the latest read. ${NO_PARALLEL_TOOL_CALLING_INSTRUCTION}`,
    parameters: {
      type: "object",
      required: ["filepath", "afterLine", "newText"],
      properties: {
        filepath: {
          type: "string",
          description: "Path relative to workspace root",
        },
        afterLine: {
          type: "number",
          description: "Insert after this line (0 = top)",
        },
        newText: {
          type: "string",
          description: "Text to insert, without line-number prefixes",
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To insert lines, use ${BuiltInToolNames.InsertLines}:`,
    exampleArgs: [
      ["filepath", "path/to/file.ts"],
      ["afterLine", 5],
      ["newText", "new code"],
    ],
  },
  preprocessArgs: async (args, extras) => {
    const fileUri = await validateSearchAndReplaceFilepath(
      args.filepath,
      extras.ide,
    );
    const editingFileContents = await extras.ide.readFile(fileUri);
    const newFileContents = applyInsertLines(
      editingFileContents,
      args.afterLine,
      String(args.newText ?? ""),
    );
    return { ...args, fileUri, editingFileContents, newFileContents };
  },
};
