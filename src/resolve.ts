import type { Attrs, Axis, Edge, OffsetPlacement, Placement, Document, Stmt } from './ast.js';
import { describePlacement } from './ast.js';
import {
  CHILD_GAP,
  DECK_STEP,
  DEFAULT_FONT_SIZE,
  DEFAULT_MARGIN,
  GAPS,
  HEADER_GAP,
  ICON_GAP,
  ICON_LINES,
  PAD,
  SEPARATION_GAP,
  fontSizeFor,
  labelStyleFor,
} from './constants.js';
import { fix, reachability, tightest, type Constraint, type Contradiction } from './constrain.js';
import { SourceError } from './errors.js';
import { iconFor, shapeFor } from './icons.js';
import { monospaceMeasurer, splitLines, type Measurer } from './measure.js';
import type { Layout, LayoutLink, LayoutNode, LayoutPassage } from './model.js';

export interface ResolveOptions {
  measurer?: Measurer;
  fontSize?: number;
  /** Blank space kept around the whole diagram. */
  margin?: number;
}

/**
 * Turn a parsed document into solved geometry.
 *
 * Three passes: build the containment tree, size every node bottom-up, then
 * turn each node's placements into minimum distances and solve for the tightest
 * arrangement that satisfies them. That last pass also adds the separations
 * that keep boxes off each other, and solves again until none is left to add.
 *
 * It is a constraint solve, of the kind that computes rather than searches. It
 * works out how far apart things are; nothing about which side of what a node
 * sits on is ever decided here, because the author wrote it down.
 */
export function resolve(doc: Document, options: ResolveOptions = {}): Layout {
  const measurer = options.measurer ?? monospaceMeasurer();
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const margin = options.margin ?? DEFAULT_MARGIN;

  const styles = collectStyles(doc.statements);
  const { nodes, byName, roots } = buildTree(doc.statements, styles);
  applyDecks(doc.statements, byName);

  const local = new Map<LayoutNode, { x: number; y: number }>();
  for (const root of roots) sizeNode(root, measurer, fontSize, local);

  placeRoots(roots, byName, local);
  normalize(nodes, margin);

  const links = buildLinks(doc.statements, byName, styles);
  const extent = bounds(nodes);

  return {
    nodes,
    roots,
    links,
    diagram: collectDiagram(doc.statements),
    width: Math.ceil(extent.maxX + margin),
    height: Math.ceil(extent.maxY + margin),
  };
}

// --- pass one: the containment tree -----------------------------------------

function collectStyles(statements: Stmt[]): Map<string, Attrs> {
  const styles = new Map<string, Attrs>();
  for (const stmt of statements) {
    if (stmt.kind !== 'style') continue;
    if (styles.has(stmt.name)) {
      throw new SourceError(`style "${stmt.name}" is declared twice`, stmt.line);
    }
    styles.set(stmt.name, stmt.attrs);
  }
  return styles;
}

/** A file holds one diagram, so a second `diagram` statement is a mistake. */
function collectDiagram(statements: Stmt[]): Attrs {
  let found: Attrs | undefined;
  for (const stmt of statements) {
    if (stmt.kind !== 'diagram') continue;
    if (found) throw new SourceError('the diagram is described twice', stmt.line);
    found = stmt.attrs;
  }
  return found ?? {};
}

function buildTree(statements: Stmt[], styles: Map<string, Attrs>) {
  const nodes: LayoutNode[] = [];
  const byName = new Map<string, LayoutNode>();
  const roots: LayoutNode[] = [];

  for (const stmt of statements) {
    if (stmt.kind !== 'box' && stmt.kind !== 'note') continue;

    if (byName.has(stmt.name)) {
      throw new SourceError(`"${stmt.name}" is declared twice`, stmt.line);
    }

    const node: LayoutNode = {
      name: stmt.name,
      kind: stmt.kind,
      text: stmt.text,
      lines: linesFor(stmt.text, stmt.attrs, stmt.line),
      children: [],
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      inset: 0,
      deckLabels: [],
      headerHeight: 0,
      label: stmt.kind === 'box' ? stmt.label : {},
      attrs: stmt.attrs,
      appearance: appearanceOf(stmt.attrs, styles, stmt.line),
      placements: stmt.placements,
      line: stmt.line,
    };

    const cut = stmt.name.lastIndexOf('.');
    if (cut === -1) {
      roots.push(node);
    } else {
      const parentName = stmt.name.slice(0, cut);
      const parent = byName.get(parentName);
      if (!parent) {
        throw new SourceError(
          `"${stmt.name}" is inside "${parentName}", which is not declared yet`,
          stmt.line,
        );
      }
      node.parent = parent;
      parent.children.push(node);
    }

    nodes.push(node);
    byName.set(stmt.name, node);
  }

  return { nodes, byName, roots };
}

