/** Pure helpers for on-demand verification: intent gate, command selection, output condensing. */

export type VerifyKind = "typecheck" | "lint" | "build";

const TEST_WORDS =
  "tests?|specs?|test suite|unit tests?|jest|vitest|pytest|mocha|go test|cargo test";
const CHECK_WORDS =
  "build|compile|lint(?:er|ing)?|type-?check(?:ing)?|tsc|eslint|ruff|mypy|clippy|go vet|checks?";

const RUN_VERB = "(?:run|re-?run|execute|launch|kick off|start)";

/** True only when the user's own message asks for it. Used to gate run_tests/run_checks/find_tests. */
export function userRequestedVerification(
  userText: string,
  kind: "tests" | "checks" | "find-tests",
): boolean {
  const t = userText.toLowerCase();
  if (kind === "find-tests") return new RegExp(`\\b(${TEST_WORDS})\\b`).test(t);
  const words = kind === "tests" ? TEST_WORDS : CHECK_WORDS;
  const verbThenWord = new RegExp(
    `\\b${RUN_VERB}\\b[^.\\n]{0,60}\\b(?:${words})\\b`,
  );
  const wordThenVerb = new RegExp(
    `\\b(?:${words})\\b[^.\\n]{0,30}\\b(?:please|now|again)\\b|\\b(?:make sure|ensure|verify|check)\\b[^.\\n]{0,40}\\b(?:${words}|pass(?:es)?|work(?:s)?|compil(?:es|e)|builds?)\\b`,
  );
  return (
    verbThenWord.test(t) ||
    wordThenVerb.test(t) ||
    /\b(verify|validate)\b/.test(t)
  );
}

export const NOT_REQUESTED_MESSAGE =
  "Not run: the user has not asked to run tests/builds/linters. Do not run verification on your own. Finish the work, and offer to run the check in your reply.";

export interface Command {
  cmd: string;
  args: string[];
  label: string;
}

export interface ProjectFacts {
  pkg?: { scripts?: Record<string, string>; deps: string[] };
  lockfile?: "pnpm-lock.yaml" | "yarn.lock" | "bun.lockb" | "package-lock.json";
  has: Set<string>; // root file names present
  pythonDeps: string[];
  goModule?: boolean;
}

function nodeRunner(f: ProjectFacts): string {
  if (f.lockfile === "pnpm-lock.yaml") return "pnpm";
  if (f.lockfile === "yarn.lock") return "yarn";
  if (f.lockfile === "bun.lockb") return "bun";
  return "npm";
}

function scriptCmd(
  f: ProjectFacts,
  script: string,
  extra: string[] = [],
): Command {
  const runner = nodeRunner(f);
  const args =
    runner === "yarn"
      ? [script, ...extra]
      : ["run", script, ...(extra.length ? ["--", ...extra] : [])];
  return { cmd: runner, args, label: `${runner} ${args.join(" ")}` };
}

function nodeTestRunner(f: ProjectFacts): "vitest" | "jest" | undefined {
  const text = `${f.pkg?.scripts?.test ?? ""} ${f.pkg?.deps.join(" ") ?? ""}`;
  if (/\bvitest\b/.test(text)) return "vitest";
  if (/\bjest\b/.test(text)) return "jest";
  return undefined;
}

export function testCommand(
  f: ProjectFacts,
  files: string[],
  name?: string,
): Command | undefined {
  if (f.pkg) {
    const runner = nodeTestRunner(f);
    if (files.length || name) {
      if (runner === "vitest")
        return {
          cmd: "npx",
          args: ["vitest", "run", ...files, ...(name ? ["-t", name] : [])],
          label: `npx vitest run ${files.join(" ")}`,
        };
      if (runner === "jest")
        return {
          cmd: "npx",
          args: ["jest", ...files, ...(name ? ["-t", name] : [])],
          label: `npx jest ${files.join(" ")}`,
        };
    }
    if (f.pkg.scripts?.test) return scriptCmd(f, "test", files);
  }
  if (
    f.pythonDeps.includes("pytest") ||
    f.has.has("pytest.ini") ||
    f.has.has("tox.ini")
  ) {
    return {
      cmd: "python",
      args: [
        "-m",
        "pytest",
        "-q",
        "-x",
        ...files,
        ...(name ? ["-k", name] : []),
      ],
      label: `python -m pytest ${files.join(" ")}`,
    };
  }
  if (f.goModule) {
    const pkgs = [
      ...new Set(
        files.map((x) =>
          x.includes("/") ? `./${x.slice(0, x.lastIndexOf("/"))}` : ".",
        ),
      ),
    ];
    return {
      cmd: "go",
      args: [
        "test",
        ...(pkgs.length ? pkgs : ["./..."]),
        ...(name ? ["-run", name] : []),
      ],
      label: `go test ${(pkgs.length ? pkgs : ["./..."]).join(" ")}`,
    };
  }
  if (f.has.has("Cargo.toml"))
    return {
      cmd: "cargo",
      args: ["test", ...(name ? [name] : [])],
      label: "cargo test",
    };
  return undefined;
}

