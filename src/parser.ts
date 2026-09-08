import type {
  Attrs,
  BoxStmt,
  Edge,
  Placement,
  DeckStmt,
  DiagramStmt,
  Document,
  LinkStmt,
  NoteStmt,
  Passage,
  Stmt,
  StyleStmt,
} from './ast.js';
import {
  DIAGRAM_KEYS,
  EDGE_AXIS,
  EDGES,
  PASSAGE_AXES,
  LABEL_KEYS,
  PLACEMENT_KEYS,
  isDirection,
  listTargets,
} from './ast.js';
import { SourceError } from './errors.js';
import { isAttrKey, tokenizeLine, type Token } from './lexer.js';

/** Parse a whole source file. One statement per line; blanks and comments drop out. */
export function parse(source: string): Document {
  const statements: Stmt[] = [];

  source.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const tokens = tokenizeLine(line, lineNumber);
    if (tokens.length === 0) return;
    statements.push(parseStatement(tokens, lineNumber));
  });

  return { statements };
}

function parseStatement(tokens: Token[], line: number): Stmt {
  const split = attributesBegin(tokens);
  const head = split === -1 ? tokens : tokens.slice(0, split);
  const attrs = split === -1 ? {} : parseAttrs(tokens.slice(split), line);

  const keyword = head[0];
  if (!keyword || keyword.quoted) {
    throw new SourceError('a statement must begin with a keyword', line);
  }

  switch (keyword.text) {
    case 'box':
      return parseBox(head, attrs, line);
    case 'note':
      return parseNote(head, attrs, line);
    case 'link':
      return parseLink(head, attrs, line);
    case 'deck':
      return parseDeck(head, line);
    case 'style':
      return parseStyle(head, attrs, line);
    case 'diagram':
      return parseDiagram(head, attrs, line);
    default:
      throw new SourceError(`unknown statement "${keyword.text}"`, line);
  }
}

/**
 * Where the node's own attributes start: the first `key:` outside any brackets.
 * A placement's modifiers are `key: value` too, so a plain search for the first
 * attribute key would cut the head in the middle of `left of hub (gap: wide)`.
 */
function attributesBegin(tokens: Token[]): number {
  let depth = 0;
  for (const [at, token] of tokens.entries()) {
    if (token.quoted) continue;
    if (token.text === '(') depth += 1;
    else if (token.text === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && isAttrKey(token)) return at;
  }
  return -1;
}

function parseAttrs(tokens: Token[], line: number): Attrs {
  const attrs: Attrs = {};
  let i = 0;
  while (i < tokens.length) {
    const keyToken = tokens[i]!;
    if (!isAttrKey(keyToken)) {
      // Attributes end the positional part of a statement, so a placement
      // written after one is a real mistake with an obvious remedy. Saying what
      // the parser expected describes its own state; say what to move instead.
      if (startsPlacement(keyToken)) {
        throw new SourceError(
          `"${keyToken.text}" starts a placement, and placements come before the attributes — move it in front of the first "key: value"`,
          line,
        );
      }
      throw new SourceError(
        `expected an attribute like "key: value", found "${keyToken.text}"`,
        line,
      );
    }
    const key = keyToken.text.slice(0, -1);
    const valueToken = tokens[i + 1];
    if (!valueToken) throw new SourceError(`attribute "${key}" has no value`, line);
    if (isAttrKey(valueToken)) {
      throw new SourceError(`attribute "${key}" has no value`, line);
    }
    attrs[key] = valueToken.text;
    i += 2;
  }
  return attrs;
}

/**
 * `box <name> ["<text>"] [(<label modifiers>)] [<placement> ...]`
 *
 * The text is optional and the name stands in for it, because a bare `box a`
 * asking for an empty rectangle is a default nobody wants: the first lines
 * anybody types are `box a` and `box b right of a`, and they mean the two
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
 * the price, and it is honest: a file that states no label is saying the name
 * is the label.
 */
function parseBox(head: Token[], attrs: Attrs, line: number): BoxStmt {
  const name = requireName(head[1], 'box', line);
  const written = head[2];
  const textToken = written?.quoted ? written : undefined;
  // A bare word here is a label somebody forgot to quote far more often than
  // it is anything else, and `"Parser" is not a direction` would send them
  // looking in the wrong place.
  if (written && !textToken && !isAttrKey(written) && !startsPlacement(written) && written.text !== '(') {
    throw new SourceError(
      `box "${name}": a label is quoted — write "${written.text}" rather than ${written.text}`,
      line,
    );
  }
  const text = textToken ? textToken.text : name.slice(name.lastIndexOf('.') + 1);
  const subject = `box "${name}"`;
  const label = readBracket(head, textToken ? 3 : 2, LABEL_KEYS, {
    subject,
    what: 'the label',
    kind: 'a label',
    example: 'at: bottom',
    line,
  });
  const placements = parsePlacements(head.slice(label.next), line, subject);
  return { kind: 'box', name, text, label: label.values, placements, attrs, line };
}

