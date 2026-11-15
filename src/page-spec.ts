import { nearMatch } from './checks.js';
import { SourceError } from './errors.js';
import { tokenizeLine, type Token } from './lexer.js';
import { THEME_NAMES } from './themes.js';

/**
 * A page spec: a `.reladraw-page` file, which says what page of several
 * diagrams to make. It draws nothing itself. Its statements are written as a
 * diagram's are: a keyword first, `key: value` settings, `//` comments, and a
 * line that starts with whitespace continuing the statement above.
 *
 *     page  title: "Neighborhood library"  kind: list
 *     diagram borrow.reladraw  "Borrow"
 *     diagram return.reladraw  "Return"
 *
 * `page` states the page's own settings, as `diagram` does in a diagram: it
 * names nothing, since the whole file is the page. Each `diagram` lists one
 * diagram, by its path from the spec's folder, with the short label the page
 * picks it by. `group "Lending"` starts a group, which the diagrams after it
 * belong to until the next `group`; the page puts its name over them. A
 * group may have no diagrams yet, and two may not share a name.
 *
 * A grid names its rows and columns, each once with its label, and puts each
 * diagram in a cell, named row then column:
 *
 *     page  title: "Neighborhood library"  kind: grid  rows: "Feature"  columns: "Perspective"
 *     row    borrow  "Borrow"
 *     column desk    "At the desk"
 *     diagram borrow.desk  borrow/desk.reladraw
 *
 * A cell may have no diagram.
 */
export const PAGE_EXTENSION = '.reladraw-page';

/** The page kinds this version makes. */
export const PAGE_KINDS = ['list', 'grid'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** Kinds a spec may name that this version doesn't make, refused by name rather than as unknown words. */
const LATER_KINDS = ['versions', 'steps', 'drill-down'];

const PAGE_KEYS = ['title', 'kind', 'theme', 'rows', 'columns'] as const;
const KEYWORDS = ['page', 'diagram', 'group', 'row', 'column'] as const;

export interface PageSpec {
  /** What the page is headed with; without one, the spec's file name. */
  title?: string;
  kind: PageKind;
  /** The overview's theme; without one, the default. A diagram opened from it keeps its own. */
  theme?: string;
  entries: SpecEntry[];
  /** The groups, in order, empty ones included; none when the spec has no `group`. */
  groups: SpecGroup[];
  /** A grid's rows and columns, in order; only for `kind: grid`. */
  grid?: SpecGrid;
}

export interface SpecGrid {
  /** What the rows are, such as "Feature"; without one, nothing is said. */
  rowsName?: string;
  /** What the columns are, such as "Perspective". */
  columnsName?: string;
  rows: SpecAxis[];
  columns: SpecAxis[];
}

/** One row or one column of a grid: its name in cells, and its label. */
export interface SpecAxis {
  name: string;
  label: string;
  line: number;
}

export interface SpecEntry {
  /** The diagram's path, from the spec's folder. */
  path: string;
  /** What the page picks it by; without one, the diagram's own title. */
  label?: string;
  /** The group it is listed under; none for a diagram before the first `group`. */
  group?: string;
  /** In a grid, the cell it is in, by its row's and its column's names. */
  cell?: { row: string; column: string };
  line: number;
}

export interface SpecGroup {
  name: string;
  line: number;
}

/** One statement: its lines as written, and its tokens, each with the line it came from. */
interface Statement {
  line: number;
  tokens: { token: Token; line: number }[];
  /** The physical lines, from `line` on, with each one's trailing comment. */
  lines: { text: string; comment: string }[];
}

/** A line of the file as the formatter keeps it: a statement, a comment alone, or a blank. */
type Piece = { kind: 'statement'; statement: Statement } | { kind: 'comment'; text: string } | { kind: 'blank' };

/** Read a page spec, refusing anything it doesn't say plainly. */
export function parsePageSpec(text: string): PageSpec {
  return readSpec(piecesOf(text));
}

function piecesOf(text: string): Piece[] {
  const pieces: Piece[] = [];
  let open: Statement | null = null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, index) => {
    const number = index + 1;
    const tokens = tokenizeLine(raw, number);
    const comment = commentOf(raw, tokens);
    if (tokens.length === 0) {
      if (raw.trim() === '') {
        open = null;
        pieces.push({ kind: 'blank' });
      } else if (open) {
        // A comment alone inside a statement stays with it.
        open.lines.push({ text: raw, comment });
      } else {
        pieces.push({ kind: 'comment', text: raw.trim() });
      }
      return;
    }
    const indented = /^\s/.test(raw);
    if (indented) {
      const first = tokens[0]!;
      if (!first.quoted && (KEYWORDS as readonly string[]).includes(first.text)) {
        throw new SourceError(`an indented line continues the statement above, so this "${first.text}" can't start one — remove the indentation`, number);
      }
      if (!open) {
        throw new SourceError('an indented line continues the statement above, and there is none here — remove the indentation', number);
      }
      const statement: Statement = open;
      tokens.forEach((token) => statement.tokens.push({ token, line: number }));
      statement.lines.push({ text: raw, comment });
      return;
    }
    const statement: Statement = { line: number, tokens: tokens.map((token) => ({ token, line: number })), lines: [{ text: raw, comment }] };
    open = statement;
    pieces.push({ kind: 'statement', statement });
  });
  return pieces;
}

