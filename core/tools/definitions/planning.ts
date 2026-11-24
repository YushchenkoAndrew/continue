import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

// Deliberately no toolCallIcon: the chat renders these two with their own checklist / form.

export const updatePlanTool: Tool = {
  type: "function",
  displayTitle: "Plan",
  wouldLikeTo: "update the plan",
  isCurrently: "updating the plan",
  hasAlready: "updated the plan",
  readonly: false,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.UpdatePlan,
    description:
      "Only for complex work (4+ steps or several files); simple tasks: just do them. Create the plan once with steps, then update progress with set:[{step,status}] (don't resend steps). Statuses: pending, in_progress, done, blocked (needs a short note). Mark done only after the change is made, not after reading. For work that may span sessions, leave `// AI-TASK [INCOMPLETE]: <what remains>` at unfinished spots (search for existing ones first, no duplicates; remove only after verifying).",
    parameters: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description: "The user's request in their words, 1-2 sentences",
        },
        approach: { type: "string" },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Affected files",
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["text"],
            properties: {
              text: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "done", "blocked"],
              },
              after: {
                type: "array",
                items: { type: "number" },
                description: "Step numbers this depends on",
              },
              note: { type: "string", description: "Why the step is blocked" },
            },
          },
        },
        set: {
          type: "array",
          description: "Progress updates by 1-based step number",
          items: {
            type: "object",
            required: ["step", "status"],
            properties: {
              step: { type: "number" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "done", "blocked"],
              },
              note: { type: "string", description: "Why the step is blocked" },
            },
          },
        },
        risks: { type: "array", items: { type: "string" } },
        done_when: {
          type: "array",
          items: { type: "string" },
          description: "Completion criteria",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};

export const askUserTool: Tool = {
  type: "function",
  displayTitle: "Question",
  wouldLikeTo: "ask you a question",
  isCurrently: "waiting for your answer",
  hasAlready: "asked you a question",
  readonly: true,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.AskUser,
    description:
      "Ask the user only when a decision is ambiguous and cannot be found in the code. Max 6 questions per task; otherwise choose a sensible default and state it. Omit options for free text.",
    parameters: {
      type: "object",
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          description: "1-3 questions",
          items: {
            type: "object",
            required: ["question"],
            properties: {
              question: { type: "string" },
              options: {
                type: "array",
                items: { type: "string" },
                description: "Choices (a custom answer is always allowed)",
              },
              multiple: {
                type: "boolean",
                description: "Allow several options",
              },
            },
          },
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};
