/**
 * Context-anchored multi-file patch engine (pure, no IDE access).
 *
 *   *** Begin Patch
 *   *** Update File: src/a.ts
 *   @@ optional anchor text (e.g. the enclosing function signature)
 *    unchanged context line
 *   -removed line
 *   +added line
 *   *** Add File: src/new.ts
 *   +first line
 *   *** End Patch
 *
 * Hunks are located by their context/removed lines, never by line numbers.
 * Ambiguous, stale or overlapping hunks make the whole patch fail.
 */

export interface Hunk {
  anchor?: string;
  old: string[]; // context + removed lines, in order
  next: string[]; // context + added lines, in order
}

export type FilePatch =
  | { kind: "update"; path: string; hunks: Hunk[] }
  | { kind: "add"; path: string; lines: string[] };

export class PatchError extends Error {}

export function parsePatch(text: string): FilePatch[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i]?.trim() !== "*** Begin Patch") {
    throw new PatchError('Patch must start with "*** Begin Patch".');
  }
  i++;
  const files: FilePatch[] = [];
  let ended = false;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "*** End Patch") {
      ended = true;
      break;
    }
    const upd = line.match(/^\*\*\* Update File:\s*(.+?)\s*$/);
    const add = line.match(/^\*\*\* Add File:\s*(.+?)\s*$/);
    if (upd) {
      i++;
      const hunks: Hunk[] = [];
      let cur: Hunk | undefined;
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        const l = lines[i];
        if (l.startsWith("@@")) {
          if (cur && cur.old.length + cur.next.length > 0) hunks.push(cur);
          cur = { anchor: l.slice(2).trim() || undefined, old: [], next: [] };
        } else {
          if (!cur) cur = { old: [], next: [] };
          if (l.startsWith("+")) cur.next.push(l.slice(1));
          else if (l.startsWith("-")) cur.old.push(l.slice(1));
          else if (l.startsWith(" ")) {
            cur.old.push(l.slice(1));
            cur.next.push(l.slice(1));
          } else if (l === "") {
            // blank context line whose leading space was stripped
            if (i + 1 < lines.length && lines[i + 1] !== "*** End Patch") {
              cur.old.push("");
              cur.next.push("");
            }
          } else {
            throw new PatchError(
              `Line ${i + 1}: hunk lines must start with " ", "-" or "+" (got "${l.slice(0, 40)}").`,
            );
          }
        }
        i++;
      }
      if (cur && cur.old.length + cur.next.length > 0) hunks.push(cur);
      if (hunks.length === 0) {
        throw new PatchError(`Update of ${upd[1]} has no hunks.`);
      }
      files.push({ kind: "update", path: upd[1], hunks });
    } else if (add) {
      i++;
      const added: string[] = [];
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        const l = lines[i];
        if (l.startsWith("+")) added.push(l.slice(1));
        else if (l === "" && lines[i + 1]?.trim() === "*** End Patch") {
          // trailing blank before End Patch
        } else if (l !== "") {
          throw new PatchError(
            `Line ${i + 1}: lines of an added file must start with "+".`,
          );
        } else added.push("");
        i++;
      }
      files.push({ kind: "add", path: add[1], lines: added });
    } else if (line.trim() === "") {
      i++;
    } else {
      throw new PatchError(
        `Line ${i + 1}: expected "*** Update File:", "*** Add File:" or "*** End Patch".`,
      );
    }
  }
  if (!ended) throw new PatchError('Patch must end with "*** End Patch".');
  if (files.length === 0) throw new PatchError("Patch contains no files.");
  return files;
}

function eq(a: string, b: string, loose: boolean): boolean {
  return loose ? a.trim() === b.trim() : a.trimEnd() === b.trimEnd();
}

