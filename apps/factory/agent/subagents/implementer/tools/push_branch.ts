import { defineTool } from "eve/tools";
import { z } from "zod";
import { runChecks } from "../../../lib/checks.js";
import { githubCredentials } from "../../../lib/github/credentials.js";
import {
  brokerPolicy,
  mintInstallationToken,
  REMOTE_URL,
  REPO_DIR,
  validateBranch,
} from "../../../lib/github/git-remote.js";
import { commitForPush } from "../../../lib/github/local-branch.js";

/**
 * Commits, checks, and pushes a feature branch of the sandbox checkout to
 * the factory repository.
 *
 * @remarks
 * The push is inert by construction, which is why it runs without approval
 * inside a task-mode station: `validateBranch` refuses `main`, `master`, and
 * anything that isn't a plain branch name, so nothing this tool does can
 * change the default branch or merge. The credential is brokered at the
 * sandbox firewall and never enters the sandbox, and the push targets
 * {@link REMOTE_URL} literally, never the model-writable `origin` remote. The
 * `finally` block drops the brokered credential again.
 *
 * eve runs the tool calls of one step concurrently, and models sent
 * `git add`, `git commit`, and this tool in one step, so the push raced its
 * own commit. The commit now happens inside this tool, through
 * `commitForPush`, instead of a separate `bash` call the model could bundle
 * with the push. The push is also gated on `runChecks`: PR #15 shipped code
 * that failed typecheck, lint, and tests, because nothing had run them
 * first.
 */
export default defineTool({
  description: `Commit and push a branch of the ${REPO_DIR} checkout to the factory repository; main and master are refused. The tool checks out the branch (creating it from the current commit when it does not exist), stages and commits every uncommitted change with message, runs the repository's checks, and pushes only when they pass. The result lists each check with its exit code: copy them into verification. After a successful push, report the branch name in your structured output so the orchestrator can open the pull request.`,
  async execute(input, ctx) {
    const refusal = validateBranch(input.branch);
    if (refusal) {
      return { error: refusal, success: false as const };
    }
    const sandbox = await ctx.getSandbox();
    const commitError = await commitForPush(sandbox, {
      branch: input.branch,
      message: input.message,
    });
    if (commitError) {
      return { error: commitError, success: false as const };
    }
    const report = await runChecks(sandbox);
    if (!report.passed) {
      return {
        checks: report.checks,
        error:
          "The checks failed, so nothing was pushed. Your commit is kept. Fix the failures, then call push_branch again with a commit message for the fix.",
        note: report.note,
        success: false as const,
      };
    }
    const token = await mintInstallationToken(githubCredentials);
    await sandbox.setNetworkPolicy(brokerPolicy(token));
    try {
      const push = await sandbox.run({
        command: `git -C ${REPO_DIR} push ${REMOTE_URL} 'refs/heads/${input.branch}:refs/heads/${input.branch}'`,
      });
      if (push.exitCode !== 0) {
        return {
          error: `git push exited ${push.exitCode}: ${String(
            push.stderr || push.stdout
          ).trim()}`,
          success: false as const,
        };
      }
      const head = await sandbox.run({
        command: `git -C ${REPO_DIR} rev-parse '${input.branch}'`,
      });
      return {
        branch: input.branch,
        checks: report.checks,
        note: report.note,
        sha: String(head.stdout).trim(),
        success: true as const,
      };
    } finally {
      await sandbox.setNetworkPolicy("allow-all");
    }
  },
  inputSchema: z.object({
    branch: z
      .string()
      .min(1)
      .describe(
        "Branch name in /workspace/repo to push, e.g. factory/bug-dedupe-reset-emails"
      ),
    message: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Commit message for the uncommitted changes. push_branch stages and commits every change in the checkout with it before it runs the checks and pushes."
      ),
  }),
});
