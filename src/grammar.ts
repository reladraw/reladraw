/**
 * The language's *lexical* vocabulary, and a scanner that classifies one line of
 * source into colored spans.
 *
 * This is deliberately separate from `parser.ts`, and it is not a second parser.
 * The parser answers "what does this file mean" and refuses anything it cannot
 * answer for; a highlighter has to color a half-typed line without complaint,
 * so it answers only "what kind of word is this" and never fails. Every rule
 * below is a regex applied to a single line, in priority order, with one bit of
 * carried state (whether anything has been seen on the line yet, and whether the
 * previous token was an attribute key).
 *
 * **That restriction is the point, and it is what makes this reusable.** An
 * Emacs `font-lock-keywords` list, a Vim `syntax match` file and a TextMate
 * grammar are all exactly this: an ordered list of single-line regexes with a
 * face attached. So the vocabulary here — which is the half that goes stale, and
 * which is imported from `ast.ts`, `constants.ts` and `icons.ts` rather than
 * retyped — can be emitted into any of those without this file being ported.
 * The scanner is the JavaScript consumer of the same spec, and the playground is
 * its only caller.
 *
 * No token spans lines: `//` runs to the end of one, a string closes on one,
 * and there are no blocks. A statement may continue onto indented lines, but
 * each of those is colored by the same rules, and a word that is a keyword at
 * the start of one is refused by the parser anyway. That is the property those
 * editor formats need and the reason a `.reladraw` grammar is small in all of
 * them.
 */

import { DEFAULT_TARGETS, DIRECTIONS, MARKS, PARTS, POINT_TEXT_SIDES, POSITIONS, SIDES } from './ast.js';

/** What a span of source is, for coloring. */
export type TokenKind =
  /** `// to the end of the line` */
  | 'comment'
  /** A quoted string, quotes included. Unterminated ones count, so typing is quiet. */
  | 'string'
  /** A markup tag inside a text: `[dim]` and `[/dim]`. */
  | 'markup'
  /** The word a statement opens with: `node`, `edge`, … */
  | 'keyword'
  /** The name a statement declares, right after its keyword. */
  | 'name'
  /** `->`, `<-`, `<->`, and `--` or `-` for a plain line. */
  | 'arrow'
  /** Placement and line vocabulary: `right`, `of`, `even`, `with`, `and`, `between`, `via`'s stops, … */
  | 'relation'
  /** A `key:` opening an attribute or a bracketed modifier. */
  | 'attribute'
  /** The single word an attribute takes. */
  | 'value'
  /** `#14532d`, wherever it appears. */
  | 'color'
  /** `(` and `)` around a placement's or a text's modifiers. */
  | 'bracket'
  /** Everything else: node names being referred to, and whitespace. */
  | 'plain';

export interface Span {
  kind: TokenKind;
  /** Half-open, in characters, into the line it came from. */
  start: number;
  end: number;
}

/**
 * The words a statement may open with. `parseStatement` in `parser.ts` is the
 * authority — its switch is what actually accepts them — and this list mirrors
 * it. A word missing here is a word that draws in the plain color, which is a
 * dull page rather than a wrong one.
 */
export const STATEMENT_KEYWORDS = ['node', 'edge', 'style', 'diagram', 'default', 'icon', 'description', 'url', 'point', 'region', 'bundle', 'guide'] as const;

/** Statements whose second word declares a name. `diagram` has none. */
const DECLARES_NAME = ['node', 'style', 'icon', 'point', 'region', 'bundle', 'url'];

/**
 * Keywords that take another after them: `guide region channel`, `default
 * leaf`, `default guide edge`. The words that may follow are the kinds a
 * default is written for, so `leaf` and `container` color as keywords there.
 */
const LEADS = ['guide', 'default'];
const FOLLOWERS = [...new Set(DEFAULT_TARGETS.flatMap((target) => target.split(' ')))];

/**
 * Every word that says something about where a thing goes. Assembled from the
 * lists the parser itself reads, so a direction or a passage axis added there
 * colors here without anybody remembering to come back.
 */
