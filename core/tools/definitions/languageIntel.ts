import { ToolPolicy } from "@continuedev/terminal-security";
import { Tool } from "../..";
import { ResolvedPath, resolveInputPath } from "../../util/pathResolver";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { evaluateFileAccessPolicy } from "../policies/fileAccess";

const POSITION_PROPS = {
  filepath: { type: "string", description: "Path relative to workspace root" },
  symbol: { type: "string", description: "Symbol name at the position" },
  line: { type: "number", description: "1-based line (use with symbol)" },
  column: { type: "number", description: "1-based column (optional)" },
} as const;

const PAGE_PROPS = {
  limit: { type: "number", description: "Max results (default 20)" },
  offset: { type: "number", description: "Skip this many results" },
} as const;

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

function langTool(
  name: BuiltInToolNames,
  title: string,
  description: string,
  extraProps: Record<string, unknown> = {},
  paged = true,
): Tool {
  return {
    type: "function",
    displayTitle: title,
    wouldLikeTo: `${title.toLowerCase()}: {{{ symbol }}} in {{{ filepath }}}`,
    isCurrently: `${title.toLowerCase()}: {{{ symbol }}} in {{{ filepath }}}`,
    hasAlready: `${title.toLowerCase()}: {{{ symbol }}} in {{{ filepath }}}`,
    readonly: true,
    isInstant: false,
    group: BUILT_IN_GROUP_NAME,
    function: {
      name,
      description,
      parameters: {
        type: "object",
        required: ["filepath"],
        properties: { ...POSITION_PROPS, ...extraProps, ...(paged ? PAGE_PROPS : {}) },
      },
    },
    systemMessageDescription: {
      prefix: `To use ${name}:`,
      exampleArgs: [
        ["filepath", "path/to/file.ts"],
        ["symbol", "myFunction"],
        ["line", 42],
      ],
    },
    defaultToolPolicy: "allowedWithoutPermission",
    toolCallIcon: "MagnifyingGlassIcon",
    preprocessArgs,
    evaluateToolCallPolicy,
  };
}

export const findDefinitionTool = langTool(
  BuiltInToolNames.FindDefinition,
  "Find Definition",
  "Where a symbol is defined, via the language server. Prefer to grep.",
  {},
  false,
);
export const findReferencesTool = langTool(
  BuiltInToolNames.FindReferences,
  "Find References",
  "All references to a symbol across the workspace, via the language server. Paginated.",
);
export const getTypeDefinitionTool = langTool(
  BuiltInToolNames.GetTypeDefinition,
  "Get Type Definition",
  "Where the type of a symbol is defined.",
  {},
  false,
);
export const getImplementationsTool = langTool(
  BuiltInToolNames.GetImplementations,
  "Get Implementations",
  "Implementations of an interface, abstract class or abstract method.",
);
export const getHoverInfoTool = langTool(
  BuiltInToolNames.GetHoverInfo,
  "Get Hover Info",
  "Type, signature and docs of a symbol, as shown on hover.",
  {},
  false,
);
export const getCallHierarchyTool = langTool(
  BuiltInToolNames.GetCallHierarchy,
  "Get Call Hierarchy",
  "Callers and/or callees of a function or method.",
  {
    direction: {
      type: "string",
      enum: ["incoming", "outgoing", "both"],
      description: "Default both",
    },
  },
);

export const renameSymbolTool: Tool = {
  type: "function",
  displayTitle: "Rename Symbol",
  wouldLikeTo: "rename {{{ symbol }}} to {{{ newName }}}",
  isCurrently: "renaming {{{ symbol }}} to {{{ newName }}}",
  hasAlready: "renamed {{{ symbol }}} to {{{ newName }}}",
  readonly: false,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.RenameSymbol,
    description:
      "Rename a symbol everywhere via the language server. Every changed file opens in diff review before anything is written.",
    parameters: {
      type: "object",
      required: ["filepath", "newName"],
      properties: {
        ...POSITION_PROPS,
        newName: { type: "string", description: "New identifier" },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To rename a symbol everywhere, use ${BuiltInToolNames.RenameSymbol}:`,
    exampleArgs: [
      ["filepath", "path/to/file.ts"],
      ["symbol", "oldName"],
      ["line", 10],
      ["newName", "newName"],
    ],
  },
  defaultToolPolicy: "allowedWithPermission",
};
