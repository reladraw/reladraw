/**
 * Where every box goes, and how big each container is.
 *
 * Nothing here is solved and nothing is pushed. A placement gives a box an
 * exact distance from its target, each axis of each box comes from exactly one
 * statement, and a box is worked out from things already worked out, in
 * whatever order its targets allow. A container is the outline of its children
 * plus its padding. Two boxes the file puts on one spot are drawn there, and
 * the findings report it.
 *
 * Every quantity is worked out on demand and remembered: a box's start on an
 * axis, its size, and a container's frame. A box asked for while it is still
 * being worked out is a circle in the file, reported with the placements that
 * make it.
 *
 * Coordinates are per frame. The top level's frame is the page. A container's
 * children are placed in its own frame, whose origin is wherever its anchor
 * landed, and the container's box is found around them; a child's place on the
 * page is its container's plus its offset in that frame.
 */
import type { Axis, Direction, Limit, OffsetPlacement, Part, Placement, PlacementTarget, PointExpr, PointStmt, RegionStmt, Side } from './ast.js';
import { describeLimit, describePlacement, describePoint, fractionAxis, nameTarget, PART_SIDES, partWordHint } from './ast.js';
import { DECK_STEP, GAPS, HEADER_GAP, UNIT } from './constants.js';
import { SourceError } from './errors.js';
import { isWithin, joinedToText, type LayoutNode } from './model.js';
import { isBoxy, middleOf, shapeOf, towardOutline } from './outline.js';
import { type Dimension, SIZE_KEYS, type SizeExpr, type SpanSide, storedSize } from './size.js';

/** A stretch of one axis. */
interface Extent {
  start: number;
  size: number;
}

/** Where a container's title sits: against which side, and how. */
export interface TitlePlace {
  /** `inside`, `on` or `outside` a side, or `center` for the middle of the box. */
  how: 'inside' | 'on' | 'outside' | 'center';
  side: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** Along the side: the start (left or top), the middle, or the end. */
  along: 'start' | 'center' | 'end';
}

/** A region's text as the placer needs it: its turned size, its gap, and where it sits. */
export interface RegionTextFacts {
  width: number;
  height: number;
  gap: number;
  how: 'inside' | 'on' | 'outside';
  side: 'top' | 'bottom' | 'left' | 'right';
  along: 'start' | 'center' | 'end';
}

/**
 * How a region grows to hold its text, on one axis (design.org 7.4). Inside,
 * it gains a band on that side as tall as the text and its gap, as a container
 * makes room for its title; inside or on the border, it widens to hold the
 * text along the side, from the end the text is aligned to. Outside, nothing.
 */
export function regionGrown(extent: Extent, text: RegionTextFacts, axis: Axis): Extent {
  const across = text.side === 'top' || text.side === 'bottom' ? 'x' : 'y';
  const size = (on: Axis) => (on === 'x' ? text.width : text.height);
  if (axis !== across) {
    if (text.how !== 'inside') return extent;
    const band = size(axis) + text.gap;
    return text.side === 'top' || text.side === 'left'
      ? { start: extent.start - band, size: extent.size + band }
      : { start: extent.start, size: extent.size + band };
  }
  const needed = size(axis) + text.gap * 2;
  if (text.how === 'outside' || extent.size >= needed) return extent;
  const more = needed - extent.size;
  const start = text.along === 'start' ? extent.start : text.along === 'end' ? extent.start - more : extent.start - more / 2;
  return { start, size: needed };
}

/**
 * Where a region's text sits on one axis, against the region as drawn (already
 * grown): a gap inside or outside the side, or across the border; along the
 * side, at its start, middle or end, held off the corner by the gap except
 * outside, where its end is even with the region's edge, as a title's is.
 */
export function regionTextAt(region: Extent, text: RegionTextFacts, axis: Axis): Extent {
  const across = text.side === 'top' || text.side === 'bottom' ? 'x' : 'y';
  const size = axis === 'x' ? text.width : text.height;
  const end = region.start + region.size;
  if (axis === across) {
    const inset = text.how === 'outside' ? 0 : text.gap;
    const start =
      text.along === 'start' ? region.start + inset : text.along === 'end' ? end - inset - size : region.start + region.size / 2 - size / 2;
    return { start, size };
  }
  const low = text.side === 'top' || text.side === 'left';
  const edge = low ? region.start : end;
  if (text.how === 'on') return { start: edge - size / 2, size };
  const inward = text.how === 'inside' === low;
  return { start: inward ? edge + text.gap : edge - text.gap - size, size };
}

/** What `layout:` said, read and checked. */
export interface Layout {
  /** A deck stacks its children, the first in front and each next one up and to the left behind it. */
  kind: 'column' | 'row' | 'deck';
  /** Between facing sides of neighbors, in pixels. Absent when `centers` is given. */
  gap?: number;
  /** Between neighbors' centers, in pixels. */
  centers?: number;
  widths: 'natural' | 'match' | 'fill';
  /** `align-children:`: the children's starts, middles or ends even with each other. */
  align: 'start' | 'center' | 'end';
}

/** What `layout: venn` said: its three parts in order, whether the two sets share a height, and the gap outside each crossing border. */
export interface Venn {
  heights: 'natural' | 'equal';
  gap: number;
  /** `align-children:`: the two sets lined up by their tops, middles or bottoms. */
  align: 'start' | 'center' | 'end';
  /** The left set, the overlap, the right set. */
  parts: [LayoutNode, LayoutNode, LayoutNode];
}

/** What the tree pass settled about each node before anything is placed. */
export interface NodeFacts {
  /** The size the node's own contents give it: a leaf's text and padding, a picture. Zero for a container. */
  natural: { width: number; height: number };
  /** The text's ink box from the node's top-left, as a leaf is sized. */
  textBox: { x: number; y: number; width: number; height: number };
  /** Whether the node has any text. An empty text takes no room. */
  hasText: boolean;
  /** `padding:`, which a title keeps its inset by. */
  padding: number;
  /** Each side's padding: `padding:`, or `padding-right:` and the rest over it. */
  pad: Record<'top' | 'right' | 'bottom' | 'left', number>;
  /** One line of the node's text, and one character, for sizes in `lines` and `chars`. */
  lineHeight: number;
  charWidth: number;
  title: TitlePlace;
  layout?: Layout;
  venn?: Venn;
  circle: boolean;
  /** Where `gather-children:` puts the children in the box's spare room, on each axis. */
  gather: Record<Axis, 'start' | 'center' | 'end'>;
}

const BOTH_AXES: Axis[] = ['x', 'y'];

/** Whether an axis is across or down, in a writer's words. */
const AXIS_SAID: Record<Axis, string> = { x: 'across', y: 'up and down' };

/** Which way a direction moves on each axis: past the far side, before the near one, or not at all. */
function component(direction: Direction, axis: Axis): 'after' | 'before' | undefined {
  if (axis === 'x') {
    if (direction.includes('right')) return 'after';
    if (direction.includes('left')) return 'before';
    return undefined;
  }
  if (direction.startsWith('below')) return 'after';
  if (direction.startsWith('above')) return 'before';
  return undefined;
}

/** One statement about one axis of a box. */
type Statement =
  | { kind: 'after' | 'before'; placement: Placement; edge: () => number }
  | { kind: 'align'; placement: Placement; side: 'start' | 'center' | 'end'; at: () => Extent };

/**
 * A gap as written: a gap word, a number in the file's unit, or a number of
 * pixels with `px`. A distance is never negative; the words for an overlap are
 * `inside` and `on`.
 */
export function gapPixels(written: string, subject: string, line: number): number {
  const word = GAPS[written];
  if (word !== undefined) return word;
  if (/^\d*\.?\d+$/.test(written)) return Number(written) * UNIT;
  const pixels = /^(\d*\.?\d+)px$/.exec(written);
  if (pixels) return Number(pixels[1]);
  if (written.startsWith('-')) {
    throw new SourceError(
      `${subject}: a distance is never negative, so ${written} is not one — to overlap, place it inside or on the other`,
      line,
    );
  }
  throw new SourceError(
    `${subject}: "${written}" is not a distance — write one of ${Object.keys(GAPS).join(', ')}, ` +
      'a number in the file\'s unit, or a number of pixels such as 12px',
    line,
  );
}

/**
 * A region's `opacity:`, an amount from none to full: `0` to `1.0`. The one
 * look whose bare number is not a multiple of its normal (design.org 8.3).
 */
export function checkOpacity(value: string, subject: string, line: number): void {
  if (/^\d*\.?\d+$/.test(value) && Number(value) <= 1) return;
  throw new SourceError(
    `${subject}: "opacity: ${value}" — opacity is an amount from 0 (none) to 1.0 (solid), such as opacity: 0.5`,
    line,
  );
}

export class Placer {
  private readonly starts = new Map<string, number>();
  private readonly sizes = new Map<string, number>();
  private readonly frames = new Map<string, FrameAxis>();
  private readonly outlines = new Map<string, FrameAxis>();
  /** A container's box while a limit tries it out (`roomFor`), in place of its final one. */
  private readonly trials = new Map<string, FrameAxis>();
  private readonly working = new Set<string>();
  /** What is being worked out, innermost last, for reporting a circle. */
  private readonly trail: Array<{ node: LayoutNode; axis: Axis; placement?: Placement; size?: string }> = [];
  /** A node's size on its own, from what it states or holds, within its limits. */
  private readonly owns = new Map<string, number>();
  /** A layout's child's position and size on each axis, worked out for the whole layout at once. */
  private readonly laid = new Map<string, { start: number; size?: number }>();
  /** Where each of a venn's parts' frames sits in the venn's, on each axis. */
  private readonly vennPlans = new Map<string, [number, number, number]>();
  /** Where one venn part's frame sits in the venn's, up and down. */
  private readonly vennShifts = new Map<string, number>();
  /** The band a laid-out container's children are aligned in, across its layout. */
  private readonly bands = new Map<string, number>();
  /** Where a node joined to its container's text starts, measured from the text's start. */
  private readonly unitStarts = new Map<string, number>();
  /** The stretch a container's text and what is joined to it cover, measured from the text's start. */
  private readonly units = new Map<string, Extent>();
  /** Where a container's frame's origin is on the page. */
  private readonly origins = new Map<string, number>();
  /** Containers whose anchor is being placed on the page, so a box outside them is measured on the page rather than in their frame. */
  private readonly onPage = new Set<string>();
  /** Boxes that anchor their frame on one axis only, when no box in it says nothing at all (`splitAnchors`). */
  private readonly axisAnchors = new Set<string>();

  /** Named points and regions being worked out, innermost last, to refuse one defined through itself. */
  private readonly expanding: string[] = [];

  constructor(
    private readonly roots: LayoutNode[],
    private readonly byName: Map<string, LayoutNode>,
    private readonly facts: Map<LayoutNode, NodeFacts>,
    /** Named points and regions (design.org 4.5), worked out wherever they are used. */
    private readonly named: Map<string, PointStmt | RegionStmt> = new Map(),
    /** A region's text, which may grow the region to hold it (design.org 7.4). */
    private readonly regionTexts: Map<string, RegionTextFacts> = new Map(),
  ) {}

