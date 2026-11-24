import { ToolImpl } from ".";
import { IDE } from "../..";
import { formatGrepSearchResults } from "../../util/grepSearch";
import {
  Doc,
  MAX_FILE_CHARS,
  memoryPaths,
  parseDoc,
  renderDoc,
  TASK_SECTIONS,
  validateEntryText,
} from "../memory/memoryStore";
import {
  lineToStep,
  MAX_PLAN_STEPS,
  MAX_STEP_CHARS,
  normalizeStatus,
  PlanStep,
  renderChecklist,
  stepToLine,
} from "../memory/plan";

const MARKER = "AI-TASK [INCOMPLETE]";

async function readIfExists(ide: IDE, uri: string): Promise<string> {
  try {
    return (await ide.fileExists(uri)) ? await ide.readFile(uri) : "";
  } catch {
    return "";
  }
}

function strings(value: unknown, section: string, max = 12): string[] {
  const list = (Array.isArray(value) ? value : [value])
    .map((x) => String(x).trim())
    .filter(Boolean);
  return list.slice(0, max).map((t) => {
    const text = t.slice(0, 280);
    const problem = validateEntryText(text);
    if (problem) throw new Error(`${section}: ${problem}`);
    return text;
  });
}

const key = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+\(after [\d, ]+\)$/, "")
    .trim();

function buildSteps(raw: unknown, existing: PlanStep[]): PlanStep[] {
  if (!Array.isArray(raw))
    throw new Error("steps must be an array of {text, status?, after?}.");
  if (raw.length > MAX_PLAN_STEPS)
    throw new Error(
      `A plan has at most ${MAX_PLAN_STEPS} steps; merge related ones.`,
    );
  const previous = new Map(existing.map((s) => [key(s.text), s.status]));
  return raw.map((item: any) => {
    let text = String(typeof item === "string" ? item : (item?.text ?? ""))
      .trim()
      .slice(0, MAX_STEP_CHARS);
    if (!text) throw new Error("Every step needs text.");
    const after = Array.isArray(item?.after)
      ? item.after.filter((n: unknown) => Number.isInteger(n)).slice(0, 4)
      : [];
    if (after.length) text += ` (after ${after.join(",")})`;
    const problem = validateEntryText(text);
    if (problem) throw new Error(`step "${text.slice(0, 40)}": ${problem}`);
    // Re-sending the same list keeps progress instead of resetting it.
    const status =
      normalizeStatus(item?.status) ?? previous.get(key(text)) ?? "pending";
    return { text, status };
  });
}

/** Files carrying unfinished-work markers, bounded; used to stop "complete" being reported early. */
async function findIncompleteMarkers(ide: IDE): Promise<string[]> {
  try {
    const raw = await ide.getSearchResults("AI-TASK \\[INCOMPLETE\\]", 25);
    const { formatted, numResults } = formatGrepSearchResults(raw, 1500);
    return numResults > 0
      ? formatted
          .split("\n")
          .filter((l) => l.trim())
          .slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

export const updatePlanImpl: ToolImpl = async (args, extras) => {
  const dir = (await extras.ide.getWorkspaceDirs())[0];
  if (!dir) throw new Error("No workspace folder is open.");
  const { task } = memoryPaths(dir);
  const doc: Doc = parseDoc(
    await readIfExists(extras.ide, task),
    TASK_SECTIONS,
  );

  let steps: PlanStep[] = (doc.plan ?? [])
    .map((e) => lineToStep(e.text))
    .filter((s): s is PlanStep => !!s);

  if (args?.steps !== undefined) steps = buildSteps(args.steps, steps);
  if (Array.isArray(args?.set)) {
    for (const u of args.set) {
      const n = Number(u?.step);
      const status = normalizeStatus(u?.status);
      if (!Number.isInteger(n) || n < 1 || n > steps.length)
        throw new Error(
          `No step ${u?.step}; the plan has ${steps.length} steps.`,
        );
      if (!status) throw new Error(`Unknown status "${u?.status}".`);
      steps[n - 1] = { ...steps[n - 1], status };
    }
  }
  if (steps.length === 0)
    throw new Error("No plan yet: pass steps to create one.");

  const put = (section: string, items: string[]) => {
    doc[section] = items.map((text) => ({ status: "" as const, text }));
  };
  if (typeof args?.objective === "string" && args.objective.trim())
    put("objective", strings(args.objective, "objective"));
  if (typeof args?.approach === "string" && args.approach.trim())
    put("approach", strings(args.approach, "approach"));
  if (args?.files !== undefined) put("files", strings(args.files, "files", 25));
  if (args?.risks !== undefined) put("risks", strings(args.risks, "risks"));
  if (args?.done_when !== undefined)
    put("criteria", strings(args.done_when, "done_when"));
  put("plan", steps.map(stepToLine));
  // Keep the generic task-state sections in step with the plan, so a resumed chat sees one truth.
  put(
    "done",
    steps.filter((s) => s.status === "done").map((s) => s.text),
  );
  put(
    "remaining",
    steps.filter((s) => s.status !== "done").map((s) => s.text),
  );

  const rendered = renderDoc(
    "Task state",
    doc,
    TASK_SECTIONS,
    "Progress of the current task; overwritten as work advances.",
  );
  if (rendered.length > MAX_FILE_CHARS) {
    throw new Error(
      `Task state would exceed ${MAX_FILE_CHARS} characters; shorten the plan or its notes.`,
    );
  }
  await extras.ide.writeFile(task, rendered);

  let content = renderChecklist(steps);
  if (steps.every((s) => s.status === "done")) {
    const marks = await findIncompleteMarkers(extras.ide);
    content += marks.length
      ? `\n\nNot complete: ${MARKER} markers remain. Finish those spots (or report the work as incomplete) and remove each marker only after verifying it:\n${marks.join("\n")}`
      : "\n\nAll steps done.";
  }
  // hidden: the chat renders the checklist itself; the model still receives the content
  return [
    { name: "Plan", description: "Plan checklist", content, hidden: true },
  ];
};
