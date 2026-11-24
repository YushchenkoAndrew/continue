import { ConfigDependentToolParams, Tool } from "..";
import * as toolDefinitions from "./definitions";

// I'm writing these as functions because we've messed up 3 TIMES by pushing to const, causing duplicate tool definitions on subsequent config loads.
export const getBaseToolDefinitions = () => [
  // read / navigate (bounded, numbered output)
  toolDefinitions.readFileTool,
  toolDefinitions.fileOutlineTool,
  toolDefinitions.readSymbolTool,
  toolDefinitions.codebaseTool,
  toolDefinitions.globSearchTool,
  toolDefinitions.lsTool,
  toolDefinitions.readCurrentlyOpenFileTool,
  toolDefinitions.viewDiffTool,
  // language intelligence (VS Code providers)
  toolDefinitions.findDefinitionTool,
  toolDefinitions.findReferencesTool,
  toolDefinitions.getTypeDefinitionTool,
  toolDefinitions.getImplementationsTool,
  toolDefinitions.getHoverInfoTool,
  toolDefinitions.getCallHierarchyTool,
  // project understanding
  toolDefinitions.projectMapTool,
  toolDefinitions.dependencyGraphTool,
  toolDefinitions.prepareContextTool,
  // editing
  toolDefinitions.multiEditTool,
  toolDefinitions.replaceLinesTool,
  toolDefinitions.insertLinesTool,
  toolDefinitions.applyPatchTool,
  toolDefinitions.renameSymbolTool,
  toolDefinitions.createNewFileTool,
  // research, verification, memory
  toolDefinitions.webSearchTool,
  toolDefinitions.fetchUrlTool,
  toolDefinitions.findTestsTool,
  toolDefinitions.runTestsTool,
  toolDefinitions.runChecksTool,
  toolDefinitions.getProjectMemoryTool,
  toolDefinitions.updateProjectMemoryTool,
  toolDefinitions.saveTaskStateTool,
  toolDefinitions.getTaskStateTool,
  // misc
  toolDefinitions.runTerminalCommandTool,
  toolDefinitions.createRuleBlock,
];

export const getConfigDependentToolDefinitions = async (
  params: ConfigDependentToolParams,
): Promise<Tool[]> => {
  const { enableExperimentalTools, isRemote } = params;
  const tools: Tool[] = [];

  tools.push(await toolDefinitions.requestRuleTool(params));
  tools.push(await toolDefinitions.readSkillTool(params));

  if (enableExperimentalTools) {
    // Legacy tools: whole-file rewrites through the apply model, and range reads
    // that read_file already covers. Kept for configs that rely on them.
    tools.push(
      toolDefinitions.viewRepoMapTool,
      toolDefinitions.viewSubdirectoryTool,
      toolDefinitions.readFileRangeTool,
      toolDefinitions.editFileTool,
      toolDefinitions.singleFindAndReplaceTool,
      toolDefinitions.searchWebTool,
      toolDefinitions.fetchUrlContentTool,
    );
  }

  // missing support for remote os calls: https://github.com/microsoft/vscode/issues/252269
  if (!isRemote) {
    tools.push(toolDefinitions.grepSearchTool);
  }

  return tools;
};

export function serializeTool(tool: Tool) {
  const { preprocessArgs, evaluateToolCallPolicy, ...rest } = tool;
  return rest;
}
