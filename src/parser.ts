import type {
  AlignPlacement,
  Attrs,
  Axis,
  BundleStmt,
  Limit,
  NodeStmt,
  Side,
  Placement,
  DefaultStmt,
  DefaultTarget,
  DiagramStmt,
  Direction,
  Document,
  EdgeMarks,
  EdgeStmt,
  EdgeTextPlace,
  EdgeTextStmt,
  TextSide,
  IconStmt,
  Mark,
  MarkText,
  Part,
  PlacementTarget,
  PointExpr,
  PointStmt,
  Fraction,
  RegionStmt,
  Stmt,
  StyleStmt,
  Way,
  ViaEntry,
  ViaStop,
} from './ast.js';
import {
  BUNDLE_KEYS,
  COLOR_KEYS,
  POINT_KEYS,
  REGION_KEYS,
  WAYS,
  describePoint,
  fractionAxis,
  DEFAULT_KEYS,
  DEFAULT_TARGETS,
  DIAGRAM_KEYS,
  DIRECTIONS,
  describePlacement,
  SIDE_AXIS,
  SIDES,
  TEXT_KEYS,
  MARK_TEXT_KEYS,
  POINT_TEXT_SIDES,
  LINE_KEYS,
  LINE_VALUES,
  BORDER_KEYS,
  CONTENTS_KEYS,
  EDGE_ORDER_KEYS,
  LAYOUT_KEYS,
  PLACEMENT_KEYS,
  BOUNDARY_PARTS,
  INWARD,
  MARKS,
  MARK_GLYPHS,
  OPPOSITE,
  isDirection,
  isPart,
  isPosition,
  listTargets,
  nameTarget,
} from './ast.js';
import { CHECK_DEFAULTS, CHECK_KINDS, setCheck } from './checks.js';
import { SourceError } from './errors.js';
import { STATEMENT_KEYWORDS } from './grammar.js';
import { isAttrKey, nameMark, OpenString, tokenizeLine, type Token } from './lexer.js';
import { LINKS_KEY, type Link, type LinkIcon } from './links.js';
import { SHAPE_SETTINGS } from './outline.js';
import { checkOpacity } from './place.js';

/** The settings a shape's bracket takes as a word on its own: `cylinder (lying)`. */
const SHAPE_FLAGS = [...new Set(Object.values(SHAPE_SETTINGS).flatMap((one) => Object.entries(one).filter(([, kind]) => kind === 'flag').map(([name]) => name)))];
import { readSize, SIZE_KEYS, writeSize } from './size.js';
import { THEME_COLORS, THEME_NAMES, THEMES } from './themes.js';

/**
 * One statement as `parse` gathered it, before reading: the line it starts on,
 * and each of its lines with that line's tokens. A comment-only line inside it
 * has no tokens and is not listed.
 */
export interface Gathered {
  line: number;
  lines: { line: number; tokens: Token[] }[];
}

/**
 * Set while `clausesOf` runs: the first token of every clause the parser
 * reads, so the formatter can tell where one clause ends and the next begins
 * without a second grammar of its own. Clauses inside brackets are recorded
 * too, and the formatter passes over them.
 */
let clauseStarts: Set<Token> | null = null;

/**
 * Parse a source for the formatter: each statement as gathered, and the first
 * token of each clause read. Throws as `parse` does, so a file that does not
 * parse is never rewritten.
 */
export function clausesOf(source: string): { statements: Gathered[]; starts: Set<Token> } {
  const statements: Gathered[] = [];
  const starts = new Set<Token>();
  clauseStarts = starts;
  try {
    parse(source, (statement) => statements.push(statement));
  } finally {
    clauseStarts = null;
  }
  return { statements, starts };
}

/**
 * Parse a whole source file. A statement starts on an unindented line and runs
 * on through any line that starts with whitespace; a blank line or the next
 * unindented one ends it. How much whitespace never matters, only whether
 * there is any, so two lines that look alike cannot mean different things.
 *
 * An indented comment stays inside the statement and an unindented one ends
 * it. An indented line with nothing open above it is refused rather than read
 * as a statement of its own: it is a stray indent or a deleted first line, and
 * both are worth hearing about.
 *
 * A `"""` string is the one thing that crosses these rules: the lines it spans
 * are its own, blank or not, and a line opening with one continues the
 * statement above without being indented.
 */
export function parse(source: string, seen?: (statement: Gathered) => void): Document {
  const statements: Stmt[] = [];
  /** The statement being gathered, the line it starts on, and its lines' tokens. */
  let open: { tokens: Token[]; line: number; lines: Gathered['lines'] } | null = null;
  // Brackets may close on a later line, and the lexer only reads `)` as a
  // bracket while one is open, so the depth is carried from line to line.
  let depth = 0;

  const close = () => {
    if (open) {
      seen?.({ line: open.line, lines: open.lines });
      statements.push(parseStatement(open.tokens, open.line));
    }
    open = null;
    depth = 0;
  };

  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    let line = lines[index]!;
    if (line.trim() === '') {
      close();
      continue;
    }

    // A line opening with `"""` continues the statement above without being
    // indented, because nothing else could start with one: no statement begins
    // with a string, so `icon rack` on one line and the SVG from the next is
    // unambiguous. The exception is that narrow on purpose — a statement that
    // could carry on through any line would turn a forgotten word into an error
    // about some other line.
    const indented = line[0] === ' ' || line[0] === '\t';
    const continues = indented || line.startsWith('"""');
    if (!continues) close();

    // A `"""` string may run on over the lines after it, blank ones included,
    // and every line it covers belongs to it rather than to the statement
    // structure above.
    let tokens: Token[];
    for (;;) {
      try {
        tokens = tokenizeLine(line, lineNumber, depth);
        break;
      } catch (error) {
        if (!(error instanceof OpenString) || index + 1 >= lines.length) throw error;
        index += 1;
        line += '\n' + lines[index]!;
      }
    }
    if (tokens.length === 0) continue;

    if (!continues) {
      open = { tokens: [...tokens], line: lineNumber, lines: [{ line: lineNumber, tokens }] };
    } else {
      const first = tokens[0]!;
      if (!open) {
        throw new SourceError(
          indented
            ? 'this line is indented, which continues the statement above, but there is none to ' +
                'continue — remove the indentation to start a new statement'
            : 'a """ string at the start of a line belongs to the statement above, but there is ' +
                'none — write it after the words it goes with, such as `icon rack`',
          lineNumber,
        );
      }
      if (!first.quoted && (STATEMENT_KEYWORDS as readonly string[]).includes(first.text)) {
        throw new SourceError(
          `\`${first.text}\` cannot continue the statement above — an indented line continues ` +
            `the one before it, so remove the indentation to start a new statement`,
          lineNumber,
        );
      }
      open.tokens.push(...tokens);
      open.lines.push({ line: lineNumber, tokens });
    }

    for (const token of tokens) {
      if (token.quoted) continue;
      if (token.text === '(') depth += 1;
      else if (token.text === ')') depth -= 1;
    }
  }
  close();

  return { statements };
}

/**
 * Find the line at fault for an error reported on the first line of a
 * continued statement. Everything after the parser reports a statement by the
 * line it starts on, which for a continued one is often not where the mistake
 * is, so this asks which line brings the error in: `run` is tried on the
 * source with the statement cut after each of its lines in turn, and the first
 * cut that fails with the same message names the line. A cut that fails
 * differently — a bracket not yet closed, a placement not yet written — is not
 * the culprit and is passed over. Lines keep their numbers, because what is cut
 * is blanked rather than removed.
 *
 * This costs a few extra runs, and only when there is an error to report.
 */
export function blame(source: string, error: SourceError, run: (source: string) => unknown): SourceError {
  const lines = source.split(/\r?\n/);
  const start = error.line - 1;
  const first = lines[start];
  if (first === undefined || first.trim() === '' || first[0] === ' ' || first[0] === '\t') return error;

  let end = start;
  while (end + 1 < lines.length && lines[end + 1]!.trim() !== '' && /^[ \t]/.test(lines[end + 1]!)) end += 1;
  if (end === start) return error;

  for (let last = start; last < end; last++) {
    const cut = lines.map((line, index) => (index > last && index <= end ? '' : line)).join('\n');
    try {
      run(cut);
    } catch (partial) {
      if (partial instanceof SourceError && partial.message === error.message) {
        return last === start ? error : new SourceError(error.message, last + 1);
      }
    }
  }
  return new SourceError(error.message, end + 1);
}

function parseStatement(tokens: Token[], line: number): Stmt {
  const keyword = tokens[0];
  if (!keyword || keyword.quoted) {
    throw new SourceError('a statement must begin with a keyword', line);
  }

  // What a line break inside a node's or an edge's text should mean has not
  // been decided, so until it is a `"""` string is refused anywhere but the one
  // place it was made for, rather than drawn in some way that might change.
  if (keyword.text !== 'icon' && tokens.some((token) => token.triple)) {
    throw new SourceError(
      'a """ string holds the SVG of an `icon` declaration and is not accepted anywhere else yet — ' +
        'use ordinary quotes here',
      line,
    );
  }

  switch (keyword.text) {
    case 'icon':
      return parseIcon(tokens, line);
    case 'node':
      return parseNode(tokens, line);
    case 'edge':
      return parseEdge(tokens, line);
    case 'style':
      return parseStyle(tokens, line);
    case 'diagram':
      return parseDiagram(tokens, line);
    case 'default':
      return parseDefault(tokens, line);
    case 'point':
      return parsePoint(tokens, line);
    case 'region':
      return parseRegion(tokens, line);
    case 'bundle':
      return parseBundle(tokens, line);
    case 'guide':
      return parseGuide(tokens, line);
    default:
      throw new SourceError(substitution(keyword.text, tokens), line);
  }
}

/**
 * The statement keywords that are not words in this language, and the word to
 * write instead. `box` and `link` were the keywords until 0.3.0; `rect` and
 * `arrow` never were, and are here because they are what somebody arriving from
 * another format types first.
 *
 * Refused by name with the substitution quoted, the same treatment `stroke:`
 * and `width:` get. A synonym was the other candidate and is refused for the
 * reasons in the design record: an alias is a variant every reader has to
 * learn, and the statement keyword would become the one place a misspelling
 * silently succeeds.
 */
const SUBSTITUTIONS: Record<string, 'node' | 'edge'> = {
  box: 'node',
  rect: 'node',
  link: 'edge',
  arrow: 'edge',
};

/**
 * What to say about a word that opens no statement. A word this language once
 * used, or one another format uses, gets the replacement quoted back in the
 * author's own name for the thing; anything else has no remedy but its
 * spelling.
 */
function substitution(word: string, head: Token[]): string {
  // A note is not a kind of statement any more, and the reason is worth the
  // longer message: a keyword names a picture, and "note" names a use. Free
  // text is a brace caption, a title over a diagram or an aside, so the
  // picture it names is a node with no body — which is what to write.
  if (word === 'note') {
    return `reladraw has no \`note\` statement — a note is a node with no body, so try ` +
      `\`node ${rewrite(head)} shape: none\``;
  }
  // A statement until 0.4.0, then the attribute `deck:` until the redesign.
  if (word === 'deck') {
    const name = head[1] && !head[1].quoted ? head[1].text : '<name>';
    const texts = head.slice(2).map((token) => (token.quoted ? quoteOf(token.text) : token.text));
    return `reladraw has no \`deck\` statement — a deck is a container and its cards are its children, the front one first: ` +
      `\`node ${name} ""  layout: deck  cards: "…" ${texts.length > 0 ? texts.join(' ') : '"…"'}\``;
  }
  const replacement = SUBSTITUTIONS[word];
  if (replacement === undefined) return `unknown statement "${word}"`;
  const plural = replacement === 'node' ? 'nodes' : 'edges';
  // Quote the fix in the line the author actually wrote. `node parser` and
  // `edge a -> b` both say more than a placeholder does, and the whole head is
  // what makes the second of those readable.
  const rest = rewrite(head);
  const example = rest === '' ? '' : ` \u2014 try \`${replacement} ${rest}\``;
  return `reladraw calls these ${plural}, so there is no \`${word}\` statement${example}`;
}

/** Everything after the keyword, written back the way the author would type it. */
function rewrite(head: Token[]): string {
  return head
    .slice(1)
    .map((token) => (token.quoted ? quoteOf(token.text) : token.text))
    .join(' ');
}

/** The value as the author would have to write it back into a text. */
function quoteOf(text: string): string {
  return `"${text.replace(/"/g, '\\"')}"`;
}

/**
 * Everything after a statement's positional head: its attributes and, on a
 * node, its placements, in whatever order they were written.
 *
 * The ordering rule that used to stand here — placements first, attributes
 * after — existed because a bare `gap:` written between two placements could
 * not be told from the node-wide default. Gaps went into brackets on their own
 * placement, so that ambiguity is gone and with it the reason for the rule. A
 * `key:` token can never open a placement and a placement never opens with one,
 * so the two interleave with nothing to resolve.
 */
function parseTail(
  tokens: Token[],
  start: number,
  line: number,
  subject: string,
  other?: (tokens: Token[], at: number) => number | undefined,
): { attrs: Attrs; placements: Placement[] } {
  const attrs: Attrs = {};
  const placements: Placement[] = [];
  let i = start;

  while (i < tokens.length) {
    const token = tokens[i]!;
    clauseStarts?.add(token);
    if (isAttrKey(token)) {
      i = readAttr(tokens, i, attrs, line, subject);
      continue;
    }
    const taken = other?.(tokens, i);
    if (taken !== undefined) {
      i = taken;
      continue;
    }
    const read = readPlacement(tokens, i, line, subject);
    placements.push(read.placement);
    i = read.next;
  }

  return { attrs, placements };
}

/**
 * The attribute keys whose value is a bracket rather than a word, and what may
 * be written inside it. `text:` is a style's way of saying what a node says in
 * the brackets after its own string; `contents:` names a part whose two
 * properties are independent and sit one level below the node.
 */
const BRACKET_KEYS: Record<string, readonly string[]> = {
  text: TEXT_KEYS,
  contents: CONTENTS_KEYS,
  line: LINE_KEYS,
  border: BORDER_KEYS,
  checks: CHECK_KINDS,
};

/** How each bracketed key's error quotes itself back, and what it is about. */
const BRACKET_ABOUT: Record<string, { kind: string; example: string }> = {
  text: { kind: 'a text', example: 'color: theme-muted' },
  contents: { kind: 'a `contents:` bracket', example: 'widths: match' },
  line: { kind: 'a line', example: 'path: square' },
  border: { kind: 'a border', example: 'thickness: thick' },
  checks: { kind: 'a `checks:` bracket', example: 'edge-crossings: on' },
};

/**
 * Which of the line's properties a word belongs to, so that `line: square` —
 * the color key given a shape — can be pointed at the bracket.
 */
function linePropertyOf(word: string): string | undefined {
  for (const [property, words] of Object.entries(LINE_VALUES)) {
    if ((words as readonly string[]).includes(word) && word !== 'normal') return property;
  }
  return undefined;
}

/**
 * The top-level keys that moved into the text's bracket in 0.3.0, and the
 * substitution each one gets. They are properties of a node's *text* and never
 * of the node, and leaving them at the top level is what let `size:` sit beside
 * `fill:` as though the two were the same sort of statement.
 */
const MOVED_INTO_BRACKET = ['size', 'wrap', 'align'] as const;

/**
 * Store one attribute, refusing a key the line has already set. Two words on
 * one line are equally explicit, so nothing says which was meant — and keeping
 * either drops the other in silence. It is almost always an edit that forgot to
 * delete the old value, so the error shows both and asks for one.
 */
function setOnce(
  attrs: Attrs,
  key: string,
  value: string,
  subject: string,
  line: number,
  shown: { key: string; value: (value: string) => string } = { key, value: (v) => v },
): void {
  const had = attrs[key];
  if (had !== undefined) {
    throw new SourceError(
      `${subject}: "${shown.key}" is written twice (${shown.value(had)}, ${shown.value(value)}) — keep one`,
      line,
    );
  }
  attrs[key] = value;
}