export const RELATION_WORDS: string[] = [
  ...DIRECTIONS,
  ...SIDES,
  ...POSITIONS,
  // `tall text`, `server top-left`: the part of a node a placement names.
  ...PARTS,
  ...POINT_TEXT_SIDES,
  // The connecting words. `of` is optional after a direction, `and` joins
  // targets, `between` names the point between two things, `even with` is the
  // alignment, and `on ... at ...` is the overlay. Note `of` and `at` are what
  // tell the two position vocabularies apart: a direction is always followed
  // by `of`, a named position always preceded by `at`.
  'of',
  'at',
  'on',
  'and',
  'even',
  'with',
  'between',
  // Points (design.org 4): a fraction of the way, a point from two things,
  // a region's corners.
  'down',
  'up',
  'across',
  'from',
  'to',
  // `(inside top)`, `outside router right`, `via: inside p top`.
  'inside',
  'outside',
  // `stays above laptop.photos`, a limit (design.org 5.6).
  'stays',
  // Lines (design.org 6): `straight down from z3`, `each child of pool`,
  // `leg climb`, `via: through slot horizontal`.
  'straight',
  'each',
  'child',
  'leg',
  'through',
  'horizontal',
  'vertical',
  // A line's text (design.org 7.3): `(left of edge)`, `(on: longest level)`.
  // `edge` here is the line the text belongs to; at the start of a line it is
  // still the keyword, since the keyword is matched first.
  'edge',
  'level',
];

/** Longest first, so `above-left` is not read as `above` followed by `-left`. */
function alternation(words: readonly string[]): string {
  return [...new Set(words)].sort((a, b) => b.length - a.length).join('|');
}

/**
 * The patterns, as source strings, so a generator can emit them into another
 * editor's grammar without reaching into a compiled RegExp. Each is written to
 * match at the point the scanner has reached; the scanner adds the sticky flag.
 *
 * A name may contain dots (containment) and hyphens, which is why the word
 * pattern is what it is rather than `\w+`.
 */
/** One end of an arrow: a mark word or glyph, bare or bracketed. Words first, so `odot` is not `o`. */
const MARK_WORD = `(?:${[...MARKS].sort((a, b) => b.length - a.length).join('|')}|<\\||\\|>|[<>*o|])`;
const ARROW_MARK = `(?:\\[${MARK_WORD}\\]|\\(${MARK_WORD}\\)|${MARK_WORD})`;

export const PATTERNS = {
  comment: '\\/\\/.*',
  // The closing quote is optional: every string is unterminated for as long as
  // it is being typed, and a highlighter that waits for the quote repaints the
  // rest of the file on every keystroke.
  string: '"(?:\\\\.|[^"\\\\])*"?',
  // Not before a colon: `icon` is a keyword and `icon:` an attribute, and an
  // indented line may open with the attribute.
  keyword: `(?:${alternation(STATEMENT_KEYWORDS)})\\b(?!:)`,
  // A mark, one or two dashes, a mark — `->`, `o--odiamond`, `[dot]-`. It must
  // end the token, so a hyphenated name stays a word. A mark written apart in
  // brackets, `[dot] -- [arrow]`, colors as plain words either side of `--`.
  arrow: `${ARROW_MARK}?-{1,2}${ARROW_MARK}?(?=[ \\t]|$)`,
  attribute: '[A-Za-z][A-Za-z0-9_-]*:',
  color: '#[0-9A-Fa-f]{3,8}\\b',
  relation: `(?:${alternation(RELATION_WORDS)})\\b`,
  bracket: '[()]',
  /**
   * A markup tag, which appears only inside a string. An editor grammar that
   * scopes patterns should apply this one inside the string scope; the scanner
   * below does the same thing by splitting a matched string span.
   *
   * The escape is `\[`, and this pattern deliberately does not exclude it —
   * doing so needs a lookbehind, which several grammar formats lack, and a
   * wrongly-colored escaped bracket is a much smaller wrong than a highlighter
   * that cannot be ported.
   */
  markup: '\\[\\/?[A-Za-z][A-Za-z0-9_-]*\\]',
  // Matches what `tokenizeLine` treats as one bare token, and the awkwardness is
  // load-bearing rather than accidental. A `(` counts as punctuation only where
  // a token starts, so `rgb(20,20,20)` is one word — hence the first character
  // being spelled differently from the rest. A lone `/` is ordinary and only a
  // doubled one opens a comment, which is what the lookahead is for.
  word: '(?:[^\\s()"\\/]|\\/(?!\\/))(?:[^\\s"\\/]|\\/(?!\\/))*',
  /**
   * The same, inside an open bracket, where `)` closes the group instead of
   * being an ordinary character. An editor grammar that cannot count brackets
   * should use this one throughout: mistaking `rgb(20,20,20)` for three tokens
   * is a smaller wrong than swallowing the `)` that ends `(gap: tight)`.
   */
  wordInGroup: '(?:[^\\s()"\\/]|\\/(?!\\/))(?:[^\\s)"\\/]|\\/(?!\\/))*',
} as const;

