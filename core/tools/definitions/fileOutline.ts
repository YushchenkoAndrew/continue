import { ToolPolicy } from "@continuedev/terminal-security";
import { Tool } from "../..";
import { ResolvedPath, resolveInputPath } from "../../util/pathResolver";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { evaluateFileAccessPolicy } from "../policies/fileAccess";

const preprocessArgs: Tool["preprocessArgs"] = async (args, { ide }) => ({
  resolvedPath: await resolveInputPath(ide, args.filepath as string),
});

const evaluateToolCallPolicy = (
  basePolicy: ToolPolicy,
  _: Record<string, unknown>,
  processedArgs?: Record<string, unknown>,
): ToolPolicy => {
  const resolvedPath = processedArgs?.resolvedPath as ResolvedPath | null | undefined;
  return resolvedPath
    ? evaluateFileAccessPolicy(basePolicy, resolvedPath.isWithinWorkspace)
    : basePolicy;
};

export const fileOutlineTool: Tool = {
  type: "function",
  displayTitle: "File Outline",
  wouldLikeTo: "outline {{{ filepath }}}",
  isCurrently: "outlining {{{ filepath }}}",
  hasAlready: "outlined {{{ filepath }}}",
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.FileOutline,
    description:
      "List classes/functions/methods of a file with line ranges. Use first on large files.",
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: { type: "string", description: "Path relative to workspace root" },
        query: { type: "string", description: "Optional name filter" },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To list the symbols of a file, use ${BuiltInToolNames.FileOutline}:`,
    exampleArgs: [["filepath", "path/to/file.ts"]],
  },
  defaultToolPolicy: "allowedWithoutPermission",
  toolCallIcon: "DocumentIcon",
  preprocessArgs,
  evaluateToolCallPolicy,
};

export const readSymbolTool: Tool = {
  type: "function",
  displayTitle: "Read Symbol",
  wouldLikeTo: "read {{{ symbol }}} in {{{ filepath }}}",
  isCurrently: "reading {{{ symbol }}} in {{{ filepath }}}",
  hasAlready: "read {{{ symbol }}} in {{{ filepath }}}",
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ReadSymbol,
    description:
      'Read one function/class/method by name (e.g. "Class.method"), with line numbers.',
    parameters: {
      type: "object",
      required: ["filepath", "symbol"],
      properties: {
        filepath: { type: "string", description: "Path relative to workspace root" },
        symbol: { type: "string", description: "Symbol name, or Class.method" },
        index: { type: "number", description: "Pick the Nth match when several" },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To read one function or class, use ${BuiltInToolNames.ReadSymbol}:`,
    exampleArgs: [
      ["filepath", "path/to/file.ts"],
      ["symbol", "MyClass.myMethod"],
    ],
  },
  defaultToolPolicy: "allowedWithoutPermission",
  toolCallIcon: "DocumentIcon",
  preprocessArgs,
  evaluateToolCallPolicy,
};