/** The `//` comment ending a line, after its last token, or nothing. */
function commentOf(raw: string, tokens: Token[]): string {
  const after = tokens.length === 0 ? raw : raw.slice(tokens[tokens.length - 1]!.end ?? raw.length);
  const at = after.indexOf('//');
  return at < 0 ? '' : after.slice(at).trimEnd();
}

/** The kind the spec's `page` statement names, read ahead of the rest, since a grid's diagram lines read differently; nothing when there is none to find. */
function kindAhead(pieces: Piece[]): string | undefined {
  for (const piece of pieces) {
    if (piece.kind !== 'statement' || piece.statement.tokens[0]!.token.text !== 'page') continue;
    const tokens = piece.statement.tokens;
    const at = tokens.findIndex((one) => !one.token.quoted && one.token.text === 'kind:');
    return at >= 0 ? tokens[at + 1]?.token.text : undefined;
  }
  return undefined;
}

function readSpec(pieces: Piece[]): PageSpec {
  let page: { line: number; title?: string; kind?: string; kindLine?: number; theme?: string; rows?: { text: string; line: number }; columns?: { text: string; line: number } } | null = null;
  const entries: SpecEntry[] = [];
  const groups: SpecGroup[] = [];
  const rows: SpecAxis[] = [];
  const columns: SpecAxis[] = [];
  const seen = new Map<string, number>();
  const cells = new Map<string, number>();
  const grid = kindAhead(pieces) === 'grid';
  for (const piece of pieces) {
    if (piece.kind !== 'statement') continue;
    const { tokens, line } = piece.statement;
    const head = tokens[0]!.token;
    const word = head.quoted ? `"${head.text}"` : head.text;
    if (head.quoted || !(KEYWORDS as readonly string[]).includes(head.text)) {
      const near = head.quoted ? undefined : nearMatch(head.text, KEYWORDS);
      throw new SourceError(
        `a page spec's statements are page, diagram, group, row and column, and ${word} is none of them` + (near ? ` — did you mean ${near}?` : ''),
        line,
      );
    }
    if (head.text === 'group') {
      if (grid) throw new SourceError('a grid places its diagrams by row and column, so it has no groups — use kind: list for groups', line);
      groups.push(readGroup(tokens.slice(1), line, groups));
      continue;
    }
    if (head.text === 'row' || head.text === 'column') {
      if (!grid) throw new SourceError(`${head.text} statements are for a grid, and this page isn't one — make it kind: grid, or take this line out`, line);
      const axis = head.text === 'row' ? rows : columns;
      axis.push(readAxis(head.text, tokens.slice(1), line, axis));
      continue;
    }
    if (head.text === 'page') {
      if (page) throw new SourceError(`the page's settings are stated once, and they were on line ${page.line} — put these there`, line);
      page = { line };
      const settings = readSettings(tokens.slice(1));
      for (const [key, value] of settings) {
        if (key.name === 'title') page.title = value.text;
        else if (key.name === 'rows' || key.name === 'columns') page[key.name] = { text: value.text, line: key.line };
        else if (key.name === 'theme') {
          if (!(THEME_NAMES as readonly string[]).includes(value.text)) {
            const near = nearMatch(value.text, THEME_NAMES);
            throw new SourceError(
              `there is no theme called "${value.text}"` + (near ? ` — did you mean ${near}?` : ` — the themes are ${THEME_NAMES.join(', ')}`),
              key.line,
            );
          }
          page.theme = value.text;
        } else {
          page.kind = value.text;
          page.kindLine = key.line;
        }
      }
      continue;
    }
    if (grid) {
      entries.push(readCell(tokens.slice(1), line, seen, cells));
      continue;
    }
    // diagram <path> ["label"]
    const rest = tokens.slice(1);
    const pathToken = rest[0];
    if (!pathToken) throw new SourceError('a diagram statement names the diagram\'s file: diagram borrow.reladraw  "Borrow"', line);
    if (!pathToken.token.quoted && pathToken.token.text.endsWith(':')) {
      throw new SourceError(`a diagram statement names a file first, before any setting: diagram borrow.reladraw  "Borrow"`, line);
    }
    const path = pathToken.token.text;
    if (!path.endsWith('.reladraw')) {
      throw new SourceError(`a page lists .reladraw diagrams, and "${path}" isn't one`, pathToken.line);
    }
    const labelToken = rest[1];
    if (labelToken && !labelToken.token.quoted) {
      if (labelToken.token.text.endsWith(':')) {
        throw new SourceError(`a diagram takes no settings yet, so ${labelToken.token.text} means nothing here`, labelToken.line);
      }
      throw new SourceError(`a diagram's label goes in quotes: diagram ${path}  "${labelToken.token.text}"`, labelToken.line);
    }
    if (rest.length > 2) {
      const extra = rest[2]!;
      throw new SourceError(
        `a diagram statement is a file and a label, and ${extra.token.quoted ? `"${extra.token.text}"` : extra.token.text} is a third thing — one label per diagram`,
        extra.line,
      );
    }
    const before = seen.get(path);
    if (before !== undefined) throw new SourceError(`${path} is listed twice, here and on line ${before} — once is enough`, line);
    seen.set(path, line);
    if (labelToken && labelToken.token.text.trim() === '') {
      throw new SourceError(`a diagram's label is what the page picks it by, so it can't be empty — leave it out to use the diagram's title`, labelToken.line);
    }
    const group = groups[groups.length - 1];
    entries.push({ path, ...(labelToken ? { label: labelToken.token.text } : {}), ...(group ? { group: group.name } : {}), line });
  }
  if (!page) {
    throw new SourceError('a page spec says what page it makes, and this one doesn\'t — start it with: page  kind: list', 1);
  }
  if (page.kind === undefined) {
    throw new SourceError('the page says what kind of page it is: page  kind: list', page.line);
  }
  if (!(PAGE_KINDS as readonly string[]).includes(page.kind)) {
    if (LATER_KINDS.includes(page.kind)) {
      throw new SourceError(`this version of reladraw doesn't make a ${page.kind} page yet — it makes kind: ${PAGE_KINDS.join(', ')}`, page.kindLine!);
    }
    const near = nearMatch(page.kind, PAGE_KINDS);
    throw new SourceError(
      `there is no page kind "${page.kind}"` + (near ? ` — did you mean ${near}?` : ` — the kinds are ${PAGE_KINDS.join(', ')}`),
      page.kindLine!,
    );
  }
  if (page.kind !== 'grid') {
    for (const key of ['rows', 'columns'] as const) {
      const stated = page[key];
      if (stated) throw new SourceError(`${key}: names a grid's ${key}, and this page isn't a grid — make it kind: grid, or take ${key}: out`, stated.line);
    }
  }
  if (page.kind === 'grid') {
    if (rows.length === 0) throw new SourceError('a grid has rows, and this one has none — add one: row  borrow  "Borrow"', page.line);
    if (columns.length === 0) throw new SourceError('a grid has columns, and this one has none — add one: column  desk  "At the desk"', page.line);
    for (const entry of entries) {
      const { row, column } = entry.cell!;
      for (const [which, name, axis] of [['row', row, rows], ['column', column, columns]] as const) {
        if (axis.some((one) => one.name === name)) continue;
        const near = nearMatch(name, axis.map((one) => one.name));
        throw new SourceError(
          `there is no ${which} called "${name}"` + (near ? ` — did you mean ${near}?` : ` — the ${which}s are ${axis.map((one) => one.name).join(', ')}`),
          entry.line,
        );
      }
    }
    // Reading order: along each row, the rows in the order they were stated.
    const place = (entry: SpecEntry) =>
      rows.findIndex((one) => one.name === entry.cell!.row) * columns.length + columns.findIndex((one) => one.name === entry.cell!.column);
    entries.sort((a, b) => place(a) - place(b));
  }
  if (entries.length === 0) {
    throw new SourceError(
      page.kind === 'grid'
        ? 'a grid page shows diagrams, and this one has none — put one in a cell: diagram borrow.desk  borrow/desk.reladraw'
        : 'a list page lists diagrams, and this one has none — add one: diagram borrow.reladraw  "Borrow"',
      page.line,
    );
  }
  return {
    ...(page.title !== undefined ? { title: page.title } : {}),
    kind: page.kind as PageKind,
    ...(page.theme !== undefined ? { theme: page.theme } : {}),
    entries,
    groups,
    ...(page.kind === 'grid'
      ? {
          grid: {
            ...(page.rows ? { rowsName: page.rows.text } : {}),
            ...(page.columns ? { columnsName: page.columns.text } : {}),
            rows,
            columns,
          },
        }
      : {}),
  };
}

