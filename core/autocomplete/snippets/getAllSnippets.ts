import { IDE } from "../../index";
import { findUriInDirs } from "../../util/uri";
import { ContextRetrievalService } from "../context/ContextRetrievalService";
import { buildFileSkeleton } from "../context/fileSkeleton";
import { GetLspDefinitionsFunction } from "../types";
import { HelperVars } from "../util/HelperVars";
import { openedFilesLruCache } from "../util/openedFilesLruCache";
import { getDiffsFromCache } from "./gitDiffCache";

import {
  AutocompleteClipboardSnippet,
  AutocompleteCodeSnippet,
  AutocompleteDiffSnippet,
  AutocompleteSnippetType,
  AutocompleteStaticSnippet,
} from "./types";

const IDE_SNIPPETS_ENABLED = false; // ideSnippets is not used, so it's temporarily disabled

export interface SnippetPayload {
  rootPathSnippets: AutocompleteCodeSnippet[];
  importDefinitionSnippets: AutocompleteCodeSnippet[];
  ideSnippets: AutocompleteCodeSnippet[];
  recentlyEditedRangeSnippets: AutocompleteCodeSnippet[];
  recentlyVisitedRangesSnippets: AutocompleteCodeSnippet[];
  diffSnippets: AutocompleteDiffSnippet[];
  clipboardSnippets: AutocompleteClipboardSnippet[];
  recentlyOpenedFileSnippets: AutocompleteCodeSnippet[];
  staticSnippet: AutocompleteStaticSnippet[];
  /** Structural summary of the current file outside the prompt window (live completion path only). */
  fileSkeletonSnippets?: AutocompleteCodeSnippet[];
}

function racePromise<T>(promise: Promise<T[]>, timeout = 100): Promise<T[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T[]>((resolve) => {
    timer = setTimeout(() => resolve([]), timeout);
  });

  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timer),
  );
}

// Some IDEs might have special ways of finding snippets (e.g. JetBrains and VS Code have different "LSP-equivalent" systems,
// or they might separately track recently edited ranges)
async function getIdeSnippets(
  helper: HelperVars,
  ide: IDE,
  getDefinitionsFromLsp: GetLspDefinitionsFunction,
): Promise<AutocompleteCodeSnippet[]> {
  const ideSnippets = await getDefinitionsFromLsp(
    helper.input.filepath,
    helper.fullPrefix + helper.fullSuffix,
    helper.fullPrefix.length,
    ide,
    helper.lang,
  );

  if (helper.options.onlyMyCode) {
    const workspaceDirs = await ide.getWorkspaceDirs();

    return ideSnippets.filter((snippet) =>
      workspaceDirs.some(
        (dir) => !!findUriInDirs(snippet.filepath, [dir]).foundInDir,
      ),
    );
  }

  return ideSnippets;
}

function getSnippetsFromRecentlyEditedRanges(
  helper: HelperVars,
): AutocompleteCodeSnippet[] {
  if (helper.options.useRecentlyEdited === false) {
    return [];
  }

  return helper.input.recentlyEditedRanges.map((range) => {
    return {
      filepath: range.filepath,
      content: range.lines.join("\n"),
      type: AutocompleteSnippetType.Code,
    };
  });
}

const getClipboardSnippets = async (
  ide: IDE,
): Promise<AutocompleteClipboardSnippet[]> => {
  const content = await ide.getClipboardContent();

  return [content].map((item) => {
    return {
      content: item.text,
      copiedAt: item.copiedAt,
      type: AutocompleteSnippetType.Clipboard,
    };
  });
};

const getDiffSnippets = async (
  ide: IDE,
): Promise<AutocompleteDiffSnippet[]> => {
  const diffs = await getDiffsFromCache(ide);

  return diffs.map((item) => {
    return {
      content: item,
      type: AutocompleteSnippetType.Diff,
    };
  });
};

// Recently opened files were re-read through the IDE on every keystroke. Contents are cached
// briefly (and in-flight reads are shared), and only the most recent few are considered.
const OPENED_FILE_CACHE_TTL_MS = 5000;
const MAX_OPENED_FILES_READ = 4;
const openedFileContentCache = new Map<
  string,
  { at: number; promise: Promise<string | null> }
>();

function readOpenedFileCached(
  ide: IDE,
  fileUri: string,
): Promise<string | null> {
  const now = Date.now();
  const hit = openedFileContentCache.get(fileUri);
  if (hit && now - hit.at < OPENED_FILE_CACHE_TTL_MS) {
    return hit.promise;
  }
  const promise = ide.readFile(fileUri).catch(() => null as string | null);
  openedFileContentCache.set(fileUri, { at: now, promise });
  if (openedFileContentCache.size > 32) {
    // Drop the oldest entries; Map iterates in insertion order.
    for (const key of openedFileContentCache.keys()) {
      openedFileContentCache.delete(key);
      if (openedFileContentCache.size <= 16) break;
    }
  }
  return promise;
}