  /**
   * Where each named point and region is on the page. A point names one spot,
   * so one that works out to a stretch (a side, a whole box) is refused.
   */
  placeNamed(): Map<string, { x: number; y: number; width: number; height: number }> {
    const placed = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const [name, stmt] of this.named) {
      const page = { name: `${stmt.kind} ${name}`, parent: undefined, children: [], placements: [], line: stmt.line } as unknown as LayoutNode;
      const at = { name } as PlacementTarget;
      const x = this.extentOf(page, at, 'x', { kind: 'on', targets: [at], line: stmt.line });
      const y = this.extentOf(page, at, 'y', { kind: 'on', targets: [at], line: stmt.line });
      if (stmt.kind === 'point' && (x.size > 0.01 || y.size > 0.01)) {
        throw new SourceError(
          `point "${name}" is "${nameTarget(stmt.point)}", which is a stretch rather than one point — ` +
            'name a point, such as a corner or a side\'s -center, or a fraction along a side',
          stmt.line,
        );
      }
      placed.set(name, { x: x.start, y: y.start, width: x.size, height: y.size });
    }
    return placed;
  }

  /**
   * Where a target is on the page once everything is placed: a box, a side (a
   * stretch on one axis), a point, a named point or region. For a line's
   * `via:` stops (design.org 6.4).
   */
  locate(target: PlacementTarget, subject: string, line: number): { x: number; y: number; width: number; height: number } {
    const page = { name: subject, parent: undefined, children: [], placements: [], line } as unknown as LayoutNode;
    const placement: Placement = { kind: 'on', targets: [target], line };
    const x = this.extentOf(page, target, 'x', placement);
    const y = this.extentOf(page, target, 'y', placement);
    return { x: x.start, y: y.start, width: x.size, height: y.size };
  }

  /** Work out everything, and write it onto the nodes. */
  run(): void {
    this.checkAnchors(this.roots, undefined);
    for (const node of this.byName.values()) this.checkLimitTargets(node);
    for (const node of this.byName.values()) {
      for (const axis of BOTH_AXES) {
        this.size(node, axis);
        this.page(node, axis);
      }
    }
    for (const node of this.byName.values()) {
      node.x = this.page(node, 'x');
      node.y = this.page(node, 'y');
      node.width = this.size(node, 'x');
      node.height = this.size(node, 'y');
    }
    for (const node of this.byName.values()) this.checkYielded(node);
    for (const node of this.byName.values()) this.checkLimitsMet(node);
    for (const node of this.byName.values()) this.finish(node);
  }

  /**
   * What a limit may relate (design.org 5.6): two things in one box that
   * nothing else ties together, since the box's own spacing between them is
   * the only distance it may lengthen.
   */
  private checkLimitTargets(node: LayoutNode): void {
    for (const limit of node.limits ?? []) {
      const parent = node.parent;
      const said = `"${node.name} ${describeLimit(limit)}"`;
      const named = this.byName.get(limit.target.name);
      if (!named) {
        throw new SourceError(`${said}: "${limit.target.name}" does not exist${partWordHint(limit.target.name, this.byName.keys())}`, limit.line);
      }
      const ownText = parent !== undefined && named === parent && limit.target.part === 'text';
      const sibling = parent !== undefined && named.parent === parent && named !== node && limit.target.part === undefined;
      if (!parent || !(ownText || sibling)) {
        throw new SourceError(
          `${said}: a limit keeps clear of something in the same box, a sibling or ` +
            `${parent ? `"${parent.name} text"` : 'the box\'s own text'}, since that box is what makes room`,
          limit.line,
        );
      }
      if (ownText && !this.hasTitle(parent)) {
        throw new SourceError(`${said}: "${parent.name}" has no text`, limit.line);
      }
      const axis = limitAxis(limit);
      const own = this.groupOf(node, parent, axis);
      if (own !== 'frame' && own === this.groupOf(ownText ? 'text' : named, parent, axis)) {
        const how = own === 'title' ? `with "${parent.name}"'s text` : 'against each other';
        throw new SourceError(
          `${said} could never change anything: "${node.name}" and "${nameTarget(limit.target)}" are placed ${how}, ` +
            'so the distance between them is already stated — a limit relates two things in one box that nothing else ties together, ' +
            `such as a child placed against "${parent.name}"'s side and one of its other children`,
          limit.line,
        );
      }
    }
  }

  /**
   * Which of the things a box holds that nothing ties to each other a member
   * belongs to, on one axis: its title, what is placed against the box's
   * sides, or the rest, placed against each other.
   */
  private groupOf(member: LayoutNode | 'text', parent: LayoutNode, axis: Axis): 'title' | 'frame' | 'content' {
    const titleTied = this.anchoredOnTitle(parent) || (parent.titlePlacements?.length ?? 0) > 0;
    if (member === 'text' || member === parent.heading || joinedToText(member)) return titleTied ? 'content' : 'title';
    return this.framedOn(member, axis) ? 'frame' : 'content';
  }

  /** A limit the box couldn't make room for: no side helps, or a stated size holds it in. */
  private checkLimitsMet(node: LayoutNode): void {
    for (const limit of node.limits ?? []) {
      const parent = node.parent!;
      const axis = limitAxis(limit);
      const frame = this.frame(parent, axis);
      if (this.shortfall(parent, axis, { subject: node, limit }, frame) <= LIMIT_EPSILON) continue;
      const said = `"${describeLimit(limit)}"`;
      if (frame.boxSize !== this.outline(parent, axis).boxSize) {
        throw new SourceError(
          `"${node.name} ${describeLimit(limit)}", but "${parent.name}"'s stated ${axis === 'x' ? 'width' : 'height'} leaves no room for it — ` +
            'make it bigger, or leave the size unstated so the box can make room',
          limit.line,
        );
      }
      const named = this.byName.get(limit.target.name)!;
      const framed = [node, named].find((member) => member !== parent && this.framedOn(member, axis));
      const where = framed
        ? this.statements(framed, axis).map((statement) => `"${framed.name} ${describePlacement(statement.placement)}"`).join(' and ')
        : undefined;
      throw new SourceError(
        `"${node.name}" can't keep to ${said}${where ? ` with ${where}` : ''}: "${parent.name}" holds both, and growing it ` +
          'never moves them apart — keep one of the two',
        limit.line,
      );
    }
  }

  // --- the quantities ------------------------------------------------------

  /** Where a node starts on the page. */
  page(node: LayoutNode, axis: Axis): number {
    const parent = node.parent;
    if (!parent) return this.start(node, axis);
    return this.origin(parent, axis) + this.start(node, axis);
  }

  /**
   * Where a container's frame's origin is on the page. A container that says
   * nothing about where it goes shares its own container's origin, so it is
   * known without its outline; one placed by what it holds is where its
   * anchor goes; any other is found from where its box went.
   */
  private origin(node: LayoutNode, axis: Axis): number {
    const key = `${node.name}\n${axis}`;
    const known = this.origins.get(key);
    if (known !== undefined) return known;
    const worked = this.guard(`origin\n${key}`, node, axis, undefined, () => {
      if (this.frameAnchor(node, axis)) return this.anchorOnPage(node, axis);
      const above = node.parent ? this.origin(node.parent, axis) : 0;
      if (this.floats(node, axis)) return above;
      this.refusePlacedTwice(node, axis);
      return above + this.start(node, axis) - this.frame(node, axis).boxStart;
    });
    this.origins.set(key, worked);
    return worked;
  }

  /**
   * A container that says where it goes on one axis cannot also hold a child
   * placed against a box outside it on that axis: both would say where the
   * container goes, and it is refused even when the two agree.
   */
  private refusePlacedTwice(node: LayoutNode, axis: Axis): void {
    const own = this.statements(node, axis);
    if (own.length === 0) return;
    // A venn set's stagger places only its box when what it holds is placed across (`vennAlign`).
    const part = this.vennPart(node);
    if (part === 0 || part === 2) {
      const parts = this.facts.get(node.parent!)!.venn!.parts;
      if (staggerOf(own[0]!.placement, parts[2 - part]!) !== undefined) return;
    }
    for (const child of this.contentOf(node)) {
      for (const { placement } of this.statements(child, axis)) {
        const outside = placement.targets.flatMap((target) => this.boxesNamed(target, [])).some((name) => {
          const named = this.byName.get(name);
          return named !== undefined && named !== node && !isWithin(named, node);
        });
        if (!outside) continue;
        throw new SourceError(
          `"${node.name}" is placed twice ${AXIS_SAID[axis]}: by its own "${describePlacement(own[0]!.placement)}" ` +
            `and by "${child.name} ${describePlacement(placement)}", which is inside it — keep one of the two`,
          placement.line,
        );
      }
    }
  }

  /** The origin a box outside `parent` is measured from: the page while `parent`'s anchor is being placed on it. */
  private originFor(parent: LayoutNode, axis: Axis): number {
    return this.onPage.has(`${parent.name}\n${axis}`) ? 0 : this.origin(parent, axis);
  }

  /** Where the anchor of a container placed by what it holds goes on the page, which is its frame's origin. */
  private anchorOnPage(node: LayoutNode, axis: Axis): number {
    const anchor = this.frameAnchor(node, axis)!;
    if (anchor.placements.length === 0) return this.origin(anchor, axis) + this.frame(anchor, axis).boxStart;
    const key = `${node.name}\n${axis}`;
    this.onPage.add(key);
    try {
      return this.placed(anchor, axis);
    } finally {
      this.onPage.delete(key);
    }
  }

  /**
   * A container that is its frame's anchor: it says nothing about where it
   * goes, and nothing inside it is placed against a box outside it in its
   * stead. Its frame's origin is its own container's.
   */
  private floats(node: LayoutNode, axis: Axis): boolean {
    const parent = node.parent;
    if (node.children.length === 0) return false;
    if (node.placements.length > 0 && !this.axisAnchors.has(`${node.name}\n${axis}`)) return false;
    if (parent && (parent.heading === node || joinedToText(node) || this.facts.get(parent)!.layout || this.vennPart(node) !== undefined)) {
      return false;
    }
    return true;
  }

  /**
   * A container placed by what it holds, on one axis (design.org 5.5): it
   * says nothing about where it goes, nothing inside it is its anchor, and a
   * child is placed against boxes outside it. The first such child is the
   * frame's anchor, and where it goes says where the container goes.
   */
  private frameAnchor(node: LayoutNode, axis: Axis): LayoutNode | undefined {
    if (node.children.length === 0 || node.placements.length > 0) return undefined;
    const parent = node.parent;
    if (parent && (parent.heading === node || joinedToText(node) || this.facts.get(parent)!.layout || this.vennPart(node) !== undefined)) {
      return undefined;
    }
    const facts = this.facts.get(node)!;
    if (facts.layout || facts.venn) return undefined;
    const content = this.contentOf(node);
    if (this.anchoredOnTitle(node) || node.titlePlacements?.length) return undefined;
    if (content.some((child) => this.unplaced(child))) return undefined;
    return content.find((child) => this.fromOutside(child, axis, node));
  }

  /** A box that says nothing about where it goes, and so anchors its frame. */
  private unplaced(node: LayoutNode): boolean {
    if (this.acrossParts(node)) return true;
    if (node.placements.length > 0) return false;
    return !(this.frameAnchor(node, 'x') && this.frameAnchor(node, 'y'));
  }

  /** Whether everything a box is placed against on one axis is outside `of`. */
  private fromOutside(node: LayoutNode, axis: Axis, of: LayoutNode): boolean {
    if (node.placements.length === 0) {
      const anchor = this.frameAnchor(node, axis);
      return anchor !== undefined && this.fromOutside(anchor, axis, of);
    }
    const speaking = this.statements(node, axis).map((statement) => statement.placement);
    const placements = speaking.length > 0
      ? speaking
      : node.placements.filter((placement) => placement.kind === 'offset' && component(placement.direction, axis) === undefined);
    if (placements.length === 0) return false;
    const names = placements.flatMap((placement) => placement.targets.flatMap((target) => this.boxesNamed(target, [])));
    return names.length > 0 && names.every((name) => {
      const named = this.byName.get(name);
      return named !== undefined && named !== of && !isWithin(named, of);
    });
  }

  /** The boxes a target is worked out from: the box it names, or those a point or region it names is worked out from. */
  private boxesNamed(target: PlacementTarget, seen: string[]): string[] {
    if (target.point) {
      const point = target.point;
      if (point.kind === 'between') return [...this.boxesNamed(point.a, seen), ...this.boxesNamed(point.b, seen)];
      if (point.kind === 'from') return point.lines.flatMap((line) => this.boxesNamed(line.target, seen));
      return this.boxesNamed(point.from, seen);
    }
    if (this.byName.has(target.name)) return [target.name];
    const defined = this.named.get(target.name);
    if (!defined || seen.includes(target.name)) return [];
    const further = [...seen, target.name];
    if (defined.kind === 'point') return this.boxesNamed(defined.point, further);
    return defined.corners.flatMap((corner) => this.boxesNamed(corner, further));
  }

  /** Where a node starts in its container's frame, or on the page for the top level. */
  start(node: LayoutNode, axis: Axis): number {
    return this.remember(this.starts, node, axis, () => this.workOutStart(node, axis));
  }

  size(node: LayoutNode, axis: Axis): number {
    return this.remember(this.sizes, node, axis, () => this.workOutSize(node, axis));
  }

  /** A container's box and title in its own frame, at the size it ends up. */
  private frame(node: LayoutNode, axis: Axis): FrameAxis {
    const key = `${node.name}\n${axis}`;
    const trial = this.trials.get(key);
    if (trial) return trial;
    const known = this.frames.get(key);
    if (known) return known;
    const worked = this.guard(`frame\n${key}`, node, axis, undefined, () =>
      this.vennPart(node) === 1 ? this.stripFrame(node, axis) : this.fit(node, axis),
    );
    this.frames.set(key, worked);
    return worked;
  }

  /** A container's outline around what it holds, before anything states its size. */
  private outline(node: LayoutNode, axis: Axis): FrameAxis {
    const key = `${node.name}\n${axis}`;
    const known = this.outlines.get(key);
    if (known) return known;
    const worked = this.guard(`outline\n${key}`, node, axis, undefined, () => this.roomFor(node, axis));
    this.outlines.set(key, worked);
    return worked;
  }

  /**
   * A container's outline with room made for its children's limits
   * (design.org 5.6). The only distance a limit may lengthen is between what
   * the box holds and its sides, which every placement inside leaves unstated.
   * Each side's room moves a limit's two ends apart at a fixed rate (all of
   * it for a corner, half for the middle of a side), so one trial of each
   * side gives the rate, and the room is the shortfall over the rate. A side
   * that doesn't help is never used; with both helping, as for two corner
   * children, the box grows evenly. A limit no side helps is left unmet, and
   * `checkLimits` refuses it.
   */
  private roomFor(node: LayoutNode, axis: Axis): FrameAxis {
    const limits = this.limitsIn(node, axis);
    let room: Room = NO_ROOM;
    let frame = this.workOutFrame(node, axis);
    for (let round = 0; round < limits.length * 2; round++) {
      const short = (at: FrameAxis) => Math.max(...limits.map((each) => this.shortfall(node, axis, each, at)));
      const owed = short(frame);
      if (owed <= LIMIT_EPSILON) break;
      const rate = (more: Room) => (owed - short(this.workOutFrame(node, axis, more))) / owed;
      const low = rate({ low: room.low + owed, high: room.high });
      const high = rate({ low: room.low, high: room.high + owed });
      if (low > LIMIT_EPSILON && high > LIMIT_EPSILON) {
        const both = rate({ low: room.low + owed, high: room.high + owed });
        room = { low: room.low + owed / both, high: room.high + owed / both };
      } else if (low > LIMIT_EPSILON) {
        room = { ...room, low: room.low + owed / low };
      } else if (high > LIMIT_EPSILON) {
        room = { ...room, high: room.high + owed / high };
      } else {
        break;
      }
      frame = this.workOutFrame(node, axis, room);
    }
    return frame;
  }

  /** The limits a container's children state on one axis. */
  private limitsIn(node: LayoutNode, axis: Axis): { subject: LayoutNode; limit: Limit }[] {
    return node.children.flatMap((subject) =>
      (subject.limits ?? []).filter((limit) => limitAxis(limit) === axis).map((limit) => ({ subject, limit })),
    );
  }

  /** How much nearer than its gap a limit's two ends are, in a trial frame of their container. */
  private shortfall(node: LayoutNode, axis: Axis, { subject, limit }: { subject: LayoutNode; limit: Limit }, at: FrameAxis): number {
    const own = this.memberAt(subject, node, axis, at);
    const other = limit.target.name === node.name ? { start: at.textStart, size: at.textSize } : this.memberAt(this.byName.get(limit.target.name)!, node, axis, at);
    const gap = this.limitGap(subject, limit);
    const toward = limit.way === 'above' || limit.way === 'left';
    return toward ? own.start + own.size + gap - other.start : other.start + other.size + gap - own.start;
  }

  /** The distance a limit keeps: its gap, or the usual one; beside a text, as beside any text. */
  private limitGap(subject: LayoutNode, limit: Limit): number {
    if (limit.gap !== undefined) return gapPixels(limit.gap, `"${subject.name}"`, limit.line);
    const parent = subject.parent!;
    if (limit.target.name === parent.name) return this.hasTitle(parent) ? UNIT : 0;
    return GAPS['normal']!;
  }

  /** Where a child of `node` is on one axis, in a trial frame of `node`. */
  private memberAt(member: LayoutNode, node: LayoutNode, axis: Axis, at: FrameAxis): Extent {
    const size = this.size(member, axis);
    if (member === node.heading) return { start: at.titleStart, size };
    if (joinedToText(member)) return { start: at.textStart + this.unitStart(member, axis), size };
    if (!this.framedOn(member, axis)) return { start: this.start(member, axis), size };
    // Placed against the box: where the trial box puts it, worked out
    // without remembering, since the box isn't final.
    const key = `${node.name}\n${axis}`;
    this.trials.set(key, at);
    try {
      return { start: this.placed(member, axis), size };
    } finally {
      this.trials.delete(key);
    }
  }

  private remember(memo: Map<string, number>, node: LayoutNode, axis: Axis, work: () => number): number {
    const key = `${node.name}\n${axis}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const kind = memo === this.starts ? 'start' : memo === this.owns ? 'own' : memo === this.unitStarts ? 'unit' : 'size';
    const worked = this.guard(`${kind}\n${key}`, node, axis, undefined, work);
    memo.set(key, worked);
    return worked;
  }

  /**
   * Work something out, refusing a circle. The trail holds what was being
   * worked out on the way here, and the placements that asked for each.
   */
  private guard<T>(
    key: string,
    node: LayoutNode,
    axis: Axis,
    placement: Placement | undefined,
    work: () => T,
    size?: string,
  ): T {
    if (this.working.has(key)) throw this.circle(node);
    this.working.add(key);
    this.trail.push({ node, axis, ...(placement ? { placement } : {}), ...(size ? { size } : {}) });
    try {
      return work();
    } finally {
      this.working.delete(key);
      this.trail.pop();
    }
  }

  private circle(node: LayoutNode): SourceError {
    const from = this.trail.findIndex((step) => step.node === node);
    const loop = this.trail.slice(from === -1 ? 0 : from).filter((step) => step.placement || step.size);
    const said = [
      ...new Set(
        loop.map((step) =>
          step.placement
            ? step.node.titlePlacements?.includes(step.placement)
              ? `"${step.node.name}"'s title "${describePlacement(step.placement)}"`
              : `"${step.node.name} ${describePlacement(step.placement)}"`
            : `"${step.node.name} ${step.size}"`,
        ),
      ),
    ];
    const last = loop[loop.length - 1];
    if (loop.some((step) => step.size)) {
      return new SourceError(
        said.length === 1
          ? `"${node.name}" is sized from itself: ${said[0]} — measure it from something worked out without it`
          : `these depend on each other in a circle: ${said.join(', ')} — one of them has to be stated without the others`,
        last?.placement?.line ?? last?.node.line ?? node.line,
      );
    }
    if (said.length < 2) {
      return new SourceError(
        `"${node.name}" is placed against something that depends on where "${node.name}" goes` +
          (said.length === 1 ? ` (${said[0]})` : '') +
          ' — place it against something worked out without it',
        last?.placement?.line ?? node.line,
      );
    }
    return new SourceError(
      `these placements depend on each other in a circle: ${said.join(', ')} — ` +
        'one of them has to be placed against something else',
      last?.placement?.line ?? node.line,
    );
  }

  // --- a box's start -------------------------------------------------------

  private workOutStart(node: LayoutNode, axis: Axis): number {
    const parent = node.parent;
    // A heading goes where its container's title would.
    if (parent && parent.heading === node) return this.frame(parent, axis).titleStart;
    // Joined to the text: wherever the text goes, the same distance from it.
    if (parent && joinedToText(node)) return this.frame(parent, axis).textStart + this.unitStart(node, axis);
    if (this.vennPart(node) !== undefined) return this.vennStart(node, axis);
    if (parent && this.facts.get(parent)!.layout) return this.inLayout(node, axis).start;
    // The anchor of a frame placed by what it holds sits at its origin.
    if (parent && this.frameAnchor(parent, axis) === node) return 0;
    if (this.frameAnchor(node, axis)) {
      // Placed by what it holds: its frame is where its anchor went.
      const above = parent ? this.origin(parent, axis) : 0;
      return this.origin(node, axis) - above + this.frame(node, axis).boxStart;
    }
    // A container that anchors its frame shares its container's origin, so
    // its box starts where its outline does.
    if (this.floats(node, axis)) return this.frame(node, axis).boxStart;
    if (node.placements.length === 0 || this.acrossParts(node)) {
      // The anchor of its frame. One placed against a box in another part of
      // a venn is still its part's anchor; the placement moves the part. A container's title, when something is
      // placed against it, is the anchor instead; `checkAnchors` has made sure
      // there is exactly one.
      return 0;
    }
    return this.placed(node, axis);
  }

  /** Where a node joined to its container's text starts, from the text's start. */
  private unitStart(node: LayoutNode, axis: Axis): number {
    return this.remember(this.unitStarts, node, axis, () => this.placed(node, axis));
  }

  /** A box's start from its own placements. */
  private placed(node: LayoutNode, axis: Axis): number {
    const statements = this.statements(node, axis);
    if (statements.length === 0) return this.axisAnchors.has(`${node.name}\n${axis}`) ? 0 : this.lone(node, axis);
    if (statements.length === 1) {
      const [only] = statements;
      return this.apply(node, axis, only!);
    }
    const [first, second] = statements as [Statement, Statement];
    if (first.kind !== 'align' && second.kind !== 'align' && first.kind !== second.kind) {
      this.refuseBoxAndSibling(node, axis, first.placement, second.placement);
      // Opposite placements: centered between the two at its own size. Each
      // target stays where its own statement put it.
      const after = first.kind === 'after' ? first : second;
      const before = first.kind === 'after' ? second : first;
      const low = this.edgeOf(node, axis, after);
      const high = this.edgeOf(node, axis, before);
      return (low + high) / 2 - this.size(node, axis) / 2;
    }
    // Two pinned edges position the box and size it; `pins` checked them.
    const pins = this.pins(node, axis);
    if (pins) return pins.start;
    throw this.overStated(node, axis, statements);
  }

  /**
   * Opposite placements center a box between two others, but not when one of
   * them is its own container's box: `inside c top-right  right of c.k` would
   * be neither in the corner nor a gap from `c.k` (design.org 5.3). Refused,
   * naming the two ways out: the corner's other half beside the sibling, or
   * the corner kept and the sibling held off with `stays`.
   */
  private refuseBoxAndSibling(node: LayoutNode, axis: Axis, first: Placement, second: Placement): void {
    const parent = node.parent;
    if (!parent || this.againstBox(first, parent) === this.againstBox(second, parent)) return;
    const [box, other] = this.againstBox(first, parent) ? [first, second] : [second, first];
    if (other.kind !== 'offset') return;
    const ways: string[] = [];
    const corner = box.targets[0]?.part;
    if (box.kind === 'offset' && box.written !== undefined && corner !== undefined && corner.includes('-')) {
      const [down, across] = corner.split('-') as [string, string];
      const kept = axis === 'x' ? down : across;
      ways.push(`to sit ${describePlacement(other)} at the ${kept} of ${parent.name}, write "${describePlacement(other)}  ${box.written} ${parent.name} ${kept}"`);
    }
    const way = component(other.direction, axis);
    const straight = axis === 'x' ? (way === 'after' ? 'right' : 'left') : way === 'after' ? 'below' : 'above';
    const of = axis === 'x' ? ' of' : '';
    if (other.targets.length === 1) {
      ways.push(`to stay ${describePlacement(box)} and clear of ${nameTarget(other.targets[0]!)}, write "stays ${straight}${of} ${nameTarget(other.targets[0]!)}"`);
    }
    throw new SourceError(
      `"${node.name}" says twice where it goes ${AXIS_SAID[axis]}, with "${describePlacement(box)}" and "${describePlacement(other)}"` +
        (ways.length > 0 ? `; ${ways.join('; ')}` : ' — keep one'),
      other.line,
    );
  }

  private edgeOf(node: LayoutNode, axis: Axis, statement: Statement): number {
    return this.guard(`edge\n${node.name}\n${axis}\n${statement.placement.line}`, node, axis, statement.placement, () =>
      statement.kind === 'align' ? 0 : statement.edge(),
    );
  }

  /** A box's start from one statement. */
  private apply(node: LayoutNode, axis: Axis, statement: Statement): number {
    return this.guard(`apply\n${node.name}\n${axis}`, node, axis, statement.placement, () => {
      if (statement.kind !== 'align') {
        // Measured from a part of this box (`center 12 right of a center`), or from its facing side.
        const own = this.ownPart(node, statement.placement, axis);
        return statement.kind === 'after' ? statement.edge() - own.start : statement.edge() - own.start - own.size;
      }
      const at = statement.at();
      if (statement.side === 'start') return at.start;
      if (statement.side === 'end') return at.start + at.size - this.size(node, axis);
      return at.start + at.size / 2 - this.size(node, axis) / 2;
    });
  }

  /**
   * Nothing states this axis. A lone direction on the other axis centers the
   * box on its target here, since walking right from something keeps you on
   * its center line. Two of them leave it open which target to center on, and
   * that is refused rather than decided.
   */
  private lone(node: LayoutNode, axis: Axis): number {
    const offsets = node.placements.filter(
      (placement): placement is OffsetPlacement =>
        placement.kind === 'offset' && component(placement.direction, axis) === undefined,
    );
    if (offsets.length !== 1) {
      const said = node.placements.map((placement) => `"${describePlacement(placement)}"`).join(' and ');
      throw new SourceError(
        `"${node.name}" says where it goes ${AXIS_SAID[axis === 'x' ? 'y' : 'x']} (${said}) but not ` +
          `${AXIS_SAID[axis]} — add a placement that says ${axis === 'x' ? 'how far across, such as x even with' :'how high, such as even with'} one of them`,
        node.line,
      );
    }
    const [offset] = offsets;
    return this.guard(`lone\n${node.name}\n${axis}`, node, axis, offset, () => {
      const at = this.region(node, offset!, axis);
      const own = this.ownPart(node, offset!, axis);
      return at.start + at.size / 2 - own.start - own.size / 2;
    });
  }

  /**
   * The stretch of this box a placement measures from, from the box's start:
   * the part it names, or the whole box.
   */
  private ownPart(node: LayoutNode, placement: Placement, axis: Axis): Extent {
    const whole = { start: 0, size: this.size(node, axis) };
    if (placement.kind !== 'offset' || placement.own === undefined) return whole;
    if (placement.own === 'text') {
      if (!this.hasTitle(node)) {
        throw new SourceError(`"${node.name}" measures "${describePlacement(placement)}" from its text, and it has none`, placement.line);
      }
      return this.textOf(node, axis, 0);
    }
    return narrow(whole, placement.own, axis, this.outlineOf(node));
  }

  /**
   * For a node that is not a rectangle, where the line from its middle toward
   * a point of its box meets its outline, from the box's top-left.
   */
  private outlineOf(node: LayoutNode): ((across: number, down: number) => { x: number; y: number }) | undefined {
    const body = node.body;
    if (body.kind !== 'shape' || isBoxy(body.outline)) return undefined;
    return (across, down) => {
      const width = this.size(node, 'x');
      const height = this.size(node, 'y');
      if (body.outline === 'circle') {
        // An ellipse, round when the two are equal; exact rather than sampled.
        const dx = (across - 0.5) * width;
        const dy = (down - 0.5) * height;
        const scale = dx === 0 && dy === 0 ? 0 : 1 / Math.hypot((dx * 2) / width, (dy * 2) / height);
        return { x: width / 2 + dx * scale, y: height / 2 + dy * scale };
      }
      const middle = middleOf(body.outline, body.look, width, height);
      return towardOutline(shapeOf(body.outline, body.look, width, height).polygon, middle, { x: across * width, y: down * height });
    };
  }

  private overStated(node: LayoutNode, axis: Axis, statements: Statement[]): SourceError {
    const said = [...new Set(statements.map((statement) => statement.placement))]
      .map((placement) => `"${describePlacement(placement)}"`)
      .join(' and ');
    const directions = statements.filter((statement) => statement.kind !== 'align');
    if (directions.length === 1 && directions.length < statements.length) {
      // Bare, the direction would give way to the pins (`checkYielded`); it is
      // the distance written on it that they would overrule.
      const [direction] = directions;
      const aligns = statements.filter((statement) => statement.kind === 'align');
      const pins = aligns.map((statement) => `"${describePlacement(statement.placement)}"`).join(' and ');
      return new SourceError(
        `"${node.name}" says how far away "${describePlacement(direction!.placement)}" is, but ${pins} already ` +
          `${aligns.length === 1 ? 'says' : 'say'} where it goes ${AXIS_SAID[axis]} — drop the distance to keep only the direction, or drop the direction`,
        direction!.placement.line,
      );
    }
    return new SourceError(
      `"${node.name}" says where it goes ${AXIS_SAID[axis]} more than once: ${said}. Each axis is stated ` +
        'once — keep one, or pin two opposite edges with even with to give it a size',
      statements[statements.length - 1]!.placement.line,
    );
  }

  /** Every statement a node's placements make about one axis. */
  private statements(node: LayoutNode, axis: Axis): Statement[] {
    const found: Statement[] = [];
    for (const placement of node.placements) {
      if (placement.kind === 'offset') {
        const way = component(placement.direction, axis);
        if (way === undefined) continue;
        found.push({
          kind: way,
          placement,
          edge: () => {
            const at = this.region(node, placement, axis);
            const gap = this.gapOf(node, placement, axis);
            return way === 'after' ? at.start + at.size + gap : at.start - gap;
          },
        });
      } else if (placement.kind === 'align') {
        if (placement.axis !== axis) continue;
        found.push({
          kind: 'align',
          placement,
          side: sideAlong(placement.side),
          at: () => this.region(node, placement, axis),
        });
      } else {
        found.push({ kind: 'align', placement, side: 'center', at: () => this.region(node, placement, axis) });
      }
    }
    // A bare direction beside an edge pinned on its axis gives up its distance
    // to the pin and keeps only its side, checked once everything is placed:
    // `below host.trx  top even with cat0` (design.org 5.3).
    if (!found.some((statement) => statement.kind === 'align')) return found;
    return found.filter((statement) => statement.kind === 'align' || !this.yields(statement.placement));
  }

  /** A direction with nothing said about its distance, which a pin on its axis may refine. */
  private yields(placement: Placement): placement is OffsetPlacement {
    return (
      placement.kind === 'offset' &&
      placement.gap === undefined &&
      placement.gaps === undefined &&
      placement.own === undefined &&
      placement.written === undefined
    );
  }

  /**
   * The sides that gave up their distance to a pin still have to hold: a box
   * said to be below another, and pinned beside it, is refused.
   */
  private checkYielded(node: LayoutNode): void {
    for (const axis of BOTH_AXES) {
      const pinned = node.placements.some((placement) => placement.kind === 'align' && placement.axis === axis);
      if (!pinned) continue;
      for (const placement of node.placements) {
        if (!this.yields(placement)) continue;
        const way = component(placement.direction, axis);
        if (way === undefined) continue;
        const starts = placement.targets.map((target) => this.locate(target, node.name, placement.line));
        const begin = axis === 'x' ? node.x : node.y;
        const end = begin + (axis === 'x' ? node.width : node.height);
        const held =
          way === 'after'
            ? starts.every((at) => begin >= (axis === 'x' ? at.x + at.width : at.y + at.height) - 0.5)
            : starts.every((at) => end <= (axis === 'x' ? at.x : at.y) + 0.5);
        if (held) continue;
        const pins = node.placements
          .filter((other) => other.kind === 'align' && other.axis === axis)
          .map((other) => `"${describePlacement(other)}"`)
          .join(' and ');
        const [own, theirs, past] =
          axis === 'y'
            ? way === 'after' ? ['top', 'bottom', 'above'] : ['bottom', 'top', 'below']
            : way === 'after' ? ['left', 'right', 'left of'] : ['right', 'left', 'right of'];
        throw new SourceError(
          `"${node.name}" is said to be ${describePlacement(placement)}, but ${pins} put its ${own} ${past} ` +
            `the ${theirs} of what it names — move what it is pinned to, or drop "${describePlacement(placement)}"`,
          placement.line,
        );
      }
    }
  }

  /**
   * Two alignments pinning opposite edges: `top even with a  bottom even with
   * c` positions the box and sizes it, and counts as one statement.
   */
  private pins(node: LayoutNode, axis: Axis): { start: number; size: number } | undefined {
    const parent = node.parent;
    if (parent && this.facts.get(parent)!.layout) return undefined;
    const statements = this.statements(node, axis);
    if (statements.length !== 2) return undefined;
    const [first, second] = statements as [Statement, Statement];
    if (first.kind !== 'align' || second.kind !== 'align') return undefined;
    const sides = new Set([first.side, second.side]);
    if (!sides.has('start') || !sides.has('end')) return undefined;
    const low = first.side === 'start' ? first : second;
    const high = first.side === 'start' ? second : first;
    const from = this.guard(`pin\n${node.name}\n${axis}\nlow`, node, axis, low.placement, () => low.at());
    const to = this.guard(`pin\n${node.name}\n${axis}\nhigh`, node, axis, high.placement, () => high.at());
    const start = from.start;
    const end = to.start + to.size;
    if (end < start) {
      throw new SourceError(
        `"${node.name}" pins its ${axis === 'x' ? 'left' : 'top'} edge past its ${axis === 'x' ? 'right' : 'bottom'} ` +
          `edge ("${describePlacement(low.placement)}" and "${describePlacement(high.placement)}"), which leaves it no size`,
        high.placement.line,
      );
    }
    return { start, size: end - start };
  }

  /** The gap a placement leaves, in pixels. */
  private gapOf(node: LayoutNode, placement: OffsetPlacement, axis: Axis): number {
    const each = placement.gaps?.[axis];
    if (each !== undefined) return gapPixels(each, `"${node.name}"`, placement.line);
    if (placement.gap !== undefined) return gapPixels(placement.gap, `"${node.name}"`, placement.line);
    const parent = node.parent;
    const own = parent !== undefined && placement.targets.some((target) => target.name === parent.name);
    if (own && placement.targets.some((target) => target.part === 'text')) {
      // One unit, as beside any text of one's own. An empty text takes no
      // room, and that includes the gap beside it.
      return parent.heading !== undefined || this.facts.get(parent)!.hasText ? UNIT : 0;
    }
    if (placement.written === 'inside') {
      if (!own) return GAPS['tight']!;
      // `inside hub top-right` clears the padding of the sides it names.
      const facts = this.facts.get(parent)!;
      const part = placement.targets.find((target) => target.name === parent.name)?.part ?? '';
      if (axis === 'x') return part.includes('left') ? facts.pad.left : part.includes('right') ? facts.pad.right : facts.padding;
      return part.includes('top') ? facts.pad.top : part.includes('bottom') ? facts.pad.bottom : facts.padding;
    }
    return GAPS['normal']!;
  }

  // --- targets -------------------------------------------------------------

  /** The extent on one axis of what a placement names: one target, or the region bounding several. */
  private region(node: LayoutNode, placement: Placement, axis: Axis): Extent {
    let start = Infinity;
    let end = -Infinity;
    for (const target of placement.targets) {
      const at = this.extentOf(node, target, axis, placement);
      start = Math.min(start, at.start);
      end = Math.max(end, at.start + at.size);
    }
    return { start, size: end - start };
  }

  /**
   * One target's extent on one axis, in the frame `node` is placed in: a
   * point written out, a named point or region, a fraction of the way across
   * a box, or a box and its part.
   */
  private extentOf(node: LayoutNode, target: PlacementTarget, axis: Axis, placement: Placement): Extent {
    if (target.point) return this.pointExtent(node, target.point, axis, placement);
    const defined = this.byName.has(target.name) ? undefined : this.named.get(target.name);
    if (defined) {
      const whole = this.namedExtent(node, defined, axis, placement);
      if (target.part === 'text') {
        throw new SourceError(`"${node.name}" is placed against "${nameTarget(target)}", and a ${defined.kind} has no text`, placement.line);
      }
      return this.alongFraction(whole, target, axis, () => narrow(whole, target.part, axis));
    }
    if (target.fraction) {
      const whole = this.extentOf(node, { name: target.name }, axis, placement);
      return this.alongFraction(whole, target, axis, () =>
        target.part === undefined ? whole : this.extentOf(node, { name: target.name, part: target.part }, axis, placement),
      );
    }
    return this.nodeExtent(node, target, axis, placement);
  }

  /**
   * A fraction of the way across `whole` on its own axis (`3/4 down`, `1/3
   * across from right`). On the other axis it is the side it runs along, or
   * the whole box when it was written first.
   */
  private alongFraction(whole: Extent, target: PlacementTarget, axis: Axis, otherwise: () => Extent): Extent {
    const fraction = target.fraction;
    if (!fraction || fractionAxis(fraction) !== axis) return otherwise();
    const fromEnd = fraction.along === 'up' || fraction.from === 'right';
    const at = fromEnd ? whole.start + whole.size * (1 - fraction.value) : whole.start + whole.size * fraction.value;
    return { start: at, size: 0 };
  }

  /** A named point or region, worked out in the frame `node` is placed in, with a region's padding. */
  private namedExtent(node: LayoutNode, stmt: PointStmt | RegionStmt, axis: Axis, placement: Placement): Extent {
    if (this.expanding.includes(stmt.name)) {
      const loop = [...this.expanding.slice(this.expanding.indexOf(stmt.name)), stmt.name];
      throw new SourceError(
        loop.length === 2
          ? `${stmt.kind} "${stmt.name}" is worked out from itself — name things worked out without it`
          : `these are worked out from each other in a circle: ${loop.join(' → ')} — one of them has to name something else`,
        stmt.line,
      );
    }
    this.expanding.push(stmt.name);
    try {
      if (stmt.kind === 'point') return this.extentOf(node, stmt.point, axis, placement);
      let extent: Extent;
      const [first, second] = stmt.corners;
      if (second === undefined) {
        extent = this.betweenOf(node, first.point as Extract<PointExpr, { kind: 'between' }>, axis, placement, stmt.name);
      } else {
        const a = this.extentOf(node, first, axis, placement);
        const b = this.extentOf(node, second, axis, placement);
        const start = Math.min(a.start, b.start);
        extent = { start, size: Math.max(a.start + a.size, b.start + b.size) - start };
      }
      // Outward, all round, then `padding-left:` and the rest over it on their side.
      const outward = (key: string, fallback: number): number => {
        const written = stmt.attrs[key];
        return written === undefined ? fallback : gapPixels(written, `region "${stmt.name}" ${key}:`, stmt.line);
      };
      const all = outward('padding', 0);
      const before = outward(axis === 'x' ? 'padding-left' : 'padding-top', all);
      const after = outward(axis === 'x' ? 'padding-right' : 'padding-bottom', all);
      extent = { start: extent.start - before, size: extent.size + before + after };
      const text = this.regionTexts.get(stmt.name);
      return text ? regionGrown(extent, text, axis) : extent;
    } finally {
      this.expanding.pop();
    }
  }

  /** A point written out, on one axis. */
  private pointExtent(node: LayoutNode, point: PointExpr, axis: Axis, placement: Placement): Extent {
    if (point.kind === 'between') return this.betweenOf(node, point, axis, placement);
    if (point.kind === 'from') return this.crossingOf(node, point, axis, placement);
    const from = point.from;
    const namedPoint = !this.byName.has(from.name) && this.named.get(from.name)?.kind === 'point';
    if (from.part === undefined && from.point === undefined && from.fraction === undefined && !namedPoint) {
      throw new SourceError(
        `"${describePoint(point)}" moves a point, and "${from.name}" is a whole ${this.named.has(from.name) ? 'region' : 'box'} — ` +
          `say which point, such as \`${point.distance} ${point.direction}${/left|right/.test(point.direction) ? ' of' : ''} ${from.name} ${point.direction.startsWith('above') ? 'top' : point.direction.startsWith('below') ? 'bottom' : point.direction}\``,
        placement.line,
      );
    }
    const at = this.extentOf(node, from, axis, placement);
    const way = component(point.direction, axis);
    if (way === undefined) return at;
    const by = gapPixels(point.distance, `"${describePoint(point)}"`, placement.line);
    return { start: at.start + (way === 'after' ? by : -by), size: at.size };
  }

  /**
   * `between a and b`: the space between two things. On an axis where they are
   * apart it is the gap, from `a`'s facing side to `b`'s; where they overlap,
   * the stretch they share. As a point it is the middle of that, or `at` the
   * fraction of the gap from `a`. As a region (`region` given) it is the whole
   * of it, and `(span: both)` stretches it over both boxes where they overlap
   * (design.org 4.2).
   */
  private betweenOf(
    node: LayoutNode,
    point: Extract<PointExpr, { kind: 'between' }>,
    axis: Axis,
    placement: Placement,
    region?: string,
  ): Extent {
    const pair = (on: Axis) => [this.extentOf(node, point.a, on, placement), this.extentOf(node, point.b, on, placement)] as const;
    const apart = (on: Axis) => {
      const [a, b] = pair(on);
      return a.start + a.size <= b.start + 0.01 || b.start + b.size <= a.start + 0.01;
    };
    const other: Axis = axis === 'x' ? 'y' : 'x';
    const written = describePoint(point);
    if (region !== undefined && point.span && apart('x') && apart('y')) {
      const [ax, bx] = pair('x');
      const [ay, by] = pair('y');
      const aLeft = ax.start < bx.start;
      const aAbove = ay.start < by.start;
      const a = nameTarget(point.a);
      const b = nameTarget(point.b);
      throw new SourceError(
        `region "${region}": ${a} and ${b} are apart both ways, so there are two gaps to stretch — write the one meant by its corners: ` +
          `\`region ${region}  ${point.a.name} ${aAbove ? 'top' : 'bottom'}-${aLeft ? 'right' : 'left'} to ${point.b.name} ${aAbove ? 'bottom' : 'top'}-${aLeft ? 'left' : 'right'}\` (the gap across) or ` +
          `\`region ${region}  ${point.a.name} ${aAbove ? 'bottom' : 'top'}-${aLeft ? 'left' : 'right'} to ${point.b.name} ${aAbove ? 'top' : 'bottom'}-${aLeft ? 'right' : 'left'}\` (the gap up and down)`,
        placement.line,
      );
    }
    const [a, b] = pair(axis);
    if (apart(axis)) {
      const aFirst = a.start + a.size <= b.start + 0.01;
      const from = aFirst ? a.start + a.size : a.start;
      const to = aFirst ? b.start : b.start + b.size;
      if (region !== undefined) return { start: Math.min(from, to), size: Math.abs(to - from) };
      return { start: from + (to - from) * (point.at ?? 0.5), size: 0 };
    }
    if (region === undefined && point.at !== undefined && !apart(other)) {
      throw new SourceError(
        `"${written}": ${nameTarget(point.a)} and ${nameTarget(point.b)} overlap, so there is no gap to go ${point.atWritten} of the way across`,
        placement.line,
      );
    }
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.start + a.size, b.start + b.size);
    if (region !== undefined && point.span) {
      const outer = Math.min(a.start, b.start);
      return { start: outer, size: Math.max(a.start + a.size, b.start + b.size) - outer };
    }
    if (region !== undefined) return { start, size: end - start };
    return { start: (start + end) / 2, size: 0 };
  }

  /**
   * `down from a and left from b`: where a line straight down from `a` meets
   * one straight left from `b`. The words also say which way the point lies
   * from each, and that is checked (design.org 4.3).
   */
  private crossingOf(node: LayoutNode, point: Extract<PointExpr, { kind: 'from' }>, axis: Axis, placement: Placement): Extent {
    const upright = point.lines.find((line) => line.way === 'up' || line.way === 'down')!;
    const level = point.lines.find((line) => line.way === 'left' || line.way === 'right' || line.way === 'even')!;
    const written = describePoint(point);
    /**
     * Where a line from this thing runs, on the axis it holds still. A line
     * from a whole side starts at its middle; `even with` a side running the
     * other way names no one height, as when placing a box, and is refused.
     */
    const runs = (line: typeof upright, on: Axis) => {
      const at = this.extentOf(node, line.target, on, placement);
      if (line.way === 'even' && line.target.part !== undefined && at.size > 0.01) {
        throw new SourceError(
          `"${written}": ${nameTarget(line.target)} is a whole side, with no one height to be even with — name top or bottom, or a corner`,
          placement.line,
        );
      }
      return at.start + at.size / 2;
    };
    const x = runs(upright, 'x');
    const y = runs(level, 'y');
    // Each line starts at its thing and goes the way it says; the meeting has to be on both.
    const fromUpright = (() => {
      const at = this.extentOf(node, upright.target, 'y', placement);
      return at.start + at.size / 2;
    })();
    const fromLevel = (() => {
      const at = this.extentOf(node, level.target, 'x', placement);
      return at.start + at.size / 2;
    })();
    const wrong =
      (upright.way === 'down' && y <= fromUpright) || (upright.way === 'up' && y >= fromUpright)
        ? `${upright.way} from ${nameTarget(upright.target)}`
        : (level.way === 'right' && x <= fromLevel) || (level.way === 'left' && x >= fromLevel)
          ? `${level.way} from ${nameTarget(level.target)}`
          : undefined;
    if (wrong !== undefined) {
      throw new SourceError(
        `"${written}": the two lines never meet — the point where they would cross isn't ${wrong}. ` +
          'The words say which way the point lies from each, so one of them is the wrong way round',
        placement.line,
      );
    }
    return { start: axis === 'x' ? x : y, size: 0 };
  }

  /** A box, or a part of one, on one axis, in the frame `node` is placed in. */
  private nodeExtent(node: LayoutNode, target: PlacementTarget, axis: Axis, placement: Placement): Extent {
    const named = this.byName.get(target.name);
    if (!named) {
      throw new SourceError(`"${node.name}" is placed against "${target.name}", which does not exist${partWordHint(target.name, this.byName.keys())}`, placement.line);
    }
    if (named === node || isWithin(named, node)) {
      throw new SourceError(
        `"${node.name}" is placed against ${named === node ? 'itself' : `"${named.name}", which is inside it`}`,
        placement.line,
      );
    }
    const parent = node.parent;
    let whole: Extent;
    let text: Extent | undefined;
    if (!parent) {
      // The top level is placed on the page, so anything anywhere can be named.
      whole = { start: this.page(named, axis), size: this.size(named, axis) };
      if (target.part === 'text') text = this.textOf(named, axis, whole.start);
    } else if (joinedToText(node)) {
      // Joined to the text: measured from the text's start, so the unit has
      // one shape wherever the text's position words put it. The tree pass
      // allowed nothing else to be named.
      if (named === parent) {
        whole = { start: 0, size: 0 };
        text = { start: 0, size: this.textSize(parent, axis) };
      } else {
        whole = { start: this.unitStart(named, axis), size: this.size(named, axis) };
        if (target.part === 'text') text = this.textOf(named, axis, whole.start);
      }
    } else if (named === parent && target.part === 'text' && this.anchoredOnTitle(parent)) {
      // The title anchors the frame: the text is at the origin, known without the box.
      whole = { start: 0, size: 0 };
      text = { start: 0, size: this.textSize(parent, axis) };
    } else if (named.parent === parent && joinedToText(named) && this.anchoredOnTitle(parent)) {
      // Joined to the text, which is at the origin.
      whole = { start: this.unitStart(named, axis), size: this.size(named, axis) };
      if (target.part === 'text') text = this.textOf(named, axis, whole.start);
    } else if (named === parent.heading) {
      // The heading is the title: at the origin when something is placed
      // against it, and otherwise wherever the title goes.
      whole = this.anchoredOnTitle(parent)
        ? { start: 0, size: this.size(named, axis) }
        : { start: this.start(named, axis), size: this.size(named, axis) };
      if (target.part === 'text') text = this.textOf(named, axis, whole.start);
    } else if (named === parent && target.part === 'text' && this.titleStates(parent, axis)) {
      // The title is placed against the children on this axis, so it is
      // known from them without the box.
      const titleStart = this.titlePlaced(parent, axis)!;
      const unit = this.hasUnit(parent) ? this.unit(parent, axis) : undefined;
      text = { start: unit ? titleStart - unit.start : titleStart, size: this.textSize(parent, axis) };
      whole = text;
    } else if (named === parent) {
      const frame = this.frame(parent, axis);
      whole = { start: frame.boxStart, size: frame.boxSize };
      if (target.part === 'text') text = { start: frame.textStart, size: frame.textSize };
    } else if (named.parent === parent) {
      if (this.framedOn(named, axis) && !this.framedOn(node, axis)) {
        throw new SourceError(
          `"${node.name}" is placed against "${named.name}", which is placed against "${parent.name}" itself. ` +
            `Nothing may be placed against a thing placed against its container's side or corner — place ` +
            `"${node.name}" against another child`,
          placement.line,
        );
      }
      whole = { start: this.start(named, axis), size: this.size(named, axis) };
      if (target.part === 'text') text = this.textOf(named, axis, whole.start);
    } else if (this.inOtherPart(node, named)) {
      // A box in another part of the same venn, in the venn's frame: only
      // `vennShift` asks, to find where this part goes.
      whole = { start: this.start(named, axis) + this.vennShift(named.parent!, axis), size: this.size(named, axis) };
      if (target.part === 'text') text = this.textOf(named, axis, whole.start);
    } else if (this.nestedInFrame(named, parent, axis)) {
      // Inside a sibling: measured in this frame, so a container placed on
      // the page needn't be placed before its own children are.
      whole = { start: this.within(named, parent, axis), size: this.size(named, axis) };
      if (target.part === 'text') text = this.textOf(named, axis, whole.start);
    } else {
      // Outside its container, or inside another (design.org 5.2): found on
      // the page and measured from this frame's origin.
      whole = { start: this.page(named, axis) - this.originFor(parent, axis), size: this.size(named, axis) };
      if (target.part === 'text') text = this.textOf(named, axis, whole.start);
    }
    if (target.part === 'text') {
      if (!text || (!this.hasTitle(named) && named !== parent)) {
        throw new SourceError(
          `"${node.name}" is placed against "${nameTarget(target)}", and "${named.name}" has no text`,
          placement.line,
        );
      }
      return text;
    }
    return narrow(whole, target.part, axis, this.outlineOf(named));
  }

  /** A node's text on one axis, given where the node starts. */
  private textOf(node: LayoutNode, axis: Axis, start: number): Extent {
    const facts = this.facts.get(node)!;
    if (node.children.length > 0) {
      const frame = this.frame(node, axis);
      return { start: start + frame.textStart - frame.boxStart, size: frame.textSize };
    }
    const box = facts.textBox;
    const natural = axis === 'x' ? facts.natural.width : facts.natural.height;
    const grown = this.size(node, axis) - natural;
    return {
      start: start + (axis === 'x' ? box.x : box.y) + grown / 2,
      size: axis === 'x' ? box.width : box.height,
    };
  }

  /** A child placed against its own container's box, which it does not grow. */
  framed(node: LayoutNode): boolean {
    const parent = node.parent;
    if (!parent || this.facts.get(parent)!.layout || this.facts.get(parent)!.venn) return false;
    return node.placements.some((placement) => this.againstBox(placement, parent));
  }

  /**
   * Framed on one axis: what says where it goes on that axis is against its
   * container's box. `right of c.k  inside c top` is framed down, so its height
   * is measured from the finished box, and is content across, so the box holds
   * it there (design.org 5.6).
   */
  framedOn(node: LayoutNode, axis: Axis): boolean {
    if (!this.framed(node)) return false;
    const parent = node.parent!;
    const statements = this.statements(node, axis);
    if (statements.length > 0) return statements.some((statement) => this.againstBox(statement.placement, parent));
    // Nothing states this axis, so a lone direction on the other one centers it on its target.
    return node.placements.some(
      (placement) =>
        placement.kind === 'offset' && component(placement.direction, axis) === undefined && this.againstBox(placement, parent),
    );
  }

  /** Whether a placement names its container's box, any part but the text. */
  private againstBox(placement: Placement, parent: LayoutNode): boolean {
    return placement.targets.some((target) => target.name === parent.name && target.part !== 'text');
  }

  /**
   * A child placed against its container's text, or against its heading,
   * which makes the title its frame's anchor.
   */
  private onTitle(node: LayoutNode): boolean {
    const parent = node.parent;
    if (!parent) return false;
    return node.placements.some((placement) =>
      placement.targets.some((target) => {
        if (target.name === parent.name && target.part === 'text') return true;
        if (parent.heading !== undefined && target.name === parent.heading.name) return true;
        const named = this.byName.get(target.name);
        return named !== undefined && named.parent === parent && joinedToText(named);
      }),
    );
  }

  /** The stretch a container's text and what is joined to it cover, measured from the text's start. */
  private unit(node: LayoutNode, axis: Axis): Extent {
    const key = `${node.name}\n${axis}`;
    const known = this.units.get(key);
    if (known) return known;
    const worked = this.guard(`unit\n${key}`, node, axis, undefined, () => {
      const hasText = this.facts.get(node)!.hasText;
      let low = hasText ? 0 : Infinity;
      let high = hasText ? this.textSize(node, axis) : -Infinity;
      for (const child of node.children) {
        if (!joinedToText(child)) continue;
        const start = this.unitStart(child, axis);
        const reach = this.reachOf(child, axis);
        low = Math.min(low, start - reach.low);
        high = Math.max(high, start + this.size(child, axis) + reach.high);
      }
      return low > high ? { start: 0, size: 0 } : { start: low, size: high - low };
    });
    this.units.set(key, worked);
    return worked;
  }

  /** Whether anything is joined to a container's text. */
  private hasUnit(node: LayoutNode): boolean {
    return node.children.some((child) => joinedToText(child));
  }

  /** How big a container's own text is on one axis, without what is joined to it. */
  private textSize(node: LayoutNode, axis: Axis): number {
    const facts = this.facts.get(node)!;
    return facts.hasText ? (axis === 'x' ? facts.textBox.width : facts.textBox.height) : 0;
  }

  /**
   * Whether a container's title anchors its frame, because a child is placed
   * against it. A title placed against the children is a link between them
   * instead, and the child it is placed against anchors the frame.
   */
  private anchoredOnTitle(node: LayoutNode): boolean {
    return !node.titlePlacements?.length && this.contentOf(node).some((child) => this.onTitle(child));
  }

  /**
   * The children a container's box is the outline of, besides its title: not
   * its heading, not what is joined to its text, and not those placed against
   * the box. Given an axis, a child placed against the box only on the other
   * axis is content on this one.
   */
  private contentOf(node: LayoutNode, axis?: Axis): LayoutNode[] {
    return node.children.filter(
      (child) =>
        child !== node.heading &&
        !joinedToText(child) &&
        !(axis === undefined ? this.framed(child) : this.framedOn(child, axis)),
    );
  }

  /** Whether a node has a title: its text, what is joined to it, or a heading. */
  private hasTitle(node: LayoutNode): boolean {
    return node.heading !== undefined || this.facts.get(node)!.hasText || this.hasUnit(node);
  }

  /** How big a container's title is on one axis: its heading, or its text with what is joined to it. */
  private titleSize(node: LayoutNode, axis: Axis): number {
    if (node.heading) return this.size(node.heading, axis);
    if (this.hasUnit(node)) return this.unit(node, axis).size;
    return this.textSize(node, axis);
  }

  /**
   * Where a container's title sits. A heading, or a text with something joined
   * to it, over nothing else is centered, as a leaf's text is, unless its
   * bracket says where.
   */
  private titleOf(node: LayoutNode): TitlePlace {
    const stated = node.textAttrs['place'] !== undefined;
    if ((node.heading || this.hasUnit(node)) && !stated && this.contentOf(node).length === 0) {
      return { how: 'center', side: 'center', along: 'center' };
    }
    return this.facts.get(node)!.title;
  }

  // --- sizes ---------------------------------------------------------------

  /**
   * A node's size: from two pinned edges, from its layout's stretching, or from
   * what it states or holds. Each axis's size is stated once, so a size key
   * beside pins or a stretching layout is refused.
   */
  private workOutSize(node: LayoutNode, axis: Axis): number {
    if (this.vennPart(node) !== undefined) return this.vennSize(node, axis);
    const pinned = this.pins(node, axis);
    if (pinned) {
      const keys = sizeKeysOn(node, axis);
      if (keys.length > 0) {
        const pins = this.statements(node, axis).map((statement) => `"${describePlacement(statement.placement)}"`);
        throw new SourceError(
          `"${node.name}" is pinned on both sides (${pins.join(' and ')}), which gives it its ${DIMENSION[axis]}, ` +
            `and also states ${keys.join(' ')} — keep one`,
          node.line,
        );
      }
      return pinned.size;
    }
    const parent = node.parent;
    if (parent && parent.heading !== node && !joinedToText(node) && this.stretches(parent, axis)) {
      const laid = this.inLayout(node, axis);
      if (laid.size !== undefined) return laid.size;
    }
    return this.ownSize(node, axis);
  }

  /** Whether a laid-out container sets its children's size on this axis. */
  private stretches(parent: LayoutNode, axis: Axis): boolean {
    const layout = this.facts.get(parent)!.layout;
    return layout !== undefined && (layout.kind === 'deck' || (axis === 'x' && layout.widths !== 'natural'));
  }

  /** A node's size from what it states, or else what it holds, within its limits. */
  private ownSize(node: LayoutNode, axis: Axis): number {
    return this.remember(this.owns, node, axis, () => {
      const dimension = DIMENSION[axis];
      const stated = node.appearance[dimension];
      const value = stated === undefined ? this.naturalSize(node, axis) : this.measure(node, dimension, stated);
      const least = node.appearance[`min-${dimension}`];
      const most = node.appearance[`max-${dimension}`];
      const low = least === undefined ? 0 : this.measure(node, `min-${dimension}`, least);
      const high = most === undefined ? Infinity : this.measure(node, `max-${dimension}`, most);
      if (low > high) {
        throw new SourceError(
          `"${node.name}" has min-${dimension}: ${least} larger than its max-${dimension}: ${most}, which leaves no ${dimension} it may be`,
          node.line,
        );
      }
      return Math.min(Math.max(value, low), high);
    });
  }

  /** What a node's own contents make it, before anything stretches it. */
  private naturalSize(node: LayoutNode, axis: Axis): number {
    const facts = this.facts.get(node)!;
    if (node.children.length === 0) return axis === 'x' ? facts.natural.width : facts.natural.height;
    return this.outline(node, axis).natural;
  }

  /** Work out one size key's value, in pixels. */
  private measure(node: LayoutNode, key: string, written: string): number {
    const dimension = SIZE_KEYS[key]!;
    const axis: Axis = dimension === 'width' ? 'x' : 'y';
    const size = storedSize(written, key, `"${node.name}"`, node.line);
    return this.guard(`measure\n${node.name}\n${key}`, node, axis, undefined, () => this.evaluate(node, key, size), `${key}: ${written}`);
  }

  private evaluate(node: LayoutNode, key: string, size: SizeExpr): number {
    const dimension = SIZE_KEYS[key]!;
    const facts = this.facts.get(node)!;
    switch (size.kind) {
      case 'number':
        if (size.unit === 'px') return size.value;
        if (size.unit === 'unit') return size.value * UNIT;
        // Room for this much text: the lines or characters, and the padding round them.
        return size.value * (size.unit === 'lines' ? facts.lineHeight : facts.charWidth) + padBefore(facts, DIMENSION_AXIS[dimension]) + padAfter(facts, DIMENSION_AXIS[dimension]);
      case 'own':
        if (size.dimension === dimension) {
          throw new SourceError(`"${node.name}" ${key}: ${size.dimension} measures itself — measure it from something else`, node.line);
        }
        return this.size(node, size.dimension === 'width' ? 'x' : 'y');
      case 'measure': {
        const named = this.sized(node, key, size.name);
        const measured = size.dimension ?? dimension;
        return this.size(named, measured === 'width' ? 'x' : 'y');
      }
      case 'span':
        return this.span(node, key, size);
      case 'scale':
        return size.by * this.evaluate(node, key, size.of);
      case 'sum':
        return size.terms.reduce((total, term) => total + this.evaluate(node, key, term), 0);
      case 'pick': {
        const first = this.evaluate(node, key, size.first);
        const second = this.evaluate(node, key, size.second);
        return size.which === 'larger' ? Math.max(first, second) : Math.min(first, second);
      }
    }
  }

  /** The box a size names. */
  private sized(node: LayoutNode, key: string, name: string): LayoutNode {
    const named = this.byName.get(name);
    if (named) return named;
    const dot = name.lastIndexOf('.');
    const last = name.slice(dot + 1);
    if (dot !== -1 && (last === 'width' || last === 'height')) {
      throw new SourceError(
        `"${node.name}" ${key}: ${name} — a dot names a child, so write the measurement after a space: ${name.slice(0, dot)} ${last}`,
        node.line,
      );
    }
    throw new SourceError(`"${node.name}" ${key}: measures "${name}", which does not exist${partWordHint(name, this.byName.keys())}`, node.line);
  }

  /**
   * `a top to c bottom`: the distance between two edges. Both are found in the
   * frame of the innermost container holding them both, so a span between two
   * children never waits on their container's box.
   */
  private span(node: LayoutNode, key: string, size: Extract<SizeExpr, { kind: 'span' }>): number {
    const axisOf = (side: SpanSide): Axis | undefined =>
      side === 'top' || side === 'bottom' ? 'y' : side === 'left' || side === 'right' ? 'x' : undefined;
    const fromAxis = axisOf(size.from.side);
    const toAxis = axisOf(size.to.side);
    if (fromAxis && toAxis && fromAxis !== toAxis) {
      throw new SourceError(
        `"${node.name}" ${key}: ${size.from.name} ${size.from.side} to ${size.to.name} ${size.to.side} — a span runs between ` +
          'two edges on one axis, such as top to bottom or left to right',
        node.line,
      );
    }
    const axis = fromAxis ?? toAxis ?? (SIZE_KEYS[key] === 'width' ? 'x' : 'y');
    const from = this.sized(node, key, size.from.name);
    const to = this.sized(node, key, size.to.name);
    const common = commonFrame(from, to);
    const edge = (named: LayoutNode, side: SpanSide): number => {
      const start = this.within(named, common, axis);
      const length = named === common ? this.frame(named, axis).boxSize : this.size(named, axis);
      return start + (side === 'center' ? length / 2 : side === 'bottom' || side === 'right' ? length : 0);
    };
    const length = edge(to, size.to.side) - edge(from, size.from.side);
    if (length < 0) {
      throw new SourceError(
        `"${node.name}" ${key}: ${size.from.name} ${size.from.side} to ${size.to.name} ${size.to.side} runs backward — ` +
          `${size.to.name} ${size.to.side} comes before ${size.from.name} ${size.from.side}, so name them the other way round`,
        node.line,
      );
    }
    return length;
  }

  /**
   * Whether `named` sits inside a sibling within `frame`'s frame, with every
   * container between them placed in that frame rather than by what it holds.
   */
  private nestedInFrame(named: LayoutNode, frame: LayoutNode, axis: Axis): boolean {
    let container = named.parent;
    if (!container || container === frame) return false;
    for (; container && container !== frame; container = container.parent) {
      if (this.frameAnchor(container, axis) || this.vennPart(container) !== undefined || this.facts.get(container)!.venn) return false;
    }
    return container === frame;
  }

  /** Where a node starts in the frame of `frame`, one of its containers, or on the page when that is undefined. */
  private within(node: LayoutNode, frame: LayoutNode | undefined, axis: Axis): number {
    if (node === frame) return this.frame(node, axis).boxStart;
    const parent = node.parent;
    if (parent === frame) return this.start(node, axis);
    return this.within(parent!, frame, axis) - this.frame(parent!, axis).boxStart + this.start(node, axis);
  }

  // --- containers ----------------------------------------------------------

  /**
   * A container on one axis: its box in its own frame, and where its title
   * sits. The box is the outline of what it holds, plus padding: the children
   * not placed against the box itself, and the title when it sits inside the
   * border or on it.
   */
  private workOutFrame(node: LayoutNode, axis: Axis, room: Room = NO_ROOM): FrameAxis {
    const facts = this.facts.get(node)!;
    const title = this.titleOf(node);
    const hasTitle = this.hasTitle(node);
    const titleSize = this.titleSize(node, axis);
    const content = this.contentOf(node, axis);
    const anchoredOnTitle = this.anchoredOnTitle(node);

    let low = Infinity;
    let high = -Infinity;
    for (const child of content) {
      const start = this.start(child, axis);
      const reach = this.reachOf(child, axis);
      low = Math.min(low, start - reach.low);
      high = Math.max(high, start + this.size(child, axis) + reach.high);
    }
    // A venn's set wraps the overlap as well as its own children.
    const shared = this.vennPhantom(node, axis);
    if (shared) {
      low = Math.min(low, shared.start);
      high = Math.max(high, shared.start + shared.size);
    }
    const empty = low > high;
    if (empty) {
      low = 0;
      high = 0;
    }
    // A laid-out container's content spans the whole band its children are
    // lined up in.
    if (!empty && facts.layout) {
      this.inLayout(content[0]!, axis);
      const band = this.bands.get(`${node.name}\n${axis}`);
      if (band !== undefined) {
        low = Math.min(low, 0);
        high = Math.max(high, band);
      }
    }
    // Room a child's limit asks for (design.org 5.6), between what the box
    // holds and its sides, so a title against a side moves out with it.
    if (!empty) {
      low -= room.low;
      high += room.high;
    }

    // Where the title sits in the frame. When something is placed against it,
    // it is the frame's anchor and sits at the origin; otherwise it is placed
    // against the children by its side.
    const across = title.side === 'top' || title.side === 'bottom' ? 'x' : 'y';
    const gapToTitle = axis === 'x' ? HEADER_GAP : HEADER_GAP;
    // With something joined to the text, the title is the whole unit, and the
    // text sits inside it; a frame the title anchors has the text at its origin.
    const unit = this.hasUnit(node) ? this.unit(node, axis) : undefined;
    let titleStart: number;
    if (anchoredOnTitle || empty) {
      titleStart = unit ? unit.start : 0;
      if (empty && !anchoredOnTitle && hasTitle) {
        low = titleStart;
        high = titleStart + titleSize;
      }
      if (empty) {
        low -= room.low;
        high += room.high;
      }
    } else if (title.how === 'center' || title.side === 'center') {
      titleStart = (low + high) / 2 - titleSize / 2;
    } else if (axis === across && titleSize > high - low && title.how !== 'outside') {
      // A title longer than the children leaves the box room beside them, and
      // gather-children: says where in it they sit; the title spans it.
      const where = facts.gather[axis];
      titleStart = where === 'start' ? low : where === 'end' ? high - titleSize : (low + high) / 2 - titleSize / 2;
    } else if (axis === across) {
      titleStart =
        title.along === 'start' ? low : title.along === 'end' ? high - titleSize : (low + high) / 2 - titleSize / 2;
    } else if (title.how === 'on') {
      // The border runs through the title's middle, and the contents clear the
      // half of it that is inside.
      const clear = Math.max(facts.padding, titleSize / 2 + gapToTitle);
      titleStart =
        title.side === 'top' || title.side === 'left' ? low - clear - titleSize / 2 : high + clear - titleSize / 2;
    } else if (title.how === 'inside') {
      titleStart = title.side === 'top' || title.side === 'left' ? low - gapToTitle - titleSize : high + gapToTitle;
    } else {
      titleStart = 0;
    }
    // A title placed against the box's own children on this axis goes there,
    // and is content like a child: no row or column is kept for it.
    const placedTitle = hasTitle ? this.titlePlaced(node, axis) : undefined;
    if (placedTitle !== undefined) titleStart = placedTitle;

    const inBox = hasTitle && title.how !== 'outside';
    let boxLow = low;
    let boxHigh = high;
    if (inBox && !empty) {
      boxLow = Math.min(boxLow, titleStart);
      boxHigh = Math.max(boxHigh, titleStart + titleSize);
    }
    boxLow -= padBefore(facts, axis);
    boxHigh += padAfter(facts, axis);
    // A title along a side keeps `padding:` from the box's edge, so a side's
    // own padding (`padding-right: 4`) widens the room round the children
    // without walking the title in from the corner.
    if (inBox && !empty && placedTitle === undefined && axis === across && title.how !== 'center' && title.side !== 'center') {
      if (title.along === 'start') titleStart -= Math.max(0, padBefore(facts, axis) - facts.padding);
      if (title.along === 'end') titleStart += Math.max(0, padAfter(facts, axis) - facts.padding);
    }

    // On the border: the box's edge on that side runs through the title's middle.
    if (title.how === 'on' && hasTitle && axis !== across) {
      const middle = titleStart + titleSize / 2;
      if (title.side === 'top' || title.side === 'left') boxLow = middle;
      else boxHigh = middle;
    }

    // Outside the border: placed off the finished box, so it never sizes it.
    if (title.how === 'outside' && hasTitle && !anchoredOnTitle && placedTitle === undefined) {
      if (axis === across) {
        titleStart =
          title.along === 'start'
            ? boxLow
            : title.along === 'end'
              ? boxHigh - titleSize
              : (boxLow + boxHigh) / 2 - titleSize / 2;
      } else {
        titleStart = title.side === 'top' || title.side === 'left' ? boxLow - HEADER_GAP - titleSize : boxHigh + HEADER_GAP;
      }
    }

    // Grown evenly, so a centered title sits in the middle of its box, and a
    // centered title along a side sits in the middle of that side.
    if (
      inBox &&
      placedTitle === undefined &&
      (title.how === 'center' || title.side === 'center' || (axis === across && title.along === 'center'))
    ) {
      const middle = titleStart + titleSize / 2;
      const half = Math.max(middle - boxLow, boxHigh - middle);
      boxLow = middle - half;
      boxHigh = middle + half;
    }

    let natural = boxHigh - boxLow;
    if (facts.circle) {
      // The circle round the padded-in block, so whatever fits in the
      // rectangle fits in the circle, clear of it at the corners.
      const other = axis === 'x' ? 'y' : 'x';
      const otherInner = this.innerOther(node, other);
      const side = Math.hypot(natural - facts.padding * 2, otherInner) + facts.padding * 2;
      boxLow -= (side - natural) / 2;
      boxHigh = boxLow + side;
      natural = side;
    }
    return {
      boxStart: boxLow,
      boxSize: natural,
      natural,
      titleStart,
      titleSize,
      textStart: unit ? titleStart - unit.start : titleStart,
      textSize: unit ? this.textSize(node, axis) : titleSize,
    };
  }

  /**
   * A container's box at the size it ends up, when something states one: its
   * outline grown or shrunk so what it holds sits where gather-children: says,
   * the middle unless it says, and its title moved with the side it keeps to. A title something
   * is placed against is part of what it holds, and stays.
   */
  private fit(node: LayoutNode, axis: Axis): FrameAxis {
    const outline = this.outline(node, axis);
    const extra = this.size(node, axis) - outline.boxSize;
    if (extra === 0) return outline;
    const title = this.titleOf(node);
    const across: Axis = title.side === 'top' || title.side === 'bottom' ? 'x' : 'y';
    const anchored = this.anchoredOnTitle(node);
    // The children sit in the room where gather-children: says, the middle
    // unless it says; the box grows away from them.
    const share = { start: 0, center: 0.5, end: 1 };
    const part = this.vennPart(node);
    // A venn's set whose box is said grows to it, not about its middle.
    const box = axis === 'y' && part !== undefined && part !== 1 ? this.vennBox(node) : undefined;
    const grow =
      box !== undefined
        ? outline.boxStart + this.vennPlan(node.parent!, 'y')[part!] - box.start
        : extra * share[this.facts.get(node)!.gather[axis]];
    let shift = 0;
    if (!anchored && title.how !== 'center' && title.side !== 'center' && !this.titleStates(node, axis)) {
      const toward = axis === across ? title.along : title.side === 'top' || title.side === 'left' ? 'start' : 'end';
      shift = extra * share[toward] - grow;
    }
    return {
      ...outline,
      boxStart: outline.boxStart - grow,
      boxSize: outline.boxSize + extra,
      titleStart: outline.titleStart + shift,
      textStart: outline.textStart + shift,
    };
  }

  /** The title's placements that state one axis. */
  private titleStatementsOn(node: LayoutNode, axis: Axis): Placement[] {
    return (node.titlePlacements ?? []).filter((placement) =>
      placement.kind === 'offset'
        ? component(placement.direction, axis) !== undefined
        : placement.kind === 'align'
          ? placement.axis === axis
          : true,
    );
  }

  /** Whether the title's bracket places it on this axis with a placement. */
  private titleStates(node: LayoutNode, axis: Axis): boolean {
    return this.titleStatementsOn(node, axis).length > 0;
  }

  /**
   * Where a title placed against the box's own children starts on one axis,
   * in the box's frame, or undefined when no placement states the axis and
   * its side words place it (design.org 7.2). Each axis is stated once.
   */
  private titlePlaced(node: LayoutNode, axis: Axis): number | undefined {
    const placements = this.titleStatementsOn(node, axis);
    if (placements.length === 0) return undefined;
    const subject = `"${node.name}"'s title`;
    const said = placements.map((placement) => `"${describePlacement(placement)}"`).join(' and ');
    const line = placements[0]!.line;
    // Opposite placements center the title between them, as they center a box (5.3).
    const ways = placements.map((placement) => (placement.kind === 'offset' ? component(placement.direction, axis) : undefined));
    const opposite = placements.length === 2 && ways[0] !== undefined && ways[1] !== undefined && ways[0] !== ways[1];
    if (placements.length > 1 && !opposite) {
      throw new SourceError(
        `${subject} says where it goes ${AXIS_SAID[axis]} more than once: ${said}. Each axis is stated once — keep one, ` +
          'or place it after one thing and before another to center it between them',
        line,
      );
    }
    // The side words state the axis across their side, and align: the axis
    // along it; a placement may take whichever of the two they leave unsaid.
    const place = node.textAttrs['place'];
    const side = place?.split(' ')[1];
    const across: Axis = side === 'left' || side === 'right' ? 'x' : 'y';
    const words =
      place === 'center'
        ? ['x', 'y']
        : [...(place !== undefined ? [across] : []), ...(node.textAttrs['align'] !== undefined ? [across === 'x' ? 'y' : 'x'] : [])];
    if (words.includes(axis)) {
      const written = [place, node.textAttrs['align'] !== undefined ? `align: ${node.textAttrs['align']}` : undefined]
        .filter((one) => one !== undefined)
        .join(', ');
      throw new SourceError(
        `${subject} says where it goes ${AXIS_SAID[axis]} twice: "${written}" and ${said}. Each axis is stated once — keep one`,
        line,
      );
    }
    const size = this.titleSize(node, axis);
    if (opposite) {
      const after = ways[0] === 'after' ? placements[0]! : placements[1]!;
      const before = ways[0] === 'after' ? placements[1]! : placements[0]!;
      const low = this.titleStart(node, axis, after, subject);
      const high = this.titleStart(node, axis, before, subject) + size;
      return (low + high) / 2 - size / 2;
    }
    return this.titleStart(node, axis, placements[0]!, subject);
  }

  /** Where one placement of a title against the box's own children puts the title's start. */
  private titleStart(node: LayoutNode, axis: Axis, placement: Placement, subject: string): number {
    // A child may be placed against a title placed against another child; a
    // title placed against the very child placed against it is caught as a
    // circle by the guard.
    return this.guard(`title\n${node.name}\n${axis}\n${placement.line}\n${describePlacement(placement)}`, node, axis, placement, () => {
      let start = Infinity;
      let end = -Infinity;
      for (const target of placement.targets) {
        const child = node.children.find((one) => one.name === target.name);
        if (!child) {
          throw new SourceError(
            `${subject} is placed against "${target.name}", which is not one of "${node.name}"'s own children — ` +
              'a title is placed against the box it names, by its sides, or against its children',
            placement.line,
          );
        }
        const whole = { start: this.start(child, axis), size: this.size(child, axis) };
        const at =
          target.part === 'text'
            ? this.textOf(child, axis, whole.start)
            : narrow(whole, target.part, axis, this.outlineOf(child));
        start = Math.min(start, at.start);
        end = Math.max(end, at.start + at.size);
      }
      const size = this.titleSize(node, axis);
      if (placement.kind === 'offset') {
        const gap =
          placement.gap !== undefined ? gapPixels(placement.gap, subject, placement.line) : GAPS['normal']!;
        return component(placement.direction, axis) === 'after' ? end + gap : start - gap - size;
      }
      const along = placement.kind === 'align' ? sideAlong(placement.side) : 'center';
      if (along === 'start') return start;
      if (along === 'end') return end - size;
      return (start + end) / 2 - size / 2;
    });
  }

  /** The padded-in block of a circle on the other axis, which its diameter depends on as well. */
  private innerOther(node: LayoutNode, axis: Axis): number {
    const key = `inner\n${node.name}\n${axis}`;
    return this.guard(key, node, axis, undefined, () => {
      const content = this.contentOf(node, axis);
      let low = Infinity;
      let high = -Infinity;
      for (const child of content) {
        low = Math.min(low, this.start(child, axis));
        high = Math.max(high, this.start(child, axis) + this.size(child, axis));
      }
      const titleSize = this.titleSize(node, axis);
      const title = this.titleOf(node);
      const along = title.side === 'top' || title.side === 'bottom' ? 'x' : 'y';
      if (low > high) return titleSize;
      return axis === along ? Math.max(high - low, titleSize) : high - low + (titleSize > 0 ? titleSize + HEADER_GAP : 0);
    });
  }

  /**
   * A child of a laid-out container: placed by the layout, in written order,
   * and never by itself.
   */
  private inLayout(node: LayoutNode, axis: Axis): { start: number; size?: number } {
    const parent = node.parent!;
    const key = `${node.name}\n${axis}`;
    const known = this.laid.get(key);
    if (known) return known;
    const layout = this.facts.get(parent)!.layout!;
    const main: Axis = layout.kind === 'column' ? 'y' : 'x';
    const children = parent.children.filter((child) => child !== parent.heading && !joinedToText(child));
    const natural = (child: LayoutNode, on: Axis) => this.ownSize(child, on);
    if (layout.kind === 'deck') {
      // Every card is as big as the biggest. The first is in front, and each
      // next one a step up and to the left behind it.
      const size = Math.max(...children.map((child) => natural(child, axis)));
      const last = children.length - 1;
      children.forEach((child, index) => this.laid.set(`${child.name}\n${axis}`, { start: (last - index) * DECK_STEP, size }));
      return this.laid.get(key)!;
    }
    if (axis !== main && this.stretches(parent, axis)) {
      for (const child of children) {
        const keys = sizeKeysOn(child, axis);
        if (keys.length > 0) {
          throw new SourceError(
            `"${child.name}" states ${keys.join(' ')}, but "${parent.name}" has layout: ${layout.kind} ` +
              `(widths: ${layout.widths}), which sets every child's width — drop one`,
            child.line,
          );
        }
      }
    }
    if (axis === main) {
      let cursor = 0;
      children.forEach((child, index) => {
        const size = natural(child, axis);
        if (layout.centers !== undefined) {
          this.laid.set(`${child.name}\n${axis}`, { start: index * layout.centers - size / 2 });
        } else {
          this.laid.set(`${child.name}\n${axis}`, { start: cursor });
          cursor += size + layout.gap!;
        }
      });
    } else {
      // The band is the room the children are lined up in: as wide as the
      // widest of them. With widths: fill it is the title along the top or
      // bottom if that is wider, so they stretch under it; otherwise a wider
      // title leaves spare room, which gather-children: says where they sit in.
      let widest = Math.max(...children.map((child) => natural(child, axis)));
      const title = this.titleOf(parent);
      const titleAlong = title.side === 'top' || title.side === 'bottom';
      const band =
        layout.widths === 'fill' &&
        axis === 'x' && titleAlong && this.hasTitle(parent) && title.how !== 'outside' && title.how !== 'center'
          ? Math.max(widest, this.titleSize(parent, 'x'))
          : widest;
      if (layout.widths === 'fill') widest = band;
      this.bands.set(`${parent.name}\n${axis}`, band);
      const stretch = axis === 'x' && layout.widths !== 'natural';
      for (const child of children) {
        const size = stretch ? widest : natural(child, axis);
        const start = layout.align === 'start' ? 0 : layout.align === 'end' ? band - size : (band - size) / 2;
        this.laid.set(`${child.name}\n${axis}`, stretch ? { start, size } : { start });
      }
    }
    return this.laid.get(key)!;
  }

  // --- venn ----------------------------------------------------------------

  /** Which part of a venn a node is: 0 the left set, 1 the overlap, 2 the right set. */
  private vennPart(node: LayoutNode): 0 | 1 | 2 | undefined {
    const venn = node.parent ? this.facts.get(node.parent)!.venn : undefined;
    if (!venn) return undefined;
    const index = venn.parts.indexOf(node);
    return index === -1 ? undefined : (index as 0 | 1 | 2);
  }

  /** The outline of what a venn's part holds, in its own frame. The overlap's includes its title's width. */
  private partContent(node: LayoutNode, axis: Axis): Extent {
    let low = Infinity;
    let high = -Infinity;
    for (const child of this.contentOf(node)) {
      const start = this.start(child, axis);
      const reach = this.reachOf(child, axis);
      low = Math.min(low, start - reach.low);
      high = Math.max(high, start + this.size(child, axis) + reach.high);
    }
    if (axis === 'x' && this.vennPart(node) === 1 && this.hasTitle(node)) {
      const title = this.titleSize(node, 'x');
      if (title > high - low) {
        const middle = (low + high) / 2;
        low = middle - title / 2;
        high = middle + title / 2;
      }
    }
    return { start: low, size: high - low };
  }

  /**
   * Where each part's own frame sits in the venn's: what to add to a part's
   * coordinates. Across, the left set's contents, the overlap's and the right
   * set's in that order. The border between a pair is the crossing set's
   * padding from what is inside it, and the venn's gap from what is outside it,
   * as a box beside a container would be. Up and down, see `vennShift`.
   */
  private vennPlan(venn: LayoutNode, axis: Axis): [number, number, number] {
    const key = `venn\n${venn.name}\n${axis}`;
    const known = this.vennPlans.get(key);
    if (known) return known;
    const [left, shared, right] = this.facts.get(venn)!.venn!.parts;
    let plan: [number, number, number];
    if (axis === 'x') {
      const [l, o, r] = [left, shared, right].map((part) => this.partContent(part, axis)) as [Extent, Extent, Extent];
      const between = this.facts.get(venn)!.venn!.gap;
      const dl = -l.start;
      const dO = dl + l.start + l.size + between + this.facts.get(right)!.pad.left - o.start;
      const dr = dO + o.start + o.size + this.facts.get(left)!.pad.right + between - r.start;
      plan = [dl, dO, dr];
    } else {
      plan = [this.vennShift(left, axis), this.vennShift(shared, axis), this.vennShift(right, axis)];
    }
    this.vennPlans.set(key, plan);
    return plan;
  }

  /**
   * Where a part's frame sits in the venn's up and down. A part whose anchor
   * is placed against a box in another part goes where that puts the anchor;
   * the set that moves to line the two sets' tops or bottoms up goes there
   * (`vennAlign`); otherwise its contents are centered on the line every
   * unplaced part shares.
   */
  private vennShift(part: LayoutNode, axis: Axis): number {
    if (axis === 'x') return this.vennPlan(part.parent!, axis)[this.vennPart(part)!];
    const key = `${part.name}\n${axis}`;
    const known = this.vennShifts.get(key);
    if (known !== undefined) return known;
    const worked = this.guard(`venn shift\n${key}`, part, axis, undefined, () => {
      const anchor = this.contentOf(part).find((child) => this.acrossParts(child));
      if (anchor) {
        // The anchor sits at its frame's origin, so where its placement puts
        // it in the venn's frame is where the frame goes.
        return this.apply(anchor, axis, this.statements(anchor, axis)[0]!);
      }
      const venn = part.parent!;
      const [left, shared, right] = this.facts.get(venn)!.venn!.parts;
      const own = this.partContent(part, axis);
      const align = this.vennAlign(venn);
      if (part === shared || align?.mover !== part || align.boxOnly) return -(own.start + own.size / 2);
      const side = align.side;
      const otherSet = part === left ? right : left;
      const other = this.partContent(otherSet, axis);
      const otherShift = this.vennShift(otherSet, axis);
      const o = this.partContent(shared, axis);
      const sharedShift = this.vennShift(shared, axis);
      // The other set's box holds its own children and the overlap, so its
      // edge is the further of the two; this set's children go even with that.
      const low = Math.min(other.start + otherShift, o.start + sharedShift);
      const high = Math.max(other.start + other.size + otherShift, o.start + o.size + sharedShift);
      return (side === 'start' ? low - own.start : high - own.start - own.size) + align.by;
    });
    this.vennShifts.set(key, worked);
    return worked;
  }

  /**
   * Which set moves to line up the two sets' tops or bottoms, and by which edge.
   * `top even with` between the sets is a relation between them, not an order
   * to move the one it's written on: only where they sit against each other
   * shows, since the venn wraps them both. So the set it's written on moves,
   * unless what it would move to meet moves with it (the overlap or the other
   * set placed against it); then the other set moves, if nothing holds it.
   * A stagger on a set whose contents are held in place says where its box
   * goes, not its contents (`boxOnly`): the box starts there and still holds
   * what it wraps.
   */
  private vennAlign(venn: LayoutNode): { mover: LayoutNode; side: 'start' | 'end'; by: number; boxOnly: boolean } | undefined {
    const { parts, align } = this.facts.get(venn)!.venn!;
    const [left, shared, right] = parts;
    for (const written of [right, left]) {
      const [placement] = written.placements;
      // `layout: venn (align-children: top)` reads as the right set's `top even with` the left.
      const side = placement?.kind === 'align' ? sideAlong(placement.side) : written === right ? align : 'center';
      if (side === 'center') continue;
      const other = written === left ? right : left;
      // A set can move if nothing holds it and nothing it would be moved to meet moves with it.
      const free = (set: LayoutNode, against: LayoutNode): boolean =>
        this.anchorPart(set) === undefined && !this.leansOn(shared, set) && !this.leansOn(against, set);
      // `top even with 2 below design top`: how much lower the set it's written on sits.
      const stagger = placement === undefined ? undefined : staggerOf(placement, other);
      const by = stagger === undefined
        ? 0
        : gapPixels(stagger.distance, `"${describePoint(stagger)}"`, placement!.line) * (stagger.direction === 'below' ? 1 : -1);
      if (free(written, other)) return { mover: written, side, by, boxOnly: false };
      if (stagger !== undefined) return { mover: written, side, by, boxOnly: true };
      if (free(other, written)) return { mover: other, side, by: -by, boxOnly: false };
      const held = [other, written, shared]
        .flatMap((part) => this.contentOf(part))
        .find((child) => this.acrossParts(child))!;
      const said = placement ? `"${written.name}" has "${describePlacement(placement)}"` : `venn "${venn.name}" has align-children: ${side === 'start' ? 'top' : 'bottom'}`;
      throw new SourceError(
        `${said}, and "${held.name}" being placed against another part already decides where the two sets sit up and down — say it once`,
        placement ? written.line : venn.line,
      );
    }
    return undefined;
  }

  /** Whether a venn part moves with `part`: its anchor is placed against a box in `part`, directly or through the third part. */
  private leansOn(from: LayoutNode, part: LayoutNode): boolean {
    let at: LayoutNode | undefined = from;
    for (let step = 0; step < 3 && at !== undefined; step++) {
      at = this.anchorPart(at);
      if (at === part) return true;
    }
    return false;
  }

  /** The part of the same venn that this part's anchor is placed against, if it has one. */
  private anchorPart(part: LayoutNode): LayoutNode | undefined {
    const anchor = this.contentOf(part).find((child) => this.acrossParts(child));
    if (!anchor) return undefined;
    for (const placement of anchor.placements) {
      for (const target of placement.targets) {
        const named = this.byName.get(target.name);
        if (named !== undefined && this.inOtherPart(anchor, named)) return named.parent;
      }
    }
    return undefined;
  }

  /** Whether `named` is a child of a different part of the venn `node`'s part belongs to. */
  private inOtherPart(node: LayoutNode, named: LayoutNode): boolean {
    const part = node.parent;
    const other = named.parent;
    if (!part || !other || part === other || this.vennPart(part) === undefined) return false;
    return other.parent === part.parent && this.vennPart(other) !== undefined;
  }

  /** A child of a venn's part placed against a box in another part, which `checkAnchors` lets only the part's anchor be. */
  private acrossParts(node: LayoutNode): boolean {
    return node.placements.some((placement) =>
      placement.targets.some((target) => {
        const named = this.byName.get(target.name);
        return named !== undefined && this.inOtherPart(node, named);
      }),
    );
  }

  /** The overlap's contents in a set's own frame, which the set's box wraps as well as its own. */
  private vennPhantom(node: LayoutNode, axis: Axis): Extent | undefined {
    const part = this.vennPart(node);
    if (part === undefined || part === 1) return undefined;
    const venn = node.parent!;
    const plan = this.vennPlan(venn, axis);
    const shared = this.partContent(this.facts.get(venn)!.venn!.parts[1], axis);
    return { start: shared.start + plan[1] - plan[part], size: shared.size };
  }

  /** Where a venn's part starts in the venn's frame. */
  private vennStart(node: LayoutNode, axis: Axis): number {
    const part = this.vennPart(node)!;
    if (part === 1) return this.strip(node.parent!, axis).start;
    return this.frame(node, axis).boxStart + this.vennPlan(node.parent!, axis)[part];
  }

  /** A venn's part's size: a set wraps what it holds, or takes the box `vennBox` gives it; the overlap is where they cross. */
  private vennSize(node: LayoutNode, axis: Axis): number {
    const venn = node.parent!;
    if (this.vennPart(node) === 1) return this.strip(venn, axis).size;
    const box = axis === 'y' ? this.vennBox(node) : undefined;
    return box === undefined ? this.ownSize(node, axis) : box.size;
  }

  /**
   * A set's box up and down in the venn's frame, where it is not just the
   * outline round what it holds. With `heights: equal`, the span from the
   * higher set's top to the lower one's bottom, which both boxes then cover,
   * so they start and end together however their contents are lined up; a set
   * staggered by `top even with 2 below …` keeps its stagger, its box the span
   * moved by that much. A stagger that places only the box (`vennAlign`'s
   * `boxOnly`) moves the side it names, and the box must still hold its contents.
   */
  private vennBox(set: LayoutNode): Extent | undefined {
    const venn = set.parent!;
    const facts = this.facts.get(venn)!.venn!;
    const plan = this.vennPlan(venn, 'y');
    const natural = (part: LayoutNode): { start: number; end: number } => {
      const outline = this.outline(part, 'y');
      const at = outline.boxStart + plan[this.vennPart(part)!];
      return { start: at, end: at + outline.boxSize };
    };
    const align = this.vennAlign(venn);
    const by = align?.mover === set ? align.by : 0;
    if (facts.heights === 'equal') {
      const [low, high] = [facts.parts[0], facts.parts[2]].map((part) => {
        const shift = align?.mover === part ? align.by : 0;
        const box = natural(part);
        return { start: box.start - shift, end: box.end - shift };
      }) as [{ start: number; end: number }, { start: number; end: number }];
      const start = Math.min(low.start, high.start);
      return { start: start + by, size: Math.max(low.end, high.end) - start };
    }
    if (align?.mover !== set || !align.boxOnly) return undefined;
    const own = natural(set);
    const other = natural(set === facts.parts[0] ? facts.parts[2] : facts.parts[0]);
    const placement = set.placements[0]!;
    const start = align.side === 'start' ? other.start + by : own.start;
    const end = align.side === 'end' ? other.end + by : own.end;
    const short = Math.max(start - own.start, own.end - end);
    if (short > 0) {
      throw new SourceError(
        `"${set.name}" has "${describePlacement(placement)}", which would cut ${short / UNIT} units into what it holds, ` +
          `since what it holds is placed against another part — move it ${align.side === 'start' ? 'up' : 'down'} by at least that`,
        placement.line,
      );
    }
    return { start, size: end - start };
  }

  /** Where a venn's two sets cross, in the venn's frame. */
  private strip(venn: LayoutNode, axis: Axis): Extent {
    const [left, , right] = this.facts.get(venn)!.venn!.parts;
    const leftStart = this.start(left, axis);
    const rightStart = this.start(right, axis);
    const leftEnd = leftStart + this.size(left, axis);
    const rightEnd = rightStart + this.size(right, axis);
    if (axis === 'x') return { start: rightStart, size: leftEnd - rightStart };
    const start = Math.max(leftStart, rightStart);
    return { start, size: Math.min(leftEnd, rightEnd) - start };
  }

  /**
   * The overlap's frame: the strip where the sets cross, with no border of its
   * own. Its title is centered across the strip, on the row of the title of
   * the set whose top is lower, so the strip's contents start below it.
   */
  private stripFrame(node: LayoutNode, axis: Axis): FrameAxis {
    const venn = node.parent!;
    const [left, , right] = this.facts.get(venn)!.venn!.parts;
    const plan = this.vennPlan(venn, axis);
    const strip = this.strip(venn, axis);
    const boxStart = strip.start - plan[1];
    const titleSize = this.titleSize(node, axis);
    let titleStart: number;
    if (axis === 'x') {
      titleStart = boxStart + (strip.size - titleSize) / 2;
    } else {
      const lower = this.start(left, 'y') >= this.start(right, 'y') ? 0 : 2;
      const set = lower === 0 ? left : right;
      titleStart = this.hasTitle(set)
        ? this.frame(set, 'y').titleStart + plan[lower] - plan[1]
        : boxStart + this.facts.get(node)!.padding;
    }
    return { boxStart, boxSize: strip.size, natural: strip.size, titleStart, titleSize, textStart: titleStart, textSize: titleSize };
  }

  // --- anchors -------------------------------------------------------------

  /**
   * Exactly one box in each frame says nothing about where it goes, and every
   * other is placed against it, directly or through others. In a container a
   * title something is placed against anchors the frame instead.
   */
  private checkAnchors(all: LayoutNode[], parent: LayoutNode | undefined): void {
    // A heading goes where the title would, and anchors nothing; the tree
    // pass refused any placement on it. What is joined to the text goes with
    // the title, placed against the text.
    const members = all.filter((member) => member !== parent?.heading && !(parent && joinedToText(member)));
    const venn = parent ? this.facts.get(parent)!.venn : undefined;
    if (parent && venn) {
      // The venn places its three parts. A set may line its top or bottom up
      // with the other set's instead of being centered on it, or with that
      // side moved up or down by a distance, and nothing else.
      const [left, shared, right] = venn.parts;
      for (const child of members) {
        const other = child === left ? right : child === right ? left : undefined;
        for (const placement of child.placements) {
          const [target] = placement.targets;
          const lines = other !== undefined && placement.kind === 'align' && placement.axis === 'y' &&
            placement.targets.length === 1 &&
            ((target!.name === other.name && target!.part === undefined && target!.fraction === undefined && target!.point === undefined) ||
              staggerOf(placement, other) !== undefined);
          if (lines && child.placements.length === 1) continue;
          throw new SourceError(
            child === shared
              ? `"${child.name}" places itself ("${describePlacement(placement)}"), but it is the overlap of venn "${parent.name}", ` +
                  'which goes where the two sets cross — drop the placement'
              : other === undefined
                ? `"${child.name}" places itself ("${describePlacement(placement)}"), but "${parent.name}" has layout: venn, ` +
                    'which places each of its parts — drop the placement'
                : `"${child.name}" places itself ("${describePlacement(placement)}"), but it is a set of venn "${parent.name}", ` +
                    `which sets it beside the other and centers it — the one thing a set may say is top even with ${other.name} ` +
                    `or bottom even with ${other.name}, or that side moved, such as top even with 2 below ${other.name} top`,
            placement.line,
          );
        }
      }
      if (left.placements.length > 0 && right.placements.length > 0) {
        throw new SourceError(
          `"${left.name}" and "${right.name}" are each lined up with the other — say it on one of them`,
          right.placements[0]!.line,
        );
      }
    } else if (parent && this.facts.get(parent)!.layout) {
      for (const child of members) {
        const [placement] = child.placements;
        if (placement) {
          throw new SourceError(
            `"${child.name}" places itself ("${describePlacement(placement)}"), but "${parent.name}" has a layout:, ` +
              'which places every child — drop the placement, or the layout: to place each child by hand',
            placement.line,
          );
        }
      }
    } else if (members.length > 0) {
      if (parent && this.vennPart(parent) !== undefined) this.checkAcrossParts(members, parent);
      const content = members.filter((member) => !this.framed(member));
      const unplaced = content.filter((member) => this.unplaced(member));
      const onTitle = content.find((member) => this.onTitle(member));
      if (unplaced.length === 0 && !(parent && this.anchoredOnTitle(parent))) this.splitAnchors(content, parent);
      if (unplaced.length > 1) {
        const names = unplaced.map((node) => `"${node.name}"`).join(', ');
        throw new SourceError(
          parent
            ? `"${parent.name}" has ${unplaced.length} children that say nothing about where they go (${names}). ` +
                'One is the anchor and the rest are placed against it — or give the container a layout: such as ' +
                'layout: column to place them in order'
            : `exactly one node may say nothing about where it goes, but ${unplaced.length} do: ${names}`,
          unplaced[1]!.line,
        );
      }
      if (parent && unplaced.length === 1 && onTitle && this.anchoredOnTitle(parent)) {
        throw new SourceError(
          `"${parent.name}" has two anchors: "${unplaced[0]!.name}" says nothing about where it goes, and ` +
            `"${onTitle.name}" is placed against "${parent.name} text" — place "${unplaced[0]!.name}" against one of them`,
          unplaced[0]!.line,
        );
      }
    }
    for (const member of all) this.checkAnchors(member.children, member);
  }

  /**
   * Every box in a frame says something about where it goes, so the frame is
   * anchored one axis at a time (design.org 5.3): across by the one box that
   * says nothing across, up and down by the one that says nothing up and
   * down. A lone direction's centering counts as saying nothing when its
   * target's place on that axis is worked out from the box itself, as with
   * `b right of a` and `a even with b.1`: the centering gives way to what was
   * written. An axis nobody leaves free is a circle, reported when placing,
   * and an axis a container is placed on by what it holds needs no anchor.
   */
  private splitAnchors(members: LayoutNode[], parent: LayoutNode | undefined): void {
    const free = BOTH_AXES.map((axis) =>
      parent && this.frameAnchor(parent, axis)
        ? []
        : members.filter((member) => this.statements(member, axis).length === 0 && this.loneGivesWay(member, axis)),
    );
    if (!parent && free.every((on) => on.length === 0)) {
      throw new SourceError('every node is placed relative to another, so nothing anchors the diagram', 1);
    }
    BOTH_AXES.forEach((axis, index) => {
      const on = free[index]!;
      // With the other axis bound all round there is a circle, which placing reports better.
      if (on.length > 1 && free.every((other) => other.length > 0)) {
        const names = on.map((node) => `"${node.name}"`).join(', ');
        throw new SourceError(
          `exactly one node may say nothing about where it goes ${AXIS_SAID[axis]}, but ${on.length} do: ${names}`,
          on[1]!.line,
        );
      }
      if (on.length === 1) this.axisAnchors.add(`${on[0]!.name}\n${axis}`);
    });
  }

  /** Whether a box with nothing stated on this axis is left free there: no lone direction centers it, or the one that would is placed from the box itself. */
  private loneGivesWay(node: LayoutNode, axis: Axis): boolean {
    const offsets = node.placements.filter((placement) => placement.kind === 'offset' && component(placement.direction, axis) === undefined);
    if (offsets.length === 0) return true;
    if (offsets.length > 1) return false;
    return this.namedFrom(offsets[0]!).some((named) => this.placedFrom(named, axis, node, new Set()));
  }

  /** The boxes a placement names, through points and regions. */
  private namedFrom(placement: Placement): LayoutNode[] {
    return placement.targets
      .flatMap((target) => this.boxesNamed(target, []))
      .flatMap((name) => this.byName.get(name) ?? []);
  }

  /** Whether a box's place on one axis is worked out, however indirectly, from `from` or something inside it. */
  private placedFrom(node: LayoutNode, axis: Axis, from: LayoutNode, seen: Set<LayoutNode>): boolean {
    if (node === from || isWithin(node, from)) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    const stated = this.statements(node, axis).map((statement) => statement.placement);
    const placements = stated.length > 0
      ? stated
      : node.placements.filter((placement) => placement.kind === 'offset' && component(placement.direction, axis) === undefined);
    return placements.some((placement) => this.namedFrom(placement).some((named) => this.placedFrom(named, axis, from, seen)));
  }

  /**
   * A box in a venn's part may be placed against a box in another part, and
   * then it says where its whole part goes up and down: so it must be the
   * part's anchor, say nothing else, and say nothing across, which is the venn's.
   */
  private checkAcrossParts(members: LayoutNode[], part: LayoutNode): void {
    const across = members.filter((member) => this.acrossParts(member));
    if (across.length === 0) return;
    if (across.length > 1) {
      throw new SourceError(
        `"${across[0]!.name}" and "${across[1]!.name}" are both placed against a box in another part of venn ` +
          `"${part.parent!.name}" — one box places its part; place the other against its siblings`,
        across[1]!.line,
      );
    }
    const [node] = across as [LayoutNode];
    const [placement] = node.placements as [Placement];
    const sideways =
      placement.kind === 'on' ||
      (placement.kind === 'align' && placement.axis === 'x') ||
      (placement.kind === 'offset' && component(placement.direction, 'x') !== undefined);
    const mixed = placement.targets.some((target) => {
      const named = this.byName.get(target.name);
      return named !== undefined && !this.inOtherPart(node, named);
    });
    if (mixed) {
      throw new SourceError(
        `"${node.name}" is placed against boxes in its own part and another part of venn "${part.parent!.name}" at once ` +
          '— place it against the other part only',
        placement.line,
      );
    }
    if (node.placements.length > 1 || sideways) {
      throw new SourceError(
        `"${node.name}" is placed against a box in another part of venn "${part.parent!.name}", which says where its ` +
          `part goes up and down, so it can say nothing else: the venn sets the parts side by side, and the rest of ` +
          `"${part.name}" is placed against "${node.name}" — keep only an up-and-down placement such as even with`,
        placement.line,
      );
    }
    // A stagger on the part then places only its box (`vennAlign`), so the two say different things.
    const [left, , right] = this.facts.get(part.parent!)!.venn!.parts;
    const otherSet = part === left ? right : left;
    if (part.placements.length > 0 && staggerOf(part.placements[0]!, otherSet) === undefined) {
      throw new SourceError(
        `"${part.name}" is lined up by "${describePlacement(part.placements[0]!)}" and also by "${node.name}" ` +
          `being placed against another part — say it once`,
        placement.line,
      );
    }
  }

  // --- finishing -----------------------------------------------------------

  /** The text box, how far the node reaches past its own box, and the flags the renderer reads. */
  private finish(node: LayoutNode): void {
    const facts = this.facts.get(node)!;
    if (node.children.length === 0) {
      node.textBox = this.leafText(node);
      const x = this.reachOf(node, 'x');
      const y = this.reachOf(node, 'y');
      node.reach = { left: x.low, top: y.low, right: x.high, bottom: y.high };
      return;
    }
    const x = this.frame(node, 'x');
    const y = this.frame(node, 'y');
    node.textBox = facts.hasText
      ? { x: x.textStart - x.boxStart, y: y.textStart - y.boxStart, width: x.textSize, height: y.textSize }
      : { x: 0, y: 0, width: 0, height: 0 };
    node.banded = true;
    const x2 = this.reachOf(node, 'x');
    const y2 = this.reachOf(node, 'y');
    node.reach = { left: x2.low, top: y2.low, right: x2.high, bottom: y2.high };
  }

  /**
   * Where a leaf's text sits, from the leaf's top-left. Centered unless its
   * bracket says a side, and then where a container's title would be: inside,
   * on or outside that side, at the start, middle or end along it. A picture
   * and a circle keep their text where their shape puts it.
   */
  private leafText(node: LayoutNode): { x: number; y: number; width: number; height: number } {
    const facts = this.facts.get(node)!;
    const box = facts.textBox;
    const width = this.size(node, 'x');
    const height = this.size(node, 'y');
    const title = facts.title;
    const centered = {
      x: box.x + (width - facts.natural.width) / 2,
      y: box.y + (height - facts.natural.height) / 2,
      width: box.width,
      height: box.height,
    };
    if (node.body.kind === 'shape' && !isBoxy(node.body.outline) && node.body.outline !== 'circle' && (node.textAttrs['place'] === undefined || title.how === 'center')) {
      // At the shape's own middle, which moves with its size: a triangle's stays a third of the way up.
      const middle = middleOf(node.body.outline, node.body.look, width, height);
      return { x: middle.x - box.width / 2, y: middle.y - box.height / 2, width: box.width, height: box.height };
    }
    if (node.textAttrs['place'] === undefined || title.how === 'center' || facts.circle || node.body.kind === 'icon') {
      return centered;
    }
    const sideAxis: Axis = title.side === 'top' || title.side === 'bottom' ? 'y' : 'x';
    const low = title.side === 'top' || title.side === 'left';
    const at = (axis: Axis): number => {
      const room = axis === 'x' ? width : height;
      const text = axis === 'x' ? box.width : box.height;
      if (axis !== sideAxis) {
        // Outside, an end of the text is even with the box's edge; otherwise it clears the padding.
        const inset = title.how === 'outside' ? 0 : facts.padding;
        return title.along === 'start' ? inset : title.along === 'end' ? room - inset - text : (room - text) / 2;
      }
      if (title.how === 'inside') return low ? facts.padding : room - facts.padding - text;
      if (title.how === 'on') return low ? -text / 2 : room - text / 2;
      return low ? -HEADER_GAP - text : room + HEADER_GAP;
    };
    return { x: at('x'), y: at('y'), width: box.width, height: box.height };
  }

  /**
   * How far a node reaches past its own box on one axis: its title outside the
   * border, and its children, with whatever they reach in turn. A container's
   * outline holds what its children reach, so it is worked out as soon as a
   * container asks, not after everything is placed.
   */
  private reachOf(node: LayoutNode, axis: Axis): { low: number; high: number } {
    if (node.children.length === 0) {
      // Only a text placed on or outside the border reaches past it; one that
      // spills from a box too small for it is drawn spilling and reported.
      const how = this.facts.get(node)!.title.how;
      if (node.textAttrs['place'] === undefined || how === 'inside' || how === 'center') return { low: 0, high: 0 };
      const text = this.leafText(node);
      const start = axis === 'x' ? text.x : text.y;
      const size = axis === 'x' ? text.width : text.height;
      return { low: Math.max(0, -start), high: Math.max(0, start + size - this.size(node, axis)) };
    }
    const frame = this.frame(node, axis);
    const end = frame.boxStart + frame.boxSize;
    let low = 0;
    let high = 0;
    if (this.facts.get(node)!.hasText) {
      low = Math.max(low, frame.boxStart - frame.titleStart);
      high = Math.max(high, frame.titleStart + frame.titleSize - end);
    }
    for (const child of node.children) {
      const start = this.start(child, axis);
      const reach = this.reachOf(child, axis);
      low = Math.max(low, frame.boxStart - (start - reach.low));
      high = Math.max(high, start + this.size(child, axis) + reach.high - end);
    }
    return { low, high };
  }
}

