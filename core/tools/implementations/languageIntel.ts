import { ToolImpl } from ".";
import {
  LanguageQuery,
  LanguageQueryCall,
  LanguageQueryLocation,
  ToolExtras,
} from "../..";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { resolveInputPath } from "../../util/pathResolver";
import { findUriInDirs } from "../../util/uri";
import { getStringArg } from "../parseArgs";
import { resolvePosition } from "../languageIntel/position";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const NO_PROVIDER_HINT =
  "Do not retry this tool for this file; fall back to grep_search or codebase.";

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "string" ? parseInt(v, 10) : (v as number);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
}

async function relPath(uri: string, extras: ToolExtras): Promise<string> {
  try {
    const dirs = await extras.ide.getWorkspaceDirs();
    return findUriInDirs(uri, dirs).relativePathOrBasename;
  } catch {
    return uri;
  }
}

/** Reads each file at most once while formatting results. */
class LineReader {
  private cache = new Map<string, string[] | null>();
  constructor(private extras: ToolExtras) {}
  async line(uri: string, line: number): Promise<string> {
    let lines = this.cache.get(uri);
    if (lines === undefined) {
      try {
        lines = (await this.extras.ide.readFile(uri)).split(/\r?\n/);
      } catch {
        lines = null;
      }
      this.cache.set(uri, lines);
    }
    const t = lines?.[line]?.trim() ?? "";
    return t.length > 110 ? t.slice(0, 110) + "…" : t;
  }
}

async function prepare(args: any, extras: ToolExtras) {
  if (!extras.ide.languageQuery) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Language intelligence is not available in this IDE. ${NO_PROVIDER_HINT}`,
    );
  }
  const filepath = getStringArg(args, "filepath");
  const resolved = await resolveInputPath(extras.ide, filepath);
  if (!resolved) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File "${filepath}" does not exist or is not accessible.`,
    );
  }
  throwIfFileIsSecurityConcern(resolved.displayPath);
  const content = await extras.ide.readFile(resolved.uri);
  const pos = resolvePosition(content, resolved.displayPath, args);
  return { uri: resolved.uri, pos, display: resolved.displayPath };
}

async function formatLocations(
  locations: LanguageQueryLocation[],
  extras: ToolExtras,
  offset: number,
  limit: number,
): Promise<string> {
  const reader = new LineReader(extras);
  const sorted = [...locations].sort(
    (a, b) => a.filepath.localeCompare(b.filepath) || a.line - b.line,
  );
  const page = sorted.slice(offset, offset + limit);
  const rows: string[] = [];
  for (const loc of page) {
    const text = await reader.line(loc.filepath, loc.line);
    rows.push(
      `${await relPath(loc.filepath, extras)}:${loc.line + 1}:${loc.character + 1}  ${text}`,
    );
  }
  const end = offset + page.length;
  const footer =
    end < sorted.length
      ? `\n[showing ${offset + 1}-${end} of ${sorted.length}; pass offset=${end} for more]`
      : sorted.length > limit || offset > 0
        ? `\n[showing ${offset + 1}-${end} of ${sorted.length}]`
        : "";
  return rows.join("\n") + footer;
}

function result(name: string, content: string) {
  return [{ name, description: name, content }];
}

function makeLocationTool(
  kind: LanguageQuery["kind"],
  label: string,
): ToolImpl {
  return async (args, extras) => {
    const { uri, pos, display } = await prepare(args, extras);
    const res = await extras.ide.languageQuery!({
      kind,
      filepath: uri,
      line: pos.line,
      character: pos.character,
    });
    if (!res.supported) {
      return result(
        label,
        `${res.message ?? "Not supported."} ${NO_PROVIDER_HINT}`,
      );
    }
    const locs = res.locations ?? [];
    if (locs.length === 0) {
      return result(
        label,
        `No ${label.toLowerCase()} found for ${display}:${pos.line + 1}:${pos.character + 1}. ${res.message ?? ""}`.trim(),
      );
    }
    const limit = clampInt(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(args.offset, 0, 0, 100000);
    return result(
      label,
      `${locs.length} result(s), verified by the language provider:\n${await formatLocations(locs, extras, offset, limit)}`,
    );
  };
}

export const findDefinitionImpl = makeLocationTool("definition", "Definition");
export const findReferencesImpl = makeLocationTool("references", "References");
export const getTypeDefinitionImpl = makeLocationTool(
  "typeDefinition",
  "Type definition",
);
export const getImplementationsImpl = makeLocationTool(
  "implementations",
  "Implementations",
);

export const getHoverInfoImpl: ToolImpl = async (args, extras) => {
  const { uri, pos } = await prepare(args, extras);
  const res = await extras.ide.languageQuery!({
    kind: "hover",
    filepath: uri,
    line: pos.line,
    character: pos.character,
  });
  if (!res.supported) {
    return result(
      "Hover",
      `${res.message ?? "Not supported."} ${NO_PROVIDER_HINT}`,
    );
  }
  const text = res.hover ?? res.message ?? "No hover information.";
  return result(
    "Hover",
    text.length > 1800 ? text.slice(0, 1800) + "\n…[truncated]" : text,
  );
};

async function formatCalls(
  calls: LanguageQueryCall[],
  arrow: string,
  extras: ToolExtras,
  limit: number,
): Promise<string> {
  const rows: string[] = [];
  for (const c of calls.slice(0, limit)) {
    const where = `${await relPath(c.location.filepath, extras)}:${c.location.line + 1}`;
    const sites = c.callSites
      .slice(0, 4)
      .map((s) => s.line + 1)
      .join(",");
    rows.push(
      `${arrow} ${c.name} (${c.kind}) ${where}${sites ? ` [call lines: ${sites}]` : ""}`,
    );
  }
  if (calls.length > limit)
    rows.push(`[${calls.length - limit} more not shown; pass a larger limit]`);
  return rows.join("\n");
}

export const getCallHierarchyImpl: ToolImpl = async (args, extras) => {
  const { uri, pos } = await prepare(args, extras);
  const direction =
    args.direction === "incoming" || args.direction === "outgoing"
      ? args.direction
      : "both";
  const limit = clampInt(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const sections: string[] = [];
  for (const dir of ["incoming", "outgoing"] as const) {
    if (direction !== "both" && direction !== dir) continue;
    const res = await extras.ide.languageQuery!({
      kind: dir === "incoming" ? "incomingCalls" : "outgoingCalls",
      filepath: uri,
      line: pos.line,
      character: pos.character,
    });
    if (!res.supported) {
      return result(
        "Call hierarchy",
        `${res.message ?? "Not supported."} ${NO_PROVIDER_HINT}`,
      );
    }
    const calls = res.calls ?? [];
    sections.push(
      `${dir === "incoming" ? "Callers" : "Callees"} (${calls.length}):\n` +
        (calls.length
          ? await formatCalls(
              calls,
              dir === "incoming" ? "←" : "→",
              extras,
              limit,
            )
          : "(none)"),
    );
  }
  return result("Call hierarchy", sections.join("\n"));
};
