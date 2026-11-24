import { ChatHistoryItem, ToolCallState } from "core";
import { BuiltInToolNames as T } from "core/tools/builtIn";
import type { RootState } from "../redux/store";
import { findLatestPlan, isChangeMade, lastUserIndex } from "./agentPlan";

/**
 * One short line saying what the agent is doing right now, built from the tool call in flight,
 * the plan step in progress, or the phase of the turn. No model call is involved, and nothing
 * is returned while the agent is idle.
 */

const short = (text: unknown, max = 48): string => {
  const t = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const base = (path: unknown): string => {
  const p = String(path ?? "").replace(/\/+$/, "");
  return p ? (p.split(/[\\/]/).pop() ?? p) : "";
};

function pick(
  args: Record<string, unknown> | undefined,
  keys: string[],
): string {
  for (const k of keys) {
    const v = args?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

const FILE_KEYS = ["filepath", "filePath", "path", "uri", "file", "dirPath"];
const QUERY_KEYS = ["query", "pattern", "regex", "text"];
const SYMBOL_KEYS = ["symbol", "name", "symbolName"];

export function describeToolCall(st: ToolCallState): string {
  const name = st.toolCall.function?.name;
  const args = (st.parsedArgs ?? {}) as Record<string, unknown>;
  const file = base(pick(args, FILE_KEYS));
  const query = short(pick(args, QUERY_KEYS));
  const symbol = short(pick(args, SYMBOL_KEYS) || file, 40);
  const of = (what: string, fallback: string) => (what ? `${what}` : fallback);

  switch (name) {
    case T.ReadFile:
    case T.ReadFileRange:
    case T.ReadCurrentlyOpenFile:
      return file ? `Reading ${file}` : "Reading implementation";
    case T.FileOutline:
      return file ? `Outlining ${file}` : "Reading implementation";
    case T.ReadSymbol:
      return `Reading ${of(symbol, "a symbol")}`;
    case T.LSTool:
    case T.ViewRepoMap:
    case T.ViewSubdirectory:
    case T.ProjectMap:
      return "Exploring project structure";
    case T.GrepSearch:
    case T.FileGlobSearch:
      return query ? `Searching for "${query}"` : "Searching for relevant code";
    case T.CodebaseTool:
      return query
        ? `Searching the codebase for "${query}"`
        : "Searching for relevant code";
    case T.FindDefinition:
    case T.GetTypeDefinition:
    case T.GetHoverInfo:
      return `Tracing the definition of ${of(symbol, "a symbol")}`;
    case T.FindReferences:
      return `Finding where ${of(symbol, "a symbol")} is used`;
    case T.GetImplementations:
    case T.GetCallHierarchy:
    case T.DependencyGraph:
      return "Understanding dependencies";
    case T.PrepareContext:
      return "Gathering the relevant context";
    case T.FindTests:
      return "Finding existing test patterns";
    case T.EditExistingFile:
    case T.SingleFindAndReplace:
    case T.MultiEdit:
    case T.ReplaceLines:
    case T.InsertLines:
      return file ? `Updating ${file}` : "Updating implementation";
    case T.CreateNewFile:
      return /(\.|_)(spec|test|e2e)\b/i.test(file) || /test/i.test(file)
        ? `Creating tests in ${file}`
        : file
          ? `Creating ${file}`
          : "Creating a file";
    case T.ApplyPatch:
      return "Applying changes";
    case T.RenameSymbol:
      return `Renaming ${of(symbol, "a symbol")}`;
    case T.ViewDiff:
      return "Reviewing modified files";
    case T.RunTerminalCommand:
      return `Running ${short(pick(args, ["command"]), 40) || "a command"}`;
    case T.RunTests:
      return "Running tests";
    case T.RunChecks:
      return "Running checks";
    case T.SearchWeb:
    case T.WebSearch:
      return "Searching the web";
    case T.FetchUrl:
    case T.FetchUrlContent:
      return "Reading a web page";
    case T.UpdatePlan:
      return "Updating the plan";
    case T.SaveTaskState:
    case T.UpdateProjectMemory:
      return "Saving task progress";
    case T.GetTaskState:
    case T.GetProjectMemory:
      return "Loading saved task context";
    case T.AskUser:
      return "Waiting for your answer";
    default:
      return `Using ${st.tool?.displayTitle ?? name}`;
  }
}

const IN_FLIGHT = new Set(["generating", "generated", "calling"]);

function lastToolState(items: ChatHistoryItem[]): ToolCallState | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const states = items[i].toolCallStates;
    if (states?.length) return states[states.length - 1];
  }
  return undefined;
}

/** The title to show while a response is streaming, or undefined when idle. */
export function selectActivityTitle(state: RootState): string | undefined {
  const { history, isStreaming } = state.session;
  if (!isStreaming || state.session.mode !== "agent") return undefined;

  const last = history.at(-1);
  const u = lastUserIndex(history);
  const turn = u >= 0 ? history.slice(u + 1) : history;

  const inFlight = (last?.toolCallStates ?? []).filter((st) =>
    IN_FLIGHT.has(st.status),
  );
  if (inFlight.length) return describeToolCall(inFlight[inFlight.length - 1]);

  const text =
    typeof last?.message.content === "string" ? last.message.content : "";
  if (text.trim()) return "Writing the response";

  const plan = findLatestPlan(turn.length ? turn : history);
  const active = plan?.steps.find((s) => s.status === "in_progress");
  if (active) return short(active.text, 80);

  const previous = lastToolState(turn);
  if (!previous) return "Analyzing the request";
  if (isChangeMade(previous)) return "Reviewing the changes";
  if (previous.toolCall.function?.name === T.UpdatePlan) {
    return plan?.steps.some((s) => s.status === "pending")
      ? "Starting the next step"
      : "Reviewing the changes";
  }
  return "Working out the next step";
}
