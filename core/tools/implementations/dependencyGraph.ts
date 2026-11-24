import { ToolImpl } from ".";
import { ToolExtras } from "../..";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { resolvePosition } from "../languageIntel/position";
import {
  getProjectIndex,
  toFileUri,
  toRelative,
  Edge,
} from "../projectIndex/projectIndex";
import { readBudgetChars } from "./readBudget";

function clamp(v: unknown, def: number, min: number, max: number) {
  const n = typeof v === "string" ? parseInt(v, 10) : (v as number);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
}

function walk(
  start: string,
  next: (f: string) => Edge[],
  pick: (e: Edge) => string,
  depth: number,
  cap: number,
): { lines: string[]; total: number } {
  const seen = new Set([start]);
  const lines: string[] = [];
  let frontier = [start];
  let total = 0;
  for (let d = 1; d <= depth; d++) {
    const nextFrontier: string[] = [];
    for (const f of frontier) {
      for (const e of next(f)) {
        const other = pick(e);
        if (seen.has(other)) continue;
        seen.add(other);
        total++;
        if (lines.length < cap) {
          lines.push(
            `${"  ".repeat(d - 1)}${other}  [import at ${e.line > 0 ? `${e.from}:${e.line}` : e.from}]`,
          );
        }
        nextFrontier.push(other);
      }
    }
    frontier = nextFrontier;
  }
  return { lines, total };
}

async function symbolUsage(
  extras: ToolExtras,
  target: string,
  symbol: string,
  importers: string[],
  index: Awaited<ReturnType<typeof getProjectIndex>>,
): Promise<string> {
  const uri = toFileUri(index, target);
  const content = await extras.ide.readFile(uri);
  const pos = resolvePosition(content, target, { symbol });
  if (extras.ide.languageQuery) {
    const res = await extras.ide.languageQuery({
      kind: "references",
      filepath: uri,
      line: pos.line,
      character: pos.character,
    });
    if (res.supported && res.locations) {
      const byFile = new Map<string, number[]>();
      for (const l of res.locations) {
        const rel = toRelative(index, l.filepath);
        (byFile.get(rel) ?? byFile.set(rel, []).get(rel)!).push(l.line + 1);
      }
      const rows = [...byFile.entries()]
        .slice(0, 25)
        .map(
          ([f, ls]) =>
            `  ${f}: lines ${ls.slice(0, 6).join(",")}${ls.length > 6 ? ` (+${ls.length - 6})` : ""}`,
        );
      return `Uses of ${symbol} (verified by language provider, ${res.locations.length} refs in ${byFile.size} files):\n${rows.join("\n")}`;
    }
  }
  // Fallback: textual mention in importing files. Explicitly labelled as inferred.
  const rows: string[] = [];
  const re = new RegExp(
    `(?<![\\w$])${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`,
  );
  for (const f of importers.slice(0, 40)) {
    try {
      const lines = (await extras.ide.readFile(toFileUri(index, f))).split(
        /\r?\n/,
      );
      const hits = lines
        .map((l, i) => (re.test(l) ? i + 1 : 0))
        .filter(Boolean);
      if (hits.length) rows.push(`  ${f}: lines ${hits.slice(0, 6).join(",")}`);
    } catch {
      /* skip unreadable */
    }
  }
  return `Mentions of ${symbol} in importing files (INFERRED by text match, no language provider):\n${rows.join("\n") || "  none"}`;
}

export const dependencyGraphImpl: ToolImpl = async (args, extras) => {
  const index = await getProjectIndex(extras.ide);
  const target = toRelative(
    index,
    String(args?.target ?? args?.filepath ?? ""),
  );
  if (!target || !index.files.includes(target)) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `"${target}" is not a project file. Pass a path relative to the workspace root.`,
    );
  }
  const direction =
    args?.direction === "imports" || args?.direction === "importedBy"
      ? args.direction
      : "both";
  const depth = clamp(args?.depth, 1, 1, 3);
  const limit = clamp(args?.limit, 25, 1, 80);

  const out: string[] = [
    `${target}  (verified: resolved import statements; external packages are not graphed)`,
  ];
  if (direction !== "importedBy") {
    const r = walk(
      target,
      (f) => index.importsOf.get(f) ?? [],
      (e) => e.to,
      depth,
      limit,
    );
    out.push(
      `Imports (${r.total}):`,
      ...(r.lines.length
        ? r.lines.map((l) => `  ${l}`)
        : ["  (none inside the project)"]),
    );
    if (r.total > r.lines.length)
      out.push(
        `  [${r.total - r.lines.length} more; lower depth or raise limit]`,
      );
    const ext = index.externals.get(target);
    if (ext?.length)
      out.push(
        `External: ${ext.slice(0, 15).join(", ")}${ext.length > 15 ? ", …" : ""}`,
      );
  }
  let importers: string[] = [];
  if (direction !== "imports") {
    const r = walk(
      target,
      (f) => index.importedBy.get(f) ?? [],
      (e) => e.from,
      depth,
      limit,
    );
    importers = (index.importedBy.get(target) ?? []).map((e) => e.from);
    out.push(
      `Imported by (${r.total}):`,
      ...(r.lines.length
        ? r.lines.map((l) => `  ${l}`)
        : ["  (nothing imports it)"]),
    );
    if (r.total > r.lines.length)
      out.push(
        `  [${r.total - r.lines.length} more; lower depth or raise limit]`,
      );
  }
  if (typeof args?.symbol === "string" && args.symbol.trim()) {
    try {
      out.push(
        await symbolUsage(extras, target, args.symbol.trim(), importers, index),
      );
    } catch (e) {
      out.push(
        `Symbol usage unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (index.truncated)
    out.push("[note: graph covers only the shallowest 4000 source files]");

  let text = out.join("\n");
  const max = readBudgetChars(
    extras.config.selectedModelByRole.chat?.contextLength,
  );
  if (text.length > max) text = text.slice(0, max) + "\n…[truncated]";
  return [
    {
      name: "Dependency graph",
      description: `Dependencies of ${target}`,
      content: text,
    },
  ];
};