/** `row borrow "Borrow"` or `column desk "At the desk"`: a name, then its label in quotes, the name not one used before. */
function readAxis(which: 'row' | 'column', tokens: { token: Token; line: number }[], line: number, before: SpecAxis[]): SpecAxis {
  const example = which === 'row' ? 'row  borrow  "Borrow"' : 'column  desk  "At the desk"';
  const name = tokens[0];
  if (!name) throw new SourceError(`a ${which} statement names the ${which} and gives its label: ${example}`, line);
  if (name.token.quoted) {
    throw new SourceError(`a ${which}'s name comes first, unquoted, and its label after it, in quotes: ${example}`, name.line);
  }
  if (name.token.text.endsWith(':')) throw new SourceError(`a ${which} takes no settings, so ${name.token.text} means nothing here`, name.line);
  if (name.token.text.includes('.')) {
    throw new SourceError(`a ${which}'s name can't have a dot in it: a cell is named row.column, so the dot is what splits them`, name.line);
  }
  const label = tokens[1];
  if (!label) throw new SourceError(`a ${which} needs its label, in quotes, which the page heads it with: ${which} ${name.token.text}  "…"`, line);
  if (!label.token.quoted) {
    if (label.token.text.endsWith(':')) throw new SourceError(`a ${which} takes no settings, so ${label.token.text} means nothing here`, label.line);
    throw new SourceError(`a ${which}'s label goes in quotes: ${which} ${name.token.text}  "${label.token.text}"`, label.line);
  }
  if (label.token.text.trim() === '') throw new SourceError(`a ${which}'s label is what the page heads it with, so it can't be empty`, label.line);
  if (tokens.length > 2) {
    const extra = tokens[2]!;
    throw new SourceError(
      `a ${which} statement is a name and a label, and ${extra.token.quoted ? `"${extra.token.text}"` : extra.token.text} is a third thing`,
      extra.line,
    );
  }
  const same = before.find((one) => one.name === name.token.text);
  if (same) throw new SourceError(`there is already a ${which} called ${name.token.text}, on line ${same.line} — two ${which}s can't share a name`, line);
  return { name: name.token.text, label: label.token.text, line };
}

