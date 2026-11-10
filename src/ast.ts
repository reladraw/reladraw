/**
 * The shape a source file parses into. Nothing here knows about geometry —
 * these types are a faithful record of what the author wrote, and no more.
 */

import type { LinkEntry } from './links.js';

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
 * corners, the four side midpoints, and the center. One closed set, accepted
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
 * as "the bottom edge, centered along it", which is what the word says. And
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
 * For a missing name like `bin.left`, whose last part is a side or a point:
 * the hint that the part is a separate word after the box's full name,
 * `host.bin left`. `names` is every box's name; empty when there is no such box.
 */
export function partWordHint(name: string, names: Iterable<string>): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  const part = name.slice(dot + 1);
  if (!isPosition(part) && !(PART_SIDES as readonly string[]).includes(part) && part !== 'text') return '';
  const base = name.slice(0, dot);
  const all = [...names];
  const found = all.includes(base) ? [base] : all.filter((each) => each.endsWith(`.${base}`));
  return found.length === 1 ? ` — a side or point is a separate word after the box's full name: ${found[0]} ${part}` : '';
}

/**
 * A part of a node that a placement may name: its text, one of its four sides,
 * or one of its nine points. Written as a separate word after the node's name
 * — `hub text`, `server right`, `board top-right`.
 *
 * No noun is carried. `board right side` was considered and dropped, because
 * the language already tells a segment from a point by *spelling*: a bare
 * `top` names a side everywhere (`from: bottom`, `top level with`) and a
 * hyphenated `top-right` names a point, which is exactly why every midpoint
 * carries `-center` rather than standing alone. A noun would mark with a word
 * a distinction the hyphen already marks.
 *
 * The spaced form needs no reservation against a child called `text`: a
 * sibling is always written dotted (`right of server.mirror`), so `hub text`
 * spaced can never be `hub.text`. The dotted spelling was rejected because it
 * interferes with the dot's one meaning.
 */
export const PART_SIDES = ['top', 'bottom', 'left', 'right'] as const;

export type PartSide = (typeof PART_SIDES)[number];

export const PARTS = ['text', ...PART_SIDES, ...POSITIONS] as const;

export type Part = (typeof PARTS)[number];

export function isPart(word: string): word is Part {
  return (PARTS as readonly string[]).includes(word);
}

/**
 * Which way "toward the box's center" points from a part. This is the whole of
 * what `inside` and `outside` mean, which is why neither needs a table of its
 * own: `inside` is this direction, `outside` is its opposite, and one rule
 * covers every part.
 *
 * `center` and `text` are absent on purpose. Neither is on the boundary, so
 * there is no direction toward the interior from them, and both are refused by
 * name where the shorthand is read.
 */
export const INWARD: Partial<Record<Part, Direction>> = {
  top: 'below',
  bottom: 'above',
  left: 'right',
  right: 'left',
  'top-left': 'below-right',
  'top-center': 'below',
  'top-right': 'below-left',
  'left-center': 'right',
  'right-center': 'left',
  'bottom-left': 'above-right',
  'bottom-center': 'above',
  'bottom-right': 'above-left',
};

/** The other way round, for `outside`. */
export const OPPOSITE: Record<Direction, Direction> = {
  above: 'below',
  below: 'above',
  left: 'right',
  right: 'left',
  'above-left': 'below-right',
  'above-right': 'below-left',
  'below-left': 'above-right',
  'below-right': 'above-left',
};

/** The parts `inside` and `outside` can be read from — everything on the boundary. */
export const BOUNDARY_PARTS: readonly string[] = Object.keys(INWARD);

/**
 * One thing a placement is placed against: a node, or a part of a node.
 *
 * A part target is the one target that is an *extent* rather than a node, which
 * is what it buys over naming a sibling — a column of children against a
 * container's right edge is flush by that edge and commits to no row, and
 * nothing anchored to a single node can say that.
 */
export interface PlacementTarget {
  name: string;
  part?: Part;
  /**
   * How far along a side, or across the whole box: `server 3/4 down`,
   * `3/4 down server` (design.org 4.7, 5.2). With a side, it is one point on
   * that side; without, a line through the box on the fraction's axis.
   */
  fraction?: Fraction;
  /** A point written out rather than named: `between a and b`, `down from a and left from b`, `2 below c bottom`. */
  point?: PointExpr;
}

/**
 * A fraction of the way along: `3/4 down` and `1/4 up` run along a left or
 * right side, `1/3 across` along a top or bottom one, counted from the left
 * unless it says `from right`.
 */
