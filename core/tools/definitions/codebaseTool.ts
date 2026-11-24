import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const codebaseTool: Tool = {
  type: "function",
  displayTitle: "Codebase Search",
  wouldLikeTo: "search the codebase for: {{{ query }}}",
  isCurrently: "searching the codebase for: {{{ query }}}",
  hasAlready: "searched the codebase for: {{{ query }}}",
  readonly: true,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.CodebaseTool,
    description:
      "Semantic search over the indexed codebase. Prefer this to grep for finding where something is done. Returns snippets with paths.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "What to find, e.g. 'user authentication logic'",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To search the codebase, use the ${BuiltInToolNames.CodebaseTool} tool with a natural language query. For example, to find authentication logic, you might respond with:`,
    exampleArgs: [
      ["query", "How is user authentication handled in this codebase?"],
    ],
  },
};
