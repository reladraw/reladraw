/**
 * The shape a source file parses into. Nothing here knows about geometry —
 * these types are a faithful record of what the author wrote, and no more.
 */

export const DIRECTIONS = [
  'above',
  'below',
  'left',
  'right',
  'above-left',
  'above-right',
  'below-left',
  'below-right',
] as const;

export type Direction = (typeof DIRECTIONS)[number];

export function isDirection(word: string): word is Direction {
  return (DIRECTIONS as readonly string[]).includes(word);
}

export type Axis = 'x' | 'y';

/**
 * Which side of the target a `level with` shares. `center` is the plain form;
 * the rest are written in front of it, as in `top level with media`.
 */
export const SIDES = ['center', 'top', 'bottom', 'left', 'right'] as const;

export type Side = (typeof SIDES)[number];

/** A side belongs to one axis, so an alignment never has to say which. */
export const SIDE_AXIS: Record<Side, Axis> = {
  center: 'y',
  top: 'y',
  bottom: 'y',
  left: 'x',
  right: 'x',
};

/**
 * The nine points of a box anybody can name without measuring: the four
 * corners, the four side midpoints, and the centre. One closed set, accepted
 * everywhere the language has a position — which is the rule that replaced a
 * scatter of one-position slots, each decided on its own and each a little
 * piece of the same expressiveness loss.
 *
 * Closed-and-meaningful is allowed where open-and-ordinal is not: these are
 * words a reader decodes, and a diagram written in them still moves correctly
 * when a box moves, which is the property the refusal of `x: 140` protects.
 *
 * A compound position is hyphenated and is one token, matching the diagonal
 * directions above. A *phrase* of separate keywords stays spaced (`level
 * with`); a compound *word* does not.
 *
 * Every midpoint carries `-center` rather than standing alone as `top` or
 * `left`. Two reasons, and the second is the binding one. A side midpoint reads
 * as "the bottom edge, centred along it", which is what the word says. And
 * `top`, `bottom`, `left` and `right` already name a *side* in this language —
 * an edge's `from:` and an alignment's `top level with` — so a bare `bottom`
 * would mean a side in one place and a point in another. `from: bottom` spreads
 * attachments along the side; `from: bottom-center` will pin one to the point.
 */
export const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  'center',
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export type Position = (typeof POSITIONS)[number];

export function isPosition(word: string): word is Position {
  return (POSITIONS as readonly string[]).includes(word);
}

/**
 * Naming more than one target places the node against the box that just bounds
 * them all — `right of borg and bare` clears both. It is a single target that
 * nobody had to declare, which is why it is a list on one placement rather than
 * several placements: two separate `level with` statements are two demands that
 * fight, while one naming two targets is a single demand about one region.
 */
export type Targets = string[];

/**
 * `right of docker` — the node sits a gap beyond one of the target's sides.
 * A direction rules out part of an axis rather than fixing a point, which is
 * what lets two of them bracket a node between two targets.
 */
export interface OffsetPlacement {
  kind: 'offset';
  direction: Direction;
  targets: Targets;
  /**
   * The gap this one placement asks for, from `(gap: wide)` written after the
   * targets. A gap describes a relationship rather than a box, so this is its
   * proper home; `gap:` on the node remains the default for every placement
   * that does not say. Absent means take the node's.
   */
  gap?: string;
  line: number;
}

/** `level with docker` — share a side or a center line, with no gap in between. */
export interface AlignPlacement {
  kind: 'align';
  axis: Axis;
  side: Side;
  targets: Targets;
  line: number;
}

/**
 * `on hub at top-right` — the node is held on the target's box at one of the
 * nine named positions, inset from that corner or edge, overlapping it by
 * construction.
 *
 * The word is `on` rather than `in` because the language already has a word for
 * inside: the dotted name. `server.docs` is a child — padded, widening its
 * container, a member of its constraint system. An overlay is none of those. It
 * is stamped on the box regardless of what the box holds.
 *
 * One target only, unlike the other two. An overlay names an exact position on
 * a box, and the box that bounds two things is not a box anybody drew.
 */
export interface OnPlacement {
  kind: 'on';
  position: Position;
  targets: Targets;
  /**
   * How far in from the named corner or edge, as a named gap, from `(gap: none)`
   * written after the target. Absent means `tight`.
   *
   * Deliberately not the node's own `gap:`, which says how this node stands off
   * its neighbours. An inset is a statement about one pair and is written on the
   * placement or not at all.
   */
  gap?: string;
  line: number;
}

/**
 * One thing the author said about where a node goes. A node carries as many as
 * it needs; the resolver intersects them.
 */
export type Placement = OffsetPlacement | AlignPlacement | OnPlacement;