/** Read one `key: value` pair, and refuse the words that used to be keys. */
function readAttr(
  tokens: Token[],
  at: number,
  attrs: Attrs,
  line: number,
  subject: string,
): number {
  const keyToken = tokens[at]!;
  clauseStarts?.add(keyToken);
  const key = keyToken.text.slice(0, -1);
  if (key === 'gap') {
    throw new SourceError(
      `${subject}: a node has no gap:, only a placement does — write it in the placement's bracket, ` +
        `such as \`right of a (gap: ${tokens[at + 1]?.text ?? 'wide'})\``,
      line,
    );
  }
  if (key === 'contents') {
    throw new SourceError(
      `${subject}: contents: is gone — a container's children are arranged with layout:, and its settings ` +
        'go in its bracket: `layout: column (widths: match, align: center)`',
      line,
    );
  }
  if (key === 'deck') {
    // The node's own text was the front card's, and the copies' texts went back to front.
    const name = subject.replace(/^node "|"$/g, '');
    const own = tokens.slice(0, at).find((token) => token.quoted);
    const cards = [quoteOf(own?.text ?? name)];
    for (let next = at + 1; tokens[next]?.quoted; next++) cards.push(quoteOf(tokens[next]!.text));
    throw new SourceError(
      `${subject}: deck: is gone — a deck is a container and its cards are its children, the front one first: ` +
        `\`node ${name} ""  layout: deck  cards: ${cards.join(' ')}\`; a card that holds things is written as a child, such as node ${name}.1`,
      line,
    );
  }
  if (key === 'heading') {
    // `heading: d1.head (inside top, align: left)` — the child, then where it
    // sits, in the words a title uses.
    const value = tokens[at + 1];
    if (!value || value.quoted || isAttrKey(value) || value.text === '(') {
      throw new SourceError(`${subject}: heading: names one of its own children, such as heading: ${subject.replace(/^node "|"$/g, '')}.head`, line);
    }
    setOnce(attrs, 'heading', value.text, subject, line);
    const taken = takeTitlePlace(tokens, at + 2, subject, line);
    const read = readBracket(taken.tokens, at + 2, ['align'], {
      subject,
      what: '`heading:`',
      kind: 'a heading',
      example: 'align: left',
      line,
    });
    if (taken.place !== undefined) setOnce(attrs, 'heading.place', taken.place, subject, line);
    if (read.values['align'] !== undefined) setOnce(attrs, 'heading.align', read.values['align'], subject, line);
    // Taking the place words out shortened the tokens; count from the original.
    const removed = tokens.length - taken.tokens.length;
    return read.next + removed;
  }
  if (key === 'depth') {
    // `depth: behind b`, `depth: in front of a, b and c`, or both, separated
    // by a comma: `depth: behind a, in front of a.api`. Stored as clauses
    // joined on `;`, which no name can hold.
    const clauses: string[] = [];
    let next = at + 1;
    for (;;) {
      let way: string;
      if (follows(tokens, next, 'behind')) {
        way = 'behind';
        next += 1;
      } else if (follows(tokens, next, 'in') && follows(tokens, next + 1, 'front') && follows(tokens, next + 2, 'of')) {
        way = 'in front of';
        next += 3;
      } else {
        const given = tokens[next];
        throw new SourceError(
          `${subject}: depth: says what this is drawn behind or in front of — \`depth: behind b\` or \`depth: in front of b\`` +
            (given && !isAttrKey(given) ? `, not "${given.text}"` : ''),
          line,
        );
      }
      const names: string[] = [];
      let more = false;
      for (;;) {
        const token = tokens[next];
        if (!token || token.quoted || isAttrKey(token) || token.text === '(' || token.text === ')') {
          throw new SourceError(`${subject}: "depth: ${way}" names nothing${names.length > 0 ? ' after its comma' : ''}`, line);
        }
        const listed = token.text.endsWith(',') && token.text.length > 1;
        names.push(listed ? token.text.slice(0, -1) : token.text);
        next += 1;
        if (follows(tokens, next, 'and')) {
          next += 1;
          continue;
        }
        if (!listed) break;
        // A comma before `behind` or `in front of` starts the next clause.
        if (follows(tokens, next, 'behind') || (follows(tokens, next, 'in') && follows(tokens, next + 1, 'front'))) {
          more = true;
          break;
        }
      }
      clauses.push(`${way} ${names.join(', ')}`);
      if (!more) break;
    }
    setOnce(attrs, 'depth', clauses.join('; '), subject, line, { key, value: (v) => v.split('; ').join(', ') });
    return next;
  }
  if (key === 'via') {
    // Stored as JSON, which `parseEdge` takes back out: a `via:` list belongs
    // to one line, never to a style.
    if (!subject.startsWith('edge ')) {
      throw new SourceError(`${subject}: via: says where one line goes, so it is written on the edge itself`, line);
    }
    const read = readVia(tokens, at + 1, subject, line);
    setOnce(attrs, 'via', JSON.stringify(read.entries), subject, line, { key, value: () => 'a list' });
    return read.next;
  }
  if (key === 'from' || key === 'to') {
    // `to: top`, `to: left 3/4 down`, `to: bottom 1/4 across from right`,
    // `to: top, right of z`, `from: bottom-center`, `from: center`. Stored as
    // written, one space between words; `lines.ts` reads it (design.org 6.2).
    const first = tokens[at + 1];
    if (!first || first.quoted || isAttrKey(first) || first.text === '(') {
      throw new SourceError(`${subject}: ${key}: names a side or a point, such as ${key}: top`, line);
    }
    const words = [first.text];
    let even: PlacementTarget[] | undefined;
    let next = at + 2;
    const side = first.text.replace(/,$/, '');
    const second = tokens[at + 2];
    const plain = (token: Token | undefined): boolean => token !== undefined && !token.quoted && !isAttrKey(token) && token.text !== '(';
    if ((WAYS as readonly string[]).includes(side) && second?.text === 'from' && plain(tokens[at + 3])) {
      // `to: down from z3`, `from: left from bin`: lined up with another thing (6.2).
      words.push('from', tokens[at + 3]!.text);
      next = at + 4;
    } else if (side === 'at' && plain(second)) {
      // `to: at 1/3`: how far along the line this end is on.
      words.push(second!.text);
      next = at + 3;
    } else if (!isSideWord(side) && second?.text === 'at' && plain(tokens[at + 3])) {
      // `to: climb at 1/3`: how far along a leg of that line.
      words.push('at', tokens[at + 3]!.text);
      next = at + 4;
    } else if (!isSideWord(side) && !isPosition(side) && (second?.text === 'start' || second?.text === 'end')) {
      // `from: req end`: where another line ends.
      words.push(second.text);
      next = at + 3;
    } else if (isSideWord(side)) {
      let listed = first.text.endsWith(',');
      let fractionWritten: string | undefined;
      if (!listed) {
        const fraction = readFraction(tokens, next);
        if (fraction) {
          words.push(fraction.fraction.written);
          next = fraction.next;
          listed = fraction.fraction.written.endsWith(',');
          fractionWritten = fraction.fraction.written.replace(/,$/, '');
        }
      }
      // An end's place along its side is said once: by a fraction, by its
      // place among the others, or by what it is even with.
      const twice = (one: string, other: string): never => {
        throw new SourceError(
          `${subject}: "${key}: ${side}, …" says where along the ${side} side twice — "${one}" and "${other}" each place the end; keep one`,
          line,
        );
      };
      if (listed && follows(tokens, next, 'even')) {
        // `to: left, even with cat1`: on that side, level with cat1's center,
        // or at its place across on a top or bottom side. The targets are
        // stored beside the words, and `parseEdge` takes them out.
        const written = `${key}: ${side}, even with`;
        if (!follows(tokens, next + 1, 'with')) {
          throw new SourceError(`${subject}: "${key}: ${side}, even" reads "${written} <thing>"`, line);
        }
        const targets: PlacementTarget[] = [];
        let i = next + 2;
        for (;;) {
          const token = tokens[i];
          if (!token || token.quoted || isAttrKey(token) || token.text === '(' || token.text === ')') {
            throw new SourceError(`${subject}: "${written}" names nothing — write \`${written} <thing>\``, line);
          }
          const read = readOneTarget(tokens, i, subject, line);
          targets.push(read.target);
          i = read.next;
          if (follows(tokens, i, 'and')) {
            i += 1;
            continue;
          }
          if (!read.listed) break;
          const after = tokens[i]?.text;
          if (after === 'above' || after === 'below' || ((after === 'left' || after === 'right') && follows(tokens, i + 1, 'of'))) {
            twice(`even with ${listTargets(targets)}`, `${after}${after === 'left' || after === 'right' ? ' of' : ''} ${tokens[i + (after === 'left' || after === 'right' ? 2 : 1)]?.text.replace(/,$/, '') ?? '…'}`);
          }
        }
        if (fractionWritten !== undefined) twice(fractionWritten, `even with ${listTargets(targets)}`);
        checkEvenTargets(targets, side === 'left' || side === 'right' ? 'y' : 'x', written, subject, line);
        words.push('even with', listTargets(targets));
        even = targets;
        next = i;
      } else if (listed) {
        // `top, right of z`: this end's place among the others on the side.
        const way = tokens[next]?.text;
        const two = way === 'left' || way === 'right';
        const name = tokens[next + (two ? 2 : 1)];
        if (way !== undefined && name && !name.quoted) {
          words.push(two ? `${way} ${tokens[next + 1]?.text ?? ''}` : way, name.text);
          next += two ? 3 : 2;
          if (name.text.endsWith(',') && follows(tokens, next, 'even')) {
            twice(`${words[words.length - 2]} ${name.text.slice(0, -1)}`, `even with ${tokens[next + 2]?.text ?? '…'}`);
          }
        }
      }
    }
    setOnce(attrs, key, words.join(' '), subject, line);
    if (even) attrs[`${key}.even`] = JSON.stringify(even);
    return next;
  }
  if ((EDGE_ORDER_KEYS as readonly string[]).includes(key)) {
    // `right-edge-order: ae, ad, ac`: names separated by commas, as a bundle's order: lists them.
    if (!subject.startsWith('node ')) {
      throw new SourceError(`${subject}: ${key}: names the lines on one box's side, so it is written on the node itself`, line);
    }
    const names: string[] = [];
    let next = at + 1;
    for (;;) {
      const item = tokens[next];
      if (!item || item.quoted || isAttrKey(item) || item.text === '(' || item.text === ',') {
        throw new SourceError(
          `${subject}: ${key}: lists the named lines on that side in order, such as ${key}: ae, ad, ac${names.length > 0 ? ' — the comma at the end promises another' : ''}`,
          line,
        );
      }
      const listed = item.text.endsWith(',');
      names.push(listed ? item.text.slice(0, -1) : item.text);
      next += 1;
      if (!listed && follows(tokens, next, ',')) {
        next += 1;
        continue;
      }
      if (!listed) break;
    }
    setOnce(attrs, key, names.join(', '), subject, line);
    return next;
  }
  if (key === 'join-with') {
    // `join-with: hub text` or `join-with: hub.icon` — what the node moves with.
    const value = tokens[at + 1];
    const own = subject.replace(/^node "|"$/g, '');
    const parent = own.includes('.') ? own.slice(0, own.lastIndexOf('.')) : 'hub';
    if (!value || value.quoted || isAttrKey(value) || value.text === '(') {
      throw new SourceError(
        `${subject}: join-with: names what it moves with — its container's text, such as join-with: ${parent} text, or a sibling`,
        line,
      );
    }
    const part = tokens[at + 2];
    if (part && !part.quoted && part.text === 'text') {
      setOnce(attrs, 'join-with', `${value.text} text`, subject, line);
      return at + 3;
    }
    setOnce(attrs, 'join-with', value.text, subject, line);
    return at + 2;
  }
  if (key === 'layout') {
    // `layout: column (gap: 0, widths: match)` — a value, then its settings.
    // `centers: 5 apart` reads its last word as part of the value.
    const value = tokens[at + 1];
    if (!value || value.quoted || isAttrKey(value) || value.text === '(') {
      throw new SourceError(`${subject}: layout: names an arrangement — column, row, venn or deck`, line);
    }
    setOnce(attrs, 'layout', value.text, subject, line);
    let next = at + 2;
    if (follows(tokens, next, '(')) {
      const inner = tokens.slice(next);
      const apart = inner.findIndex((token, index) => index > 1 && token.text.replace(/,$/, '') === 'apart' && inner[index - 2]?.text === 'centers:');
      if (apart !== -1) {
        if (inner[apart]!.text.endsWith(',')) inner[apart - 1] = { ...inner[apart - 1]!, text: `${inner[apart - 1]!.text},` };
        inner.splice(apart, 1);
      }
      const read = readBracket(inner, 0, LAYOUT_KEYS, {
        subject,
        what: '`layout:`',
        kind: 'a layout',
        example: 'gap: tight',
        line,
      });
      for (const [inside, set] of Object.entries(read.values)) setOnce(attrs, `layout.${inside}`, set, subject, line);
      next += read.next + (apart !== -1 && apart < read.next ? 1 : 0);
    }
    return next;
  }
  if (key === 'shape' && follows(tokens, at + 2, '(')) {
    // `shape: cylinder (cap: 1.5, lying)` — a value, then its settings. Which
    // settings the shape takes is checked once its shape is known, since a
    // style may carry the shape and a node the bracket's other half.
    const value = tokens[at + 1]!;
    if (value.quoted || isAttrKey(value)) {
      throw new SourceError(`${subject}: shape: names an outline, such as diamond, before its settings`, line);
    }
    setOnce(attrs, 'shape', value.text, subject, line);
    // A flag stands alone, `lying`; read it as `lying: true`.
    const inner: Token[] = [];
    let depth = 0;
    let end = at + 2;
    for (; end < tokens.length; end++) {
      const token = tokens[end]!;
      if (!token.quoted && token.text === '(') depth += 1;
      if (!token.quoted && token.text === ')') depth -= 1;
      const bare = token.text.replace(/,$/, '');
      if (depth === 1 && !token.quoted && SHAPE_FLAGS.includes(bare) && !isAttrKey(tokens[end - 1]!)) {
        inner.push({ ...token, text: `${bare}:` }, { ...token, text: token.text.endsWith(',') ? 'true,' : 'true' });
      } else {
        inner.push(token);
      }
      if (depth === 0) break;
    }
    const takes = Object.keys(SHAPE_SETTINGS[value.text] ?? {});
    if (takes.length === 0) {
      throw new SourceError(`${subject}: \`shape: ${value.text}\` takes no settings, so it has no bracket`, line);
    }
    const read = readBracket(inner, 0, takes, {
      subject,
      what: `\`shape: ${value.text}\``,
      kind: `a ${value.text}`,
      example: `${takes[0]}: …`,
      line,
    });
    if (Object.keys(read.values).length === 0) {
      throw new SourceError(`${subject}: \`shape: ${value.text}\` opens empty brackets`, line);
    }
    for (const [inside, set] of Object.entries(read.values)) setOnce(attrs, `shape.${inside}`, set, subject, line);
    return end + 1;
  }
  const bracketKeys = BRACKET_KEYS[key];
  if (bracketKeys !== undefined && follows(tokens, at + 1, '(')) {
    // `text: (color: theme-muted)` — the whole bracket belongs to one part, and it is
    // stored under dotted keys so that a style merges into a node exactly the
    // way every other attribute does.
    const read = readBracket(tokens, at + 1, bracketKeys, {
      subject,
      what: `\`${key}:\``,
      kind: BRACKET_ABOUT[key]!.kind,
      example: BRACKET_ABOUT[key]!.example,
      line,
      ...(key === 'text' ? { listed: TEXT_KEYS.filter((word) => word !== 'at') } : {}),
    });
    if (Object.keys(read.values).length === 0) {
      throw new SourceError(`${subject}: \`${key}:\` opens empty brackets`, line);
    }
    // Two brackets for one part are fine as long as they say different things;
    // the same property in both is the same defect as `fill:` written twice.
    for (const [inner, value] of Object.entries(read.values)) {
      // A line's color is stored where `line: red` puts it, so the short form
      // and the bracket are one key: a style's `line: red` merges under an
      // edge's `line: (color: blue)`, and writing both on one line is a repeat.
      // A border's color the same.
      const stored = (key === 'line' || key === 'border') && inner === 'color' ? key : `${key}.${inner}`;
      setOnce(attrs, stored, value, subject, line, { key: `${key}: (${inner}: …)`, value: (v) => v });
    }
    return read.next;
  }
  if (key === 'url') {
    // Several links are several addresses after the one key, as `cards:` lists
    // its cards, each named in a bracket after it. The first stays under `url`,
    // so whatever follows one link follows the first of several; the whole
    // list is kept beside it only when there is more than a bare address.
    const read = readLinks(tokens, at + 1, subject, line);
    setOnce(attrs, key, read.links[0]!.href, subject, line, { key, value: quoteOf });
    if (read.links.length > 1 || read.links.some((link) => link.name !== undefined || link.icon !== undefined)) {
      attrs[LINKS_KEY] = JSON.stringify(read.links);
    }
    return read.next;
  }
  if (key === 'title') {
    // A title is a text, and every text is quoted. Unquoted, its first word
    // would be the title and the rest read as stray words.
    const value = tokens[at + 1];
    if (!value || !value.quoted) {
      throw new SourceError(`${subject}: a title is written in quotes — \`title: "How a login reaches the database"\``, line);
    }
    setOnce(attrs, key, value.text, subject, line, { key, value: quoteOf });
    return at + 2;
  }
  if (key === 'style') {
    // `style: base, critical and alarm` — several bundles, applied in the order
    // written, a later one winning where two set the same key. The list reads
    // the way a placement's targets do: commas and `and` both separate. Stored
    // joined on a space, which no style name can hold.
    const names: string[] = [];
    let next = at + 1;
    for (;;) {
      const token = tokens[next];
      if (!token || token.quoted || isAttrKey(token) || token.text === '(' || token.text === ')') {
        throw new SourceError(
          names.length === 0 ? `attribute "style" has no value` : `${subject}: "style:" ends its list with a comma`,
          line,
        );
      }
      const listed = token.text.endsWith(',') && token.text.length > 1;
      const name = listed ? token.text.slice(0, -1) : token.text;
      if (names.includes(name)) {
        throw new SourceError(`${subject}: style "${name}" is named twice in one \`style:\` — keep one`, line);
      }
      names.push(name);
      next += 1;
      if (follows(tokens, next, 'and')) {
        next += 1;
        continue;
      }
      if (listed) continue;
      break;
    }
    setOnce(attrs, key, names.join(' '), subject, line, { key, value: (v) => v.split(' ').join(', ') });
    return next;
  }
  if (key === 'cards') {
    // One quoted text per card of a deck, front first, as many as are
    // written. Stored joined on a line break, which no source line can hold.
    const texts: string[] = [];
    let next = at + 1;
    while (tokens[next]?.quoted) texts.push(tokens[next++]!.text);
    if (texts.length === 0) {
      const given = tokens[next];
      throw new SourceError(
        `${subject}: \`cards:\` takes one quoted text per card, front first, as in \`cards: "Drive 1" "Drive 2" "Drive 3"\`` +
          (given && !isAttrKey(given) ? `, not \`cards: ${given.text}\`` : ''),
        line,
      );
    }
    setOnce(attrs, key, texts.join('\n'), subject, line, {
      key,
      value: (v) => v.split('\n').map(quoteOf).join(' '),
    });
    return next;
  }
  if (bracketKeys !== undefined && key !== 'text' && key !== 'line' && key !== 'border') {
    // `contents: match` names the part and then says one of its two properties
    // without saying which. The brackets are what make the level shift visible,
    // so there is no unbracketed spelling to fall back to.
    const given = tokens[at + 1];
    throw new SourceError(
      `${subject}: \`${key}:\` takes its properties in brackets — write \`${key}: (${BRACKET_ABOUT[key]!.example})\`` +
        (given && !isAttrKey(given) ? `, not \`${key}: ${given.text}\`` : ''),
      line,
    );
  }
  if (SIZE_KEYS[key] !== undefined) {
    // `height: 0.5 group height`: read and checked here, stored spaced out for
    // the placing pass to work out. It ends where a placement or a key starts.
    const read = readSize(tokens, at + 1, key, subject, line, startsPlacement);
    setOnce(attrs, key, writeSize(read.size), subject, line);
    return read.next;
  }
  const valueToken = tokens[at + 1];
  if (!valueToken || isAttrKey(valueToken) || valueToken.text === ')') {
    throw new SourceError(`attribute "${key}" has no value`, line);
  }
  if (key === 'stroke') {
    // Removed 2026-09-09. It meant a different part on every kind — the
    // border of a box, the text of a note or a glyph body, the line of a
    // edge — so it could never be wrong, and a node's text had no word at all.
    // Refused by name rather than ignored: an older file must be told what
    // to write, not silently drawn without its colors.
    throw new SourceError(
      '`stroke:` has been replaced by the part it colors — `border:` on a node, `text: (color: …)` on the text of anything, `line:` on an edge. A style shared between nodes and edges writes both, as in `border: #d2904e  line: #d2904e`',
      line,
    );
  }
  if (key === 'subtext') {
    // Removed in 0.3.0. It colored "every line after the first", which is a
    // positional slice: the rule lived in a style elsewhere in the file and was
    // applied by counting, so a reader of the text could not see it. Markup
    // says what is quiet where it is quiet, and reaches a word in the middle of
    // a line, which the slice never could.
    throw new SourceError(
      '`subtext:` has been replaced by markup in the text — write `style dim  text: (color: theme-muted)` ' +
        'and mark the quiet words as `"Dropbox / [dim]synced[/dim]"`',
      line,
    );
  }
  if (key === 'text') {
    // `text:` is the text's bracket now, so a bare word after it is either the
    // old color key or an attempt to set the words themselves. The quotes tell
    // the two apart, and they want different remedies.
    throw new SourceError(
      valueToken.quoted
        ? `\`text:\` is how a style says something about text, not how anything sets it — write the words in quotes after the name, as in \`node name ${quoteOf(valueToken.text)}\``
        : `\`text:\` takes the text's properties in brackets — write \`text: (color: ${valueToken.text})\` in a style, and \`(color: ${valueToken.text})\` in the brackets after a node's or an edge's own text`,
      line,
    );
  }
  if (key === 'line' && !valueToken.quoted) {
    // `line: red` is the short form of the color, and the only one: every other
    // property of the line needs the bracket to say which it is.
    const property = linePropertyOf(valueToken.text) ?? (/^\d/.test(valueToken.text) ? 'thickness' : undefined);
    if (property !== undefined) {
      throw new SourceError(
        `\`line: ${valueToken.text}\` — \`line:\` on its own takes a color. The line's other properties go in its bracket: ` +
          `\`line: (${property}: ${valueToken.text})\``,
        line,
      );
    }
  }
  if (key === 'border' && !valueToken.quoted && /^(thin|normal|thick|\d*\.?\d+(px)?)$/.test(valueToken.text)) {
    // `border: red` is the short form of the color, as `line: red` is.
    throw new SourceError(
      `\`border: ${valueToken.text}\` — \`border:\` on its own takes a color. Its thickness goes in its bracket: ` +
        `\`border: (thickness: ${valueToken.text})\``,
      line,
    );
  }
  if (key === 'align' && valueToken.text === 'widths') {
    // Removed in 0.3.0. It was a size operation wearing an alignment's name,
    // and its value set had one member — a flag in a property's clothes. Its
    // job is a layout's `(widths: match)`, and with it gone `align` means one
    // thing everywhere.
    throw new SourceError(
      '`align: widths` is now `layout: column (widths: match)` — it is a size, not an alignment, and ' +
        'gather-children: center says where the children sit when the title is wider',
      line,
    );
  }
  if ((MOVED_INTO_BRACKET as readonly string[]).includes(key)) {
    throw new SourceError(
      `\`${key}:\` belongs to the text rather than to the node — write it in the brackets after ` +
        `the text, as in \`"…" (${key}: ${valueToken.text})\`, or as \`text: (${key}: ${valueToken.text})\` in a style`,
      line,
    );
  }
  if (valueToken.quoted && (COLOR_KEYS as readonly string[]).includes(key)) {
    // A quoted value is the author saying "this is text", and every one of
    // these keys takes a color. Without this the string is passed through as
    // a color, turns out not to be one, and nothing is drawn and nothing is
    // said.
    if (valueToken.text.startsWith('#')) {
      // A hex color that was merely quoted. The author wrote a color and the
      // remedy is punctuation, so say that rather than that it is not one.
      throw new SourceError(
        `a color is written without quotes — "${key}: ${valueToken.text}"`,
        line,
      );
    }
    throw new SourceError(
      `"${key}" takes a color and a quoted value is text — drop the quotes if ${valueToken.text} is a color`,
      line,
    );
  }
  if ((COLOR_KEYS as readonly string[]).includes(key)) checkColorWord(valueToken.text, subject, line);
  setOnce(attrs, key, valueToken.text, subject, line);
  return at + 2;
}

