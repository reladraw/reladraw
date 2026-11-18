/**
 * Findings: things about a drawn picture that may look wrong. An error means
 * the file can't be drawn; a finding means "look at this". A render with
 * findings succeeds.
 *
 * Every finding is measured off the solved layout, never fixed by moving
 * anything: the picture is drawn as written, and this says where it may not
 * read as the writer meant.
 */
import { isWithin, joinedToText, type Layout, type LayoutEdge, type LayoutNode } from './model.js';
import { ARROW_MARKER_WIDTH, LINE_WIDTH, UNIT, arrowLength } from './constants.js';
import { centerOf, crossingPoints, describeEdge, faceOfNode, planSides, traceRoute, traceVisible, type Face, type Point, type Route, type SideEnds } from './lines.js';
import { clearOf, insideOutline,sizeFor } from './outline.js';
import { placeLineTexts, type PlacedText } from './linetexts.js';

/**
 * The kinds of finding, each with whether it is on when nothing says. Named in
 * the language's own nouns, since the name is what a writer types to turn one
 * off. Crossings are often fine, so they are off; the rest are almost always a
 * fault, so an agent that never thinks to ask still hears about them.
 */
export const CHECK_DEFAULTS = {
  'text-overlap': true,
  'text-overflow': true,
  'edge-node-overlap': true,
  'edge-overlap': true,
  'crowded-edge-ends': true,
  'node-overlap': true,
  'node-overflow': true,
  'edge-no-length': true,
  'edge-crossings': false,
} as const;

export type CheckKind = keyof typeof CHECK_DEFAULTS;

export const CHECK_KINDS = Object.keys(CHECK_DEFAULTS) as CheckKind[];

/** Which kinds run. */
export type Checks = Record<CheckKind, boolean>;

export function isCheckKind(word: string): word is CheckKind {
  return Object.hasOwn(CHECK_DEFAULTS, word);
}

/** One finding: the statement at fault, the kind, and what happened. */
export class Finding {
  constructor(
    readonly kind: CheckKind,
    readonly message: string,
    readonly line: number,
  ) {}

  /** `diagram.reladraw:12: warning(node-overlap): …` — the form compilers and editors already read. */
  format(file?: string): string {
    const where = file ? `${file}:${this.line}` : `line ${this.line}`;
    return `${where}: warning(${this.kind}): ${this.message}`;
  }
}

/**
 * `edge-crossings: on, crowded-edge-ends: off` — the inside of a `checks:`
 * bracket, as `--checks` takes it, laid over `base`. A kind not mentioned
 * keeps what `base` says.
 */
export function readChecks(text: string, base: Checks): Checks {
  const checks = { ...base };
  for (const entry of text.split(',')) {
    const match = /^\s*([^:\s]+)\s*:\s*(\S+)\s*$/.exec(entry);
    if (match === null) {
      throw new Error(`checks are written "kind: on" or "kind: off", found "${entry.trim()}"`);
    }
    const [, kind, value] = match;
    setCheck(checks, kind!, value!, (message) => new Error(message));
  }
  return checks;
}

/**
 * The checks a layout asks for: the defaults, then the file's
 * `diagram checks: (…)`, which arrives flattened as `checks.<kind>` and was
 * refused by the parser if it named no kind.
 */
export function fileChecks(layout: Layout): Checks {
  const checks: Checks = { ...CHECK_DEFAULTS };
  for (const [key, value] of Object.entries(layout.diagram)) {
    const kind = key.slice('checks.'.length);
    if (key.startsWith('checks.') && isCheckKind(kind)) checks[kind] = value === 'on';
  }
  return checks;
}

/** One `kind: on|off`, refused by name if either word is wrong. */
export function setCheck(checks: Checks, kind: string, value: string, fail: (message: string) => Error): void {
  if (!isCheckKind(kind)) {
    const near = nearMatch(kind, CHECK_KINDS);
    throw fail(
      `there is no check called "${kind}"` +
        (near ? ` — did you mean ${near}?` : ` — the checks are ${CHECK_KINDS.join(', ')}`),
    );
  }
  if (value !== 'on' && value !== 'off') {
    throw fail(`${kind}: takes on or off, not "${value}"`);
  }
  checks[kind] = value === 'on';
}

