import { SourceError } from './errors.js';
import { DEFAULT_FORMAT, type FormatSettings } from './format-settings.js';
import { isAttrKey, type Token } from './lexer.js';
import { clausesOf, looksLikeArrow, parse, type Gathered } from './parser.js';

/**
 * Lay a source file out again: spacing between clauses, columns shared by
 * statements that belong together, comments and blank lines, as `settings`
 * say. Only whitespace changes, and the order of clauses when `clause-order`
 * asks. Every token is copied out of the line it was
 * written on, so no word is respelled, and the result is parsed again and
 * compared with the original, so a mistake here can never change what a file
 * draws: it throws instead.
 *
 * Throws the parser's error for a file that does not parse, so a broken file
 * is never rewritten.
 */
export function format(source: string, settings: FormatSettings = DEFAULT_FORMAT): string {
  const lines = source.split(/\r?\n/);
  const endsWithBreak = lines.length > 1 && lines[lines.length - 1] === '';
  if (endsWithBreak) lines.pop();
  const { statements, starts } = clausesOf(source);

  const items = gatherItems(lines, statements, starts, settings);
  const out = layOutItems(items, settings);
  // A file keeps the line breaks it came with, so formatting on Windows
  // doesn't turn every line into a change. The first break decides.
  const lineBreak = /\r\n/.test(source.match(/\r?\n/)?.[0] ?? '') ? '\r\n' : '\n';
  const result = out.join(lineBreak) + (endsWithBreak ? lineBreak : '');

  if (!sameMeaning(source, result)) {
    throw new Error('the formatter would change what this file draws, so it was left alone — please report this as a bug');
  }
  return result;
}

/**
 * Does `a` say the same as `b`? Both parse to the same statements, line
 * numbers aside. The keys of a parsed object are compared in any order, since
 * `clause-order` may write `from:` after `via:`; lists keep theirs.
 */
function sameMeaning(a: string, b: string): boolean {
  const strip = (source: string) =>
    JSON.stringify(parse(source), (key, value: unknown) => {
      if (key === 'line') return undefined;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      return Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
    });
  return strip(a) === strip(b);
}

/**
 * One clause: its words as written, and what kind it is. `keyword` and `head`
 * (a name, or an edge's name and ends) open a statement and never move; the
 * rest are the kinds `clause-order` lists: `text`, `placement`, or a key's name.
 * A quoted text and a style's `text:` key are both `text`.
 */
interface Cell {
  text: string;
  kind: string;
  /** A quoted text, rather than a style's `text:` key, which is the same kind. */
  quoted?: boolean;
}

const OPENING = new Set(['keyword', 'head']);

/** The kind of clause a run of tokens is. */
function kindOf(run: { token: Token }[]): string {
  const first = run[0]!.token;
  if (first.quoted) return 'text';
  if (isAttrKey(first)) return first.text.slice(0, -1);
  return 'placement';
}

/** What the file is made of, in order, once statements are gathered. */
type Item =
  | { kind: 'blank' }
  | { kind: 'comment'; text: string }
  /** Lines written out as they are: a statement holding a `"""` string. */
  | { kind: 'verbatim'; lines: string[] }
  /** A statement kept on its own lines, because a comment sits among them. */
  | { kind: 'kept'; keyword: string; lines: { cells: Cell[]; comment?: string }[]; first: Cell[] }
  /** A statement on one line. */
  | { kind: 'statement'; keyword: string; cells: Cell[]; comment?: string }
  /** A statement too long for one line, broken by `wrap-at` or `clause-per-line-at`. */
  | { kind: 'broken'; keyword: string; first: Cell[]; rest: string[]; oneEach: boolean; comment?: string };

/** Everything after `//` outside quotes on a line, or nothing. */
function trailingCommentAfter(line: string, from: number): string | undefined {
  const at = line.indexOf('//', from);
  return at === -1 ? undefined : line.slice(at).trimEnd();
}

