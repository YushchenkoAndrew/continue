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
  MAX_NOTE_CHARS,
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

/**
 * Plan fields describe the work; they are not the place to reject a model over formatting.
 * Code fences and extra lines are flattened and long text is cut, so one verbose "approach"
 * cannot stop the whole plan (and the progress panel) from being created. Secrets still fail.
 */
function tidy(text: string, max = 280): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/```/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function strings(value: unknown, section: string, max = 12): string[] {
  const list = (Array.isArray(value) ? value : [value])
    .map((x) => tidy(String(x)))
    .filter(Boolean);
  return list.slice(0, max).map((text) => {
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

function cleanNote(value: unknown, where: string): string {
  const note = tidy(String(value ?? ""), MAX_NOTE_CHARS);
  if (!note)
    throw new Error(`${where} is blocked: add a short note saying why.`);
  const problem = validateEntryText(note);
  if (problem) throw new Error(`${where}: ${problem}`);
  return note;
}

function buildSteps(raw: unknown, existing: PlanStep[]): PlanStep[] {
  if (!Array.isArray(raw))
    throw new Error(
      "steps must be an array of {text, status?, after?, note?}.",
    );
  if (raw.length > MAX_PLAN_STEPS)
    throw new Error(
      `A plan has at most ${MAX_PLAN_STEPS} steps; merge related ones.`,
    );
  const previous = new Map(existing.map((s) => [key(s.text), s]));
  return raw.map((item: any) => {
    let text = tidy(
      String(typeof item === "string" ? item : (item?.text ?? "")),
      MAX_STEP_CHARS,
    );
    if (!text) throw new Error("Every step needs text.");
    const after = Array.isArray(item?.after)
      ? item.after.filter((n: unknown) => Number.isInteger(n)).slice(0, 4)
      : [];
    if (after.length) text += ` (after ${after.join(",")})`;
    const problem = validateEntryText(text);
    if (problem) throw new Error(`step "${text.slice(0, 40)}": ${problem}`);
    // Re-sending the same list keeps progress instead of resetting it.
    const before = previous.get(key(text));
    const status = normalizeStatus(item?.status) ?? before?.status ?? "pending";
    if (status !== "blocked") return { text, status };
    const note =
      item?.note !== undefined
        ? cleanNote(item.note, `step "${text.slice(0, 40)}"`)
        : before?.note;
    if (!note) cleanNote("", `step "${text.slice(0, 40)}"`);
    return { text, status, note };
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

  const keysBefore = steps.map((x) => key(x.text)).join("\n");
  if (args?.steps !== undefined) steps = buildSteps(args.steps, steps);
  const resentSamePlan =
    args?.steps !== undefined &&
    !!keysBefore &&
    keysBefore === steps.map((x) => key(x.text)).join("\n");
  if (Array.isArray(args?.set)) {
    for (const u of args.set) {
      const n = Number(u?.step);
      const status = normalizeStatus(u?.status);
      if (!Number.isInteger(n) || n < 1 || n > steps.length)
        throw new Error(
          `No step ${u?.step}; the plan has ${steps.length} steps.`,
        );
      if (!status) throw new Error(`Unknown status "${u?.status}".`);
      steps[n - 1] = {
        text: steps[n - 1].text,
        status,
        ...(status === "blocked" && {
          note:
            u?.note !== undefined
              ? cleanNote(u.note, `step ${n}`)
              : (steps[n - 1].note ?? cleanNote("", `step ${n}`)),
        }),
      };
    }
  }
  if (steps.length === 0)
    throw new Error("No plan yet: pass steps to create one.");

  const put = (section: string, items: string[]) => {
    doc[section] = items.map((text) => ({ status: "" as const, text }));
  };
  if (args?.objective !== undefined && String(args.objective).trim())
    put("objective", strings(args.objective, "objective", 1));
  if (args?.approach !== undefined && String(args.approach).trim())
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
  if (resentSamePlan)
    content +=
      "\n\nPlan unchanged. Update progress with set:[{step,status}]; do not resend the steps.";
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
