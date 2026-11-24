import { ToolImpl } from ".";
import { IDE } from "../..";
import {
  applyMemoryOp,
  Doc,
  MAX_FILE_CHARS,
  memoryPaths,
  MemoryOp,
  parseDoc,
  PROJECT_SECTIONS,
  renderDoc,
  TASK_SECTIONS,
  validateEntryText,
} from "../memory/memoryStore";

async function root(ide: IDE): Promise<string> {
  const dir = (await ide.getWorkspaceDirs())[0];
  if (!dir) throw new Error("No workspace folder is open.");
  return dir;
}

async function readIfExists(ide: IDE, uri: string): Promise<string> {
  try {
    return (await ide.fileExists(uri)) ? await ide.readFile(uri) : "";
  } catch {
    return "";
  }
}

function result(name: string, content: string) {
  return [{ name, description: name, content }];
}

function limit(text: string, section: string | undefined): string {
  if (!section) return text;
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${section.toLowerCase()}`);
  if (start === -1) return `(no "${section}" section yet)`;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join("\n").trim();
}

export const getProjectMemoryImpl: ToolImpl = async (args, extras) => {
  const { project } = memoryPaths(await root(extras.ide));
  const text = await readIfExists(extras.ide, project);
  if (!text.trim()) {
    return result("Project memory", "No project memory yet. Use update_project_memory to record verified facts.");
  }
  return result("Project memory", limit(text, typeof args?.section === "string" ? args.section : undefined));
};

export const updateProjectMemoryImpl: ToolImpl = async (args, extras) => {
  const { project } = memoryPaths(await root(extras.ide));
  const op = String(args?.op ?? "add") as MemoryOp;
  if (!["add", "update", "remove"].includes(op)) throw new Error('op must be "add", "update" or "remove".');
  const section = String(args?.section ?? "").toLowerCase();
  const status = args?.status === "verified" ? "verified" : args?.status === "assumed" ? "assumed" : "";
  const doc: Doc = parseDoc(await readIfExists(extras.ide, project), PROJECT_SECTIONS);
  const message = applyMemoryOp(doc, section, op, args?.text, status, args?.match);
  const rendered = renderDoc("Project memory", doc, PROJECT_SECTIONS, "Maintained by the coding agent; entries are tagged [verified] or [assumed].");
  if (rendered.length > MAX_FILE_CHARS) {
    throw new Error(`Project memory would exceed ${MAX_FILE_CHARS} characters. Remove outdated entries first.`);
  }
  await extras.ide.writeFile(project, rendered);
  return result("Project memory", `${message} (file: .continue/memory/project.md)`);
};

const TASK_ARRAY_FIELDS = ["done", "findings", "files", "decisions", "remaining"] as const;

export const saveTaskStateImpl: ToolImpl = async (args, extras) => {
  const { task } = memoryPaths(await root(extras.ide));
  const doc: Doc = parseDoc(await readIfExists(extras.ide, task), TASK_SECTIONS);

  // Provided sections replace the old ones, so the state never accumulates stale entries.
  const set = (section: string, items: unknown) => {
    const list = (Array.isArray(items) ? items : [items]).map((x) => String(x).trim()).filter(Boolean);
    for (const t of list) {
      const problem = validateEntryText(t);
      if (problem) throw new Error(`${section}: ${problem}`);
    }
    doc[section] = list.slice(0, 25).map((text) => ({ status: "" as const, text }));
  };
  if (typeof args?.objective === "string" && args.objective.trim()) set("objective", [args.objective]);
  for (const f of TASK_ARRAY_FIELDS) if (args?.[f] !== undefined) set(f, args[f]);

  const rendered = renderDoc("Task state", doc, TASK_SECTIONS, "Progress of the current task; overwritten as work advances.");
  if (rendered.length > MAX_FILE_CHARS) throw new Error(`Task state would exceed ${MAX_FILE_CHARS} characters; condense it.`);
  await extras.ide.writeFile(task, rendered);
  return result("Task state", "Task state saved (.continue/memory/task.md).");
};

export const getTaskStateImpl: ToolImpl = async (_args, extras) => {
  const { task } = memoryPaths(await root(extras.ide));
  const text = await readIfExists(extras.ide, task);
  return result("Task state", text.trim() || "No saved task state.");
};