/**
 * The modifiers a placement understands, in brackets after its targets. Refused
 * by name when unrecognized, for the reason `DIAGRAM_KEYS` are: a modifier that
 * silently does nothing looks like a bug in the tool rather than a typo.
 */
export const PLACEMENT_KEYS = ['gap'] as const;

/** How a placement reads back in the author's own words, for error messages. */
export function describePlacement(placement: Placement): string {
  const targets = listTargets(placement.targets);
  if (placement.kind === 'on') {
    const gap = placement.gap === undefined ? '' : ` (gap: ${placement.gap})`;
    return `on ${targets} at ${placement.position}${gap}`;
  }
  if (placement.kind === 'align') {
    const side = placement.side === 'center' ? '' : `${placement.side} `;
    return `${side}level with ${targets}`;
  }
  // "left of X" and "above X" are both good English; "above of X" is not.
  const joiner =
    placement.direction === 'above' || placement.direction === 'below' ? '' : 'of ';
  const gap = placement.gap === undefined ? '' : ` (gap: ${placement.gap})`;
  return `${placement.direction} ${joiner}${targets}${gap}`;
}

/** "borg", "borg and bare", "borg, bare and media" — as the author would write them. */
export function listTargets(targets: Targets): string {
  if (targets.length <= 1) return targets[0] ?? '';
  return `${targets.slice(0, -1).join(', ')} and ${targets[targets.length - 1]}`;
}

/**
 * `between desktop1 and laptop1` on an edge — the gap it passes through.
 *
 * This is not a claim about the whole line. It binds only the stretch where the
 * line is actually passing the pair, and says nothing about where it goes
 * before or after.
 */
export interface Passage {
  /** Exactly two, because a gap has two sides. */
  targets: Targets;
  /**
   * Which of the two gaps was meant, for a pair that is apart on both axes.
   * Absent whenever the pair leaves only one possibility, which is most of the
   * time — the word is a tie-break, not part of the statement.
   */
  axis?: Axis;
}

/** How the axis of a passage is written, and what it means. */
export const PASSAGE_AXES: Record<string, Axis> = {
  // The gap you measure with a vertical ruler: one target above, one below. A
  // line running along it therefore travels horizontally, which is the reading
  // to watch out for — the word describes the gap, not the direction of travel.
  vertically: 'y',
  horizontally: 'x',
};

/** `vertically` or `horizontally`, from the axis it binds. */
export function describeAxis(axis: Axis): string {
  return axis === 'y' ? 'vertically' : 'horizontally';
}

/** `key: value` pairs trailing a statement. Values are always strings here. */
export type Attrs = Record<string, string>;

/**
 * What a text's brackets may say: `"Docker" (at: bottom-center, color: muted)`.
 *
 * They are bracketed onto the text rather than written among the node's
 * attributes for the same reason a gap is bracketed onto its placement — they
 * modify that one thing, and the brackets make the scope visible instead of
 * positional. What is left at the top level is then about the node itself:
 * `shape`, `icon`, `fill`, `border`, `gap`, `overlap`, `style`.
 *
 * In a style, which has no string for a bracket to hang off, the bracket hangs
 * off the key instead: `style synced  text: (color: muted)`.
 *
 * `at` and `align` are independent and neither implies the other. `at` is where
 * the block of text sits in the node — one of the nine named positions — and
 * `align` is how its lines range against each other once it is there.
 */
export const TEXT_KEYS = ['color', 'size', 'wrap', 'align', 'at'] as const;

export interface NodeStmt {
  kind: 'node';
  name: string;
  text: string;
  /**
   * Whether that text was written, or is the name standing in for it. A node
   * drawn as a picture takes no such default — see `buildTree` — and only this
   * flag can tell `node cube_a` from `node cube_a "cube_a"`.
   */
  statedText: boolean;
  /** The text's bracketed modifiers, as written. Usually empty. */
  textAttrs: Attrs;
  /** Everything the author said about where this goes. Empty for the anchor. */
  placements: Placement[];
  attrs: Attrs;
  line: number;
}

export interface EdgeStmt {
  kind: 'edge';
  from: string;
  to: string;
  /** `<->` rather than `->`. */
  both: boolean;
  text?: string;
  /** The text's bracketed modifiers, as written. Usually empty. */
  textAttrs: Attrs;
  /** `between desktop1 and laptop1` — the gap the line passes through. */
  between?: Passage;
  attrs: Attrs;
  line: number;
}

export interface DeckStmt {
  kind: 'deck';
  /** The container to draw with offset copies behind it. */
  name: string;
  /** One text per copy, back to front as written. */
  texts: string[];
  line: number;
}

/**
 * `diagram background: #111111` — settings that belong to the drawing as a
 * whole rather than to anything in it. It has no name because there is only
 * ever one diagram per file.
 */
export interface DiagramStmt {
  kind: 'diagram';
  attrs: Attrs;
  line: number;
}

