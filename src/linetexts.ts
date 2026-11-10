/**
 * Where each text on a line sits (design.org 7.3).
 *
 * The line is drawn first, and every placement here is a measurement on the
 * drawn line: a fraction along it, a spot a gap from one end, where a way
 * straight out from a box first meets it, where it first reaches a height. One
 * pass, no search, and a text never moves anything, itself included: texts
 * that land on each other are drawn so and reported (`text-overlap`).
 *
 * The renderer and the checks both place texts through here, so what is
 * reported is what is drawn.
 */
import type { TextSide } from './ast.js';
import { arrowLength } from './constants.js';
import { SourceError } from './errors.js';
import type { LayoutEdge, LayoutEdgeText } from './model.js';
import { gapPixels } from './place.js';
import { traceRoute, type Point, type Route } from './lines.js';

/**
 * A text's distance from what it is placed against when nothing says:
 * from the node for `at: start`, from a box for `above s1`, off the line for
 * `right of edge`. Half a unit, because a text names the thing beside it and
 * reads as detached any further off.
 */
export const TEXT_GAP = 6;

/** How far the hole a text knocks in its line reaches past the words, either side. */
export const KNOCKOUT_PAD = 5;

/**
 * The room the patch behind a text leaves round it, across and up and down:
 * by default the knockout's reach either side and none above or below, and
 * `padding:` in its bracket all round, as a box's padding is.
 */
export function patchPadding(text: LayoutEdgeText, subject: string, line: number): { x: number; y: number } {
  const written = text.textAttrs['padding'];
  if (written === undefined) return { x: KNOCKOUT_PAD, y: 0 };
  const by = gapPixels(written, `${subject}: the text "${text.text}" padding`, line);
  return { x: by, y: by };
}

/** One text, placed. */
export interface PlacedText {
  text: LayoutEdgeText;
  /** The middle of the words. */
  center: Point;
  /** Degrees clockwise, as SVG turns: 0 reads left to right, -90 up, 90 down. */
  angle: number;
  /** What the text covers on the page, its knockout included, as an upright box. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  /**
   * Moved off its line by `right of edge` and the rest, rather than sitting on it,
   * and meant to be clear of it: not a stated distance or part of the way clear.
   */
  beside: boolean;
}

/** A polyline with the distance along it to each point. */
interface Measured {
  points: Point[];
  lengths: number[];
  total: number;
}