/** Room a container makes for its children's limits, beyond what it holds, on each side of one axis. */
interface Room {
  low: number;
  high: number;
}

const NO_ROOM: Room = { low: 0, high: 0 };

/** Less than this is no distance at all, for a limit worked out in floating point. */
const LIMIT_EPSILON = 0.01;

/** The axis a limit keeps to: up and down for above and below. */
function limitAxis(limit: Limit): Axis {
  return limit.way === 'above' || limit.way === 'below' ? 'y' : 'x';
}

interface FrameAxis {
  /** Where the box starts, in the container's own frame. */
  boxStart: number;
  boxSize: number;
  /** The box's size from its contents, which is its size unless something states another. */
  natural: number;
  /** The title: the text, a heading, or the text with what is joined to it. */
  titleStart: number;
  titleSize: number;
  /** The text alone, which is the title unless something is joined to it. */
  textStart: number;
  textSize: number;
}

/**
 * `top even with 2 below design top` on a venn's set: the other set's same
 * side, moved up or down. Anything else, such as its bottom or a sideways
 * move, is not a stagger.
 */
function staggerOf(placement: Placement, other: LayoutNode): Extract<PointExpr, { kind: 'moved' }> | undefined {
  if (placement.kind !== 'align' || placement.axis !== 'y' || placement.targets.length !== 1) return undefined;
  const point = placement.targets[0]!.point;
  if (point?.kind !== 'moved' || (point.direction !== 'above' && point.direction !== 'below')) return undefined;
  const from = point.from;
  const same = from.name === other.name && from.part === placement.side && from.fraction === undefined && from.point === undefined;
  return same ? point : undefined;
}