export interface Fraction {
  value: number;
  along: 'down' | 'up' | 'across';
  from?: 'left' | 'right';
  /** As written, to quote back: `3/4 down`, `1/3 across from right`. */
  written: string;
  /** Written before the name (`3/4 down x`) rather than after it (`x 3/4 down`). */
  first?: boolean;
}

/** The axis a fraction measures along. */
export function fractionAxis(fraction: Fraction): Axis {
  return fraction.along === 'across' ? 'x' : 'y';
}

/** The words that start a line from a thing, in `down from a and left from b`. */
export const WAYS = ['up', 'down', 'left', 'right'] as const;
export type Way = (typeof WAYS)[number];

/**
 * A point said in words (design.org 4.2–4.4). Every one is worked out from
 * named things, so moving them moves it.
 */
export type PointExpr =
  | {
      kind: 'between';
      a: PlacementTarget;
      b: PlacementTarget;
      /** `at 1/3`: that far across the gap, measured from `a`. Absent is halfway. */
      at?: number;
      atWritten?: string;
      /** `(span: both)`: as a region, the gap stretched over both boxes on the other axis. */
      span?: 'both';
    }
  | {
      kind: 'from';
      /**
       * The line giving the point its place across or up and down, in the
       * order written. `even` is `even with x`: the level line through x,
       * which says no way the point lies from it.
       */
      lines: [{ way: Way | 'even'; target: PlacementTarget }, { way: Way | 'even'; target: PlacementTarget }];
    }
  | {
      kind: 'moved';
      distance: string;
      direction: Direction;
      from: PlacementTarget;
    };

/** A point written out, as the author would write it. */
export function describePoint(point: PointExpr): string {
  if (point.kind === 'between') {
    const at = point.atWritten === undefined ? '' : ` at ${point.atWritten}`;
    const span = point.span ? ' (span: both)' : '';
    return `between ${nameTarget(point.a)} and ${nameTarget(point.b)}${at}${span}`;
  }
  if (point.kind === 'from') {
    return point.lines.map((line) => `${line.way === 'even' ? 'even with' : `${line.way} from`} ${nameTarget(line.target)}`).join(' and ');
  }
  const of = /left|right/.test(point.direction) ? ' of' : '';
  return `${point.distance} ${point.direction}${of} ${nameTarget(point.from)}`;
}

/**
 * Naming more than one target places the node against the box that just bounds
 * them all — `right of borg and bare` clears both. It is a single target that
 * nobody had to declare, which is why it is a list on one placement rather than
 * several placements: two separate `level with` statements are two demands that
 * fight, while one naming two targets is a single demand about one region.
 */
export type Targets = PlacementTarget[];

/**
 * `right of docker` — the node sits a gap beyond one of the target's sides.
 * A direction rules out part of an axis rather than fixing a point, which is
 * what lets two of them bracket a node between two targets.
 */
