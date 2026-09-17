import { defineTool } from "eve/tools";
import { type WriteFileToolOutput, writeFile } from "eve/tools/write_file";
import { REPO_DIR } from "../../../lib/github/git-remote.js";
import { addedRepeat } from "../../../lib/repeated-lines.js";

const LINE_NUMBER_PREFIX = /^\d+: /;

/**
 * The built-in `write_file`, refusing content that still carries
 * `read_file`'s `<line>: ` prefixes or that holds a file twice.
 *
 * @remarks
 * eve ships no built-in edit tool and its `write_file` description says
 * "ALWAYS prefer editing existing files in the codebase", which points a
 * model at the wrong tool. In production the implementer read `Footer.tsx`
 * with `read_file` at an offset, then called `write_file` with only the
 * numbered fragment it had read, turning the file into 16 lines of
 * `24:   <button`. It ran no checks, and the reviewer approved. This guard
 * refuses that shape of content outright. A later local run left
 * `App.css` holding its rules three times, so content that repeats a long
 * block the existing file did not repeat is refused too.
 */
export default defineTool({
  ...writeFile,
  description: `Write a whole file in the ${REPO_DIR} checkout. The content replaces the entire file exactly as given, so use this for new files; change an existing file with edit_file. read_file shows each line as "<line>: <text>"; never copy those prefixes into content.`,
  async execute(input, ctx) {
    const lines = input.content.split("\n").filter((line) => line.length > 0);
    if (
      lines.length > 0 &&
      lines.every((line) => LINE_NUMBER_PREFIX.test(line))
    ) {
      throw new Error(
        'The content still carries read_file line numbers ("<line>: "); write_file replaces the whole file with the content exactly as given. To change part of a file, call edit_file with the exact text, without the prefixes.'
      );
    }
    const before = await (await ctx.getSandbox()).readTextFile({
      path: input.filePath,
    });
    const repeat =
      before === null ? undefined : addedRepeat(before, input.content);
    if (repeat) {
      throw new Error(
        `The content holds ${repeat.length} lines twice, starting at "${repeat.start}", and ${input.filePath} does not. Write each part of the file once. To change part of a file, call edit_file instead.`
      );
    }
    // The provided tool returns one result object, not a stream.
    return (await writeFile.execute(input, ctx)) as WriteFileToolOutput;
  },
});