/** The attributes a `diagram` statement understands. */
export const DIAGRAM_KEYS = ['background'] as const;

/**
 * The attributes whose value is a color rather than text. A color is written
 * as the viewer will receive it and the renderer keeps no list of color words
 * of its own, so there is nothing to check a value *against* — but quoting is
 * the author saying "this is text", and an unquoted value cannot hold a space,
 * so prose has to be quoted to get in at all. Refusing a quoted color is
 * therefore the whole of what can be checked here, and it happens to be the
 * mistake people actually make: `subtext: "medium-fine"` reads as the text
 * that goes underneath, and was accepted and dropped in silence.
 */
export const COLOR_KEYS = [
  'fill',
  'border',
  'line',
  'background',
] as const;

/**
 * A color attribute names the *part* it colors, and a part exists only on the
 * kinds that have one. A node has a border and text; a note and a glyph body are
 * text and nothing else; an edge is a line and its text.
 *
 * This table is what makes the words checkable. `border:` on a note is refused
 * by name rather than ignored — the same rule as an unknown `diagram` key, and
 * for the same reason: an attribute that silently does nothing looks like the
 * tool being broken.
 *
 * Each entry is written the way the author would write it, since the text's is
 * a bracket rather than a bare key, and this list is only ever quoted back.
 *
 * A style spanning kinds writes one key per kind — `border: #d2904e  line:
 * #d2904e` — since a style contributes a part only to the kinds that have it.
 * That is what replaced `stroke:`, which named no part and so could never be
 * wrong, and which is why a node's text had no word of its own until now.
 */
export const COLOR_PARTS: Record<Kind, readonly string[]> = {
  shape: ['fill:', 'border:', 'text: (color: …)'],
  icon: ['text: (color: …)'],
  none: ['text: (color: …)'],
  edge: ['line:', 'text: (color: …)'],
};

/**
 * The four things an attribute can be written on. Three of them are nodes, and
 * which one a node is, is what its body says: `shape:` draws an outline,
 * `icon:` draws a picture, and `shape: none` draws neither. None of the three
 * is a statement keyword — a node is a node — but each takes a different set of
 * attributes, which is what makes it a kind here.
 */
export type Kind = 'shape' | 'icon' | 'none' | 'edge';

/**
 * Every attribute each kind understands. An attribute a kind has no use for is
 * refused by name rather than dropped, the same rule as an unknown `diagram`
 * key, a `PLACEMENT_KEYS` modifier or a color part — and for the same reason,
 * which the color parts only closed one level down: a key that silently does
 * nothing looks like the tool being broken rather than like a typo.
 *
 * The color entries repeat `COLOR_PARTS` and must agree with it. They are
 * written out rather than spliced in because this table is the answer to "what
 * may I write here", and a reader of it should not have to assemble the list
 * from two places.
 *
 * The exclusions are the whole of what this table decides, and each is a place
 * the old silence hid something:
 *
 * - A node drawn as a picture, or with no body at all, takes no `fill:` or
 *   `border:`. There is no outline for either to reach.
 * - Neither of those takes `align:` either, which widens a node's children, and
 *   neither may have any.
 * - `shape:` and `icon:` each name the body, so each appears only on the kind it
 *   makes. `shape:` is on `none` as well, because `shape: none` is how that kind
 *   is written in the first place.
 * - An edge takes no `gap:` or `overlap:`. Those are about where a box sits, and
 *   an edge is not placed — it joins two things that are.
 */
export const ATTR_KEYS: Record<Kind, readonly string[]> = {
  shape: ['style', 'gap', 'overlap', 'align', 'badge', 'shape', 'fill', 'border', 'text'],
  icon: ['style', 'gap', 'overlap', 'badge', 'icon', 'text'],
  none: ['style', 'gap', 'overlap', 'badge', 'shape', 'text'],
  edge: ['style', 'from', 'to', 'line', 'text'],
};

/**
 * Every word that is an attribute *somewhere*, which is what separates a
 * misspelling from a key written on the wrong kind of thing. The two deserve
 * different errors: one has no remedy but the spelling, the other has a real
 * meaning somewhere else in the file.
 *
 * `DIAGRAM_KEYS` is in here so that `background:` on a node is understood to be
 * a real word in the wrong place — that mistake wants to be pointed at `fill:`,
 * not told the word does not exist.
 */
export const ALL_ATTR_KEYS: readonly string[] = [
  ...new Set([...Object.values(ATTR_KEYS).flat(), ...DIAGRAM_KEYS]),
];

export interface StyleStmt {
  kind: 'style';
  name: string;
  attrs: Attrs;
  line: number;
}

export type Stmt = NodeStmt | EdgeStmt | DeckStmt | StyleStmt | DiagramStmt;

export interface Document {
  statements: Stmt[];
}