/** Attributes only, for the statements that take no placements. */
function attrsOnly(tokens: Token[], start: number, line: number, subject: string): Attrs {
  const attrs: Attrs = {};
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (!isAttrKey(token)) {
      throw new SourceError(
        `${subject}: expected an attribute like "key: value", found "${token.text}"`,
        line,
      );
    }
    i = readAttr(tokens, i, attrs, line, subject);
  }
  return attrs;
}

/**
 * How a text on a line looks, which is a node text's keys less the two that
 * place it in a box, and the patch behind it, in a box's words: its `fill:`
 * and the `padding:` it leaves round the text (design.org 7.3).
 */
const EDGE_TEXT_LOOK = [...TEXT_KEYS.filter((key) => key !== 'at' && key !== 'align'), 'fill', 'padding'];
/** Where a text on a line sits (design.org 7.3). */
const EDGE_TEXT_PLACE = ['at', 'on', 'gap', 'edge-gap', 'reads'] as const;
const EDGE_TEXT_KEYS = [...EDGE_TEXT_LOOK, ...EDGE_TEXT_PLACE];

/**
 * The bracket after one text on a line: `(at: start, above edge, gap: tight)`,
 * `(on: rise, straight right from c)`, `(above s1, left of edge)`. Keys say how
 * it looks and where along the line it sits; the relations say where it sits
 * by a box, or beside its line. Everything is checked here that the words
 * alone can settle; what needs the drawn line is checked when it is drawn.
 */
function readEdgeTextBracket(
  tokens: Token[],
  start: number,
  subject: string,
  text: string,
  line: number,
): { attrs: Attrs; place: EdgeTextPlace; next: number } {
  const attrs: Attrs = {};
  const place: EdgeTextPlace = {};
  if (!follows(tokens, start, '(')) return { attrs, place, next: start };
  const about = `${subject}: the text "${text}"`;
  const plain = (token: Token | undefined): string | undefined =>
    token && !token.quoted ? token.text.replace(/(.),$/, '$1') : undefined;
  const seen = new Set<string>();
  // What each key in the bracket was given, so a repeat can name both values.
  const given = new Map<string, string>();
  let atWritten = '';
  const once = (what: string, written: string): void => {
    if (seen.has(what)) throw new SourceError(`${about} says ${written === what ? what : `${what} (${written})`} twice — keep one`, line);
    seen.add(what);
  };
  let i = start + 1;
  while (!follows(tokens, i, ')')) {
    const token = tokens[i];
    if (!token) throw new SourceError(`${about} opens a "(" and never closes it`, line);
    if (token.quoted) throw new SourceError(`${about} has a quoted "${token.text}" in its brackets — a second text goes after the ")"`, line);
    if (isAttrKey(token)) {
      const key = token.text.slice(0, -1);
      if (key === 'align') {
        throw new SourceError(
          `${about}: a text on a line has no align: — it is placed along the line with at: or on:, ` +
            'by a box with a relation such as `above s1`, and beside the line with `right of edge` and the rest',
          line,
        );
      }
      if (!(EDGE_TEXT_KEYS as readonly string[]).includes(key)) {
        throw new SourceError(`a text on a line has no "${key}" — it takes ${EDGE_TEXT_KEYS.join(', ')}, and relations such as \`above s1\` or \`right of edge\``, line);
      }
      const value = plain(tokens[i + 1]);
      if (value === undefined || isAttrKey(tokens[i + 1]!) || value === ')') {
        throw new SourceError(`${about}: "${key}" has no value`, line);
      }
      if (key === 'gap' && place.gap !== undefined && !given.has('gap')) {
        throw new SourceError(`${about} says its distance from the box twice (${place.gap} in front, gap: ${value}) — keep one`, line);
      }
      const before = given.get(key);
      if (before !== undefined) throw new SourceError(`${about} says ${key} twice (${key}: ${before}, ${key}: ${value}) — keep one`, line);
      given.set(key, value);
      once(key, key);
      i += 2;
      if (key === 'color' || key === 'fill') checkColorWord(value, subject, line);
      if (key === 'at') {
        const fraction = /^(\d+)\/(\d+)$/.exec(value);
        const at =
          value === 'start' || value === 'end'
            ? value
            : fraction
              ? Number(fraction[1]) / Number(fraction[2])
              : /^\d*\.?\d+$/.test(value)
                ? Number(value)
                : NaN;
        if (typeof at === 'number' && !(at >= 0 && at <= 1)) {
          throw new SourceError(`${about}: "at: ${value}" — at: takes a fraction along the line, such as 1/4 or 0.25, or start or end`, line);
        }
        place.at = at;
        atWritten = value;
      } else if (key === 'on' && value === 'longest') {
        if (plain(tokens[i]) !== 'level') {
          throw new SourceError(`${about}: "on: longest" — the longest piece a text can sit on is the longest level one: \`on: longest level\``, line);
        }
        place.longestLevel = true;
        i += 1;
      } else if (key === 'on') {
        place.on = value;
      } else if (key === 'gap') {
        place.gap = value;
      } else if (key === 'edge-gap') {
        place.edgeGap = value;
      } else if (key === 'reads') {
        if (value !== 'up' && value !== 'down' && value !== 'along') {
          throw new SourceError(`${about}: "reads: ${value}" — a text reads up, down or along`, line);
        }
        place.reads = value;
      } else {
        attrs[key] = value;
      }
      continue;
    }
    const word = plain(token)!;
    const from = i;
    if (word === 'even' || ((isSideWord(word) || isAxisWord(word)) && plain(tokens[i + 1]) === 'even')) {
      // `left even with x right`: one axis from a box, the other from the line.
      // A comma ends it, as it ends every item in the bracket, so read only up to one.
      let end = i;
      while (end < tokens.length && plain(tokens[end]) !== ')' && !(tokens[end]!.text.endsWith(',') && !tokens[end]!.quoted)) end += 1;
      const comma = end < tokens.length && plain(tokens[end]) !== ')';
      const item = tokens.slice(i, end + (comma ? 1 : 0)).map((t, k, all) => (comma && k === all.length - 1 ? { ...t, text: t.text.slice(0, -1) } : t));
      const read = readPlacement(item, 0, line, subject);
      const placement = read.placement as AlignPlacement;
      const written = item.slice(0, read.next).map((t) => t.text).join(' ');
      if (read.next < item.length) {
        const after = item[read.next]!.text;
        if (AXIS_ADVERBS.has(after)) throw new SourceError(`${about}: ${axisAdverb(after, listTargets((read.placement as AlignPlacement).targets))}`, line);
        throw new SourceError(`${about}: "${written}" is followed by "${after}" — put a comma between them`, line);
      }
      once(placement.axis === 'x' ? 'where it sits across' : 'how high it sits', written);
      (place.even ??= []).push({ placement, written });
      i += item.length;
      continue;
    }
    if (word === 'on' && plain(tokens[i + 1]) === 'the' && plain(tokens[i + 2]) === 'line') {
      // `above s1, on the line`: the text stays on its line, where it passes above s1.
      once('on the line', 'on the line');
      place.onLine = true;
      i += 3;
      continue;
    }
    // `2 above s1`: the distance from the box, written in front as a box writes it.
    const distance = /^\d*\.?\d+$/.test(word) && /^(above|below|left|right)$/.test(plain(tokens[i + 1]) ?? '') ? word : undefined;
    if (distance !== undefined) {
      if (place.gap !== undefined) throw new SourceError(`${about} says its distance from the box twice (gap: ${place.gap}, ${distance} in front) — keep one`, line);
      place.gap = distance;
      seen.add('gap');
      i += 1;
    }
    const said = distance === undefined ? word : plain(tokens[i])!;
    let relation: 'straight' | TextSide;
    if (said === 'straight') {
      const way = plain(tokens[i + 1]);
      if (!(WAYS as readonly string[]).includes(way ?? '') || plain(tokens[i + 2]) !== 'from') {
        throw new SourceError(`${about}: "straight" is followed by a way and the box it starts from, such as \`straight right from c\``, line);
      }
      relation = 'straight';
      i += 3;
    } else if (said === 'above' || said === 'below') {
      relation = said;
      i += 1;
    } else if ((said === 'left' || said === 'right') && plain(tokens[i + 1]) === 'of') {
      relation = `${said} of`;
      i += 2;
    } else {
      throw new SourceError(
        `${about}: "${word}" in its brackets is not something a text on a line takes — it takes ` +
          `${EDGE_TEXT_KEYS.join(':, ')}:, relations such as \`2 above s1\`, \`straight right from c\` or \`right of edge\`, \`x even with s1\`, and \`on the line\``,
        line,
      );
    }
    const besideIt = relation !== 'straight' && plain(tokens[i]) === 'edge';
    if (besideIt && distance !== undefined) {
      throw new SourceError(`${about}: "${distance} ${relation} edge" — the distance off the line is written \`edge-gap: ${distance}\``, line);
    }
    if (besideIt) {
      once('a side of the line', `${relation} edge`);
      place.beside = relation as TextSide;
      i += 1;
    } else {
      if (!tokens[i] || plain(tokens[i]) === ')' || isAttrKey(tokens[i]!)) {
        throw new SourceError(`${about}: "${tokens.slice(from, i).map((t) => t.text).join(' ')}" names nothing — name a box, or \`edge\` for the line itself`, line);
      }
      const read = readOneTarget(tokens, i, subject, line);
      const written = tokens.slice(from, read.next).map((t) => t.text).join(' ').replace(/,$/, '');
      if (place.straight || place.by) {
        throw new SourceError(`${about} is placed by a box twice (${place.straight?.written ?? place.by!.written}, ${written}) — keep one`, line);
      }
      if (relation === 'straight') {
        place.straight = { way: plain(tokens[from + 1]) as Way, target: read.target, written };
      } else {
        place.by = { side: relation, target: read.target, written };
      }
      i = read.next;
    }
    if (follows(tokens, i, '(')) {
      const said = tokens.slice(from, i).map((t) => t.text).join(' ');
      throw new SourceError(
        besideIt
          ? `${about}: "${said} (…)" — the distance off the line is written in the text's own bracket, \`edge-gap: tight\``
          : relation === 'straight'
            ? `${about}: "${said} (…)" — a text placed straight from a box sits where the way across meets the line, so it takes no distance`
            : `${about}: "${said} (…)" — the distance from the box is written in the text's own bracket, \`gap: tight\``,
        line,
      );
    }
  }
  if (place.at !== undefined && (place.straight || place.by)) {
    throw new SourceError(
      `${about}: "at: ${atWritten}" and "${(place.straight ?? place.by)!.written}" both say where along the line it sits — keep one`,
      line,
    );
  }
  if (place.onLine && !place.by) {
    throw new SourceError(
      `${about}: "on the line" keeps a text placed by a box on its line, as in \`above s1, on the line\`, and nothing here places it by a box` +
        (place.straight ? ` — "${place.straight.written}" is on the line already` : ''),
      line,
    );
  }
  if (place.by && !place.onLine && place.beside) {
    throw new SourceError(
      `${about}: "${place.beside} edge" moves a text off its line, and "${place.by.written}" puts it by the box, off the line already — ` +
        `keep one, or write \`${place.by.written}, on the line, ${place.beside} edge\` to start from the line`,
      line,
    );
  }
  if (place.gap !== undefined && place.at !== 'start' && place.at !== 'end' && !place.by) {
    throw new SourceError(
      `${about}: gap: is the distance from a box, which only \`at: start\`, \`at: end\` and a box relation such as \`above s1\` have` +
        (place.beside ? ' — the distance off the line is edge-gap:' : ''),
      line,
    );
  }
  for (const { placement, written } of place.even ?? []) {
    // A relation already says where the text sits on its own axis.
    const axisOf = (side: TextSide): Axis => (side === 'above' || side === 'below' ? 'y' : 'x');
    const other = [
      ...(place.by ? [{ axis: axisOf(place.by.side), said: place.by.written }] : []),
      ...(place.beside ? [{ axis: axisOf(place.beside), said: `${place.beside} edge` }] : []),
      ...(place.straight ? [{ axis: (place.straight.way === 'up' || place.straight.way === 'down' ? 'x' : 'y') as Axis, said: place.straight.written }] : []),
    ].find((each) => each.axis === placement.axis);
    if (other) {
      throw new SourceError(`${about}: "${written}" and "${other.said}" both say where it sits ${placement.axis === 'x' ? 'across' : 'up and down'} — keep one`, line);
    }
  }
  if (place.edgeGap !== undefined && !place.beside) {
    throw new SourceError(`${about}: edge-gap: is the distance off the line for a text beside it, and it says no side — add \`right of edge\` or another`, line);
  }
  return { attrs, place, next: i + 1 };
}

/**
 * `text:` is how a *style* says something about the text of whatever wears it,
 * because a style has no string of its own. A node and an edge do, so they say
 * it in the brackets after that string, and there is one spelling per place.
 */
function refuseTextKey(attrs: Attrs, subject: string, where: string, line: number): void {
  for (const key of Object.keys(attrs)) {
    if (!key.startsWith('text.')) continue;
    const inner = key.slice('text.'.length);
    throw new SourceError(
      `${subject}: \`text: (…)\` is how a style says it, having no text of its own. This has one, ` +
        `so write \`(${inner}: ${attrs[key]})\` in the brackets ${where}`,
      line,
    );
  }
}

/**
 * `(inside top, align: left)`, `(on top)`, `(outside bottom)`, `(center)`:
 * where a title or a heading sits, written first in a bracket. They are
 * placements, so they take no colon. Returns the tokens with those words taken
 * out, leaving the bracket's keyed settings for `readBracket`.
 */
function takeTitlePlace(
  tokens: Token[],
  open: number,
  subject: string,
  line: number,
): { tokens: Token[]; place?: string; placements: Placement[] } {
  if (!follows(tokens, open, '(')) return { tokens, placements: [] };
  const first = tokens[open + 1];
  const word = first && !first.quoted ? first.text.replace(/,$/, '') : undefined;
  if (word === 'center') {
    return { ...takeTitlePlacements([...tokens.slice(0, open + 1), ...tokens.slice(open + 2)], open, subject, line), place: 'center' };
  }
  if (word === 'inside' || word === 'on' || word === 'outside') {
    const side = tokens[open + 2]?.text.replace(/,$/, '');
    if (!side || !['top', 'bottom', 'left', 'right'].includes(side)) {
      throw new SourceError(`${subject}: a title sits ${word} a side — top, bottom, left or right`, line);
    }
    return {
      ...takeTitlePlacements([...tokens.slice(0, open + 1), ...tokens.slice(open + 3)], open, subject, line),
      place: `${word} ${side}`,
    };
  }
  return takeTitlePlacements(tokens, open, subject, line);
}

/**
 * The placements in a title's bracket, against the box's own children:
 * `(right even with ranged.d, top even with ranged.a)` (design.org 7.2). Each
 * comma-separated item that opens a placement is read as one and taken out;
 * the rest stay for the bracket's keys.
 */