/** A grid's `diagram borrow.desk borrow/desk.reladraw`: a cell, row then column, and the diagram in it. */
function readCell(tokens: { token: Token; line: number }[], line: number, seen: Map<string, number>, cells: Map<string, number>): SpecEntry {
  const example = 'diagram borrow.desk  borrow/desk.reladraw';
  const cell = tokens[0];
  if (!cell) throw new SourceError(`a grid's diagram statement names its cell, row then column, and its file: ${example}`, line);
  const text = cell.token.text;
  if (cell.token.quoted || text.endsWith('.reladraw')) {
    throw new SourceError(`in a grid, a diagram names its cell first, row then column, and its file after: ${example}`, cell.line);
  }
  if (text.endsWith(':')) throw new SourceError(`a diagram names its cell first, before any setting: ${example}`, cell.line);
  const parts = text.split('.');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    throw new SourceError(`a cell is named by its row and its column with a dot between, such as borrow.desk, and "${text}" isn't`, cell.line);
  }
  const pathToken = tokens[1];
  if (!pathToken) throw new SourceError(`the cell ${text} needs its diagram's file: diagram ${text}  ${parts.join('/')}.reladraw`, line);
  const path = pathToken.token.text;
  if (!pathToken.token.quoted && path.endsWith(':')) throw new SourceError(`a diagram takes no settings yet, so ${path} means nothing here`, pathToken.line);
  if (!path.endsWith('.reladraw')) throw new SourceError(`a page shows .reladraw diagrams, and "${path}" isn't one`, pathToken.line);
  if (tokens.length > 2) {
    const extra = tokens[2]!;
    throw new SourceError(
      `a grid's diagram statement is a cell and a file, and ${extra.token.quoted ? `"${extra.token.text}"` : extra.token.text} is a third thing — a cell's label is its row's and its column's`,
      extra.line,
    );
  }
  const before = cells.get(text);
  if (before !== undefined) throw new SourceError(`the cell ${text} has a diagram already, on line ${before} — a cell holds one`, line);
  cells.set(text, line);
  const listed = seen.get(path);
  if (listed !== undefined) throw new SourceError(`${path} is listed twice, here and on line ${listed} — once is enough`, line);
  seen.set(path, line);
  return { path, cell: { row: parts[0]!, column: parts[1]! }, line };
}

