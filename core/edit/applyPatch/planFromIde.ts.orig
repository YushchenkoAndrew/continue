import { IDE } from "../..";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { resolveRelativePathInDir } from "../../util/ideUtils";
import { joinPathsToUri } from "../../util/uri";
import {
  FilePatch,
  PatchError,
  parsePatch,
  planAdd,
  planUpdate,
} from "./applyPatch";

export interface PlannedFile {
  uri: string;
  path: string; // as written in the patch
  isNew: boolean;
  content: string;
  label: string; // e.g. "src/a.ts (lines 10-14, 40)"
}

function rangesLabel(ranges: [number, number][]): string {
  return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
}

function assertSafeRelative(path: string) {
  if (/^([a-zA-Z]:)?[\\/]/.test(path) || path.split(/[\\/]/).includes("..")) {
    throw new PatchError(
      `${path}: use a path relative to the workspace root (no absolute paths or "..").`,
    );
  }
}

export async function planPatchFromIde(
  patchText: string,
  ide: IDE,
): Promise<PlannedFile[]> {
  const patches: FilePatch[] = parsePatch(patchText);
  const seen = new Set<string>();
  const planned: PlannedFile[] = [];
  const errors: string[] = [];

  for (const fp of patches) {
    try {
      assertSafeRelative(fp.path);
      throwIfFileIsSecurityConcern(fp.path);
      if (seen.has(fp.path)) {
        throw new PatchError(
          `${fp.path} appears twice; put all its hunks under one "Update File".`,
        );
      }
      seen.add(fp.path);

      if (fp.kind === "update") {
        const uri = await resolveRelativePathInDir(fp.path, ide);
        if (!uri)
          throw new PatchError(
            `${fp.path} does not exist (use "Add File" for new files).`,
          );
        const current = await ide.readFile(uri);
        const plan = planUpdate(current, fp.hunks, fp.path);
        planned.push({
          uri,
          path: fp.path,
          isNew: false,
          content: plan.content,
          label: `${fp.path} (lines ${rangesLabel(plan.ranges)})`,
        });
      } else {
        if (await resolveRelativePathInDir(fp.path, ide)) {
          throw new PatchError(`${fp.path} already exists; use "Update File".`);
        }
        const root = (await ide.getWorkspaceDirs())[0];
        if (!root) throw new PatchError("No workspace folder is open.");
        planned.push({
          uri: joinPathsToUri(root, ...fp.path.split(/[\\/]/)),
          path: fp.path,
          isNew: true,
          content: planAdd(fp.lines),
          label: `${fp.path} (new file, ${fp.lines.length} lines)`,
        });
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (errors.length > 0) {
    throw new PatchError(
      `Patch not applied; nothing was changed.\n${errors.slice(0, 5).join("\n")}\nFix the patch (or re-read the file) and send it again.`,
    );
  }
  return planned;
}
