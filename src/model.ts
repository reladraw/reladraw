import type { Attrs, Axis, Kind, Placement } from './ast.js';
import type { Line } from './text.js';
import type { Body } from './icons.js';

/** A `between` clause with its targets resolved. Mirrors `Passage` in `ast.ts`. */
export interface LayoutPassage {
  nodes: [LayoutNode, LayoutNode];
  /** Which gap, where the pair has two. Absent when the pair leaves no doubt. */
  axis?: Axis;
}

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
  /** The text as written, before line splitting. */
  text: string;
  /** The text split into the lines that will be drawn, each as its runs. */
  lines: Line[];
  parent?: LayoutNode;
  children: LayoutNode[];

  x: number;
  y: number;
  width: number;
  height: number;

  /**
   * Distance from the node's outer box to its drawn face. Zero for everything
   * except a deck, where the offset copies sit in that margin.
   */
  inset: number;
  /** One text per copy behind this node, back to front. Empty for most nodes. */
  deckTexts: string[];

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
   * decides a container's look and its text's defaults, rather than whether
   * the node has children: a node whose only child sits beside its text or in
   * a corner has nothing stacked below the text, and draws as a leaf.
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
  line: number;
}

export interface LayoutEdge {
  from: LayoutNode;
  to: LayoutNode;
  both: boolean;
  text?: string;
  /** The text split into the lines that will be drawn, each as its runs. */
  lines?: Line[];
  /** The text's bracketed modifiers, with a style's `text: (…)` underneath. */
  textAttrs: Attrs;
  /**
   * The gap a `between` clause named, with its two nodes resolved. Nothing in
   * the resolver uses this — a corridor is measured off the solved layout
   * rather than solved for, so edges stay out of the constraint system entirely.
   */
  between?: LayoutPassage;
  attrs: Attrs;
  appearance: Attrs;
  line: number;
}

export interface Layout {
  /** Every node, containers and children alike, in declaration order. */
  nodes: LayoutNode[];
  /** Top-level nodes only, in declaration order. */
  roots: LayoutNode[];
  edges: LayoutEdge[];
  /**
   * Every style the file's markup names, resolved to the color it lends. The
   * renderer needs it because a marked run borrows its color from a style
   * rather than stating one, and styles are otherwise merged away by here.
   */
  markup: Record<string, string>;
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
}