/** Every finding the layout has, for the kinds that are on, in line order. */
export function findings(layout: Layout, checks: Checks): Finding[] {
  const found: Finding[] = [];
  if (checks['node-overlap']) found.push(...nodeOverlaps(layout));
  if (checks['node-overflow']) found.push(...nodeOverflows(layout));
  if (checks['text-overflow']) found.push(...textOverflows(layout));
  if (checks['edge-node-overlap'] || checks['edge-overlap'] || checks['edge-no-length'] || checks['crowded-edge-ends'] || checks['edge-crossings'] || checks['text-overlap']) {
    const plan = planSides(layout);
    if (checks['edge-node-overlap']) found.push(...edgeNodeOverlaps(layout, plan.routes));
    if (checks['edge-overlap']) found.push(...edgeOverlaps(layout, plan.routes));
    if (checks['edge-no-length']) found.push(...edgesWithNoLength(layout, plan.routes));
    if (checks['crowded-edge-ends']) found.push(...crowdedEnds(plan.sides));
    if (checks['edge-crossings']) found.push(...edgeCrossings(layout, plan.routes));
    if (checks['text-overlap']) found.push(...textOverlaps(layout, plan.routes));
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * A line across a node that isn't one of its ends: drawn, since nothing is
 * avoided, and reported (design.org 6.3). A line through one of its own boxes
 * is reported too, which is what a straight line between side-by-side boxes
 * named on their far sides does. A box holding either end is the line's own
 * surroundings, not something it crosses.
 *
 * Nodes are filed in a grid first, so each line looks only at the boxes near
 * it rather than at every box.
 */
function edgeNodeOverlaps(layout: Layout, routes: Map<LayoutEdge, Route>): Finding[] {
  const found: Finding[] = [];
  const grid = new Grid(layout.nodes.filter((node) => !node.guide));
  for (const edge of layout.edges) {
    if (edge.guide) continue;
    const trace = traceRoute(routes.get(edge)!);
    for (const node of grid.near(trace)) {
      if (holdsEnd(node, edge)) continue;
      const inner = { x: node.x + 1, y: node.y + 1, width: node.width - 2, height: node.height - 2 };
      const face = faceOfNode(node);
      const through = face.round || face.outline ? crossingCircle(trace, node, face) : crossing(trace, inner);
      if (through === undefined) continue;
      const own = node === edge.from || node === edge.to;
      const words = `line ${describeEdge(edge)} ${own ? 'runs through its own box' : 'crosses node'} ${node.name}, ` +
        `${through.enters === through.leaves ? `in and out of its ${through.enters}` : `entering its ${through.enters} and leaving its ${through.leaves}`}`;
      const hint = own && edge.look.path !== 'straight'
        ? `; say which way round, such as \`via: ${node.name} top\` or \`via: ${node.name} bottom\``
        : '';
      found.push(new Finding('edge-node-overlap', words + hint, edge.line));
    }
  }
  return dropInner(found, layout);
}

/**
 * Only the outermost of several nested boxes one line crosses is reported: a
 * line across a container crosses whatever of its children it reaches too, and
 * saying so for each child repeats the one fact.
 */
function dropInner(found: Finding[], layout: Layout): Finding[] {
  const byName = new Map(layout.nodes.map((node) => [node.name, node]));
  const key = (finding: Finding): { prefix: string; node: LayoutNode | undefined } => {
    const match = /^(line .*? (?:crosses node|runs through its own box)) (\S+),/.exec(finding.message);
    return { prefix: `${finding.line}\n${match?.[1] ?? ''}`, node: byName.get(match?.[2] ?? '') };
  };
  const reported = new Set(found.map((finding) => {
    const { prefix, node } = key(finding);
    return `${prefix}\n${node?.name}`;
  }));
  return found.filter((finding) => {
    const { prefix, node } = key(finding);
    for (let at = node?.parent; at; at = at.parent) {
      if (reported.has(`${prefix}\n${at.name}`)) return false;
    }
    return true;
  });
}

/**
 * Whether a node is one of the line's ends, or holds one: the line starts or
 * ends inside it. A venn's set holds what is in the overlap too.
 */
function holdsEnd(node: LayoutNode, edge: LayoutEdge): boolean {
  for (const end of [edge.from, edge.to]) {
    for (let at = end.parent; at; at = at.parent) if (at === node) return true;
    if (inVennOverlapOf(end, node)) return true;
  }
  return false;
}

/** Which part of a venn a node is: 0 the left set, 1 the overlap, 2 the right set. */
function vennPart(node: LayoutNode): number | undefined {
  const venn = node.parent;
  if (!venn || venn.appearance['layout'] !== 'venn') return undefined;
  const index = venn.children.filter((child) => child !== venn.heading && !joinedToText(child)).indexOf(node);
  return index === -1 ? undefined : index;
}

/** Whether `node` is inside the overlap of the venn that `set` is a set of. */
function inVennOverlapOf(node: LayoutNode, set: LayoutNode): boolean {
  const part = vennPart(set);
  if (part !== 0 && part !== 2) return false;
  for (let at = node.parent; at; at = at.parent) if (at.parent === set.parent && vennPart(at) === 1) return true;
  return false;
}

/**
 * Overlap a venn states (design.org 5.x): its parts crossing each other, and
 * what is in the overlap sitting inside both sets.
 */
function vennStates(a: LayoutNode, b: LayoutNode): boolean {
  if (a.parent === b.parent && vennPart(a) !== undefined && vennPart(b) !== undefined) return true;
  return inVennOverlapOf(a, b) || inVennOverlapOf(b, a);
}

/**
 * Where a polyline first enters a box and last leaves it, as the sides it
 * crosses; undefined when it never goes inside. A point on the border is not
 * inside, so a line ending on a box's side doesn't cross it.
 */
function crossing(trace: { x: number; y: number }[], box: { x: number; y: number; width: number; height: number }): { enters: string; leaves: string } | undefined {
  const inside = (p: { x: number; y: number }): boolean =>
    p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height;
  const sideAt = (p: { x: number; y: number }): string => {
    const distances: [number, string][] = [
      [Math.abs(p.y - box.y), 'top'],
      [Math.abs(p.y - (box.y + box.height)), 'bottom'],
      [Math.abs(p.x - box.x), 'left'],
      [Math.abs(p.x - (box.x + box.width)), 'right'],
    ];
    distances.sort((a, b) => a[0] - b[0]);
    return distances[0]![1];
  };
  let enters: string | undefined;
  let leaves: string | undefined;
  for (let index = 1; index < trace.length; index += 1) {
    const a = trace[index - 1]!;
    const b = trace[index]!;
    const clip = clipSegment(a, b, box);
    if (clip === undefined) continue;
    if (enters === undefined) enters = inside(a) ? 'middle' : sideAt(clip[0]);
    leaves = inside(b) ? 'middle' : sideAt(clip[1]);
  }
  if (enters === undefined || leaves === undefined) return undefined;
  return { enters, leaves };
}

/**
 * The same for a circle, or any outline but a rectangle's, which is drawn in
 * its node's box: walked a couple of pixels at a time, a point counting as
 * inside only past a pixel within the outline, so a line ending on it doesn't
 * cross it.
 */
function crossingCircle(trace: { x: number; y: number }[], node: LayoutNode, face: Face): { enters: string; leaves: string } | undefined {
  const radius = node.width / 2 - 1;
  const center = centerOf(face);
  const polygon = face.outline;
  const inside = polygon
    ? (p: { x: number; y: number }): boolean => insideOutline(polygon, p) && clearOf(polygon, p, 1)
    : (p: { x: number; y: number }): boolean => Math.hypot(p.x - center.x, p.y - center.y) < radius;
  const sideAt = (p: { x: number; y: number }): string => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
  };
  let enters: string | undefined;
  let leaves: string | undefined;
  let was = inside(trace[0]!);
  if (was) enters = 'middle';
  for (let index = 1; index < trace.length; index += 1) {
    const a = trace[index - 1]!;
    const b = trace[index]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let step = 1; step <= steps; step += 1) {
      const p = { x: a.x + ((b.x - a.x) * step) / steps, y: a.y + ((b.y - a.y) * step) / steps };
      const is = inside(p);
      if (is && !was) enters ??= sideAt(p);
      if (!is && was) leaves = sideAt(p);
      was = is;
    }
  }
  if (enters === undefined) return undefined;
  return { enters, leaves: was ? 'middle' : (leaves ?? enters) };
}

