import type { Attrs, EdgeTextPlace, Kind, Limit, Mark, NodeCorners, Placement, PlacementTarget, ViaEntry, Way } from './ast.js';

/** A rectangle on the page; a side or a point has no size on one axis or both. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
import type { Line } from './text.js';
import type { Body, Icon } from './icons.js';

/** A node with its geometry solved. Coordinates are absolute, origin top-left. */
/** A distance past each side of a box. */
export interface Reach {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LayoutNode {
  name: string;
  /** Which set of attributes this node answers to, decided by its body. */
  kind: Exclude<Kind, 'edge'>;
  /**
   * What the node is drawn as, resolved once while the tree is built — so the
   * resolver, which sizes it, and the renderer, which draws it, cannot disagree.
   */
  body: Body;
  /**
   * How an outline's corners are drawn, from `corners:`. Only a rectangle's and
   * a document's are read; drawing alone depends on it, never placement.
   */
  corners: NodeCorners;
  /**
   * How wide the border is drawn, in pixels, from `border: (thickness: …)`;
   * left out when it is the normal width. The stroke lies inside the outline,
   * and the padding grows by the extra, so a thick border takes room.
   */
  borderWidth?: number;
  /** The text as written, before line splitting. */
  text: string;
  /** The text split into the lines that will be drawn, each as its runs. */
  lines: Line[];
  parent?: LayoutNode;
  children: LayoutNode[];
  /**
   * The child that is this box's heading (`heading:`): it sits where the title
   * would, and the other children are arranged under it. It does not make the
   * box a container to look at.
   */
  heading?: LayoutNode;
  /**
   * What this node moves with (`join-with:`, or the child `badge:` writes
   * out): its container's text, or a sibling. Those joined to the text,
   * directly or through each other, are one unit with it, placed by the text's
   * position words (design.org 5.6).
   */
  joinWith?: LayoutNode | 'text';
  /**
   * Placements in the title's bracket, against the box's own children: what
   * places the title on the axes they state, in place of its side words
   * (design.org 7.2).
   */
  titlePlacements?: Placement[];
  /** `stays above laptop.photos`: what it keeps clear of (design.org 5.6). */
  limits?: Limit[];

  x: number;
  y: number;
  width: number;
  height: number;

  /**
   * Vertical space this node's own text and icon occupy, at whichever end of
   * the box `text.at` puts them. Zero for leaves.
   */
  headerHeight: number;

  /**
   * How far this node's children stick out past its own box on each side —
   * a child placed `outside` it, or one further down that does. Everything
   * kept clear of this node keeps clear of those too, since they are part of
   * it; alignments still read the node's own box. Zero on every side for a
   * node whose children all sit inside it.
   */
  reach: Reach;

  /**
   * Whether things stack beside this node's text — below it, or above it when
   * the text is at the bottom. That is what a title band *is*, so it is what
   * decides its text's defaults, rather than whether the node has children: a
   * node whose only child sits beside its text or in a corner has nothing
   * stacked below the text, and its text sits as a leaf's does. Its *colors*
   * follow having children, not this.
   */
  banded: boolean;

  /**
   * The rectangle this node's own text occupies, as an offset from the node's
   * outer top-left. The *ink* box, not the room it ranges in: for a container
   * that is the title itself, not the width of the band.
   *
   * Worked out by the resolver rather than the renderer because `hub text` is
   * a placement target, so it has to be a number before anything is solved —
   * and because the resolver reserving the room and the renderer filling it
   * must not be able to disagree about where it ended up. The renderer draws
   * from this rather than recomputing it.
   *
   * All zeroes where the node has no text.
   */
  textBox: { x: number; y: number; width: number; height: number };

  /**
   * Which way the text ranges in the room it was given, kept because a node
   * can be widened *after* it was sized — `contents: (widths: match)` and
   * `(widths: fill)` both do — and a centered or right-ranged text has to move
   * with the new width. Without it the box grows and the words stay put.
   */
  textSide: 'left' | 'center' | 'right';

  /**
   * What the text's brackets said, with anything a style's `text: (…)`
   * contributed underneath it. Usually empty.
   */
  textAttrs: Attrs;

  attrs: Attrs;
  /** Style attributes merged in from a named style, then overridden by the node's own. */
  appearance: Attrs;

