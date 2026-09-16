import { defineTool } from "eve/tools";
import { bash } from "eve/tools/bash";
import { REPO_DIR } from "../../../lib/github/git-remote.js";

/**
 * Runs ahead of every command. The sandbox holds no GitHub credential outside
 * `push_branch`, so `git push` fails either way; the `git` function swaps the
 * credential prompt error for one that names the tool, and still lets the
 * rest of `git add ... && git commit ... && git push` run. The tool-name
 * functions answer a model that types `push_branch` as a shell command.
 */
const SHELL_PRELUDE = `cd ${REPO_DIR} || exit 1
git() {
  local args=("$@") i=0
  while [[ \${args[i]} == -* ]]; do
    case \${args[i]} in -C | -c) i=$((i + 2)) ;; *) i=$((i + 1)) ;; esac
  done
  if [[ \${args[i]} == push ]]; then
    echo "git push has no credentials in this sandbox. Commit your work, then call the push_branch tool with the branch name." >&2
    return 1
  fi
  command git "$@"
}
push_branch() { echo "push_branch is a tool, not a shell command. Call the push_branch tool with the branch name." >&2; return 127; }
checkout_branch() { echo "checkout_branch is a tool, not a shell command. Call the checkout_branch tool with the branch name." >&2; return 127; }
run_checks() { echo "run_checks is a tool, not a shell command. Call the run_checks tool." >&2; return 127; }
export -f git push_branch checkout_branch run_checks
`;

/**
 * The built-in `bash`, started in the repository checkout.
 *
 * @remarks
 * eve runs every command in `/workspace`, one level above {@link REPO_DIR}.
 * A model that did not `cd` first saw `git checkout -b` fail, then ran
 * `git init` in `/workspace` and committed the whole checkout as an embedded
 * repository.
 */
export default defineTool({
  ...bash,
  description: `Execute a shell command in the repository checkout. Every command starts in ${REPO_DIR}. git push has no credentials here; push with the push_branch tool.`,
  execute(input, ctx) {
    return bash.execute({ command: `${SHELL_PRELUDE}${input.command}` }, ctx);
  },
});
