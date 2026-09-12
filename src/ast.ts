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
 * Which edge of the target a `level with` shares. `center` is the plain form;
 * the rest are written in front of it, as in `top level with media`.
 */
export const EDGES = ['center', 'top', 'bottom', 'left', 'right'] as const;

export type Edge = (typeof EDGES)[number];

/** An edge belongs to one axis, so an alignment never has to say which. */
export const EDGE_AXIS: Record<Edge, Axis> = {
  center: 'y',
  top: 'y',
  bottom: 'y',
  left: 'x',
  right: 'x',
};

/**
 * Naming more than one target places the node against the box that just bounds
 * them all — `right of borg and bare` clears both. It is a single target that
 * nobody had to declare, which is why it is a list on one placement rather than
 * several placements: two separate `level with` statements are two demands that
 * fight, while one naming two targets is a single demand about one region.
 */
export type Targets = string[];

/**
 * `right of docker` — the node sits a gap beyond one of the target's edges.
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

/** `level with docker` — share an edge or a center line, with no gap in between. */
export interface AlignPlacement {
  kind: 'align';
  axis: Axis;
  edge: Edge;
  targets: Targets;
  line: number;
}

/**
 * One thing the author said about where a node goes. A node carries as many as
 * it needs; the resolver intersects them.
 */
export type Placement = OffsetPlacement | AlignPlacement;

/**
 * The modifiers a placement understands, in brackets after its targets. Refused
 * by name when unrecognized, for the reason `DIAGRAM_KEYS` are: a modifier that
 * silently does nothing looks like a bug in the tool rather than a typo.
 */
export const PLACEMENT_KEYS = ['gap'] as const;

/** How a placement reads back in the author's own words, for error messages. */
export function describePlacement(placement: Placement): string {
  const targets = listTargets(placement.targets);
  if (placement.kind === 'align') {
    const edge = placement.edge === 'center' ? '' : `${placement.edge} `;
    return `${edge}level with ${targets}`;
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
 * `between desktop1 and laptop1` on a link — the gap it passes through.
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
 * What a label's brackets may say: `"Docker" (at: bottom, align: center)`.
 *
 * They are bracketed onto the label rather than written among the node's
 * attributes for the same reason a gap is bracketed onto its placement — they
 * modify that one thing, and the brackets make the scope visible instead of
 * positional. `at` and `align` are independent: neither implies the other, and a
 * label at the bottom is an ordinary label that happens to be at the bottom.
 */
export const LABEL_KEYS = ['at', 'align'] as const;

export interface BoxStmt {
  kind: 'box';
  name: string;
  text: string;
  /** The label's bracketed modifiers, as written. Usually empty. */
  label: Attrs;
  /** Everything the author said about where this goes. Empty for the anchor. */
  placements: Placement[];
  attrs: Attrs;
  line: number;
}

export interface LinkStmt {
  kind: 'link';
  from: string;
  to: string;
  /** `<->` rather than `->`. */
  both: boolean;
  label?: string;
  /** `between desktop1 and laptop1` — the gap the line passes through. */
  between?: Passage;
  attrs: Attrs;
  line: number;
}

export interface NoteStmt {
  kind: 'note';
  name: string;
  text: string;
  /** Everything the author said about where this goes. Empty for the anchor. */
  placements: Placement[];
  attrs: Attrs;
  line: number;
}

export interface DeckStmt {
  kind: 'deck';
  /** The container to draw with offset copies behind it. */
  name: string;
  /** One label per copy, back to front as written. */
  labels: string[];
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
  'text',
  'line',
  'subtext',
  'background',
] as const;

/**
 * A color attribute names the *part* it colors, and a part exists only on the
 * kinds that have one. A box has a border and text; a note and a glyph body are
 * text and nothing else; a link is a line and its label.
 *
 * This table is what makes the words checkable. `border:` on a note is refused
 * by name rather than ignored — the same rule as an unknown `diagram` key, and
 * for the same reason: an attribute that silently does nothing looks like the
 * tool being broken.
 *
 * A style spanning kinds writes one key per kind — `border: #d2904e  line:
 * #d2904e` — since a style contributes a part only to the kinds that have it.
 * That is what replaced `stroke:`, which named no part and so could never be
 * wrong, and which is why a box's text had no word of its own until now.
 */
export const COLOR_PARTS: Record<Kind, readonly string[]> = {
  box: ['fill', 'border', 'text', 'subtext'],
  note: ['text'],
  glyph: ['text', 'subtext'],
  link: ['line', 'text'],
};

/**
 * The four things an attribute can be written on. A glyph is a node whose
 * `shape:` names an icon, so it is not a statement keyword — but it takes a
 * different set of attributes from an ordinary box, which is what makes it a
 * kind here.
 */
export type Kind = 'box' | 'note' | 'glyph' | 'link';

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
 * Three of the exclusions are the whole of what this table decides, and each is
 * a place the old silence hid something:
 *
 * - A glyph takes no `icon:`. It is drawn *as* a picture and has no box for a
 *   second one to sit in; `sizeNode` returns before it would ever be read.
 * - A glyph and a note take no `align:`, which widens a node's children, and
 *   neither may have any.
 * - A link takes no `gap:` or `overlap:`. Those are about where a box sits, and
 *   a link is not placed — it joins two things that are.
 */
export const ATTR_KEYS: Record<Kind, readonly string[]> = {
  box: [
    'style',
    'size',
    'gap',
    'overlap',
    'align',
    'wrap',
    'icon',
    'shape',
    'fill',
    'border',
    'text',
    'subtext',
  ],
  note: ['style', 'size', 'gap', 'overlap', 'wrap', 'text'],
  glyph: ['style', 'size', 'gap', 'overlap', 'wrap', 'shape', 'text', 'subtext'],
  link: ['style', 'size', 'from', 'to', 'line', 'text'],
};

/**
 * Every word that is an attribute *somewhere*, which is what separates a
 * misspelling from a key written on the wrong kind of thing. The two deserve
 * different errors: one has no remedy but the spelling, the other has a real
 * meaning somewhere else in the file.
 *
 * `DIAGRAM_KEYS` is in here so that `background:` on a box is understood to be
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

export type Stmt = BoxStmt | LinkStmt | NoteStmt | DeckStmt | StyleStmt | DiagramStmt;

export interface Document {
  statements: Stmt[];
}
