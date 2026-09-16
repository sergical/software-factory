import { defineTool } from "eve/tools";
import { z } from "zod";
import { REPO_DIR } from "../../../lib/github/git-remote.js";
import { addedRepeat } from "../../../lib/repeated-lines.js";

const CONTEXT = 2;
const LEADING_WHITESPACE = /^[ \t]*/;

interface Excerpt {
  startLine: number;
  text: string;
}

const indentOf = (line: string): string =>
  line.match(LEADING_WHITESPACE)?.[0] ?? "";

const shift = (line: string, delta: number, unit: string): string => {
  if (delta === 0 || line.trim() === "") {
    return line;
  }
  if (delta > 0) {
    return unit.repeat(delta) + line;
  }
  return line.slice(Math.min(-delta, indentOf(line).length));
};

const lineMatches = (fileLines: string[], oldLines: string[]): number[] => {
  const n = oldLines.length;
  const last = n - 1;
  const found: number[] = [];
  for (let i = 0; i + n <= fileLines.length; i += 1) {
    let ok = true;
    for (let j = 0; ok && j < n; j += 1) {
      const file = fileLines[i + j];
      const old = oldLines[j].trim();
      if (j === 0) {
        ok = file.trimEnd().endsWith(old);
      } else if (j === last) {
        ok = file.trimStart().startsWith(old);
      } else {
        ok = file.trim() === old;
      }
    }
    if (ok) {
      found.push(i);
    }
  }
  return found;
};

const replaceLines = (
  fileLines: string[],
  at: number,
  oldLines: string[],
  newString: string
): string[] => {
  const n = oldLines.length;
  const first = fileLines[at].trimEnd();
  const prefix = first.slice(0, first.length - oldLines[0].trim().length);
  const lastLine = fileLines[at + n - 1];
  const suffix = lastLine.trimStart().slice(oldLines[n - 1].trim().length);
  const anchor = oldLines.findIndex((line, j) => j > 0 && line.trim() !== "");
  const fileIndent = anchor > 0 ? indentOf(fileLines[at + anchor]) : "";
  const delta =
    anchor > 0 ? fileIndent.length - indentOf(oldLines[anchor]).length : 0;
  const unit = fileIndent.startsWith("\t") ? "\t" : " ";
  const newLines = newString
    .split("\n")
    .map((line, k) => (k === 0 ? line.trimStart() : shift(line, delta, unit)));
  newLines[0] = prefix + newLines[0];
  newLines[newLines.length - 1] += suffix;
  return [...fileLines.slice(0, at), ...newLines, ...fileLines.slice(at + n)];
};

const closest = (
  fileLines: string[],
  oldLines: string[]
): Excerpt | undefined => {
  const wanted = oldLines.map((line) => line.trim()).filter(Boolean);
  let best = { score: 0, start: 0 };
  for (let i = 0; i < fileLines.length; i += 1) {
    const window = fileLines
      .slice(i, i + oldLines.length)
      .map((line) => line.trim());
    const score = wanted.filter((line) =>
      window.some((w) => w.includes(line))
    ).length;
    if (score > best.score) {
      best = { score, start: i };
    }
  }
  if (best.score === 0) {
    return undefined;
  }
  return {
    startLine: best.start + 1,
    text: fileLines.slice(best.start, best.start + oldLines.length).join("\n"),
  };
};

const excerpt = (
  lines: string[],
  startLine: number,
  count: number
): Excerpt => {
  const from = Math.max(1, startLine - CONTEXT);
  return {
    startLine: from,
    text: lines.slice(from - 1, startLine - 1 + count + CONTEXT).join("\n"),
  };
};

interface EditInput {
  newString: string;
  oldString: string;
  replaceAll?: boolean;
}

/**
 * Tries the exact-text replacement. Returns `undefined` when oldString does
 * not occur at all, so the caller falls through to the line match; otherwise
 * returns the next file content (on success) alongside the result to report.
 */
function exactMatchEdit(content: string, path: string, input: EditInput) {
  const count = content.split(input.oldString).length - 1;
  if (count === 0) {
    return;
  }
  if (count > 1 && !input.replaceAll) {
    return {
      result: {
        error: `oldString occurs ${count} times in ${path}; include more surrounding lines so it is unique, or set replaceAll.`,
        success: false as const,
      },
    };
  }
  const at = content.indexOf(input.oldString);
  const next = input.replaceAll
    ? content.replaceAll(input.oldString, input.newString)
    : content.replace(input.oldString, () => input.newString);
  const startLine = content.slice(0, at).split("\n").length;
  return {
    next,
    result: {
      match: "exact" as const,
      path,
      replacements: input.replaceAll ? count : 1,
      success: true as const,
      updated: excerpt(
        next.split("\n"),
        startLine,
        input.newString.split("\n").length
      ),
    },
  };
}

/**
 * Falls back to a whitespace-tolerant whole-line match when no exact match
 * exists. Always returns a result; `next` is set only on success.
 */