/**
 * The rules that are pure regex, in priority order. Three things are missing and
 * each for a reason: a comment wins over all of them and is tried first, a
 * bracket is punctuation only at certain depths so the scanner counts them
 * itself, and the catch-all word rule varies with that same depth and is
 * appended per call.
 */
const RULES: Array<{ kind: TokenKind; re: RegExp }> = [
  { kind: 'string', re: sticky(PATTERNS.string) },
  { kind: 'arrow', re: sticky(PATTERNS.arrow) },
  // Before `relation`, because the trailing colon is what tells `left: …` from
  // the `left` of a placement, and after `arrow` so `->` is never a word.
  { kind: 'attribute', re: sticky(PATTERNS.attribute) },
  { kind: 'color', re: sticky(PATTERNS.color) },
  { kind: 'relation', re: sticky(PATTERNS.relation) },
];

const SPACE = sticky('[ \\t]+');
const COMMENT = sticky(PATTERNS.comment);
const KEYWORD = sticky(PATTERNS.keyword);
const WORD = sticky(PATTERNS.word);
const WORD_IN_GROUP = sticky(PATTERNS.wordInGroup);
const ARROW = new RegExp(`^${PATTERNS.arrow}$`);

/** Whether a whole word is an arrow, as the parser's `looksLikeArrow` asks. */
function isArrow(word: string): boolean {
  return ARROW.test(word);
}

function sticky(source: string): RegExp {
  return new RegExp(source, 'y');
}

function match(re: RegExp, line: string, at: number): string | null {
  re.lastIndex = at;
  const found = re.exec(line);
  return found ? found[0] : null;
}

/**
 * Classify one line. Always returns spans covering it end to end, in order, so a
 * caller can rebuild the text by concatenation and can trust that nothing was
 * dropped — which is what a highlighter drawn *behind* a textarea needs, since
 * a lost character would slide every following one out of register.
 */