function measured(points: Point[]): Measured {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const [a, b] = [points[index - 1]!, points[index]!];
    lengths.push(lengths[index - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { points, lengths, total: lengths[lengths.length - 1]! };
}

/**
 * `on: longest level`: the line's longest straight run left to right, level
 * pieces in a row at one height counted as one, the first of two the same
 * length. A curve has no straight pieces, so a curved line has none, and
 * asking for it there is refused rather than falling back to the middle.
 */
function longestLevel(route: Route, about: string): Measured {
  let best: Point[] = [];
  let run: Point[] = [];
  let from = route.start;
  for (const piece of route.pieces) {
    const level = !('c1' in piece) && Math.abs(piece.to.y - from.y) < 0.5 && Math.abs(piece.to.x - from.x) >= 0.5;
    if (!level) run = [];
    else if (run.length > 0 && Math.abs(run[0]!.y - from.y) < 0.5) run.push(piece.to);
    else run = [from, piece.to];
    if (run.length > 0 && Math.abs(run[run.length - 1]!.x - run[0]!.x) > Math.abs((best[best.length - 1]?.x ?? 0) - (best[0]?.x ?? 0)) + 0.5) best = [...run];
    from = piece.to;
  }
  if (best.length === 0) {
    throw new SourceError(`${about} is on: longest level, and this line has no level piece — place the text along it with at:`, route.edge.line);
  }
  return measured(best);
}

/** The piece of a polyline that holds the spot `s` along it, never one of no length if another will do. */
function pieceHolding(line: Measured, s: number): number {
  let index = 1;
  while (index < line.points.length - 1 && line.lengths[index]! < s) index += 1;
  // A spot at a corner belongs to the piece after it, and a piece of no length to its neighbor.
  while (index < line.points.length - 1 && line.lengths[index]! - line.lengths[index - 1]! < 1e-9) index += 1;
  while (index > 1 && line.lengths[index]! - line.lengths[index - 1]! < 1e-9) index -= 1;
  return index;
}

function spotAlong(line: Measured, s: number): Point {
  if (line.points.length === 1) return line.points[0]!;
  const index = pieceHolding(line, s);
  const [a, b] = [line.points[index - 1]!, line.points[index]!];
  const piece = line.lengths[index]! - line.lengths[index - 1]!;
  const t = piece === 0 ? 0 : Math.min(1, Math.max(0, (s - line.lengths[index - 1]!) / piece));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The way the line runs at `s`, from its start toward its end, as a unit step. */
function headingAlong(line: Measured, s: number): Point {
  if (line.points.length === 1) return { x: 1, y: 0 };
  const index = pieceHolding(line, s);
  const [a, b] = [line.points[index - 1]!, line.points[index]!];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

/** How far along the line the point on it nearest `p` is. */
function distanceTo(line: Measured, p: Point): number {
  let best = 0;
  let nearest = Infinity;
  for (let index = 1; index < line.points.length; index += 1) {
    const [a, b] = [line.points[index - 1]!, line.points[index]!];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = dx * dx + dy * dy;
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / span));
    const off = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    if (off < nearest - 1e-9) {
      nearest = off;
      best = line.lengths[index - 1]! + t * Math.sqrt(span);
    }
  }
  return best;
}

/** Where a ray from `origin` the way `way` points first meets the line, as a distance along the line. */
function firstMeeting(line: Measured, origin: Point, way: Point): number | undefined {
  let nearest = Infinity;
  let found: number | undefined;
  for (let index = 1; index < line.points.length; index += 1) {
    const [a, b] = [line.points[index - 1]!, line.points[index]!];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denominator = way.x * ey - way.y * ex;
    if (Math.abs(denominator) < 1e-12) {
      // Running along the ray: the nearer end of the piece is where it is met, if it is on the ray at all.
      const across = (a.x - origin.x) * way.y - (a.y - origin.y) * way.x;
      if (Math.abs(across) > 1e-6) continue;
      for (const [end, t] of [[a, 0], [b, 1]] as const) {
        const out = (end.x - origin.x) * way.x + (end.y - origin.y) * way.y;
        if (out >= -1e-9 && out < nearest) {
          nearest = out;
          found = line.lengths[index - 1]! + t * (line.lengths[index]! - line.lengths[index - 1]!);
        }
      }
      continue;
    }
    const wx = a.x - origin.x;
    const wy = a.y - origin.y;
    const out = (wx * ey - wy * ex) / denominator;
    const t = (wx * way.y - wy * way.x) / denominator;
    if (out < -1e-9 || t < -1e-9 || t > 1 + 1e-9) continue;
    if (out < nearest) {
      nearest = out;
      found = line.lengths[index - 1]! + Math.min(1, Math.max(0, t)) * (line.lengths[index]! - line.lengths[index - 1]!);
    }
  }
  return found;
}

/** Where the line first reaches `value` on `axis`, from its start, as a distance along it. */
function firstReaching(line: Measured, axis: 'x' | 'y', value: number): number | undefined {
  for (let index = 1; index < line.points.length; index += 1) {
    const [a, b] = [line.points[index - 1]!, line.points[index]!];
    const low = Math.min(a[axis], b[axis]);
    const high = Math.max(a[axis], b[axis]);
    if (value < low - 1e-9 || value > high + 1e-9) continue;
    const span = b[axis] - a[axis];
    const t = Math.abs(span) < 1e-12 ? 0 : (value - a[axis]) / span;
    return line.lengths[index - 1]! + Math.min(1, Math.max(0, t)) * (line.lengths[index]! - line.lengths[index - 1]!);
  }
  return undefined;
}

/**
 * The stretch of the line around `s` that stays inside a band across the page,
 * walked both ways from `s` until it leaves: the part a text beside the line
 * landed on (design.org 7.3), all of it within the text's own height (for a
 * side to the left or right) or width (above or below).
 */
function partInBand(line: Measured, s: number, axis: 'x' | 'y', low: number, high: number): Point[] {
  const inside = (p: Point) => p[axis] >= low - 1e-6 && p[axis] <= high + 1e-6;
  const here = spotAlong(line, s);
  const part = [here];
  if (!inside(here)) return part;
  const edgeOf = (a: Point, b: Point): Point => {
    const bound = b[axis] > high ? high : low;
    const t = (bound - a[axis]) / (b[axis] - a[axis]);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const index = pieceHolding(line, s);
  let from = here;
  for (let at = index; at < line.points.length; at += 1) {
    const next = line.points[at]!;
    if (!inside(next)) {
      part.push(edgeOf(from, next));
      break;
    }
    part.push(next);
    from = next;
  }
  from = here;
  for (let at = index - 1; at >= 0; at -= 1) {
    const next = line.points[at]!;
    if (!inside(next)) {
      part.push(edgeOf(from, next));
      break;
    }
    part.push(next);
    from = next;
  }
  return part;
}

/** The size of a box `width` by `height` turned by `angle` degrees, as an upright box. */
function turned(width: number, height: number, angle: number): { width: number; height: number } {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}

/** Which way a text reads, from its bracket and the way the line runs where it sits (design.org 7.3). */
function angleOf(text: LayoutEdgeText, heading: Point): number {
  const reads = text.place.reads;
  if (reads === undefined) return 0;
  if (reads === 'up') return -90;
  if (reads === 'down') return 90;
  // Along: the line's angle, read whichever way is closer to upright, so never upside down.
  if (Math.abs(heading.x) < 1e-6) {
    // Exactly upright, both ways are readable. Beside the line the text faces
    // it, feet toward it; on the line it follows the line from the first name
    // written toward the second.
    const beside = text.place.beside;
    if (beside === 'right of') return 90;
    if (beside === 'left of') return -90;
    return heading.y > 0 ? 90 : -90;
  }
  let angle = (Math.atan2(heading.y, heading.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

/** One way on the page, as a unit step. */
const WAY_STEP: Record<string, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Every text on one line, placed. Texts placed along the line, by a box, or
 * near an end cut the line into stretches, and the texts with no place of
 * their own spread evenly within the stretch they were written in: one at
 * the middle, three at a quarter, a half and three-quarters (design.org 7.3).
 */
export function placeLineTexts(edge: LayoutEdge, route: Route): PlacedText[] {
  if (edge.texts.length === 0) return [];
  const whole = measured(traceRoute(route));
  const subject = `edge ${edge.from.name} ${edge.arrow} ${edge.to.name}`;

  // Where each text lands on the line, as a distance along the whole of it.
  const landing: (number | undefined)[] = edge.texts.map((text) => {
    const place = text.place;
    const about = `${subject}: the text "${text.text}"`;
    const on = place.longestLevel
      ? longestLevel(route, about)
      : place.on === undefined
        ? whole
        : measured(route.legs.get(place.on) ?? []);
    const onLeg = place.longestLevel ? ' (its longest level piece)' : place.on === undefined ? '' : ` (leg ${place.on})`;
    const toWhole = (s: number) => (on === whole ? s : distanceTo(whole, spotAlong(on, s)));
    if (typeof place.at === 'number') return toWhole(place.at * on.total);
    if (place.at === 'start' || place.at === 'end') {
      // A gap along the line from the end, clear of a mark there, however long the line.
      const fromEnd = place.at === 'start';
      const heading = headingAlong(on, fromEnd ? 0 : on.total);
      const size = turned(text.width, text.height, angleOf(text, heading));
      const half = (size.width / 2) * Math.abs(heading.x) + (size.height / 2) * Math.abs(heading.y);
      const mark = on === whole && edge.marks[fromEnd ? 'from' : 'to'] !== 'none' ? arrowLength(edge.look.thickness) : 0;
      const gap = place.gap === undefined ? TEXT_GAP : gapPixels(place.gap, `${about}: gap:`, edge.line);
      const s = Math.min(on.total, mark + gap + half);
      return toWhole(fromEnd ? s : on.total - s);
    }
    if (place.straight) {
      const box = text.target!;
      const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const s = firstMeeting(on, origin, WAY_STEP[place.straight.way]!);
      if (s === undefined) {
        throw new SourceError(
          `${about} is placed ${place.straight.written}, and a way ${place.straight.way} from there never meets this line${onLeg} — ` +
            'name another box, or place the text along the line with at:',
          edge.line,
        );
      }
      return toWhole(s);
    }
    if (place.by && !place.onLine) {
      // Off the line by the box; it lands on the line where the line comes nearest, for ordering the rest.
      const gap = place.gap === undefined ? TEXT_GAP : gapPixels(place.gap, `${about}: gap:`, edge.line);
      return distanceTo(whole, byBox(place.by.side, text.target!, gap, turned(text.width, text.height, angleOf(text, { x: 1, y: 0 }))));
    }
    if (place.by) {
      const box = text.target!;
      const gap = place.gap === undefined ? TEXT_GAP : gapPixels(place.gap, `${about}: gap:`, edge.line);
      const [axis, value] = reachFor(place.by.side, box, gap);
      const s = firstReaching(on, axis, value);
      if (s === undefined) {
        throw new SourceError(
          `${about} is placed ${place.by.written}, and this line${onLeg} never reaches ` +
            `${axis === 'y' ? 'that height' : 'that far across'} — name another box, or place the text along the line with at:`,
          edge.line,
        );
      }
      return toWhole(s);
    }
    if (on !== whole) return toWhole(on.total / 2);
    return undefined;
  });

  // The unplaced ones, spread in the stretch between the placed ones written either side of them.
  for (let index = 0; index < landing.length; ) {
    if (landing[index] !== undefined) {
      index += 1;
      continue;
    }
    let past = index;
    while (past < landing.length && landing[past] === undefined) past += 1;
    const low = index > 0 ? landing[index - 1]! : 0;
    const high = past < landing.length ? landing[past]! : whole.total;
    const count = past - index;
    for (let at = 0; at < count; at += 1) landing[index + at] = low + ((high - low) * (at + 1)) / (count + 1);
    index = past;
  }

  return edge.texts.map((text, index) => {
    const s = landing[index]!;
    const place = text.place;
    const spot = spotAlong(whole, s);
    const angle = angleOf(text, headingAlong(whole, s));
    const size = turned(text.width, text.height, angle);
    let center = spot;
    if (place.by && !place.onLine) {
      const gap = place.gap === undefined ? TEXT_GAP : gapPixels(place.gap, `${subject}: the text "${text.text}" gap:`, edge.line);
      center = byBox(place.by.side, text.target!, gap, size);
    } else if (place.by) {
      // The text's own edge facing the box is on the crossing, its middle at the line there.
      const out = { above: [0, -1], below: [0, 1], 'left of': [-1, 0], 'right of': [1, 0] }[place.by.side];
      center = { x: spot.x + (out[0]! * size.width) / 2, y: spot.y + (out[1]! * size.height) / 2 };
    }
    if (place.beside && place.rise?.distance !== undefined) {
      // `2 above edge`: that far from its spot on the line, the stated way, whatever the line does.
      const by = gapPixels(place.rise.distance, `${subject}: the text "${text.text}" ${place.rise.written}`, edge.line);
      const out = { above: [0, -1], below: [0, 1], 'left of': [-1, 0], 'right of': [1, 0] }[place.beside];
      center = { x: center.x + out[0]! * by, y: center.y + out[1]! * by };
    } else if (place.beside) {
      const gap = place.edgeGap === undefined ? TEXT_GAP : gapPixels(place.edgeGap, `${subject}: the text "${text.text}" edge-gap`, edge.line);
      const clear = besideLine(whole, s, center, size, place.beside, gap);
      // `1/2 clear above edge`: that fraction of the move that clears it.
      const fraction = place.rise?.clear ?? 1;
      center = { x: center.x + (clear.x - center.x) * fraction, y: center.y + (clear.y - center.y) * fraction };
    }
    const pad = patchPadding(text, subject, edge.line);
    const knockout = turned(text.width + pad.x * 2, text.height + pad.y * 2, angle);
    for (const even of text.evenAt ?? []) {
      // `left even with x right` sets one axis, measured to the patch's edge, the edge that is seen; the other stays where the line put it.
      const half = (even.axis === 'x' ? knockout.width : knockout.height) / 2;
      const start = even.axis === 'x' ? even.rect.x : even.rect.y;
      const length = even.axis === 'x' ? even.rect.width : even.rect.height;
      const value = even.side === 'start' ? start + half : even.side === 'end' ? start + length - half : start + length / 2;
      center = even.axis === 'x' ? { x: value, y: center.y } : { x: center.x, y: value };
    }
    return {
      text,
      center,
      angle,
      box: {
        minX: center.x - knockout.width / 2,
        minY: center.y - knockout.height / 2,
        maxX: center.x + knockout.width / 2,
        maxY: center.y + knockout.height / 2,
      },
      // A stated distance, or less than the whole way clear, may leave it across its line on purpose.
      beside: place.beside !== undefined && place.rise?.distance === undefined && (place.rise?.clear ?? 1) >= 1,
    };
  });
}

/** For `2 above s1` and the rest: the text's middle, a gap off the box and centered on it the other way, as a box placed so would be. */
function byBox(side: TextSide, box: { x: number; y: number; width: number; height: number }, gap: number, size: { width: number; height: number }): Point {
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  switch (side) {
    case 'above':
      return { x: middle.x, y: box.y - gap - size.height / 2 };
    case 'below':
      return { x: middle.x, y: box.y + box.height + gap + size.height / 2 };
    case 'left of':
      return { x: box.x - gap - size.width / 2, y: middle.y };
    case 'right of':
      return { x: box.x + box.width + gap + size.width / 2, y: middle.y };
  }
}

/** For `above s1, on the line` and the rest: the axis the line must reach, and where along it, a gap off the box. */
function reachFor(side: TextSide, box: { x: number; y: number; width: number; height: number }, gap: number): ['x' | 'y', number] {
  switch (side) {
    case 'above':
      return ['y', box.y - gap];
    case 'below':
      return ['y', box.y + box.height + gap];
    case 'left of':
      return ['x', box.x - gap];
    case 'right of':
      return ['x', box.x + box.width + gap];
  }
}

/**
 * A text moved off its line the stated way, on the page, until it is a gap
 * clear of the part of the line it landed on. No angle is judged, so a level
 * stretch with `right of edge` puts the text past its right end, and a
 * near-level curve never flips a text from one side to the other.
 */
function besideLine(line: Measured, s: number, center: Point, size: { width: number; height: number }, side: TextSide, gap: number): Point {
  if (side === 'left of' || side === 'right of') {
    const part = partInBand(line, s, 'y', center.y - size.height / 2, center.y + size.height / 2);
    const xs = part.map((p) => p.x);
    return side === 'right of'
      ? { x: Math.max(...xs) + gap + size.width / 2, y: center.y }
      : { x: Math.min(...xs) - gap - size.width / 2, y: center.y };
  }
  const part = partInBand(line, s, 'x', center.x - size.width / 2, center.x + size.width / 2);
  const ys = part.map((p) => p.y);
  return side === 'below'
    ? { x: center.x, y: Math.max(...ys) + gap + size.height / 2 }
    : { x: center.x, y: Math.min(...ys) - gap - size.height / 2 };
}
