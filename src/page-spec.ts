import { nearMatch } from './checks.js';
import { SourceError } from './errors.js';
import { tokenizeLine, type Token } from './lexer.js';

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
 * picks it by.
 */
export const PAGE_EXTENSION = '.reladraw-page';

/** The page kinds this version makes. */
export const PAGE_KINDS = ['list'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** Kinds a spec may name that this version doesn't make, refused by name rather than as unknown words. */
const LATER_KINDS = ['grid', 'versions', 'steps', 'drill-down'];

const PAGE_KEYS = ['title', 'kind'] as const;
const KEYWORDS = ['page', 'diagram'] as const;

export interface PageSpec {
  /** What the page is headed with; without one, the spec's file name. */
  title?: string;
  kind: PageKind;
  entries: SpecEntry[];
}

export interface SpecEntry {
  /** The diagram's path, from the spec's folder. */
  path: string;
  /** What the page picks it by; without one, the diagram's own title. */
  label?: string;
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

function readSpec(pieces: Piece[]): PageSpec {
  let page: { line: number; title?: string; kind?: string; kindLine?: number } | null = null;
  const entries: SpecEntry[] = [];
  const seen = new Map<string, number>();
  for (const piece of pieces) {
    if (piece.kind !== 'statement') continue;
    const { tokens, line } = piece.statement;
    const head = tokens[0]!.token;
    const word = head.quoted ? `"${head.text}"` : head.text;
    if (head.quoted || !(KEYWORDS as readonly string[]).includes(head.text)) {
      const near = head.quoted ? undefined : nearMatch(head.text, KEYWORDS);
      throw new SourceError(
        `a page spec has two kinds of statement, page and diagram, and ${word} is neither` + (near ? ` — did you mean ${near}?` : ''),
        line,
      );
    }
    if (head.text === 'page') {
      if (page) throw new SourceError(`the page's settings are stated once, and they were on line ${page.line} — put these there`, line);
      page = { line };
      const settings = readSettings(tokens.slice(1));
      for (const [key, value] of settings) {
        if (key.name === 'title') page.title = value.text;
        else {
          page.kind = value.text;
          page.kindLine = key.line;
        }
      }
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
    entries.push({ path, ...(labelToken ? { label: labelToken.token.text } : {}), line });
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
  if (entries.length === 0) {
    throw new SourceError('a list page lists diagrams, and this one has none — add one: diagram borrow.reladraw  "Borrow"', page.line);
  }
  return { ...(page.title !== undefined ? { title: page.title } : {}), kind: page.kind as PageKind, entries };
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
      throw new SourceError(key === 'title' ? 'title: needs the title, in quotes: title: "Library"' : `kind: needs a kind: kind: ${PAGE_KINDS[0]}`, at);
    }
    if (key === 'title' && !value.token.quoted) {
      throw new SourceError(`a title goes in quotes: title: "${value.token.text}"`, value.line);
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
  const flush = () => {
    if (run.length === 0) return;
    out.push(...diagramLines(run));
    run = [];
  };
  for (const piece of pieces) {
    if (piece.kind === 'statement' && piece.statement.tokens[0]!.token.text === 'diagram') {
      run.push(piece.statement);
      continue;
    }
    flush();
    if (piece.kind === 'blank') {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
    } else if (piece.kind === 'comment') out.push(piece.text);
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
  return { ...spec, entries: spec.entries.map(({ path, label }) => ({ path, label })) };
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