function appearanceOf(attrs: Attrs, styles: Map<string, Attrs>, line: number): Attrs {
  const named = attrs['style'];
  if (named === undefined) return { ...attrs };
  const base = styles.get(named);
  if (!base) throw new SourceError(`no style named "${named}"`, line);
  return { ...base, ...attrs };
}

function applyDecks(statements: Stmt[], byName: Map<string, LayoutNode>): void {
  for (const stmt of statements) {
    if (stmt.kind !== 'deck') continue;
    const node = byName.get(stmt.name);
    if (!node) throw new SourceError(`deck names "${stmt.name}", which does not exist`, stmt.line);
    node.deckLabels = stmt.labels;
  }
}

function buildLinks(
  statements: Stmt[],
  byName: Map<string, LayoutNode>,
  styles: Map<string, Attrs>,
): LayoutLink[] {
  const links: LayoutLink[] = [];
  for (const stmt of statements) {
    if (stmt.kind !== 'link') continue;
    const from = byName.get(stmt.from);
    const to = byName.get(stmt.to);
    if (!from) throw new SourceError(`link from "${stmt.from}", which does not exist`, stmt.line);
    if (!to) throw new SourceError(`link to "${stmt.to}", which does not exist`, stmt.line);
    const between: LayoutPassage | undefined = stmt.between && {
      nodes: stmt.between.targets.map((name) => {
        const node = byName.get(name);
        if (!node) {
          throw new SourceError(`link passes between "${name}", which does not exist`, stmt.line);
        }
        return node;
      }) as [LayoutNode, LayoutNode],
      ...(stmt.between.axis !== undefined ? { axis: stmt.between.axis } : {}),
    };
    links.push({
      from,
      to,
      both: stmt.both,
      ...(stmt.label !== undefined ? { label: stmt.label } : {}),
      ...(between ? { between } : {}),
      attrs: stmt.attrs,
      appearance: appearanceOf(stmt.attrs, styles, stmt.line),
      line: stmt.line,
    });
  }
  return links;
}

// --- pass two: sizes, bottom-up ---------------------------------------------

type Local = Map<LayoutNode, { x: number; y: number }>;

/**
 * Give a node a width and height, sizing its children first. Also records each
 * child's offset within this node, which pass three turns into absolute
 * coordinates once this node itself is placed.
 */