function takeTitlePlacements(tokens: Token[], open: number, subject: string, line: number): { tokens: Token[]; placements: Placement[] } {
  let close = open + 1;
  let depth = 0;
  for (; close < tokens.length; close += 1) {
    const text = tokens[close]!.quoted ? '' : tokens[close]!.text;
    if (text === '(') depth += 1;
    if (text === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  const inner = tokens.slice(open + 1, close);
  const items: Token[][] = [];
  let item: Token[] = [];
  for (const token of inner) {
    const comma = !token.quoted && token.text.endsWith(',') && token.text.length > 1;
    item.push(comma ? { ...token, text: token.text.slice(0, -1) } : token);
    if (comma || (!token.quoted && token.text === ',')) {
      if (!token.quoted && token.text === ',') item.pop();
      items.push(item);
      item = [];
    }
  }
  if (item.length > 0) items.push(item);

  const placements: Placement[] = [];
  const kept: Token[][] = [];
  for (const each of items) {
    const head = each[0];
    if (head && !isAttrKey(head) && startsPlacement(head, each[1])) {
      for (let at = 0; at < each.length; ) {
        const read = readPlacement(each, at, line, subject);
        placements.push(read.placement);
        at = read.next;
      }
    } else {
      kept.push(each);
    }
  }
  if (placements.length === 0) return { tokens, placements };
  const rejoined = kept.flatMap((each, index) =>
    index < kept.length - 1 && each.length > 0
      ? [...each.slice(0, -1), { ...each[each.length - 1]!, text: `${each[each.length - 1]!.text},` }]
      : each,
  );
  return { tokens: [...tokens.slice(0, open + 1), ...rejoined, ...tokens.slice(close)], placements };
}

/**
 * `node <name> ["<text>"] [(<text modifiers>)] [<placement> ...]`
 *
 * The text is optional and the name stands in for it, because a bare `node a`
 * asking for an empty rectangle is a default nobody wants: the first lines
 * anybody types are `node a` and `node b right of a`, and they mean the two
 * boxes to say "a" and "b". `""` is how a box says it is deliberately blank —
 * an invisible container, a glyph body, a node that is nothing but its icon —
 * and every such box already writes it, so nothing that predates this changed
 * meaning. The syntax being added was a parse error before, which is what
 * makes it purely additive.
 *
 * A dotted name shows its last segment only. Containment is already drawn, so
 * `server.docker` reading "docker" says everything the whole path would.
 *
 * A name now has two jobs, so renaming a node can change the picture. That is
 * the price, and it is honest: a file that states no text is saying the name
 * is the text.
 */
function parseNode(head: Token[], line: number): NodeStmt {
  const name = requireName(head[1], 'node', line);
  const written = head[2];
  const textToken = written?.quoted ? written : undefined;
  // A bare word here is a text somebody forgot to quote far more often than
  // it is anything else, and `"Parser" is not a direction` would send them
  // looking in the wrong place.
  if (written && !textToken && !isAttrKey(written) && !startsPlacement(written, head[3]) && written.text !== '(') {
    throw new SourceError(
      `node "${name}": a text is quoted — write "${written.text}" rather than ${written.text}`,
      line,
    );
  }
  const text = textToken ? textToken.text : name.slice(name.lastIndexOf('.') + 1);
  const subject = `node "${name}"`;
  const open = textToken ? 3 : 2;
  const taken = takeTitlePlace(head, open, subject, line);
  head = taken.tokens;
  const place = taken.place;
  const titlePlacements = taken.placements;
  const bracket = readBracket(head, open, NODE_TEXT_KEYS, {
    subject,
    what: 'the text',
    kind: 'a text',
    example: 'size: small',
    line,
    listed: NODE_TEXT_LISTED,
  });
  refuseNodeReads(bracket.values['reads'], subject, line);
  const limits: Limit[] = [];
  const tail = parseTail(head, bracket.next, line, subject, (tokens, index) => {
    const word = tokens[index]!;
    if (word.quoted || word.text !== 'stays') return undefined;
    const read = readLimit(tokens, index, line, subject);
    limits.push(read.limit);
    return read.next;
  });
  refuseTextKey(tail.attrs, subject, 'after the name', line);
  return {
    kind: 'node',
    name,
    text,
    statedText: textToken !== undefined,
    textAttrs: place === undefined ? bracket.values : { ...bracket.values, place },
    ...(titlePlacements.length > 0 ? { titlePlacements } : {}),
    placements: tail.placements,
    ...(limits.length > 0 ? { limits } : {}),
    attrs: tail.attrs,
    line,
  };
}

/**
 * `stays above laptop.photos (gap: wide)`: a limit (design.org 5.6). The words
 * after `stays` are read as a placement would be, then held to one straight
 * way and one target, since a limit says which side of one thing to keep to.
 */
function readLimit(tokens: Token[], at: number, line: number, subject: string): { limit: Limit; next: number } {
  const way = tokens[at + 1];
  const straight = ['above', 'below', 'left', 'right'];
  if (!way || way.quoted || !straight.includes(way.text)) {
    const diagonal = way !== undefined && !way.quoted && isDirection(way.text);
    throw new SourceError(
      diagonal
        ? `${subject}: "stays ${way.text}" keeps to two sides at once — write one limit for each, such as \`stays above a  stays right of a\``
        : `${subject}: "stays" is followed by the way it keeps to — stays above, stays below, stays left of or stays right of`,
      line,
    );
  }
  const read = readPlacement(tokens, at + 1, line, subject, true);
  const placement = read.placement;
  if (placement.kind !== 'offset' || placement.own !== undefined || placement.gaps !== undefined) {
    throw new SourceError(`${subject}: "stays" names a way and one thing, such as \`stays above laptop.photos\``, line);
  }
  if (placement.targets.length !== 1) {
    throw new SourceError(
      `${subject}: "${describePlacement(placement)}" after "stays" names ${placement.targets.length} things — a limit keeps clear of one; write one for each`,
      line,
    );
  }
  return {
    limit: {
      way: way.text as Limit['way'],
      target: placement.targets[0]!,
      ...(placement.gap !== undefined ? { gap: placement.gap } : {}),
      line,
    },
    next: read.next,
  };
}

/**
 * A node's text takes the look keys and `reads:` (design.org 7.2). `at` is
 * read only to be refused with the side form, so it isn't listed as one it takes.
 */
const NODE_TEXT_KEYS = [...TEXT_KEYS, 'reads', 'fill'] as const;
const NODE_TEXT_LISTED = NODE_TEXT_KEYS.filter((key) => key !== 'at');

/** A node's text turns a quarter turn; `along` follows a line, and a box has none. */
function refuseNodeReads(reads: string | undefined, subject: string, line: number, whose = "a node's text"): void {
  if (reads === undefined || reads === 'up' || reads === 'down') return;
  throw new SourceError(
    reads === 'along'
      ? `${subject}: reads: along follows a line's angle, and ${whose} has no line — write reads: up or reads: down`
      : `${subject}: reads: ${reads} is not one of up, down`,
    line,
  );
}

/**
 * `point p "merge" (above-right, gap: 1)` or `region r "trust" (inside top)`:
 * the text after a point's or a region's name, and its bracket (design.org
 * 7.4). A point's text says which way from the dot, with no target, since it
 * has nothing else to sit beside; a region's takes a container title's side
 * words. Returns where the rest of the statement starts.
 */
function readMarkText(
  head: Token[],
  kind: 'point' | 'region',
  subject: string,
  line: number,
): { text?: MarkText; tokens: Token[]; next: number } {
  const written = head[2];
  if (!written?.quoted) return { tokens: head, next: 2 };
  let tokens = head;
  let place: string | undefined;
  if (kind === 'point') {
    if (follows(tokens, 3, '(')) {
      const first = tokens[4];
      const word = first && !first.quoted ? first.text.replace(/,$/, '') : undefined;
      if (word !== undefined && (POINT_TEXT_SIDES as readonly string[]).includes(word)) {
        const after = tokens[5]?.text;
        if ((word === 'left' || word === 'right') && after === 'of') {
          throw new SourceError(`${subject}: a point's text has nothing else to sit beside, so it's (${word}), not (${word} of …)`, line);
        }
        if (!first!.text.endsWith(',') && after !== undefined && after !== ')' && after !== ',' && !isAttrKey(tokens[5]!)) {
          throw new SourceError(
            `${subject}: a point's text has nothing else to sit beside, so it's (${word}) alone — found "${after}" after it`,
            line,
          );
        }
        place = word;
        tokens = [...tokens.slice(0, 4), ...tokens.slice(5)];
      } else if (word !== undefined && !isAttrKey(first!)) {
        throw new SourceError(
          `${subject}: a point's text sits ${POINT_TEXT_SIDES.slice(0, 4).join(', ')} or at a corner such as above-right, not "${word}"`,
          line,
        );
      }
    }
  } else {
    const taken = takeTitlePlace(tokens, 3, subject, line);
    if (taken.placements.length > 0) {
      throw new SourceError(`${subject}: a region's text is placed against a side of it, such as (outside top) — a region holds nothing to place it against`, line);
    }
    if (taken.place === 'center') {
      throw new SourceError(
        `${subject}: a region's text goes against a side, such as (inside top) — a region holds nothing, so its middle is whatever it covers`,
        line,
      );
    }
    tokens = taken.tokens;
    place = taken.place;
  }
  const bracket = readBracket(tokens, 3, MARK_TEXT_KEYS, {
    subject,
    what: 'the text',
    kind: `a ${kind}'s text`,
    example: kind === 'point' ? 'gap: 1' : 'align: left',
    line,
  });
  const values = bracket.values;
  refuseNodeReads(values['reads'], subject, line, `a ${kind}'s text`);
  const across = place === undefined || /top|bottom/.test(place);
  const words = kind === 'point' || across ? ['left', 'center', 'right'] : ['top', 'center', 'bottom'];
  if (values['align'] !== undefined && !words.includes(values['align'])) {
    throw new SourceError(
      kind === 'point'
        ? `${subject}: align: lines up a point's text's own lines, ${words.join(', ')} — not ${values['align']}`
        : `${subject}: a text on the ${place?.split(' ')[1] ?? 'top'} side takes align: ${words.join(', ')} — not ${values['align']}`,
      line,
    );
  }
  return {
    text: { text: written.text, textAttrs: place === undefined ? values : { ...values, place } },
    tokens,
    next: bracket.next,
  };
}

const NEEDS_ARROW = 'an edge needs a line between its endpoints: "->", "<-", "<->" or "--"';

/**
 * The arrow between an edge's two names: a mark, a shaft, a mark. The shaft is
 * `-` or `--`, and either mark may be left off, so `--` is a plain line and
 * `<->` an arrow at each end.
 *
 * A mark is a word or a glyph, bare or in `()` or `[]`, and it must touch the
 * dashes or be bracketed: `edge a -- dot b` would otherwise read like a line to
 * a node named `dot`. So a bracketed mark may stand apart, which is why the
 * arrow can span several tokens — `[dot] -- [arrow]` is three, and `(dot)` is
 * three on its own, since the lexer splits a bracket that opens a token.
 */
function readArrow(head: Token[], line: number): { text: string; marks: EdgeMarks; next: number } {
  let at = 2;
  const pieces: string[] = [];
  const bracketed = (): void => {
    const token = head[at];
    if (!token || token.quoted) return;
    if (token.text === '(' && head[at + 2]?.text === ')' && !head[at + 1]!.quoted) {
      pieces.push(`(${head[at + 1]!.text})`);
      at += 3;
    } else if (/^\[[^\]]*\]$/.test(token.text)) {
      pieces.push(token.text);
      at += 1;
    }
  };

  bracketed();
  const shaft = head[at];
  if (!shaft || shaft.quoted || !shaft.text.includes('-')) throw new SourceError(NEEDS_ARROW, line);
  pieces.push(shaft.text);
  at += 1;
  if (shaft.text.endsWith('-')) bracketed();

  const text = pieces.join('');
  const parts = /^([^-]*)(-+)([^-]*)$/.exec(text);
  if (!parts) {
    throw new SourceError(`"${text}" is not an arrow — the line is one run of dashes, with a mark at either end`, line);
  }
  if (parts[2]!.length > 2) {
    throw new SourceError(`"${text}" has ${parts[2]!.length} dashes — the line is "-" or "--"`, line);
  }
  const from = readMark(parts[1]!, 'from', text, line);
  const to = readMark(parts[3]!, 'to', text, line);
  return {
    text,
    marks: { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) },
    next: at,
  };
}

/** One end of an arrow, as written: a mark word or glyph, perhaps bracketed, or nothing. */
function readMark(written: string, end: 'from' | 'to', arrow: string, line: number): Mark | undefined {
  if (written === '') return undefined;
  const inner = /^\((.*)\)$/.exec(written)?.[1] ?? /^\[(.*)\]$/.exec(written)?.[1] ?? written;
  if ((MARKS as readonly string[]).includes(inner)) return inner as Mark;
  const glyph = MARK_GLYPHS[end][inner];
  if (glyph !== undefined) return glyph;

  const other = end === 'from' ? 'to' : 'from';
  const turned = MARK_GLYPHS[other][inner];
  if (turned !== undefined) {
    // A pointing glyph written at the end it points away from: `>--` or `--<`.
    const right = Object.entries(MARK_GLYPHS[end]).find(([, mark]) => mark === turned)![0];
    throw new SourceError(
      `"${arrow}": "${inner}" points the other way — at the ${end === 'from' ? 'left' : 'right'} end ` +
        `the ${turned} is "${right}", or write the word "${turned}"`,
      line,
    );
  }
  throw new SourceError(
    `"${arrow}": "${inner}" is not a mark. The marks are ${MARKS.join(', ')}, and the glyphs ` +
      `${Object.keys(MARK_GLYPHS.to).join(' ')} and ${Object.keys(MARK_GLYPHS.from).filter((g) => !(g in MARK_GLYPHS.to)).join(' ')}`,
    line,
  );
}

/**
 * `edge <from> <arrow> <to> ["<text>"] [between <a> and <b>]`. The arrow is
 * read by `readArrow`.
 *
 * `from` and `to` are the order the names are written in, never the arrow's
 * direction: `a <- b` is `a` then `b` with an arrow at `a`. With a mark at each
 * end many lines have no direction at all, and the written order is the one
 * every edge has — so `from:` names the first name's side on every edge.
 */
function parseEdge(head: Token[], line: number): EdgeStmt {
  // `edge each child of a -> b`: one line from each direct child of a (design.org 6.6).
  const each = eachChildAt(head);
  if (each.length > 0) {
    const kept = head.filter((_, index) => !each.some((at) => index >= at && index < at + 3));
    const stmt = parseEdge(kept, line);
    // Before the arrow, the first end; after it, the second.
    const sides = each.map((at) => (head.slice(1, at).some(looksLikeArrow) ? 'to' : 'from'));
    const subject = `edge ${sides.includes('from') ? 'each child of ' : ''}${stmt.from} ${stmt.arrow} ${sides.includes('to') ? 'each child of ' : ''}${stmt.to}`;
    if (stmt.several !== undefined) {
      throw new SourceError(`${subject}: "each child of" and a list of ends can't share a statement — write a statement for each`, line);
    }
    if (sides.length > 1) {
      throw new SourceError(
        `${subject}: "each child of" on both ends would pair the children of two containers, and nothing on the page says which goes with which — write the lines out`,
        line,
      );
    }
    if (stmt.name !== undefined) {
      throw new SourceError(`${subject}: a name belongs to one line, and "each child of" draws one line per child — leave the name off`, line);
    }
    return { ...stmt, each: sides[0]! };
  }
  // `edge a -> b, c, d`: one line to each name in the list, drawn as one group,
  // so the stretch they share leaving `a` is said rather than happened on (6.6).
  const lists = endLists(head, line);
  if (lists !== undefined) {
    const stmt = parseEdge(lists.head, line);
    const written = (names: string[]) => names.join(', ');
    const subject = `edge ${written(lists.from)} ${stmt.arrow} ${written(lists.to)}`;
    if (lists.from.length > 1 && lists.to.length > 1) {
      throw new SourceError(
        `${subject}: a list on both ends would pair the names on one side with those on the other, and nothing says which goes with which — list one end and write a statement for each name on the other`,
        line,
      );
    }
    const side = lists.from.length > 1 ? 'from' : 'to';
    const names = lists[side];
    const twice = names.find((name, index) => names.indexOf(name) !== index);
    if (twice !== undefined) {
      throw new SourceError(`${subject}: ${twice} is listed twice — copies of one line are separate statements`, line);
    }
    if (stmt.name !== undefined) {
      throw new SourceError(`${subject}: a name belongs to one line, and a list of ends draws one line to each — leave the name off`, line);
    }
    return { ...stmt, several: { side, names } };
  }
  // `edge req client -> api`: a word before the ends names the line, told
  // from the ends by position, as in `node api "API"` (design.org 6.1).
  if (head[2] && head[3] && !head[2].quoted && !looksLikeArrow(head[2]) && looksLikeArrow(head[3])) {
    const name = requireName(head[1], 'edge', line);
    const stmt = parseEdge([head[0]!, ...head.slice(2)], line);
    if (stmt.several !== undefined) {
      throw new SourceError(`edge ${name}: a name belongs to one line, and a list of ends draws one line to each — leave the name off`, line);
    }
    return { ...stmt, name };
  }
  const stmt = parseEdgeEnds(head, line);
  // `via:` and the targets of `to: left, even with cat1` were stored as JSON
  // among the attributes; they belong to the line, so they come out here.
  const { via, 'from.even': fromEven, 'to.even': toEven, ...attrs } = stmt.attrs;
  if (via === undefined && fromEven === undefined && toEven === undefined) return stmt;
  const evenWith = {
    ...(fromEven !== undefined ? { from: JSON.parse(fromEven) as PlacementTarget[] } : {}),
    ...(toEven !== undefined ? { to: JSON.parse(toEven) as PlacementTarget[] } : {}),
  };
  return {
    ...stmt,
    attrs,
    ...(via !== undefined ? { via: JSON.parse(via) as ViaEntry[] } : {}),
    ...(fromEven !== undefined || toEven !== undefined ? { evenWith } : {}),
  };
}

/**
 * The ends of `edge a -> b, c, d` as written, and the head with only the first
 * name of each list left in it, or nothing when neither end is a list. Names
 * are separated by commas or `and`, as a placement's targets are.
 */
function endLists(head: Token[], line: number): { head: Token[]; from: string[]; to: string[] } | undefined {
  const left = readEndList(head, 1, line);
  if (left.names.length === 0 || !head[left.next] || !looksLikeArrow(head[left.next]!)) return undefined;
  const shortened = [head[0]!, { ...head[1]!, text: left.names[0]! }, ...head.slice(left.next)];
  const arrow = readArrow(shortened, line);
  const right = readEndList(shortened, arrow.next, line);
  if (left.names.length < 2 && right.names.length < 2) return undefined;
  return {
    head: [...shortened.slice(0, arrow.next), { ...shortened[arrow.next]!, text: right.names[0]! }, ...shortened.slice(right.next)],
    from: left.names,
    to: right.names,
  };
}

/** Names separated by commas or `and`, starting at `at`, up to the first that nothing follows. */
function readEndList(head: Token[], at: number, line: number): { names: string[]; next: number } {
  const names: string[] = [];
  for (;;) {
    const token = head[at];
    if (!token || token.quoted || isAttrKey(token) || token.text === '(' || token.text === ',' || token.text === 'and') {
      if (names.length === 0) return { names: [], next: at };
      throw new SourceError(`edge: the list of ends after ${names.at(-1)} promises another name, and none follows`, line);
    }
    const comma = token.text.endsWith(',') && token.text.length > 1;
    names.push(comma ? token.text.slice(0, -1) : token.text);
    at += 1;
    if (comma) continue;
    const next = head[at];
    if (next && !next.quoted && (next.text === ',' || next.text === 'and')) {
      at += 1;
      continue;
    }
    return { names, next: at };
  }
}

/** Where `each child of` starts in an edge's head, before the attributes, once per time it is written. */
function eachChildAt(head: Token[]): number[] {
  const found: number[] = [];
  for (let index = 1; index + 2 < head.length; index += 1) {
    const token = head[index]!;
    if (token.quoted || isAttrKey(token)) break;
    if (token.text === 'each' && head[index + 1]?.text === 'child' && head[index + 2]?.text === 'of' && !head[index + 1]!.quoted && !head[index + 2]!.quoted) {
      found.push(index);
      index += 2;
    }
  }
  return found;
}

/** Whether a token is an arrow, or begins one: a bracketed mark, or a run of dashes with marks at its ends. */
export function looksLikeArrow(token: Token): boolean {
  if (token.quoted) return false;
  if (token.text === '(' || /^\[[^\]]*\]-*$/.test(token.text)) return true;
  return /^[<|*o]*\|?-{1,}[>|*o]*$/.test(token.text) || /^-+$/.test(token.text);
}

