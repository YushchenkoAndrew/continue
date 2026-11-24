# Continue — Local Agent Edition

A fork of [Continue](https://github.com/continuedev/continue) for people who run the agent on a **small local model with a small context window** (for example Gemma 4 26B-A4B on llama.cpp at 32-64K). Autocomplete is unchanged. The agent tooling is rewritten so that it works inside that budget.

The upstream project is read-only and no longer maintained; this fork keeps it usable. License: Apache-2.0.

## What was wrong, and what changed

| Problem with a 32K model                                                       | What this fork does                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large files crash the agent or get "too large" errors                          | `read_file` returns a **window** sized to ~18% of the model's context, with line numbers and a note saying which `startLine` to use next. It never errors on size. `file_outline` and `read_symbol` let the model read one function or class instead of the file. |
| Edits rewrite whole files, slowly                                              | New small-footprint edits: `replace_lines`, `insert_lines`, `multi_edit`, and `apply_patch` (context-anchored, multi-file, all-or-nothing). No LLM "apply" step. The legacy whole-file edit tools are off by default.                                             |
| The model greps/seds in the terminal instead of using the index                | A terminal guard rejects `grep`, `rg`, `cat`, `head`, `tail`, `find`, `sed -n` and `sed -i` with a message pointing at the right tool. Search tools are cheaper and always allowed.                                                                               |
| New chat means the agent forgets everything                                    | Per-project memory files, task state, and automatic **context compaction** that keeps the latest request verbatim.                                                                                                                                                |
| Endless thinking / repeating the same step                                     | Loop detection aborts the stream, retries once without reasoning, and refuses a third identical tool call.                                                                                                                                                        |
| Slow, shallow code navigation                                                  | VS Code language-server tools (definition, references, rename, call hierarchy, ...) and a cheap project graph.                                                                                                                                                    |
| Autocomplete misses what is above the window; stalls on slow context sources   | Cheap structural context for autocomplete (enclosing scope, imports, nearby declarations), per-source time budgets, no extra model calls. See [Autocomplete](#autocomplete).                                                                                      |
| Large-file edits feel slow; `Document ... not found in AST tracker` errors     | Diffs run only on the changed region, the editor is written only for the changed lines, and the AST tracker lifecycle is fixed. See [Edit performance](#edit-performance).                                                                                        |
| Big tasks lose their thread; the agent guesses instead of asking               | `update_plan` checklist with progress, `ask_user` questions in the chat, and `AI-TASK` markers for unfinished work. See [Planning and questions](#planning-and-questions).                                                                                        |
| The agent ends an implementation request with analysis; no idea how far it got | An execution guard that pushes analysis-only answers into the change, a live **Implementation Progress** panel, and short live activity titles. See [Progress and execution](#progress-and-execution).                                                            |

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
- `update_plan` — see [Planning and questions](#planning-and-questions); the plan is stored in the same `task.md`.
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

## Planning and questions

Both tools add one short schema each to the agent's tool list; they cost nothing else unless the model calls them.

- **`update_plan`** is for complex work (the description tells the model to skip it for simple tasks). The first call creates a checklist (objective, approach, affected files, steps with optional dependencies, risks, completion criteria). Later calls send only `set:[{step,status}]`, so the plan is updated, not recreated. The chat shows it as a checklist with `Progress: n/N`. The plan lives in `.continue/memory/task.md` (sections `plan`, `approach`, `criteria`, `risks`, plus `done` and `remaining`, which are kept in step), so a new chat can resume it through `get_task_state`. When the conversation is compacted, the latest checklist is copied into the summary verbatim.
- **`ask_user`** shows a form in the chat: multiple choice (single or multiple), free text, and a custom answer next to the options. It needs no approval, the agent waits, and when you answer the same task continues. At most **6 questions per task** (counted since your last typed message); after that the call is refused and the agent is told to choose a default and state it.
- **`AI-TASK` markers.** For multi-stage work that may span sessions the agent leaves `// AI-TASK [INCOMPLETE]: <what remains>` at the unfinished spot. It is told to search for existing markers first (no duplicates) and to remove one only after verifying the work. When every plan step is `done`, `update_plan` searches the workspace for remaining markers and reports them instead of "all steps done". Markers are ordinary comments you can grep for or delete.

## Progress and execution

None of this adds an LLM call, and nothing is added to the request when you are not asking for an implementation.

- **Execution guard.** In agent mode, a request that asks to implement, fix or change something gets a short extra instruction: reading is preparation, call `update_plan` after reading for multi-step work, and mark steps done only after changing files. If the model ends a turn without having changed anything ("I am ready to implement..."), the partial answer is discarded and the turn is re-run once or twice with an instruction to make the change, state exactly what is missing, or ask with `ask_user`. After 6 reads (10 for simple requests) without a plan or a change, the model is told to stop exploring. A plan with open steps and no blocked step gets a "continue" push instead of ending the turn. Questions and pure analysis requests are left alone. The same detection is used for any project; nothing is specific to one scenario.
- **Execution state, separate from the plan.** The panel is driven by a state derived from what actually happened in the task (finished tool calls, their errors, pending questions, the stream), not by text the model writes. `update_plan` supplies only the step list. A step counts as completed only through a real change: `update_plan` refuses to mark an edit step done when no file was changed since the last plan update, and a started or failed tool call never advances anything. "Review the changes" completes after a read-only check following the last change (or the final answer), and "Report" only after the final answer; if the agent asks you something it shows **Waiting for your input**, an errored last call shows **Failed**, an unfinished stopped task shows **Paused**. A step can be `pending`, `in_progress`, `done` or `blocked`; a blocked step needs a short note.
- **Implementation Progress panel.** Above the input: `Agent task — Executing`, `done / total`, a progress bar, and a step list (Analyze, Create the plan, your plan steps, Review, Report) with the current step and its live activity highlighted and blocked steps with their note. It appears as soon as the agent uses tools for a larger task, even before a plan exists; small tasks get a one-line summary instead. It is derived from the chat history, so it survives switching conversations and compaction (the plan is also stored in `.continue/memory/task.md`, and a new chat that continues earlier work is pointed at it and resumes at the first unfinished step). It re-renders only when the state changes.
- **Plan fields are normalised, not rejected.** `update_plan` flattens multi-line or code-fenced text in `objective`, `approach`, `risks`, `files` and step text, and trims long text, so a verbose field can no longer make the whole plan fail. Secrets are still refused.
- **Activity titles.** While the agent is working, the toolbar shows a short, specific title instead of "Generating": the running tool with its file or query ("Reading user.service.ts", "Searching for 'stages'"), "Writing the response", the current plan step, or "Analyzing the request" while the model is thinking. Titles are derived from tool names and arguments locally; nothing is shown when idle.

## Tool configuration notice

On startup and whenever the chat model changes, the extension checks whether your configuration needs a change for the agent tools. Tools that register themselves (every built-in tool) never ask for anything. The one check today: if the chat model is not recognised as tool-capable and has no `tool_use` capability, the agent falls back to describing tools in the prompt, which costs tokens and is less reliable with small local models.

When that applies, a notice appears above the input with **Review changes**, **Update configuration** and **Later**:

- **Review changes** shows exactly what would be added.
- **Update configuration** inserts one `- tool_use` line (or a `capabilities:` block) under your model in the active `config.yaml`. Nothing else in the file is touched: comments, order and formatting stay as they are. Nothing is changed in VS Code `settings.json`.
- **Later** hides the notice for a day. A change you applied or dismissed is never offered again, and a configuration that already works shows nothing.
- If the file cannot be edited (read-only, managed by Nix or Home Manager, or the model comes from a hub block), the notice shows the lines to add by hand instead. Edit your Nix source to include `capabilities: [tool_use]` for the model.

## Chat appearance

The chat panel uses a quiet, text-first layout that follows the active VS Code theme (light, dark or high contrast); no colours are hard-coded. Messages and the composer use a thin neutral border and a faint fill derived from the editor foreground (`--chat-border`, `--chat-fill`, `--chat-radius` in `gui/src/index.css`). Sent messages are a soft block, tool calls and thinking are single muted lines, and while the model is working the composer border pulses once per couple of seconds instead of cycling through colours. The progress panel, tool-configuration notice and `ask_user` form share the same surface. A one-line header above an ongoing conversation shows its title, the model and a "new session" button. With no bookmarked slash commands the empty chat offers four starting points that only fill the composer. In a wide editor tab the conversation is kept to a readable width. No setting is needed.

## Autocomplete

The prompt format (FIM) and the number of tokens are unchanged; what changed is what fills the existing budget and how long it takes to gather.

- **Structural context.** For code that fell outside the prompt window, autocomplete adds a short block: the enclosing scope chain (class/function headers up the indentation), the file's imports, and nearby sibling declarations. It is pure string work, with no parsing, I/O or model call, and is capped at half of the remaining prompt budget (max ~1600 characters).
- **Time budgets.** Import definitions, root-path context, opened files, clipboard and static context each have a 60-120 ms budget; a source that is slow is skipped for that request instead of delaying the suggestion. Completions that continue the middle of a line also skip clipboard and opened-file context.
- **Opened files** are cached for 5 s (shared in-flight reads), limited to the 4 most recent, instead of being re-read on every keystroke.
- **Deterministic prompts.** Snippet order is no longer shuffled, so identical situations give identical prompts.
- **Cancellation.** A request aborted while context was being gathered never starts inference. The parse tree is freed after each request.
- **Measuring.** Each outcome carries `contextTime` (ms before inference starts) next to `time`.

## Edit performance

- The line diff trims the unchanged start and end of the file first and diffs only the changed region.
- Applying a diff replaces only the changed lines in the editor (falls back to the whole range if the document is not in the expected state), so the language server and tokenizer are not re-fed the entire file.
- The full new file text is no longer sent to the chat UI a second time when an edit starts; the final text arrives once, at the end.
- If an edit takes 400 ms or more, a single line is logged to the extension host output: `[perf] instantApplyDiff 812ms (diff=40ms, edit+decorate=700ms, ...)`. Nothing is logged for fast edits.

The Next Edit AST tracker no longer holds a parse tree per file revision forever (trees are freed and history is capped at 4), file paths are normalised so a document is found whichever form of its URI is used, and Next Edit work (chain reset, cursor-move handling, editor-change handling) is skipped entirely when Next Edit is not enabled.

## Slow-loading local models

A large local model can take a minute or more to load on the first request. llama.cpp keeps the HTTP request open while it loads, so the client has to wait instead of treating the silence as a failure.

- **Cause fixed:** `requestOptions.timeout` is in seconds, but it was handed to the OpenAI client, which expects milliseconds. `timeout: 1800` therefore became 1.8 s, the client cancelled the request, then re-sent it twice more; on the server this appears as repeated `request cancelled while waiting for model` lines.
- **Separate limits** (all in seconds, all optional, `0` disables one):
  - `connectTimeout`: opening the connection. Not limited by default.
  - `firstTokenTimeout`: the server accepted the request but has not produced any output yet (model loading, prompt processing; the headers alone do not end the wait). Default **600** for localhost, private-network and bare host names; unlimited for remote hosts.
  - `idleTimeout`: no data for this long in the middle of a response. Default **300** for the same local hosts; unlimited for remote hosts.
  - `timeout`: the whole request, start to end. Not limited unless set.
- Remote providers keep their previous behaviour unless you set these explicitly.
- Local requests are never re-sent automatically: the OpenAI client's connection retries are off for local hosts so a slow request can't turn into a duplicate generation. Cancelling still works at every stage.
- While a response has produced nothing for 4 seconds the chat shows `Waiting for the model to respond (Ns)`. This is derived from the chat state; nothing polls the server.
- When a limit is hit the error names the limit and the setting to raise.

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
- `requestOptions.timeout` is in **seconds** and limits the whole request. For slow local models see "Slow-loading local models" above; the defaults already allow a 10 minute model load.
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
- The structural autocomplete context is indentation-based; it is least precise for files that mix tabs and spaces or put declarations on continuation lines.
- `ask_user` only works in the chat UI (not in the CLI).
- The JetBrains plugin and CLI were not changed.

## Upstream

Documentation for the original project: [docs.continue.dev](https://docs.continue.dev). Thanks to the Continue contributors whose work this builds on.