/** `note <name> "<text>" [<placement> ...]` */
function parseNote(head: Token[], attrs: Attrs, line: number): NoteStmt {
  const name = requireName(head[1], 'note', line);
  const textToken = head[2];
  if (!textToken || !textToken.quoted) {
    throw new SourceError(`note "${name}" needs quoted text`, line);
  }
  // A note is bare text with no box, so it has no band for a label to sit in
  // and nowhere for `at:` to put one. Refused by name rather than ignored.
  if (follows(head, 3, '(')) {
    throw new SourceError(
      `note "${name}" carries label modifiers. A note is bare text, so there is no box for its label to sit anywhere in`,
      line,
    );
  }
  const placements = parsePlacements(head.slice(3), line, `note "${name}"`);
  return { kind: 'note', name, text: textToken.text, placements, attrs, line };
}

/**
 * `link <from> -> <to> ["<label>"] [between <a> and <b>]`, or `<->` for a
 * two-headed arrow.
 */
function parseLink(head: Token[], attrs: Attrs, line: number): LinkStmt {
  const from = requireName(head[1], 'link', line);
  const arrow = head[2];
  if (!arrow || arrow.quoted || (arrow.text !== '->' && arrow.text !== '<->')) {
    throw new SourceError('a link needs "->" or "<->" between its endpoints', line);
  }
  const toToken = head[3];
  if (!toToken || toToken.quoted) {
    throw new SourceError('a link needs a node on the right of the arrow', line);
  }

  let at = 4;
  const labelToken = head[at]?.quoted ? head[at] : undefined;
  if (labelToken) at += 1;

  // A gap has two sides, so `between` takes exactly two targets rather than the
  // open list a placement takes. `right of a and b` means "clear of both", and
  // there is no matching reading of "pass between three things".
  let between: Passage | undefined;
  if (at < head.length) {
    const word = head[at]!;
    if (word.quoted || word.text !== 'between') {
      throw new SourceError(`unexpected "${word.text}" after the link`, line);
    }
    const read = readTargets(head, at + 1, 'link', 'between', line);
    if (read.targets.length !== 2) {
      throw new SourceError(
        `"between" takes two nodes, one for each side of the gap — found ${read.targets.length}`,
        line,
      );
    }
    at = read.next;

    // Two targets sitting diagonally have two gaps between them, and this is
    // the only way to say which. It is optional because most pairs have one.
    const trailing = head[at];
    const axis =
      trailing && !trailing.quoted ? PASSAGE_AXES[trailing.text] : undefined;
    if (axis !== undefined) at += 1;

    between = { targets: read.targets, ...(axis !== undefined ? { axis } : {}) };
  }
  if (at < head.length) {
    throw new SourceError(`unexpected "${head[at]!.text}" after the link`, line);
  }

  return {
    kind: 'link',
    from,
    to: toToken.text,
    both: arrow.text === '<->',
    ...(labelToken ? { label: labelToken.text } : {}),
    ...(between ? { between } : {}),
    attrs,
    line,
  };
}

/** `deck <name> "<label>" ["<label>" ...]` */
function parseDeck(head: Token[], line: number): DeckStmt {
  const name = requireName(head[1], 'deck', line);
  const labels: string[] = [];
  for (const token of head.slice(2)) {
    if (!token.quoted) {
      throw new SourceError(`deck "${name}" takes quoted labels only`, line);
    }
    labels.push(token.text);
  }
  if (labels.length === 0) {
    throw new SourceError(`deck "${name}" needs at least one label`, line);
  }
  return { kind: 'deck', name, labels, line };
}

/** `style <name> <attributes>` */
function parseStyle(head: Token[], attrs: Attrs, line: number): StyleStmt {
  const name = requireName(head[1], 'style', line);
  if (head.length > 2) {
    throw new SourceError(`unexpected "${head[2]!.text}" after style name`, line);
  }
  if (Object.keys(attrs).length === 0) {
    throw new SourceError(`style "${name}" sets nothing`, line);
  }
  return { kind: 'style', name, attrs, line };
}

/**
 * `diagram <attributes>` — no name, because a file holds one diagram. Unknown
 * keys are refused rather than ignored: a misspelt diagram-wide setting that
 * silently does nothing is the kind of thing an author stares at for a while.
 */
function parseDiagram(head: Token[], attrs: Attrs, line: number): DiagramStmt {
  if (head.length > 1) {
    throw new SourceError(`unexpected "${head[1]!.text}" after diagram`, line);
  }
  if (Object.keys(attrs).length === 0) {
    throw new SourceError('diagram sets nothing', line);
  }
  for (const key of Object.keys(attrs)) {
    if (!(DIAGRAM_KEYS as readonly string[]).includes(key)) {
      throw new SourceError(
        `diagram has no "${key}" — it takes ${DIAGRAM_KEYS.join(', ')}`,
        line,
      );
    }
  }
  return { kind: 'diagram', attrs, line };
}