function sideAlong(side: Side): 'start' | 'center' | 'end' {
  if (side === 'top' || side === 'left') return 'start';
  if (side === 'bottom' || side === 'right') return 'end';
  return 'center';
}

/** The width or height a size key on an axis states. */
const DIMENSION: Record<Axis, Dimension> = { x: 'width', y: 'height' };
const DIMENSION_AXIS: Record<Dimension, Axis> = { width: 'x', height: 'y' };

/** The padding on the low side of an axis, the left or the top. */
function padBefore(facts: NodeFacts, axis: Axis): number {
  return axis === 'x' ? facts.pad.left : facts.pad.top;
}

/** The padding on the high side of an axis, the right or the bottom. */
function padAfter(facts: NodeFacts, axis: Axis): number {
  return axis === 'x' ? facts.pad.right : facts.pad.bottom;
}

/** The size keys a node states on one axis, as written, for quoting back. */
function sizeKeysOn(node: LayoutNode, axis: Axis): string[] {
  const dimension = DIMENSION[axis];
  return [dimension, `min-${dimension}`, `max-${dimension}`]
    .filter((key) => node.appearance[key] !== undefined)
    .map((key) => `${key}: ${node.appearance[key]}`);
}

/**
 * The container whose frame holds both ends of a span: one of them when it
 * holds the other, else the innermost container of both, or the page.
 */
