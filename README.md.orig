# Continue — Local Agent Edition

A fork of [Continue](https://github.com/continuedev/continue) for people who run the agent on a **small local model with a small context window** (for example Gemma 4 26B-A4B on llama.cpp at 32K). Autocomplete is unchanged. The agent tooling is rewritten so that it works inside that budget.

The upstream project is read-only and no longer maintained; this fork keeps it usable. License: Apache-2.0.

## What was wrong, and what changed

| Problem with a 32K model                                        | What this fork does                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large files crash the agent or get "too large" errors           | `read_file` returns a **window** sized to ~18% of the model's context, with line numbers and a note saying which `startLine` to use next. It never errors on size. `file_outline` and `read_symbol` let the model read one function or class instead of the file. |
| Edits rewrite whole files, slowly                               | New small-footprint edits: `replace_lines`, `insert_lines`, `multi_edit`, and `apply_patch` (context-anchored, multi-file, all-or-nothing). No LLM "apply" step. The legacy whole-file edit tools are off by default.                                             |
| The model greps/seds in the terminal instead of using the index | A terminal guard rejects `grep`, `rg`, `cat`, `head`, `tail`, `find`, `sed -n` and `sed -i` with a message pointing at the right tool. Search tools are cheaper and always allowed.                                                                               |
| New chat means the agent forgets everything                     | Per-project memory files, task state, and automatic **context compaction** that keeps the latest request verbatim.                                                                                                                                                |
| Endless thinking / repeating the same step                      | Loop detection aborts the stream, retries once without reasoning, and refuses a third identical tool call.                                                                                                                                                        |
| Slow, shallow code navigation                                   | VS Code language-server tools (definition, references, rename, call hierarchy, ...) and a cheap project graph.                                                                                                                                                    |

## Tools

Defaults are intentionally short to keep token cost low. Policies shown are the defaults; change them in Continue's tool settings.

**Read and navigate** (no permission needed)

- `read_file` — windowed, numbered, never "too large".
- `file_outline` — symbols with line ranges. `read_symbol` — one symbol's body.
- `codebase` — semantic search over the index, output bounded by the read budget.
- `file_glob_search`, `grep_search`, `ls`, `view_diff`, `read_currently_open_file`.

**Language intelligence** (VS Code providers; needs the language extension for your language)

- `find_definition`, `find_references`, `get_type_definition`, `get_implementations`, `get_hover_info`, `get_call_hierarchy`.
- Results are paginated (`limit` default 20, max 50, `offset`). Target a symbol with `symbol` plus optional `line`, or with `line` plus `column`.
- `rename_symbol` — computes the rename edits and opens them in Continue's normal diff review, one file at a time. It never applies anything silently.

**Project understanding** (no LLM calls, no extra services)

- `project_map` — layout, entry points, manifests, key directories.
- `dependency_graph` — import edges for a file or the project. Edges from resolved import statements are verified and carry line numbers; text-match fallbacks are labelled `INFERRED`.
- `prepare_context` — for a task description, gathers relevant files, outlines, imports, references, name-matched tests, memory and docs pointers in one bounded result.

**Editing** (all go through Continue's existing diff review)

- `replace_lines`, `insert_lines` — line-addressed, line-number prefixes from `read_file` are stripped automatically.
- `apply_patch` — `*** Begin Patch` / `*** Update File:` / `@@ anchor` / `*** Add File:` format. Exact match first, then whitespace-tolerant with re-indent. Ambiguous or stale hunks are rejected with a message, not guessed. Line endings and trailing newline are preserved. Multi-file patches are reviewed file by file.
- `multi_edit`, `create_new_file`.

**Memory** (stored in `<workspace>/.continue/memory/`)

- `get_project_memory`, `update_project_memory` — durable conventions and facts (`project.md`).
- `save_task_state`, `get_task_state` — progress for the current task (`task.md`).
- Entries are tagged `[verified]` or `[assumed]`, deduplicated, capped (25 per section, 300 chars each, 6000 per file). Secrets and code blocks are rejected. A one-line hint is added to the system message only when these files exist.

**Web** (default: ask permission)

- `web_search` — DuckDuckGo HTML endpoint, no API key. Queries containing secrets or code are refused, so private source never reaches the provider. An optional `library` argument looks up the installed version from your lockfile/manifest.
- `fetch_url` — HTTP(S) only. Local and private-network addresses are rejected (DNS result and every redirect are re-checked), 15 s timeout, 2 MB cap, readable text as markdown, labelled as untrusted content.

**Verification** (never automatic)

- `find_tests` — locate relevant tests by name/import. `run_tests`, `run_checks` (lint, typecheck, build) — commands are picked from your project's scripts/config and run without a shell, 5 minute timeout, condensed output (full log by `logId`).
- `run_tests`/`run_checks` are refused unless **your latest message asks for them**. The agent is also told not to write tests unless asked.

## How the loop and context protections work

- **Loop guard.** A repeated tail block in the stream, or reasoning beyond ~20% of the context, aborts generation. The partial output is dropped, the request is retried once with reasoning off and a "take a concrete action" nudge. A second trip shows an error instead of spinning. A third identical consecutive tool call is refused.
- **Auto-compaction.** At ~70% context use (or after pruning), older steps are summarised into a briefing; the last two assistant steps and the latest user request are kept verbatim. This runs at most once per history length.
- **Read budget.** `clamp(18% of contextLength, 1200..12000)` tokens per read. It scales with the `contextLength` you set on the model.

## Setup

```bash
# build a VSIX (see BUILD_DEPENDENCIES.md for prerequisites)
npm install
cd extensions/vscode && npm run package   # produces build/*.vsix
codium --install-extension build/continue-*.vsix
```

Copy `config.yaml.example` to `~/.continue/config.yaml`. Notes:

- `contextLength` on the model must match your server's `--ctx-size`; the read budget and compaction thresholds derive from it.
- `capabilities: [tool_use]` is required for custom OpenAI-compatible endpoints.
- `requestOptions.timeout` is in **seconds**.
- Recommended llama.cpp flags (names vary by build): `--jinja`, `--reasoning-format deepseek`, `--reasoning-budget <N>`.
- To restore the legacy whole-file edit tools, enable experimental tools in Continue's settings.
- Nothing new is required in config; existing Continue configs keep working. No new services, background processes or settings were added.

## Limitations

- Language tools need a working language server in VS Code (they return nothing for languages without one). They are not available in the CLI or JetBrains builds.
- Only the first workspace root is indexed. The dependency graph is capped at 4000 source files and skips generated paths.
- Import resolution covers TS/JS, Python, Go, Rust, Ruby, Java/Kotlin/Scala, C-family, PHP and Dart; bare specifiers are tried relative to the workspace root and `src/` only; `tsconfig` `paths` aliases are not parsed, so those imports are treated as external.
- Rename and multi-file patches are reviewed per file; rejecting one aborts the remaining files.
- `web_search` scrapes DuckDuckGo's HTML endpoint and can rate-limit or change format.
- Compaction uses the same local model, so a summary costs one extra generation.
- The JetBrains plugin and CLI were not changed.

## Upstream

Documentation for the original project: [docs.continue.dev](https://docs.continue.dev). Thanks to the Continue contributors whose work this builds on.