/** The part of a segment inside a box, strictly, as its two ends; undefined when none is. */
function clipSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
): [{ x: number; y: number }, { x: number; y: number }] | undefined {
  if (box.width <= 0 || box.height <= 0) return undefined;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return undefined;
  }
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ];
}

/** Boxes filed by the cells of a coarse grid, so a line finds the boxes near it without trying every one. */
class Grid {
  private readonly cells = new Map<string, LayoutNode[]>();
  private static readonly SIZE = 160;

  constructor(nodes: LayoutNode[]) {
    for (const node of nodes) {
      for (const key of this.keys(node.x, node.y, node.x + node.width, node.y + node.height)) {
        const cell = this.cells.get(key) ?? [];
        cell.push(node);
        this.cells.set(key, cell);
      }
    }
  }

  near(trace: { x: number; y: number }[]): LayoutNode[] {
    const found = new Set<LayoutNode>();
    for (let index = 1; index < trace.length; index += 1) {
      const a = trace[index - 1]!;
      const b = trace[index]!;
      for (const key of this.keys(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
        for (const node of this.cells.get(key) ?? []) found.add(node);
      }
    }
    return [...found];
  }

  private keys(minX: number, minY: number, maxX: number, maxY: number): string[] {
    const keys: string[] = [];
    for (let i = Math.floor(minX / Grid.SIZE); i <= Math.floor(maxX / Grid.SIZE); i += 1) {
      for (let j = Math.floor(minY / Grid.SIZE); j <= Math.floor(maxY / Grid.SIZE); j += 1) keys.push(`${i},${j}`);
    }
    return keys;
  }
}

/**
 * A line between two boxes that touch has no length: it is drawn as its marks
 * at the seam, and reported (design.org 6.3).
 */
function edgesWithNoLength(layout: Layout, routes: Map<LayoutEdge, Route>): Finding[] {
  const found: Finding[] = [];
  for (const edge of layout.edges) {
    if (edge.guide) continue;
    const points = routes.get(edge)!.points;
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
    }
    if (length >= 1) continue;
    found.push(
      new Finding(
        'edge-no-length',
        `line ${describeEdge(edge)} has no length; ${edge.from.name} and ${edge.to.name} touch`,
        edge.line,
      ),
    );
  }
  return found;
}

/**
 * Ends spread on a side too short to space them: closer than an arrowhead's
 * width apart, their marks run together. Reported against the last line
 * written to land there, with the room they need beside the room there is.
 */
function crowdedEnds(sides: SideEnds[]): Finding[] {
  const found: Finding[] = [];
  for (const { node, side, ends } of sides) {
    if (node.guide) continue;
    const drawn = ends.filter((end) => !end.edge.guide);
    if (drawn.length < 2) continue;
    const across = side === 'top' || side === 'bottom';
    // Two neighbors are crowded when their marks would touch, or, where
    // neither has a mark, when the lines come within a third of a unit.
    let crowded = false;
    let want = 0;
    const anyMark = drawn.some((end) => end.edge.marks[end.which] !== 'none');
    for (let index = 1; index < drawn.length; index += 1) {
      const a = drawn[index - 1]!;
      const b = drawn[index]!;
      const apart = Math.abs(across ? b.at.x - a.at.x : b.at.y - a.at.y);
      const marked = a.edge.marks[a.which] !== 'none' || b.edge.marks[b.which] !== 'none';
      const needed = marked
        ? (markWidth(a.edge, a.which) + markWidth(b.edge, b.which)) / 2
        : (a.edge.look.thickness + b.edge.look.thickness) / 2 + UNIT / 3;
      want = Math.max(want, needed);
      if (apart < needed - EPSILON) crowded = true;
    }
    if (!crowded) continue;
    const length = across ? node.width : node.height;
    // Rounded up: rounded to the nearest, a side just short of room read as
    // needing exactly its own length.
    const needs = Math.ceil((want * (drawn.length + 1)) / UNIT) * UNIT;
    found.push(
      new Finding(
        'crowded-edge-ends',
        `${drawn.length} line ends share node ${node.name}'s ${side} side, which is ${units(length)} long; ` +
          `spaced so their ${anyMark ? 'marks' : 'lines'} don't run together they need ${units(needs)}`,
        Math.max(...drawn.map((end) => end.edge.line)),
      ),
    );
  }
  return found;
}