/** `group "Lending"`: a name in quotes and nothing else, not one an earlier group has. */
function readGroup(tokens: { token: Token; line: number }[], line: number, before: SpecGroup[]): SpecGroup {
  const name = tokens[0];
  if (!name) throw new SourceError('a group statement names the group, in quotes: group "Lending"', line);
  if (!name.token.quoted) {
    if (name.token.text.endsWith(':')) throw new SourceError(`a group takes no settings, so ${name.token.text} means nothing here`, name.line);
    throw new SourceError(`a group's name goes in quotes: group "${name.token.text}"`, name.line);
  }
  if (name.token.text.trim() === '') {
    throw new SourceError('a group\'s name is what the page heads it with, so it can\'t be empty', name.line);
  }
  if (tokens.length > 1) {
    const extra = tokens[1]!;
    throw new SourceError(
      `a group statement is just its name, and ${extra.token.quoted ? `"${extra.token.text}"` : extra.token.text} is a second thing — the diagrams in it go on the lines after it`,
      extra.line,
    );
  }
  const same = before.find((one) => one.name === name.token.text);
  if (same) {
    throw new SourceError(`there is already a group called "${name.token.text}", on line ${same.line} — two groups can't share a name`, line);
  }
  return { name: name.token.text, line };
}

/** A `page` statement's settings, each key with its value, refusing a name, an unknown key or a key twice. */
function readSettings(
  tokens: { token: Token; line: number }[],
):[{ name: (typeof PAGE_KEYS)[number]; line: number }, Token][] {
  const out: [{ name: (typeof PAGE_KEYS)[number]; line: number }, Token][] = [];
  const named = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    const { token, line: at } = tokens[i]!;
    if (token.quoted || !token.text.endsWith(':') || token.text.length < 2) {
      const shown = token.quoted ? `"${token.text}"` : token.text;
      throw new SourceError(
        token.quoted && i === 0
          ? `page takes no name: the file is the page — write its title as title: ${shown}`
          : `page takes settings, such as title: "Library" and kind: list, and ${shown} isn't one`,
        at,
      );
    }
    const key = token.text.slice(0, -1);
    if (!(PAGE_KEYS as readonly string[]).includes(key)) {
      const near = nearMatch(key, PAGE_KEYS);
      throw new SourceError(
        `page has no setting "${key}"` + (near ? ` — did you mean ${near}:?` : ` — its settings are ${PAGE_KEYS.map((one) => `${one}:`).join(', ')}`),
        at,
      );
    }
    if (named.has(key)) throw new SourceError(`${key}: is stated twice on the page — once is enough`, at);
    named.add(key);
    const value = tokens[i + 1];
    if (!value || (!value.token.quoted && value.token.text.endsWith(':'))) {
      throw new SourceError(
        key === 'title' ? 'title: needs the title, in quotes: title: "Library"'
        : key === 'theme' ? 'theme: needs a theme: theme: nord'
        : key === 'rows' ? 'rows: needs what the rows are, in quotes: rows: "Feature"'
        : key === 'columns' ? 'columns: needs what the columns are, in quotes: columns: "Perspective"'
        : `kind: needs a kind: kind: ${PAGE_KINDS[0]}`,
        at,
      );
    }
    if (key === 'title' && !value.token.quoted) {
      throw new SourceError(`a title goes in quotes: title: "${value.token.text}"`, value.line);
    }
    if ((key === 'rows' || key === 'columns') && !value.token.quoted) {
      throw new SourceError(`what the ${key} are goes in quotes: ${key}: "${value.token.text}"`, value.line);
    }
    out.push([{ name: key as (typeof PAGE_KEYS)[number], line: at }, value.token]);
    i += 1;
  }
  return out;
}

