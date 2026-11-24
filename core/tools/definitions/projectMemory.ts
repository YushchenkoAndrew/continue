import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

const base = {
  type: "function" as const,
  group: BUILT_IN_GROUP_NAME,
  isInstant: true,
  toolCallIcon: "BookOpenIcon" as const,
};

export const getProjectMemoryTool: Tool = {
  ...base,
  displayTitle: "Get Project Memory",
  wouldLikeTo: "read project memory",
  isCurrently: "reading project memory",
  hasAlready: "read project memory",
  readonly: true,
  function: {
    name: BuiltInToolNames.GetProjectMemory,
    description:
      "Read stored facts about this project (architecture, conventions, dependencies, decisions, limitations).",
    parameters: {
      type: "object",
      properties: {
        section: { type: "string", description: "Optional: one section name" },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};

export const updateProjectMemoryTool: Tool = {
  ...base,
  displayTitle: "Update Project Memory",
  wouldLikeTo: "update project memory ({{{ section }}})",
  isCurrently: "updating project memory ({{{ section }}})",
  hasAlready: "updated project memory ({{{ section }}})",
  readonly: false,
  function: {
    name: BuiltInToolNames.UpdateProjectMemory,
    description:
      "Add, update or remove one short fact (never code, secrets or file contents). Mark status verified only if you checked it in the code.",
    parameters: {
      type: "object",
      required: ["section", "text"],
      properties: {
        op: { type: "string", enum: ["add", "update", "remove"], description: "Default add" },
        section: {
          type: "string",
          enum: ["architecture", "conventions", "dependencies", "decisions", "limitations"],
        },
        text: { type: "string", description: "The fact (max 300 chars)" },
        status: { type: "string", enum: ["verified", "assumed"] },
        match: { type: "string", description: "Substring of the entry to update/remove" },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};

export const saveTaskStateTool: Tool = {
  ...base,
  displayTitle: "Save Task State",
  wouldLikeTo: "save task progress",
  isCurrently: "saving task progress",
  hasAlready: "saved task progress",
  readonly: false,
  function: {
    name: BuiltInToolNames.SaveTaskState,
    description:
      "Save progress of the current task so a new chat can resume. Each field you pass replaces its previous value.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        done: { type: "array", items: { type: "string" } },
        findings: { type: "array", items: { type: "string" } },
        files: { type: "array", items: { type: "string" }, description: "Affected files" },
        decisions: { type: "array", items: { type: "string" } },
        remaining: { type: "array", items: { type: "string" }, description: "Next steps" },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};

export const getTaskStateTool: Tool = {
  ...base,
  displayTitle: "Get Task State",
  wouldLikeTo: "restore saved task progress",
  isCurrently: "restoring saved task progress",
  hasAlready: "restored saved task progress",
  readonly: true,
  function: {
    name: BuiltInToolNames.GetTaskState,
    description: "Read the saved progress of the previous task.",
    parameters: { type: "object", properties: {} },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};