/**
 * How wide a line's end is drawn across the line: its mark, or the line
 * alone. The fractions are how much of its 10-unit marker box each of the
 * renderer's mark shapes spans across the line; a dot keeps an ordinary
 * line's size, and every other mark scales with the stroke.
 */
function markWidth(edge: LayoutEdge, which: 'from' | 'to'): number {
  const thickness = edge.look.thickness;
  const mark = edge.marks[which];
  if (mark === 'none') return thickness;
  if (mark === 'dot' || mark === 'odot') return (mark === 'dot' ? 0.8 : 0.82) * ARROW_MARKER_WIDTH * LINE_WIDTH;
  const across = { arrow: 1, oarrow: 0.76, diamond: 0.76, odiamond: 0.62, bar: 0.9 }[mark as string] ?? 0.9;
  return across * ARROW_MARKER_WIDTH * thickness;
}

/**
 * Two lines crossing (design.org 6.6). Often fine, which is why it is off
 * unless asked for. Found where the renderer finds the crossings it jumps, so
 * a crossing drawn is a crossing reported; reported once per pair, against the
 * later line, with how many times they cross.
 */
function edgeCrossings(layout: Layout, routes: Map<LayoutEdge, Route>): Finding[] {
  const found: Finding[] = [];
  const drawn = layout.edges.filter((edge) => !edge.guide).map((edge) => ({ edge, trace: traceRoute(routes.get(edge)!) }));
  drawn.forEach((later, index) => {
    for (const earlier of drawn.slice(0, index)) {
      const thickness = Math.max(later.edge.look.thickness, earlier.edge.look.thickness);
      const count = crossingPoints(later.trace, earlier.trace, 3 + thickness * 2 + arrowLength(thickness)).length;
      if (count === 0) continue;
      const times = count === 1 ? '' : count === 2 ? ' twice' : ` ${count} times`;
      found.push(new Finding('edge-crossings', `line ${describeEdge(later.edge)} crosses line ${describeEdge(earlier.edge)}${times}`, later.edge.line));
    }
  });
  return found;
}

/**
 * Two lines on one run for a stretch, of any length (design.org 10.1). Where
 * they part, nothing shows which went which way, so unlike a crossing it is
 * never readable. Lines that only touch or cross share nothing. A collapsed
 * bundle is the one shared run that is meant: the bus is drawn once, and its
 * members' way along it is left out of their traces here, so only what they
 * share off the bus is reported. Reported once per pair, against the later
 * line, with the length shared.
 *
 * Segments are swept by left edge, as boxes are for node-overlap, so each is
 * compared only with those beside it.
 */
function edgeOverlaps(layout: Layout, routes: Map<LayoutEdge, Route>): Finding[] {
  type Segment = { edge: LayoutEdge; a: Point; b: Point; minX: number; maxX: number };
  const segments: Segment[] = [];
  for (const edge of layout.edges) {
    if (edge.guide) continue;
    for (const trace of traceVisible(routes.get(edge)!)) {
      for (let index = 1; index < trace.length; index += 1) {
        const a = trace[index - 1]!;
        const b = trace[index]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) < EPSILON) continue;
        segments.push({ edge, a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x) });
      }
    }
  }
  segments.sort((p, q) => p.minX - q.minX);
  // A collapsed bundle between two boxes is all bus: its members share the
  // whole way, box to box, with nothing off it to report.
  const buses = new Set(layout.edges.filter((edge) => edge.bundle?.between && edge.bundle.arrangement === 'collapsed').map((edge) => edge.name));
  const busOf = (edge: LayoutEdge): string | undefined =>
    (edge.via ?? []).map((entry) => entry.stop).find((stop) => stop?.kind === 'bundle' && buses.has(stop.bundle))?.written;
  const reach = SAME_RUN + Math.max(0, ...segments.map((segment) => segment.edge.look.thickness));

  const shared = new Map<string, { earlier: LayoutEdge; later: LayoutEdge; length: number; longest: { length: number; a: Point; b: Point } }>();
  let active: Segment[] = [];
  for (const segment of segments) {
    active = active.filter((other) => other.maxX + reach >= segment.minX);
    for (const other of active) {
      // Lines one statement draws, `edge a -> b, c` or `each child of`, share
      // their way on purpose, as a collapsed bundle's members do.
      if (other.edge === segment.edge || other.edge.line === segment.edge.line) continue;
      const bus = busOf(segment.edge);
      if (bus !== undefined && bus === busOf(other.edge)) continue;
      const length = runShared(segment, other, SAME_RUN + Math.max(segment.edge.look.thickness, other.edge.look.thickness));
      if (length < EPSILON) continue;
      const [earlier, later] = other.edge.line <= segment.edge.line ? [other.edge, segment.edge] : [segment.edge, other.edge];
      const key = `${layout.edges.indexOf(earlier)} ${layout.edges.indexOf(later)}`;
      const entry = shared.get(key) ?? { earlier, later, length: 0, longest: { length: 0, a: segment.a, b: segment.b } };
      entry.length += length;
      if (length > entry.longest.length) entry.longest = { length, a: segment.a, b: segment.b };
      shared.set(key, entry);
    }
    active.push(segment);
  }

  return [...shared.values()].map(({ earlier, later, length, longest }) => {
    const across = Math.abs(longest.b.x - longest.a.x);
    const down = Math.abs(longest.b.y - longest.a.y);
    const run = down < EPSILON ? 'a level run' : across < EPSILON ? 'an upright run' : 'one run';
    return new Finding(
      'edge-overlap',
      `line ${describeEdge(later)} runs on line ${describeEdge(earlier)} for ${units(length)}, on ${run}; ` +
        `say where one of them goes, or put both in a collapsed bundle if they share the way on purpose`,
      later.line,
    );
  });
}

