import Parser from "web-tree-sitter";

import { localPathOrUriToPath } from "../util/pathToUri";

/** Older entries are dropped (and their WASM trees freed) beyond this many states per document. */
const MAX_HISTORY_PER_DOCUMENT = 4;

function freeTree(tree: Parser.Tree | undefined) {
  try {
    (tree as { delete?: () => void } | undefined)?.delete?.();
  } catch {
    // already freed
  }
}

/** URIs and plain paths of the same file must map to one entry. */
function keyOf(documentPath: string): string {
  return localPathOrUriToPath(documentPath);
}

/**
 * Singleton class that keeps track of a map of document paths to their history.
 * The point here is to prevent re-calculating the AST,
 * and to preserve an older, original state of the document before any user edits.
 */
export class DocumentHistoryTracker {
  private static instance: DocumentHistoryTracker | null = null;

  // Map from document path to history (LIFO stack where newest representation is at the front).
  private documentAstMap: Map<string, Parser.Tree[]>;
  private documentContentHistoryMap: Map<string, string[]>;

  private constructor() {
    this.documentAstMap = new Map<string, Parser.Tree[]>();
    this.documentContentHistoryMap = new Map<string, string[]>();
  }

  /**
   * Get the singleton instance of DocumentHistoryTracker.
   */
  public static getInstance(): DocumentHistoryTracker {
    if (!DocumentHistoryTracker.instance) {
      DocumentHistoryTracker.instance = new DocumentHistoryTracker();
    }

    return DocumentHistoryTracker.instance;
  }

  /**
   * Add a document and its first state to the tracker.
   *
   * @param documentPath The path of the document.
   * @param documentContent The first content of the document.
   * @param ast The first AST of the document.
   */
  public addDocument(
    documentPath: string,
    documentContent: string,
    ast: Parser.Tree,
  ): void {
    const key = keyOf(documentPath);
    // Replacing an entry must release the trees it held (they live in WASM memory).
    this.documentAstMap.get(key)?.forEach(freeTree);
    this.documentAstMap.set(key, [ast]);
    this.documentContentHistoryMap.set(key, [documentContent]);
  }

  /** True when the document is tracked. Use this instead of probing the getters (which log). */
  public hasDocument(documentPath: string): boolean {
    return this.documentAstMap.has(keyOf(documentPath));
  }

  /** True when the newest tracked state equals `content` (nothing to re-parse or push). */
  public isLatestContent(documentPath: string, content: string): boolean {
    return (
      this.documentContentHistoryMap.get(keyOf(documentPath))?.[0] === content
    );
  }

  /**
   * Push a new AST to an existing document's history stack.
   *
   * @param documentPath The path of the document.
   * @param documentContent The new content to push to the document's history stack.
   * @param ast The new AST to push to the document's history stack.
   * @throws Error if the document doesn't exist in the tracker.
   */
  public push(
    documentPath: string,
    documentContent: string,
    ast: Parser.Tree,
  ): void {
    const key = keyOf(documentPath);
    const astHistory = this.documentAstMap.get(key);
    const documentHistory = this.documentContentHistoryMap.get(key);

    if (!astHistory || !documentHistory) {
      console.error(`Document ${documentPath} not found in AST tracker`);
      this.addDocument(documentPath, documentContent, ast);
      return; // Early return - document was added with initial state
    }

    // Only execute this if the arrays already existed
    astHistory.unshift(ast);
    documentHistory.unshift(documentContent);

    // Keep memory bounded: drop (and free) the oldest states.
    while (astHistory.length > MAX_HISTORY_PER_DOCUMENT) {
      freeTree(astHistory.pop());
    }
    while (documentHistory.length > MAX_HISTORY_PER_DOCUMENT) {
      documentHistory.pop();
    }
  }

  /**
   * Get the most recent AST of a document.
   *
   * @param documentPath The path of the document.
   * @returns The most recent AST of the document.
   * @throws Error if the document doesn't exist in the tracker.
   */
  public getMostRecentAst(documentPath: string): Parser.Tree | null {
    const astHistory = this.documentAstMap.get(keyOf(documentPath));

    if (!astHistory) {
      console.error(`Document ${documentPath} not found in AST tracker`);
      return null;
    }
    if (astHistory.length === 0) {
      console.error(`Document ${documentPath} has no ASTs`);
      return null;
    }

    // Return the first element (most recent AST).
    return astHistory[0];
  }

  /**
   * Get the most recent AST of a document.
   *
   * @param documentPath The path of the document.
   * @returns The most recent document history of the document.
   * @throws Error if the document doesn't exist in the tracker.
   */
  public getMostRecentDocumentHistory(documentPath: string): string | null {
    const documentHistory = this.documentContentHistoryMap.get(
      keyOf(documentPath),
    );

    if (!documentHistory) {
      console.error(`Document ${documentPath} not found in AST tracker`);
      return null;
    }
    if (documentHistory.length === 0) {
      console.error(`Document ${documentPath} has no history`);
      return null;
    }

    // Return the first element (most recent doc history).
    return documentHistory[0];
  }

  /**
   * Delete a document from the tracker.
   *
   * @param documentPath The path of the document to delete.
   */
  public deleteDocument(documentPath: string): void {
    const key = keyOf(documentPath);
    this.documentAstMap.get(key)?.forEach(freeTree); // safe to call twice: map entry is gone after
    this.documentAstMap.delete(key);
    this.documentContentHistoryMap.delete(key);
  }

  /**
   * Clear all documents from the tracker.
   */
  public clearMap(): void {
    this.documentAstMap.forEach((trees) => trees.forEach(freeTree));
    this.documentAstMap.clear();
    this.documentContentHistoryMap.clear();
  }
}
