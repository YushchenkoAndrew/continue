import { ToolImpl } from ".";
import { RangeInFile } from "../..";
import { retrieveContextItemsFromEmbeddings } from "../../context/retrieval/retrieval";
import { getStringArg } from "../parseArgs";
import { readBudgetChars } from "./readBudget";

export const codebaseToolImpl: ToolImpl = async (args, extras) => {
  const query = getStringArg(args, "query");

  try {
    const contextExtras = {
      config: extras.config,
      fullInput: query,
      embeddingsProvider: extras.config.selectedModelByRole.embed,
      reranker: extras.config.selectedModelByRole.rerank,
      llm: extras.llm,
      ide: extras.ide,
      selectedCode: [] as RangeInFile[],
      fetch: extras.fetch,
      isInAgentMode: true, // always true in tool call
    };

    // Use the existing retrieval function to get context items
    const results = await retrieveContextItemsFromEmbeddings(
      contextExtras,
      undefined,
      undefined,
    );

    // If no results found, return helpful message
    if (results.length === 0) {
      return [
        {
          name: "No Results",
          description: "Codebase search",
          content: `No relevant code found for query: "${query}". This could mean:
- The codebase hasn't been indexed yet
- No code matches the search criteria
- Embeddings provider is not configured

Try re-indexing the codebase or using a more specific query.`,
        },
      ];
    }

    // Bound the total size so a few large chunks cannot flood a small context.
    let remaining = readBudgetChars(
      extras.config.selectedModelByRole.chat?.contextLength,
    );
    const bounded = [];
    for (const item of results) {
      if (remaining <= 400) break;
      const content =
        item.content.length > remaining
          ? item.content.slice(0, remaining) + "\n…[truncated; use read_symbol/read_file for more]"
          : item.content;
      remaining -= content.length;
      bounded.push({ ...item, content });
    }
    return bounded;
  } catch (error) {
    return [
      {
        name: "Error",
        description: "Codebase search error",
        content: `Failed to search codebase: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
};
