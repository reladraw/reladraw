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
 * `between computer1 and computer2` on a link — the gap it passes through.
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
  /** `between computer1 and computer2` — the gap the line passes through. */
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
