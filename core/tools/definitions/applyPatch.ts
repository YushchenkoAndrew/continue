import { Tool } from "../..";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { planPatchFromIde } from "../../edit/applyPatch/planFromIde";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const applyPatchTool: Tool = {
  type: "function",
  displayTitle: "Apply Patch",
  wouldLikeTo: "apply a patch",
  isCurrently: "applying a patch",
  hasAlready: "applied a patch",
  readonly: false,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ApplyPatch,
    description:
      "Edit several places or files in one call. Format: *** Begin Patch / *** Update File: path / @@ optional anchor / ' ' context, '-' removed, '+' added lines / *** Add File: path (+lines) / *** End Patch. Hunks are found by context, not line numbers; ambiguous or stale hunks fail the whole patch. Each file opens in diff review.",
    parameters: {
      type: "object",
      required: ["patch"],
      properties: {
        patch: { type: "string", description: "The patch text" },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To edit multiple places/files, use ${BuiltInToolNames.ApplyPatch}:`,
    exampleArgs: [
      [
        "patch",
        "*** Begin Patch\n*** Update File: src/a.ts\n@@ function foo\n   const x = 1;\n-  return x;\n+  return x + 1;\n*** End Patch",
      ],
    ],
  },
  defaultToolPolicy: "allowedWithPermission",
  preprocessArgs: async (args, extras) => {
    const files = await planPatchFromIde(
      String(args.patch ?? ""),
      extras.ide,
      throwIfFileIsSecurityConcern,
    );
    return { ...args, summary: files.map((f) => f.label) };
  },
};