function sizeNode(node: LayoutNode, measurer: Measurer, fontSize: number, local: Local): void {
  for (const child of node.children) sizeNode(child, measurer, fontSize, local);

  // Text is measured at the size it will be drawn at — the size lives in
  // `constants.ts` precisely so the resolver reserving the room and the
  // renderer filling it cannot disagree about how much room there is.
  const textSize = fontSizeFor(node.kind, node.appearance, fontSize, node.line);
  const lineHeight = measurer.lineHeight(textSize);
  // A node with empty text takes no room for it. This is what makes an
  // invisible grouping container size to exactly its contents.
  const hasLabel = node.lines.some((line) => line.length > 0);
  const labelWidth = hasLabel ? widestLine(node.lines, measurer, textSize) : 0;
  const labelHeight = hasLabel ? node.lines.length * lineHeight : 0;

  if (node.kind === 'note') {
    // A note is bare text, so it gets no padding and takes no children.
    // Both are refused rather than ignored, for the reason an unknown diagram
    // key is: a note is bare text with no box to decorate or replace, so either
    // word would silently do nothing and look like the tool being broken.
    for (const key of ['icon', 'shape'] as const) {
      if (node.appearance[key] !== undefined) {
        throw new SourceError(
          `"${node.name}" is a note and has ${key}: ${node.appearance[key]}. A note is bare text, with no box to ${key === 'icon' ? 'decorate' : 'replace'}`,
          node.line,
        );
      }
    }
    node.width = labelWidth;
    node.height = labelHeight;
    return;
  }

  const shape = shapeFor(node.appearance, node.line);
  const glyphSide = ICON_LINES * lineHeight;

  if (shape.body !== undefined) {
    // Drawn as a glyph, so there is no box to pad and the node's size is the
    // picture's. A label goes under it rather than inside it, which is the
    // arrangement that makes a row of these read as captioned things.
    if (node.children.length > 0) {
      throw new SourceError(
        `"${node.name}" is drawn as a glyph and has children. A glyph is not a box, so nothing can go inside it`,
        node.line,
      );
    }
    node.width = Math.max(glyphSide, labelWidth);
    node.height = glyphSide + (hasLabel ? ICON_GAP + labelHeight : 0);
    return;
  }

  // An icon takes a column of its own on the right of whatever the box holds,
  // so the label never runs underneath it and the box grows to fit both. That
  // is why an icon is not a renderer-only concern: it is content taking room,
  // like a label, and not appearance like `fill:`.
  const icon = iconFor(node.appearance, node.line);
  const iconSide = icon === undefined ? 0 : glyphSide;
  const iconRoom = icon === undefined ? 0 : iconSide + (hasLabel ? ICON_GAP : 0);

  if (node.children.length === 0) {
    // A band only exists because contents have to sit clear of it. A leaf has
    // none, so its label is centred in the box and there is nothing for `at` or
    // `align` to move it relative to. Refused rather than silently dropped.
    const stated = Object.keys(node.label);
    if (stated.length > 0) {
      throw new SourceError(
        `"${node.name}" holds nothing and its label carries ${stated.join(' and ')}. ` +
          `A label sits at one end of a box so its contents can have the other; with no contents it is centred, and there is nothing to say`,
        node.line,
      );
    }
    node.width = labelWidth + iconRoom + PAD * 2;
    node.height = Math.max(labelHeight, iconSide) + PAD * 2;
  } else {
    applyAlign(node);
    const content = layoutChildren(node, local);
    const band = Math.max(labelHeight, iconSide);
    // `headerHeight` is the band the label and icon take, whichever end of the
    // box that band is at. Only the contents' offset depends on the side.
    node.headerHeight = hasLabel || icon !== undefined ? band + HEADER_GAP : 0;
    node.width = Math.max(labelWidth + iconRoom, content.width) + PAD * 2;
    node.height = node.headerHeight + content.height + PAD * 2;

    const above = labelStyleFor(node.label, node.line).at === 'top' ? node.headerHeight : 0;
    for (const child of node.children) {
      const offset = local.get(child)!;
      offset.x += PAD;
      offset.y += PAD + above;
    }
  }

  if (node.deckLabels.length > 0) {
    // The copies sit behind and above-left, so the whole node grows by the
    // depth of the stack and its own face moves down and right by the same.
    node.inset = node.deckLabels.length * DECK_STEP;
    node.width += node.inset;
    node.height += node.inset;
    for (const child of node.children) {
      const offset = local.get(child)!;
      offset.x += node.inset;
      offset.y += node.inset;
    }
  }
}

/**
 * `align: widths` widens every direct child to the widest one's natural
 * width, before layoutChildren sizes and positions anything from those
 * widths. A container's own children are already sized by this point.
 */
function applyAlign(node: LayoutNode): void {
  const value = node.attrs['align'];
  if (value === undefined) return;
  if (value !== 'widths') {
    throw new SourceError(`"${node.name}" has align: ${value}, which is not one of widths`, node.line);
  }
  const maxWidth = Math.max(...node.children.map((child) => child.width));
  for (const child of node.children) child.width = maxWidth;
}

/**
 * Position a container's children relative to each other. Children that make
 * no placement stack vertically in written order; the rest are solved against the
 * siblings they name, by the same constraint pass that positions top-level
 * nodes. A placement may only name a sibling — containment scopes the group.
 */
function layoutChildren(parent: LayoutNode, local: Local): { width: number; height: number } {
  const siblings = new Map(parent.children.map((child) => [child.name, child]));

  // Children that say nothing keep the written order, down the page and flush
  // left. Written as constraints rather than a cursor so a placed sibling can
  // push them along like anything else.
  const stack: Constraint[] = [];
  const alignment: Constraint[] = [];
  const quiet = parent.children.filter((child) => child.placements.length === 0);
  const indexOf = new Map(parent.children.map((child, index) => [child, index]));
  quiet.forEach((child, position) => {
    const previous = quiet[position - 1];
    if (!previous) return;
    const before = indexOf.get(previous)!;
    const after = indexOf.get(child)!;
    stack.push({ from: before, to: after, weight: previous.height + CHILD_GAP });
    alignment.push(...fix(before, after, 0));
  });

  const positions = positionGroup(
    parent.children,
    (placement, owner) =>
      placement.targets.map((name) => {
        const target = siblings.get(name);
        if (!target) {
          throw new SourceError(
            `"${owner.name}" is placed against "${name}", which is not one of its siblings`,
            placement.line,
          );
        }
        return {
          name,
          index: indexOf.get(target)!,
          offset: { x: 0, y: 0 },
          width: target.width,
          height: target.height,
        };
      }),
    { x: alignment, y: stack },
  );

  for (const child of parent.children) local.set(child, positions.get(child)!);
  return extentOf(parent.children, local);
}