function commonFrame(a: LayoutNode, b: LayoutNode): LayoutNode | undefined {
  if (a === b) return a.parent;
  if (isWithin(b, a)) return a;
  if (isWithin(a, b)) return b;
  for (let at = a.parent; at; at = at.parent) if (isWithin(b, at)) return at;
  return undefined;
}


/**
 * Narrow an extent to the part a placement named. A side leaves the axis it
 * doesn't name alone (`right` is the whole right edge); a point is a point on
 * both. On a shape other than a rectangle, a point is where the line from the
 * shape's middle toward that point of its box meets the outline: on a circle
 * a corner is halfway between its sides, on a diamond the middle of an edge.
 */
function narrow(whole: Extent, part: Part | undefined, axis: Axis, onOutline?: (across: number, down: number) => { x: number; y: number }): Extent {
  if (part === undefined || part === 'text') return whole;
  const words = part.split('-');
  const isSide = (PART_SIDES as readonly string[]).includes(part);
  const [near, far] = axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
  const named = words.includes(near!) ? 0 : words.includes(far!) ? whole.size : undefined;
  if (named === undefined && isSide) return whole;
  if (onOutline) {
    // Where on the box the point is, as fractions across and down.
    const across = words.includes('left') ? 0 : words.includes('right') ? 1 : 0.5;
    const down = words.includes('top') ? 0 : words.includes('bottom') ? 1 : 0.5;
    const point = onOutline(across, down);
    return { start: whole.start + (axis === 'x' ? point.x : point.y), size: 0 };
  }
  return { start: whole.start + (named ?? whole.size / 2), size: 0 };
}
