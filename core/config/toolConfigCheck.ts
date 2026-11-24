import { IDE, ModelDescription } from "..";
import { modelSupportsNativeTools } from "../llm/toolSupport";
import { getBaseToolDefinitions } from "../tools";
import type { ConfigHandler } from "./ConfigHandler";
import { addModelCapability } from "./toolConfigEdit";

export interface ToolConfigChange {
  id: string;
  title: string;
  description: string;
}

export interface ToolConfigReport {
  /** True only when the user's configuration needs a change. Auto-registered tools never set this. */
  needsAttention: boolean;
  /** Stable id of the pending change set; the UI stores it so the same notice is not shown twice. */
  signature: string;
  /** Names of the agent tools registered for this config, so the UI can tell which are new. */
  tools: string[];
  /** Tools this build provides that are not registered (for example disabled by the config). */
  unavailable: string[];
  model?: string;
  changes: ToolConfigChange[];
  /** The file that would be edited. Absent when the model is not defined in an editable local file. */
  file?: string;
  editable: boolean;
  /** Lines that "Update configuration" would add, for the review. */
  added?: string;
  /** What to add by hand when the file cannot be edited. */
  manual?: string;
  result?: "updated" | "unchanged" | "failed";
  message?: string;
}

const NONE: ToolConfigReport = {
  needsAttention: false,
  signature: "",
  tools: [],
  unavailable: [],
  changes: [],
  editable: false,
};

export const TOOL_USE_CAPABILITY = "tool_use";

function manualSnippet(model: string): string {
  return `models:\n  - name: ${model}\n    capabilities:\n      - ${TOOL_USE_CAPABILITY}`;
}

/**
 * Compares the active config with what the agent tools need. A config that already works
 * (capability set, or the model is recognised as tool-capable) reports nothing.
 * With action "apply" it makes the single minimal edit to the user's YAML file.
 */
export async function checkToolConfig(
  configHandler: ConfigHandler,
  ide: IDE,
  action: "check" | "apply" = "check",
): Promise<ToolConfigReport> {
  const { config } = await configHandler.loadConfig();
  if (!config) {
    return NONE;
  }

  const registered = Array.from(
    new Set(config.tools.map((t) => t.function.name)),
  );
  const unavailable = getBaseToolDefinitions()
    .map((t) => t.function.name)
    .filter((name) => !registered.includes(name));
  const base: ToolConfigReport = { ...NONE, tools: registered, unavailable };

  const chat = config.selectedModelByRole.chat;
  if (!chat || config.experimental?.onlyUseSystemMessageTools) {
    return base;
  }

  const description = {
    title: chat.title ?? chat.model,
    provider: chat.providerName,
    model: chat.model,
    capabilities: chat.capabilities,
  } as unknown as ModelDescription;
  if (modelSupportsNativeTools(description)) {
    return { ...base, model: chat.title };
  }

  const modelName = chat.title ?? chat.model;
  const report: ToolConfigReport = {
    ...base,
    needsAttention: true,
    signature: `${TOOL_USE_CAPABILITY}:${chat.providerName}:${modelName}`,
    model: modelName,
    changes: [
      {
        id: TOOL_USE_CAPABILITY,
        title: `Mark "${modelName}" as tool-capable`,
        description:
          "Without tool_use the agent describes its tools in the prompt and parses " +
          "code blocks, which costs more tokens and is less reliable with small local models.",
      },
    ],
    manual: manualSnippet(modelName),
  };

  const uri = configHandler.currentProfile?.profileDescription.uri;
  if (!chat.title || !uri || !/^file:/i.test(uri) || !/\.ya?ml$/i.test(uri)) {
    return report;
  }

  let text: string;
  try {
    text = await ide.readFile(uri);
  } catch {
    return report;
  }

  const edit = addModelCapability(text, chat.title, TOOL_USE_CAPABILITY);
  if (!edit.changed) {
    // The model is defined elsewhere (a block or hub assistant), or is already marked.
    return report;
  }
  report.file = uri;
  report.editable = true;
  report.added = edit.added;

  if (action !== "apply") {
    return report;
  }

  try {
    await ide.writeFile(uri, edit.text);
  } catch (e) {
    return {
      ...report,
      result: "failed",
      message:
        "The configuration file could not be written (it may be read-only or managed by Nix). " +
        `Add this by hand:\n${report.manual}`,
    };
  }
  await configHandler.reloadConfig("Tool capability added (config/toolConfig)");
  return {
    ...report,
    needsAttention: false,
    changes: [],
    result: "updated",
    message: `Added ${TOOL_USE_CAPABILITY} to "${modelName}".`,
  };
}