const getSnippetsFromRecentlyOpenedFiles = async (
  helper: HelperVars,
  ide: IDE,
): Promise<AutocompleteCodeSnippet[]> => {
  if (helper.options.useRecentlyOpened === false) {
    return [];
  }

  try {
    const currentFileUri = `${helper.filepath}`;

    const fileUrisToRead = [...openedFilesLruCache.entriesDescending()]
      .filter(([fileUri, _]) => fileUri !== currentFileUri)
      .map(([fileUri, _]) => fileUri)
      .slice(0, MAX_OPENED_FILES_READ);

    const results = await Promise.all(
      fileUrisToRead.map(async (fileUri) => {
        // Cut off at 80ms: a slow file is skipped for this request but keeps loading for the next.
        const content = await Promise.race([
          readOpenedFileCached(ide, fileUri),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 80)),
        ]);
        if (!content || content.trim() === "") {
          return null;
        }
        return {
          filepath: fileUri,
          content,
          type: AutocompleteSnippetType.Code,
        } as AutocompleteCodeSnippet;
      }),
    );

    return results.filter(Boolean) as AutocompleteCodeSnippet[];
  } catch (e) {
    console.error("Error processing opened files cache:", e);
    return [];
  }
};

const countLines = (text: string) =>
  text === "" ? 0 : text.split("\n").length;

/**
 * Enclosing scope / imports / nearby declarations of the current file that fell outside the
 * prompt window. Pure string work: no I/O, no parsing, no LLM.
 */
export function getFileSkeletonSnippets(
  helper: HelperVars,
): AutocompleteCodeSnippet[] {
  try {
    const caretChars = helper.prunedCaretWindow.length;
    const remainingChars = Math.max(
      0,
      helper.options.maxPromptTokens * 3.2 - caretChars,
    );
    const maxChars = Math.min(1600, Math.floor(remainingChars * 0.5));

    const content = buildFileSkeleton({
      fullPrefix: helper.fullPrefix,
      fullSuffix: helper.fullSuffix,
      prunedPrefixLines: countLines(helper.prunedPrefix),
      prunedSuffixLines: countLines(helper.prunedSuffix),
      maxChars,
    });
    return content
      ? [
          {
            filepath: helper.filepath,
            content,
            type: AutocompleteSnippetType.Code,
          },
        ]
      : [];
  } catch (e) {
    console.warn("Failed to build file skeleton:", e);
    return [];
  }
}

export const getAllSnippets = async ({
  helper,
  ide,
  getDefinitionsFromLsp,
  contextRetrievalService,
}: {
  helper: HelperVars;
  ide: IDE;
  getDefinitionsFromLsp: GetLspDefinitionsFunction;
  contextRetrievalService: ContextRetrievalService;
}): Promise<SnippetPayload> => {
  const recentlyEditedRangeSnippets =
    getSnippetsFromRecentlyEditedRanges(helper);

  const [
    rootPathSnippets,
    importDefinitionSnippets,
    ideSnippets,
    diffSnippets,
    clipboardSnippets,
    recentlyOpenedFileSnippets,
    staticSnippet,
  ] = await Promise.all([
    racePromise(contextRetrievalService.getRootPathSnippets(helper)),
    racePromise(
      contextRetrievalService.getSnippetsFromImportDefinitions(helper),
    ),
    IDE_SNIPPETS_ENABLED
      ? racePromise(getIdeSnippets(helper, ide, getDefinitionsFromLsp))
      : [],
    [], // racePromise(getDiffSnippets(ide)) // temporarily disabled, see https://github.com/continuedev/continue/pull/5882,
    racePromise(getClipboardSnippets(ide)),
    racePromise(getSnippetsFromRecentlyOpenedFiles(helper, ide)), // giving this one a little more time to complete
    helper.options.experimental_enableStaticContextualization
      ? racePromise(contextRetrievalService.getStaticContextSnippets(helper))
      : [],
  ]);

  return {
    rootPathSnippets,
    importDefinitionSnippets,
    ideSnippets,
    recentlyEditedRangeSnippets,
    diffSnippets,
    clipboardSnippets,
    recentlyVisitedRangesSnippets: helper.input.recentlyVisitedRanges,
    recentlyOpenedFileSnippets,
    staticSnippet,
  };
};

