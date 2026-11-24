import { expect, test } from "vitest";
import { BuiltInToolNames } from "./builtIn";
import { getConfigDependentToolDefinitions } from "./index";

test("web_search replaces the hosted search_web tool by default", async () => {
  const tools = await getConfigDependentToolDefinitions({
    rules: [],
    enableExperimentalTools: false,
    isRemote: false,
    modelName: "",
    ide: {} as any,
  });

  // search_web (hosted proxy) is only offered with experimental tools;
  // the local web_search tool is part of the base tool set.
  expect(
    tools.find((tool) => tool.function.name === BuiltInToolNames.SearchWeb),
  ).toBeUndefined();
  const withExperimental = await getConfigDependentToolDefinitions({
    rules: [],
    enableExperimentalTools: true,
    isRemote: false,
    modelName: "",
    ide: {} as any,
  });
  const searchWebTool = withExperimental.find(
    (tool) => tool.function.name === BuiltInToolNames.SearchWeb,
  );
  expect(searchWebTool?.displayTitle).toBe("Search Web");
});
