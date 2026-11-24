import type {
  LanguageQuery,
  LanguageQueryCall,
  LanguageQueryLocation,
  LanguageQueryResult,
} from "core";
import * as vscode from "vscode";

const PROVIDER_COMMANDS: Partial<Record<LanguageQuery["kind"], string>> = {
  definition: "vscode.executeDefinitionProvider",
  references: "vscode.executeReferenceProvider",
  typeDefinition: "vscode.executeTypeDefinitionProvider",
  implementations: "vscode.executeImplementationProvider",
};

function toLocation(
  uri: vscode.Uri,
  range: vscode.Range,
): LanguageQueryLocation {
  return {
    filepath: uri.toString(),
    line: range.start.line,
    character: range.start.character,
    endLine: range.end.line,
    endCharacter: range.end.character,
  };
}

/** Accepts both Location and LocationLink results. */
function normalizeLocations(raw: any[] | undefined): LanguageQueryLocation[] {
  const out: LanguageQueryLocation[] = [];
  const seen = new Set<string>();
  for (const d of raw ?? []) {
    const uri: vscode.Uri | undefined = d?.targetUri ?? d?.uri;
    const range: vscode.Range | undefined =
      d?.targetSelectionRange ?? d?.targetRange ?? d?.range;
    if (!uri || !range) continue;
    const loc = toLocation(uri, range);
    const key = `${loc.filepath}:${loc.line}:${loc.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
  }
  return out;
}

function hoverText(hovers: vscode.Hover[] | undefined): string {
  const parts: string[] = [];
  for (const h of hovers ?? []) {
    for (const c of h.contents ?? []) {
      if (typeof c === "string") parts.push(c);
      else if ("value" in c) {
        const lang = (c as any).language;
        parts.push(lang ? `${c.value}` : c.value);
      }
    }
  }
  return parts
    .map((t) => t.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function symbolKindName(kind: vscode.SymbolKind): string {
  return (vscode.SymbolKind[kind] ?? "symbol").toLowerCase();
}

async function callHierarchy(
  uri: vscode.Uri,
  position: vscode.Position,
  direction: "incoming" | "outgoing",
): Promise<LanguageQueryCall[] | undefined> {
  const items = await vscode.commands.executeCommand<
    vscode.CallHierarchyItem[]
  >("vscode.prepareCallHierarchy", uri, position);
  if (!items || items.length === 0) return undefined;
  const item = items[0];
  const calls: LanguageQueryCall[] = [];
  if (direction === "incoming") {
    const incoming =
      (await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
        "vscode.provideIncomingCalls",
        item,
      )) ?? [];
    for (const c of incoming) {
      calls.push({
        name: c.from.name,
        kind: symbolKindName(c.from.kind),
        location: toLocation(c.from.uri, c.from.selectionRange),
        callSites: c.fromRanges.map((r) => toLocation(c.from.uri, r)),
      });
    }
  } else {
    const outgoing =
      (await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
        "vscode.provideOutgoingCalls",
        item,
      )) ?? [];
    for (const c of outgoing) {
      calls.push({
        name: c.to.name,
        kind: symbolKindName(c.to.kind),
        location: toLocation(c.to.uri, c.to.selectionRange),
        // fromRanges are call sites inside the *queried* function
        callSites: c.fromRanges.map((r) => toLocation(uri, r)),
      });
    }
  }
  return calls;
}

export async function runLanguageQuery(
  query: LanguageQuery,
): Promise<LanguageQueryResult> {
  const uri = vscode.Uri.parse(query.filepath);
  const position = new vscode.Position(query.line, query.character);
  try {
    // Providers only answer for documents the extension host knows about.
    await vscode.workspace.openTextDocument(uri);

    const command = PROVIDER_COMMANDS[query.kind];
    if (command) {
      const raw = await vscode.commands.executeCommand<any[]>(
        command,
        uri,
        position,
      );
      const locations = normalizeLocations(raw);
      return locations.length > 0
        ? { supported: true, locations }
        : {
            supported: true,
            locations: [],
            message: "The language provider returned no results.",
          };
    }

    switch (query.kind) {
      case "hover": {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          uri,
          position,
        );
        const text = hoverText(hovers);
        return text
          ? { supported: true, hover: text }
          : { supported: true, message: "No hover information at this position." };
      }
      case "incomingCalls":
      case "outgoingCalls": {
        const calls = await callHierarchy(
          uri,
          position,
          query.kind === "incomingCalls" ? "incoming" : "outgoing",
        );
        return calls
          ? { supported: true, calls }
          : {
              supported: false,
              message:
                "No call hierarchy provider for this file/position (or the position is not on a function/method).",
            };
      }
      case "rename": {
        if (!query.newName) {
          return { supported: true, message: "newName is required." };
        }
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
          "vscode.executeDocumentRenameProvider",
          uri,
          position,
          query.newName,
        );
        if (!edit) {
          return {
            supported: false,
            message: "No rename provider, or the position is not a renamable symbol.",
          };
        }
        // Never applied here: the GUI shows every file in the diff review.
        const edits = edit.entries().map(([u, textEdits]) => ({
          filepath: u.toString(),
          edits: textEdits.map((e) => ({
            ...toLocation(u, e.range),
            newText: e.newText,
          })),
        }));
        return { supported: true, edits };
      }
    }
    return { supported: false, message: `Unknown query ${query.kind}` };
  } catch (e) {
    return {
      supported: false,
      message: `Language provider error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