function gatherItems(lines: string[], statements: Gathered[], starts: Set<Token>, settings: FormatSettings): Item[] {
  const byLine = new Map(statements.map((statement) => [statement.line, statement]));
  const items: Item[] = [];

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index]!;
    const statement = byLine.get(lineNumber);

    if (statement === undefined) {
      if (line.trim() === '') items.push({ kind: 'blank' });
      else items.push({ kind: 'comment', text: line.trimEnd() });
      continue;
    }

    // The statement's own lines run to its last line of tokens, and on over any
    // indented comment lines after it: `parse` reads those as inside it too.
    const tokenLines = statement.lines;
    const lastEntry = tokenLines[tokenLines.length - 1]!;
    let last = lastEntry.line - 1 + newlinesIn(lastEntry.tokens);
    while (last + 1 < lines.length && /^[ \t]+\/\//.test(lines[last + 1]!)) last += 1;
    const span = lines.slice(index, last + 1);
    index = last;

    if (tokenLines.some((entry) => entry.tokens.some((token) => token.triple))) {
      items.push({ kind: 'verbatim', lines: span });
      continue;
    }

    const all = tokenLines.flatMap((entry) => entry.tokens.map((token) => ({ token, line: lines[entry.line - 1]! })));
    const keywordCount = all[0]!.token.text === 'default' || all[0]!.token.text === 'guide' ? 2 : 1;
    const keyword = all.slice(0, keywordCount).map(({ token, line: text }) => text.slice(token.start, token.end)).join(' ');

    // Comments among the statement's lines: whole comment lines, and comments
    // trailing any line but the last.
    const inside: { line: number; text: string }[] = [];
    let trailing: string | undefined;
    for (let at = 0; at < span.length; at++) {
      const physical = lineNumber + at;
      const entry = tokenLines.find((one) => one.line === physical);
      const text = span[at]!;
      if (entry === undefined) {
        if (text.trim() !== '') inside.push({ line: physical, text: text.trim() });
        continue;
      }
      const comment = trailingCommentAfter(text, entry.tokens[entry.tokens.length - 1]!.end ?? 0);
      if (comment === undefined) continue;
      if (entry === lastEntry) trailing = comment;
      else inside.push({ line: physical, text: comment });
    }
    // A trailing comment on the last line is inside too when whole comment lines follow it.
    if (trailing !== undefined && inside.some((one) => one.line > lastEntry.line)) {
      inside.push({ line: lastEntry.line, text: trailing });
      inside.sort((a, b) => a.line - b.line);
      trailing = undefined;
    }

    const cellsOf = (entries: typeof all) => statementCells(entries, keywordCount, starts, settings);

    if (inside.length > 0 && settings['comments-inside'] === 'refuse') {
      throw new SourceError(
        'a comment among the lines of a statement has nowhere to go when the statement is joined onto one line — ' +
          'move it above the statement, or set comments-inside: keep-lines',
        inside[0]!.line,
      );
    }
    if (inside.length > 0 && settings['comments-inside'] === 'keep-lines') {
      const kept: { cells: Cell[]; comment?: string }[] = [];
      for (let at = 0; at < span.length; at++) {
        const physical = lineNumber + at;
        const entry = tokenLines.find((one) => one.line === physical);
        const text = span[at]!;
        if (entry === undefined) {
          if (text.trim() !== '') kept.push({ cells: [], comment: text.trim() });
          continue;
        }
        const own = all.filter(({ token }) => entry.tokens.includes(token));
        const comment = trailingCommentAfter(text, entry.tokens[entry.tokens.length - 1]!.end ?? 0);
        // The first line keeps its keyword as a cell of its own.
        const lineCells = at === 0 ? cellsOf(own) : continuedCells(own, starts);
        kept.push({ cells: lineCells, ...(comment !== undefined ? { comment } : {}) });
      }
      items.push({ kind: 'kept', keyword, lines: kept, first: cellsOf(all) });
      continue;
    }
    for (const comment of inside) items.push({ kind: 'comment', text: comment.text });
    const cells = orderCells(cellsOf(all), settings);
    items.push({ kind: 'statement', keyword, cells, ...(trailing !== undefined ? { comment: trailing } : {}) });
  }
  return items;
}

/** How many physical lines a `"""` string on this line runs on past it. */
function newlinesIn(tokens: Token[]): number {
  return tokens.reduce((count, token) => count + (token.triple ? token.text.split('\n').length - 1 : 0), 0);
}