function lineMatchEdit(content: string, path: string, input: EditInput) {
  const fileLines = content.split("\n");
  const trailing =
    input.oldString.endsWith("\n") && input.newString.endsWith("\n");
  const oldLines = (
    trailing ? input.oldString.slice(0, -1) : input.oldString
  ).split("\n");
  const newString = trailing ? input.newString.slice(0, -1) : input.newString;
  const matches = oldLines.length > 1 ? lineMatches(fileLines, oldLines) : [];
  if (matches.length > 1 && !input.replaceAll) {
    return {
      result: {
        error: `oldString matches ${matches.length} places in ${path} when indentation is ignored; include more surrounding lines so it is unique, or set replaceAll.`,
        success: false as const,
      },
    };
  }
  if (matches.length === 0) {
    const near = closest(fileLines, oldLines);
    return {
      result: {
        closest: near,
        error: near
          ? `oldString was not found in ${path}. The closest lines start at line ${near.startLine} and are in closest.text; copy oldString from there exactly.`
          : `oldString was not found in ${path}. Read the file again with read_file; it may already contain your earlier edits.`,
        success: false as const,
      },
    };
  }

  let lines = fileLines;
  let lastEnd = Number.POSITIVE_INFINITY;
  for (const at of [...matches].reverse()) {
    if (at + oldLines.length > lastEnd) {
      continue;
    }
    lines = replaceLines(lines, at, oldLines, newString);
    lastEnd = at;
  }
  return {
    next: lines.join("\n"),
    result: {
      match: "ignoring indentation" as const,
      path,
      replacements: matches.length,
      success: true as const,
      updated: excerpt(lines, matches[0] + 1, newString.split("\n").length),
    },
  };
}

/**
 * Replaces text in an existing file of the sandbox checkout, falling back to
 * a whitespace-tolerant line match when the exact text is not found.
 *
 * @remarks
 * eve ships no built-in edit tool, only a `write_file` that replaces the
 * whole file. In production the implementer read `Footer.tsx` with
 * `read_file` at an offset, then called `write_file` with only the numbered
 * fragment it had read, turning the file into 16 lines of `24:   <button`.
 * This tool lets the implementer change a file by exact match instead of
 * retyping it whole. A later replay of an exact-match-only version showed
 * the model copying `read_file` lines with one extra space of indentation
 * (it counted the space after `<line>:`) and a dropped leading `<`, missing
 * every match and retrying the same call about 40 times; the fallback here
 * matches whole lines while ignoring indentation and re-indents `newString`
 * to fit, so that miskeyed indentation no longer strands the model.
 * In a later local run the implementer sent the whole 49-line `App.css` as
 * newString for a 3-line oldString, which left the file's rules there twice.
 * The tool now refuses an edit that leaves a long block of lines twice when
 * the file had no such repeat before.
 */
export default defineTool({
  description: `Replace text in an existing file of the ${REPO_DIR} checkout. The tool removes oldString and puts newString in its place, so newString must repeat every part of oldString that stays. Example: to add \`const b = 2;\` after \`const a = 1;\`, send oldString \`const a = 1;\` and newString \`const a = 1;\\nconst b = 2;\`.
Copy oldString from read_file output without the "<line>: " prefix; the space after the colon belongs to the prefix, not to the indentation. oldString must occur once unless replaceAll is set. When no exact match exists, the tool matches whole lines while ignoring indentation and re-indents newString to fit.
The result shows the changed lines as they now are. Use this for every change to an existing file; write_file replaces the whole file.`,
  async execute(input, ctx) {
    const path = input.filePath.startsWith("/")
      ? input.filePath
      : `${REPO_DIR}/${input.filePath}`;
    const sandbox = await ctx.getSandbox();
    const content = await sandbox.readTextFile({ path });
    if (content === null) {
      return {
        error: `File not found: ${path}. Use write_file to create a new file.`,
        success: false as const,
      };
    }
    if (input.oldString === input.newString) {
      return {
        error:
          "oldString and newString are identical, so nothing would change.",
        success: false as const,
      };
    }

    const edit =
      exactMatchEdit(content, path, input) ??
      lineMatchEdit(content, path, input);
    if (edit.next === undefined) {
      return edit.result;
    }
    const repeat = addedRepeat(content, edit.next);
    if (repeat) {
      return {
        error: `This edit would leave ${repeat.length} lines twice in ${path}, starting at "${repeat.start}". newString replaces only oldString, so send only the lines that take its place, not the whole file. To rewrite the whole file, use write_file. Nothing was changed.`,
        success: false as const,
      };
    }
    await sandbox.writeTextFile({ content: edit.next, path });
    return edit.result;
  },
  inputSchema: z.object({
    filePath: z
      .string()
      .min(1)
      .describe(`The file to edit, absolute or relative to ${REPO_DIR}.`),
    newString: z
      .string()
      .describe(
        "The complete text that takes the place of oldString, including the parts of oldString you keep."
      ),
    oldString: z
      .string()
      .min(1)
      .describe(
        'The exact text to replace, copied from read_file output without the "<line>: " prefix.'
      ),
    replaceAll: z
      .boolean()
      .optional()
      .describe(
        "Replace every occurrence of oldString instead of requiring exactly one."
      ),
  }),
});