function parseEdgeEnds(head: Token[], line: number): EdgeStmt {
  const left = requireName(head[1], 'edge', line);
  const arrow = readArrow(head, line);
  const rightToken = head[arrow.next];
  if (!rightToken || rightToken.quoted) {
    throw new SourceError('an edge needs a node on the right of the arrow', line);
  }
  refuseNameMark(rightToken, `edge ${left} ${arrow.text} ${rightToken.joined ?? rightToken.text}`, line);

  let at = arrow.next + 1;
  const stray = head[at];
  if (
    stray &&
    !stray.quoted &&
    !isAttrKey(stray) &&
    stray.text !== '(' &&
    stray.text !== 'between' &&
    !isDirection(stray.text) &&
    ((MARKS as readonly string[]).includes(rightToken.text) || Object.hasOwn(MARK_GLYPHS.to, rightToken.text))
  ) {
    // `edge a -- dot b`: a mark standing apart, which reads as a node named
    // `dot`. Said outright rather than left to the "not a direction" error.
    throw new SourceError(
      `edge ${left} ${arrow.text} ${rightToken.text} ${stray.text}: a mark touches the dashes or is ` +
        `in brackets — write "${arrow.text}${rightToken.text}" or "${arrow.text} [${rightToken.text}]"`,
      line,
    );
  }
  const subject = `edge ${left} ${arrow.text} ${rightToken.text}`;
  // Several texts are written one after another, each with its own bracket,
  // so one text is written exactly as it always was (design.org 7.3).
  const texts: EdgeTextStmt[] = [];
  while (head[at]?.quoted) {
    const text = head[at]!.text;
    const bracketed = follows(head, at + 1, '(');
    const read = readEdgeTextBracket(head, at + 1, subject, text, line);
    texts.push({ text, textAttrs: read.attrs, place: read.place });
    at = read.next;
    if (bracketed && follows(head, at, '(')) {
      throw new SourceError(`${subject}: the text "${text}" has two brackets — everything about one text goes in one`, line);
    }
  }

  // An edge is not placed, so its tail holds only attributes. The clauses that
  // once said what a line keeps clear of, `between c and d` and `below b`, are
  // gone: a line says the places it passes instead (design.org 6.4).
  let straight: Way | undefined;
  const tail = parseTail(head, at, line, subject, (tokens, index) => {
    const word = tokens[index]!;
    if (!word.quoted && word.text === 'straight') {
      // `straight down`: leave that way and stop at what the line meets (6.2).
      const way = tokens[index + 1]?.text;
      if (!(WAYS as readonly string[]).includes(way ?? '')) {
        throw new SourceError(`${subject}: "straight" is followed by the way the line goes — up, down, left or right`, line);
      }
      if (straight !== undefined) throw new SourceError(`${subject}: "straight" is written twice — keep one`, line);
      straight = way as Way;
      return index + 2;
    }
    if (word.quoted || word.text !== 'between') return undefined;
    const read = readTargets(tokens, index + 1, subject, 'between', line);
    const named = read.targets.map(nameTarget);
    throw new SourceError(
      `${subject}: "between ${named.join(' and ')}" on an edge is gone — a line says the places it passes, ` +
        `so write \`via: between ${named[0] ?? 'c'} and ${named[1] ?? 'd'}\``,
      line,
    );
  });

  if (tail.placements.length > 0) {
    const placement = tail.placements[0]!;
    const written = describePlacement(placement);
    if (placement.kind !== 'offset' || placement.written !== undefined) {
      throw new SourceError(
        `${subject}: "${written}" places a node, and an edge is not placed — it joins two things ` +
          'that are. A line says the places it passes with via:, such as `via: b top`',
        line,
      );
    }
    // `below b` said what to keep clear of, and left the engine to find the
    // line; the place it passes is written instead.
    const part = {
      above: 'top',
      below: 'bottom',
      left: 'left',
      right: 'right',
      'above-left': 'top-left',
      'above-right': 'top-right',
      'below-left': 'bottom-left',
      'below-right': 'bottom-right',
    }[placement.direction];
    const stops = placement.targets.map((target) => `${target.name} ${part}`).join(', ');
    throw new SourceError(
      `${subject}: "${written}" on an edge is gone — it said what the line keeps clear of, and a line now ` +
        `says the places it passes: \`via: ${stops}\``,
      line,
    );
  }

  refuseTextKey(tail.attrs, subject, 'after the arrow', line);

  return {
    kind: 'edge',
    texts,
    from: left,
    to: rightToken.text,
    arrow: arrow.text,
    marks: arrow.marks,
    ...(straight !== undefined ? { straight } : {}),
    attrs: tail.attrs,
    line,
  };
}

/**
 * `guide point funnel …`, `guide edge a -> b`, `guide region r …`, `guide
 * node frame ""`: the statement as it would be, reference only (design.org
 * 8.1). The word applies to its own statement and nothing inside it.
 */
function parseGuide(head: Token[], line: number): Stmt {
  const kind = head[1];
  const kinds = ['node', 'edge', 'point', 'region'];
  if (!kind || kind.quoted || !kinds.includes(kind.text)) {
    throw new SourceError(
      `guide goes before the statement it makes reference only — guide node, guide edge, guide point or guide region` +
        (kind && !kind.quoted ? `, not "guide ${kind.text}"` : ''),
      line,
    );
  }
  const stmt = parseStatement(head.slice(1), line);
  if (stmt.kind !== 'node' && stmt.kind !== 'edge' && stmt.kind !== 'point' && stmt.kind !== 'region') {
    throw new SourceError('guide goes before a node, an edge, a point or a region', line);
  }
  return { ...stmt, guide: true };
}

/**
 * `bundle trunk  via: through slot horizontal  layout: parallel (gap: tight)
 * order: y, z, x`: a line with no ends, which others travel together
 * (design.org 6.6). Or `bundle calls  a -> b  layout: fan`: the direct way
 * between two boxes, which copies of one line share.
 */
function parseBundle(head: Token[], line: number): BundleStmt {
  const name = requireName(head[1], 'bundle', line);
  const subject = `bundle "${name}"`;
  const attrs: Attrs = {};
  let via: ViaEntry[] | undefined;
  let order: string[] | undefined;
  let between: [string, string] | undefined;
  let i = 2;
  const shaft = head[3];
  if (head[2] && !head[2].quoted && !isAttrKey(head[2]) && shaft && !shaft.quoted && /^[^-]*-+[^-]*$/.test(shaft.text)) {
    if (shaft.text !== '--' && shaft.text !== '->') {
      throw new SourceError(`${subject}: "${shaft.text}" — a bundle's lines carry their own marks, so it is written a -- b or a -> b`, line);
    }
    const other = head[4];
    if (!other || other.quoted || isAttrKey(other)) {
      throw new SourceError(`${subject}: a bundle between two boxes names both, such as \`bundle ${name}  a -> b\``, line);
    }
    between = [head[2].text, other.text];
    i = 5;
  }
  while (i < head.length) {
    const token = head[i]!;
    if (!isAttrKey(token)) {
      throw new SourceError(`${subject}: expected an attribute like "via: b top", found "${token.text}"`, line);
    }
    const key = token.text.slice(0, -1);
    if (key === 'via') {
      if (via !== undefined) throw new SourceError(`${subject}: "via" is written twice — keep one`, line);
      const read = readVia(head, i + 1, subject, line);
      via = read.entries;
      i = read.next;
      continue;
    }
    if (key === 'order') {
      // `order: y, z, x`: names separated by commas, as `depth:` lists them.
      if (order !== undefined) throw new SourceError(`${subject}: "order" is written twice — keep one`, line);
      order = [];
      let next = i + 1;
      for (;;) {
        const item = head[next];
        if (!item || item.quoted || isAttrKey(item) || item.text === '(' || item.text === ',') {
          throw new SourceError(`${subject}: order: lists the lines through the bundle, such as order: y, z, x${order.length > 0 ? ' — the comma at the end promises another' : ''}`, line);
        }
        const listed = item.text.endsWith(',');
        order.push(listed ? item.text.slice(0, -1) : item.text);
        next += 1;
        if (!listed && follows(head, next, ',')) {
          next += 1;
          continue;
        }
        if (!listed) break;
      }
      i = next;
      continue;
    }
    i = readAttr(head, i, attrs, line, subject);
  }
  refuseKeys(attrs, BUNDLE_KEYS, subject, 'a bundle', line);
  if (via === undefined && between === undefined) {
    throw new SourceError(
      `${subject} says the way its lines travel together: a path, such as \`bundle ${name}  via: through slot horizontal\`, or two boxes, such as \`bundle ${name}  a -> b\``,
      line,
    );
  }
  if (via !== undefined && between !== undefined) {
    throw new SourceError(
      `${subject} runs directly between ${between[0]} and ${between[1]}, so it has no path for via: to name — keep one: the two boxes or the via:`,
      line,
    );
  }
  const arrangement = attrs['layout'] ?? 'parallel';
  if (arrangement !== 'parallel' && arrangement !== 'collapsed' && arrangement !== 'fan') {
    throw new SourceError(`${subject}: layout: ${arrangement} is not a bundle's arrangement — parallel (the default), collapsed or fan`, line);
  }
  if (arrangement === 'fan' && between === undefined) {
    throw new SourceError(`${subject}: layout: fan spreads lines between two boxes, and this bundle has a path — write the boxes, such as \`bundle ${name}  a -> b  layout: fan\`, or say parallel`, line);
  }
  for (const which of ['from', 'to'] as const) {
    if (attrs[which] !== undefined && between === undefined) {
      throw new SourceError(
        `${subject}: "${which}: ${attrs[which]}" — a bundle with a path ${which === 'from' ? 'starts' : 'ends'} where its path does; ${which}: belongs to a bundle between two boxes, such as \`bundle ${name}  a -> b  ${which}: ${attrs[which]}\``,
        line,
      );
    }
  }
  const routedBy = ['from', 'to', 'line.path'].find((key) => attrs[key] !== undefined);
  if (arrangement === 'fan' && routedBy !== undefined) {
    const written = routedBy === 'line.path' ? `line: (path: ${attrs[routedBy]})` : `${routedBy}: ${attrs[routedBy]}`;
    throw new SourceError(`${subject}: layout: fan bows its lines along the direct way between the boxes, and "${written}" routes the bundle — keep one, or say parallel`, line);
  }
  const gap = attrs['layout.gap'];
  for (const key of Object.keys(attrs)) {
    if (key.startsWith('layout.') && key !== 'layout.gap') {
      throw new SourceError(`${subject}: a bundle's layout: takes only gap:, such as layout: parallel (gap: normal)`, line);
    }
  }
  if (arrangement === 'collapsed' && gap !== undefined) {
    throw new SourceError(`${subject}: a collapsed bundle runs every line on one path, so it has no gap — leave (gap: ${gap}) off, or say parallel`, line);
  }
  if (arrangement === 'collapsed' && order !== undefined) {
    throw new SourceError(`${subject}: a collapsed bundle runs every line on one path, so it has no order across — leave order: off, or say parallel`, line);
  }
  for (const key of ['layout', 'layout.gap']) delete attrs[key];
  return {
    kind: 'bundle',
    name,
    ...(via !== undefined ? { via } : {}),
    ...(between !== undefined ? { between } : {}),
    arrangement,
    ...(gap !== undefined ? { gap } : {}),
    ...(order ? { order } : {}),
    attrs,
    line,
  };
}

/** `point funnel  between c2 and api at 2/3` */
function parsePoint(head: Token[], line: number): PointStmt {
  const name = requireName(head[1], 'point', line);
  const subject = `point "${name}"`;
  const marked = readMarkText(head, 'point', subject, line);
  head = marked.tokens;
  const start = marked.next;
  if (!head[start] || isAttrKey(head[start])) {
    throw new SourceError(`${subject} says where it is, such as \`point ${name}  between a and b\``, line);
  }
  clauseStarts?.add(head[start]);
  const read = readOneTarget(head, start, subject, line, true);
  if (read.listed) throw new SourceError(`${subject} is one point, so it takes no list`, line);
  refuseSpan(read.target, subject, line);
  const attrs = attrsOnly(head, read.next, line, subject);
  refuseKeys(attrs, POINT_KEYS, subject, 'a point', line);
  return { kind: 'point', name, point: read.target, ...(marked.text ? { text: marked.text } : {}), attrs, line };
}

/** `region r  c bottom-left to d top-right`, or `region r  between a and b (span: both)` */
function parseRegion(head: Token[], line: number): RegionStmt {
  const name = requireName(head[1], 'region', line);
  const subject = `region "${name}"`;
  const marked = readMarkText(head, 'region', subject, line);
  head = marked.tokens;
  const start = marked.next;
  if (!head[start] || isAttrKey(head[start])) {
    throw new SourceError(
      `${subject} says what it covers: two corners, \`region ${name}  a top-left to b bottom-right\`, or \`region ${name}  between a and b\``,
      line,
    );
  }
  clauseStarts?.add(head[start]);
  const first = readOneTarget(head, start, subject, line, true);
  if (first.listed) throw new SourceError(`${subject}: a region runs from one point to another, written with "to", not a list`, line);
  let corners: RegionStmt['corners'];
  let next = first.next;
  if (follows(head, next, 'to')) {
    if (!head[next + 1] || isAttrKey(head[next + 1]!)) throw new SourceError(`${subject}: "to" names no point`, line);
    const second = readOneTarget(head, next + 1, subject, line, true);
    for (const corner of [first.target, second.target]) refuseSpan(corner, subject, line);
    corners = [first.target, second.target];
    next = second.next;
  } else {
    if (first.target.point?.kind !== 'between') {
      throw new SourceError(
        `${subject}: a region is the rectangle between two points — \`region ${name}  ${nameTarget(first.target)} to …\`, ` +
          `or a region between two things, \`region ${name}  between a and b\``,
        line,
      );
    }
    corners = [first.target];
  }
  const attrs = attrsOnly(head, next, line, subject);
  refuseKeys(attrs, REGION_KEYS, subject, 'a region', line);
  if (attrs['opacity'] !== undefined) checkOpacity(attrs['opacity'], subject, line);
  return { kind: 'region', name, corners, ...(marked.text ? { text: marked.text } : {}), attrs, line };
}

/** Refuse what a point or a region has no use for, by name. */
function refuseKeys(attrs: Attrs, keys: readonly string[], subject: string, what: string, line: number): void {
  for (const key of Object.keys(attrs)) {
    const top = key.split('.')[0]!;
    if (keys.includes(top)) continue;
    throw new SourceError(`${subject}: ${what} has no ${top}: — it takes ${keys.map((k) => `${k}:`).join(', ')}`, line);
  }
}

/** `style <name> <attributes>` */
function parseStyle(head: Token[], line: number): StyleStmt {
  const name = requireName(head[1], 'style', line);
  const attrs = attrsOnly(head, 2, line, `style "${name}"`);
  if (Object.keys(attrs).length === 0) {
    throw new SourceError(`style "${name}" sets nothing`, line);
  }
  if (attrs['url'] !== undefined) {
    // A destination is content, not appearance. A style is a bundle worn by
    // many things, so a `url:` in one would point every node wearing it at the
    // same place — which is never what anybody means, and would be silent.
    throw new SourceError(
      `style "${name}" has a url. A destination is part of what a node says rather than how it ` +
        'looks, so it is written on the node or the edge itself',
      line,
    );
  }
  return { kind: 'style', name, attrs, line };
}

/**
 * `icon gh  letters: "GH"  fill: #24292f  text: white`. The characters have a
 * key of their own because a quoted string after an icon's name is a file to
 * read, and `text:` is the letters' color, as it is a node's.
 */
function readLetterIcon(head: Token[], start: number, name: string, line: number): { letters: string; fill?: string; text?: string } {
  const read: { letters?: string; fill?: string; text?: string } = {};
  const subject = `icon "${name}"`;
  for (let i = start; i < head.length; i += 2) {
    const keyToken = head[i]!;
    clauseStarts?.add(keyToken);
    const key = keyToken.text.slice(0, -1);
    if (!isAttrKey(keyToken) || (key !== 'letters' && key !== 'fill' && key !== 'text')) {
      throw new SourceError(`${subject}: a letter icon takes letters, fill and text, found "${keyToken.text}"`, line);
    }
    if (read[key] !== undefined) throw new SourceError(`${subject}: "${key}" is written twice — keep one`, line);
    const value = head[i + 1];
    if (value === undefined || isAttrKey(value)) throw new SourceError(`${subject}: "${key}" has no value`, line);
    if (key === 'letters') {
      if (!value.quoted) throw new SourceError(`${subject}: letters are a text, written in quotes — \`letters: "${value.text}"\``, line);
      if (value.text.trim() === '') throw new SourceError(`${subject}: \`letters:\` is empty — write the letters to show, such as \`letters: "GH"\``, line);
      read.letters = value.text;
    } else {
      if (value.quoted) throw new SourceError(`${subject}: a color is written without quotes — \`${key}: ${value.text}\``, line);
      checkColorWord(value.text, subject, line);
      read[key] = value.text;
    }
  }
  return { letters: read.letters!, ...(read.fill === undefined ? {} : { fill: read.fill }), ...(read.text === undefined ? {} : { text: read.text }) };
}

/**
 * `icon <name> "<svg>…</svg>"`, or `icon <name> ./file.svg`. What the picture
 * is — pasted markup or a file to read — is worked out when the diagram is
 * resolved, since only the caller knows whether files can be read at all.
 */
function parseIcon(head: Token[], line: number): IconStmt {
  const name = requireName(head[1], 'icon', line);
  const picture = head[2];
  if (picture !== undefined && isAttrKey(picture) && picture.text === 'letters:') {
    return { kind: 'icon', name, source: '', pasted: false, letters: readLetterIcon(head, 2, name, line), line };
  }
  if (picture !== undefined && isAttrKey(picture) && (picture.text === 'fill:' || picture.text === 'text:')) {
    throw new SourceError(`icon "${name}" has colors and no letters — a letter icon starts \`icon ${name}  letters: "GH"\``, line);
  }
  if (picture === undefined || isAttrKey(picture)) {
    throw new SourceError(
      `icon "${name}" needs its picture: the SVG itself between """ marks, or the name of an .svg file`,
      line,
    );
  }
  if (head.length > 3) {
    throw new SourceError(
      `icon "${name}" takes one picture and nothing else — "${head[3]!.text}" is left over`,
      line,
    );
  }
  return { kind: 'icon', name, source: picture.text, pasted: picture.triple === true || picture.text.trim().startsWith('<'), line };
}

/**
 * `diagram <attributes>` — no name, because a file holds one diagram. Unknown
 * keys are refused rather than ignored: a misspelt diagram-wide setting that
 * silently does nothing is the kind of thing an author stares at for a while.
 */
function parseDiagram(head: Token[], line: number): DiagramStmt {
  const attrs = attrsOnly(head, 1, line, 'diagram');
  if (Object.keys(attrs).length === 0) {
    throw new SourceError('diagram sets nothing', line);
  }
  for (const key of Object.keys(attrs)) {
    if (key.startsWith('text.')) {
      // The theme has one text color, shared by everything, and that is all
      // the diagram's text sets. A size or a wrap is about one kind of text.
      if (key !== 'text.color') {
        const inner = key.slice('text.'.length);
        throw new SourceError(
          `diagram text: sets only a color — \`${inner}\` is about one kind of text, so write ` +
            `\`text: (${inner}: ${attrs[key]})\` on a \`default node\` or \`default edge\``,
          line,
        );
      }
      continue;
    }
    if (key.startsWith('checks.')) {
      setCheck({ ...CHECK_DEFAULTS }, key.slice('checks.'.length), attrs[key]!, (message) => new SourceError(message, line));
      continue;
    }
    if (!(DIAGRAM_KEYS as readonly string[]).includes(key)) {
      throw new SourceError(
        `diagram has no "${key}" — it takes ${DIAGRAM_KEYS.join(', ')}`,
        line,
      );
    }
  }
  if (attrs['text'] !== undefined) {
    throw new SourceError('diagram text: takes a bracket — `text: (color: #e0e0e0)`', line);
  }
  if (attrs['checks'] !== undefined) {
    throw new SourceError('diagram checks: takes a bracket — `checks: (edge-crossings: on)`', line);
  }
  const guides = attrs['guides'];
  if (guides !== undefined && guides !== 'show' && guides !== 'hide') {
    throw new SourceError(`diagram guides: is show or hide, not "${guides}"`, line);
  }
  const theme = attrs['theme'];
  if (theme !== undefined && THEMES[theme] === undefined) {
    throw new SourceError(
      `there is no theme called "${theme}" — the themes are ${THEME_NAMES.join(', ')}`,
      line,
    );
  }
  return { kind: 'diagram', attrs, line };
}

/**
 * `default <node | leaf | container | edge> <attributes>` — a style every thing
 * of that kind wears without naming it. It is strict about kind where a style
 * is permissive, because it names the kind it is for: a word that kind has no
 * use for can only be a mistake.
 */