/**
 * A page spec laid out again: one blank line at most between statements, two
 * spaces between a statement's parts, neighboring `diagram` lines in columns,
 * and comments kept where they were. A `page` statement written over several
 * lines stays one setting a line. No word is respelled, and the result is
 * checked to say what the original said.
 */
export function formatPageSpec(text: string): string {
  const pieces = piecesOf(text);
  const before = readSpec(pieces);
  const out: string[] = [];
  let run: Statement[] = [];
  let axes: Statement[] = [];
  const flush = () => {
    if (run.length > 0) out.push(...diagramLines(run));
    if (axes.length > 0) out.push(...axisLines(axes));
    run = [];
    axes = [];
  };
  for (const piece of pieces) {
    const head = piece.kind === 'statement' ? piece.statement.tokens[0]!.token.text : '';
    if (piece.kind === 'statement' && head === 'diagram') {
      if (axes.length > 0) flush();
      run.push(piece.statement);
      continue;
    }
    if (piece.kind === 'statement' && (head === 'row' || head === 'column')) {
      if (run.length > 0) flush();
      axes.push(piece.statement);
      continue;
    }
    flush();
    if (piece.kind === 'blank') {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
    } else if (piece.kind === 'comment') out.push(piece.text);
    else if (piece.statement.tokens[0]!.token.text === 'group') out.push(groupLine(piece.statement));
    else out.push(...pageLines(piece.statement));
  }
  flush();
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  const laid = out.join('\n') + '\n';
  if (JSON.stringify(stripLines(readSpec(piecesOf(laid)))) !== JSON.stringify(stripLines(before))) {
    throw new Error('formatting would change what the spec says, so it was left as written — please report this');
  }
  return laid;
}

function stripLines(spec: PageSpec): unknown {
  return {
    ...spec,
    entries: spec.entries.map(({ path, label, group, cell }) => ({ path, label, group, cell })),
    groups: spec.groups.map(({ name }) => name),
    grid: spec.grid && {
      ...spec.grid,
      rows: spec.grid.rows.map(({ name, label }) => ({ name, label })),
      columns: spec.grid.columns.map(({ name, label }) => ({ name, label })),
    },
  };
}

/** Neighboring `row` and `column` lines, their names and labels in columns. */
function axisLines(run: Statement[]): string[] {
  const rows = run.map((statement) => {
    const parts = statement.tokens.map((one) => written(statement, one));
    return { keyword: parts[0]!, name: parts[1]!, label: parts[2]!, comment: commentsOf(statement).join('  ') };
  });
  const keywordWidth = Math.max(...rows.map((row) => row.keyword.length));
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  return rows.map((row) => {
    const text = `${row.keyword.padEnd(keywordWidth)} ${row.name.padEnd(nameWidth)}  ${row.comment ? `${row.label.padEnd(labelWidth)}  ${row.comment}` : row.label}`;
    return text.trimEnd();
  });
}

function groupLine(statement: Statement): string {
  const text = `group ${written(statement, statement.tokens[1]!)}`;
  const comment = commentsOf(statement).join('  ');
  return comment ? `${text}  ${comment}` : text;
}

/** A token as it was written on its line, quotes and escapes included. */
function written(statement: Statement, at: { token: Token; line: number }): string {
  const raw = statement.lines[at.line - statement.line]!.text;
  const { start, end } = at.token;
  return start !== undefined && end !== undefined ? raw.slice(start, end) : at.token.quoted ? JSON.stringify(at.token.text) : at.token.text;
}

