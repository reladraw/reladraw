/**
 * A text and the runs inside it.
 *
 * A text is a string, and the one piece of structure it may carry is markup:
 * `[dim]synced[/dim]` draws that word in the text color of `style dim`. The
 * opener names a *style* and never a color, so the word borrows a meaning the
 * file already has rather than restating a value that goes stale the day the
 * thing it means is recolored.
 *
 * Markup replaced `subtext:`, which colored "every line after the first". That
 * was a positional slice: a reader of `node a "Dropbox / synced"` could not see
 * that line two was quiet, because the rule lived in a style elsewhere and was
 * applied by counting. Markup says what is quiet where it is quiet, and it
 * reaches a word in the middle of a line, which the slice never could.
 *
 * Everything downstream therefore works in *runs* rather than strings: a drawn
 * line is a list of runs, each with the style it borrows its color from, and
 * line breaking and wrapping carry the runs along rather than re-parsing text
 * that has already been read.
 */
import { SourceError } from './errors.js';

/** A stretch of text drawn in one style. `style` is a style name from the file. */
export interface Run {
  text: string;
  /** The style whose text color this run borrows, or undefined for the node's own. */
  style?: string;
}

/** One drawn line, as the runs it is made of. */
export type Line = Run[];

/** A markup tag: `[name]` or `[/name]`, with the same name spelling as a style. */
const TAG = /\[(\/?)([A-Za-z][A-Za-z0-9_-]*)\]/y;

/**
 * Read a text into runs, stripping the markup as it goes.
 *
 * `\[` is the escape, and it is why a bare `[` had to be reserved in 0.3.0
 * rather than left alone: a text containing one is legal in 0.2.0 and would
 * change meaning the day this landed.
 *
 * The closer repeats the name — `[/dim]` and not `[/]` — so a mismatch is
 * refused by name rather than by counting, which is the thing a reader can
 * never do reliably. Nesting is refused for the same reason: two colors on one
 * word is not a picture anything here can draw, so it is a mistake rather than
 * a shorthand.
 */
export function parseMarkup(text: string, subject: string, line: number): Run[] {
  const runs: Run[] = [];
  let open: string | undefined;
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    runs.push(open === undefined ? { text: buffer } : { text: buffer, style: open });
    buffer = '';
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] === '[') {
      buffer += '[';
      i += 2;
      continue;
    }
    if (ch === '[') {
      TAG.lastIndex = i;
      const found = TAG.exec(text);
      if (found) {
        const closing = found[1] === '/';
        const name = found[2]!;
        if (closing) {
          if (open === undefined) {
            throw new SourceError(
              `${subject}: "[/${name}]" closes markup that was never opened — write \\[ for a literal bracket`,
              line,
            );
          }
          if (open !== name) {
            throw new SourceError(
              `${subject}: "[${open}]" is closed by "[/${name}]" — a closer repeats the name it opened with`,
              line,
            );
          }
          flush();
          open = undefined;
        } else {
          if (open !== undefined) {
            throw new SourceError(
              `${subject}: "[${name}]" opens inside "[${open}]", and a run of text takes one style`,
              line,
            );
          }
          flush();
          open = name;
        }
        i = found.index + found[0].length;
        continue;
      }
      // Not a tag at all — a lone bracket in the middle of a word. Refused by
      // name rather than passed through, because `[` is reserved and a text
      // that means one has an escape to say so.
      throw new SourceError(
        `${subject}: "[" opens markup in a text — write \\[ for a literal bracket`,
        line,
      );
    }
    buffer += ch;
    i += 1;
  }

  if (open !== undefined) {
    throw new SourceError(`${subject}: "[${open}]" is never closed`, line);
  }
  flush();
  return runs;
}

/**
 * A slash with whitespace on both sides marks a line break, so a text is
 * really a short stack of lines. Each line is trimmed; empty ones are dropped.
 *
 * The whitespace is what makes the marker safe. Splitting on a bare `/` meant
 * no text could contain one, so `TCP/IP` came out as two lines, and so did
 * `16/9`, `I/O` and every path or URL. Requiring the spaces keeps the marker
 * legible where it is meant — `"Computer 1 / Ubuntu"` — while a slash inside a
 * word stays an ordinary character.
 *
 * That leaves the text that wants a spaced slash and no break — `Before / After`
 * — which writes it `\/`. The lexer preserves that escape rather than resolving
 * it, so the backslash is still here to suppress the split, and is dropped once
 * the splitting is done.
 *
 * A break inside a marked-up run is an ordinary break: `[dim]one / two[/dim]`
 * quiets both lines, which is what made the markup general where the slice it
 * replaced could only reach the tail of a text.
 */
export function splitRuns(runs: Run[]): Line[] {
  const lines: Line[] = [[]];
  for (const run of runs) {
    const parts = run.text.split(/\s+\/\s+/);
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      lines[lines.length - 1]!.push({ ...run, text: part });
    });
  }
  return tidy(lines);
}

/** Trim each line's ends, drop the empty ones, and resolve the `\/` escape. */
function tidy(lines: Line[]): Line[] {
  const kept: Line[] = [];
  for (const line of lines) {
    const runs = line
      .map((run, index) => {
        let text = run.text.replace(/\\\//g, '/');
        if (index === 0) text = text.replace(/^\s+/, '');
        if (index === line.length - 1) text = text.replace(/\s+$/, '');
        return { ...run, text };
      })
      .filter((run) => run.text.length > 0);
    if (runs.length > 0) kept.push(runs);
  }
  return kept.length > 0 ? kept : [[{ text: '' }]];
}

/** Fold one line onto several at word boundaries, never exceeding `columns`. */
export function wrapLine(line: Line, columns: number): Line[] {
  const lines: Line[] = [];
  let current: Line = [];
  let length = 0;

  for (const word of words(line)) {
    const space = length === 0 ? 0 : 1;
    if (length > 0 && length + space + word.text.length > columns) {
      lines.push(current);
      current = [];
      length = 0;
    }
    append(current, length === 0 ? word : { ...word, text: ` ${word.text}` });
    length += (length === 0 ? 0 : 1) + word.text.length;
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [[{ text: '' }]];
}

/** The line's words, each carrying the style of the run it came from. */
function words(line: Line): Run[] {
  const found: Run[] = [];
  for (const run of line) {
    for (const word of run.text.split(/\s+/).filter(Boolean)) {
      found.push({ ...run, text: word });
    }
  }
  return found;
}

/** Add a word to a line, joining it to the last run when the style is the same. */
function append(line: Line, word: Run): void {
  const last = line[line.length - 1];
  if (last && last.style === word.style) {
    last.text += word.text;
    return;
  }
  line.push(word);
}

/** The line as it reads, with no markup — what gets measured. */
export function plain(line: Line): string {
  return line.map((run) => run.text).join('');
}

/** Every style name the markup in these lines refers to, without repeats. */
export function markupStyles(lines: Line[]): string[] {
  const names = new Set<string>();
  for (const line of lines) {
    for (const run of line) if (run.style !== undefined) names.add(run.style);
  }
  return [...names];
}