export const getAllSnippetsWithoutRace = async ({
  helper,
  ide,
  getDefinitionsFromLsp,
  contextRetrievalService,
}: {
  helper: HelperVars;
  ide: IDE;
  getDefinitionsFromLsp: GetLspDefinitionsFunction;
  contextRetrievalService: ContextRetrievalService;
}): Promise<SnippetPayload> => {
  const recentlyEditedRangeSnippets =
    getSnippetsFromRecentlyEditedRanges(helper);

  const [
    rootPathSnippets,
    importDefinitionSnippets,
    ideSnippets,
    diffSnippets,
    clipboardSnippets,
    recentlyOpenedFileSnippets,
    staticSnippet,
  ] = await Promise.all([
    contextRetrievalService.getRootPathSnippets(helper),
    contextRetrievalService.getSnippetsFromImportDefinitions(helper),
    IDE_SNIPPETS_ENABLED
      ? getIdeSnippets(helper, ide, getDefinitionsFromLsp)
      : [],
    [], // racePromise(getDiffSnippets(ide)) // temporarily disabled, see https://github.com/continuedev/continue/pull/5882,
    getClipboardSnippets(ide),
    getSnippetsFromRecentlyOpenedFiles(helper, ide),
    helper.options.experimental_enableStaticContextualization
      ? contextRetrievalService.getStaticContextSnippets(helper)
      : [],
  ]);

  return {
    rootPathSnippets,
    importDefinitionSnippets,
    ideSnippets,
    recentlyEditedRangeSnippets,
    diffSnippets,
    clipboardSnippets,
    recentlyVisitedRangesSnippets: helper.input.recentlyVisitedRanges,
    recentlyOpenedFileSnippets,
    staticSnippet,
  };
};

/** A completion that continues the middle of a line needs far less context than a new statement. */
function isLightCompletion(helper: HelperVars): boolean {
  const restOfLine = helper.fullSuffix.split("\n", 1)[0];
  return restOfLine.trim() !== "";
}

/**
 * Live completion path. Every source gets a time budget: a slow LSP lookup or file read no
 * longer holds the suggestion back, it just misses this request (and warms up for the next).
 * Cheap string-based context is always included; the expensive sources are skipped for
 * mid-line completions.
 */
export const getAllSnippetsBudgeted = async ({
  helper,
  ide,
  getDefinitionsFromLsp,
  contextRetrievalService,
}: {
  helper: HelperVars;
  ide: IDE;
  getDefinitionsFromLsp: GetLspDefinitionsFunction;
  contextRetrievalService: ContextRetrievalService;
}): Promise<SnippetPayload> => {
  const light = isLightCompletion(helper);
  const recentlyEditedRangeSnippets =
    getSnippetsFromRecentlyEditedRanges(helper);
  const skeletonSnippets = getFileSkeletonSnippets(helper);

  // Raced sources keep running after their budget expires; keep the parse tree alive for them.
  const trackBudget = <T>(p: Promise<T[]>, ms: number): Promise<T[]> => {
    helper.trackPending(p);
    // A failing source must not fail the whole completion.
    return racePromise(
      p.catch(() => [] as T[]),
      ms,
    );
  };

  const [
    rootPathSnippets,
    importDefinitionSnippets,
    ideSnippets,
    clipboardSnippets,
    recentlyOpenedFileSnippets,
    staticSnippet,
  ] = await Promise.all([
    trackBudget(contextRetrievalService.getRootPathSnippets(helper), 120),
    trackBudget(
      contextRetrievalService.getSnippetsFromImportDefinitions(helper),
      120,
    ),
    IDE_SNIPPETS_ENABLED
      ? racePromise(getIdeSnippets(helper, ide, getDefinitionsFromLsp))
      : [],
    light || !helper.options.experimental_includeClipboard
      ? []
      : racePromise(getClipboardSnippets(ide), 60),
    light
      ? []
      : racePromise(getSnippetsFromRecentlyOpenedFiles(helper, ide), 120),
    helper.options.experimental_enableStaticContextualization
      ? trackBudget(
          contextRetrievalService.getStaticContextSnippets(helper),
          120,
        )
      : [],
  ]);

  return {
    rootPathSnippets,
    fileSkeletonSnippets: skeletonSnippets,
    importDefinitionSnippets,
    ideSnippets,
    recentlyEditedRangeSnippets,
    diffSnippets: [],
    clipboardSnippets,
    recentlyVisitedRangesSnippets: helper.input.recentlyVisitedRanges,
    recentlyOpenedFileSnippets,
    staticSnippet,
  };
};
