import type { Attrs, Axis, Placement } from './ast.js';

/** A `between` clause with its targets resolved. Mirrors `Passage` in `ast.ts`. */
export interface LayoutPassage {
  nodes: [LayoutNode, LayoutNode];
  /** Which gap, where the pair has two. Absent when the pair leaves no doubt. */
  axis?: Axis;
}

/** A node with its geometry solved. Coordinates are absolute, origin top-left. */
export interface LayoutNode {
  name: string;
  kind: 'box' | 'note';
  /** The label as written, before line splitting. */
  text: string;
  /** The label split into the lines that will be drawn. */
  lines: string[];
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
  /** One label per copy behind this node, back to front. Empty for most nodes. */
  deckLabels: string[];

  /**
   * Vertical space this node's own label and icon occupy, at whichever end of
   * the box `label.at` puts them. Zero for leaves.
   */
  headerHeight: number;

  /** The label's bracketed modifiers, as written. Usually empty. */
  label: Attrs;

  attrs: Attrs;
  /** Style attributes merged in from a named style, then overridden by the node's own. */
  appearance: Attrs;

  /** What the author said about where it goes, kept so diagnostics can quote the source back. */
  placements: Placement[];
  line: number;
}

export interface LayoutLink {
  from: LayoutNode;
  to: LayoutNode;
  both: boolean;
  label?: string;
  /**
   * The gap a `between` clause named, with its two nodes resolved. Nothing in
   * the resolver uses this — a corridor is measured off the solved layout
   * rather than solved for, so links stay out of the constraint system entirely.
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
  links: LayoutLink[];
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
   * same band open around a link that leaves the boxes' bounds — a curve out of
   * a `top` side does exactly that, and the canvas has to grow to hold it.
   */
  margin: number;
}