function parseDefault(head: Token[], line: number): DefaultStmt {
  let target = head[1];
  // `default guide node`: a shown guide's look, one line per kind.
  const guide = target !== undefined && !target.quoted && target.text === 'guide';
  if (guide) {
    const kind = head[2];
    const kinds = ['node', 'edge', 'point', 'region'];
    if (!kind || kind.quoted || !kinds.includes(kind.text)) {
      throw new SourceError(
        'there is no bare `default guide`, since the kinds share almost no keys — write default guide node, ' +
          'default guide edge, default guide point or default guide region',
        line,
      );
    }
    target = { ...kind, text: `guide ${kind.text}` };
  }
  if (!target || target.quoted || !(DEFAULT_TARGETS as readonly string[]).includes(target.text)) {
    throw new SourceError(
      `default needs the kind it is for — ${DEFAULT_TARGETS.join(', ')}` +
        (target && !isAttrKey(target) ? `, not "${target.text}"` : ''),
      line,
    );
  }
  const kind = target.text as DefaultTarget;
  const subject = `default ${kind}`;
  const start = guide ? 3 : 2;
  // `default leaf node` reads naturally and says nothing `default leaf` does not.
  const extra = head[start];
  if (!guide && extra && !extra.quoted && !isAttrKey(extra) && extra.text === 'node' && kind !== 'node') {
    throw new SourceError(`write \`default ${kind}\` — a ${kind} is already a node`, line);
  }
  const attrs = attrsOnly(head, start, line, subject);
  if (Object.keys(attrs).length === 0) {
    throw new SourceError(`${subject} sets nothing`, line);
  }
  const allowed = DEFAULT_KEYS[kind];
  for (const key of new Set(Object.keys(attrs).map((k) => k.split('.')[0]!))) {
    if (allowed.includes(key)) continue;
    throw new SourceError(`${subject} has ${key}:, ${defaultRefusal(kind, key)}`, line);
  }
  return { kind: 'default', target: kind, attrs, line };
}

/** Why a default cannot carry a word, and what to write instead. */
function defaultRefusal(kind: DefaultTarget, key: string): string {
  const takes = `it takes ${DEFAULT_KEYS[kind].map((k) => `${k}:`).join(', ')}`;
  if (key === 'url') return `and a destination belongs to one thing rather than to every one of a kind`;
  if (key === 'heading') {
    return "and a heading names one node's own child, so it is written on that node";
  }
  if (key === 'join-with') {
    return 'and a join names the one thing a node moves with, so it is written on that node';
  }
  if (key === 'icon') {
    return 'and a picture cannot hold children, so an icon is a leaf\'s word — write `default leaf  icon:`';
  }
  if ((kind === 'edge' || kind === 'guide edge') && key === 'corners') {
    return "which is a node's — a line's corners go in its bracket: line: (corners: sharp)";
  }
  if (kind === 'edge' && (key === 'fill' || key === 'border')) {
    return `which an edge does not have — an edge is colored by line: and text: (color: …)`;
  }
  if (kind !== 'edge' && key === 'line') {
    return `which is an edge's — a node is colored by fill:, border: and text: (color: …)`;
  }
  return `which a default does not set — ${takes}`;
}

function requireName(token: Token | undefined, keyword: string, line: number): string {
  if (!token || token.quoted) {
    throw new SourceError(`${keyword} needs a name`, line);
  }
  refuseNameMark(token, `${keyword} "${token.joined ?? token.text}"`, line);
  return token.text;
}

/**
 * A word with a colon or a semicolon in it, where a name belongs. Both used to
 * be ordinary characters in a name, so this refuses files that once parsed, and
 * says why rather than reporting whatever the split word turned into next.
 */
function refuseNameMark(token: Token, where: string, line: number): void {
  const mark = nameMark(token);
  if (mark === undefined) return;
  const reason =
    mark === ':'
      ? 'a colon makes the word before it a key, with or without a space after it'
      : 'a semicolon is reserved';
  throw new SourceError(`${where}: a name may not contain "${mark}", because ${reason}`, line);
}

/**
 * Read one placement. A direction and a target (`right of docker`, `below
 * deploy`), an alignment (`level with docker`), or an overlay (`on hub at
 * top-right`).
 *
 * `of` is optional after every direction. "left of X" and "below X" are both
 * good English and "below of X" is not, so the word is accepted wherever it
 * helps and never demanded. Shorthands added later extend this without
 * disturbing what it already reads.
 */
function readPlacement(
  tokens: Token[],
  at: number,
  line: number,
  subject: string,
  nested = false,
): { placement: Placement; next: number } {
  const word = tokens[at]!;
  // A placement read after its own distance or part (`6 above x`) is still
  // the clause that word began, so only the outermost read starts one.
  if (!nested) clauseStarts?.add(word);
  if (word.quoted) {
    throw new SourceError(`${subject}: unexpected text "${word.text}"`, line);
  }

  // `center 12 right of a center`: a part of this box measured from a part of
  // another (design.org 5.2). Nothing sensible defaults between centers, so
  // the distance is required.
  if (!word.quoted && isPart(word.text) && !follows(tokens, at + 1, 'of') && !follows(tokens, at + 1, 'even')) {
    if (opensPartPlacement(tokens, at)) {
      const read = readPlacement(tokens, at + 1, line, subject, true);
      if (read.placement.kind !== 'offset') return read;
      return { placement: { ...read.placement, own: word.text }, next: read.next };
    }
    const direction = tokens[at + 1];
    if (direction && !direction.quoted && isDirection(direction.text)) {
      const of = /left|right/.test(direction.text) ? ' of' : '';
      const rest = tokens.slice(at + 2 + (follows(tokens, at + 2, 'of') ? 1 : 0), at + 4 + (follows(tokens, at + 2, 'of') ? 1 : 0));
      const target = rest.map((token) => token.text).join(' ') || '…';
      throw new SourceError(
        `${subject}: "${word.text} ${direction.text}${of} …" names a part, so say how far: ` +
          `\`${word.text} 12 ${direction.text}${of} ${target}\``,
        line,
      );
    }
  }

  // `2 right of x` is `right of x (gap: 2)`: a distance written in front.
  const distance = /^-?\d*\.?\d+(px)?$/.exec(word.text);
  if (distance && tokens[at + 1] && isDirection(tokens[at + 1]!.text)) {
    if (word.text.startsWith('-')) {
      const flipped = OPPOSITE[tokens[at + 1]!.text as Direction];
      throw new SourceError(
        `${subject}: a distance is never negative — write \`${word.text.slice(1)} ${flipped}${/left|right/.test(flipped) ? ' of' : ''} …\`, ` +
          'or inside or on for a box meant to overlap',
        line,
      );
    }
    // `3 below and 2 right of a`: a different distance on each axis.
    const other = tokens[at + 3];
    if (follows(tokens, at + 2, 'and') && other && !other.quoted && /^\d*\.?\d+(px)?$/.test(other.text) && tokens[at + 4] && isDirection(tokens[at + 4]!.text)) {
      const first = tokens[at + 1]!.text as Direction;
      const second = tokens[at + 4]!.text as Direction;
      const vertical = (d: Direction) => d === 'above' || d === 'below';
      const horizontal = (d: Direction) => d === 'left' || d === 'right';
      if (!((vertical(first) && horizontal(second)) || (horizontal(first) && vertical(second)))) {
        throw new SourceError(
          `${subject}: "${word.text} ${first} and ${other.text} ${second}" gives two distances, one for each axis, ` +
            'so one direction is above or below and the other left or right',
          line,
        );
      }
      const read = readPlacement(tokens, at + 3, line, subject, true);
      if (read.placement.kind !== 'offset') return read;
      const y = vertical(first) ? first : second;
      const x = vertical(first) ? second : first;
      const gaps = { y: vertical(first) ? word.text : other.text, x: vertical(first) ? other.text : word.text };
      const { gap: _gap, ...rest } = read.placement;
      return {
        placement: { ...rest, direction: `${y}-${x}` as Direction, gaps },
        next: read.next,
      };
    }
    const read = readPlacement(tokens, at + 1, line, subject, true);
    if (read.placement.kind !== 'offset') return read;
    if (read.placement.gap !== undefined) {
      throw new SourceError(
        `${subject}: "${word.text} ${describePlacement(read.placement)}" says its distance twice, in front and in the bracket — keep one`,
        line,
      );
    }
    return { placement: { ...read.placement, gap: word.text }, next: read.next };
  }

  // `level with` was renamed: in plain English it means "at the same height",
  // which made `left level with x` read wrong.
  if (word.text === 'level' || (isSideWord(word.text) && follows(tokens, at + 1, 'level'))) {
    throw new SourceError(
      `${subject}: "level with" is now "even with" — write \`${isSideWord(word.text) ? `${word.text} ` : ''}even with …\``,
      line,
    );
  }

  if (word.text === 'on') return readOn(tokens, at, line, subject);
  if (word.text === 'inside' || word.text === 'outside') {
    return readTucked(tokens, at, line, subject, word.text);
  }

  // `top level with media` names a side rather than the center line. `left`
  // and `right` are sides as well as directions, so it is the word after them
  // that says which was meant — "left of drive" against "left level with drive".
  const side = isSideWord(word.text) && follows(tokens, at + 1, 'even') ? word.text : undefined;
  // `x even with a` and `y even with a` name the axis outright, centers shared
  // on it; `y` says what the bare `even with a` says.
  const named = isAxisWord(word.text) && follows(tokens, at + 1, 'even') ? word.text : undefined;
  const front = side ?? named;
  const head = front ? tokens[at + 1]! : word;

  if (head.text === 'even' && !head.quoted) {
    const from = front ? at + 1 : at;
    const written = front ? `${front} even with` : 'even with';
    if (!follows(tokens, from + 1, 'with')) {
      throw new SourceError(`${subject}: an alignment reads "${written} <node>"`, line);
    }
    const read = readTargets(tokens, from + 2, subject, written, line);
    const axis = named ?? SIDE_AXIS[side ?? 'center'];
    checkEvenTargets(read.targets, axis, written, subject, line);
    const modifiers = readModifiers(tokens, read.next, subject, `${written} ${listTargets(read.targets)}`, line);
    // An alignment shares a line outright, so there is no distance in it for
    // a gap to set. Refusing rather than dropping it, for the reason unknown
    // modifier names are refused: a word that quietly does nothing reads as a
    // fault in the tool.
    if (modifiers.gap !== undefined) {
      throw new SourceError(
        `${subject}: "${written} ${listTargets(read.targets)}" shares a line rather than leaving a space, so it takes no gap`,
        line,
      );
    }
    return {
      placement: {
        kind: 'align',
        axis,
        side: side ?? 'center',
        targets: read.targets,
        line,
      },
      next: modifiers.next,
    };
  }

  if (!isDirection(word.text)) {
    // A position word where a direction belongs is the one confusable pair, and
    // it is worth naming rather than only refusing: the two vocabularies reach
    // the same corner with different words and only one of them takes `of`.
    if (isPosition(word.text)) {
      throw new SourceError(
        `${subject}: "${word.text}" is a position on a box rather than a direction from one — ` +
          `write \`inside <node> ${word.text}\` to put this in that corner, \`on <node> ` +
          `${word.text}\` to straddle it, or a direction like ${DIRECTIONS.join(', ')} to put ` +
          'it outside',
        line,
      );
    }
    // A semicolon is reserved rather than ordinary, and someone writing one
    // between clauses wants to know that spaces already do that job.
    if (AXIS_ADVERBS.has(word.text)) {
      throw new SourceError(`${subject}: ${axisAdverb(word.text, tokens[at - 1]?.text ?? '…')}`, line);
    }
    if (word.text.startsWith(';')) {
      throw new SourceError(`${subject}: ";" separates nothing — clauses are separated by spaces alone`, line);
    }
    throw new SourceError(`${subject}: "${word.text}" is not a direction`, line);
  }
  let next = at + 1;
  const of = follows(tokens, next, 'of');
  // Each direction has one spelling, as English says it: `below a`, `left of a`.
  const takesOf = /left|right/.test(word.text);
  if (of && !takesOf) {
    throw new SourceError(`${subject}: "${word.text} of" is written "${word.text}" — \`${word.text} ${tokens[next + 1]?.text ?? '…'}\``, line);
  }
  if (!of && takesOf) {
    throw new SourceError(`${subject}: "${word.text}" before a name is written "${word.text} of" — \`${word.text} of ${tokens[next]?.text ?? '…'}\``, line);
  }
  if (of) next += 1;
  const read = readTargets(tokens, next, subject, word.text, line);
  for (const target of read.targets) {
    refuseSpan(target, subject, line);
    facedSide(target, word.text, subject, line);
  }
  const modifiers = readModifiers(
    tokens,
    read.next,
    subject,
    `${word.text}${of ? ' of' : ''} ${listTargets(read.targets)}`,
    line,
  );
  return {
    placement: {
      kind: 'offset',
      direction: word.text,
      targets: read.targets,
      ...(modifiers.gap !== undefined ? { gap: modifiers.gap } : {}),
      line,
    },
    next: modifiers.next,
  };
}

/**
 * What `even with` may line up with, on one axis: shared by a placement
 * (`top even with x`) and a line's end (`to: left, even with x`), which name
 * one height (axis `y`) or one place across (`x`).
 */
function checkEvenTargets(targets: PlacementTarget[], axis: Axis, written: string, subject: string, line: number): void {
  // `left even with 3/4 down x`: three quarters down names a height, which
  // has no place across to meet.
  for (const target of targets) {
    if (!target.fraction || fractionAxis(target.fraction) === axis) continue;
    throw new SourceError(
      `${subject}: "${nameTarget(target)}" names a ${axis === 'x' ? 'height' : 'place across'}, so "${written}" has nothing to meet there — ` +
        (axis === 'x' ? `write a fraction across, such as \`${written} 1/3 across ${target.name}\`` : `write a fraction down, such as \`${written} 3/4 down ${target.name}\``),
      line,
    );
  }
  for (const target of targets) refuseSpan(target, subject, line);
  // `top even with server left`: the left side runs server's whole height, so
  // it has no one height to meet, and drawing it as `server`'s top would make
  // a second spelling of `top even with server`.
  for (const target of targets) {
    if (!target.part || !isSideWord(target.part) || SIDE_AXIS[target.part] === axis) continue;
    const [near, far] = axis === 'y' ? ['top', 'bottom'] : ['left', 'right'];
    throw new SourceError(
      `${subject}: "${target.name} ${target.part}" is the whole of ${target.name}'s ${target.part} side, ` +
        `so "${written}" has no one ${axis === 'y' ? 'height' : 'place across'} to meet there — ` +
        `name ${target.name} ${near}, center or ${far}, or a corner such as ${target.name} ${axis === 'y' ? `${near}-${target.part}` : `${target.part}-${near}`}`,
      line,
    );
  }
}

/** `(span: both)` stretches a region; a point has nothing to stretch. */
function refuseSpan(target: PlacementTarget, subject: string, line: number): void {
  if (target.point?.kind !== 'between' || !target.point.span) return;
  throw new SourceError(
    `${subject}: "(span: both)" makes a region, and a placement is against a point or a thing — name the region, ` +
      `\`region r  ${describePoint(target.point)}\`, and place against r`,
    line,
  );
}

/**
 * `right of server 3/4 down`: the direction already says which side is meant,
 * so the fraction needs no side of its own (design.org 5.2).
 */
function facedSide(target: PlacementTarget, direction: Direction, subject: string, line: number): void {
  const fraction = target.fraction;
  if (!fraction || fraction.first || target.part !== undefined) return;
  const faced: Partial<Record<Direction, Part>> = { right: 'right', left: 'left', above: 'top', below: 'bottom' };
  const side = faced[direction];
  if (side === undefined) {
    throw new SourceError(
      `${subject}: "${direction} of ${nameTarget(target)}" faces a corner of ${target.name}, which has no side to go ` +
        `${fraction.along} — name the side: \`${direction} of ${target.name} ${fraction.along === 'across' ? 'bottom' : 'right'} ${fraction.written}\``,
      line,
    );
  }
  const words = side === 'left' || side === 'right' ? '3/4 down or 1/4 up' : '1/3 across or 1/3 across from right';
  if ((fraction.along === 'across') !== (side === 'top' || side === 'bottom')) {
    throw new SourceError(
      `${subject}: "${direction}${/left|right/.test(direction) ? ' of' : ''} ${nameTarget(target)}" faces ${target.name}'s ${side} side, ` +
        `which ${fraction.along} doesn't run along — it takes ${words}`,
      line,
    );
  }
  target.part = side;
}

/**
 * `on hub top-right` — the node's center at the part's center, straddling it.
 *
 * One target, and the `and` list the other placements take is refused by name.
 * A direction against several targets means "clear of the box that bounds them
 * all", which is a floor and decomposes into one constraint per target; this
 * names an exact point of one box, and the box bounding two things is not a
 * box anybody drew.
 */
function readOn(
  tokens: Token[],
  at: number,
  line: number,
  subject: string,
): { placement: Placement; next: number } {
  const read = readTargets(tokens, at + 1, subject, 'on', line, true);
  const target = read.targets[0]!;
  refuseSpan(target, subject, line);
  if (read.targets.length > 1) {
    throw new SourceError(
      `${subject}: "on ${listTargets(read.targets)}" names ${read.targets.length} nodes, and a ` +
        'stamp sits on one box — name the one it is stamped on',
      line,
    );
  }
  // `on X at <position>` shipped in 0.3.0 and never reached a release. Every
  // picture it drew is still drawable, in words that had to exist anyway, so
  // it is refused by name rather than left as a second spelling.
  if (follows(tokens, read.next, 'at')) {
    const wordToken = tokens[read.next + 1];
    const word = wordToken && !wordToken.quoted ? wordToken.text : '<position>';
    throw new SourceError(
      `${subject}: "on ${target.name} at ${word}" is no longer how a node is put on a box — ` +
        `write \`inside ${target.name} ${word}\` to tuck it inside that corner, or ` +
        `\`on ${target.name} ${word}\` to straddle it`,
      line,
    );
  }
  const modifiers = readModifiers(tokens, read.next, subject, `on ${nameTarget(target)}`, line);
  if (modifiers.gap !== undefined) {
    throw new SourceError(
      `${subject}: "on ${nameTarget(target)}" puts this node's center on that point rather than ` +
        'leaving a space, so it takes no gap',
      line,
    );
  }
  return {
    placement: { kind: 'on', targets: read.targets, line },
    next: modifiers.next,
  };
}

/**
 * `inside server right`, `outside board top-left` — a direction read off the
 * part rather than written.
 *
 * Both are shorthands, and their expansion is *derived* rather than listed:
 * inside is the direction from the named part toward the box's center, outside
 * is away from it. One rule covers every part — `inside right` is `left of`,
 * `inside top-right` is `below-left of` — so nobody writes a table and the
 * long form can be printed back.
 */
function readTucked(
  tokens: Token[],
  at: number,
  line: number,
  subject: string,
  written: 'inside' | 'outside',
): { placement: Placement; next: number } {
  const read = readTargets(tokens, at + 1, subject, written, line, true);
  const target = read.targets[0]!;
  refuseSpan(target, subject, line);
  if (read.targets.length > 1) {
    throw new SourceError(
      `${subject}: "${written} ${listTargets(read.targets)}" names ${read.targets.length} nodes, ` +
        `and "${written}" reads its direction off one part of one box`,
      line,
    );
  }
  const inward = target.part === undefined ? undefined : INWARD[target.part];
  if (inward === undefined) {
    const named =
      target.part === undefined
        ? `"${written} ${target.name}" names no part of "${target.name}"`
        : `"${written} ${nameTarget(target)}" reads no direction from "${target.part}", ` +
          'which is not on the boundary';
    throw new SourceError(
      `${subject}: ${named} — "${written}" takes a side or a point of the box: ` +
        `${BOUNDARY_PARTS.join(', ')}`,
      line,
    );
  }
  const modifiers = readModifiers(tokens, read.next, subject, `${written} ${nameTarget(target)}`, line);
  return {
    placement: {
      kind: 'offset',
      direction: written === 'inside' ? inward : OPPOSITE[inward],
      written,
      targets: read.targets,
      ...(modifiers.gap !== undefined ? { gap: modifiers.gap } : {}),
      line,
    },
    next: modifiers.next,
  };
}