export function checkCommand(
  f: ProjectFacts,
  kind: VerifyKind,
  files: string[],
): Command | undefined {
  const scripts = f.pkg?.scripts ?? {};
  if (f.pkg) {
    if (kind === "lint") {
      if (
        files.length &&
        /eslint/.test(`${scripts.lint ?? ""} ${f.pkg.deps.join(" ")}`)
      ) {
        return {
          cmd: "npx",
          args: ["eslint", ...files],
          label: `npx eslint ${files.join(" ")}`,
        };
      }
      const s = ["lint", "eslint"].find((n) => scripts[n]);
      if (s) return scriptCmd(f, s);
    }
    if (kind === "typecheck") {
      const s = ["typecheck", "type-check", "tsc", "check-types", "check"].find(
        (n) => scripts[n],
      );
      if (s) return scriptCmd(f, s);
      if (f.has.has("tsconfig.json"))
        return {
          cmd: "npx",
          args: ["tsc", "--noEmit"],
          label: "npx tsc --noEmit",
        };
    }
    if (kind === "build" && scripts.build) return scriptCmd(f, "build");
  }
  if (f.pythonDeps.length || f.has.has("pyproject.toml")) {
    if (
      kind === "lint" &&
      (f.pythonDeps.includes("ruff") || f.has.has("ruff.toml"))
    )
      return {
        cmd: "ruff",
        args: ["check", ...files],
        label: `ruff check ${files.join(" ")}`,
      };
    if (kind === "lint" && f.pythonDeps.includes("flake8"))
      return { cmd: "flake8", args: files, label: "flake8" };
    if (kind === "typecheck" && f.pythonDeps.includes("mypy"))
      return { cmd: "mypy", args: files.length ? files : ["."], label: "mypy" };
  }
  if (f.goModule) {
    if (kind === "build")
      return { cmd: "go", args: ["build", "./..."], label: "go build ./..." };
    if (kind === "typecheck" || kind === "lint")
      return { cmd: "go", args: ["vet", "./..."], label: "go vet ./..." };
  }
  if (f.has.has("Cargo.toml")) {
    if (kind === "build")
      return { cmd: "cargo", args: ["build"], label: "cargo build" };
    if (kind === "typecheck")
      return { cmd: "cargo", args: ["check"], label: "cargo check" };
    if (kind === "lint")
      return { cmd: "cargo", args: ["clippy"], label: "cargo clippy" };
  }
  return undefined;
}

/** Reject arguments that could be read as options or escape the workspace. */
export function sanitizeRelativePaths(paths: unknown): string[] {
  const list = Array.isArray(paths) ? paths : paths ? [paths] : [];
  return list.slice(0, 20).map((p) => {
    const s = String(p).trim().replace(/^\.\//, "");
    if (
      !s ||
      s.startsWith("-") ||
      s.startsWith("/") ||
      /^[a-zA-Z]:/.test(s) ||
      s.split(/[\\/]/).includes("..")
    ) {
      throw new Error(
        `Invalid path "${s}": use paths relative to the workspace root.`,
      );
    }
    return s;
  });
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

const LOCATION =
  /^(?:\s*[-●✕×>]\s*)?(?:(?:FAILED|ERROR|FAIL)\s+)?([^\s:()'"]+\.[A-Za-z]{1,5})(?:[:(](\d+)(?:[:,](\d+))?\)?)/;
const SUMMARY =
  /(Tests?:\s.*|Test Files\s.*|\d+\s+(?:passed|failed|errors?)\b.*|^ok\s+\S+|^FAIL\s+\S+|Found \d+ errors?.*|\d+ problems? \(.*\)|test result: .*|error: could not compile.*)/i;
const ERRORISH =
  /(error|fail|✕|×|FAILED|panic|exception|assert|expected|cannot find|not assignable|undefined)/i;

export interface Condensed {
  summary: string[];
  problems: string[];
}

export function condenseOutput(output: string, maxProblems = 12): Condensed {
  const lines = stripAnsi(output).split(/\r?\n/);
  const summary: string[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (SUMMARY.test(l.trim()) && summary.length < 4)
      summary.push(l.trim().slice(0, 160));
    const m = l.match(LOCATION);
    if (m && ERRORISH.test(l + (lines[i + 1] ?? ""))) {
      const key = `${m[1]}:${m[2] ?? ""}:${l.trim().slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const next = lines[i + 1]?.trim();
      const text =
        l.trim().slice(0, 200) +
        (next &&
        !LOCATION.test(next) &&
        next.length < 160 &&
        ERRORISH.test(next)
          ? ` | ${next}`
          : "");
      if (problems.length < maxProblems) problems.push(text);
    } else if (
      /^\s*(●|✕|×|FAIL(ED)?\b)/.test(l) &&
      l.trim().length > 6 &&
      problems.length < maxProblems
    ) {
      const key = l.trim().slice(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        problems.push(key);
      }
    }
  }
  return { summary, problems };
}
