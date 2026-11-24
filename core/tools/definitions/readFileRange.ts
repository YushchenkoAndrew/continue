import { ToolPolicy } from "@continuedev/terminal-security";
import { Tool } from "../..";
import { ResolvedPath, resolveInputPath } from "../../util/pathResolver";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { evaluateFileAccessPolicy } from "../policies/fileAccess";

export const readFileRangeTool: Tool = {
  type: "function",
  displayTitle: "Read File Range",
  wouldLikeTo:
    "read lines {{{ startLine }}}-{{{ endLine }}} of {{{ filepath }}}",
  isCurrently:
    "reading lines {{{ startLine }}}-{{{ endLine }}} of {{{ filepath }}}",
  hasAlready:
    "read lines {{{ startLine }}}-{{{ endLine }}} of {{{ filepath }}}",
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ReadFileRange,
    description:
      "Read lines startLine-endLine of a file (1-based, numbered). Output is bounded; continue with the next startLine.",
    parameters: {
      type: "object",
      required: ["filepath", "startLine", "endLine"],
      properties: {
        filepath: {
          type: "string",
          description:
            "Path relative to the workspace root",
        },
        startLine: {
          type: "number",
          description:
            "First line (1-based)",
        },
        endLine: {
          type: "number",
          description:
            "Last line (1-based, >= startLine)",
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To read a line range, use ${BuiltInToolNames.ReadFileRange}:`,
    exampleArgs: [
      ["filepath", "path/to/the_file.txt"],
      ["startLine", 10],
      ["endLine", 20],
    ],
  },
  defaultToolPolicy: "allowedWithoutPermission",
  toolCallIcon: "DocumentIcon",
  preprocessArgs: async (args, { ide }) => {
    const filepath = args.filepath as string;
    const resolvedPath = await resolveInputPath(ide, filepath);

    return {
      resolvedPath,
    };
  },
  evaluateToolCallPolicy: (
    basePolicy: ToolPolicy,
    _: Record<string, unknown>,
    processedArgs?: Record<string, unknown>,
  ): ToolPolicy => {
    const resolvedPath = processedArgs?.resolvedPath as
      | ResolvedPath
      | null
      | undefined;
    if (!resolvedPath) return basePolicy;

    return evaluateFileAccessPolicy(basePolicy, resolvedPath.isWithinWorkspace);
  },
};