function extentOf(children: LayoutNode[], local: Local): { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const child of children) {
    const offset = local.get(child)!;
    minX = Math.min(minX, offset.x);
    minY = Math.min(minY, offset.y);
    maxX = Math.max(maxX, offset.x + child.width);
    maxY = Math.max(maxY, offset.y + child.height);
  }

  for (const child of children) {
    const offset = local.get(child)!;
    offset.x -= minX;
    offset.y -= minY;
  }

  return { width: maxX - minX, height: maxY - minY };
}

// --- pass three: solve for positions -----------------------------------------

function placeRoots(roots: LayoutNode[], byName: Map<string, LayoutNode>, local: Local): void {
  const anchors = roots.filter((root) => root.placements.length === 0);
  if (anchors.length === 0) {
    throw new SourceError('every node is placed relative to another, so nothing anchors the diagram', 1);
  }
  if (anchors.length > 1) {
    const names = anchors.map((node) => `"${node.name}"`).join(', ');
    throw new SourceError(
      `exactly one node may say nothing about where it goes, but ${anchors.length} do: ${names}`,
      anchors[1]!.line,
    );
  }

  const indexOf = new Map(roots.map((root, index) => [root, index]));

  // A placement may name something nested — `right of server.docker` places a top-level
  // node against a box inside another. Sizes and offsets within a container are
  // already settled, so a nested target is its root's position plus a constant.
  const positions = positionGroup(
    roots,
    (placement, owner) =>
      placement.targets.map((name) => {
        const target = byName.get(name);
        if (!target) {
          throw new SourceError(
            `"${owner.name}" is placed against "${name}", which does not exist`,
            placement.line,
          );
        }
        let root = target;
        const offset = { x: 0, y: 0 };
        while (root.parent) {
          const step = local.get(root)!;
          offset.x += step.x;
          offset.y += step.y;
          root = root.parent;
        }
        return { name, index: indexOf.get(root)!, offset, width: target.width, height: target.height };
      }),
    { x: [], y: [] },
  );

  for (const root of roots) {
    const position = positions.get(root)!;
    root.x = position.x;
    root.y = position.y;
    spreadToChildren(root, local);
  }
}

