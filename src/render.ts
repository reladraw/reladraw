import {
  ARROW_MARKER_WIDTH,
  ATTACH_MARGIN,
  ATTACH_STEP,
  DECK_STEP,
  DEFAULT_FONT_SIZE,
  ICON_GAP,
  ICON_LINES,
  LINE_WIDTH,
  PAD,
  fontSizeFor,
  labelExtent,
  labelStyleFor,
} from './constants.js';
import type { Axis } from './ast.js';
import { describeAxis } from './ast.js';
import { SourceError } from './errors.js';
import { ICON_STROKE, iconFor, shapeFor, type BoxShape, type Icon, type IconTone } from './icons.js';
import { monospaceMeasurer, type Measurer } from './measure.js';
import type { Layout, LayoutLink, LayoutNode } from './model.js';

export interface RenderOptions {
  measurer?: Measurer;
  fontSize?: number;
  theme?: Theme;
}

export interface Theme {
  background: string;
  boxFill: string;
  boxStroke: string;
  containerFill: string;
  /** A container is a region rather than a thing, so its outline is quieter. */
  containerStroke: string;
  text: string;
  mutedText: string;
  link: string;
  /** An icon's drawn line. */
  iconInk: string;
  /** The body an icon's lines enclose. */
  iconShade: string;
}

/**
 * Sampled out of `examples/reference/arch.png` rather than invented,
 * so the benchmark render and the drawing it is measured against differ by
 * geometry and typography alone. A container is a shade off the page and barely
 * outlined; a leaf is the navy that carries the diagram's weight.
 */
export const DARK_THEME: Theme = {
  background: '#111111',
  boxFill: '#191728',
  boxStroke: '#4f5367',
  containerFill: '#191920',
  containerStroke: '#25242f',
  text: '#d9d9d9',
  mutedText: '#8b8b8b',
  link: '#5c5c7c',
  // Both sampled off the reference's machine glyphs. Note that the reference
  // gives each icon its own hue — the drive is grey, the laptop periwinkle, the
  // workstation violet — which is a drawing tool's per-shape default and not a
  // system. One pair for the whole set is the deliberate difference: an icon
  // should read as part of the diagram's palette, not as clip art dropped in.
  iconInk: '#8d8d8e',
  iconShade: '#3e3d58',
};

const CORNER = 8;