/**
 * Split a statement's tokens into its cells: the keyword, what follows it up
 * to the first clause (a name, or an edge's name and ends), then one cell per
 * clause. A clause starts where the parser began reading one, outside
 * brackets; a quoted text starts one too, unless it is a key's value.
 */
function statementCells(
  all: { token: Token; line: string }[],
  keywordCount: number,
  starts: Set<Token>,
  settings: FormatSettings,
): Cell[] {
  const result: Cell[] = [];
  const keyword = all.slice(0, keywordCount);
  result.push({ text: joinTokens(keyword), kind: 'keyword' });

  const runs = clauseRuns(all.slice(keywordCount), starts);
  const head = runs[0] && !isAttrKey(runs[0][0]!.token) && !starts.has(runs[0][0]!.token) ? runs.shift()! : undefined;
  if (head) {
    if (all[0]!.token.text === 'edge' && settings['edge-name-and-ends'] === 'own-columns') result.push(...edgeHeadCells(head));
    else result.push({ text: joinTokens(head), kind: 'head' });
  }
  for (const run of runs) result.push({ text: joinTokens(run), kind: kindOf(run), ...(run[0]!.token.quoted ? { quoted: true } : {}) });
  return result;
}

/** The cells of a continued line in a kept statement: no keyword, no head. */
function continuedCells(own: { token: Token; line: string }[], starts: Set<Token>): Cell[] {
  return clauseRuns(own, starts).map((run) => ({ text: joinTokens(run), kind: kindOf(run) }));
}

/**
 * A statement's clauses in the order `clause-order` lists their kinds, the
 * kinds it leaves out after them as written; clauses of one kind keep their
 * order. Quoted texts never move: the language takes them only straight after
 * the name. A clause only moves where moving it can't change what the
 * statement says, so one that would read differently reordered keeps its
 * written order.
 */
function orderCells(cells: Cell[], settings: FormatSettings): Cell[] {
  const order = settings['clause-order'];
  if (order === 'as-written') return cells;
  const stays = (cell: Cell) => OPENING.has(cell.kind) || cell.quoted === true;
  const opening = cells.filter(stays);
  const rank = (cell: Cell) => (order.includes(cell.kind) ? order.indexOf(cell.kind) : order.length);
  const rest = cells
    .filter((cell) => !stays(cell))
    .map((cell, at) => ({ cell, at }))
    .sort((a, b) => rank(a.cell) - rank(b.cell) || a.at - b.at)
    .map(({ cell }) => cell);
  const ordered = [...opening, ...rest];
  const line = (some: Cell[]) => some.map((cell) => cell.text).filter((text) => text !== '').join(' ');
  try {
    return sameMeaning(line(cells), line(ordered)) ? ordered : cells;
  } catch {
    return cells;
  }
}

/** Tokens grouped into clauses, by where clauses start outside brackets. */
function clauseRuns(tokens: { token: Token; line: string }[], starts: Set<Token>): { token: Token; line: string }[][] {
  const runs: { token: Token; line: string }[][] = [];
  let depth = 0;
  let inKey = false;
  for (const entry of tokens) {
    const { token } = entry;
    const opens =
      depth === 0 &&
      token.text !== '(' &&
      (starts.has(token) || (token.quoted && !inKey) || runs.length === 0);
    if (opens) {
      runs.push([entry]);
      inKey = isAttrKey(token);
    } else {
      runs[runs.length - 1]!.push(entry);
    }
    if (!token.quoted && token.text === '(') depth += 1;
    else if (!token.quoted && token.text === ')') depth -= 1;
  }
  return runs;
}

/**
 * An edge's name and ends as a cell each: the name if it has one, the first
 * end, the arrow, the second end. An edge with no name gets an empty name cell,
 * so its ends still line up with a named one's.
 */
function edgeHeadCells(head: { token: Token; line: string }[]): Cell[] {
  const arrowAt = head.findIndex(({ token }) => token.text !== '(' && looksLikeArrow(token));
  if (arrowAt === -1) return [{ text: joinTokens(head), kind: 'head' }];
  const before = head.slice(0, arrowAt);
  const named = before.length > 1 && !before[0]!.token.text.endsWith(',') && before[0]!.token.text !== 'each';
  return [
    { text: named ? joinTokens(before.slice(0, 1)) : '', kind: 'head' },
    { text: joinTokens(named ? before.slice(1) : before), kind: 'head' },
    { text: joinTokens(head.slice(arrowAt, arrowAt + 1)), kind: 'head' },
    { text: joinTokens(head.slice(arrowAt + 1)), kind: 'head' },
  ];
}