  /** What the author said about where it goes, kept so diagnostics can quote the source back. */
  placements: Placement[];
  /** `guide node`: placed, holding and placed against as any node, drawn only when guides are shown. */
  guide?: boolean;
  line: number;
}

/**
 * A named point or region, worked out on the page (design.org 4.5, 8.3). A
 * point is a dot; a region a tinted rectangle, drawn behind what it names.
 */
export interface LayoutMark {
  kind: 'point' | 'region';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The things its definition names, directly or through other points and regions. */
  names: string[];
  appearance: Attrs;
  guide: boolean;
  /** A region's border width in pixels, left out when normal; drawn inside its stated edge. */
  borderWidth?: number;
  /** Its text, if it has one, and where that sits on the page (design.org 7.4). */
  text?: MarkTextBox;
  line: number;
}

/** A point's or a region's text, measured and placed. `box` is the turned ink when it reads up or down. */
export interface MarkTextBox {
  lines: Line[];
  textAttrs: Attrs;
  size: number;
  lineHeight: number;
  box: Rect;
}

/** `depth: behind b, in front of c` on one thing, read into its clauses (design.org 8.4). */
export interface DepthStatement {
  /** What moves: a node's or a mark's name, or `edge <n>` for the nth edge. */
  subject: string;
  /** The subject as written, for quoting back. */
  written: string;
  clauses: {
    way: 'behind' | 'in front of';
    /** What it moves against, as drawing-order keys: a name, or `edge <n>` for a named line. */
    names: string[];
    /** The same, as written, for quoting back. */
    shown: string[];
    /**
     * Legs named, each with the key of the line it belongs to. A leg moves
     * nothing in the sequence: it says which of two lines is on top where
     * they cross on that leg, and nowhere else.
     */
    legs: { leg: string; line: string }[];
  }[];
  line: number;
}

/** One text on a line, measured, with what its bracket says about where it sits. */
export interface LayoutEdgeText {
  text: string;
  /** The text split into the lines that will be drawn, each as its runs. */
  lines: Line[];
  /** Its bracket's look, with a style's `text: (…)` underneath. */
  textAttrs: Attrs;
  place: EdgeTextPlace;
  /** Its font size, and the size of its lines unturned. */
  size: number;
  width: number;
  height: number;
  /** Where the box a `straight … from` or a box relation names is, once placed. */
  target?: Rect;
  /** Where each `even with` in its bracket lines up, once placed: the axis, which part of the text, and what it lines up with. */
  evenAt?: { axis: 'x' | 'y'; side: 'start' | 'center' | 'end'; rect: Rect }[];
}

export interface LayoutEdge {
  from: LayoutNode;
  to: LayoutNode;
  /** What is drawn at each end, settled: the arrow, then the edge's own attributes, then its style. */
  marks: { from: Mark; to: Mark };
  /** Its texts in written order, measured; where each goes is worked out once the line is drawn (`linetexts.ts`). */
  texts: LayoutEdgeText[];
  /** The arrow as written, for quoting the edge back: `a -> b`. */
  arrow: string;
  /** `edge req client -> api`: the line's own name, for other statements to refer to. */
  name?: string;
  /** The places the line passes, as written (design.org 6.4). */
  via?: ViaEntry[];
  /**
   * Where each `via:` stop that names something placed is on the page, worked
   * out by the placer once everything is placed: a box, a side, a point or a
   * region. Absent for a stop on a line or beside a leg, which `lines.ts`
   * works out from the lines themselves. Same order as `via`.
   */
  viaAt?: (Rect | undefined)[];
  /** `straight down`: leaving its start that way from the center, and ending where that meets the far end (6.2). */
  straight?: Way;
  /** `to: left, even with cat1`: what each end is even with, as written (6.2). */
  evenWith?: { from?: PlacementTarget[]; to?: PlacementTarget[] };
  /**
   * Where each end's `even with` thing is on the page, worked out by the
   * placer: a box, a side, a point or the region round several. Its center
   * gives the end's height, or its place across.
   */
  evenAt?: { from?: Rect; to?: Rect };
  /** An end on another line (`edge log audit -> req`): the line it is on, for that end. */
  onLine?: { from?: LayoutEdge; to?: LayoutEdge };
  /** An end at a named point or region (`edge a -> b` between two points): which kind, for that end. */
  onMark?: { from?: 'point' | 'region'; to?: 'point' | 'region' };
  /** What the line's bracket says, checked and with every default filled in. */
  look: LineLook;
  attrs: Attrs;
  appearance: Attrs;
  /** `guide edge`: drawn only when guides are shown. */
  guide?: boolean;
  /**
   * A `bundle` statement: a line with no ends, whose path is its `via:` list
   * alone, and which other lines travel along (design.org 6.6). Its `from` and
   * `to` are placeholders named after it. A parallel bundle is drawn only with
   * the guides; a collapsed one is drawn, as the bus. A bundle written
   * `a -> b` has no path: `between` holds its two boxes, and its members are
   * drawn straight from one to the other.
   */
  bundle?: { arrangement: 'parallel' | 'collapsed' | 'fan'; gap: number; order?: string[]; between?: [LayoutNode, LayoutNode] };
  line: number;
}

/**
 * How an edge's line is drawn: `line: (path: square, corners: rounded, …)`.
 * Only `thickness` takes room; the rest is appearance and moves nothing.
 */
export interface LineLook {
  path: 'curved' | 'square' | 'straight';
  corners: 'sharp' | 'rounded';
  crossing: 'none' | 'arc' | 'gap' | 'square';
  pattern: 'solid' | 'dashed' | 'dotted' | 'dash-dot';
  /** In pixels. */
  thickness: number;
  /** How widely a curved line swings between its points. */
  curve: 'normal' | 'strong' | 'subtle';
  /**
   * Where the free leg sits, a fraction of the way from the start's box (6.3).
   * Undefined where nothing says: a square line's leg sits halfway, and a
   * curved line takes one free sweep.
   */
  turn: number | undefined;
  /** `turn:` as written on the edge itself, refused where it places nothing; from a style or a default it is undefined. */
  turnWritten: string | undefined;
  /** The short first and last leg of a square or curved line, in pixels. */
  stepOut: number;
  /** `step-out:` as written on the edge itself; from a style or a default it is undefined. */
  stepOutWritten: string | undefined;
}

export interface Layout {
  /** Every node, containers and children alike, in declaration order. */
  nodes: LayoutNode[];
  /** Top-level nodes only, in declaration order. */
  roots: LayoutNode[];
  edges: LayoutEdge[];
  /**
   * Every style the file's markup names that lends a color, resolved to that
   * color. The renderer needs it because a marked run borrows its color from a
   * style rather than stating one, and styles are otherwise merged away by
   * here. A size a style lends is carried on the run itself.
   */
  markup: Record<string, string>;
  /** The pictures links' badges name, by name, for the page that draws the badges. */
  linkIcons: Record<string, Icon>;
  /**
   * What the `diagram` statement said, as written. Nothing here affects
   * geometry; it rides along so the renderer sees the whole compiled document
   * and not only the shapes.
   */
  diagram: Attrs;
  width: number;
  height: number;
  /**
   * The clear band left around the drawing. Kept so the renderer can hold the
   * same band open around an edge that leaves the boxes' bounds — a curve out of
   * a `top` side does exactly that, and the canvas has to grow to hold it.
   */
  margin: number;
  /** Named points and regions, in the order written. */
  marks: LayoutMark[];
  /** Every `depth:`, in the order written. */
  depths: DepthStatement[];
  /** How a shown guide of each kind looks: `default guide node` and the rest. */
  guideLooks: Record<'node' | 'edge' | 'point' | 'region', Attrs>;
}

/**
 * Whether a deck, which draws no outline of its own, was given one: a fill, or
 * something about its border.
 */
export function outlineStated(appearance: Attrs): boolean {
  return appearance['fill'] !== undefined || appearance['border'] !== undefined || appearance['border.thickness'] !== undefined;
}

/**
 * Whether a node is joined to its container's text, directly or through
 * siblings joined to it: one unit with the text, placed by the text's position
 * words (design.org 5.6).
 */
export function joinedToText(node: LayoutNode): boolean {
  const seen = new Set<LayoutNode>();
  for (let at: LayoutNode | undefined = node; at && !seen.has(at); ) {
    seen.add(at);
    const target: LayoutNode | 'text' | undefined = at.joinWith;
    if (target === 'text') return true;
    at = target;
  }
  return false;
}

/** Whether a node is inside another, at any depth. */
export function isWithin(node: LayoutNode, ancestor: LayoutNode): boolean {
  for (let at = node.parent; at; at = at.parent) if (at === ancestor) return true;
  return false;
}