function findAll(
  file: string[],
  old: string[],
  from: number,
  loose: boolean,
): number[] {
  const hits: number[] = [];
  for (let s = from; s + old.length <= file.length; s++) {
    let ok = true;
    for (let k = 0; k < old.length; k++) {
      if (!eq(file[s + k], old[k], loose)) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(s);
  }
  return hits;
}

function nearMiss(file: string[], old: string[]): string {
  // locate the most similar first line to show what the file really contains
  const target = old.find((l) => l.trim().length > 3) ?? old[0] ?? "";
  let best = -1;
  for (let i = 0; i < file.length; i++) {
    if (file[i].trim() === target.trim()) {
      best = i;
      break;
    }
    if (best === -1 && target.trim() && file[i].includes(target.trim().slice(0, 30))) {
      best = i;
    }
  }
  if (best === -1) return "No similar line found; re-read the file.";
  const from = Math.max(0, best - 1);
  const to = Math.min(file.length, best + Math.max(3, old.length));
  return `Closest region (lines ${from + 1}-${to}):\n${file
    .slice(from, to)
    .map((l, k) => `${from + k + 1}| ${l}`)
    .join("\n")}`;
}

export interface UpdatePlan {
  content: string;
  ranges: [number, number][]; // 1-based inclusive ranges in the ORIGINAL file
}

function reindent(next: string[], patchOld: string[], fileOld: string[]): string[] {
  const indent = (l: string) => l.match(/^\s*/)![0];
  const pi = patchOld.find((l) => l.trim())?.match(/^\s*/)?.[0] ?? "";
  const fi = fileOld.find((l) => l.trim())?.match(/^\s*/)?.[0] ?? "";
  if (pi === fi) return next;
  return next.map((l) => {
    if (!l.trim()) return l;
    return indent(l).startsWith(pi) ? fi + l.slice(pi.length) : l;
  });
}

export function planUpdate(
  content: string,
  hunks: Hunk[],
  path: string,
): UpdatePlan {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const trailing = content.endsWith("\n");
  const file = content.split(/\r?\n/);
  if (trailing) file.pop();

  type Placed = { start: number; end: number; next: string[] };
  const placed: Placed[] = [];

  hunks.forEach((h, idx) => {
    const label = `${path}, hunk ${idx + 1}`;
    if (h.old.length === 0) {
      throw new PatchError(
        `${label}: a hunk needs at least one context or removed line to be located.`,
      );
    }
    let from = 0;
    if (h.anchor) {
      const a = file.findIndex((l) => l.includes(h.anchor!));
      if (a === -1) {
        throw new PatchError(`${label}: anchor "${h.anchor}" not found in file.`);
      }
      from = a;
    }
    for (const loose of [false, true]) {
      const hits = findAll(file, h.old, from, loose);
      if (hits.length === 1) {
        const s = hits[0];
        const fileOld = file.slice(s, s + h.old.length);
        const next = loose ? reindent(h.next, h.old, fileOld) : h.next;
        placed.push({ start: s, end: s + h.old.length, next });
        return;
      }
      if (hits.length > 1) {
        throw new PatchError(
          `${label}: ambiguous, matches at lines ${hits
            .slice(0, 5)
            .map((x) => x + 1)
            .join(", ")}. Add more context lines or an "@@ anchor".`,
        );
      }
    }
    throw new PatchError(
      `${label}: the expected original lines were not found (file changed, or context is inexact).\n${nearMiss(file, h.old)}`,
    );
  });

  placed.sort((a, b) => a.start - b.start);
  for (let k = 1; k < placed.length; k++) {
    if (placed[k].start < placed[k - 1].end) {
      throw new PatchError(
        `${path}: hunks overlap around line ${placed[k].start + 1}. Merge them into one hunk.`,
      );
    }
  }

  const out: string[] = [];
  let cursor = 0;
  for (const p of placed) {
    out.push(...file.slice(cursor, p.start), ...p.next);
    cursor = p.end;
  }
  out.push(...file.slice(cursor));
  return {
    content: out.join(eol) + (trailing || out.length === 0 ? eol : ""),
    ranges: placed.map((p) => [p.start + 1, Math.max(p.start + 1, p.end)]),
  };
}

export function planAdd(lines: string[]): string {
  return lines.length ? lines.join("\n") + "\n" : "";
}