/**
 * Two lines whose centers are no further apart than this plus the thicker
 * one's width leave less than a pixel between them, and read as one.
 */
const SAME_RUN = 1;

/**
 * How much of segment `p` runs on segment `q`: zero unless they head the same
 * way, or opposite ways, and then the length of the stretch where both are
 * and `q` is within `near` of `p` at each end of it.
 */
function runShared(p: { a: Point; b: Point }, q: { a: Point; b: Point }, near: number): number {
  const length = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
  const along = { x: (p.b.x - p.a.x) / length, y: (p.b.y - p.a.y) / length };
  const qLength = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y);
  const sine = Math.abs(along.x * (q.b.y - q.a.y) - along.y * (q.b.x - q.a.x)) / qLength;
  if (sine > 0.05) return 0;
  const position = (point: Point) => along.x * (point.x - p.a.x) + along.y * (point.y - p.a.y);
  const offset = (point: Point) => along.x * (point.y - p.a.y) - along.y * (point.x - p.a.x);
  const [first, last] = position(q.a) <= position(q.b) ? [q.a, q.b] : [q.b, q.a];
  const start = Math.max(0, position(first));
  const end = Math.min(length, position(last));
  if (end - start < EPSILON) return 0;
  // q's distance from p's line, at a place along p, read off q itself.
  const span = position(last) - position(first);
  const offsetAt = (at: number) => offset(first) + ((offset(last) - offset(first)) * (at - position(first))) / span;
  if (Math.abs(offsetAt(start)) > near || Math.abs(offsetAt(end)) > near) return 0;
  return end - start;
}

/**
 * A text that runs out of the box it belongs inside: one placed inside the
 * border or in the middle, a leaf's or a title. A stated size is kept even
 * when the text needs more, so the text is drawn spilling and this says so.
 */
function textOverflows(layout: Layout): Finding[] {
  const found: Finding[] = [];
  for (const node of layout.nodes) {
    if (node.body.kind !== 'shape' || node.guide) continue;
    const text = node.textBox;
    if (text.width <= 0 || text.height <= 0) continue;
    const place = node.textAttrs['place'];
    if (place !== undefined && place !== 'center' && !place.startsWith('inside')) continue;
    const face = faceOfNode(node);
    if (face.outline && node.body.outline !== 'flow-collate') {
      // Any other outline than a box's: the text spills where it passes the outline.
      const { outline, look } = node.body;
      const corners = [0, 0.5, 1].flatMap((fx) => [0, 0.5, 1].map((fy) => ({ x: node.x + text.x + text.width * fx, y: node.y + text.y + text.height * fy })));
      if (corners.every((p) => insideOutline(face.outline!, p))) continue;
      const needs = sizeFor(outline, look, text.width, text.height);
      const wider = Math.max(0, needs.width - node.width);
      const taller = Math.max(0, needs.height - node.height);
      const more = [wider > EPSILON ? `${units(wider)} more width` : '', taller > EPSILON ? `${units(taller)} more height` : ''].filter((part) => part.length > 0);
      found.push(
        new Finding(
          'text-overflow',
          `the text of node ${node.name} runs past the outline of its ${outline}` + (more.length > 0 ? `; it needs ${more.join(' and ')}` : ''),
          node.line,
        ),
      );
      continue;
    }
    if (node.body.outline === 'flow-collate') continue;
    const spill = {
      left: Math.max(0, -text.x),
      right: Math.max(0, text.x + text.width - node.width),
      top: Math.max(0, -text.y),
      bottom: Math.max(0, text.y + text.height - node.height),
    };
    const sides = (Object.keys(spill) as (keyof typeof spill)[]).filter((side) => spill[side] > EPSILON);
    if (sides.length === 0) continue;
    const wider = spill.left + spill.right;
    const taller = spill.top + spill.bottom;
    const needs = [
      wider > EPSILON ? `${units(wider)} more width` : '',
      taller > EPSILON ? `${units(taller)} more height` : '',
    ].filter((part) => part.length > 0);
    const named =
      sides.length === 4
        ? 'every side'
        : sides.length === 1
          ? `the ${sides[0]} side`
          : `the ${sides.slice(0, -1).join(', ')} and ${sides[sides.length - 1]} sides`;
    found.push(
      new Finding(
        'text-overflow',
        `the text of node ${node.name} runs past ${named} of its box; it needs ${needs.join(' and ')}`,
        node.line,
      ),
    );
  }
  return found;
}

/**
 * A text on a line that lands on another such text, or on a node it doesn't
 * belong to, or one placed beside its line that the line still runs through
 * (design.org 7.3, 10.1). A text never moves to get clear, so this is how the
 * writer hears of it. A text belongs to no node, but riding across a
 * container that holds it is what a line inside a container does, so that
 * container doesn't count; what is inside it does.
 *
 * Found with a sweep across the page, as node overlaps are.
 */