/**
 * The bracketed modifiers on one placement — `left of hub (gap: wide)`.
 *
 * A gap describes the relationship rather than the box at either end of it, so
 * a node wedged between two things can be tight against one and wide of the
 * other. The brackets are what make the scope visible: a bare `gap:` sitting
 * between two placements cannot be told from the node-wide default, and would
 * attach silently to whichever clause happened to precede it.
 */
function readModifiers(
  tokens: Token[],
  start: number,
  subject: string,
  placement: string,
  line: number,
): { gap?: string; next: number } {
  const read = readBracket(tokens, start, PLACEMENT_KEYS, {
    subject,
    what: `"${placement}"`,
    kind: 'a placement',
    example: 'gap: wide',
    line,
  });
  return { ...read.values, next: read.next };
}

/**
 * A bracketed `key: value` list, shared by a placement's modifiers and a
 * text's. Both exist for the same reason — a modifier belongs to the clause it
 * modifies, and the brackets say which clause that is rather than leaving it to
 * be inferred from what happens to precede it.
 *
 * The keys are whitelisted and an unknown one is refused by name, the same rule
 * `DIAGRAM_KEYS` follows: a modifier that silently does nothing is worse than an
 * error, because the picture moves and nothing says why.
 */
function readBracket(
  tokens: Token[],
  start: number,
  keys: readonly string[],
  about: { subject: string; what: string; kind: string; example: string; line: number; listed?: readonly string[] },
): { values: Record<string, string>; next: number } {
  if (!follows(tokens, start, '(')) return { values: {}, next: start };

  const values: Record<string, string> = {};
  let i = start + 1;

  while (!follows(tokens, i, ')')) {
    const keyToken = tokens[i];
    if (!keyToken) {
      throw new SourceError(
        `${about.subject}: ${about.what} opens a "(" and never closes it`,
        about.line,
      );
    }
    if (!isAttrKey(keyToken)) {
      throw new SourceError(
        `${about.subject}: ${about.what} takes modifiers like "${about.example}" in its brackets, found "${keyToken.text}"`,
        about.line,
      );
    }
    const key = keyToken.text.slice(0, -1);
    if (!keys.includes(key)) {
      throw new SourceError(`${about.kind} has no "${key}" — it takes ${(about.listed ?? keys).join(', ')}`, about.line);
    }
    const valueToken = tokens[i + 1];
    if (!valueToken || valueToken.quoted || isAttrKey(valueToken) || valueToken.text === ')') {
      throw new SourceError(`${about.subject}: "${key}" has no value`, about.line);
    }
    // A comma between modifiers is punctuation, exactly as it is between the
    // targets of a placement. `(at: bottom, align: center)` and the same without
    // the comma are the same statement.
    const value = valueToken.text;
    const clean = value.endsWith(',') && value.length > 1 ? value.slice(0, -1) : value;
    if (key === 'color') checkColorWord(clean, about.subject, about.line);
    const had = values[key];
    if (had !== undefined) {
      throw new SourceError(
        `${about.subject}: "${key}" is written twice in the brackets after ${about.what} (${had}, ${clean}) — keep one`,
        about.line,
      );
    }
    values[key] = clean;
    i += 2;
  }

  return { values, next: i + 1 };
}

/**
 * A color is any CSS color, which cannot be checked, or a `theme-` word, which
 * can. So a `theme-` word the theme does not define is refused rather than
 * handed to the viewer as a color that draws nothing, and `muted`, the one
 * theme word from before the prefix, is refused with its new name.
 */
function checkColorWord(value: string, subject: string, line: number): void {
  if (value === 'muted') {
    throw new SourceError(
      `${subject}: \`muted\` is now \`theme-muted\` — every color that follows the theme begins \`theme-\``,
      line,
    );
  }
  if (value.startsWith('theme-') && !THEME_COLORS.includes(value)) {
    throw new SourceError(
      `${subject}: there is no theme color "${value}" — the theme colors are ${THEME_COLORS.join(', ')}`,
      line,
    );
  }
  // Hex digits without their `#` are no CSS color, so the viewer would draw nothing.
  if (/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
    // `bad` and `face` are spelled in hex digits too, so without a digit it is only a guess.
    const fix = /\d/.test(value) ? 'a hex color is written' : 'if it is a hex color, write';
    throw new SourceError(`${subject}: \`${value}\` is not a color — ${fix} \`#${value}\``, line);
  }
}

const URL_QUOTES =
  'a url is written in quotes — `url: "https://example.com"`. Without them everything from the `//` onwards is read as a comment';

/**
 * `url: "https://a" (name: "A", icon: "A" (fill: red))  "https://b"`: one or
 * more quoted addresses, each with an optional bracket after it. The values in
 * a link's bracket are a name (a text, so quoted) and a badge, which is quoted
 * letters or the unquoted name of a picture. `readBracket` takes only unquoted
 * values and no bracket inside a bracket, so links are read here.
 */
function readLinks(tokens: Token[], start: number, subject: string, line: number): { links: Link[]; next: number } {
  // `url: https://example.com` loses everything from the `//` onwards, because
  // `//` opens a comment — so the value is either missing entirely or is the
  // bare scheme, which reads as another attribute key. Neither report says
  // what is wrong, and the remedy is punctuation rather than a missing word.
  if (!tokens[start]?.quoted) throw new SourceError(`${subject}: ${URL_QUOTES}`, line);
  const links: Link[] = [];
  let i = start;
  while (tokens[i]?.quoted) {
    const link: Link = { href: tokens[i]!.text };
    i += 1;
    if (follows(tokens, i, '(')) {
      const read = readLinkBracket(tokens, i, link.href, subject, line);
      Object.assign(link, read.link);
      i = read.next;
    }
    if (links.some((had) => had.href === link.href)) {
      throw new SourceError(`${subject}: "${link.href}" is linked twice in one \`url:\` — keep one`, line);
    }
    links.push(link);
  }
  return { links, next: i };
}

function readLinkBracket(
  tokens: Token[],
  start: number,
  href: string,
  subject: string,
  line: number,
): { link: Omit<Link, 'href'>; next: number } {
  const link: Omit<Link, 'href'> = {};
  const what = `the link "${href}"`;
  let i = start + 1;
  for (;;) {
    if (follows(tokens, i, ',')) { i += 1; continue; }
    if (follows(tokens, i, ')')) break;
    const keyToken = tokens[i];
    if (!keyToken) throw new SourceError(`${subject}: ${what} opens a "(" and never closes it`, line);
    if (!isAttrKey(keyToken)) {
      throw new SourceError(`${subject}: ${what} takes \`name:\` and \`icon:\` in its brackets, found "${keyToken.text}"`, line);
    }
    const key = keyToken.text.slice(0, -1);
    if (key !== 'name' && key !== 'icon') {
      throw new SourceError(`a link has no "${key}" — it takes name and icon`, line);
    }
    if (link[key] !== undefined) {
      throw new SourceError(`${subject}: "${key}" is written twice in the brackets after ${what} — keep one`, line);
    }
    const value = tokens[i + 1];
    if (!value || isAttrKey(value) || (!value.quoted && (value.text === ')' || value.text === '('))) {
      throw new SourceError(`${subject}: "${key}" has no value`, line);
    }
    if (key === 'name') {
      if (!value.quoted) {
        throw new SourceError(`${subject}: a link's name is a text, written in quotes — \`name: "${value.text.replace(/,$/, '')}"\``, line);
      }
      link.name = value.text;
      i += 2;
      continue;
    }
    // A badge: quoted letters, which may take their colors in a bracket of
    // their own, or the name of a picture, which keeps the colors it has.
    if (value.quoted) {
      if (value.text.trim() === '') throw new SourceError(`${subject}: a link's letter badge has no letters — write \`icon: "GH"\``, line);
      const icon: LinkIcon = { letters: value.text };
      i += 2;
      if (follows(tokens, i, '(')) {
        const read = readBracket(tokens, i, ['fill', 'text'], {
          subject,
          what: `the badge "${value.text}"`,
          kind: 'a letter badge',
          example: 'fill: #24292f',
          line,
        });
        if (Object.keys(read.values).length === 0) {
          throw new SourceError(`${subject}: the badge "${value.text}" opens empty brackets`, line);
        }
        for (const [color, set] of Object.entries(read.values)) {
          checkColorWord(set, subject, line);
          icon[color as 'fill' | 'text'] = set;
        }
        i = read.next;
      }
      link.icon = icon;
      continue;
    }
    const picture = value.text.replace(/,$/, '');
    i += 2;
    if (follows(tokens, i, '(')) {
      throw new SourceError(
        `${subject}: the picture "${picture}" keeps its own colors, so it takes no bracket — ` +
          `letters do: \`icon: "${picture.slice(0, 2).toUpperCase()}" (fill: …)\``,
        line,
      );
    }
    link.icon = { picture };
  }
  if (Object.keys(link).length === 0) throw new SourceError(`${subject}: ${what} opens empty brackets`, line);
  return { link, next: i + 1 };
}

function follows(tokens: Token[], at: number, word: string): boolean {
  const token = tokens[at];
  return token !== undefined && !token.quoted && token.text === word;
}

/**
 * Could this token open a placement? `top` and `left` open the side alignments,
 * `on` opens an overlay. Used only to tell a forgotten pair of quotes after a
 * node's name from a placement, so a word that is nearly one counts.
 */
function startsPlacement(token: Token, next?: Token): boolean {
  if (token.quoted) return false;
  return (
    // `x even with a`: x and y open a placement only before `even`, so a box named x stays a name.
    (isAxisWord(token.text) && next !== undefined && !next.quoted && next.text === 'even') ||
    isDirection(token.text) ||
    /^-?\d*\.?\d+(px)?$/.test(token.text) ||
    token.text === 'level' ||
    token.text === 'even' ||
    token.text === 'on' ||
    token.text === 'inside' ||
    token.text === 'outside' ||
    (SIDES as readonly string[]).includes(token.text) ||
    isPart(token.text)
  );
}

/** Words someone reaches for to say which way `even with` lines up; the axis goes in front instead. */
const AXIS_ADVERBS = new Set(['vertically', 'horizontally', 'across']);

function axisAdverb(word: string, target: string): string {
  return `"${word}" says nothing here — to line up on one axis, name it in front: \`x even with ${target}\` shares ${target}'s place across, \`y even with ${target}\` its height`;
}

function isAxisWord(word: string): word is Axis {
  return word === 'x' || word === 'y';
}

function isSideWord(word: string): word is Side {
  return word !== 'center' && (SIDES as readonly string[]).includes(word);
}

/**
 * One target, or several joined by `and` — `right of borg and bare`, or
 * `level with borg, bare and media`. A trailing comma separates just as `and`
 * does, so both the way people write lists come out the same.
 *
 * Each name may be followed by a *part* of that node, spaced: `right of hub
 * text`, `inside server right`. See `partAfter` for the two words that are
 * parts everywhere else in the language too, and how they are told apart.
 * `partFirst` is for the placements where a side word after the name can only
 * be the part; see there.
 */
function readTargets(
  tokens: Token[],
  start: number,
  subject: string,
  placement: string,
  line: number,
  partFirst = false,
): { targets: PlacementTarget[]; next: number } {
  const targets: PlacementTarget[] = [];
  let i = start;
  /** The target just closed with a comma, which promises another. */
  let comma: string | undefined;

  for (;;) {
    const token = tokens[i];
    // `right of a, gap: tight`: the comma, not the key, is the mistake, and
    // reading on would take `gap:` as a name and blame the word after it.
    if (comma !== undefined && (!token || isAttrKey(token) || token.text === '(' || token.text === ')')) {
      const next = token ? `, but "${token.joined ?? token.text}" ${isAttrKey(token) ? 'is a key' : 'is not a name'}` : '';
      throw new SourceError(
        `${subject}: the comma after "${comma}" starts another target${next} — remove the comma`,
        line,
      );
    }
    // A key written with its space, as in `right of gap: tight`, is a target
    // left out. One written without, `right of a:b`, is more likely a name with
    // a colon in it, and that gets its own message below.
    if (!token || token.quoted || token.text === '(' || token.text === ')' || (isAttrKey(token) && !token.joined)) {
      throw new SourceError(`${subject}: "${placement}" names no node`, line);
    }
    const read = readOneTarget(tokens, i, subject, line, partFirst);
    targets.push(read.target);
    i = read.next;

    if (follows(tokens, i, 'and')) {
      i += 1;
      continue;
    }
    comma = read.listed ? nameTarget(read.target) : undefined;
    if (read.listed) continue;
    return { targets, next: i };
  }
}

/**
 * One target: a name with its part and how far along, or a point written out
 * (design.org 4.2–4.4). `listed` says it ended on a comma, which promises
 * another.
 */
function readOneTarget(
  tokens: Token[],
  at: number,
  subject: string,
  line: number,
  partFirst = false,
): { target: PlacementTarget; next: number; listed: boolean } {
  const token = tokens[at]!;
  const word = token.quoted ? '' : token.text;

  if (word === 'between') return readBetween(tokens, at, subject, line);

  // `3/4 down x`: a fraction of the way across one box, written first.
  const first = readFraction(tokens, at);
  if (first) {
    const nameToken = tokens[first.next];
    if (!nameToken || nameToken.quoted || isAttrKey(nameToken) || nameToken.text === '(' || nameToken.text === ')') {
      throw new SourceError(`${subject}: "${first.fraction.written}" names no box — write \`${first.fraction.written} <name>\``, line);
    }
    let listed = nameToken.text.endsWith(',') && nameToken.text.length > 1;
    const name = listed ? nameToken.text.slice(0, -1) : nameToken.text;
    let next = first.next + 1;
    const fraction: Fraction = { ...first.fraction, first: true };
    // `1/3 across x from right`: which end it counts from comes after the name.
    if (!listed && fraction.along === 'across' && follows(tokens, next, 'from')) {
      const end = tokens[next + 1];
      const side = end?.text.replace(/,$/, '');
      if (side !== 'left' && side !== 'right') {
        throw new SourceError(`${subject}: "${fraction.written} ${name} from" counts from left or from right`, line);
      }
      fraction.from = side;
      fraction.written += ` from ${side}`;
      listed = end!.text.endsWith(',');
      next += 2;
    }
    refuseFractionPart(tokens, next, fraction, name, subject, line);
    return { target: { name, fraction }, next, listed };
  }

  // `down from a and left from b`: where two straight lines meet.
  if (startsHalf(tokens, at)) {
    return readCrossing(tokens, at, subject, line);
  }

  // `2 below c bottom`: a point moved by a distance.
  if (/^-?\d*\.?\d+(px)?$/.test(word) && tokens[at + 1] && isDirection(tokens[at + 1]!.text)) {
    const direction = tokens[at + 1]!.text as Direction;
    if (word.startsWith('-')) {
      const flipped = OPPOSITE[direction];
      throw new SourceError(
        `${subject}: a distance is never negative — write \`${word.slice(1)} ${flipped}${/left|right/.test(flipped) ? ' of' : ''} …\``,
        line,
      );
    }
    let next = at + 2;
    const takesOf = /left|right/.test(direction);
    const of = follows(tokens, next, 'of');
    if (of !== takesOf) {
      throw new SourceError(
        `${subject}: "${word} ${direction}${of ? ' of' : ''}" is written "${word} ${direction}${takesOf ? ' of' : ''}" — \`${word} ${direction}${takesOf ? ' of' : ''} ${tokens[next + (of ? 1 : 0)]?.text ?? '…'}\``,
        line,
      );
    }
    if (of) next += 1;
    const inner = readOneTarget(tokens, next, subject, line, true);
    if (inner.target.point?.kind === 'moved') {
      throw new SourceError(`${subject}: a point is moved once — add the distances, as in \`${word} ${direction} …\``, line);
    }
    const point: PointExpr = { kind: 'moved', distance: word, direction, from: inner.target };
    return { target: { name: describePoint(point), point }, next: inner.next, listed: inner.listed };
  }

  refuseNameMark(token, `${subject}: "${token.joined ?? token.text}"`, line);
  let listed = token.text.endsWith(',') && token.text.length > 1;
  const name = listed ? token.text.slice(0, -1) : token.text;
  let i = at + 1;

  // A part can only follow a name the author did not already close with a
  // comma — `a, b` is two targets and the comma says so. The part may carry
  // the comma itself: `right of a text, b`.
  let part = listed ? undefined : partAfter(tokens, i, partFirst);
  if (part) {
    i += 1;
  } else if (!listed) {
    part = partBeforeComma(tokens[i]);
    if (part) {
      i += 1;
      listed = true;
    }
  }
  const target: PlacementTarget = part === undefined ? { name } : { name, part };
  if (listed) return { target, next: i, listed };

  // `server 3/4 down`, `server right 3/4 down`: how far along the side.
  const after = readFraction(tokens, i);
  if (after) {
    const fraction = after.fraction;
    i = after.next;
    listed = fraction.written.endsWith(',');
    if (listed) fraction.written = fraction.written.slice(0, -1);
    if (part !== undefined) checkFractionOnPart(fraction, name, part, subject, line);
    return { target: { ...target, fraction }, next: i, listed };
  }
  // `c bottom + 2` adds a length to a point, which doesn't say which way.
  if (follows(tokens, i, '+')) {
    const amount = tokens[i + 1]?.text ?? '2';
    throw new SourceError(
      `${subject}: "+" adds lengths, never points — "${nameTarget(target)} + ${amount}" doesn't say up or down. ` +
        `Move the point with a direction: \`${amount} below ${nameTarget(target)}\``,
      line,
    );
  }
  return { target, next: i, listed };
}

/** What a leg's bracket may set: its own shape, in the words of the line's bracket. */
const LEG_KEYS = ['path', 'turn', 'curve', 'corners', 'step-out'] as const;

/**
 * `via: b top, between c and d (gap: wide), leg climb, leg over b top` — the
 * places a line passes, in order, separated by commas; the list ends at the
 * next key (design.org 6.4).
 */