export interface OffsetPlacement {
  kind: 'offset';
  direction: Direction;
  /**
   * `inside` or `outside`, where the author wrote one of those instead of a
   * direction. Both are shorthands whose expansion is *derived* rather than
   * listed — inside is the direction from the named part toward the box's
   * center, outside is away from it — so the direction above is the whole of
   * their meaning and this only remembers the word, to quote back.
   */
  written?: 'inside' | 'outside';
  targets: Targets;
  /**
   * The gap this one placement asks for, from `(gap: wide)` written after the
   * targets. A gap describes a relationship rather than a box, so this is its
   * proper home; `gap:` on the node remains the default for every placement
   * that does not say. Absent means take the node's.
   */
  gap?: string;
  /**
   * `3 below and 2 right of a`: a different distance on each axis, which
   * stands in for `gap` (design.org 5.2).
   */
  gaps?: Partial<Record<Axis, string>>;
  /**
   * `center 12 right of a center`: the part of this box the distance is
   * measured from, rather than its facing side (design.org 5.2).
   */
  own?: Part;
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
 * `on hub top-right` — the node's center sits at the part's center, so a node
 * on a corner straddles it.
 *
 * This is the one genuine addition beside `inside` and `outside`, and it is a
 * both-axes center alignment the language did not have: `level with` gives the
 * vertical and the edge alignments give whichever axis their edge belongs to,
 * and there is no horizontal center alignment at all — so the only long form
 * would need two new words rather than one. `centered on` was proposed and
 * rejected: beside `inside` and `outside` the three read as a series and `on`
 * is unmistakable.
 *
 * One target only, unlike the other two. It names an exact point of one box,
 * and the box that bounds two things is not a box anybody drew.
 */
export interface OnPlacement {
  kind: 'on';
  targets: Targets;
  line: number;
}

/**
 * One thing the author said about where a node goes. A node carries as many as
 * it needs; the resolver intersects them.
 */
export type Placement = OffsetPlacement | AlignPlacement | OnPlacement;

/**
 * `stays above laptop.photos (gap: wide)` — a limit, not a placement
 * (design.org 5.6). It never says where the node goes, so no axis counts it;
 * it rules out pictures where the node is less than a gap that way from its
 * target, and the box holding both makes room by lengthening the one distance
 * nobody stated.
 */
export interface Limit {
  way: 'above' | 'below' | 'left' | 'right';
  target: PlacementTarget;
  gap?: string;
  line: number;
}

/** How a limit reads back in the author's own words. */
export function describeLimit(limit: Limit): string {
  const of = limit.way === 'left' || limit.way === 'right' ? ' of' : '';
  const gap = limit.gap === undefined ? '' : ` (gap: ${limit.gap})`;
  return `stays ${limit.way}${of} ${nameTarget(limit.target)}${gap}`;
}

/**
 * The modifiers a placement understands, in brackets after its targets. Refused
 * by name when unrecognized, for the reason `DIAGRAM_KEYS` are: a modifier that
 * silently does nothing looks like a bug in the tool rather than a typo.
 */
export const PLACEMENT_KEYS = ['gap'] as const;

/**
 * `contents: (widths: match, align: center)` — how a container's children sit
 * inside it. A container has a fill, a border, a title and its contents, and
 * this is the one key that points at the last of them.
 *
 * Two properties, independent, which is why they are bracketed modifiers of one
 * key rather than two keys side by side. The cross product has a live cell in
 * every corner — *equal widths, ranged left, under a long title* is the case
 * that proves it — so one token could never carry both. And they sit at
 * different levels: `contents:` is a property of the node, `widths:` a property
 * of the contents, which written as peers would read as two facts about the box
 * when they are one about the box and one about its children.
 *
 * It replaced `align: widths`, which was a size operation wearing an
 * alignment's name and had a one-element value set — a flag in a property's
 * clothes. With it gone, `align` means one thing everywhere: how a text's lines
 * range against each other.
 */
export const CONTENTS_KEYS = ['widths', 'align'] as const;

/**
 * What `layout: column (…)` and `layout: row (…)` take in their bracket.
 * `align` is read only to be refused by name: it now means where along a side,
 * and lining the children up is `align-children`.
 */
export const LAYOUT_KEYS = ['gap', 'widths', 'align-children', 'align', 'centers', 'heights'] as const;

/**
 * Where `gather-children:` puts a container's children in its spare room: a
 * side, a corner, or the middle.
 */
export const GATHER_PLACES = ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

/**
 * What `widths:` may say. `natural` is the default and is today's behavior.
 * `match` is what `align: widths` did — every child as wide as the widest.
 * `fill` is the whole content band, which is `match` wherever the contents set
 * the container's width and the better answer wherever the title wins.
 */
export const CONTENT_WIDTHS = ['natural', 'match', 'fill'] as const;

/**
 * How `align-children:` lines laid-out children up with each other: in a
 * column their left edges, middles or right edges; in a row their tops,
 * middles or bottoms.
 */
export const CHILD_ALIGNMENTS = { column: ['left', 'center', 'right'], row: ['top', 'center', 'bottom'] } as const;

/** How a placement reads back in the author's own words, for error messages. */
export function describePlacement(placement: Placement): string {
  const targets = listTargets(placement.targets);
  if (placement.kind === 'on') {
    return `on ${targets}`;
  }
  if (placement.kind === 'align') {
    const side = placement.side !== 'center' ? `${placement.side} ` : placement.axis === 'x' ? 'x ' : '';
    return `${side}even with ${targets}`;
  }
  // `inside` and `outside` take no `of`, and are quoted back as the author
  // wrote them — the derived direction is what they *mean*, not what they say.
  if (placement.written) {
    const gap = placement.gap === undefined ? '' : ` (gap: ${placement.gap})`;
    return `${placement.written} ${targets}${gap}`;
  }
  // "left of X" and "above X" are both good English; "above of X" is not.
  const joiner =
    placement.direction === 'above' || placement.direction === 'below' ? '' : 'of ';
  const own = placement.own === undefined ? '' : `${placement.own} `;
  if (placement.gaps) {
    const y = placement.direction.startsWith('above') ? 'above' : 'below';
    const x = placement.direction.endsWith('left') ? 'left' : 'right';
    return `${own}${placement.gaps.y} ${y} and ${placement.gaps.x} ${x} of ${targets}`;
  }
  // A distance in front, and one in brackets, are the same thing; quoted in front when the part form needs it.
  if (placement.own !== undefined && placement.gap !== undefined) {
    return `${own}${placement.gap} ${placement.direction} ${joiner}${targets}`;
  }
  const gap = placement.gap === undefined ? '' : ` (gap: ${placement.gap})`;
  return `${placement.direction} ${joiner}${targets}${gap}`;
}

/** "borg", "hub text", "borg and bare" — as the author would write them. */
export function listTargets(targets: Targets): string {
  const written = targets.map(nameTarget);
  if (written.length <= 1) return written[0] ?? '';
  return `${written.slice(0, -1).join(', ')} and ${written[written.length - 1]}`;
}

/** One target in the author's words: the node's name, and its part if it named one. */
export function nameTarget(target: PlacementTarget): string {
  if (target.point) return describePoint(target.point);
  if (target.fraction?.first) return `${target.fraction.written} ${target.name}`;
  const named = target.part === undefined ? target.name : `${target.name} ${target.part}`;
  return target.fraction ? `${named} ${target.fraction.written}` : named;
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
 * What a text's brackets may say: `"Docker" (at: bottom-center, color: theme-muted)`.
 *
 * They are bracketed onto the text rather than written among the node's
 * attributes for the same reason a gap is bracketed onto its placement — they
 * modify that one thing, and the brackets make the scope visible instead of
 * positional. What is left at the top level is then about the node itself:
 * `shape`, `icon`, `fill`, `border`, `gap`, `overlap`, `style`.
 *
 * In a style, which has no string for a bracket to hang off, the bracket hangs
 * off the key instead: `style synced  text: (color: theme-muted)`.
 *
 * `at` and `align` are independent and neither implies the other. `at` is where
 * the block of text sits in the node — one of the nine named positions — and
 * `align` is how its lines range against each other once it is there.
 */
export const TEXT_KEYS = ['color', 'size', 'wrap', 'align', 'at'] as const;

/**
 * What an edge's line takes in its bracket: `line: (path: square, pattern:
 * dashed)`. The line is a part in the sense the text is, so every property of
 * it goes in one bracket, as the text's do. `line: red` stays as the short form
 * of `line: (color: red)`, and both are stored under the bare `line` key.
 */
export const LINE_KEYS = ['color', 'path', 'corners', 'crossing', 'pattern', 'thickness', 'curve', 'turn', 'step-out'] as const;

/**
 * What a box's border takes in its bracket: `border: (color: red, thickness:
 * thick)`, mirroring the line's. `border: red` is the short form of the color,
 * and both are stored under the bare `border` key.
 */
export const BORDER_KEYS = ['color', 'thickness'] as const;

/**
 * The words each of the line's properties takes, the default first. Thickness
 * takes a multiple of normal (`2`) or pixels (`3px`) as well. `turn:` takes a fraction and
 * `step-out:` a distance, so neither has a list.
 */
export const LINE_VALUES = {
  path: ['straight', 'square', 'curved'],
  curve: ['normal', 'strong', 'subtle'],
  corners: ['sharp', 'rounded'],
  crossing: ['gap', 'none', 'arc', 'square'],
  pattern: ['solid', 'dashed', 'dotted', 'dash-dot'],
  thickness: ['normal', 'thin', 'thick'],
} as const;

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
  /** Placements in the text's bracket, against the box's own children (design.org 7.2). */
  titlePlacements?: Placement[];
  /** Everything the author said about where this goes. Empty for the anchor. */
  placements: Placement[];
  /** `stays above laptop.photos`: what it keeps clear of (design.org 5.6). */
  limits?: Limit[];
  attrs: Attrs;
  /** `guide node frame ""`: does everything a node does except draw (design.org 8.1). */
  guide?: boolean;
  line: number;
}

/**
 * What may be drawn at an end of a line. The `o` prefix is the outlined form of
 * the shape, one rule for every shape; `none` says there is definitely nothing,
 * where an end with no mark written leaves it to a style.
 */
export const MARKS = ['arrow', 'oarrow', 'dot', 'odot', 'diamond', 'odiamond', 'bar', 'none'] as const;

export type Mark = (typeof MARKS)[number];

/**
 * The glyphs that stand for a mark, by the end they are written at. A glyph
 * that points is spelled the way it points, so `<` is the arrow at the left end
 * and `>` the one at the right, which is what makes `<->` read. The diamonds
 * have none: nothing would explain itself, and `<>` is two arrows.
 */
export const MARK_GLYPHS: Record<'from' | 'to', Record<string, Mark>> = {
  from: { '<': 'arrow', '<|': 'oarrow', '*': 'dot', o: 'odot', '|': 'bar' },
  to: { '>': 'arrow', '|>': 'oarrow', '*': 'dot', o: 'odot', '|': 'bar' },
};

/** A side of something, as a text's bracket names it: `above s1`, `right of edge`. */
export type TextSide = 'above' | 'below' | 'left of' | 'right of';

/**
 * Where one text on a line sits, as its bracket says (design.org 7.3). Every
 * field is optional: with nothing said the text shares the line with the
 * other unplaced texts, spread evenly.
 */
export interface EdgeTextPlace {
  /** `at: 1/4`, `at: 0.25`, `at: start`, `at: end`: a spot along the line, or along the leg `on` names. */
  at?: number | 'start' | 'end';
  /** `on: rise`: the named leg the text sits on. */
  on?: string;
  /** `on: longest level`: the line's longest piece running left to right, the first of two the same length. */
  longestLevel?: boolean;
  /** `straight right from c`: where a line that way from c's middle first meets this one. */
  straight?: { way: Way; target: PlacementTarget; written: string };
  /**
   * `above s1`, `2 above s1`: a gap from the box, centered on it the other way, as a box
   * placed so would be; with `onLine`, where the line first reaches that height or position across.
   */
  by?: { side: TextSide; target: PlacementTarget; written: string };
  /** `on the line`: a text placed by a box stays on its line (design.org 7.3). */
  onLine?: boolean;
  /** `right of edge`: moved clear of the part of the line it landed on. */
  beside?: TextSide;
  /**
   * How far a text beside its line moves, from its spot on the line, the stated way:
   * `2 above edge` a distance; `clear above edge` (1) or `1/2 clear above edge` a
   * fraction of the move that clears the line, `edge-gap:` included. Unstated, it is
   * `clear`. Either may leave the text across its line, and that is meant.
   */
  rise?: { distance?: string; clear?: number; written: string };
  /**
   * `left even with x right`: one axis set by a box, at most one per axis; the
   * other stays where the text would otherwise sit (design.org 7.3).
   */
  even?: { placement: AlignPlacement; written: string }[];
  /** `gap:` — from the node, for `at: start`/`end` and a text placed by a box. */
  gap?: string;
  /** `edge-gap:` — off the line, for a text beside it. */
  edgeGap?: string;
  /** `reads: up`, `down` or `along`. */
  reads?: 'up' | 'down' | 'along';
}

/** One text on a line: what it says, how it looks, where it sits. */
export interface EdgeTextStmt {
  text: string;
  /** `color:`, `size:`, `wrap:` from its bracket. */
  textAttrs: Attrs;
  place: EdgeTextPlace;
}

/** The marks written in an edge's arrow, by end. An end with none written is absent. */
export interface EdgeMarks {
  from?: Mark;
  to?: Mark;
}

export interface EdgeStmt {
  kind: 'edge';
  /** The first name written. `from:` and `to:` follow writing order, never the arrow. */
  from: string;
  to: string;
  /** The arrow as written, `->` or `o--odiamond`, for quoting back. */
  arrow: string;
  /** The marks the arrow writes at each end: `->` is an arrow at `to`, `<-` one at `from`. */
  marks: EdgeMarks;
  /** `"1" (at: start) "places" "many" (at: end)`: each text in written order, with its own bracket (design.org 7.3). */
  texts: EdgeTextStmt[];
  /** `between desktop1 and laptop1` — the gap the line passes through. */
  between?: Passage;
  /**
   * `below resolver`, `left of a and b` — which side of a node the line is on
   * where it passes that node. The placement words, because it is the same
   * statement about the picture; on an edge it binds only the stretch where the
   * line is passing, as `between` does. Always `kind: 'offset'` with no gap.
   */
  passes?: OffsetPlacement[];
  /** `edge req client -> api`: the line's own name. */
  name?: string;
  /** `straight down`: the line leaves its start that way and stops at what it meets (design.org 6.2). */
  straight?: Way;
  /** `to: left, even with cat1`: what each end is even with, on the side its `from:`/`to:` names (6.2). */
  evenWith?: { from?: PlacementTarget[]; to?: PlacementTarget[] };
  /** `via: b top, between c and d, leg climb`: the places the line passes, in order (design.org 6.4). */
  via?: ViaEntry[];
  /** `edge each child of a -> b`: the end whose name is a container, one line per direct child of it (design.org 6.6). */
  each?: 'from' | 'to';
  /** `edge a -> b, c, d`: the end written as a list, and every name in it, one line to each (design.org 6.6). */
  several?: { side: 'from' | 'to'; names: string[] };
  attrs: Attrs;
  /** `guide edge a -> b`: shapes nothing differently, and is drawn only when guides are shown. */
  guide?: boolean;
  line: number;
}

/** One place a line passes (design.org 6.4). */
export type ViaStop =
  | {
      /**
       * `b top`, `server right 3/4 down`, `proxy`, `between c and d`, a named
       * point or region: anything section 4 names. A part of a box is just
       * outside it unless `on` or `inside` says otherwise.
       */
      kind: 'place';
      target: PlacementTarget;
      mode: 'outside' | 'on' | 'inside';
      gap?: string;
      /** `via: trunk (after: z)`: this line's place in a bundle's order, which only a bundle has. */
      order?: { way: 'after' | 'before'; name: string };
      written: string;
    }
  | {
      /** `via: trunk`: the whole length of a bundle, in this line's lane (6.6). Read from a place naming a bundle. */
      kind: 'bundle';
      bundle: string;
      order?: { way: 'after' | 'before'; name: string };
      written: string;
    }
  | { kind: 'through'; region: string; axis: 'horizontal' | 'vertical'; written: string }
  | { kind: 'alongside'; way: 'above' | 'below' | 'left of' | 'right of'; leg: string; gap?: string; written: string }
  | {
      /** `req at 1/3`, `req start`, `req end`, or a bare `req`, its middle: a point on a named line or leg. */
      kind: 'online';
      line: string;
      at: number | 'start' | 'end';
      /** `req b top`: the middle of where req runs along one of its own stops, written as that stop. */
      along?: string;
      written: string;
    };

/** An entry in a `via:` list: a stop, a leg's name, or a leg's name and the run it names. */
export interface ViaEntry {
  leg?: { name: string; attrs: Attrs };
  stop?: ViaStop;
}

/** A stop written as the author would write it. */
export function describeStop(stop: ViaStop): string {
  return stop.written;
}

/**
 * `point funnel  between c2 and api at 2/3` — a point with a name, so several
 * things can use it and moving it is one edit (design.org 4.5). Drawn as a dot.
 */
/**
 * A point's or a region's text and its bracket (design.org 7.4). `place` holds
 * the position words: a direction from the dot (`above-right`), or a side as a
 * title says it (`outside top`).
 */
export interface MarkText {
  text: string;
  textAttrs: Record<string, string>;
}

export interface PointStmt {
  kind: 'point';
  name: string;
  point: PlacementTarget;
  text?: MarkText;
  attrs: Attrs;
  guide?: boolean;
  line: number;
}

/**
 * `region r  c bottom-left to d top-right`, or `region r  between a and b` —
 * a rectangle with a name and every part a box has (design.org 4.5). It
 * bounds things without owning them, and is drawn as a tint (8.3).
 */
export interface RegionStmt {
  kind: 'region';
  name: string;
  /** The two corners, in either order; or one `between`, which is a region of its own. */
  corners: [PlacementTarget, PlacementTarget] | [PlacementTarget];
  text?: MarkText;
  attrs: Attrs;
  guide?: boolean;
  line: number;
}

/**
 * `bundle trunk  via: through slot horizontal`: a shared path several lines
 * travel together, built like a line with no ends (design.org 6.6). A line
 * joins it with `via: trunk` and runs its whole length.
 */
export interface BundleStmt {
  kind: 'bundle';
  name: string;
  /** A path out in space. A bundle has this or `between`, never both. */
  via?: ViaEntry[];
  /**
   * `bundle calls  a -> b`: between two boxes, the direct way unless its
   * `from:`, `to:` or `line: (path: …)` route it as one line would go.
   */
  between?: [string, string];
  /**
   * `layout: parallel (gap: tight)`, the default; `layout: collapsed`, a bus;
   * or, between two boxes only, `layout: fan`, lanes widest apart at the middle.
   */
  arrangement: 'parallel' | 'collapsed' | 'fan';
  /** The gap between neighboring members of a parallel bundle, as written. */
  gap?: string;
  /** `order: y, z, x`: every member, in reading order across where the bundle starts. */
  order?: string[];
  /**
   * `line:`, `from-mark:`, `to-mark:`: how a collapsed bundle's shared stretch
   * is drawn; between two boxes, `from:`, `to:` and `line: (path: …)` route it.
   */
  attrs: Attrs;
  line: number;
}

/** What a bundle may say besides `via:`, `layout:` and `order:`. */
export const BUNDLE_KEYS = ['via', 'layout', 'order', 'line', 'from-mark', 'to-mark', 'from', 'to'] as const;

/** What a point and a region may say. A region's padding pushes every edge out. */
export const POINT_KEYS = ['style', 'fill', 'depth'] as const;
/** Which way from its dot a point's text sits (design.org 7.4); the first is the default. */
export const POINT_TEXT_SIDES = ['above', 'below', 'left', 'right', 'above-right', 'above-left', 'below-right', 'below-left'] as const;
/** What a point's or a region's text takes in its bracket besides its position words. */
export const MARK_TEXT_KEYS = ['color', 'size', 'wrap', 'align', 'reads', 'gap'] as const;
export const REGION_KEYS = ['style', 'fill', 'opacity', 'border', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'depth'] as const;

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

/**
 * The attributes a `diagram` statement understands. `text` takes a bracket,
 * `text: (color: …)`, and sets the text color of everything at once — the
 * theme has one text color, shared by nodes and edges, and this is that.
 * `checks` takes a bracket too, `checks: (edge-crossings: on)`, turning kinds
 * of finding on or off by name. `title` is quoted, and names the drawing: the
 * SVG carries it as its own title, and a page made with `--page` heads with it.
 */
export const DIAGRAM_KEYS = ['theme', 'background', 'text', 'checks', 'guides', 'title'] as const;

/**
 * `default leaf  fill: #2e5d3a` — a style that applies to every thing of one
 * kind without being named. The more specific wins: `node` covers every node,
 * `leaf` and `container` beat it for the nodes they cover, and a thing's own
 * styles and words beat any default.
 */
export interface DefaultStmt {
  kind: 'default';
  target: DefaultTarget;
  attrs: Attrs;
  line: number;
}

export const DEFAULT_TARGETS = [
  'node',
  'leaf',
  'container',
  'edge',
  'guide node',
  'guide edge',
  'guide point',
  'guide region',
] as const;
export type DefaultTarget = (typeof DEFAULT_TARGETS)[number];

/**
 * What each default may say. A default carries a style's vocabulary, less the
 * words that would contradict the kind it is written for:
 *
 * - A default names its kind, so it is strict where a style is permissive —
 *   `default edge  fill:` can only be a mistake.
 * - `icon:` draws a picture, and a picture cannot hold children, so it is a
 *   leaf's word and not a container's or every node's.
 * - `heading:` names one node's own child, so it belongs to that node alone.
 *
 * `badge:` is every kind's: it makes the picture part of the label, a heading,
 * and a heading doesn't make a leaf a container.
 */
export const DEFAULT_KEYS: Record<DefaultTarget, readonly string[]> = {
  node: ['style', 'shape', 'badge', 'fill', 'border', 'corners', 'text'],
  leaf: ['style', 'shape', 'icon', 'badge', 'fill', 'border', 'corners', 'text'],
  container: ['style', 'shape', 'badge', 'fill', 'border', 'corners', 'text'],
  edge: ['style', 'line', 'text'],
  // A shown guide's look, one line per kind (design.org 8.2).
  'guide node': ['style', 'fill', 'border', 'corners', 'text'],
  'guide edge': ['style', 'line', 'text'],
  'guide point': ['style', 'fill'],
  'guide region': ['style', 'fill', 'border'],
};

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
 * - A node drawn as a picture, or with no body at all, takes no `fill:`,
 *   `border:` or `corners:`. There is no outline for any of them to reach.
 * - Neither of those takes `contents:` either, which says how a node's children
 *   sit, and neither may have any.
 * - `shape:` and `icon:` each name the body, so each appears only on the kind it
 *   makes. `shape:` is on `none` as well, because `shape: none` is how that kind
 *   is written in the first place.
 * - An edge takes no `gap:` or `overlap:`. Those are about where a box sits, and
 *   an edge is not placed — it joins two things that are.
 */
/** The keys that state a size; `size.ts` reads their values. */
export const SIZE_KEY_NAMES = ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'] as const;

/** `padding-right: 4`: one side's padding, over `padding:` on that side. */
export const PADDING_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export const PADDING_SIDE_KEYS = PADDING_SIDES.map((side) => `padding-${side}`);

/** `right-edge-order: ae, ad, ac`: the lines on one side of a box, in reading order. */
export const EDGE_ORDER_KEYS = ['top-edge-order', 'bottom-edge-order', 'left-edge-order', 'right-edge-order'] as const;

export const ATTR_KEYS: Record<Kind, readonly string[]> = {
  shape: ['style', 'overlap', 'layout', 'gather-children', 'padding', ...PADDING_SIDE_KEYS, ...SIZE_KEY_NAMES, 'heading', 'join-with', 'badge', 'cards', 'shape', 'fill', 'border', 'corners', 'text', 'url', 'description', 'depth', ...EDGE_ORDER_KEYS],
  icon: ['style', 'overlap', 'icon', 'join-with', 'text', 'url', 'description', 'depth', ...EDGE_ORDER_KEYS],
  none: ['style', 'overlap', 'layout', 'gather-children', 'padding', ...SIZE_KEY_NAMES, 'heading', 'join-with', 'shape', 'text', 'url', 'description', 'depth', ...EDGE_ORDER_KEYS],
  edge: ['style', 'from', 'to', 'via', 'from-mark', 'to-mark', 'line', 'text', 'url', 'description', 'depth'],
};

/**
 * What a node's `corners:` takes, the default first: a box is drawn rounded
 * unless it says otherwise. The same word and values as a line's `corners:`,
 * whose default is the other one. It applies to every outline with corners — a
 * rectangle and a document, whose fold stays as it is — and changes only the
 * drawing, never where anything sits.
 */
export const NODE_CORNERS = ['rounded', 'sharp'] as const;
export type NodeCorners = (typeof NODE_CORNERS)[number];

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
  ...new Set([...Object.values(ATTR_KEYS).flat(), ...DIAGRAM_KEYS, ...REGION_KEYS]),
];