function requireName(token: Token | undefined, keyword: string, line: number): string {
  if (!token || token.quoted) {
    throw new SourceError(`${keyword} needs a name`, line);
  }
  return token.text;
}

/**
 * Read however many placements the author wrote. Each is a direction and a target
 * (`right of docker`, `below deploy`) or an alignment (`level with docker`).
 * None at all is fine — that node is the anchor.
 *
 * `of` is optional after every direction. "left of X" and "below X" are both
 * good English and "below of X" is not, so the word is accepted wherever it
 * helps and never demanded. Shorthands added later — chaining targets with
 * `and`, say — extend this loop without disturbing what it already reads.
 */
function parsePlacements(tokens: Token[], line: number, subject: string): Placement[] {
  const placements: Placement[] = [];
  let i = 0;

  while (i < tokens.length) {
    const word = tokens[i]!;
    if (word.quoted) {
      throw new SourceError(`${subject}: unexpected text "${word.text}"`, line);
    }

    // `top level with media` names an edge rather than the centre line. `left`
    // and `right` are edges as well as directions, so it is the word after them
    // that says which was meant — "left of bup_hd" against "left level with bup_hd".
    const edge = isEdgeWord(word.text) && follows(tokens, i + 1, 'level') ? word.text : undefined;
    const head = edge ? tokens[i + 1]! : word;

    if (head.text === 'level' && !head.quoted) {
      const at = edge ? i + 1 : i;
      const written = edge ? `${edge} level with` : 'level with';
      if (!follows(tokens, at + 1, 'with')) {
        throw new SourceError(`${subject}: an alignment reads "${written} <node>"`, line);
      }
      const read = readTargets(tokens, at + 2, subject, written, line);
      const modifiers = readModifiers(tokens, read.next, subject, written, line);
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
      placements.push({
        kind: 'align',
        axis: EDGE_AXIS[edge ?? 'centre'],
        edge: edge ?? 'centre',
        targets: read.targets,
        line,
      });
      i = modifiers.next;
      continue;
    }

    if (!isDirection(word.text)) {
      throw new SourceError(`${subject}: "${word.text}" is not a direction`, line);
    }
    let next = i + 1;
    if (follows(tokens, next, 'of')) next += 1;
    const read = readTargets(tokens, next, subject, word.text, line);
    const modifiers = readModifiers(tokens, read.next, subject, word.text, line);
    placements.push({
      kind: 'offset',
      direction: word.text,
      targets: read.targets,
      ...(modifiers.gap !== undefined ? { gap: modifiers.gap } : {}),
      line,
    });
    i = modifiers.next;
  }

  return placements;
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
 * label's. Both exist for the same reason — a modifier belongs to the clause it
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
  about: { subject: string; what: string; kind: string; example: string; line: number },
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
      throw new SourceError(`${about.kind} has no "${key}" — it takes ${keys.join(', ')}`, about.line);
    }
    const valueToken = tokens[i + 1];
    if (!valueToken || valueToken.quoted || isAttrKey(valueToken) || valueToken.text === ')') {
      throw new SourceError(`${about.subject}: "${key}" has no value`, about.line);
    }
    // A comma between modifiers is punctuation, exactly as it is between the
    // targets of a placement. `(at: bottom, align: centre)` and the same without
    // the comma are the same statement.
    const value = valueToken.text;
    values[key] = value.endsWith(',') && value.length > 1 ? value.slice(0, -1) : value;
    i += 2;
  }

  return { values, next: i + 1 };
}

function follows(tokens: Token[], at: number, word: string): boolean {
  const token = tokens[at];
  return token !== undefined && !token.quoted && token.text === word;
}

/** Could this token open a placement? `top` and `left` open the edge alignments. */
function startsPlacement(token: Token): boolean {
  if (token.quoted) return false;
  return (
    isDirection(token.text) ||
    token.text === 'level' ||
    (EDGES as readonly string[]).includes(token.text)
  );
}

function isEdgeWord(word: string): word is Edge {
  return word !== 'centre' && (EDGES as readonly string[]).includes(word);
}

/**
 * One target, or several joined by `and` — `right of borg and bare`, or
 * `level with borg, bare and media`. A trailing comma separates just as `and`
 * does, so both the way people write lists come out the same.
 */
function readTargets(
  tokens: Token[],
  start: number,
  subject: string,
  placement: string,
  line: number,
): { targets: string[]; next: number } {
  const targets: string[] = [];
  let i = start;

  for (;;) {
    const token = tokens[i];
    if (!token || token.quoted || token.text === '(' || token.text === ')') {
      throw new SourceError(`${subject}: "${placement}" names no node`, line);
    }
    const listed = token.text.endsWith(',') && token.text.length > 1;
    targets.push(listed ? token.text.slice(0, -1) : token.text);
    i += 1;

    if (follows(tokens, i, 'and')) {
      i += 1;
      continue;
    }
    if (listed) continue;
    return { targets, next: i };
  }
}