function textOverlaps(layout: Layout, routes: Map<LayoutEdge, Route>): Finding[] {
  // `words` is any text's content: a line's, or a point's or region's (design.org 7.4).
  type Item = { box: Box; text?: PlacedText; words?: string; node?: LayoutNode; title?: LayoutNode; line: number };
  const items: Item[] = [];
  const found: Finding[] = [];
  for (const edge of layout.edges) {
    if (edge.guide) continue;
    const route = routes.get(edge)!;
    for (const placed of placeLineTexts(edge, route)) {
      const box = boxOf(placed.box);
      items.push({ box, text: placed, words: placed.text.text, line: edge.line });
      if (placed.beside && acrossLine(traceRoute(route), placed.box)) {
        found.push(
          new Finding(
            'text-overlap',
            `text "${placed.text.text}" is placed ${placed.text.place.beside} edge, and its line still runs through it — ` +
              'the part it landed on has no room beside it; try the other side, or place it along the line with at:',
            edge.line,
          ),
        );
      }
    }
  }
  for (const mark of layout.marks) {
    if (mark.guide || !mark.text) continue;
    items.push({ box: mark.text.box, words: mark.text.lines.map((line) => line.map((run) => run.text).join('')).join(' '), line: mark.line });
  }
  // Another line drawn through a text: the text knocks a hole only in its own
  // line, and a point's or a region's text has none.
  const traces = layout.edges.filter((edge) => !edge.guide).map((edge) => ({ edge, trace: traceRoute(routes.get(edge)!) }));
  for (const item of items) {
    const own = item.text?.text;
    const extent = { minX: item.box.x, minY: item.box.y, maxX: item.box.x + item.box.width, maxY: item.box.y + item.box.height };
    for (const { edge, trace } of traces) {
      if ((own && edge.texts.includes(own)) || !acrossLine(trace, extent)) continue;
      found.push(
        new Finding(
          'text-overlap',
          `text "${item.words}" has the line ${edge.from.name} ${edge.arrow} ${edge.to.name} drawn through it — ` +
            (own
              ? 'a text breaks only its own line; place it clear of the other with at: or a side such as above edge'
              : 'place it clear of the line, such as (below) or (above-left)'),
          item.line,
        ),
      );
    }
  }
  // A box's own title, against boxes only. A box covering the title of a box
  // it overlaps from outside is node-overlap's finding; this one is a child
  // over its container's title, or anything over a title drawn outside its box.
  for (const node of layout.nodes) {
    if (node.guide || node.lines.length === 0 || node.textBox.width <= EPSILON) continue;
    const box = { x: node.x + node.textBox.x, y: node.y + node.textBox.y, width: node.textBox.width, height: node.textBox.height };
    items.push({ box, words: node.text, title: node, line: node.line });
  }
  if (items.length === 0) return found;
  for (const node of layout.nodes) {
    if (node.guide || node.body.kind === 'none') continue;
    items.push({ box: { x: node.x, y: node.y, width: node.width, height: node.height }, node, line: node.line });
  }
  const holds = (node: LayoutNode, box: Box): boolean => {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return (
      node.children.some((child) => child !== node.heading && !joinedToText(child)) &&
      node.x < cx && cx < node.x + node.width && node.y < cy && cy < node.y + node.height
    );
  };
  const sorted = [...items].sort((a, b) => a.box.x - b.box.x);
  let active: Item[] = [];
  for (const item of sorted) {
    active = active.filter((other) => other.box.x + other.box.width > item.box.x + EPSILON);
    for (const other of active) {
      if (item.words === undefined && other.words === undefined) continue;
      const width = Math.min(item.box.x + item.box.width, other.box.x + other.box.width) - Math.max(item.box.x, other.box.x);
      const height = Math.min(item.box.y + item.box.height, other.box.y + other.box.height) - Math.max(item.box.y, other.box.y);
      if (width <= EPSILON || height <= EPSILON) continue;
      if (item.words !== undefined && other.words !== undefined) {
        if (item.title || other.title) continue;
        const [earlier, later] = other.line <= item.line ? [other, item] : [item, other];
        found.push(
          new Finding(
            'text-overlap',
            `text "${later.words}" covers ${coveredPart(earlier.box, later.box)}text "${earlier.words}"; ${size(width, height)}`,
            later.line,
          ),
        );
        continue;
      }
      const [text, node] = item.words !== undefined ? [item, other] : [other, item];
      const owner = text.title;
      if (owner) {
        if (node.node === owner || isWithin(owner, node.node!)) continue;
        const outside = !within(text.box, { x: owner.x, y: owner.y, width: owner.width, height: owner.height });
        if (!outside && !isWithin(node.node!, owner)) continue;
        found.push(
          new Finding(
            'text-overlap',
            `node ${node.node!.name} covers ${coveredPart(text.box, node.box)}${owner.name}'s title "${text.words}"; ${size(width, height)}`,
            node.line,
          ),
        );
        continue;
      }
      if (holds(node.node!, text.box)) {
        // Held, but a text never moves a border, so one that runs out past it
        // is the writer's to make room for.
        const out = pokesOut(text.box, node.box);
        if (out !== undefined) {
          found.push(
            new Finding(
              'text-overlap',
              `text "${text.words}" runs out of node ${node.node!.name} past its ${out.sides}, by ${out.by} — ` +
                `give ${node.node!.name} more padding:, or move the text`,
              text.line,
            ),
          );
        }
        continue;
      }
      found.push(
        new Finding(
          'text-overlap',
          `text "${text.words}" covers ${coveredPart(node.box, text.box)}node ${node.node!.name}; ${size(width, height)}`,
          text.line,
        ),
      );
    }
    active.push(item);
  }
  return found;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxOf(extent: { minX: number; minY: number; maxX: number; maxY: number }): Box {
  return { x: extent.minX, y: extent.minY, width: extent.maxX - extent.minX, height: extent.maxY - extent.minY };
}

/** Whether a polyline passes through the inside of a box, not merely along its edge. */
function acrossLine(trace: { x: number; y: number }[], extent: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  const inner = { x: extent.minX + 1, y: extent.minY + 1, width: extent.maxX - extent.minX - 2, height: extent.maxY - extent.minY - 2 };
  if (inner.width <= 0 || inner.height <= 0) return false;
  for (let index = 1; index < trace.length; index += 1) {
    if (clipSegment(trace[index - 1]!, trace[index]!, inner) !== undefined) return true;
  }
  return false;
}

/**
 * Two nodes on one spot that nothing accounts for. A node and what it holds
 * overlap by being nested; one placed `on` or `inside` another overlaps it
 * because the file said so; `overlap: allow` says so for every pair a node is
 * in. Anything else sharing space is reported, against the later of the two,
 * since that is the statement that put it there.
 *
 * Found with a sweep across the page rather than by trying every pair, so a
 * large diagram costs little more than the overlaps it actually has.
 */
function nodeOverlaps(layout: Layout): Finding[] {
  const byName = new Map(layout.nodes.map((node) => [node.name, node]));
  const stated = new Map<LayoutNode, Set<LayoutNode>>();
  for (const node of layout.nodes) {
    for (const placement of node.placements) {
      if (placement.kind !== 'on' && !(placement.kind === 'offset' && placement.written === 'inside')) continue;
      for (const target of placement.targets) {
        const other = byName.get(target.name);
        if (other === undefined) continue;
        const set = stated.get(node) ?? new Set();
        set.add(other);
        stated.set(node, set);
      }
    }
  }
  const lineage = (node: LayoutNode): LayoutNode[] => {
    const chain: LayoutNode[] = [];
    for (let at: LayoutNode | undefined = node; at; at = at.parent) chain.push(at);
    return chain;
  };
  const accounted = (a: LayoutNode, b: LayoutNode): boolean => {
    const upA = lineage(a);
    const upB = lineage(b);
    if (upA.includes(b) || upB.includes(a)) return true;
    if (vennStates(a, b)) return true;
    // A deck's cards are stacked on each other by the deck, and so is what they hold.
    if (upA.some((one) => one.parent?.appearance['layout'] === 'deck' && upB.some((other) => other !== one && other.parent === one.parent))) return true;
    if (upA.some(saysOverlapAllowed) || upB.some(saysOverlapAllowed)) return true;
    // `inside hub top-right` accounts for covering hub, and what it holds
    // covering hub, but not for covering hub's other children (design.org 5.6).
    const placedOn = (over: LayoutNode[], under: LayoutNode) => over.some((node) => stated.get(node)?.has(under));
    return placedOn(upA, b) || placedOn(upB, a);
  };

  const pairs: Array<{ earlier: LayoutNode; later: LayoutNode; width: number; height: number }> = [];
  // A guide box draws nothing, so nothing drawn can cover it or be covered by
  // it, and neither can a box with no fill, no border, no picture and no
  // text, such as a spacer holding its container open.
  const blank = (node: LayoutNode): boolean =>
    node.lines.every((line) => line.every((run) => run.text.trim() === '')) &&
    node.body.kind !== 'icon' &&
    node.appearance['fill'] === 'none' &&
    node.appearance['border'] === 'none';
  const sorted = layout.nodes.filter((node) => !node.guide && !blank(node)).sort((a, b) => a.x - b.x);
  let active: LayoutNode[] = [];
  for (const node of sorted) {
    active = active.filter((other) => other.x + other.width > node.x + EPSILON);
    for (const other of active) {
      const width = Math.min(node.x + node.width, other.x + other.width) - Math.max(node.x, other.x);
      const height = Math.min(node.y + node.height, other.y + other.height) - Math.max(node.y, other.y);
      if (width <= EPSILON || height <= EPSILON) continue;
      if (accounted(node, other)) continue;
      const [earlier, later] = other.line <= node.line ? [other, node] : [node, other];
      pairs.push({ earlier, later, width, height });
    }
    active.push(node);
  }

  // A box over a container is over whatever of its children it reaches too,
  // and saying so for each child repeats the one fact. Only the outermost
  // pair is reported.
  const reported = new Set(pairs.map(({ earlier, later }) => namePair(earlier, later)));
  const inner = ({ earlier, later }: (typeof pairs)[number]): boolean =>
    lineage(earlier).some((a) => lineage(later).some((b) => (a !== earlier || b !== later) && reported.has(namePair(a, b))));
  return pairs
    .filter((pair) => !inner(pair))
    .map(
      ({ earlier, later, width, height }) =>
        new Finding(
          'node-overlap',
          `node ${later.name} covers ${coveredPart(earlier, later)}node ${earlier.name}; ${size(width, height)}` +
            keepClear(earlier, later, width, height),
          later.line,
        ),
    );
}

/**
 * For a child placed against its container's side or corner over one of its
 * siblings, the limit that would make the box room for it (design.org 5.6):
 * toward the side it is against, which is the only way growing the box moves
 * it, and of a corner's two, the one that clears the shorter overlap.
 */
function keepClear(a: LayoutNode, b: LayoutNode, width: number, height: number): string {
  const sides = framedSides;
  if (a.parent === undefined || a.parent !== b.parent || (sides(a).length > 0) === (sides(b).length > 0)) return '';
  const [own, other] = sides(a).length > 0 ? [a, b] : [b, a];
  const words: Record<string, string> = { top: 'above', bottom: 'below', left: 'left of', right: 'right of' };
  const ways = sides(own).map((side) => words[side]!);
  const way = ways.length === 1 ? ways[0]! : height <= width ? ways.find((each) => each === 'above' || each === 'below')! : ways.find((each) => each.endsWith('of'))!;
  return ` — to keep ${own.name} clear of it, add "stays ${way} ${other.name}" to ${own.name}`;
}

/** The sides of its container a child is placed against: `inside c top-right` is top and right. */
function framedSides(node: LayoutNode): Array<'top' | 'bottom' | 'left' | 'right'> {
  const parent = node.parent;
  if (parent === undefined) return [];
  const part = node.placements
    .flatMap((placement) => placement.targets)
    .find((target) => target.name === parent.name && target.part !== 'text')?.part;
  if (part === undefined) return [];
  return part.split('-').filter((word): word is 'top' | 'bottom' | 'left' | 'right' => ['top', 'bottom', 'left', 'right'].includes(word));
}

/**
 * A child placed against its container's side or corner that the box has no
 * room for there (design.org 5.6): less room on the far side than it keeps
 * from the side it names, so it runs into the far side's padding or out of
 * the box. The box never grows for it, so it is drawn as stated.
 */
function nodeOverflows(layout: Layout): Finding[] {
  const found: Finding[] = [];
  for (const node of layout.nodes) {
    const parent = node.parent;
    if (parent === undefined || node.guide) continue;
    const short: string[] = [];
    for (const side of framedSides(node)) {
      const vertical = side === 'top' || side === 'bottom';
      const start = vertical ? node.y : node.x;
      const end = start + (vertical ? node.height : node.width);
      const boxStart = vertical ? parent.y : parent.x;
      const boxEnd = boxStart + (vertical ? parent.height : parent.width);
      const kept = side === 'top' || side === 'left' ? start - boxStart : boxEnd - end;
      const far = side === 'top' || side === 'left' ? boxEnd - end : start - boxStart;
      if (far >= kept - EPSILON) continue;
      const room = (vertical ? parent.height : parent.width) - kept * 2;
      const [measure, against] = vertical ? ['tall', 'height'] : ['wide', 'width'];
      short.push(`it is ${units(vertical ? node.height : node.width)} ${measure} and ${parent.name}'s ${against} leaves ${room > 0 ? units(room) : 'nothing'} inside its padding`);
    }
    if (short.length === 0) continue;
    found.push(
      new Finding(
        'node-overflow',
        `node ${node.name} has no room in the ${framedSides(node).join('-')} of ${parent.name}: ${short.join(', and ')} — ` +
          `give ${parent.name} more room, or place ${node.name} against ${parent.name}'s text or its other children`,
        node.line,
      ),
    );
  }
  return found;
}

function namePair(a: LayoutNode, b: LayoutNode): string {
  return a.name < b.name ? `${a.name}\n${b.name}` : `${b.name}\n${a.name}`;
}

/** Shared space smaller than this is two edges meeting, not an overlap. */
const EPSILON = 0.5;

function saysOverlapAllowed(node: LayoutNode): boolean {
  return node.attrs['overlap'] === 'allow';
}

/**
 * Which of the nine positions of `under` that `over` covers, worded to go
 * before the node: "the top-left corner of ", "the left side of ", "all of ".
 * Along each axis the covered stretch is at the near end if it reaches that
 * edge and not the far one, the far end the other way round, and the middle
 * otherwise.
 */
/** Whether `inner` lies wholly inside `outer`. */
function within(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - EPSILON && inner.y >= outer.y - EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + EPSILON && inner.y + inner.height <= outer.y + outer.height + EPSILON
  );
}