/**
 * Tokens written back as one stretch of text, spaced the way the docs spell a
 * clause however it was written: one space between words and after a key's
 * colon, none just inside a bracket, and a lone comma against the word before
 * it. `line:( corners:rounded , path:square )` comes out as
 * `line: (corners: rounded, path: square)`.
 */
function joinTokens(tokens: { token: Token; line: string }[]): string {
  let text = '';
  tokens.forEach(({ token, line }, index) => {
    const previous = tokens[index - 1];
    if (previous) {
      const opens = !previous.token.quoted && previous.token.text === '(';
      const closes = !token.quoted && (token.text === ')' || token.text === ',');
      text += opens || closes ? '' : ' ';
    }
    const written = line.slice(token.start, token.end);
    // A comma the lexer joined on from further along the line.
    text += !token.quoted && token.text.endsWith(',') && !written.endsWith(',') ? `${written},` : written;
  });
  return text;
}

/** The width of a stretch of text in characters, counting each code point once. */
function textWidth(text: string): number {
  return [...text].length;
}

/** How wide a tab counts as, where a width has to be known. */
const TAB_WIDTH = 4;

/**
 * Whether a statement `length` characters long goes past `wrap-at` or
 * `clause-per-line-at`, and if so where its first line ends. The length is
 * the line as it would be printed, lined up with its neighbors (see
 * `layOutItems`). The first line holds the keyword and name, and the texts
 * after them if `first-line` says so, and shares columns with its neighbors
 * like a one-line statement; the clauses after it are laid out by
 * `continuedLines`.
 */
function breakStatement(item: Extract<Item, { kind: 'statement' }>, settings: FormatSettings, length: number): Item {
  const perLine = settings['clause-per-line-at'];
  const wrap = settings['wrap-at'];
  const oneEach = perLine === 'always' || (typeof perLine === 'number' && length > perLine);
  if (!oneEach && !(typeof wrap === 'number' && length > wrap)) return item;

  let firstEnd = item.cells.findIndex((cell) => !OPENING.has(cell.kind));
  if (firstEnd === -1) return item;
  if (settings['first-line'] === 'text') while (item.cells[firstEnd]?.quoted) firstEnd += 1;
  const rest = item.cells.slice(firstEnd).map((cell) => cell.text);
  if (rest.length === 0) return item;
  return {
    kind: 'broken',
    keyword: item.keyword,
    first: item.cells.slice(0, firstEnd),
    rest,
    oneEach,
    ...(item.comment !== undefined ? { comment: item.comment } : {}),
  };
}

/**
 * A broken statement's lines after its first: one clause to a line, or as
 * many as fit under `wrap-at`. A clause is never split, so one longer than
 * the width stands alone on its line.
 */
function continuedLines(item: Extract<Item, { kind: 'broken' }>, indent: string, settings: FormatSettings, gap: string, gapWidth: number): string[] {
  if (item.oneEach) return item.rest.map((text) => indent + text);
  const wrap = settings['wrap-at'] as number;
  const indentWidth = indent === '\t' ? TAB_WIDTH : indent.length;
  const lines: string[] = [];
  let line = '';
  for (const text of item.rest) {
    if (line !== '' && indentWidth + textWidth(line) + gapWidth + textWidth(text) > wrap) {
      lines.push(indent + line);
      line = '';
    }
    line = line === '' ? text : line + gap + text;
  }
  lines.push(indent + line);
  return lines;
}