/** Once a node has an absolute position, its whole subtree follows from the offsets. */
function spreadToChildren(node: LayoutNode, local: Local): void {
  for (const child of node.children) {
    const offset = local.get(child)!;
    child.x = node.x + offset.x;
    child.y = node.y + offset.y;
    spreadToChildren(child, local);
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const AXES: Axis[] = ['x', 'y'];
const AXIS_WORD: Record<Axis, string> = { x: 'horizontally', y: 'vertically' };

/** Where a placement's target sits: which member owns it, and where inside that member. */
interface Target {
  name: string;
  index: number;
  offset: { x: number; y: number };
  width: number;
  height: number;
}

/**
 * An alignment whose target region cannot be measured yet.
 *
 * Naming several targets aligns a node to the box that just bounds them, and
 * where those targets sit at fixed offsets from one another — siblings in a
 * container, say — that box is a constant and the alignment is an ordinary
 * constraint. Where they do not, its edges are a minimum and a maximum over
 * positions the solve has yet to produce, which is not a distance the solver
 * can be told in advance. So it is measured off the first solution instead.
 */
interface Pending {
  node: LayoutNode;
  me: number;
  axis: Axis;
  edge: Edge;
  targets: Target[];
  placement: Placement;
}

/**
 * Position a set of nodes against each other from their placements.
 *
 * Every placement becomes a minimum distance, and the answer is the arrangement
 * where nothing is further apart than its placements require — which is what an
 * author does by hand when they push two things apart to fit something between
 * them and then pull the slack back out.
 *
 * Because a gap is a floor rather than a fixed distance, a corridor widens to
 * hold whatever is put in it and closes again when that is removed. No number
 * anywhere has to be guessed, and nothing is ever tried and rejected.
 */
function positionGroup(
  members: LayoutNode[],
  locate: (placement: Placement, owner: LayoutNode) => Target[],
  extra: { x: Constraint[]; y: Constraint[] },
): Map<LayoutNode, { x: number; y: number }> {
  const constraints: Record<Axis, Constraint[]> = { x: [...extra.x], y: [...extra.y] };
  const indexOf = new Map(members.map((member, index) => [member, index]));
  const pending: Pending[] = [];

  for (const node of members) {
    if (node.placements.length === 0) continue;
    const me = indexOf.get(node)!;
    // Checked here as well as in `gapFor`, so a misspelt node-wide gap is still
    // caught on a node whose placements all name their own or are alignments.
    namedGap(node, node.attrs['gap'], node.line);
    const size: Record<Axis, number> = { x: node.width, y: node.height };
    const located = node.placements.map((placement) => ({ placement, targets: locate(placement, node) }));

    const spokenFor: Record<Axis, boolean> = { x: false, y: false };
    for (const { placement } of located) {
      if (placement.kind === 'align') {
        spokenFor[placement.axis] = true;
      } else {
        if (/left|right/.test(placement.direction)) spokenFor.x = true;
        if (/above|below/.test(placement.direction)) spokenFor.y = true;
      }
    }

    // Aligning to several targets means aligning to the box that just bounds
    // them. That box is a constant only while its members hold still relative
    // to one another; otherwise the alignment waits for the first solution.
    const alignOn = (axis: Axis, edge: Edge, targets: Target[], placement: Placement): void => {
      const anchor = sharedMember(targets);
      if (anchor === undefined) {
        pending.push({ node, me, axis, edge, targets, placement });
        return;
      }
      const span = spanOf(targets, axis, () => 0);
      constraints[axis].push(...fix(anchor, me, alignedAt(edge, span, size[axis]), placement));
    };

    for (const { placement, targets } of located) {
      if (placement.kind === 'align') {
        alignOn(placement.axis, placement.edge, targets, placement);
        continue;
      }
      // One constraint per target, so the node clears the furthest of them.
      // Taking that maximum is what longest paths already does, which is why a
      // direction against a whole region needs nothing added to the solver.
      const { direction } = placement;
      // A gap belongs to the relationship rather than to either box in it, so
      // each placement may name its own and the node's `gap:` is only the
      // default. That is what lets a node wedged between two things sit tight
      // against one of them and wide of the other.
      const gap = gapFor(node, placement);
      for (const target of targets) {
        if (direction.includes('right')) {
          constraints.x.push({
            from: target.index,
            to: me,
            weight: target.offset.x + target.width + gap,
            placement,
          });
        }
        if (direction.includes('left')) {
          constraints.x.push({
            from: me,
            to: target.index,
            weight: node.width + gap - target.offset.x,
            placement,
          });
        }
        if (direction.includes('below')) {
          constraints.y.push({
            from: target.index,
            to: me,
            weight: target.offset.y + target.height + gap,
            placement,
          });
        }
        if (direction.includes('above')) {
          constraints.y.push({
            from: me,
            to: target.index,
            weight: node.height + gap - target.offset.y,
            placement,
          });
        }
      }
    }

    // An axis nobody spoke to falls back to the centre line of whatever the
    // node was placed against, which is why "right of docker" alone is a whole
    // position. Two different targets would decide which row the node shares,
    // so that is refused rather than guessed — but two targets named by one
    // placement are a single region, and centring on it is unambiguous.
    for (const axis of AXES) {
      if (spokenFor[axis]) continue;
      const offers = located.filter((entry) => entry.placement.kind === 'offset');
      const first = offers[0];
      if (!first) {
        throw new SourceError(
          `"${node.name}" says nothing about where it sits ${AXIS_WORD[axis]}`,
          node.placements[0]!.line,
        );
      }
      const named = (entry: { placement: Placement }) => entry.placement.targets.join('\u0000');
      const other = offers.find((entry) => named(entry) !== named(first));
      if (other) {
        throw new SourceError(
          `"${node.name}" does not say where it sits ${AXIS_WORD[axis]}: ` +
            `"${describePlacement(first.placement)}" and "${describePlacement(other.placement)}" ` +
            `would put it in different places`,
          other.placement.line,
        );
      }
      alignOn(axis, 'centre', first.targets, first.placement);
    }
  }

  const solved: Record<Axis, number[]> = { x: [], y: [] };
  const solveAll = (): void => {
    for (const axis of AXES) {
      const outcome = tightest(members.length, constraints[axis]);
      if ('contradiction' in outcome) throw noRoom(outcome.contradiction, axis, members);
      solved[axis] = outcome.positions;
    }
  };

  solveAll();
  settle(pending, members, constraints, solved, solveAll);
  snug(members, constraints, solved, solveAll);
  separate(members, constraints, solved, solveAll);
  confirm(pending, solved);

  return new Map(
    members.map((member, index) => [
      member,
      { x: solved.x[index]!, y: solved.y[index]! },
    ]),
  );
}

/** The member every target belongs to, or nothing if they are spread across several. */
function sharedMember(targets: Target[]): number | undefined {
  const first = targets[0]!.index;
  return targets.every((target) => target.index === first) ? first : undefined;
}

/** The stretch of one axis that just covers every target. */
function spanOf(
  targets: Target[],
  axis: Axis,
  base: (target: Target) => number,
): { start: number; size: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const target of targets) {
    const at = base(target) + target.offset[axis];
    start = Math.min(start, at);
    end = Math.max(end, at + (axis === 'x' ? target.width : target.height));
  }
  return { start, size: end - start };
}

/** Where a node of this size sits so that the named edge of it meets the span's. */
function alignedAt(edge: Edge, span: { start: number; size: number }, own: number): number {
  if (edge === 'centre') return span.start + (span.size - own) / 2;
  if (edge === 'top' || edge === 'left') return span.start;
  return span.start + span.size - own;
}

/**
 * Fix the alignments that had to wait, by measuring what they align to.
 *
 * The first solution says where every target actually landed, so the region
 * they bound is now a number rather than an expression, and the alignment
 * becomes an ordinary constraint at a fixed distance. Nothing already solved is
 * moved by hand; a distance is read off and added, which is the same shape as
 * the separation pass and not the repair pass this design refuses.
 *
 * That is exact so long as the region does not depend on the node being aligned
 * to it. Where it does, measuring changes the thing measured and there is no
 * order that settles, so the file is refused rather than iterated at. The test
 * is the same reachability the separation pass uses.
 */
function settle(
  pending: Pending[],
  members: LayoutNode[],
  constraints: Record<Axis, Constraint[]>,
  solved: Record<Axis, number[]>,
  solveAll: () => void,
): void {
  if (pending.length === 0) return;

  for (const axis of AXES) {
    const here = pending.filter((entry) => entry.axis === axis);
    if (here.length === 0) continue;
    const reach = reachability(members.length, constraints[axis]);

    for (const entry of here) {
      for (const target of entry.targets) {
        if (target.index !== entry.me && !reach[entry.me]![target.index]) continue;
        throw new SourceError(
          `"${entry.node.name}" is ${describePlacement(entry.placement)}, but "${target.name}" ` +
            `is placed ${AXIS_WORD[axis]} against "${entry.node.name}" in turn, so there is no ` +
            `arrangement where each waits for the other`,
          entry.placement.line,
        );
      }

      const span = spanOf(entry.targets, axis, (target) => solved[axis][target.index]!);
      const own = axis === 'x' ? entry.node.width : entry.node.height;
      const anchor = entry.targets[0]!.index;
      constraints[axis].push(
        ...fix(anchor, entry.me, alignedAt(entry.edge, span, own) - solved[axis][anchor]!, entry.placement),
      );
    }
  }

  solveAll();
}

/**
 * Check the measured alignments still hold.
 *
 * Separation runs afterwards and only ever adds, so it can push two targets
 * apart and leave a region wider than it was when it was measured. Nothing here
 * repairs that — the picture is reported as unbuildable, because silently
 * drawing a node that is no longer level with what it names is the failure the
 * diagnostics work exists to prevent.
 */
function confirm(pending: Pending[], solved: Record<Axis, number[]>): void {
  for (const entry of pending) {
    const { axis } = entry;
    const span = spanOf(entry.targets, axis, (target) => solved[axis][target.index]!);
    const own = axis === 'x' ? entry.node.width : entry.node.height;
    if (Math.abs(alignedAt(entry.edge, span, own) - solved[axis][entry.me]!) <= 0.5) continue;
    throw new SourceError(
      `"${entry.node.name}" cannot be ${describePlacement(entry.placement)}: keeping boxes off ` +
        `each other moved them apart after that region was measured`,
      entry.placement.line,
    );
  }
}

/**
 * Pull in a node that nothing pushes back the other way.
 *
 * Every constraint reads "this one is at least so far along the axis from that
 * one", and the solve puts each member at the smallest position its constraints
 * allow. That is the tightest arrangement for anything with something behind
 * it — but `left of X` and `above X` bound *X*, not the node that wrote them,
 * so a node carrying only those has nothing behind it at all. It settles at the
 * far edge of the drawing while the thing it names is carried away by the rest
 * of the diagram, which is neither what the file says nor what the language
 * promises: as close together as the placements allow.
 *
 * The remedy is to look the other way for exactly those members. A member with
 * no incoming edge cannot be pushed by anything, so moving it along the axis
 * disturbs nothing; the furthest it may travel is set by whichever of its own
 * placements binds first, and pinning that one placement to an exact distance
 * puts it there. Every other placement it wrote had more room to spare and is
 * still satisfied.
 *
 * The pins are worked out against the first solution and applied together,
 * which keeps them independent: a member with no incoming edge is never the
 * target of another member's pin, because being a target is what an incoming
 * edge is.
 */
function snug(
  members: LayoutNode[],
  constraints: Record<Axis, Constraint[]>,
  solved: Record<Axis, number[]>,
  solveAll: () => void,
): void {
  const pins: { axis: Axis; constraint: Constraint }[] = [];

  for (const axis of AXES) {
    const pushed = new Array<boolean>(members.length).fill(false);
    for (const constraint of constraints[axis]) pushed[constraint.to] = true;

    for (let index = 0; index < members.length; index += 1) {
      if (pushed[index]) continue;

      let binding: Constraint | undefined;
      let slack = Infinity;
      for (const constraint of constraints[axis]) {
        if (constraint.from !== index) continue;
        const room = solved[axis][constraint.to]! - solved[axis][index]! - constraint.weight;
        if (room < slack) {
          slack = room;
          binding = constraint;
        }
      }
      // Nothing to travel toward, or already against it.
      if (!binding || slack <= 1e-9) continue;

      pins.push({
        axis,
        constraint: {
          from: binding.to,
          to: index,
          weight: -binding.weight,
          ...(binding.placement ? { placement: binding.placement } : {}),
        },
      });
    }
  }

  if (pins.length === 0) return;
  for (const pin of pins) constraints[pin.axis].push(pin.constraint);
  solveAll();
}

/**
 * Push apart any two boxes that landed on top of each other.
 *
 * Two boxes not overlapping is a placement the author never has to write, but on
 * its own it says nothing about *which way* to separate them — left, right,
 * above and below all satisfy it, and choosing among four is the search this
 * whole design refuses. So the direction is never chosen. It is read off the
 * constraints already built from the file: if the file lets one box travel away
 * from the other along an axis and offers no way back, that is the only
 * separation consistent with what was written. Where nothing in the file orders
 * a pair on either axis, this reports the pair instead of guessing.
 *
 * One case is genuinely free. When both axes already imply an order, either
 * would do, and the tie is broken by separating along the axis where the two
 * overlap least — the smallest movement, and the one a person makes by hand.
 * That is the single place the tool decides something nobody wrote.
 *
 * The loop only ever adds constraints and re-solves the whole system, so no
 * arrangement is ever tried and rejected and it settles without backtracking.
 * A solved layout is never nudged in place; that is a different thing and it is
 * the thing the design rules out.
 *
 * Members here are always siblings, or the roots of the diagram, so no member
 * ever contains another and containment needs no exemption of its own.
 */
function separate(
  members: LayoutNode[],
  constraints: Record<Axis, Constraint[]>,
  solved: Record<Axis, number[]>,
  solveAll: () => void,
): void {
  const eligible = members.map(allowsOverlap).map((allowed) => !allowed);
  if (eligible.filter(Boolean).length < 2) return;

  // Adding only, so the number of separations is bounded; the cap is a
  // backstop against a bug rather than an expected outcome.
  for (let round = 0; round < members.length * members.length + 1; round += 1) {
    let reach: Record<Axis, boolean[][]> | undefined;
    let added = false;

    for (let i = 0; i < members.length; i += 1) {
      if (!eligible[i]) continue;
      for (let j = i + 1; j < members.length; j += 1) {
        if (!eligible[j]) continue;

        const over = overlapOf(members, solved, i, j);
        if (!over) continue;

        reach ??= { x: reachability(members.length, constraints.x), y: reachability(members.length, constraints.y) };
        const orders: Partial<Record<Axis, { before: number; after: number }>> = {};
        for (const axis of AXES) {
          const order = impliedOrder(reach[axis], i, j);
          if (order) orders[axis] = order;
        }

        const axis = pickAxis(orders, over);
        if (!axis) throw unordered(members[i]!, members[j]!);

        const { before, after } = orders[axis]!;
        const span = axis === 'x' ? members[before]!.width : members[before]!.height;
        constraints[axis].push({ from: before, to: after, weight: span + SEPARATION_GAP });
        reach = undefined;
        added = true;
      }
    }

    if (!added) return;
    solveAll();
  }
}

/** How far two members share space on each axis, or nothing if they are clear of each other. */
function overlapOf(
  members: LayoutNode[],
  solved: Record<Axis, number[]>,
  i: number,
  j: number,
): Record<Axis, number> | undefined {
  const shared = (axis: Axis): number => {
    const size = (index: number) => (axis === 'x' ? members[index]!.width : members[index]!.height);
    const startI = solved[axis][i]!;
    const startJ = solved[axis][j]!;
    return Math.min(startI + size(i), startJ + size(j)) - Math.max(startI, startJ);
  };
  const x = shared('x');
  const y = shared('y');
  return x > 1e-9 && y > 1e-9 ? { x, y } : undefined;
}

/** Which of two members the file lets the other move past, if either. */
function impliedOrder(
  reach: boolean[][],
  i: number,
  j: number,
): { before: number; after: number } | undefined {
  const forward = reach[i]![j]!;
  const backward = reach[j]![i]!;
  if (forward === backward) return undefined;
  return forward ? { before: i, after: j } : { before: j, after: i };
}

/** Of the axes that can separate a pair, the one where they overlap least. */
function pickAxis(
  orders: Partial<Record<Axis, { before: number; after: number }>>,
  over: Record<Axis, number>,
): Axis | undefined {
  const available = AXES.filter((axis) => orders[axis]);
  if (available.length < 2) return available[0];
  return over.x <= over.y ? 'x' : 'y';
}

function allowsOverlap(node: LayoutNode): boolean {
  const value = node.attrs['overlap'];
  if (value === undefined) return false;
  if (value !== 'allow') {
    throw new SourceError(`"${node.name}" has overlap: ${value}, which is not one of allow`, node.line);
  }
  return true;
}

function unordered(first: LayoutNode, second: LayoutNode): SourceError {
  const [earlier, later] = first.line <= second.line ? [first, second] : [second, first];
  return new SourceError(
    `"${earlier.name}" and "${later.name}" overlap, and nothing says which side of the ` +
      `other either one sits on — place one against the other, or say overlap: allow`,
    later.line,
  );
}

/** Report a set of placements that cannot all hold, in the words they were written in. */
function noRoom(contradiction: Contradiction, axis: Axis, members: LayoutNode[]): SourceError {
  const { placements } = contradiction;
  if (placements.length === 0) {
    return new SourceError(
      `these placements run in a circle ${AXIS_WORD[axis]} and cannot all hold`,
      members[0]?.line ?? 1,
    );
  }
  const quoted = placements.map((placement) => `"${describePlacement(placement)}"`).join(' and ');
  return new SourceError(
    `${quoted} cannot all hold — they leave no room ${AXIS_WORD[axis]}`,
    placements[placements.length - 1]!.line,
  );
}


/**
 * How far this placement holds the node off its target. A placement may name
 * its own gap; `gap:` on the node is the default for the ones that do not.
 */
function gapFor(node: LayoutNode, placement: OffsetPlacement): number {
  if (placement.gap === undefined) return namedGap(node, node.attrs['gap'], node.line);
  return namedGap(node, placement.gap, placement.line);
}

function namedGap(node: LayoutNode, named: string | undefined, line: number): number {
  const gap = GAPS[named ?? 'normal'];
  if (gap === undefined) {
    const known = Object.keys(GAPS).join(', ');
    throw new SourceError(
      `"${node.name}" asks for gap: ${named}, which is not one of ${known}`,
      line,
    );
  }
  return gap;
}

// --- shared helpers ----------------------------------------------------------

function widestLine(lines: string[], measurer: Measurer, fontSize: number): number {
  return lines.reduce((widest, line) => {
    const { width } = measurer.measure(line, fontSize);
    return Math.max(widest, width);
  }, 0);
}

/**
 * Split a label into the lines that get drawn. `/` always breaks a line. A
 * `width` attribute additionally folds each of those at word boundaries, which
 * is what stops a long note running across the whole diagram.
 *
 * The width is a character count rather than a distance. It says how much text
 * fits on a line, not where anything sits, so it stays a property of the text
 * and never becomes a coordinate in disguise.
 */
function linesFor(text: string, attrs: Attrs, line: number): string[] {
  const stated = attrs['width'];
  if (stated === undefined) return splitLines(text);

  const columns = Number(stated);
  if (!Number.isInteger(columns) || columns < 1) {
    throw new SourceError(`width must be a whole number of characters, not "${stated}"`, line);
  }
  return splitLines(text).flatMap((part) => wrap(part, columns));
}

/** Fold one line onto several at word boundaries, never exceeding `columns`. */
function wrap(text: string, columns: number): string[] {
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= columns) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function bounds(nodes: LayoutNode[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { minX, minY, maxX, maxY };
}

/** Shift everything so the diagram starts at the margin rather than wherever the anchor fell. */
function normalize(nodes: LayoutNode[], margin: number): void {
  const { minX, minY } = bounds(nodes);
  const dx = margin - minX;
  const dy = margin - minY;
  for (const node of nodes) {
    node.x += dx;
    node.y += dy;
  }
}