/** The sides of `outer` that `inner` crosses, and by how far at most, or undefined when it is inside. */
function pokesOut(inner: Box, outer: Box): { sides: string; by: string } | undefined {
  const past: [string, number][] = [
    ['top', outer.y - inner.y],
    ['bottom', inner.y + inner.height - (outer.y + outer.height)],
    ['left', outer.x - inner.x],
    ['right', inner.x + inner.width - (outer.x + outer.width)],
  ];
  const crossed = past.filter(([, by]) => by > EPSILON);
  if (crossed.length === 0) return undefined;
  const names = crossed.map(([side]) => side);
  const sides = names.length === 1 ? `${names[0]} side` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} sides`;
  return { sides, by: units(Math.max(...crossed.map(([, by]) => by))) };
}

function coveredPart(under: Box, over: Box): string {
  const along = (start: number, extent: number, overStart: number, overExtent: number) => {
    const near = overStart <= start + EPSILON;
    const far = overStart + overExtent >= start + extent - EPSILON;
    if (near && far) return 'all';
    if (near) return 'near';
    if (far) return 'far';
    return 'middle';
  };
  const x = along(under.x, under.width, over.x, over.width);
  const y = along(under.y, under.height, over.y, over.height);
  if (x === 'all' && y === 'all') return 'all of ';
  const across = { near: 'left', far: 'right', middle: '', all: '' }[x];
  const down = { near: 'top', far: 'bottom', middle: '', all: '' }[y];
  if (across && down) return `the ${down}-${across} corner of `;
  if (down) return `the ${down} of `;
  if (across) return `the ${across} side of `;
  if (x === 'all') return 'a band across the middle of ';
  if (y === 'all') return 'a band down the middle of ';
  return 'the center of ';
}

/** "the overlap is 3 units wide and 2 units tall", in the file's unit. */
function size(width: number, height: number): string {
  return `the overlap is ${units(width)} wide and ${units(height)} tall`;
}

function units(pixels: number): string {
  const count = Math.round(pixels / UNIT);
  if (count === 0) return 'less than a unit';
  return count === 1 ? '1 unit' : `${count} units`;
}

/** The one word in `words` a slip of a letter or two away from `word`, if there is one. */
export function nearMatch(word: string, words: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of words) {
    const distance = editDistance(word, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= Math.max(1, Math.floor(word.length / 3)) ? best : undefined;
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}
