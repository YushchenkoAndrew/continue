import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const webSearchTool: Tool = {
  type: "function",
  displayTitle: "Web Search",
  wouldLikeTo: "search the web for: {{{ query }}}",
  isCurrently: "searching the web for: {{{ query }}}",
  hasAlready: "searched the web for: {{{ query }}}",
  readonly: true,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.WebSearch,
    description:
      "Search the web only when the project and your knowledge are not enough (unknown API/error, current versions). Short keyword queries, never code or secrets. Use domains for official docs and library for the installed version.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Short keywords or an error message",
        },
        domains: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these sites, e.g. docs.nestjs.com",
        },
        library: {
          type: "string",
          description: "Dependency name: adds its installed version",
        },
        limit: { type: "number", description: "Results (default 5)" },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  toolCallIcon: "GlobeAltIcon",
};

export const fetchUrlTool: Tool = {
  type: "function",
  displayTitle: "Fetch URL",
  wouldLikeTo: "fetch {{{ url }}}",
  isCurrently: "fetching {{{ url }}}",
  hasAlready: "fetched {{{ url }}}",
  readonly: true,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.FetchUrl,
    description:
      "Read one public documentation page as text (http/https only, no local or private addresses). Output is bounded; continue with offset.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        offset: {
          type: "number",
          description: "Character offset to continue from",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  toolCallIcon: "GlobeAltIcon",
};