/** A rectangle of the drawing, in the same absolute coordinates as the nodes. */
interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Turn solved geometry into a standalone SVG document. */
export function render(layout: Layout, options: RenderOptions = {}): string {
  const measurer = options.measurer ?? monospaceMeasurer();
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  // `diagram background:` is the author overruling the theme for this one
  // drawing, so it is folded in here and everything downstream sees one theme.
  const base = options.theme ?? DARK_THEME;
  const stated = layout.diagram['background'];
  const theme = stated === undefined ? base : { ...base, background: stated };

  const body: string[] = [];
  for (const root of layout.roots) {
    body.push(drawNode(root, theme, measurer, fontSize));
  }
  // Everything the boxes cover. Links are added to it as they are drawn.
  let ink: Extent = { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height };
  // Endpoints are planned for every link at once, because where a link meets a
  // side depends on what else meets that same side. Corridors come after, for
  // the same reason in the other direction: which lane of a gap a link takes
  // is ordered by where its ends turned out to be.
  const ends = planEndpoints(layout.links);
  const corridors = planCorridors(layout.links, ends, measurer, fontSize);
  aimFreeEnds(layout.links, ends, corridors);
  for (const link of layout.links) {
    const drawn = drawLink(link, ends.get(link)!, corridors.get(link), theme, measurer, fontSize);
    body.push(drawn.svg);
    ink = union(ink, grow(drawn.ink, layout.margin));
  }

  // A link's geometry is measured rather than solved for, so the resolver sized
  // the canvas from the boxes alone. A curve out of a `top` side, or a label
  // riding above one, lands outside that — so the page grows to hold it and the
  // origin moves with it, rather than the drawing being quietly clipped.
  const canvas = {
    x: Math.floor(ink.minX),
    y: Math.floor(ink.minY),
    width: Math.ceil(ink.maxX) - Math.floor(ink.minX),
    height: Math.ceil(ink.maxY) - Math.floor(ink.minY),
  };

  const arrowColours = new Set(layout.links.map((link) => colourOf(link.appearance, theme.link)));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="${canvas.x} ${canvas.y} ${canvas.width} ${canvas.height}" font-family=${quote(measurer.fontFamily)} font-size="${fontSize}px">`,
    '  <defs>',
    ...[...arrowColours].map((colour) => arrowMarker(colour)),
    '  </defs>',
    `  <rect x="${canvas.x}" y="${canvas.y}" width="${canvas.width}" height="${canvas.height}" fill="${theme.background}"/>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

// --- nodes -------------------------------------------------------------------

function drawNode(
  node: LayoutNode,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
): string {
  // A note is set smaller than a box label by default, and `size:` overrides
  // that on anything. Only this node's own text takes the size — children are
  // drawn by their own call and carry whatever they say themselves.
  const size = fontSizeFor(node.kind, node.appearance, fontSize, node.line);
  const textHeight = measurer.lineHeight(size);

  if (node.kind === 'note') {
    return sized(
      textBlock(node.lines, node.x, node.y, node.width, textHeight, size, {
        colour: colourOf(node.appearance, theme.text),
        align: 'start',
      }),
      size,
      fontSize,
    );
  }

  const shape = shapeFor(node.appearance, node.line);
  const labelStyle = labelStyleFor(node.label, node.line);
  const glyphSide = ICON_LINES * textHeight;

  if (shape.body !== undefined) {
    // No outline, no fill, no padding — the node is the picture. The label, if
    // there is one, sits under it and centred.
    const drawn = [drawIcon(shape.body, node.x + (node.width - glyphSide) / 2, node.y, glyphSide, theme)];
    if (node.lines.some((line) => line.length > 0)) {
      drawn.push(
        sized(
          textBlock(node.lines, node.x, node.y + glyphSide + ICON_GAP, node.width, textHeight, size, {
            colour: colourOf(node.appearance, theme.text),
            subColour: subtextOf(node.appearance, theme),
            align: 'middle',
          }),
          size,
          fontSize,
        ),
      );
    }
    return drawn.join('\n');
  }

  const parts: string[] = [];
  const face = faceOf(node);
  const container = node.children.length > 0;
  const stroke = colourOf(node.appearance, container ? theme.containerStroke : theme.boxStroke);
  const fill = fillOf(node.appearance, container ? theme.containerFill : theme.boxFill);
  const subColour = subtextOf(node.appearance, theme);

  // Deck copies sit behind the front face, furthest back drawn first.
  for (let depth = node.deckLabels.length; depth >= 1; depth -= 1) {
    const x = face.x - depth * DECK_STEP;
    const y = face.y - depth * DECK_STEP;
    parts.push(
      `  <path d="${outlinePath(shape.outline, x, y, face.width, face.height)}" fill="${theme.containerFill}" stroke="${stroke}"/>`,
    );
    const label = node.deckLabels[depth - 1];
    if (label !== undefined) {
      parts.push(
        sized(
          textBlock([label], x + PAD, y + PAD, face.width - PAD * 2, textHeight, size, {
            colour: theme.text,
            align: 'start',
          }),
          size,
          fontSize,
        ),
      );
    }
  }

  parts.push(
    `  <path d="${outlinePath(shape.outline, face.x, face.y, face.width, face.height)}" fill="${fill}" stroke="${stroke}"/>`,
  );
  for (const extra of outlineDetail(shape.outline, face.x, face.y, face.width, face.height)) {
    parts.push(`  <path d="${extra}" fill="none" stroke="${stroke}"/>`);
  }

  // The icon takes a column on the right and the label lays out in what is
  // left, which is the room the resolver already reserved for exactly this.
  const icon = iconFor(node.appearance, node.line);
  const iconSide = icon === undefined ? 0 : glyphSide;
  const hasLabel = node.lines.some((line) => line.length > 0);
  const iconRoom = icon === undefined ? 0 : iconSide + (hasLabel ? ICON_GAP : 0);

  if (!container) {
    // A leaf centres its label in the box, both ways — in the room beside the
    // icon rather than the whole box, so the two sit side by side.
    const top = face.y + (face.height - node.lines.length * textHeight) / 2;
    parts.push(
      sized(
        textBlock(node.lines, face.x, top, face.width - iconRoom, textHeight, size, {
          colour: theme.text,
          subColour,
          align: 'middle',
        }),
        size,
        fontSize,
      ),
    );
  } else {
    // The label and the icon share a band at one end of the box, and the
    // resolver has already given the contents the other end. A heading is
    // ranged left at the top; a caption is centred at the bottom.
    const band = Math.max(node.lines.length * textHeight, iconSide);
    const bandTop = labelStyle.at === 'top' ? face.y + PAD : face.y + face.height - PAD - band;
    parts.push(
      sized(
        textBlock(node.lines, face.x + PAD, bandTop, face.width - PAD * 2 - iconRoom, textHeight, size, {
          colour: theme.text,
          subColour,
          align: labelStyle.align,
        }),
        size,
        fontSize,
      ),
    );
    for (const child of node.children) {
      parts.push(drawNode(child, theme, measurer, fontSize));
    }
  }

  if (icon !== undefined) {
    // A container's icon rides in the label's band, at whichever end that is; a
    // leaf's label is centred, so the icon centres with it. Both follow the
    // label rather than being placed by a rule of their own, which is what
    // keeps an icon reading as part of the title block and not as a sticker.
    const left = face.x + face.width - PAD - iconSide;
    const top = container
      ? labelStyle.at === 'top'
        ? face.y + PAD
        : face.y + face.height - PAD - iconSide
      : face.y + (face.height - iconSide) / 2;
    parts.push(drawIcon(icon, left, top, iconSide, theme));
  }

  return parts.join('\n');
}

/**
 * How far the dog-ear cuts into the top-right corner of a `document`.
 *
 * Twice the corner radius, so it is the same size on every box however wide.
 * The reference sizes its fold as a fraction of the box, which is why the fold
 * on those two wide `pg_dump` boxes almost disappears — the idea was right and
 * only the scaling was wrong.
 */
const FOLD = CORNER * 2;

/** The node's outline, as path data. */
function outlinePath(shape: BoxShape, x: number, y: number, w: number, h: number): string {
  const r = CORNER;
  if (shape === 'document') {
    // Every corner rounded but the top-right one, which is cut away and folded.
    return [
      `M${round(x + r)} ${round(y)}`,
      `H${round(x + w - FOLD)}`,
      `L${round(x + w)} ${round(y + FOLD)}`,
      `V${round(y + h - r)}`,
      `a${r} ${r} 0 0 1 ${-r} ${r}`,
      `H${round(x + r)}`,
      `a${r} ${r} 0 0 1 ${-r} ${-r}`,
      `V${round(y + r)}`,
      `a${r} ${r} 0 0 1 ${r} ${-r}`,
      'Z',
    ].join(' ');
  }
  return [
    `M${round(x + r)} ${round(y)}`,
    `H${round(x + w - r)}`,
    `a${r} ${r} 0 0 1 ${r} ${r}`,
    `V${round(y + h - r)}`,
    `a${r} ${r} 0 0 1 ${-r} ${r}`,
    `H${round(x + r)}`,
    `a${r} ${r} 0 0 1 ${-r} ${-r}`,
    `V${round(y + r)}`,
    `a${r} ${r} 0 0 1 ${r} ${-r}`,
    'Z',
  ].join(' ');
}

/** Lines drawn inside the outline: the flap of a fold, and nothing else so far. */
function outlineDetail(shape: BoxShape, x: number, y: number, w: number, h: number): string[] {
  void h;
  if (shape !== 'document') return [];
  return [
    `M${round(x + w - FOLD)} ${round(y)} V${round(y + FOLD)} H${round(x + w)}`,
  ];
}

/** One icon, scaled from its own grid onto a square of `side` at `x, y`. */
function drawIcon(icon: Icon, x: number, y: number, side: number, theme: Theme): string {
  const scale = side / icon.grid;
  const colour = (tone: IconTone | undefined): string =>
    tone === 'ink' ? theme.iconInk : tone === 'shade' ? theme.iconShade : theme.background;

  const paths = icon.paths.map((path) => {
    const fill = path.fill === undefined ? 'none' : colour(path.fill);
    const stroke =
      path.stroke === undefined
        ? ''
        : ` stroke="${colour(path.stroke)}" stroke-width="${ICON_STROKE}" stroke-linejoin="round"`;
    return `    <path d="${path.d}" fill="${fill}"${stroke}/>`;
  });

  return [
    `  <g transform="translate(${round(x)} ${round(y)}) scale(${round(scale * 1000) / 1000})">`,
    ...paths,
    '  </g>',
  ].join('\n');
}

// --- links -------------------------------------------------------------------

function drawLink(
  link: LayoutLink,
  ends: LinkEnds,
  corridor: Corridor | undefined,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
): { svg: string; ink: Extent } {
  const { start, end } = ends;
  const colour = colourOf(link.appearance, theme.link);

  const markerEnd = ` marker-end="url(#${markerId(colour)})"`;
  const markerStart = link.both ? ` marker-start="url(#${markerId(colour)}-back)"` : '';

  // A named side is a statement about how the line should leave or arrive, so
  // it is drawn as a curve that actually does leave and arrive that way. With
  // neither side named there is nothing to honour and the line stays straight.
  const curved = start.side !== undefined || end.side !== undefined;
  const parts: string[] = [];
  // What the line actually covers, so the canvas can be sized to hold it. A
  // curve leaving a `top` side rides above every box in the drawing, and the
  // node bounds know nothing about it.
  let ink = extentOfPoints([start, end]);
  let midX: number;
  let midY: number;

  if (corridor) {
    const path = corridorPath(start, end, corridor);
    ink = union(ink, path.ink);
    parts.push(
      `  <path d="${path.d}" fill="none" stroke="${colour}" stroke-width="${LINE_WIDTH}"${markerEnd}${markerStart}/>`,
    );
    // The label goes on the straight run rather than at the midpoint of the
    // whole path, so it sits in the gap the author asked the line to travel.
    midX = path.mid.x;
    midY = path.mid.y;
  } else if (curved) {
    const reach = controlReach(start, end);
    const c1 = { x: start.x + start.tx * reach, y: start.y + start.ty * reach };
    const c2 = { x: end.x + end.tx * reach, y: end.y + end.ty * reach };
    parts.push(
      `  <path d="M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}" fill="none" stroke="${colour}" stroke-width="${LINE_WIDTH}"${markerEnd}${markerStart}/>`,
    );
    ink = union(ink, cubicExtent(start, c1, c2, end));
    // The point halfway along a cubic, which is where the label belongs.
    midX = (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8;
    midY = (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8;
  } else {
    parts.push(
      `  <line x1="${round(start.x)}" y1="${round(start.y)}" x2="${round(end.x)}" y2="${round(end.y)}" stroke="${colour}" stroke-width="${LINE_WIDTH}"${markerEnd}${markerStart}/>`,
    );
    midX = (start.x + end.x) / 2;
    midY = (start.y + end.y) / 2;
  }

  if (link.label !== undefined) {
    // A link label breaks on ` / ` exactly as a box label does, so a two-line
    // caption on an arrow needs no vocabulary of its own. The block is centred
    // on the midpoint, which keeps a one-line label where it has always been.
    const size = fontSizeFor('link', link.appearance, fontSize, link.line);
    const textHeight = measurer.lineHeight(size);
    const { width, lines } = measurer.measure(link.label, size);
    const height = lines.length * textHeight;
    const top = midY - height / 2;
    // The label knocks a hole in whatever it lands on rather than sitting in a
    // chip of its own: an outlined box reads as a node, which is the one thing
    // a label on a line is not.
    parts.push(
      `  <rect x="${round(midX - width / 2 - 5)}" y="${round(top)}" width="${round(width + 10)}" height="${round(height)}" fill="${theme.background}"/>`,
    );
    ink = union(ink, {
      minX: midX - width / 2 - 5,
      minY: top,
      maxX: midX + width / 2 + 5,
      maxY: top + height,
    });
    parts.push(
      sized(
        textBlock(lines, midX - width / 2, top, width, textHeight, size, {
          // A coloured link carries its meaning into its label; an uncoloured
          // one leaves the words to read as ordinary text.
          colour: colourOf(link.appearance, theme.text),
          align: 'middle',
        }),
        size,
        fontSize,
      ),
    );
  }

  // The stroke straddles the path, so half of it lies outside the geometry.
  return { svg: parts.join('\n'), ink: grow(ink, LINE_WIDTH / 2) };
}

function union(a: Extent, b: Extent): Extent {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function grow(extent: Extent, by: number): Extent {
  return {
    minX: extent.minX - by,
    minY: extent.minY - by,
    maxX: extent.maxX + by,
    maxY: extent.maxY + by,
  };
}

function extentOfPoints(points: Point[]): Extent {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/**
 * What a cubic actually covers, which is not what its control points cover. A
 * handle reaching 140 pixels up carries the curve only about three quarters of
 * that, and sizing the page off the handles would leave a visible band of empty
 * canvas above every curved link. Solved rather than sampled: the extremes are
 * the ends plus wherever the derivative — a quadratic — crosses zero.
 */
function cubicExtent(p0: Point, c1: Point, c2: Point, p3: Point): Extent {
  const span = (a: number, b: number, c: number, d: number): [number, number] => {
    const values = [a, d];
    // The derivative of the cubic, written as a quadratic in t.
    const qa = 3 * (-a + 3 * b - 3 * c + d);
    const qb = 6 * (a - 2 * b + c);
    const qc = 3 * (b - a);
    const roots: number[] = [];
    if (Math.abs(qa) < 1e-9) {
      if (Math.abs(qb) > 1e-9) roots.push(-qc / qb);
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        roots.push((-qb + root) / (2 * qa), (-qb - root) / (2 * qa));
      }
    }
    for (const t of roots) {
      if (t <= 0 || t >= 1) continue;
      const u = 1 - t;
      values.push(u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d);
    }
    return [Math.min(...values), Math.max(...values)];
  };

  const [minX, maxX] = span(p0.x, c1.x, c2.x, p3.x);
  const [minY, maxY] = span(p0.y, c1.y, c2.y, p3.y);
  return { minX, minY, maxX, maxY };
}

/** Walk out from the centre of a box toward a point, stopping at the border. */
function edgePoint(box: Box, toward: { x: number; y: number }): { x: number; y: number } {
  const centre = centreOf(box);
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  if (dx === 0 && dy === 0) return centre;

  const scaleX = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return { x: centre.x + dx * scale, y: centre.y + dy * scale };
}

// --- where a link meets a box -------------------------------------------------

const SIDES = ['top', 'bottom', 'left', 'right'] as const;
type Side = (typeof SIDES)[number];

/** A point on a box's border, with the outward direction the line takes there. */
interface Anchor {
  x: number;
  y: number;
  /** Unit vector pointing out of the box. */
  tx: number;
  ty: number;
  /** The side the author named, or undefined when the renderer chose the point. */
  side?: Side;
}

interface LinkEnds {
  start: Anchor;
  end: Anchor;
}

/** One link's claim on one side of one box, before the point on it is known. */
interface Claim {
  link: LayoutLink;
  which: 'start' | 'end';
  side: Side;
  /** Where the far end of this link sits, which is what orders claims along the side. */
  toward: { x: number; y: number };
}

/**
 * Work out where every link meets every box.
 *
 * An author names a *side* — `to: top` — and never a point on it. Alone on a
 * side a link lands at its centre; sharing the side with others, the points
 * spread so they do not sit on top of each other. Which one goes where is
 * derived from where the far ends actually are, never chosen: of two links
 * arriving at one top edge, the one coming from further left arrives further
 * left. That is the same rule as box non-overlap — the tool separates things by
 * default, and reads the direction off the solved layout rather than asking.
 */
function planEndpoints(links: LayoutLink[]): Map<LayoutLink, LinkEnds> {
  const claims = new Map<LayoutNode, Map<Side, Claim[]>>();
  const named = new Map<LayoutLink, { start?: Anchor; end?: Anchor }>();

  for (const link of links) {
    named.set(link, {});
    const fromSide = sideAttr(link, 'from');
    const toSide = sideAttr(link, 'to');
    if (fromSide) {
      claim(claims, link.from, fromSide, { link, which: 'start', side: fromSide, toward: centreOf(faceOf(link.to)) });
    }
    if (toSide) {
      claim(claims, link.to, toSide, { link, which: 'end', side: toSide, toward: centreOf(faceOf(link.from)) });
    }
  }

  // Place every claimed side, spreading the points that share one.
  for (const [node, bySide] of claims) {
    const face = faceOf(node);
    for (const [side, group] of bySide) {
      const along = side === 'top' || side === 'bottom' ? 'x' : 'y';
      const span = along === 'x' ? face.width : face.height;
      const origin = along === 'x' ? face.x : face.y;

      const ordered = [...group].sort((a, b) => a.toward[along] - b.toward[along]);
      const usable = Math.max(0, span - ATTACH_MARGIN * 2);
      const step = ordered.length > 1 ? Math.min(ATTACH_STEP, usable / (ordered.length - 1)) : 0;
      const first = origin + span / 2 - (step * (ordered.length - 1)) / 2;

      ordered.forEach((entry, index) => {
        const at = first + index * step;
        named.get(entry.link)![entry.which] = anchorOn(face, side, at);
      });
    }
  }

  // Fill in the ends the author said nothing about, now that the named ones
  // are known: an unnamed end aims at wherever its partner ended up.
  const ends = new Map<LayoutLink, LinkEnds>();
  for (const link of links) {
    const partial = named.get(link)!;
    const fromFace = faceOf(link.from);
    const toFace = faceOf(link.to);
    // With neither end named this is the straight line it always was, each end
    // aiming at the other box's centre.
    const start = partial.start ?? free(fromFace, partial.end ?? centreOf(toFace));
    const end = partial.end ?? free(toFace, partial.start ?? centreOf(fromFace));
    ends.set(link, { start, end });
  }
  return ends;
}

function claim(
  claims: Map<LayoutNode, Map<Side, Claim[]>>,
  node: LayoutNode,
  side: Side,
  entry: Claim,
): void {
  let bySide = claims.get(node);
  if (!bySide) {
    bySide = new Map();
    claims.set(node, bySide);
  }
  const group = bySide.get(side);
  if (group) group.push(entry);
  else bySide.set(side, [entry]);
}

/** The point `at` along one side of a box, with the outward normal for that side. */
function anchorOn(face: Box, side: Side, at: number): Anchor {
  switch (side) {
    case 'top':
      return { x: at, y: face.y, tx: 0, ty: -1, side };
    case 'bottom':
      return { x: at, y: face.y + face.height, tx: 0, ty: 1, side };
    case 'left':
      return { x: face.x, y: at, tx: -1, ty: 0, side };
    case 'right':
      return { x: face.x + face.width, y: at, tx: 1, ty: 0, side };
  }
}

/** An end with no side named: leave from the border, pointing at the far end. */
function free(face: Box, toward: { x: number; y: number }): Anchor {
  const point = edgePoint(face, toward);
  const centre = centreOf(face);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: point.x, y: point.y, tx: dx / length, ty: dy / length };
}

/** How far the control points sit off the ends. Proportional, but bounded. */
function controlReach(start: Anchor, end: Anchor): number {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  return Math.max(24, Math.min(140, distance * 0.4));
}

// --- corridors ----------------------------------------------------------------

/**
 * Where a link runs while it is passing the two nodes a `between` clause named.
 *
 * A corridor is *measured*, never solved for: both nodes are already placed by
 * the time the renderer sees them, so the gap between them is a pair of numbers
 * and the link is routed through it. Nothing here can move a box. That is the
 * deliberate half of the feature — an arrow states where it goes, and if the
 * gap it names is too tight, that is something to report rather than repair.
 */
interface Corridor {
  /** The axis the gap binds. A gap between something above and something below binds y. */
  axis: Axis;
  /** Where on that axis this link runs. Several links in one gap take their own lanes. */
  lane: number;
  /** Where the run begins and ends on the other axis, in the order the link travels. */
  enter: number;
  leave: number;
}

interface Point {
  x: number;
  y: number;
}

/** The free interval between two boxes on one axis, or nothing if they overlap. */
function clearance(
  aStart: number,
  aSize: number,
  bStart: number,
  bSize: number,
): { lo: number; hi: number } | undefined {
  if (aStart + aSize < bStart) return { lo: aStart + aSize, hi: bStart };
  if (bStart + bSize < aStart) return { lo: bStart + bSize, hi: aStart };
  return undefined;
}

/**
 * Which gap `between a and b` means, and how far along it reaches.
 *
 * The axis is derived wherever the pair leaves only one answer, the same way a
 * separation direction is: one node is above the other, or one is left of the
 * other, and whichever it is says which axis the gap binds. Most pairs are like
 * that, and for them the file says nothing about axes at all.
 *
 * A pair sitting diagonally has two gaps and needs the author to pick, which is
 * what `wanted` carries. That is a tie-break rather than part of the statement:
 * where it is not needed it may still be written, and is then checked rather
 * than ignored, because a word that silently does nothing looks like a bug in
 * the tool.
 */
function gapBetween(
  a: Box,
  b: Box,
  aName: string,
  bName: string,
  wanted: Axis | undefined,
  line: number,
): { axis: Axis; lo: number; hi: number; across: [number, number] } {
  const pair = `"${aName}" and "${bName}"`;
  const found = {
    y: clearance(a.y, a.height, b.y, b.height),
    x: clearance(a.x, a.width, b.x, b.width),
  };

  if (wanted !== undefined && found[wanted] === undefined) {
    const other = wanted === 'y' ? 'x' : 'y';
    throw new SourceError(
      found[other]
        ? `${pair} have no gap between them ${describeAxis(wanted)} — they are apart ${describeAxis(other)}, so drop the word or say "${describeAxis(other)}"`
        : `${pair} touch or overlap, so there is no gap between them to pass through`,
      line,
    );
  }
  if (wanted === undefined && found.y && found.x) {
    throw new SourceError(
      `${pair} are apart both vertically and horizontally, so I cannot tell which gap you mean — write "between ${aName} and ${bName} vertically" for the gap above and below them, or "horizontally" for the gap beside them`,
      line,
    );
  }

  // Whichever was asked for, or whichever is the only one there is.
  const axis: Axis = wanted ?? (found.y ? 'y' : 'x');
  const gap = found[axis];
  if (!gap) {
    throw new SourceError(
      `${pair} touch or overlap, so there is no gap between them to pass through`,
      line,
    );
  }
  // The corridor reaches as far as the pair does on the other axis: that is the
  // stretch over which the line is actually passing them.
  return {
    axis,
    ...gap,
    across:
      axis === 'y'
        ? [Math.min(a.x, b.x), Math.max(a.x + a.width, b.x + b.width)]
        : [Math.min(a.y, b.y), Math.max(a.y + a.height, b.y + b.height)],
  };
}

/**
 * Route every link that named a gap.
 *
 * Links sharing one gap share its lanes, spread like attachments on a side and
 * ordered the same derived way — by where their ends actually sit, so the two
 * arriving at Dropbox's left edge in one order run through the corridor in that
 * same order and never cross.
 */
function planCorridors(
  links: LayoutLink[],
  ends: Map<LayoutLink, LinkEnds>,
  measurer: Measurer,
  fontSize: number,
): Map<LayoutLink, Corridor> {
  const plans = new Map<LayoutLink, Corridor>();
  const groups = new Map<
    string,
    { axis: Axis; lo: number; hi: number; across: [number, number]; members: LayoutLink[] }
  >();

  for (const link of links) {
    if (!link.between) continue;
    const [first, second] = link.between.nodes;
    const gap = gapBetween(
      faceOf(first),
      faceOf(second),
      first.name,
      second.name,
      link.between.axis,
      link.line,
    );
    // The pair names one gap however the author ordered them. The axis is in
    // the key because a diagonal pair really does have two, and two links may
    // legitimately name the same pair and take different ones.
    const key = [gap.axis, ...[first.name, second.name].sort()].join(' ');
    const group = groups.get(key);
    if (group) group.members.push(link);
    else groups.set(key, { ...gap, members: [link] });
  }

  for (const group of groups.values()) {
    const along = (link: LayoutLink): number => {
      const { start, end } = ends.get(link)!;
      return (start[group.axis] + end[group.axis]) / 2;
    };
    const ordered = [...group.members].sort((a, b) => along(a) - along(b));

    // Lanes are spread as attachments on a side are, including the squeeze when
    // there is not enough room — see `planEndpoints`. The step is wider here,
    // because a lane carries a whole label rather than the point of an arrow,
    // and two lanes closer together than a label is deep would draw the labels
    // over each other. Still derived, not chosen: it is the size of what is
    // actually running along the corridor.
    const span = group.hi - group.lo;
    const usable = Math.max(0, span - ATTACH_MARGIN * 2);
    const want = Math.max(
      ATTACH_STEP,
      ...ordered.map((link) => laneExtent(link, group.axis, measurer, fontSize)),
    );
    const step = ordered.length > 1 ? Math.min(want, usable / (ordered.length - 1)) : 0;
    const firstLane = group.lo + span / 2 - (step * (ordered.length - 1)) / 2;

    ordered.forEach((link, index) => {
      const { start, end } = ends.get(link)!;
      const run: Axis = group.axis === 'y' ? 'x' : 'y';
      // The corridor binds only where the link is actually passing the pair, so
      // its reach is the overlap of the pair's extent with the link's own.
      const enterAt = Math.max(group.across[0], Math.min(start[run], end[run]));
      const leaveAt = Math.min(group.across[1], Math.max(start[run], end[run]));
      if (leaveAt <= enterAt) {
        const [a, b] = link.between!.nodes;
        throw new SourceError(
          `this link never passes between "${a.name}" and "${b.name}"`,
          link.line,
        );
      }
      const forward = end[run] >= start[run];
      plans.set(link, {
        axis: group.axis,
        lane: firstLane + index * step,
        enter: forward ? enterAt : leaveAt,
        leave: forward ? leaveAt : enterAt,
      });
    });
  }

  return plans;
}

/**
 * An end whose side the author did not name aims at the far box's centre, which
 * is the wrong thing to aim at once the line has been told to go somewhere else
 * on the way. Point those ends at the corridor instead.
 */
function aimFreeEnds(
  links: LayoutLink[],
  ends: Map<LayoutLink, LinkEnds>,
  corridors: Map<LayoutLink, Corridor>,
): void {
  for (const link of links) {
    const plan = corridors.get(link);
    if (!plan) continue;
    const current = ends.get(link)!;
    const start =
      current.start.side === undefined
        ? free(faceOf(link.from), corridorPoint(plan, plan.enter))
        : current.start;
    const end =
      current.end.side === undefined
        ? free(faceOf(link.to), corridorPoint(plan, plan.leave))
        : current.end;
    ends.set(link, { start, end });
  }
}

/**
 * How much room a link's label takes across the corridor — its depth in a
 * horizontal channel, its width in a vertical one. Zero for an unlabelled link,
 * which needs no more than the arrow spacing.
 *
 * `labelExtent` measures the knockout along whichever axis it is handed, and the
 * axis wanted here is the one the channel is measured on rather than the one the
 * link runs along — a channel measured vertically carries links running
 * horizontally, and what has to fit between two lanes of it is a label's depth.
 */
function laneExtent(
  link: LayoutLink,
  axis: Axis,
  measurer: Measurer,
  fontSize: number,
): number {
  if (link.label === undefined) return 0;
  return labelExtent(link.label, link.appearance, axis, measurer, fontSize, link.line);
}

function corridorPoint(plan: Corridor, at: number): Point {
  return plan.axis === 'y' ? { x: at, y: plan.lane } : { x: plan.lane, y: at };
}

/**
 * The path a corridor link takes: a curve out of its start into the gap, the
 * straight run along the gap, and a curve out of the gap to its end. It is
 * three pieces rather than one cubic because a single curve has no way to stay
 * inside an interval over part of its length — which is the whole claim the
 * author is making.
 */
function corridorPath(
  start: Anchor,
  end: Anchor,
  plan: Corridor,
): { d: string; mid: Point; ink: Extent } {
  const p1 = corridorPoint(plan, plan.enter);
  const p2 = corridorPoint(plan, plan.leave);
  const forward = plan.leave >= plan.enter ? 1 : -1;
  // Along the run the line travels one way, so that is its tangent at both ends
  // of the straight stretch — it enters the gap already going where the gap goes.
  const rt = plan.axis === 'y' ? { tx: forward, ty: 0 } : { tx: 0, ty: forward };

  const r1 = corridorReach(start, p1, plan.axis);
  const c1 = { x: start.x + start.tx * r1, y: start.y + start.ty * r1 };
  const c2 = { x: p1.x - rt.tx * r1, y: p1.y - rt.ty * r1 };

  const r2 = corridorReach(p2, end, plan.axis);
  const c3 = { x: p2.x + rt.tx * r2, y: p2.y + rt.ty * r2 };
  const c4 = { x: end.x + end.tx * r2, y: end.y + end.ty * r2 };

  const d = [
    `M ${round(start.x)} ${round(start.y)}`,
    `C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(p1.x)} ${round(p1.y)}`,
    `L ${round(p2.x)} ${round(p2.y)}`,
    `C ${round(c3.x)} ${round(c3.y)}, ${round(c4.x)} ${round(c4.y)}, ${round(end.x)} ${round(end.y)}`,
  ].join(' ');

  const ink = union(
    cubicExtent(start, c1, c2, p1),
    cubicExtent(p2, c3, c4, end),
  );

  return { d, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, ink };
}

/**
 * How far the handles reach on an approach curve. Bounded by half the distance
 * available along the run as well as by the straight-line distance: both ends of
 * this curve point along the run, so handles longer than that would reach past
 * each other and bulge the line back the way it came.
 */
function corridorReach(from: Point, to: Point, axis: Axis): number {
  const run = Math.abs(axis === 'y' ? to.x - from.x : to.y - from.y);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.min(140, Math.max(8, Math.min(distance * 0.4, run / 2)));
}

function sideAttr(link: LayoutLink, key: 'from' | 'to'): Side | undefined {
  const value = link.attrs[key];
  if (value === undefined) return undefined;
  if (!(SIDES as readonly string[]).includes(value)) {
    throw new SourceError(
      `"${key}: ${value}" is not a side — use ${SIDES.join(', ')}`,
      link.line,
    );
  }
  return value as Side;
}

function arrowMarker(colour: string): string {
  const id = markerId(colour);
  return [
    `    <marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${ARROW_MARKER_WIDTH}" markerHeight="${ARROW_MARKER_WIDTH}" orient="auto-start-reverse">`,
    `      <path d="M 0 0 L 10 5 L 0 10 z" fill="${colour}"/>`,
    '    </marker>',
    `    <marker id="${id}-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${ARROW_MARKER_WIDTH}" markerHeight="${ARROW_MARKER_WIDTH}" orient="auto-start-reverse">`,
    `      <path d="M 0 0 L 10 5 L 0 10 z" fill="${colour}"/>`,
    '    </marker>',
  ].join('\n');
}

function markerId(colour: string): string {
  return `arrow-${colour.replace(/[^a-zA-Z0-9]/g, '')}`;
}

// --- small shared pieces ------------------------------------------------------

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The rectangle actually drawn. Differs from the node box only for a deck. */
function faceOf(node: LayoutNode): Box {
  return {
    x: node.x + node.inset,
    y: node.y + node.inset,
    width: node.width - node.inset,
    height: node.height - node.inset,
  };
}

function centreOf(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Wrap a block of text in its own size, but only when that differs from the
 * document's — everything at the default size inherits it from the <svg>
 * element, so an ordinary diagram's output is unchanged.
 */
function sized(block: string, size: number, fontSize: number): string {
  if (size === fontSize || block.length === 0) return block;
  return `  <g font-size="${size}px">\n${block}\n  </g>`;
}

function textBlock(
  lines: string[],
  x: number,
  top: number,
  width: number,
  lineHeight: number,
  fontSize: number,
  style: { colour: string; subColour?: string | undefined; align: 'start' | 'middle' | 'end' },
): string {
  const anchorX =
    style.align === 'middle' ? x + width / 2 : style.align === 'end' ? x + width : x;
  return lines
    .map((line, index) => {
      if (line.length === 0) return '';
      const baseline = top + index * lineHeight + lineHeight / 2 + fontSize * 0.35;
      // A label's first line is its name; anything after it is a qualifier, and
      // `subtext:` is how a box says that qualifier should read as secondary.
      const colour = index === 0 ? style.colour : style.subColour ?? style.colour;
      return `  <text x="${round(anchorX)}" y="${round(baseline)}" fill="${colour}" text-anchor="${style.align}">${escapeXml(line)}</text>`;
    })
    .filter((element) => element.length > 0)
    .join('\n');
}

/**
 * A colour is written as the viewer will receive it — `#14532d`, or any CSS
 * colour. The renderer keeps no list of colour words of its own, so a diagram
 * is never limited to the ones somebody remembered to add here.
 */
function colourOf(appearance: Record<string, string>, fallback: string): string {
  return appearance['stroke'] ?? fallback;
}

/**
 * The colour for every label line after the first, or undefined when the box
 * said nothing and all its lines should read alike. `muted` is the one reserved
 * word: it defers to the theme, so a label's qualifier stays readable when the
 * theme changes. Anything else is a colour, same as `stroke` and `fill` take.
 */
function subtextOf(appearance: Record<string, string>, theme: Theme): string | undefined {
  const named = appearance['subtext'];
  if (named === undefined) return undefined;
  if (named === 'muted') return theme.mutedText;
  return named;
}

function fillOf(appearance: Record<string, string>, fallback: string): string {
  return appearance['fill'] ?? fallback;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Escapes what has to be escaped in element content, and no more. A double
 * quote is legal there, and some SVG renderers mishandle `&quot;` in text.
 */
function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function quote(value: string): string {
  return `"${value.replace(/"/g, "'")}"`;
}
