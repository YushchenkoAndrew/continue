import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

const ONLY_WHEN_ASKED = "Use only when the user asked for it.";

export const findTestsTool: Tool = {
  type: "function",
  displayTitle: "Find Tests",
  wouldLikeTo: "find tests",
  isCurrently: "finding tests",
  hasAlready: "found tests",
  readonly: true,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.FindTests,
    description: `Locate tests related to files or symbols (does not run them). ${ONLY_WHEN_ASKED}`,
    parameters: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" } },
        symbols: { type: "array", items: { type: "string" } },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};

export const runTestsTool: Tool = {
  type: "function",
  displayTitle: "Run Tests",
  wouldLikeTo: "run tests",
  isCurrently: "running tests",
  hasAlready: "ran tests",
  readonly: false,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.RunTests,
    description: `Run the project's tests (prefer specific files). Returns a condensed result and a logId for details. ${ONLY_WHEN_ASKED}`,
    parameters: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Test files to run" },
        name: { type: "string", description: "Test name filter" },
        logId: { type: "string", description: "Read a previous run's full log instead" },
        offset: { type: "number", description: "Log offset" },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  toolCallIcon: "PlayIcon",
};

export const runChecksTool: Tool = {
  type: "function",
  displayTitle: "Run Checks",
  wouldLikeTo: "run {{{ kind }}}",
  isCurrently: "running {{{ kind }}}",
  hasAlready: "ran {{{ kind }}}",
  readonly: false,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.RunChecks,
    description: `Run the project's typecheck, lint or build (prefer specific files). Returns errors with locations and a logId. ${ONLY_WHEN_ASKED}`,
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["typecheck", "lint", "build"] },
        files: { type: "array", items: { type: "string" }, description: "Limit to these files when supported" },
        logId: { type: "string", description: "Read a previous run's full log instead" },
        offset: { type: "number", description: "Log offset" },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  toolCallIcon: "PlayIcon",
};
