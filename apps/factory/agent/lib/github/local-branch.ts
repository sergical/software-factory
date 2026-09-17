import type { SandboxSession } from "eve/sandbox";
import { REPO_DIR } from "./git-remote.js";

/**
 * Escapes a commit message for interpolation inside a single-quoted bash
 * argument.
 */
function shellQuote(message: string): string {
  return `'${message.replaceAll("'", "'\\''")}'`;
}

/**
 * Gets the checkout onto `branch` with every change committed, ready for
 * `push_branch` to push.
 *
 * @remarks
 * Assumes `validateBranch` already passed. Moved out of `push_branch` itself
 * because eve runs one step's tool calls concurrently: a model that sent
 * `git add`/`git commit` in `bash` alongside `push_branch` in the same step
 * raced the push against its own commit, so the commit now happens inside
 * this tool instead of a separate `bash` call.
 */
export async function commitForPush(
  sandbox: SandboxSession,
  input: { branch: string; message?: string }
): Promise<string | undefined> {
  const current = await sandbox.run({
    command: `cd ${REPO_DIR} && git branch --show-current`,
  });
  const currentBranch = String(current.stdout).trim();
  if (currentBranch !== input.branch) {
    const exists = await sandbox.run({
      command: `cd ${REPO_DIR} && git show-ref --verify --quiet 'refs/heads/${input.branch}'`,
    });
    if (exists.exitCode === 0) {
      return `${input.branch} exists, but ${currentBranch} is checked out. Run git checkout ${input.branch} in bash, then call push_branch again.`;
    }
    const created = await sandbox.run({
      command: `cd ${REPO_DIR} && git switch -c '${input.branch}'`,
    });
    if (created.exitCode !== 0) {
      return `git switch exited ${created.exitCode}: ${String(
        created.stderr || created.stdout
      ).trim()}`;
    }
  }

  const status = await sandbox.run({
    command: `cd ${REPO_DIR} && git status --porcelain`,
  });
  if (String(status.stdout).trim() !== "") {
    if (!input.message) {
      return "The checkout has uncommitted changes. Call push_branch again with a commit message, and it commits them.";
    }
    const commit = await sandbox.run({
      command: `cd ${REPO_DIR} && git add -A && git commit -q -m ${shellQuote(
        input.message
      )}`,
    });
    if (commit.exitCode !== 0) {
      return `git commit exited ${commit.exitCode}: ${String(
        commit.stderr || commit.stdout
      ).trim()}`;
    }
  }

  const ahead = await sandbox.run({
    command: `cd ${REPO_DIR} && base=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||') && echo "$base $(git rev-list --count "$base..refs/heads/${input.branch}")"`,
  });
  const [base, count] = String(ahead.stdout).trim().split(" ");
  if (ahead.exitCode === 0 && count === "0") {
    return `${input.branch} has no commits ahead of ${base}, so the push would deliver nothing. Make your change, then call push_branch again with a commit message.`;
  }

  return undefined;
}
