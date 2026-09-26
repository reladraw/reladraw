import type {
  Attrs,
  NodeStmt,
  Side,
  Placement,
  DiagramStmt,
  Document,
  EdgeStmt,
  Part,
  Passage,
  PlacementTarget,
  Stmt,
  StyleStmt,
} from './ast.js';
import {
  COLOR_KEYS,
  DIAGRAM_KEYS,
  DIRECTIONS,
  describePlacement,
  POSITIONS,
  SIDE_AXIS,
  SIDES,
  PASSAGE_AXES,
  TEXT_KEYS,
  CONTENTS_KEYS,
  PLACEMENT_KEYS,
  BOUNDARY_PARTS,
  INWARD,
  OPPOSITE,
  isDirection,
  isPart,
  isPosition,
  listTargets,
  nameTarget,
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
  const keyword = tokens[0];
  if (!keyword || keyword.quoted) {
    throw new SourceError('a statement must begin with a keyword', line);
  }

  switch (keyword.text) {
    case 'node':
      return parseNode(tokens, line);
    case 'edge':
      return parseEdge(tokens, line);
    case 'style':
      return parseStyle(tokens, line);
    case 'diagram':
      return parseDiagram(tokens, line);
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
  // A statement until 0.4.0. It created nothing, only said more about a node
  // declared elsewhere, which is what an attribute on that node is for.
  if (word === 'deck') {
    const name = head[1] && !head[1].quoted ? head[1].text : '<name>';
    const texts = head.slice(2).map((token) => (token.quoted ? quoteOf(token.text) : token.text));
    return `reladraw has no \`deck\` statement — a deck is an attribute of the node, so write ` +
      `\`deck: ${texts.length > 0 ? texts.join(' ') : '"…"'}\` on \`node ${name}\``;
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
};

/** How each bracketed key's error quotes itself back, and what it is about. */
const BRACKET_ABOUT: Record<string, { kind: string; example: string }> = {
  text: { kind: 'a text', example: 'color: muted' },
  contents: { kind: 'a `contents:` bracket', example: 'widths: match' },
};

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
  const key = keyToken.text.slice(0, -1);
  const bracketKeys = BRACKET_KEYS[key];
  if (bracketKeys !== undefined && follows(tokens, at + 1, '(')) {
    // `text: (color: muted)` — the whole bracket belongs to one part, and it is
    // stored under dotted keys so that a style merges into a node exactly the
    // way every other attribute does.
    const read = readBracket(tokens, at + 1, bracketKeys, {
      subject,
      what: `\`${key}:\``,
      kind: BRACKET_ABOUT[key]!.kind,
      example: BRACKET_ABOUT[key]!.example,
      line,
    });
    if (Object.keys(read.values).length === 0) {
      throw new SourceError(`${subject}: \`${key}:\` opens empty brackets`, line);
    }
    // Two brackets for one part are fine as long as they say different things;
    // the same property in both is the same defect as `fill:` written twice.
    for (const [inner, value] of Object.entries(read.values)) {
      setOnce(attrs, `${key}.${inner}`, value, subject, line, { key: `${key}: (${inner}: …)`, value: (v) => v });
    }
    return read.next;
  }
  if (key === 'url') {
    // `url: https://example.com` loses everything from the `//` onwards, because
    // `//` opens a comment — so the value is either missing entirely or is the
    // bare scheme, which reads as another attribute key. Neither report says
    // what is wrong, and the remedy is punctuation rather than a missing word.
    const value = tokens[at + 1];
    if (!value || !value.quoted) {
      throw new SourceError(
        `${subject}: a url is written in quotes — \`url: "https://example.com"\`. Without them ` +
          'everything from the `//` onwards is read as a comment',
        line,
      );
    }
    setOnce(attrs, key, value.text, subject, line, { key, value: quoteOf });
    return at + 2;
  }
  if (key === 'deck') {
    // One quoted text per copy behind the node, back to front, as many as are
    // written. Stored joined on a line break, which no source line can hold.
    const texts: string[] = [];
    let next = at + 1;
    while (tokens[next]?.quoted) texts.push(tokens[next++]!.text);
    if (texts.length === 0) {
      const given = tokens[next];
      throw new SourceError(
        `${subject}: \`deck:\` takes one quoted text per copy behind the node, as in \`deck: "Drive 2" "Drive 3"\`` +
          (given && !isAttrKey(given) ? `, not \`deck: ${given.text}\`` : ''),
        line,
      );
    }
    setOnce(attrs, key, texts.join('\n'), subject, line, {
      key,
      value: (v) => v.split('\n').map(quoteOf).join(' '),
    });
    return next;
  }
  if (bracketKeys !== undefined && key !== 'text') {
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
  if (key === 'width') {
    // Renamed 2026-09-09, and moved into the text's bracket in 0.3.0.
    throw new SourceError(
      '`width:` is now `wrap:` and belongs to the text — it folds the text every n characters and says nothing about how wide anything is, so write it as `"…" (wrap: 30)`',
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
      '`subtext:` has been replaced by markup in the text — write `style dim  text: (color: muted)` ' +
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
  if (key === 'align' && valueToken.text === 'widths') {
    // Removed in 0.3.0. It was a size operation wearing an alignment's name,
    // and its value set had one member — a flag in a property's clothes. Its
    // job is `contents: (widths: match)`, and with it gone `align` means one
    // thing everywhere.
    throw new SourceError(
      '`align: widths` is now `contents: (widths: match)` — it is a size, not an alignment, and ' +
        'the same brackets take `align: center` for where the contents sit when the title is wider',
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

/** Everything a text takes, less the one word that needs a box to sit in. */
const EDGE_TEXT_KEYS = TEXT_KEYS.filter((key) => key !== 'at');

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
  if (written && !textToken && !isAttrKey(written) && !startsPlacement(written) && written.text !== '(') {
    throw new SourceError(
      `node "${name}": a text is quoted — write "${written.text}" rather than ${written.text}`,
      line,
    );
  }
  const text = textToken ? textToken.text : name.slice(name.lastIndexOf('.') + 1);
  const subject = `node "${name}"`;
  const bracket = readBracket(head, textToken ? 3 : 2, TEXT_KEYS, {
    subject,
    what: 'the text',
    kind: 'a text',
    example: 'at: bottom',
    line,
  });
  const tail = parseTail(head, bracket.next, line, subject);
  refuseTextKey(tail.attrs, subject, 'after the name', line);
  return {
    kind: 'node',
    name,
    text,
    statedText: textToken !== undefined,
    textAttrs: bracket.values,
    placements: tail.placements,
    attrs: tail.attrs,
    line,
  };
}

/**
 * `edge <from> -> <to> ["<text>"] [between <a> and <b>]`, with `<->` for a
 * two-headed arrow and `<-` for one pointing the other way.
 *
 * `a <- b` is exactly `b -> a` and carries no meaning of its own downstream.
 * What it buys is the ordering: the name written first is the one the line is
 * about, and plenty of edges have the target as their subject.
 */
const ARROWS = ['->', '<->', '<-'];

function parseEdge(head: Token[], line: number): EdgeStmt {
  const left = requireName(head[1], 'edge', line);
  const arrow = head[2];
  if (!arrow || arrow.quoted || !ARROWS.includes(arrow.text)) {
    throw new SourceError('an edge needs "->", "<-" or "<->" between its endpoints', line);
  }
  const rightToken = head[3];
  if (!rightToken || rightToken.quoted) {
    throw new SourceError('an edge needs a node on the right of the arrow', line);
  }
  const back = arrow.text === '<-';

  let at = 4;
  const textToken = head[at]?.quoted ? head[at] : undefined;
  if (textToken) at += 1;

  const subject = `edge ${left} ${arrow.text} ${rightToken.text}`;
  // An edge's text takes the same bracket a node's does, less `at:`: a node's
  // text sits somewhere in a box and an edge's rides at the middle of its line,
  // so there is no position to name until a diagram asks for one.
  const bracket = readBracket(head, at, EDGE_TEXT_KEYS, {
    subject,
    what: 'the text',
    kind: "an edge's text",
    example: 'color: muted',
    line,
  });
  at = bracket.next;
  let between: Passage | undefined;

  // An edge is not placed, so its tail holds attributes and the one clause that
  // is neither: `between`, which says which gap the line travels down.
  const tail = parseTail(head, at, line, subject, (tokens, index) => {
    const word = tokens[index]!;
    if (word.quoted || word.text !== 'between') return undefined;
    if (between) throw new SourceError(`${subject}: "between" is written twice`, line);

    // A gap has two sides, so `between` takes exactly two targets rather than
    // the open list a placement takes. `right of a and b` means "clear of
    // both", and there is no matching reading of "pass between three things".
    const read = readTargets(tokens, index + 1, subject, 'between', line);
    if (read.targets.length !== 2) {
      throw new SourceError(
        `"between" takes two nodes, one for each side of the gap — found ${read.targets.length}`,
        line,
      );
    }
    let next = read.next;

    // Two targets sitting diagonally have two gaps between them, and this is
    // the only way to say which. It is optional because most pairs have one.
    const trailing = tokens[next];
    const axis = trailing && !trailing.quoted ? PASSAGE_AXES[trailing.text] : undefined;
    if (axis !== undefined) next += 1;

    between = { targets: read.targets, ...(axis !== undefined ? { axis } : {}) };
    return next;
  });

  if (tail.placements.length > 0) {
    throw new SourceError(
      `${subject}: "${describePlacement(tail.placements[0]!)}" places a node, and an edge is not ` +
        'placed — it joins two things that are',
      line,
    );
  }

  refuseTextKey(tail.attrs, subject, 'after the arrow', line);

  return {
    kind: 'edge',
    textAttrs: bracket.values,
    from: back ? rightToken.text : left,
    to: back ? left : rightToken.text,
    both: arrow.text === '<->',
    ...(textToken ? { text: textToken.text } : {}),
    ...(between ? { between } : {}),
    attrs: tail.attrs,
    line,
  };
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
): { placement: Placement; next: number } {
  const word = tokens[at]!;
  if (word.quoted) {
    throw new SourceError(`${subject}: unexpected text "${word.text}"`, line);
  }

  if (word.text === 'on') return readOn(tokens, at, line, subject);
  if (word.text === 'inside' || word.text === 'outside') {
    return readTucked(tokens, at, line, subject, word.text);
  }

  // `top level with media` names a side rather than the center line. `left`
  // and `right` are sides as well as directions, so it is the word after them
  // that says which was meant — "left of drive" against "left level with drive".
  const side = isSideWord(word.text) && follows(tokens, at + 1, 'level') ? word.text : undefined;
  const head = side ? tokens[at + 1]! : word;

  if (head.text === 'level' && !head.quoted) {
    const from = side ? at + 1 : at;
    const written = side ? `${side} level with` : 'level with';
    if (!follows(tokens, from + 1, 'with')) {
      throw new SourceError(`${subject}: an alignment reads "${written} <node>"`, line);
    }
    const read = readTargets(tokens, from + 2, subject, written, line);
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
        axis: SIDE_AXIS[side ?? 'center'],
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
    throw new SourceError(`${subject}: "${word.text}" is not a direction`, line);
  }
  let next = at + 1;
  const of = follows(tokens, next, 'of');
  if (of) next += 1;
  const read = readTargets(tokens, next, subject, word.text, line);
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
    // targets of a placement. `(at: bottom, align: center)` and the same without
    // the comma are the same statement.
    const value = valueToken.text;
    const clean = value.endsWith(',') && value.length > 1 ? value.slice(0, -1) : value;
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

function follows(tokens: Token[], at: number, word: string): boolean {
  const token = tokens[at];
  return token !== undefined && !token.quoted && token.text === word;
}

/**
 * Could this token open a placement? `top` and `left` open the side alignments,
 * `on` opens an overlay. Used only to tell a forgotten pair of quotes after a
 * node's name from a placement, so a word that is nearly one counts.
 */
function startsPlacement(token: Token): boolean {
  if (token.quoted) return false;
  return (
    isDirection(token.text) ||
    token.text === 'level' ||
    token.text === 'on' ||
    token.text === 'inside' ||
    token.text === 'outside' ||
    (SIDES as readonly string[]).includes(token.text)
  );
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

  for (;;) {
    const token = tokens[i];
    if (!token || token.quoted || token.text === '(' || token.text === ')') {
      throw new SourceError(`${subject}: "${placement}" names no node`, line);
    }
    const listed = token.text.endsWith(',') && token.text.length > 1;
    const name = listed ? token.text.slice(0, -1) : token.text;
    i += 1;

    // A part can only follow a name the author did not already close with a
    // comma — `a, b` is two targets and the comma says so.
    const part = listed ? undefined : partAfter(tokens, i, partFirst);
    if (part) i += 1;
    targets.push(part === undefined ? { name } : { name, part });

    if (follows(tokens, i, 'and')) {
      i += 1;
      continue;
    }
    if (listed) continue;
    return { targets, next: i };
  }
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
 *   makes for `top level with`.
 *
 * The second does not hold after `inside`, `outside` or `on`, so `partFirst`
 * lifts it there: `inside server right level with server.db` is the right side
 * and then an alignment. `inside` and `outside` need a part, so a partless
 * reading is an error anyway; and `on` already fixes both axes, so an edge
 * alignment after a partless `on hub` would contradict it.
 */
function partAfter(tokens: Token[], at: number, partFirst = false): Part | undefined {
  const token = tokens[at];
  if (!token || token.quoted || !isPart(token.text)) return undefined;
  if (follows(tokens, at + 1, 'of')) return undefined;
  if (!partFirst && follows(tokens, at + 1, 'level')) return undefined;
  return token.text;
}