/** Comments written inside a statement, gathered so none is lost. */
function commentsOf(statement: Statement): string[] {
  return statement.lines.map((one) => one.comment).filter((one) => one !== '');
}

function pageLines(statement: Statement): string[] {
  const settings: string[] = [];
  const comments: string[][] = [];
  const tokens = statement.tokens.slice(1);
  for (let i = 0; i < tokens.length; i += 2) {
    const key = tokens[i]!;
    const value = tokens[i + 1]!;
    settings.push(`${written(statement, key)} ${written(statement, value)}`);
    // The comment on the line a setting starts on goes with that setting.
    const line = statement.lines[key.line - statement.line]!;
    const first = tokens.findIndex((one) => one.line === key.line);
    comments.push(first === i && line.comment !== '' ? [line.comment] : []);
  }
  const multiLine = statement.lines.length > 1;
  if (!multiLine) {
    const comment = commentsOf(statement)[0];
    const text = ['page', ...settings].join('  ');
    return [comment ? `${text}  ${comment}` : text];
  }
  // A comment on the `page` line itself, before any setting, stays on it.
  const head = statement.lines[0]!;
  const headComment = tokens.some((one) => one.line === statement.line) ? '' : head.comment;
  const lines: string[] = headComment ? [`page  ${headComment}`] : [];
  settings.forEach((setting, i) => {
    const prefix = lines.length === 0 ? 'page  ' : '      ';
    const comment = comments[i]![0];
    lines.push(comment ? `${prefix}${setting}  ${comment}` : `${prefix}${setting}`);
  });
  return lines.length > 0 ? lines : ['page'];
}

function diagramLines(run: Statement[]): string[] {
  const rows = run.map((statement) => {
    const parts = statement.tokens.slice(1).map((one) => written(statement, one));
    return { path: parts[0]!, label: parts[1], comment: commentsOf(statement).join('  ') };
  });
  const width = Math.max(...rows.map((row) => row.path.length));
  const labelWidth = Math.max(0, ...rows.map((row) => (row.label ?? '').length));
  return rows.map((row) => {
    let text = `diagram ${row.label !== undefined || row.comment ? row.path.padEnd(width) : row.path}`;
    if (row.label !== undefined) text += `  ${row.comment ? row.label.padEnd(labelWidth) : row.label}`;
    else if (row.comment && labelWidth > 0) text += `  ${''.padEnd(labelWidth)}`;
    if (row.comment) text += `  ${row.comment}`;
    return text.trimEnd() === text ? text : text.trimEnd();
  });
}

/** A diagram's path as a spec writes it: quoted when it has a space or a quote in it. */
function specPath(path: string): string {
  return /[\s"]/.test(path) || path.startsWith('//') ? JSON.stringify(path) : path;
}

/**
 * The spec a page of several diagrams implies when it was asked for without
 * one, by a folder or by several files: its title, and each diagram by its
 * path as given. `reladraw serve` shows it on the overview's Edit, and its
 * first Save writes it.
 */
export function impliedPageSpec(title: string, paths: string[], about?: string): string {
  const lines = [
    ...(about ? [`// ${about}`] : []),
    `page  title: ${JSON.stringify(title)}  kind: list`,
    '',
    ...paths.map((path) => `diagram ${specPath(path)}`),
  ];
  return formatPageSpec(lines.join('\n') + '\n');
}

/**
 * The spec with each diagram's path rewritten by `move`, everything else as
 * written: for a spec saved into another folder than the one its paths were
 * written from. A spec that doesn't read is returned as it is.
 */
export function moveSpecPaths(text: string, move: (path: string) => string): string {
  let pieces: Piece[];
  try {
    pieces = piecesOf(text);
    readSpec(pieces);
  } catch {
    return text;
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const piece of pieces) {
    if (piece.kind !== 'statement') continue;
    const { statement } = piece;
    if (statement.tokens[0]!.token.text !== 'diagram') continue;
    const at = statement.tokens[1];
    if (!at || at.token.start === undefined || at.token.end === undefined) continue;
    const raw = lines[at.line - 1]!;
    lines[at.line - 1] = raw.slice(0, at.token.start) + specPath(move(at.token.text)) + raw.slice(at.token.end);
  }
  return lines.join('\n');
}
