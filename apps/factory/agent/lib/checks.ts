import type { SandboxSession } from "eve/sandbox";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { REPO_DIR } from "./github/git-remote.js";

const MAX_OUTPUT_LENGTH = 4000;
const OUTPUT_TAIL_LINES = 60;
const CHECK_TIMEOUT_SECONDS = 600;
const TIMEOUT_EXIT_CODE = 124;
const CHECK_ATTEMPTS = 3;
const FLAKY_NOTE =
  "A check failed and then passed when it ran again, so that check is flaky. Do not change code for it; name it in known_limitations.";
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes needs the control byte
const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

export interface CheckResult {
  attempts: number;
  command: string;
  exitCode: number;
  flaky?: boolean;
  name: string;
  output: string;
  passed: boolean;
}

export interface ChecksReport {
  checks: CheckResult[];
  note?: string;
  passed: boolean;
}

/**
 * Package manager and script detection, done in one sandbox command so the
 * check runner pays for a single round trip instead of one per candidate.
 */
async function detectChecks(
  sandbox: SandboxSession
): Promise<{ pm: string; scripts: string[] }> {
  const result = await sandbox.run({
    command: `cd ${REPO_DIR} && node -e '
const fs = require("fs");
const pm = fs.existsSync("pnpm-lock.yaml")
  ? "pnpm"
  : fs.existsSync("yarn.lock")
    ? "yarn"
    : fs.existsSync("bun.lock") || fs.existsSync("bun.lockb")
      ? "bun"
      : "npm";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const scripts = ["typecheck", "lint", "test"].filter(
  (name) => pkg.scripts && pkg.scripts[name]
);
console.log(JSON.stringify({ pm, scripts }));
'`,
  });
  const parsed = JSON.parse(String(result.stdout).trim()) as {
    pm: string;
    scripts: string[];
  };
  return parsed;
}

function tailOutput(
  stdout: unknown,
  stderr: unknown,
  exitCode: number
): string {
  const combined = `${String(stdout)}${String(stderr)}`.replace(
    ANSI_PATTERN,
    ""
  );
  const tail = combined
    .split("\n")
    .slice(-OUTPUT_TAIL_LINES)
    .join("\n")
    .slice(-MAX_OUTPUT_LENGTH);
  return exitCode === TIMEOUT_EXIT_CODE
    ? `Timed out after ${CHECK_TIMEOUT_SECONDS} seconds.\n${tail}`
    : tail;
}

/**
 * Runs one check, and runs a failed check again up to {@link CHECK_ATTEMPTS}
 * times in total.
 *
 * @remarks
 * The factory's demo repository carries a seeded flaky test that fails about
 * a third of the time. Without the retry, the push gate refused correct
 * changes and the implementer rewrote the unrelated test to get past it. A
 * check that passes only on a later attempt is marked `flaky`, and its output
 * is the failed attempt's, so the flake stays visible. Timeouts are not
 * retried.
 */
async function runOne(
  sandbox: SandboxSession,
  name: string,
  command: string,
  attempt = 1
): Promise<CheckResult> {
  const result = await sandbox.run({
    command: `cd ${REPO_DIR} && CI=1 timeout ${CHECK_TIMEOUT_SECONDS} ${command} 2>&1`,
  });
  const output = tailOutput(result.stdout, result.stderr, result.exitCode);
  const retry =
    result.exitCode !== 0 &&
    result.exitCode !== TIMEOUT_EXIT_CODE &&
    attempt < CHECK_ATTEMPTS;
  if (!retry) {
    return {
      attempts: attempt,
      command,
      exitCode: result.exitCode,
      name,
      output,
      passed: result.exitCode === 0,
    };
  }
  const next = await runOne(sandbox, name, command, attempt + 1);
  if (!next.passed || next.flaky) {
    return next;
  }
  return {
    ...next,
    flaky: true,
    output: `Attempt ${attempt} failed and attempt ${next.attempts} passed. Output of the failed attempt:\n${output}`,
  };
}

/**
 * Runs the repository's checks in the sandbox checkout, one after another.
 *
 * @remarks
 * `FACTORY_CHECK_COMMAND` overrides detection entirely; otherwise the
 * package manager comes from the lockfile and the checks come from whichever
 * of `typecheck`, `lint`, `test` the root `package.json` declares. Checks run
 * one after another because they share one checkout and its build outputs.
 */
export async function runChecks(
  sandbox: SandboxSession
): Promise<ChecksReport> {
  const configured = process.env.FACTORY_CHECK_COMMAND?.trim();
  const checks: CheckResult[] = [];
  if (configured) {
    checks.push(await runOne(sandbox, "checks", configured));
  } else {
    const { pm, scripts } = await detectChecks(sandbox);
    if (scripts.length === 0) {
      return {
        checks: [],
        note: "No typecheck, lint, or test script found in package.json, and FACTORY_CHECK_COMMAND is not set.",
        passed: true,
      };
    }
    for (const script of scripts) {
      // biome-ignore lint/performance/noAwaitInLoops: checks share one checkout and its build outputs, so they run one after another
      checks.push(await runOne(sandbox, script, `${pm} run ${script}`));
    }
  }
  return {
    checks,
    note: checks.some((check) => check.flaky) ? FLAKY_NOTE : undefined,
    passed: checks.every((check) => check.passed),
  };
}

/**
 * Builds the `run_checks` tool shared by the implementer and reviewer
 * stations.
 *
 * @remarks
 * Both stations need the same check run: the implementer to verify before
 * `push_branch`, the reviewer to distrust the implementer's own claims. One
 * tool, wired into each station's `tools/` directory, keeps the detection
 * and execution logic from drifting apart between them.
 */
export function runChecksTool() {
  return defineTool({
    description: `Run the repository's checks in ${REPO_DIR} on the branch that is checked out: the typecheck, lint, and test scripts from package.json, or the factory's configured check command. The result lists each command with its exit code and the end of its output; passed is true only when every check passed.`,
    async execute(_input, ctx) {
      return runChecks(await ctx.getSandbox());
    },
    inputSchema: z.object({}),
  });
}
