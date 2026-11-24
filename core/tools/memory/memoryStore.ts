/**
 * Project memory + task state as plain markdown in <workspace>/.continue/memory/.
 * Human-readable, editable and deletable; the agent reads it only on demand.
 */

export const PROJECT_SECTIONS = [
  "architecture",
  "conventions",
  "dependencies",
  "decisions",
  "limitations",
] as const;
export const TASK_SECTIONS = [
  "objective",
  "done",
  "findings",
  "files",
  "decisions",
  "remaining",
] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];
export type TaskSection = (typeof TASK_SECTIONS)[number];

export const MAX_ENTRIES_PER_SECTION = 25;
export const MAX_ENTRY_CHARS = 300;
export const MAX_FILE_CHARS = 6000;

export interface Entry {
  status: "verified" | "assumed" | "";
  text: string;
}
export type Doc = Record<string, Entry[]>;

const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\b(api[_-]?key|secret|token|passw(or)?d|pwd|credential)s?\b\s*[:=]\s*["']?[^\s"']{6,}/i,
  /\b[A-Fa-f0-9]{40,}\b/,
  /\b[A-Za-z0-9+/]{48,}={0,2}/,
];

export function validateEntryText(text: string): string | undefined {
  const t = text.trim();
  if (!t) return "text is empty.";
  if (SECRET_PATTERNS.some((r) => r.test(t))) {
    return "text looks like a credential or secret; secrets are never stored.";
  }
  if (
    t.includes("```") ||
    t.split("\n").length > 3 ||
    t.length > MAX_ENTRY_CHARS
  ) {
    return `entries must be short facts (max ${MAX_ENTRY_CHARS} chars, no code blocks or file contents). Store a pointer (path/symbol) instead.`;
  }
  return undefined;
}

export function parseDoc(markdown: string, sections: readonly string[]): Doc {
  const doc: Doc = Object.fromEntries(sections.map((s) => [s, [] as Entry[]]));
  let current: string | undefined;
  for (const raw of markdown.split(/\r?\n/)) {
    const h = raw.match(/^##\s+(.+?)\s*$/);
    if (h) {
      const name = h[1].toLowerCase();
      current = sections.includes(name) ? name : undefined;
      continue;
    }
    if (!current) continue;
    const m = raw.match(/^\s*-\s+(?:\[(verified|assumed)\]\s+)?(.+?)\s*$/);
    if (m)
      doc[current].push({
        status: (m[1] as Entry["status"]) ?? "",
        text: m[2],
      });
  }
  return doc;
}

export function renderDoc(
  title: string,
  doc: Doc,
  sections: readonly string[],
  hint: string,
): string {
  const parts = [`# ${title}`, `<!-- ${hint} Edit or delete freely. -->`, ""];
  for (const s of sections) {
    const entries = doc[s] ?? [];
    if (entries.length === 0) continue;
    parts.push(`## ${s}`);
    for (const e of entries)
      parts.push(`- ${e.status ? `[${e.status}] ` : ""}${e.text}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd() + "\n";
}

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}_./-]+/u)
      .filter((w) => w.length > 2),
  );
}

export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

export type MemoryOp = "add" | "update" | "remove";

/** Apply one change to a section. Returns a human-readable result; throws Error for user-facing problems. */
export function applyMemoryOp(
  doc: Doc,
  section: string,
  op: MemoryOp,
  text: string | undefined,
  status: Entry["status"],
  match: string | undefined,
): string {
  const list = doc[section];
  if (!list) throw new Error(`Unknown section "${section}".`);

  const findMatch = (): number => {
    const needle = (match ?? text ?? "").toLowerCase();
    if (!needle) throw new Error("`match` is required for update/remove.");
    const hits = list
      .map((e, i) => (e.text.toLowerCase().includes(needle) ? i : -1))
      .filter((i) => i >= 0);
    if (hits.length === 0)
      throw new Error(`No entry in ${section} contains "${needle}".`);
    if (hits.length > 1) {
      throw new Error(
        `"${needle}" matches ${hits.length} entries in ${section}; use a more specific match:\n${hits
          .slice(0, 5)
          .map((i) => `- ${list[i].text.slice(0, 80)}`)
          .join("\n")}`,
      );
    }
    return hits[0];
  };

  if (op === "remove") {
    const i = findMatch();
    const [gone] = list.splice(i, 1);
    return `Removed from ${section}: ${gone.text.slice(0, 80)}`;
  }
  if (!text) throw new Error("`text` is required for add/update.");
  const problem = validateEntryText(text);
  if (problem) throw new Error(problem);

  if (op === "update") {
    const i = findMatch();
    list[i] = { status: status || list[i].status, text: text.trim() };
    return `Updated ${section}.`;
  }
  // add: fold near-duplicates into the existing entry instead of accumulating
  const dup = list.findIndex((e) => similarity(e.text, text) >= 0.7);
  if (dup >= 0) {
    list[dup] = { status: status || list[dup].status, text: text.trim() };
    return `Merged with an existing similar entry in ${section}.`;
  }
  if (list.length >= MAX_ENTRIES_PER_SECTION) {
    throw new Error(
      `${section} is full (${MAX_ENTRIES_PER_SECTION} entries). Remove or merge outdated entries first.`,
    );
  }
  list.push({ status: status || "assumed", text: text.trim() });
  return `Added to ${section}.`;
}

export function memoryPaths(rootUri: string) {
  const base = `${rootUri.replace(/\/$/, "")}/.continue/memory`;
  return { project: `${base}/project.md`, task: `${base}/task.md` };
}
