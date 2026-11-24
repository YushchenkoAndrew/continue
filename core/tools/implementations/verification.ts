import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ToolImpl } from ".";
import { IDE } from "../..";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { getProjectIndex } from "../projectIndex/projectIndex";
import {
  checkCommand,
  Command,
  condenseOutput,
  ProjectFacts,
  sanitizeRelativePaths,
  stripAnsi,
  testCommand,
  VerifyKind,
} from "../verification/verify";
import { readBudgetChars } from "./readBudget";

const TIMEOUT_MS = 5 * 60_000;
const MAX_LOG_BYTES = 2_000_000;

const logs = new Map<string, string>(); // id -> full output (last few runs)
function storeLog(text: string): string {
  const id = Math.random().toString(36).slice(2, 7);
  logs.set(id, text);
  if (logs.size > 6) logs.delete(logs.keys().next().value as string);
  return id;
}

async function projectFacts(
  ide: IDE,
): Promise<{ facts: ProjectFacts; cwd: string }> {
  const root = (await ide.getWorkspaceDirs())[0];
  if (!root) throw new Error("No workspace folder is open.");
  const index = await getProjectIndex(ide);
  const has = new Set(index.files.filter((f) => !f.includes("/")));
  const read = async (name: string) =>
    has.has(name)
      ? ide.readFile(`${root.replace(/\/$/, "")}/${name}`).catch(() => "")
      : "";

  let pkg: ProjectFacts["pkg"];
  const pj = await read("package.json");
  if (pj) {
    try {
      const j = JSON.parse(pj);
      pkg = {
        scripts: j.scripts,
        deps: Object.keys({ ...j.dependencies, ...j.devDependencies }),
      };
    } catch {
      /* invalid package.json */
    }
  }
  const lockfile = (
    ["pnpm-lock.yaml", "yarn.lock", "bun.lockb", "package-lock.json"] as const
  ).find((l) => has.has(l));
  const py = `${await read("requirements.txt")}\n${await read("pyproject.toml")}\n${await read("requirements-dev.txt")}`;
  const pythonDeps = ["pytest", "ruff", "flake8", "mypy"].filter((d) =>
    new RegExp(`\\b${d}\\b`).test(py),
  );
  return {
    facts: { pkg, lockfile, has, pythonDeps, goModule: has.has("go.mod") },
    cwd: fileURLToPath(root),
  };
}

function run(
  command: Command,
  cwd: string,
): Promise<{
  code: number | null;
  output: string;
  ms: number;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const start = Date.now();
    let output = "";
    let timedOut = false;
    // argv spawn, no shell: arguments cannot be interpreted as shell syntax
    const child = spawn(command.cmd, command.args, {
      cwd,
      shell: false,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    const add = (d: Buffer) => {
      if (output.length < MAX_LOG_BYTES) output += d.toString();
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        code: null,
        output: `Failed to start "${command.cmd}": ${e.message}`,
        ms: Date.now() - start,
        timedOut,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, ms: Date.now() - start, timedOut });
    });
  });
}

async function execute(
  command: Command,
  cwd: string,
  maxChars: number,
  ide: IDE,
) {
  const info = await ide.getIdeInfo();
  if (info.remoteName && info.remoteName !== "local") {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Not supported in remote workspaces. Ask the user to run: ${command.label}`,
    );
  }
  const res = await run(command, cwd);
  const clean = stripAnsi(res.output);
  const { summary, problems } = condenseOutput(clean);
  const id = storeLog(clean);
  const status = res.timedOut
    ? "TIMED OUT"
    : res.code === 0
      ? "PASSED"
      : `FAILED (exit ${res.code})`;
  let text = [
    `${command.label} → ${status} in ${(res.ms / 1000).toFixed(1)}s`,
    ...summary,
    ...(problems.length ? ["Problems:", ...problems.map((p) => `  ${p}`)] : []),
    res.code !== 0 && problems.length === 0
      ? `Last output:\n${clean.trim().split("\n").slice(-12).join("\n")}`
      : "",
    `[full log: logId="${id}", ${clean.length} chars; pass logId (and offset) to read it]`,
  ]
    .filter(Boolean)
    .join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n…[truncated]";
  return [{ name: "Verification", description: command.label, content: text }];
}

function readLog(args: any, maxChars: number) {
  const id = String(args.logId);
  const log = logs.get(id);
  if (log === undefined)
    throw new Error(
      `No stored log "${id}" (logs are kept for the last few runs only).`,
    );
  const offset = Math.max(0, Math.trunc(Number(args.offset)) || 0);
  const slice = log.slice(offset, offset + maxChars);
  const more =
    offset + slice.length < log.length
      ? `\n[continue with offset=${offset + slice.length}]`
      : "";
  return [{ name: "Log", description: `log ${id}`, content: slice + more }];
}

export const runTestsImpl: ToolImpl = async (args, extras) => {
  const max = readBudgetChars(
    extras.config.selectedModelByRole.chat?.contextLength,
  );
  if (args?.logId) return readLog(args, max);
  const files = sanitizeRelativePaths(args?.files);
  const name =
    typeof args?.name === "string" && /^[\w .:\-/\[\]]{1,120}$/.test(args.name)
      ? args.name
      : undefined;
  const { facts, cwd } = await projectFacts(extras.ide);
  const cmd = testCommand(facts, files, name);
  if (!cmd)
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "No test runner detected from the project's manifests. Ask the user for the command.",
    );
  return execute(cmd, cwd, max, extras.ide);
};

export const runChecksImpl: ToolImpl = async (args, extras) => {
  const max = readBudgetChars(
    extras.config.selectedModelByRole.chat?.contextLength,
  );
  if (args?.logId) return readLog(args, max);
  const kind = String(args?.kind ?? "") as VerifyKind;
  if (!["typecheck", "lint", "build"].includes(kind))
    throw new Error('kind must be "typecheck", "lint" or "build".');
  const files = sanitizeRelativePaths(args?.files);
  const { facts, cwd } = await projectFacts(extras.ide);
  const cmd = checkCommand(facts, kind, files);
  if (!cmd)
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `No ${kind} command found in the project's scripts/config. Ask the user for the command.`,
    );
  return execute(cmd, cwd, max, extras.ide);
};

