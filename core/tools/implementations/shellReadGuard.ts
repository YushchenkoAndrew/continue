/**
 * Small local models reach for grep/cat/sed in the terminal even though indexed
 * search and bounded read tools exist. This detects pure read/search/edit shell
 * commands and returns a short pointer to the right tool instead of running them.
 */

const SEARCH_TOOLS = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack"]);
const READ_TOOLS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "bat",
  "nl",
]);

function firstSegment(command: string): string {
  // Only the first pipeline stage matters: `npm test | grep FAIL` must pass.
  const m = command.trim().split(/\s*(?:\|\||&&|\||;)\s*/);
  return m[0] ?? "";
}

function tokens(segment: string): string[] {
  return segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

export function shellReadGuardMessage(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed || trimmed.includes("\n")) return undefined;
  const seg = firstSegment(trimmed);
  const toks = tokens(seg);
  if (toks.length === 0) return undefined;
  // strip leading env assignments / sudo
  while (toks.length && (/^\w+=/.test(toks[0]) || toks[0] === "sudo"))
    toks.shift();
  const cmd = (toks[0] ?? "").replace(/^.*\//, "");
  const rest = toks.slice(1);
  const hasRedirect = /(^|\s)\d?>{1,2}\s*\S/.test(seg);

  if (SEARCH_TOOLS.has(cmd)) {
    return "Do not search with the terminal. Use grep_search for exact text/regex, codebase for semantic search, or file_outline/find_references for symbols.";
  }
  if (cmd === "find" && !rest.some((t) => /^-(exec|delete|ok)/.test(t))) {
    return "Do not use find in the terminal. Use file_glob_search to locate files, or ls for a directory.";
  }
  if (READ_TOOLS.has(cmd) && !hasRedirect) {
    return "Do not read files with the terminal. Use read_file (optionally startLine/endLine), read_symbol, or file_outline.";
  }
  if (cmd === "sed" || cmd === "perl") {
    const inPlace = rest.some((t) => /^-[a-zA-Z]*i/.test(t));
    if (inPlace) {
      return "Do not edit files with sed/perl. Use replace_lines, insert_lines, multi_edit or apply_patch.";
    }
    if (cmd === "sed" && rest.includes("-n")) {
      return "Do not read line ranges with sed. Use read_file with startLine/endLine.";
    }
  }
  if (
    cmd === "awk" &&
    !hasRedirect &&
    rest.length > 0 &&
    !rest.some((t) => t.includes("-i"))
  ) {
    return undefined; // awk is often used for data processing; allow
  }
  if (
    (cmd === "cat" || cmd === "echo" || cmd === "printf" || cmd === "tee") &&
    hasRedirect
  ) {
    return "Do not write files with shell redirection. Use create_new_file for new files, or replace_lines/insert_lines/multi_edit/apply_patch for existing ones.";
  }
  return undefined;
}