function layOutItems(written: Item[], settings: FormatSettings): string[] {
  const gap = settings['clause-gap'] === 'tab' ? '\t' : ' '.repeat(settings['clause-gap']);
  const gapWidth = settings['clause-gap'] === 'tab' ? 1 : settings['clause-gap'];
  // Which statements break is decided further down, once the columns are known.
  const items = [...written];
  // What lines up in columns: a one-line statement whole, a broken one's first line.
  const aligned = (item: Item): Cell[] | undefined =>
    item.kind === 'statement' ? item.cells : item.kind === 'broken' ? item.first : undefined;

  // Which statements share columns: each is given a group number. A comment
  // line is passed over, as if it weren't there: it labels what follows
  // rather than separating it.
  const group = new Map<number, number>();
  let current = -1;
  let previous: Item | undefined;
  let lastStatement: Extract<Item, { kind: 'statement' | 'broken' }> | undefined;
  items.forEach((item, index) => {
    if (item.kind === 'comment') return;
    if (item.kind !== 'statement' && item.kind !== 'broken') {
      if (item.kind !== 'blank' || settings['columns-shared-by'] !== 'same-keyword') {
        if (settings['columns-shared-by'] !== 'file') lastStatement = undefined;
      }
      previous = item;
      return;
    }
    const by = settings['columns-shared-by'];
    const joins =
      lastStatement !== undefined &&
      (by === 'file' ||
        (by === 'neighbors' && previous === lastStatement) ||
        (by === 'same-keyword-neighbors' && previous === lastStatement && lastStatement.keyword === item.keyword) ||
        (by === 'same-keyword' && lastStatement.keyword === item.keyword));
    if (!joins) current += 1;
    group.set(index, current);
    lastStatement = item;
    previous = item;
  });

  // Each group's column widths, and the column its trailing comments start at.
  let widths = new Map<number, number[]>();
  const commentAt = new Map<number, number>();
  const measureColumns = () => {
    widths = new Map();
    items.forEach((item, index) => {
      const cells = aligned(item);
      if (cells === undefined) return;
      const id = group.get(index)!;
      const own = widths.get(id) ?? [];
      cells.forEach((cell, at) => (own[at] = Math.max(own[at] ?? 0, textWidth(cell.text))));
      widths.set(id, own);
    });
  };
  // Each cell's text, and where on the line it starts.
  const placed = (cells: Cell[], id: number): { text: string; at: number }[] => {
    const own = widths.get(id)!;
    const result: { text: string; at: number }[] = [];
    let at = 0;
    cells.forEach((cell, index) => {
      // A column empty in every statement of the set, such as the name column
      // of unnamed edges, takes no room; with columns off, neither does an
      // empty cell.
      if (settings.columns === 'off' ? cell.text === '' && index > 0 : own[index] === 0) return;
      result.push({ text: cell.text, at });
      at += (settings.columns === 'off' ? textWidth(cell.text) : own[index]!) + gapWidth;
    });
    return result;
  };
  const lineOf = (cells: Cell[], id: number): string => {
    if (settings.columns === 'off') return placed(cells, id).map((one) => one.text).join(gap);
    let line = '';
    for (const one of placed(cells, id)) line += ' '.repeat(one.at - textWidth(line)) + one.text;
    return line;
  };

  // Which statements break. A statement is measured as it would be printed,
  // lined up with its neighbors, so a short statement padded out past
  // `wrap-at` by a long neighbor's columns breaks too. Breaking one takes its
  // later clauses out of the columns, which can only narrow them and shorten
  // the rest, so they are broken one at a time, the longest on its own first:
  // that is the one most likely to be widening a column the others are past
  // only because of. A statement whose break is settled by its unaligned
  // length alone, since lining it up can only lengthen it, breaks before the
  // first measure: one past `clause-per-line-at`, or past `wrap-at` with no
  // `clause-per-line-at` above it to reach.
  const ownLength = (item: Extract<Item, { kind: 'statement' }>) =>
    textWidth(item.cells.map((cell) => cell.text).filter((text, at) => text !== '' || at === 0).join(gap));
  const breakAt = (index: number, length: number): boolean => {
    const item = items[index]!;
    if (item.kind !== 'statement') return false;
    const broken = breakStatement(item, settings, length);
    items[index] = broken;
    return broken !== item;
  };
  const perLine = settings['clause-per-line-at'];
  const settled = (length: number) => typeof perLine !== 'number' || length > perLine;
  items.forEach((item, index) => {
    if (item.kind !== 'statement') return;
    const own = ownLength(item);
    if (settled(own)) breakAt(index, own);
  });
  for (;;) {
    measureColumns();
    let longest: { index: number; own: number; printed: number } | undefined;
    items.forEach((item, index) => {
      if (item.kind !== 'statement') return;
      const printed = textWidth(lineOf(item.cells, group.get(index)!));
      if (breakStatement(item, settings, printed) === item) return;
      const own = ownLength(item);
      if (longest === undefined || own > longest.own) longest = { index, own, printed };
    });
    if (longest === undefined || !breakAt(longest.index, longest.printed)) break;
  }

  items.forEach((item, index) => {
    if (item.kind !== 'statement') return;
    const id = group.get(index)!;
    commentAt.set(id, Math.max(commentAt.get(id) ?? 0, textWidth(lineOf(item.cells, id))));
  });
  // Where a broken statement's later lines start, measured on its first line
  // as aligned, so `under-text` sits under the text where it was drawn.
  const brokenIndent = (item: Extract<Item, { kind: 'broken' }>, id: number): string => {
    const indent = settings['continued-lines-indent'];
    if (indent === 'tab' || typeof indent === 'number') return continuedIndent(item.first, settings, gapWidth);
    const cells = placed(item.first, id);
    const name = cells[1]?.at ?? textWidth(item.first[0]!.text) + gapWidth;
    if (indent === 'under-name') return ' '.repeat(name);
    if (indent === 'under-text') {
      const at = item.first.findIndex((cell) => cell.quoted);
      const text = cells.find((one) => one.text === item.first[at]?.text);
      return ' '.repeat(text?.at ?? name);
    }
    return ' '.repeat(name + indent.underName);
  };

  const out: string[] = [];
  let blankRun = 0;
  const flushBlanks = () => {
    const blanks = settings['blank-lines'];
    const count =
      blanks === 'as-written' ? blankRun : 'exactly' in blanks ? (blankRun > 0 ? blanks.exactly : 0) : Math.min(blankRun, blanks.atMost);
    for (let i = 0; i < count; i++) out.push('');
    blankRun = 0;
  };

  items.forEach((item, index) => {
    if (item.kind === 'blank') {
      blankRun += 1;
      return;
    }
    flushBlanks();
    switch (item.kind) {
      case 'comment':
        out.push(item.text);
        return;
      case 'verbatim':
        out.push(...item.lines);
        return;
      case 'broken': {
        const id = group.get(index)!;
        const lines = [lineOf(item.first, id), ...continuedLines(item, brokenIndent(item, id), settings, gap, gapWidth)];
        lines.forEach((line, at) => {
          const last = at === lines.length - 1;
          out.push(last && item.comment !== undefined ? `${line}${gap}${item.comment}` : line);
        });
        return;
      }
      case 'kept': {
        const indent = continuedIndent(item.first, settings, gapWidth);
        item.lines.forEach((line, at) => {
          const text = line.cells.map((cell) => cell.text).join(gap);
          const body = line.comment === undefined ? text : text === '' ? line.comment : `${text}${gap}${line.comment}`;
          out.push(at === 0 ? body : indent + body);
        });
        return;
      }
      case 'statement': {
        const id = group.get(index)!;
        const text = lineOf(item.cells, id);
        if (item.comment === undefined) out.push(text);
        else if (settings['trailing-comments'] === 'shared-column') {
          out.push(text + ' '.repeat(commentAt.get(id)! - textWidth(text) + gapWidth) + item.comment);
        } else out.push(text + gap + item.comment);
      }
    }
  });
  flushBlanks();
  return out;
}

/**
 * Where a statement's continued lines start, as `continued-lines-indent` says,
 * measured on its first line's cells. `under-text` falls back to under the
 * name for a statement with no text.
 */
function continuedIndent(first: Cell[], settings: FormatSettings, gapWidth: number): string {
  const indent = settings['continued-lines-indent'];
  if (indent === 'tab') return '\t';
  if (typeof indent === 'number') return ' '.repeat(indent);
  const name = textWidth(first[0]!.text) + gapWidth;
  if (indent === 'under-name') return ' '.repeat(name);
  if (indent === 'under-text') {
    const at = first.findIndex((cell) => cell.quoted);
    if (at === -1) return ' '.repeat(name);
    const before = first.slice(0, at).filter((cell, index) => cell.text !== '' || index === 0);
    return ' '.repeat(before.reduce((width, cell) => width + textWidth(cell.text) + gapWidth, 0));
  }
  return ' '.repeat(name + indent.underName);
}