const TEST_FILE =
  /(\.|_)(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.go$|(^|\/)(tests?|__tests__|spec)\//i;

function testTitles(content: string): string[] {
  const out: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < 8; i++) {
    const m = lines[i].match(
      /^\s*(?:describe|it|test)(?:\.each)?\s*\(\s*["'`]([^"'`]{1,80})|^\s*(?:async\s+)?def\s+(test_\w+)|^func\s+(Test\w+)|^\s*#\[test\]|^\s*fn\s+(test_\w+)/,
    );
    const title = m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4];
    if (title) out.push(`${i + 1}: ${title}`);
  }
  return out;
}

export const findTestsImpl: ToolImpl = async (args, extras) => {
  const index = await getProjectIndex(extras.ide);
  const files = sanitizeRelativePaths(args?.files);
  const symbols: string[] = (
    Array.isArray(args?.symbols)
      ? args.symbols
      : args?.symbols
        ? [args.symbols]
        : []
  )
    .map(String)
    .slice(0, 5);
  if (files.length === 0 && symbols.length === 0)
    throw new Error("Pass `files` and/or `symbols`.");

  const tests = index.files.filter((f) => TEST_FILE.test(f));
  const found = new Map<string, string[]>();
  const add = (t: string, why: string) =>
    (found.get(t) ?? found.set(t, []).get(t)!).push(why);

  for (const f of files) {
    const base = (f.split("/").pop() ?? f).replace(/\.[^.]+$/, "");
    for (const t of tests) {
      if (
        (t.split("/").pop() ?? "")
          .replace(/(\.|_)(test|spec)|^test_/g, "")
          .replace(/\.[^.]+$/, "") === base
      )
        add(t, `name matches ${f}`);
    }
    for (const e of index.importedBy.get(f) ?? []) {
      if (TEST_FILE.test(e.from))
        add(e.from, `imports ${f} (line ${e.line}, verified)`);
    }
  }
  if (symbols.length) {
    const re = new RegExp(
      `(?<![\\w$])(${symbols.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w$])`,
    );
    for (const t of tests.slice(0, 400)) {
      try {
        const content = await extras.ide.readFile(
          `${index.rootUri.replace(/\/$/, "")}/${t.split("/").map(encodeURIComponent).join("/")}`,
        );
        const m = content.match(re);
        if (m) add(t, `mentions ${m[1]}`);
      } catch {
        /* skip */
      }
    }
  }
  if (found.size === 0)
    return [
      {
        name: "Tests",
        description: "find_tests",
        content: "No related tests found by name, imports or symbol mentions.",
      },
    ];

  const rows: string[] = [];
  for (const [t, why] of [...found.entries()].slice(0, 12)) {
    let titles = "";
    try {
      const content = await extras.ide.readFile(
        `${index.rootUri.replace(/\/$/, "")}/${t.split("/").map(encodeURIComponent).join("/")}`,
      );
      const list = testTitles(content);
      titles = list.length ? `\n    ${list.join("\n    ")}` : "";
    } catch {
      /* skip */
    }
    rows.push(`${t}  — ${[...new Set(why)].join("; ")}${titles}`);
  }
  return [
    {
      name: "Tests",
      description: "find_tests",
      content: `${rows.join("\n")}\n(Not run. Run only if the user asks.)`,
    },
  ];
};
