export interface Repeat {
  /** Number of non-blank lines in the repeated block. */
  length: number;
  /** The block's first line, trimmed. */
  start: string;
}

/**
 * The longest block of consecutive lines that occurs twice in the text,
 * ignoring blank lines and indentation.
 */
const longestRepeat = (text: string): Repeat => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let best = { end: -1, length: 0 };
  let previous = new Array<number>(lines.length + 1).fill(0);
  for (let i = 1; i <= lines.length; i += 1) {
    const row = new Array<number>(lines.length + 1).fill(0);
    for (let j = i + 1; j <= lines.length; j += 1) {
      if (lines[i - 1] === lines[j - 1]) {
        row[j] = previous[j - 1] + 1;
        if (row[j] > best.length) {
          best = { end: i, length: row[j] };
        }
      }
    }
    previous = row;
  }
  return {
    length: best.length,
    start: lines[best.end - best.length] ?? "",
  };
};

/**
 * The block a change leaves twice in a file when the file had no repeat that
 * long before, which is what a pasted copy of the file looks like.
 *
 * @remarks
 * The bar is half the file's non-blank lines, between 4 and 12, so a pasted
 * copy of a small file is caught while a new rule or test that reuses two or
 * three lines is not.
 *
 * @returns The new repeat, or `undefined` when the change adds none.
 */
export function addedRepeat(before: string, after: string): Repeat | undefined {
  const lines = before.split("\n").filter((line) => line.trim()).length;
  const bar = Math.min(12, Math.max(4, Math.ceil(lines / 2)));
  const repeat = longestRepeat(after);
  if (repeat.length < bar || repeat.length <= longestRepeat(before).length) {
    return;
  }
  return repeat;
}
