import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

const base = {
  type: "function" as const,
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  isInstant: false,
  defaultToolPolicy: "allowedWithoutPermission" as const,
  toolCallIcon: "FolderOpenIcon" as const,
};

export const projectMapTool: Tool = {
  ...base,
  displayTitle: "Project Map",
  wouldLikeTo: "map the project",
  isCurrently: "mapping the project",
  hasAlready: "mapped the project",
  function: {
    name: BuiltInToolNames.ProjectMap,
    description:
      "Compact project overview: directories, manifests, entry points, most-imported files, module relationships. Cached.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional directory to zoom into",
        },
      },
    },
  },
};

export const dependencyGraphTool: Tool = {
  ...base,
  displayTitle: "Dependency Graph",
  wouldLikeTo: "check dependencies of {{{ target }}}",
  isCurrently: "checking dependencies of {{{ target }}}",
  hasAlready: "checked dependencies of {{{ target }}}",
  function: {
    name: BuiltInToolNames.DependencyGraph,
    description:
      "What a file imports and what imports it (verified from import statements, with line numbers). Optional symbol shows where it is used.",
    parameters: {
      type: "object",
      required: ["target"],
      properties: {
        target: {
          type: "string",
          description: "File path relative to workspace root",
        },
        direction: { type: "string", enum: ["imports", "importedBy", "both"] },
        depth: { type: "number", description: "1-3 (default 1)" },
        symbol: {
          type: "string",
          description: "Optional symbol exported by target",
        },
        limit: { type: "number", description: "Max rows (default 25)" },
      },
    },
  },
};

export const prepareContextTool: Tool = {
  ...base,
  displayTitle: "Prepare Context",
  wouldLikeTo: "gather context for the task",
  isCurrently: "gathering context for the task",
  hasAlready: "gathered context for the task",
  function: {
    name: BuiltInToolNames.PrepareContext,
    description:
      "Start here before a non-trivial change: finds relevant files, symbols, dependencies, tests and conventions for the task. Returns paths and locations, not code.",
    parameters: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string", description: "What you need to do" },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Optional known files",
        },
        symbols: {
          type: "array",
          items: { type: "string" },
          description: "Optional known symbols",
        },
      },
    },
  },
};