export function highlightLine(line: string): Span[] {
  const spans: Span[] = [];
  let at = 0;
  /** Nothing but whitespace seen yet, so the next word is the statement keyword. */
  let opening = true;
  /** The last thing emitted was a `key:`, so the next word is its value. */
  let expectingValue = false;
  /** How many brackets are open, which is what makes a `)` punctuation. */
  let depth = 0;

  const push = (kind: TokenKind, end: number) => {
    spans.push({ kind, start: at, end });
    at = end;
  };

  while (at < line.length) {
    const gap = match(SPACE, line, at);
    if (gap !== null) {
      push('plain', at + gap.length);
      continue;
    }

    // A comment wins everywhere, including in the middle of a statement.
    const comment = match(COMMENT, line, at);
    if (comment !== null) {
      push('comment', at + comment.length);
      continue;
    }

    if (opening) {
      opening = false;
      let keyword = match(KEYWORD, line, at);
      if (keyword !== null) {
        push('keyword', at + keyword.length);
        // `default guide edge` leads twice, so this loops.
        while (LEADS.includes(keyword)) {
          const space = match(SPACE, line, at);
          if (space === null) break;
          const next = match(WORD, line, at + space.length);
          if (next === null || !FOLLOWERS.includes(next)) break;
          push('plain', at + space.length);
          push('keyword', at + next.length);
          keyword = next;
        }
        if (keyword === 'description') {
          // `description notes """…"""` declares a name; `description for a, b`
          // names things declared elsewhere, so `for` colors as a keyword.
          const space = match(SPACE, line, at);
          if (space !== null) {
            push('plain', at + space.length);
            const word = match(WORD, line, at);
            if (word === 'for') push('keyword', at + word.length);
            else if (word !== null && !word.endsWith(':')) push('name', at + word.length);
          }
        } else if (DECLARES_NAME.includes(keyword)) {
          const space = match(SPACE, line, at);
          if (space !== null) {
            push('plain', at + space.length);
            const name = match(WORD, line, at);
            // `style backup  border: …` declares a name; `node  fill: red` is a
            // half-typed line whose second word is already an attribute, and
            // coloring that as a name would be a lie about what it is.
            if (name !== null && !name.endsWith(':')) push('name', at + name.length);
          }
        } else if (keyword === 'edge') {
          // `edge req client -> api`: a word before the ends names the line,
          // told apart by the arrow coming third rather than second, which is
          // the parser's own test.
          const head = /^([ \t]+)([^\s"]+)[ \t]+([^\s"]+)[ \t]+(\S+)/.exec(line.slice(at));
          if (head && !isArrow(head[3]!) && isArrow(head[4]!) && !RELATION_WORDS.includes(head[2]!)) {
            push('plain', at + head[1]!.length);
            push('name', at + head[2]!.length);
          }
        }
        continue;
      }
    }

    // Brackets before the rest, and only where they are really punctuation: an
    // opening one wherever a token starts, a closing one only while a group is
    // open. That is `tokenizeLine`'s rule, and it is what keeps an unquoted
    // `rgb(20,20,20)` a single word rather than three.
    const ch = line[at]!;
    if (ch === '(') {
      depth += 1;
      expectingValue = false;
      push('bracket', at + 1);
      continue;
    }
    if (ch === ')' && depth > 0) {
      depth -= 1;
      expectingValue = false;
      push('bracket', at + 1);
      continue;
    }

    let matched = false;
    for (const rule of [...RULES, { kind: 'plain' as TokenKind, re: depth > 0 ? WORD_IN_GROUP : WORD }]) {
      const text = match(rule.re, line, at);
      if (text === null) continue;
      // An attribute's value is whatever single token follows it, whatever it
      // would otherwise have been called: `to: right` is a value, not a
      // direction, and `style: wide` is a style name, not a gap.
      const kind =
        expectingValue && rule.kind !== 'string' && rule.kind !== 'color' && rule.kind !== 'bracket'
          ? 'value'
          : rule.kind;
      expectingValue = rule.kind === 'attribute';
      // A string is the one span with something inside it: markup naming a
      // style. The spans still cover the line exactly, which is what a
      // highlighter drawn behind a textarea needs.
      if (rule.kind === 'string') {
        for (const part of splitMarkup(text, at)) push(part.kind, part.end);
      } else {
        push(kind, at + text.length);
      }
      matched = true;
      break;
    }
    // Nothing in `RULES` can fail on a non-space character, but a scanner that
    // could loop forever is not worth the saved line.
    if (!matched) push('plain', at + 1);
  }

  return spans;
}

/**
 * One string span cut into the plain stretches and the markup tags inside it.
 * An escaped bracket is left to be colored as a tag when it looks like one,
 * which is the wrong the pattern's doc comment accepts in exchange for being
 * portable.
 */
function splitMarkup(text: string, from: number): Array<{ kind: TokenKind; end: number }> {
  const parts: Array<{ kind: TokenKind; end: number }> = [];
  const tag = new RegExp(PATTERNS.markup, 'g');
  let at = 0;
  for (let found = tag.exec(text); found !== null; found = tag.exec(text)) {
    if (found.index > at) parts.push({ kind: 'string', end: from + found.index });
    parts.push({ kind: 'markup', end: from + found.index + found[0].length });
    at = found.index + found[0].length;
  }
  if (at < text.length || parts.length === 0) parts.push({ kind: 'string', end: from + text.length });
  return parts;
}

/** Every line of a source file, classified. Line endings are not included. */
export function highlight(source: string): Span[][] {
  return source.split(/\r?\n/).map(highlightLine);
}