function readVia(tokens: Token[], start: number, subject: string, line: number): { entries: ViaEntry[]; next: number } {
  const entries: ViaEntry[] = [];
  const ends = (token: Token | undefined): boolean => !token || isAttrKey(token);
  let i = start;
  for (;;) {
    const token = tokens[i];
    if (ends(token) || token!.quoted) {
      throw new SourceError(
        entries.length === 0
          ? `${subject}: via: lists the places the line passes, such as \`via: b top, between c and d\``
          : `${subject}: the comma at the end of via: promises another stop — remove it, or name the stop`,
        line,
      );
    }
    const entry: ViaEntry = {};
    let listed = false;
    if (token!.text === 'leg') {
      const nameToken = tokens[i + 1];
      if (!nameToken || nameToken.quoted || isAttrKey(nameToken) || nameToken.text === '(') {
        throw new SourceError(`${subject}: "leg" in via: is followed by the leg's name, such as \`leg climb\``, line);
      }
      listed = nameToken.text.endsWith(',');
      const name = listed ? nameToken.text.slice(0, -1) : nameToken.text;
      if (name === 'longest') {
        throw new SourceError(`${subject}: a leg can't be named "longest" — a text's \`on: longest level\` already means the line's longest level piece`, line);
      }
      i += 2;
      let attrs: Attrs = {};
      if (!listed && follows(tokens, i, '(')) {
        const read = readBracket(tokens, i, LEG_KEYS, { subject, what: `leg ${name}`, kind: 'a leg', example: 'path: straight', line });
        attrs = read.values;
        i = read.next;
      }
      if (!listed && follows(tokens, i, ',')) {
        listed = true;
        i += 1;
      }
      entry.leg = { name, attrs };
      if (!listed && !ends(tokens[i])) {
        const read = readStop(tokens, i, subject, line);
        entry.stop = read.stop;
        i = read.next;
        listed = read.listed;
      }
    } else {
      const read = readStop(tokens, i, subject, line);
      entry.stop = read.stop;
      i = read.next;
      listed = read.listed;
    }
    entries.push(entry);
    if (!listed) break;
  }
  const after = tokens[i];
  if (after && !isAttrKey(after)) {
    throw new SourceError(
      `${subject}: the stops in via: are separated by commas — "${after.joined ?? after.text}" follows "${describeEntry(entries[entries.length - 1]!)}" with none`,
      line,
    );
  }
  return { entries, next: i };
}

function describeEntry(entry: ViaEntry): string {
  return [entry.leg ? `leg ${entry.leg.name}` : '', entry.stop?.written ?? ''].filter((part) => part.length > 0).join(' ');
}

/** One stop in a `via:` list, and whether a comma after it promises another. */
function readStop(tokens: Token[], start: number, subject: string, line: number): { stop: ViaStop; next: number; listed: boolean } {
  const token = tokens[start]!;
  const word = token.text.replace(/,$/, '');
  const written = (from: number, to: number): string =>
    tokens.slice(from, to).map((t) => t.text).join(' ').replace(/,$/, '').replace(/ \( /g, ' (').replace(/ \)/g, ')');
  const finish = (stop: ViaStop, next: number, listed: boolean): { stop: ViaStop; next: number; listed: boolean } => {
    if (!listed && follows(tokens, next, ',')) return { stop, next: next + 1, listed: true };
    return { stop, next, listed };
  };
  const gapBracket = (at: number): { gap?: string; next: number; listed: boolean } => {
    if (!follows(tokens, at, '(')) return { next: at, listed: false };
    const read = readBracket(tokens, at, ['gap'], { subject, what: 'the stop', kind: 'a stop', example: 'gap: wide', line });
    return { ...(read.values['gap'] !== undefined ? { gap: read.values['gap'] } : {}), next: read.next, listed: false };
  };

  // `through slot horizontal`: from one edge of a region to the other.
  if (word === 'through' && !token.text.endsWith(',')) {
    const region = tokens[start + 1];
    const axisToken = tokens[start + 2];
    const axis = axisToken?.text.replace(/,$/, '');
    if (!region || region.quoted || isAttrKey(region)) {
      throw new SourceError(`${subject}: "through" in via: names a region, such as \`via: through slot horizontal\``, line);
    }
    if (axis !== 'horizontal' && axis !== 'vertical') {
      throw new SourceError(
        `${subject}: "through ${region.text.replace(/,$/, '')}" says which way across it — \`through ${region.text.replace(/,$/, '')} horizontal\` or \`vertical\`; the axis is always written`,
        line,
      );
    }
    return finish(
      { kind: 'through', region: region.text, axis, written: written(start, start + 3) },
      start + 3,
      axisToken!.text.endsWith(','),
    );
  }

  // `above thru (gap: tight)`: the whole length of a named leg, beside it.
  const two = (word === 'left' || word === 'right') && follows(tokens, start + 1, 'of');
  if ((word === 'above' || word === 'below' || two) && !token.text.endsWith(',')) {
    const legToken = tokens[start + (two ? 2 : 1)];
    if (!legToken || legToken.quoted || isAttrKey(legToken)) {
      throw new SourceError(`${subject}: "${word}${two ? ' of' : ''}" in via: names a leg to run beside, such as \`via: above thru\``, line);
    }
    const listedName = legToken.text.endsWith(',');
    const leg = listedName ? legToken.text.slice(0, -1) : legToken.text;
    const next = start + (two ? 3 : 2);
    const bracket = listedName ? { next, listed: false } : gapBracket(next);
    return finish(
      {
        kind: 'alongside',
        way: (two ? `${word} of` : word) as 'above' | 'below' | 'left of' | 'right of',
        leg,
        ...('gap' in bracket && bracket.gap !== undefined ? { gap: bracket.gap } : {}),
        written: written(start, bracket.next),
      },
      bracket.next,
      listedName,
    );
  }

  // `on b top`, `inside p top`: on the side itself, or just inside it.
  let mode: 'outside' | 'on' | 'inside' = 'outside';
  let at = start;
  if (word === 'outside') {
    throw new SourceError(
      `${subject}: "outside" in via: says what via: already means — a part of a box is passed just outside it. Write \`via: ${tokens[start + 1]?.text ?? 'b'} ${tokens[start + 2]?.text ?? 'top'}\``,
      line,
    );
  }
  if ((word === 'on' || word === 'inside') && !token.text.endsWith(',')) {
    mode = word;
    at += 1;
  }
  const read = readOneTarget(tokens, at, subject, line);
  let next = read.next;
  let listed = read.listed;
  const bare = read.target.part === undefined && read.target.fraction === undefined && read.target.point === undefined;
  // `req at 1/3`, `req start`, `req end`: a point on a named line.
  if (bare && !listed && mode === 'outside') {
    if (follows(tokens, next, 'at')) {
      const amount = tokens[next + 1];
      const value = amount ? fractionValue(amount.text.replace(/,$/, '')) : undefined;
      if (value === undefined || value > 1) {
        throw new SourceError(`${subject}: "${read.target.name} at" is followed by how far along, such as \`${read.target.name} at 1/3\``, line);
      }
      return finish(
        { kind: 'online', line: read.target.name, at: value, written: written(start, next + 2) },
        next + 2,
        amount!.text.endsWith(','),
      );
    }
    const end = tokens[next]?.text.replace(/,$/, '');
    if (end === 'start' || end === 'end') {
      return finish(
        { kind: 'online', line: read.target.name, at: end, written: written(start, next + 1) },
        next + 1,
        tokens[next]!.text.endsWith(','),
      );
    }
    // `req b top`: a name, then one of that line's own stops, with no comma
    // between. Only a line can be followed by a stop, so anything else is the
    // missing comma `readVia` reports.
    const after = tokens[next];
    if (after && !after.quoted && !isAttrKey(after) && after.text !== '(' && after.text !== ',') {
      const inner = readOneTarget(tokens, next, subject, line);
      const along = written(next, inner.next);
      return finish(
        { kind: 'online', line: read.target.name, at: 1 / 2, along, written: written(start, inner.next) },
        inner.next,
        inner.listed,
      );
    }
  }
  let gap: string | undefined;
  let order: { way: 'after' | 'before'; name: string } | undefined;
  if (!listed && follows(tokens, next, '(')) {
    // A stop's bracket holds its gap, or, on a bundle, this line's place in its order.
    const read = readBracket(tokens, next, ['gap', 'after', 'before'], { subject, what: 'the stop', kind: 'a stop', example: 'gap: wide', line });
    gap = read.values['gap'];
    const after = read.values['after'];
    const before = read.values['before'];
    if (after !== undefined && before !== undefined) {
      throw new SourceError(`${subject}: "via: ${written(start, read.next)}" says after: and before:, which is this line's place said twice — keep one`, line);
    }
    if (after !== undefined || before !== undefined) order = { way: after !== undefined ? 'after' : 'before', name: (after ?? before)! };
    next = read.next;
  }
  if (mode !== 'outside' && read.target.part === undefined) {
    throw new SourceError(
      `${subject}: "${mode} ${nameTarget(read.target)}" in via: names a part of a box to be ${mode === 'on' ? 'on' : 'just inside'}, such as \`via: ${mode} ${read.target.name} top\``,
      line,
    );
  }
  return finish(
    { kind: 'place', target: read.target, mode, ...(gap !== undefined ? { gap } : {}), ...(order ? { order } : {}), written: written(start, next) },
    next,
    listed,
  );
}

/**
 * `3/4 down`, `1/4 up`, `1/3 across`, `1/3 across from right`, if one starts
 * here. `from` after `across` is taken only when the fraction follows a name;
 * written first, it comes after the name instead.
 */
function readFraction(tokens: Token[], at: number): { fraction: Fraction; next: number } | undefined {
  const token = tokens[at];
  const along = tokens[at + 1];
  if (!token || token.quoted || !along || along.quoted) return undefined;
  const value = fractionValue(token.text);
  const word = along.text.replace(/,$/, '');
  if (value === undefined || (word !== 'down' && word !== 'up' && word !== 'across')) return undefined;
  if (value < 0 || value > 1) return undefined;
  const fraction: Fraction = { value, along: word, written: `${token.text} ${along.text}` };
  let next = at + 2;
  if (word === 'across' && !along.text.endsWith(',') && follows(tokens, next, 'from')) {
    const side = tokens[next + 1]?.text;
    const clean = side?.replace(/,$/, '');
    if (clean === 'left' || clean === 'right') {
      fraction.from = clean;
      fraction.written = `${token.text} across from ${side}`;
      next += 2;
    }
  }
  return { fraction, next };
}

/** `3/4`, `0.75`, `.75`, `1`: a fraction of the way, or undefined. */
function fractionValue(written: string): number | undefined {
  const ratio = /^(\d+)\/(\d+)$/.exec(written);
  if (ratio) return Number(ratio[2]) === 0 ? undefined : Number(ratio[1]) / Number(ratio[2]);
  if (/^\d*\.?\d+$/.test(written)) return Number(written);
  return undefined;
}

/** A fraction runs along one side: `down` and `up` a left or right one, `across` a top or bottom one. */
function checkFractionOnPart(fraction: Fraction, name: string, part: Part, subject: string, line: number): void {
  const along = fraction.along === 'across' ? ['top', 'bottom'] : ['left', 'right'];
  if (along.includes(part)) return;
  const words = part === 'left' || part === 'right' ? 'down or up' : part === 'top' || part === 'bottom' ? 'across' : undefined;
  throw new SourceError(
    words
      ? `${subject}: "${name} ${part} ${fraction.written}" names nothing — ${fraction.along} doesn't run along a ${part} side; it takes ${words}`
      : `${subject}: "${name} ${part} ${fraction.written}" names nothing — ${part} is a point, not a side to go along. Name a side: ${name} left, right, top or bottom`,
    line,
  );
}

/** `3/4 down x top`: a fraction written first names a line through the whole box, so a part after it says nothing. */
function refuseFractionPart(tokens: Token[], at: number, fraction: Fraction, name: string, subject: string, line: number): void {
  const token = tokens[at];
  if (!token || token.quoted || !isPart(token.text.replace(/,$/, ''))) return;
  if (follows(tokens, at + 1, 'of') || follows(tokens, at + 1, 'even') || opensPartPlacement(tokens, at)) return;
  const part = token.text.replace(/,$/, '');
  throw new SourceError(
    `${subject}: "${fraction.written} ${name} ${part}" — a fraction written first is a line across the whole of ${name}. ` +
      `For a spot on one side, write the side first: \`${name} ${isSideWord(part) ? part : 'right'} ${fraction.written}\``,
    line,
  );
}

/**
 * `between a and b`, `between a and b at 1/3`, and as a region
 * `between a and b (span: both)`. Always two things, joined by `and`.
 */
function readBetween(tokens: Token[], at: number, subject: string, line: number): { target: PlacementTarget; next: number; listed: boolean } {
  const first = tokens[at + 1];
  if (!first || first.quoted || isAttrKey(first) || first.text === '(') {
    throw new SourceError(`${subject}: "between" names two things — \`between a and b\``, line);
  }
  if (first.text.endsWith(',')) {
    const second = tokens[at + 2]?.text ?? 'b';
    throw new SourceError(
      `${subject}: "between" joins its two things with "and" — write \`between ${first.text.slice(0, -1)} and ${second.replace(/,$/, '')}\``,
      line,
    );
  }
  const a = readOneTarget(tokens, at + 1, subject, line, true);
  if (a.listed) {
    throw new SourceError(
      `${subject}: "between" joins its two things with "and" — write \`between ${nameTarget(a.target)} and …\``,
      line,
    );
  }
  if (a.target.point) throw new SourceError(`${subject}: "between" joins two named things, not "${nameTarget(a.target)}"`, line);
  if (!follows(tokens, a.next, 'and') || !tokens[a.next + 1]) {
    throw new SourceError(`${subject}: "between ${nameTarget(a.target)}" names one thing — \`between ${nameTarget(a.target)} and …\``, line);
  }
  const b = readOneTarget(tokens, a.next + 1, subject, line, true);
  if (b.target.point) throw new SourceError(`${subject}: "between" joins two named things, not "${nameTarget(b.target)}"`, line);
  // An `and` after the pair starts the next target of the placement, as after any other.
  let next = b.next;
  let listed = b.listed;
  const point: PointExpr = { kind: 'between', a: a.target, b: b.target };
  if (!listed && follows(tokens, next, 'at')) {
    const written = tokens[next + 1]?.text.replace(/,$/, '') ?? '';
    const value = fractionValue(written);
    if (value === undefined || value < 0 || value > 1) {
      throw new SourceError(`${subject}: "between … at" takes a fraction of the way from the first, such as at 1/3 — not "${written}"`, line);
    }
    point.at = value;
    point.atWritten = written;
    listed = tokens[next + 1]!.text.endsWith(',');
    next += 2;
  }
  if (!listed && follows(tokens, next, '(') && tokens[next + 1]?.text === 'span:') {
    const value = tokens[next + 2]?.text;
    if (value !== 'both' || !follows(tokens, next + 3, ')')) {
      throw new SourceError(`${subject}: a region between two things takes (span: both) — not (span: ${value ?? ''})`, line);
    }
    point.span = 'both';
    next += 4;
  }
  return { target: { name: describePoint(point), point }, next, listed };
}

/** Whether a half of a point from two things starts here: `down from a`, or `even with a`. */
function startsHalf(tokens: Token[], at: number): boolean {
  const word = tokens[at];
  if (!word || word.quoted) return false;
  if ((WAYS as readonly string[]).includes(word.text)) return follows(tokens, at + 1, 'from');
  return word.text === 'even' && follows(tokens, at + 1, 'with');
}

/** One half of a point from two things, as written. */
function writtenHalf(half: { way: Way | 'even'; target: PlacementTarget }): string {
  return `${half.way === 'even' ? 'even with' : `${half.way} from`} ${nameTarget(half.target)}`;
}

/**
 * `down from a and left from b`, each line from a thing, one of its parts or
 * a point; `even with a` is the level line through a, in either half.
 */
function readCrossing(tokens: Token[], at: number, subject: string, line: number): { target: PlacementTarget; next: number; listed: boolean } {
  const first = readWay(tokens, at, subject, line);
  if (first.listed || !follows(tokens, first.next, 'and') || !startsHalf(tokens, first.next + 1)) {
    const other = first.way === 'up' || first.way === 'down' ? 'left from …' : 'down from …';
    throw new SourceError(
      `${subject}: "${writtenHalf(first)}" is one line, and a point is where two meet — ` +
        `add the other, as in \`${writtenHalf(first)} and ${other}\``,
      line,
    );
  }
  const second = readWay(tokens, first.next + 1, subject, line);
  const vertical = (way: Way | 'even') => way === 'up' || way === 'down';
  if (vertical(first.way) === vertical(second.way)) {
    throw new SourceError(
      `${subject}: "${writtenHalf(first)} and ${writtenHalf(second)}" are two ` +
        `${vertical(first.way) ? 'up-and-down' : 'level'} lines, which never meet at one point — make one of them ` +
        `${vertical(first.way) ? 'left or right, or even with something' : 'up or down'}`,
      line,
    );
  }
  const point: PointExpr = {
    kind: 'from',
    lines: [
      { way: first.way, target: first.target },
      { way: second.way, target: second.target },
    ],
  };
  return { target: { name: describePoint(point), point }, next: second.next, listed: second.listed };
}

function readWay(
  tokens: Token[],
  at: number,
  subject: string,
  line: number,
): { way: Way | 'even'; target: PlacementTarget; next: number; listed: boolean } {
  if (!startsHalf(tokens, at)) {
    throw new SourceError(`${subject}: a point from two things reads \`down from a and left from b\``, line);
  }
  const way = tokens[at]!.text === 'even' ? 'even' : (tokens[at]!.text as Way);
  const words = way === 'even' ? 'even with' : `${way} from`;
  const target = tokens[at + 2];
  if (!target || target.quoted || isAttrKey(target)) {
    throw new SourceError(`${subject}: "${words}" names no thing`, line);
  }
  const read = readOneTarget(tokens, at + 2, subject, line, true);
  // Anything that names a place will do, but not another point from two
  // things, whose own "and" would make the pair unreadable.
  if (read.target.point?.kind === 'from') {
    throw new SourceError(
      `${subject}: "${words}" starts from a point from two things — name that point first (\`point p  ${nameTarget(read.target)}\`) and write \`${words} p\``,
      line,
    );
  }
  return { way, target: read.target, next: read.next, listed: read.listed };
}

/**
 * The part word after a target's name, if there is one.
 *
 * Two of the part words are also the openings of something else, and both are
 * settled by the word that follows rather than by a reservation:
 *
 * - `right of hub right of mirror` — a side followed by `of` is the *direction*
 *   opening the next placement, which is how `left` and `right` have always
 *   been told apart.
 * - `right of hub top level with mirror` — a side followed by `level` is the
 *   alignment opening the next placement, the same lookahead `readPlacement`
 *   makes for `top even with`.
 *
 * The second does not hold after `inside`, `outside` or `on`, so `partFirst`
 * lifts it there: `inside server right level with server.db` is the right side
 * and then an alignment. `inside` and `outside` need a part, so a partless
 * reading is an error anyway; and `on` already fixes both axes, so an edge
 * alignment after a partless `on hub` would contradict it.
 */
/** A part word closed with a comma, `text,`, which ends this target and promises another. */
function partBeforeComma(token: Token | undefined): Part | undefined {
  if (!token || token.quoted || !token.text.endsWith(',')) return undefined;
  const word = token.text.slice(0, -1);
  return isPart(word) ? word : undefined;
}

function partAfter(tokens: Token[], at: number, partFirst = false): Part | undefined {
  const token = tokens[at];
  if (!token || token.quoted || !isPart(token.text)) return undefined;
  if (follows(tokens, at + 1, 'of')) return undefined;
  // `right of a  top even with b` is this box's top lined up; only a side word
  // can open that, so `right of a text  even with b` keeps `text` as a's.
  if (!partFirst && isSideWord(token.text) && follows(tokens, at + 1, 'even')) return undefined;
  // `right of a  center 12 right of b center`: a part followed by a distance
  // and a direction opens the next placement, one measured from this box's part.
  if (opensPartPlacement(tokens, at)) return undefined;
  return token.text;
}

/** Whether a part word here opens `center 12 right of …` rather than naming the part of a target before it. */
function opensPartPlacement(tokens: Token[], at: number): boolean {
  const distance = tokens[at + 1];
  const direction = tokens[at + 2];
  return (
    distance !== undefined &&
    !distance.quoted &&
    /^-?\d*\.?\d+(px)?$/.test(distance.text) &&
    direction !== undefined &&
    !direction.quoted &&
    isDirection(direction.text)
  );
}