export interface StyleStmt {
  kind: 'style';
  name: string;
  attrs: Attrs;
  line: number;
}

/**
 * `icon <name> <picture>`: a picture of the author's own, used by name wherever
 * a built-in one could be. `source` is as written — the SVG itself, or the path
 * of a file holding it.
 */
export interface IconStmt {
  kind: 'icon';
  name: string;
  source: string;
  /**
   * True when `source` is the SVG itself: written between `"""` marks, or
   * starting with `<`. Otherwise it names a file.
   */
  pasted: boolean;
  /** `icon gh  letters: "GH"  fill: …  text: …`: letters in a circle, in place of a picture. */
  letters?: { letters: string; fill?: string; text?: string };
  line: number;
}

/** Where `description: notes` keeps the name until `resolve` swaps in the text. */
export const DESCRIPTION_NAME_KEY = 'description.name';

/**
 * `description for proxy, cache """…"""` attaches one text to things already
 * named; `description notes """…"""` declares a named one, which a box or a
 * line takes with `description: notes`. The text is a small Markdown subset,
 * shown in the page's panel and, marks stripped, as an SVG's hover text.
 */
export interface DescriptionStmt {
  kind: 'description';
  /** The declared name, for the named form. */
  name?: string;
  /** The boxes and lines named after `for`, for the at-a-distance form. */
  targets?: string[];
  text: string;
  line: number;
}

/**
 * Where a `url:` that names declared links keeps its list, declared names and
 * quoted addresses in the order written, until `resolve` swaps each name for
 * the links it declares.
 */
export const LINK_NAMES_KEY = 'url.names';

/**
 * `url orders-docs "https://…" (name: "Docs", icon: "D")` declares a link once,
 * with its name and badge, for `url: orders-docs`. A declaration may hold
 * several links, each a quoted address or another declared name: a bundle.
 */
export interface UrlStmt {
  kind: 'url';
  name: string;
  entries: LinkEntry[];
  line: number;
}

export type Stmt = NodeStmt | EdgeStmt | StyleStmt | DiagramStmt | DefaultStmt | IconStmt | PointStmt | RegionStmt | BundleStmt | DescriptionStmt | UrlStmt;

export interface Document {
  statements: Stmt[];
}
