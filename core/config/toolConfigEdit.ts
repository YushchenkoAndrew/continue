import { isMap, isScalar, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";

export interface ConfigEditResult {
  /** Full file text after the edit (identical to the input when nothing changed). */
  text: string;
  changed: boolean;
  /** Why nothing changed, when `changed` is false. */
  reason?:
    | "already-present"
    | "model-not-found"
    | "ambiguous-model"
    | "unsupported-layout"
    | "parse-error";
  /** The lines that were added, for display in a review. */
  added?: string;
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

function lineEnd(text: string, offset: number): number {
  const i = text.indexOf("\n", offset);
  return i === -1 ? text.length : i;
}

function indentOf(text: string, offset: number): string {
  const start = lineStart(text, offset);
  const m = /^[ \t]*/.exec(text.slice(start, offset));
  return m ? m[0] : "";
}

/**
 * Adds one entry to a model's `capabilities` list with a minimal text insertion.
 * Everything else in the file (comments, ordering, quoting, blank lines) is preserved
 * byte for byte; the YAML parser is only used to find where to insert.
 */
export function addModelCapability(
  yamlText: string,
  modelName: string,
  capability: string,
): ConfigEditResult {
  const unchanged = (reason: ConfigEditResult["reason"]): ConfigEditResult => ({
    text: yamlText,
    changed: false,
    reason,
  });

  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return unchanged("parse-error");
  }

  const models = doc.get("models", true);
  if (!isSeq(models)) {
    return unchanged("model-not-found");
  }

  const matches = (models as YAMLSeq).items.filter(
    (item): item is YAMLMap => isMap(item) && item.get("name") === modelName,
  );
  if (matches.length === 0) {
    return unchanged("model-not-found");
  }
  if (matches.length > 1) {
    return unchanged("ambiguous-model");
  }
  const model = matches[0];
  const eol = yamlText.includes("\r\n") ? "\r\n" : "\n";

  const caps = model.get("capabilities", true);
  if (caps !== undefined && caps !== null) {
    if (!isSeq(caps) || !caps.range) {
      return unchanged("unsupported-layout");
    }
    const values = caps.items.map((i) => (isScalar(i) ? i.value : undefined));
    if (values.includes(capability)) {
      return unchanged("already-present");
    }

    if (caps.flow) {
      // capabilities: [image_input]  ->  capabilities: [image_input, tool_use]
      const [start, valueEnd, nodeEnd] = caps.range;
      const end = Math.max(valueEnd, nodeEnd);
      const close = yamlText.lastIndexOf("]", end);
      if (close < start) {
        return unchanged("unsupported-layout");
      }
      const before = yamlText.slice(start, close).trimEnd();
      const insertion =
        caps.items.length === 0
          ? capability
          : before.endsWith(",")
            ? ` ${capability}`
            : `, ${capability}`;
      const insertAt = start + before.length;
      return {
        text:
          yamlText.slice(0, insertAt) + insertion + yamlText.slice(insertAt),
        changed: true,
        added: capability,
      };
    }

    // Block sequence: add "- tool_use" after the last item, with the same indentation.
    const last = caps.items[caps.items.length - 1];
    if (!last || !isScalar(last) || !last.range) {
      return unchanged("unsupported-layout");
    }
    const first = last.range[0];
    const indent = /^[ \t]*/.exec(
      yamlText.slice(lineStart(yamlText, first), first),
    )![0];
    let at = lineEnd(yamlText, Math.max(last.range[1] - 1, first));
    if (yamlText[at - 1] === "\r") at -= 1;
    const line = `${indent}- ${capability}`;
    return {
      text: yamlText.slice(0, at) + eol + line + yamlText.slice(at),
      changed: true,
      added: line.trimStart(),
    };
  }

  // No capabilities key: add one after the model's `name:` line, matching its indentation.
  const nameNode = model.items.find(
    (p) => isScalar(p.key) && p.key.value === "name",
  );
  const nameRange =
    nameNode && isScalar(nameNode.value) ? nameNode.value.range : null;
  const nameKey =
    nameNode && isScalar(nameNode.key) ? nameNode.key.range : null;
  if (!nameRange || !nameKey || model.flow) {
    return unchanged("unsupported-layout");
  }
  // Sibling keys align with the `name` key itself (which may follow a "- " marker).
  const siblingIndent = " ".repeat(
    nameKey[0] - lineStart(yamlText, nameKey[0]),
  );
  let at = lineEnd(yamlText, Math.max(nameRange[1] - 1, nameRange[0]));
  if (yamlText[at - 1] === "\r") at -= 1;
  const text = `${eol}${siblingIndent}capabilities:${eol}${siblingIndent}  - ${capability}`;
  return {
    text: yamlText.slice(0, at) + text + yamlText.slice(at),
    changed: true,
    added: `capabilities:\n  - ${capability}`,
  };
}
