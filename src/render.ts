import {
  ARROW_MARKER_WIDTH,
  ATTACH_MARGIN,
  ATTACH_STEP,
  DECK_STEP,
  DEFAULT_FONT_SIZE,
  ICON_LINES,
  LINE_WIDTH,
  PAD,
  fontSizeFor,
  textExtent,
  textStyleFor,
  widestLine,
} from './constants.js';
import type { Attrs, Axis } from './ast.js';
import { describeAxis } from './ast.js';
import { SourceError } from './errors.js';
import { ICON_STROKE, badgeFor, type Icon, type IconTone, type Outline } from './icons.js';
import { monospaceMeasurer, type Measurer } from './measure.js';
import type { Layout, LayoutEdge, LayoutNode } from './model.js';
import { plain, type Line, type Run } from './text.js';

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
  edge: string;
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
  edge: '#5c5c7c',
  // Both sampled off the reference's machine glyphs. Note that the reference
  // gives each icon its own hue — the drive is gray, the laptop periwinkle, the
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
    body.push(drawNode(root, theme, measurer, fontSize, layout.markup));
  }
  // Everything the boxes cover. Edges are added to it as they are drawn.
  let ink: Extent = { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height };
  // Endpoints are planned for every edge at once, because where an edge meets a
  // side depends on what else meets that same side. Corridors come after, for
  // the same reason in the other direction: which lane of a gap an edge takes
  // is ordered by where its ends turned out to be.
  const ends = planEndpoints(layout.edges, measurer, fontSize);
  const corridors = planCorridors(layout.edges, ends, measurer, fontSize);
  aimFreeEnds(layout.edges, ends, corridors);
  for (const edge of layout.edges) {
    const drawn = drawEdge(edge, ends.get(edge)!, corridors.get(edge), theme, measurer, fontSize, layout.markup);
    body.push(drawn.svg);
    ink = union(ink, grow(drawn.ink, layout.margin));
  }

  // An edge's geometry is measured rather than solved for, so the resolver sized
  // the canvas from the boxes alone. A curve out of a `top` side, or a text
  // riding above one, lands outside that — so the page grows to hold it and the
  // origin moves with it, rather than the drawing being quietly clipped.
  const canvas = {
    x: Math.floor(ink.minX),
    y: Math.floor(ink.minY),
    width: Math.ceil(ink.maxX) - Math.floor(ink.minX),
    height: Math.ceil(ink.maxY) - Math.floor(ink.minY),
  };

  const arrowColors = new Set(layout.edges.map((edge) => lineOf(edge.appearance, theme.edge)));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="${canvas.x} ${canvas.y} ${canvas.width} ${canvas.height}" font-family=${quote(measurer.fontFamily)} font-size="${fontSize}px">`,
    '  <defs>',
    ...[...arrowColors].map((color) => arrowMarker(color)),
    '  </defs>',
    `  <rect x="${canvas.x}" y="${canvas.y}" width="${canvas.width}" height="${canvas.height}" fill="${theme.background}"/>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

// --- nodes -------------------------------------------------------------------

/**
 * `<a href>` around whatever a node or an edge draws, when it named a
 * destination.
 *
 * SVG has this natively, so a standalone SVG stays standalone and a rasteriser
 * drops it, leaving a PNG unharmed. Plain `href` and not `xlink:href`: the
 * SVG 1.1 spelling would need an `xmlns:xlink` on every drawing whether or not
 * anything in it links anywhere, and every current browser takes the SVG 2 one.
 *
 * `target="_blank"` always, because the playground inlines the SVG into its own
 * page and a click inside it would otherwise navigate the playground away;
 * `rel="noopener"` goes with it as it does anywhere else.
 *
 * **An `<a>` is never nested inside another.** Nesting is the obvious way to let
 * a container carry a destination while a child carries its own, and it does not
 * work: Chrome draws nothing at all inside the inner one, so the child simply
 * disappears from the picture. Every node's anchor therefore wraps only what
 * that node draws — outline, text, badge — and its children are emitted beside
 * it, each wrapping itself. The reading comes out the same anyway, because the
 * container's filled outline lies under the children and catches every click
 * that does not land on one of them.
 *
 * A container's badge is drawn *after* its children — it rides in the title band
 * and a decked node's stack can reach under it — so a linked container emits two
 * anchors with one destination rather than reordering the ink to save one.
 *
 * A destination therefore reaches down the tree instead of enclosing it: a child
 * that names none of its own is drawn inside an anchor carrying its container's,
 * and one that names its own overrules it. That is the reading nesting would
 * have given — the container catches every click its children do not — reached
 * by repeating the destination rather than by wrapping.
 */
function linked(svg: string, url: string | undefined): string {
  if (url === undefined || svg.length === 0) return svg;
  // An `&` between query parameters is ordinary in a url and illegal raw in an
  // attribute, so the value is escaped as markup rather than merely quoted.
  return `  <a href=${quote(escapeXml(url))} target="_blank" rel="noopener">\n${svg}\n  </a>`;
}

function drawNode(
  node: LayoutNode,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
  inherited?: string,
): string {
  const url = node.attrs['url'] ?? inherited;
  const { own, kids, tail } = nodeSvg(node, theme, measurer, fontSize, markup, url);
  return [linked(own.join('\n'), url), ...kids, linked(tail.join('\n'), url)]
    .filter((part) => part.length > 0)
    .join('\n');
}

/**
 * What a node draws, in three pieces: its own ink, its children's, and the
 * ink that goes over the children. They are kept apart so the node's `<a>` can
 * wrap what is the node's without swallowing what is a child's.
 */
function nodeSvg(
  node: LayoutNode,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
  url: string | undefined,
): { own: string[]; kids: string[]; tail: string[] } {
  // A note is set smaller than a box text by default, and `size:` overrides
  // that on anything. Only this node's own text takes the size — children are
  // drawn by their own call and carry whatever they say themselves.
  const size = fontSizeFor(node.kind, node.textAttrs, fontSize, node.line);
  const textHeight = measurer.lineHeight(size);
  const blockWidth = widestLine(node.lines, measurer, size);
  const ink = (run: Run, own: string) => runInk(run, own, markup, theme);

  if (node.body.kind === 'none') {
    const style = textStyleFor(node.textAttrs, node.line, 'start', 'center');
    return { kids: [], tail: [], own: [sized(
      textBlock(node.lines, node.x, node.y, textHeight, size, node.textBox, {
        color: textColorOf(node.textAttrs, theme, theme.text),
        align: style.align,
        ink,
      }),
      size,
      fontSize,
    )] };
  }

  const glyphSide = ICON_LINES * textHeight;

  if (node.body.kind === 'icon') {
    // No outline, no fill, no padding — the node is the picture. The text, if
    // there is one, sits under it. `at`'s vertical half has nothing to say
    // here — the caption is under the picture and nowhere else — so only its
    // horizontal half is read.
    const style = textStyleFor(node.textAttrs, node.line, 'middle', 'center');
    const drawn = [drawIcon(node.body.icon, node.x + (node.width - glyphSide) / 2, node.y, glyphSide, theme)];
    if (node.lines.some((line) => plain(line).length > 0)) {
      drawn.push(
        sized(
          textBlock(node.lines, node.x, node.y, textHeight, size, node.textBox, {
            color: textColorOf(node.textAttrs, theme, theme.text),
            align: style.align,
            ink,
          }),
          size,
          fontSize,
        ),
      );
    }
    return { own: drawn, kids: [], tail: [] };
  }

  const outline = node.body.outline;
  const parts: string[] = [];
  const kids: string[] = [];
  const tail: string[] = [];
  const face = faceOf(node);
  // A container *looks* like one because things stack beside its text, not
  // because it has children: a node whose only child sits beside its text is
  // drawn as the leaf it reads as.
  const container = node.banded;
  const border = borderOf(node.appearance, container ? theme.containerStroke : theme.boxStroke);
  const fill = fillOf(node.appearance, container ? theme.containerFill : theme.boxFill);
  // A box is the one kind with two inkable parts, which is why its text needs
  // a word of its own — `border:` cannot stand in for it.
  const text = textColorOf(node.textAttrs, theme, theme.text);

  // Deck copies sit behind the front face, furthest back drawn first.
  for (let depth = node.deckTexts.length; depth >= 1; depth -= 1) {
    const x = face.x - depth * DECK_STEP;
    const y = face.y - depth * DECK_STEP;
    parts.push(
      `  <path d="${outlinePath(outline, x, y, face.width, face.height)}" fill="${theme.containerFill}" stroke="${border}"/>`,
    );
    const copy = node.deckTexts[depth - 1];
    if (copy !== undefined) {
      parts.push(
        sized(
          textBlock([[{ text: copy }]], x, y, textHeight, size,
            { x: PAD, y: PAD, width: face.width - PAD * 2, height: textHeight },
            { color: text, align: 'start', ink },
          ),
          size,
          fontSize,
        ),
      );
    }
  }

  parts.push(
    `  <path d="${outlinePath(outline, face.x, face.y, face.width, face.height)}" fill="${fill}" stroke="${border}"/>`,
  );
  for (const extra of outlineDetail(outline, face.x, face.y, face.width, face.height)) {
    parts.push(`  <path d="${extra}" fill="none" stroke="${border}"/>`);
  }

  // A leaf's text defaults to the middle of its box, a container's to the top
  // left of the band; both then read `at` for where it really goes. Where the
  // text sits is the resolver's answer, in `textBox`; only the alignment of
  // its lines against each other is read here.
  const textStyle = textStyleFor(
    node.textAttrs,
    node.line,
    container ? 'start' : 'middle',
    container ? 'top-left' : 'center',
  );
  parts.push(
    sized(
      textBlock(node.lines, node.x, node.y, textHeight, size, node.textBox, {
        color: text,
        align: textStyle.align,
        ink,
      }),
      size,
      fontSize,
    ),
  );
  for (const child of node.children) {
    kids.push(drawNode(child, theme, measurer, fontSize, markup, url));
  }

  const icon = badgeFor(node.appearance, node.line);
  if (icon !== undefined && node.badgeBox) {
    // Drawn where the resolver reserved room for it. A badge in a band goes
    // over the children, since a decked node's stack can reach under it.
    const badge = drawIcon(icon, node.x + node.badgeBox.x, node.y + node.badgeBox.y, node.badgeBox.width, theme);
    (node.children.length > 0 ? tail : parts).push(badge);
  }

  return { own: parts, kids, tail };
}

/**
 * How far the dog-ear cuts into the top-right corner of a `document`.
 *
 * Twice the corner radius, so it is the same size on every box however wide.
 * The reference sizes its fold as a fraction of the box, which is why the fold
 * on those two wide dump boxes almost disappears — the idea was right and
 * only the scaling was wrong.
 */
const FOLD = CORNER * 2;

/** The node's outline, as path data. */
function outlinePath(shape: Outline, x: number, y: number, w: number, h: number): string {
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
function outlineDetail(shape: Outline, x: number, y: number, w: number, h: number): string[] {
  void h;
  if (shape !== 'document') return [];
  return [
    `M${round(x + w - FOLD)} ${round(y)} V${round(y + FOLD)} H${round(x + w)}`,
  ];
}

/** One icon, scaled from its own grid onto a square of `side` at `x, y`. */
function drawIcon(icon: Icon, x: number, y: number, side: number, theme: Theme): string {
  const scale = side / icon.grid;
  const color = (tone: IconTone | undefined): string =>
    tone === 'ink' ? theme.iconInk : tone === 'shade' ? theme.iconShade : theme.background;

  const paths = icon.paths.map((path) => {
    const fill = path.fill === undefined ? 'none' : color(path.fill);
    const stroke =
      path.stroke === undefined
        ? ''
        : ` stroke="${color(path.stroke)}" stroke-width="${ICON_STROKE}" stroke-linejoin="round"`;
    return `    <path d="${path.d}" fill="${fill}"${stroke}/>`;
  });

  return [
    `  <g transform="translate(${round(x)} ${round(y)}) scale(${round(scale * 1000) / 1000})">`,
    ...paths,
    '  </g>',
  ].join('\n');
}

// --- edges -------------------------------------------------------------------

function drawEdge(
  edge: LayoutEdge,
  ends: EdgeEnds,
  corridor: Corridor | undefined,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
): { svg: string; ink: Extent } {
  const { start, end } = ends;
  const color = lineOf(edge.appearance, theme.edge);

  const markerEnd = ` marker-end="url(#${markerId(color)})"`;
  const markerStart = edge.both ? ` marker-start="url(#${markerId(color)}-back)"` : '';

  // A named side is a statement about how the line should leave or arrive, so
  // it is drawn as a curve that actually does leave and arrive that way. With
  // neither side named there is nothing to honor and the line stays straight.
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
      `  <path d="${path.d}" fill="none" stroke="${color}" stroke-width="${LINE_WIDTH}"${markerEnd}${markerStart}/>`,
    );
    // The text goes on the straight run rather than at the midpoint of the
    // whole path, so it sits in the gap the author asked the line to travel.
    midX = path.mid.x;
    midY = path.mid.y;
  } else if (curved) {
    const reach = controlReach(start, end);
    // A bundle whose sides were too short to spread it takes the rest of the
    // room in the middle, exactly as a straight group does — see `bowBundles`.
    // Displacing both control points equally moves the curve's middle by three
    // quarters as much, so the bow is scaled up by the inverse of that.
    const lift = 4 / 3;
    const bx = (ends.bow?.x ?? 0) * lift;
    const by = (ends.bow?.y ?? 0) * lift;
    const c1 = { x: start.x + start.tx * reach + bx, y: start.y + start.ty * reach + by };
    const c2 = { x: end.x + end.tx * reach + bx, y: end.y + end.ty * reach + by };
    parts.push(
      `  <path d="M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}" fill="none" stroke="${color}" stroke-width="${LINE_WIDTH}"${markerEnd}${markerStart}/>`,
    );
    ink = union(ink, cubicExtent(start, c1, c2, end));
    // The point halfway along a cubic, which is where the text belongs.
    midX = (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8;
    midY = (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8;
  } else if (ends.bow && (ends.bow.x !== 0 || ends.bow.y !== 0)) {
    // A straight line that could not get the room it needed at its ends, so it
    // takes it in the middle. Both control points carry the same displacement,
    // which keeps the arc symmetric; a cubic's middle moves three quarters of
    // the way its controls do, so the displacement is the bow scaled up by that.
    const lift = 4 / 3;
    const run = { x: (end.x - start.x) / 3, y: (end.y - start.y) / 3 };
    const c1 = {
      x: start.x + run.x + ends.bow.x * lift,
      y: start.y + run.y + ends.bow.y * lift,
    };
    const c2 = {
      x: end.x - run.x + ends.bow.x * lift,
      y: end.y - run.y + ends.bow.y * lift,
    };
    parts.push(
      `  <path d="M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}" fill="none" stroke="${color}" stroke-width="${LINE_WIDTH}"${markerEnd}${markerStart}/>`,
    );
    ink = union(ink, cubicExtent(start, c1, c2, end));
    midX = (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8;
    midY = (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8;
  } else {
    parts.push(
      `  <line x1="${round(start.x)}" y1="${round(start.y)}" x2="${round(end.x)}" y2="${round(end.y)}" stroke="${color}" stroke-width="${LINE_WIDTH}"${markerEnd}${markerStart}/>`,
    );
    midX = (start.x + end.x) / 2;
    midY = (start.y + end.y) / 2;
  }

  if (edge.text !== undefined) {
    // An edge text breaks on ` / ` exactly as a box text does, so a two-line
    // caption on an arrow needs no vocabulary of its own. The block is centered
    // on the midpoint, which keeps a one-line text where it has always been.
    const size = fontSizeFor('edge', edge.textAttrs, fontSize, edge.line);
    const textHeight = measurer.lineHeight(size);
    const lines = edge.lines!;
    const width = widestLine(lines, measurer, size);
    const height = lines.length * textHeight;
    const top = midY - height / 2;
    // The text knocks a hole in whatever it lands on rather than sitting in a
    // chip of its own: an outlined box reads as a node, which is the one thing
    // a text on a line is not.
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
        textBlock(lines, midX - width / 2, top, textHeight, size,
          { x: 0, y: 0, width, height },
          {
            // A colored edge carries its meaning into its text; an uncolored
            // one leaves the words to read as ordinary text.
            color: textColorOf(edge.textAttrs, theme, lineOf(edge.appearance, theme.text)),
            align: 'middle',
            ink: (run, own) => runInk(run, own, markup, theme),
          },
        ),
        size,
        fontSize,
      ),
    );
  }

  // The stroke straddles the path, so half of it lies outside the geometry.
  return { svg: linked(parts.join('\n'), edge.attrs['url']), ink: grow(ink, LINE_WIDTH / 2) };
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
 * canvas above every curved edge. Solved rather than sampled: the extremes are
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

/** Walk out from the center of a box toward a point, stopping at the border. */
function sidePoint(box: Box, toward: { x: number; y: number }): { x: number; y: number } {
  const center = centerOf(box);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;

  const scaleX = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

// --- where an edge meets a box -------------------------------------------------

// The four sides an edge may attach to. Deliberately not `ATTACH_SIDES` from
// `ast.ts`, which carries `center` as well because an alignment can share a
// center line and an attachment cannot sit on one.
const ATTACH_SIDES = ['top', 'bottom', 'left', 'right'] as const;
type AttachSide = (typeof ATTACH_SIDES)[number];

/** A point on a box's border, with the outward direction the line takes there. */
interface Anchor {
  x: number;
  y: number;
  /** Unit vector pointing out of the box. */
  tx: number;
  ty: number;
  /** The side the author named, or undefined when the renderer chose the point. */
  side?: AttachSide;
}

interface EdgeEnds {
  start: Anchor;
  end: Anchor;
  /**
   * How far the middle of the line is pushed across its own run, when the two
   * boxes are too small to give the group enough edge to spread along. See
   * `planSpreads`.
   */
  bow?: { x: number; y: number };
}

/** One edge's claim on one side of one box, before the point on it is known. */
interface Claim {
  edge: LayoutEdge;
  which: 'start' | 'end';
  side: AttachSide;
  /** Where the far end of this edge sits, which is what orders claims along the side. */
  toward: { x: number; y: number };
  /**
   * Where this claim sits in the lane order of its bundle, or undefined when
   * the edge is in none. `toward` cannot order edges that go to the same place,
   * and a bundle is exactly the case where they all do.
   */
  rank?: number;
}

/**
 * The edges running between one pair of sides.
 *
 * Two edges joining the bottom of A to the left of B are not two independent
 * orderings, one per side; they are one order used twice. Step outward along
 * A's bottom edge and the same edge must step outward along B's left edge, or
 * the two lines scissor across each other instead of nesting. So a bundle
 * carries a single lane index per edge and applies it at both ends, with the
 * sense of one end tied to the sense of the other.
 *
 * `planEndpoints` on its own cannot get this right, and the reason is worth
 * keeping: it orders each side by where the far ends sit, which is the correct
 * rule and a degenerate one here — every edge in a bundle has the *same* far
 * box, so that signal says nothing and the two sides end up ordered without
 * reference to each other.
 */
interface Bundle {
  /** The two (node, side) pairs the bundle runs between. */
  ends: [BundleEnd, BundleEnd];
  /** The edges, in lane order: index 0 sits at one extreme of the group. */
  lanes: LayoutEdge[];
  /**
   * Whether a step along the first end's side is a step the same way along the
   * second's. False is the common case for a corner-to-corner pair: further
   * left along a bottom edge is further *down* the left edge it aims at.
   */
  aligned: boolean;
  /** How far apart adjacent lanes sit, measured along either side. */
  step: number;
}

interface BundleEnd {
  node: LayoutNode;
  side: AttachSide;
}

/**
 * Work out where every edge meets every box.
 *
 * An author names a *side* — `to: top` — and never a point on it. Alone on a
 * side an edge lands at its center; sharing the side with others, the points
 * spread so they do not sit on top of each other. Which one goes where is
 * derived from where the far ends actually are, never chosen: of two edges
 * arriving at one top edge, the one coming from further left arrives further
 * left. That is the same rule as box non-overlap — the tool separates things by
 * default, and reads the direction off the solved layout rather than asking.
 *
 * Where several edges run between the *same* pair of sides that rule has
 * nothing to read, and a `Bundle` supplies the order instead — see there.
 */
function planEndpoints(
  edges: LayoutEdge[],
  measurer: Measurer,
  fontSize: number,
): Map<LayoutEdge, EdgeEnds> {
  const claims = new Map<LayoutNode, Map<AttachSide, Claim[]>>();
  const achieved = new Map<LayoutNode, Map<AttachSide, number>>();
  const named = new Map<LayoutEdge, { start?: Anchor; end?: Anchor }>();
  const bundles = planBundles(edges, measurer, fontSize);
  const spreads = planSpreads(edges, measurer, fontSize);

  for (const edge of edges) {
    named.set(edge, {});
    const fromSide = sideAttr(edge, 'from');
    const toSide = sideAttr(edge, 'to');
    if (fromSide) {
      claim(claims, edge.from, fromSide, {
        edge,
        which: 'start',
        side: fromSide,
        toward: centerOf(faceOf(edge.to)),
        rank: rankIn(bundles.get(edge), edge, edge.from, fromSide),
      });
    }
    if (toSide) {
      claim(claims, edge.to, toSide, {
        edge,
        which: 'end',
        side: toSide,
        toward: centerOf(faceOf(edge.from)),
        rank: rankIn(bundles.get(edge), edge, edge.to, toSide),
      });
    }
  }

  // Place every claimed side, spreading the points that share one.
  for (const [node, bySide] of claims) {
    const face = faceOf(node);
    for (const [side, group] of bySide) {
      const along = side === 'top' || side === 'bottom' ? 'x' : 'y';
      const span = along === 'x' ? face.width : face.height;
      const origin = along === 'x' ? face.x : face.y;

      // Far ends first, as ever; a bundle's own lane order settles the edges
      // that share one, which are precisely the ones the first key cannot.
      const ordered = [...group].sort(
        (a, b) => a.toward[along] - b.toward[along] || (a.rank ?? 0) - (b.rank ?? 0),
      );
      // A bundle's lanes have to hold whole texts apart rather than the points
      // of two arrows, so its step is the one that governs the side it lands on.
      const wanted = Math.max(
        ATTACH_STEP,
        ...group.map((entry) => bundles.get(entry.edge)?.step ?? 0),
      );
      const usable = Math.max(0, span - ATTACH_MARGIN * 2);
      const step = ordered.length > 1 ? Math.min(wanted, usable / (ordered.length - 1)) : 0;
      const first = origin + span / 2 - (step * (ordered.length - 1)) / 2;

      ordered.forEach((entry, index) => {
        const at = first + index * step;
        named.get(entry.edge)![entry.which] = anchorOn(face, side, at);
      });
      // What the side could actually give, which is less than `wanted` when it
      // is too short for the group. `bowBundles` makes up the difference.
      let steps = achieved.get(node);
      if (!steps) achieved.set(node, (steps = new Map()));
      steps.set(side, step);
    }
  }

  const bows = bowBundles(bundles, achieved);

  // Fill in the ends the author said nothing about, now that the named ones
  // are known: an unnamed end aims at wherever its partner ended up.
  const ends = new Map<LayoutEdge, EdgeEnds>();
  for (const edge of edges) {
    const partial = named.get(edge)!;
    const fromFace = faceOf(edge.from);
    const toFace = faceOf(edge.to);
    // Several edges between one pair of boxes with no side named anywhere: the
    // line each would have drawn alone, moved aside so they do not coincide.
    const spread = spreads.get(edge);
    if (spread) {
      ends.set(edge, { ...parallelEnds(fromFace, toFace, spread.offset), bow: spread.bow });
      continue;
    }
    // With neither end named this is the straight line it always was, each end
    // aiming at the other box's center.
    const start = partial.start ?? free(fromFace, partial.end ?? centerOf(toFace));
    const end = partial.end ?? free(toFace, partial.start ?? centerOf(fromFace));
    ends.set(edge, { start, end, bow: bows.get(edge) });
  }
  return ends;
}

/**
 * Group the edges that run between the same pair of sides, and work out the
 * lane order and lane width each group needs.
 *
 * Only an edge whose author named *both* sides can be in a bundle: a bundle is a
 * statement about two specific edges, and an end with no side named has not
 * picked one yet.
 */
function planBundles(
  edges: LayoutEdge[],
  measurer: Measurer,
  fontSize: number,
): Map<LayoutEdge, Bundle> {
  const ids = new Map<LayoutNode, number>();
  const idOf = (node: LayoutNode): number => {
    let id = ids.get(node);
    if (id === undefined) {
      id = ids.size;
      ids.set(node, id);
    }
    return id;
  };

  const groups = new Map<string, { ends: [BundleEnd, BundleEnd]; edges: LayoutEdge[] }>();
  for (const edge of edges) {
    const fromSide = sideAttr(edge, 'from');
    const toSide = sideAttr(edge, 'to');
    if (!fromSide || !toSide || edge.from === edge.to) continue;

    const a = { node: edge.from, side: fromSide };
    const b = { node: edge.to, side: toSide };
    const keyA = `${idOf(a.node)}:${a.side}`;
    const keyB = `${idOf(b.node)}:${b.side}`;
    // The pair is unordered — `a -> b` and `b -> a` join the same two edges —
    // so the key is canonical and the ends are stored in that same order.
    const swap = keyB < keyA;
    const key = swap ? `${keyB}|${keyA}` : `${keyA}|${keyB}`;
    const ends: [BundleEnd, BundleEnd] = swap ? [b, a] : [a, b];

    const group = groups.get(key);
    if (group) group.edges.push(edge);
    else groups.set(key, { ends, edges: [edge] });
  }

  const bundles = new Map<LayoutEdge, Bundle>();
  for (const group of groups.values()) {
    if (group.edges.length < 2) continue;
    const [first, second] = group.ends;
    const t0 = tangentOf(first.side);
    const t1 = tangentOf(second.side);
    const from = sideCenter(first);
    const to = sideCenter(second);
    const run = { x: to.x - from.x, y: to.y - from.y };

    // Nesting is a matter of which side of the line each end steps toward. Step
    // both ends to the same side of the run and the whole line translates;
    // step them to opposite sides and it pivots, which is a crossing.
    const aligned = cross(run, t0) * cross(run, t1) >= 0;
    const sense = aligned ? 1 : -1;

    // Two edges leaving in opposite directions are the ordinary case, and which
    // lane each takes is then read off the diagram rather than off the order the
    // author happened to type them in: a line keeps to one side of its own run.
    // Edges pointing the same way have no such signal and fall back to the file.
    const order = new Map(group.edges.map((edge, index) => [edge, index]));
    const lanes = [...group.edges].sort(
      (a, b) =>
        Number(a.from !== first.node) - Number(b.from !== first.node) ||
        order.get(a)! - order.get(b)!,
    );

    // One lane apart moves an edge's start by `step` along one side and its end
    // by `step` along the other, so the midpoint of the line — which is where
    // its text goes — moves by the average of the two.
    const drift = { x: (t0.x + sense * t1.x) / 2, y: (t0.y + sense * t1.y) / 2 };
    const bundle: Bundle = {
      ends: group.ends,
      lanes,
      aligned,
      step: Math.max(ATTACH_STEP, laneStep(lanes, drift, measurer, fontSize)),
    };
    for (const edge of lanes) bundles.set(edge, bundle);
  }
  return bundles;
}

/** Where one edge of a coincident group runs, relative to the line it would draw alone. */
interface Spread {
  /** How far its two ends are moved across the run. */
  offset: number;
  /**
   * How far its middle is moved further still, as a vector. Zero — and so a
   * straight line — whenever the boxes are big enough to hold the whole group
   * at full spacing, which is the ordinary case.
   */
  bow: { x: number; y: number };
}

/**
 * The sideways offset each edge takes when several run between the same two
 * boxes and none of them names a side.
 *
 * An unnamed end has no side to spread along: it aims at the far box's center
 * and attaches wherever that ray crosses the border, so every edge in such a
 * group produces the *same* ray and they are drawn on top of one another —
 * one visible line, every text stacked on one point. `planEndpoints` cannot
 * see this and `planBundles` will not, since a bundle is a statement about two
 * named edges.
 *
 * The repair keeps the attachment rule exactly as it is and only stops two
 * edges using it at the same place: the line an edge would have drawn alone is
 * translated across its own run by a lane, which is the straight-line version
 * of the nesting a bundle already gives curves. A lone edge is in no group and
 * so is untouched.
 *
 * Where the boxes are too small to hold the group at full spacing, the ends
 * are squeezed evenly to fit the edge — there is nowhere further to attach —
 * and the shortfall is made up in the middle instead: each line bows across
 * its run by exactly what its endpoints could not give it, so the texts, which
 * ride at the midpoints, come apart even though the arrows do not. The bow is
 * therefore derived rather than styled, and it is zero whenever the edge was
 * long enough, which is why the ordinary case is still a straight line.
 *
 * A `between` edge is left out. Its route is the corridor it named, its lane
 * inside that corridor is `planCorridors`' business, and `aimFreeEnds` will
 * re-aim these ends at the corridor afterwards regardless.
 */
function planSpreads(
  edges: LayoutEdge[],
  measurer: Measurer,
  fontSize: number,
): Map<LayoutEdge, Spread> {
  const ids = new Map<LayoutNode, number>();
  const idOf = (node: LayoutNode): number => {
    let id = ids.get(node);
    if (id === undefined) {
      id = ids.size;
      ids.set(node, id);
    }
    return id;
  };

  const groups = new Map<string, { first: LayoutNode; edges: LayoutEdge[] }>();
  for (const edge of edges) {
    if (sideAttr(edge, 'from') || sideAttr(edge, 'to')) continue;
    if (edge.from === edge.to || edge.between) continue;

    const a = idOf(edge.from);
    const b = idOf(edge.to);
    const swap = b < a;
    const key = swap ? `${b}|${a}` : `${a}|${b}`;
    const first = swap ? edge.to : edge.from;

    const group = groups.get(key);
    if (group) group.edges.push(edge);
    else groups.set(key, { first, edges: [edge] });
  }

  const spreads = new Map<LayoutEdge, Spread>();
  for (const group of groups.values()) {
    if (group.edges.length < 2) continue;
    const from = centerOf(faceOf(group.first));
    const sample = group.edges[0]!;
    const other = sample.from === group.first ? sample.to : sample.from;
    const to = centerOf(faceOf(other));
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    // Translating the line moves its midpoint — where the text goes — by
    // exactly this, so it is the drift `laneStep` needs.
    const across = { x: -dy / length, y: dx / length };

    // The same derived order a bundle uses: edges pointing opposite ways each
    // keep to one side of their own run, so a reciprocal pair reads as a
    // circulation, and only edges pointing the same way fall back to the file.
    const order = new Map(group.edges.map((edge, index) => [edge, index]));
    const lanes = [...group.edges].sort(
      (a, b) =>
        Number(a.from !== group.first) - Number(b.from !== group.first) ||
        order.get(a)! - order.get(b)!,
    );

    // How far a lane may be shifted before its line no longer passes through the
    // box at all. `exitAlong` clamps beyond that, which piles the outer lanes
    // onto a corner and puts their texts back on top of each other — so the
    // group is squeezed evenly instead, exactly as `planEndpoints` squeezes a
    // side too short for the edges arriving on it, and just as silently.
    const reach = (node: LayoutNode): number => {
      const face = faceOf(node);
      const byX = across.x === 0 ? Infinity : face.width / 2 / Math.abs(across.x);
      const byY = across.y === 0 ? Infinity : face.height / 2 / Math.abs(across.y);
      return Math.max(0, Math.min(byX, byY) - ATTACH_MARGIN);
    };
    // Which way lane 0 lies is arbitrary, so fix it the way the rest of the
    // renderer does — toward increasing x, or increasing y where the run is
    // horizontal. Without this the first edge written is topmost on a rightward
    // run and rightmost on a downward one, for no reason a reader could see.
    const orient = across.x < 0 || (across.x === 0 && across.y < 0) ? -1 : 1;
    const usable = 2 * Math.min(reach(group.first), reach(other));
    const wanted = Math.max(ATTACH_STEP, laneStep(lanes, across, measurer, fontSize));
    const step = Math.min(wanted, usable / (lanes.length - 1));
    lanes.forEach((edge, index) => {
      const place = index - (lanes.length - 1) / 2;
      // The lane is measured across the pair's own run, which has one direction;
      // an edge written the other way round travels the opposite way and would
      // otherwise take the same offset to the opposite side, putting a
      // reciprocal pair back on one line. Negated, both keep to their own left,
      // which is the circulation a bundle already draws.
      const sense = (edge.from === group.first ? 1 : -1) * orient;
      const shortfall = place * (wanted - step) * sense;
      spreads.set(edge, {
        offset: place * step * sense,
        bow: { x: across.x * shortfall, y: across.y * shortfall },
      });
    });
  }
  return spreads;
}

/**
 * The bow each bundled edge needs, where the sides it was given were too short
 * to hold the group at the spacing its texts asked for.
 *
 * A named side is squeezed exactly as an unnamed group's edge is — the step
 * shrinks to `usable / (n - 1)` and the texts ride down on top of each other —
 * and until this existed, naming the two sides the tool would have chosen
 * anyway made the picture strictly worse than saying nothing. That is not a
 * line worth defending, so the same repair applies: a lane's midpoint is not
 * on an edge and is free to move, and each line makes up in the middle exactly
 * what its two ends could not give it.
 *
 * The shortfall is a vector because the two ends move along different sides.
 * `drift` is how far a lane's midpoint travels per unit of step — the average
 * of the two ends' displacements, which is what `laneStep` sized the step
 * against — so the room a lane wanted is `drift * step`, the room it got is the
 * same average taken over the steps the two sides actually managed, and the
 * bow is the difference. It is zero whenever both sides were long enough,
 * which is why nothing that already fitted has moved.
 */
function bowBundles(
  bundles: Map<LayoutEdge, Bundle>,
  achieved: Map<LayoutNode, Map<AttachSide, number>>,
): Map<LayoutEdge, { x: number; y: number }> {
  const bows = new Map<LayoutEdge, { x: number; y: number }>();
  const stepOn = (end: BundleEnd): number => achieved.get(end.node)?.get(end.side) ?? 0;

  for (const bundle of new Set(bundles.values())) {
    const [first, second] = bundle.ends;
    const t0 = tangentOf(first.side);
    const t1 = tangentOf(second.side);
    const sense = bundle.aligned ? 1 : -1;
    const drift = { x: (t0.x + sense * t1.x) / 2, y: (t0.y + sense * t1.y) / 2 };

    const s0 = stepOn(first);
    const s1 = stepOn(second);
    const got = { x: (s0 * t0.x + sense * s1 * t1.x) / 2, y: (s0 * t0.y + sense * s1 * t1.y) / 2 };
    const short = {
      x: drift.x * bundle.step - got.x,
      y: drift.y * bundle.step - got.y,
    };
    if (short.x === 0 && short.y === 0) continue;

    bundle.lanes.forEach((edge, index) => {
      const place = index - (bundle.lanes.length - 1) / 2;
      bows.set(edge, { x: short.x * place, y: short.y * place });
    });
  }
  return bows;
}

/**
 * How far apart adjacent lanes must sit for their texts to clear each other.
 *
 * The texts are knockout rectangles, so two of them clear when they are apart
 * on *either* axis — hence the smaller of the two answers. `drift` is how far
 * the midpoint travels per unit of step, and it is never zero: the two ends
 * cancel only when both sides run the same way, and two such sides are always
 * `aligned`, which adds rather than subtracts.
 */
function laneStep(
  lanes: LayoutEdge[],
  drift: { x: number; y: number },
  measurer: Measurer,
  fontSize: number,
): number {
  const withText = lanes.filter((edge) => edge.text !== undefined);
  if (withText.length < 2) return 0;

  const need = (axis: Axis): number =>
    Math.max(
      ...withText.map((edge) =>
        textExtent(edge.lines!, edge.textAttrs, axis, measurer, fontSize, edge.line),
      ),
    );

  const along = (axis: Axis, reach: number): number =>
    reach === 0 ? Infinity : need(axis) / Math.abs(reach);
  return Math.min(along('x', drift.x), along('y', drift.y));
}

/** Which lane of its bundle an edge's end at this side takes, if it is in one. */
function rankIn(
  bundle: Bundle | undefined,
  edge: LayoutEdge,
  node: LayoutNode,
  side: AttachSide,
): number | undefined {
  if (!bundle) return undefined;
  const lane = bundle.lanes.indexOf(edge);
  const [first, second] = bundle.ends;
  if (node === first.node && side === first.side) return lane;
  if (node === second.node && side === second.side) return bundle.aligned ? lane : -lane;
  return undefined;
}

/** The unit vector along a side, pointing the way that coordinate increases. */
function tangentOf(side: AttachSide): { x: number; y: number } {
  return side === 'top' || side === 'bottom' ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

/** The midpoint of one side of a box. */
function sideCenter(end: BundleEnd): { x: number; y: number } {
  const face = faceOf(end.node);
  const along = end.side === 'top' || end.side === 'bottom' ? face.width : face.height;
  const origin = end.side === 'top' || end.side === 'bottom' ? face.x : face.y;
  return anchorOn(face, end.side, origin + along / 2);
}

function cross(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x * b.y - a.y * b.x;
}

function claim(
  claims: Map<LayoutNode, Map<AttachSide, Claim[]>>,
  node: LayoutNode,
  side: AttachSide,
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
function anchorOn(face: Box, side: AttachSide, at: number): Anchor {
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
  const point = sidePoint(face, toward);
  const center = centerOf(face);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: point.x, y: point.y, tx: dx / length, ty: dy / length };
}

/**
 * Walk from a point inside a box along a direction, stopping at the border.
 *
 * `sidePoint` walks from the center, which is the only place a single line
 * passes through. A fanned-out group's lines are parallel to that one and
 * beside it, so each needs the border crossing of its own line rather than of
 * the center's — which is what keeps the group parallel instead of splayed.
 */
function exitAlong(
  box: Box,
  from: { x: number; y: number },
  dir: { x: number; y: number },
): { x: number; y: number } {
  // A shift wider than the box leaves the origin outside it; clamping back in
  // is the graceful answer, and the crowding it signals is a diagnostic.
  const x = Math.min(Math.max(from.x, box.x), box.x + box.width);
  const y = Math.min(Math.max(from.y, box.y), box.y + box.height);
  const tx = dir.x === 0 ? Infinity : ((dir.x > 0 ? box.x + box.width : box.x) - x) / dir.x;
  const ty = dir.y === 0 ? Infinity : ((dir.y > 0 ? box.y + box.height : box.y) - y) / dir.y;
  const t = Math.min(tx, ty);
  if (!Number.isFinite(t)) return { x, y };
  return { x: x + dir.x * Math.max(0, t), y: y + dir.y * Math.max(0, t) };
}

/**
 * Both ends of an edge that named no side, moved `offset` sideways across its
 * own run.
 *
 * The whole line is translated rather than each end being nudged along its
 * border, so the result is genuinely parallel to the line the edge would have
 * drawn alone, exactly `offset` away from it. Where each end lands then falls
 * out of that: level boxes put both points further along the same two edges,
 * and a diagonal pair whose line leaves through a corner puts one point on each
 * of the two edges meeting there. Neither is a case in the code.
 */
function parallelEnds(from: Box, to: Box, offset: number): EdgeEnds {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / length, y: dy / length };
  const across = { x: -dir.y * offset, y: dir.x * offset };
  const startAt = exitAlong(from, { x: a.x + across.x, y: a.y + across.y }, dir);
  const endAt = exitAlong(to, { x: b.x + across.x, y: b.y + across.y }, { x: -dir.x, y: -dir.y });
  return {
    start: { x: startAt.x, y: startAt.y, tx: dir.x, ty: dir.y },
    end: { x: endAt.x, y: endAt.y, tx: -dir.x, ty: -dir.y },
  };
}

/** How far the control points sit off the ends. Proportional, but bounded. */
function controlReach(start: Anchor, end: Anchor): number {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  return Math.max(24, Math.min(140, distance * 0.4));
}

// --- corridors ----------------------------------------------------------------

/**
 * Where an edge runs while it is passing the two nodes a `between` clause named.
 *
 * A corridor is *measured*, never solved for: both nodes are already placed by
 * the time the renderer sees them, so the gap between them is a pair of numbers
 * and the edge is routed through it. Nothing here can move a box. That is the
 * deliberate half of the feature — an arrow states where it goes, and if the
 * gap it names is too tight, that is something to report rather than repair.
 */
interface Corridor {
  /** The axis the gap binds. A gap between something above and something below binds y. */
  axis: Axis;
  /** Where on that axis this edge runs. Several edges in one gap take their own lanes. */
  lane: number;
  /** Where the run begins and ends on the other axis, in the order the edge travels. */
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
 * Route every edge that named a gap.
 *
 * Edges sharing one gap share its lanes, spread like attachments on a side and
 * ordered the same derived way — by where their ends actually sit, so the two
 * arriving at the hub's left edge in one order run through the corridor in that
 * same order and never cross.
 */
function planCorridors(
  edges: LayoutEdge[],
  ends: Map<LayoutEdge, EdgeEnds>,
  measurer: Measurer,
  fontSize: number,
): Map<LayoutEdge, Corridor> {
  const plans = new Map<LayoutEdge, Corridor>();
  const groups = new Map<
    string,
    { axis: Axis; lo: number; hi: number; across: [number, number]; members: LayoutEdge[] }
  >();

  for (const edge of edges) {
    if (!edge.between) continue;
    const [first, second] = edge.between.nodes;
    const gap = gapBetween(
      faceOf(first),
      faceOf(second),
      first.name,
      second.name,
      edge.between.axis,
      edge.line,
    );
    // The pair names one gap however the author ordered them. The axis is in
    // the key because a diagonal pair really does have two, and two edges may
    // legitimately name the same pair and take different ones.
    const key = [gap.axis, ...[first.name, second.name].sort()].join(' ');
    const group = groups.get(key);
    if (group) group.members.push(edge);
    else groups.set(key, { ...gap, members: [edge] });
  }

  for (const group of groups.values()) {
    const along = (edge: LayoutEdge): number => {
      const { start, end } = ends.get(edge)!;
      return (start[group.axis] + end[group.axis]) / 2;
    };
    const ordered = [...group.members].sort((a, b) => along(a) - along(b));

    // Lanes are spread as attachments on a side are, including the squeeze when
    // there is not enough room — see `planEndpoints`. The step is wider here,
    // because a lane carries a whole text rather than the point of an arrow,
    // and two lanes closer together than a text is deep would draw the texts
    // over each other. Still derived, not chosen: it is the size of what is
    // actually running along the corridor.
    const span = group.hi - group.lo;
    const usable = Math.max(0, span - ATTACH_MARGIN * 2);
    const want = Math.max(
      ATTACH_STEP,
      ...ordered.map((edge) => laneExtent(edge, group.axis, measurer, fontSize)),
    );
    const step = ordered.length > 1 ? Math.min(want, usable / (ordered.length - 1)) : 0;
    const firstLane = group.lo + span / 2 - (step * (ordered.length - 1)) / 2;

    ordered.forEach((edge, index) => {
      const { start, end } = ends.get(edge)!;
      const run: Axis = group.axis === 'y' ? 'x' : 'y';
      // The corridor binds only where the edge is actually passing the pair, so
      // its reach is the overlap of the pair's extent with the edge's own.
      const enterAt = Math.max(group.across[0], Math.min(start[run], end[run]));
      const leaveAt = Math.min(group.across[1], Math.max(start[run], end[run]));
      if (leaveAt <= enterAt) {
        const [a, b] = edge.between!.nodes;
        throw new SourceError(
          `this edge never passes between "${a.name}" and "${b.name}"`,
          edge.line,
        );
      }
      const forward = end[run] >= start[run];
      plans.set(edge, {
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
 * An end whose side the author did not name aims at the far box's center, which
 * is the wrong thing to aim at once the line has been told to go somewhere else
 * on the way. Point those ends at the corridor instead.
 */
function aimFreeEnds(
  edges: LayoutEdge[],
  ends: Map<LayoutEdge, EdgeEnds>,
  corridors: Map<LayoutEdge, Corridor>,
): void {
  for (const edge of edges) {
    const plan = corridors.get(edge);
    if (!plan) continue;
    const current = ends.get(edge)!;
    const start =
      current.start.side === undefined
        ? free(faceOf(edge.from), corridorPoint(plan, plan.enter))
        : current.start;
    const end =
      current.end.side === undefined
        ? free(faceOf(edge.to), corridorPoint(plan, plan.leave))
        : current.end;
    ends.set(edge, { start, end });
  }
}

/**
 * How much room an edge's text takes across the corridor — its depth in a
 * horizontal channel, its width in a vertical one. Zero for an edge with no text,
 * which needs no more than the arrow spacing.
 *
 * `textExtent` measures the knockout along whichever axis it is handed, and the
 * axis wanted here is the one the channel is measured on rather than the one the
 * edge runs along — a channel measured vertically carries edges running
 * horizontally, and what has to fit between two lanes of it is a text's depth.
 */
function laneExtent(
  edge: LayoutEdge,
  axis: Axis,
  measurer: Measurer,
  fontSize: number,
): number {
  if (edge.lines === undefined) return 0;
  return textExtent(edge.lines, edge.textAttrs, axis, measurer, fontSize, edge.line);
}

function corridorPoint(plan: Corridor, at: number): Point {
  return plan.axis === 'y' ? { x: at, y: plan.lane } : { x: plan.lane, y: at };
}

/**
 * The path a corridor edge takes: a curve out of its start into the gap, the
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

function sideAttr(edge: LayoutEdge, key: 'from' | 'to'): AttachSide | undefined {
  const value = edge.attrs[key];
  if (value === undefined) return undefined;
  if (!(ATTACH_SIDES as readonly string[]).includes(value)) {
    throw new SourceError(
      `"${key}: ${value}" is not a side — use ${ATTACH_SIDES.join(', ')}`,
      edge.line,
    );
  }
  return value as AttachSide;
}

function arrowMarker(color: string): string {
  const id = markerId(color);
  return [
    `    <marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${ARROW_MARKER_WIDTH}" markerHeight="${ARROW_MARKER_WIDTH}" orient="auto-start-reverse">`,
    `      <path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/>`,
    '    </marker>',
    `    <marker id="${id}-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${ARROW_MARKER_WIDTH}" markerHeight="${ARROW_MARKER_WIDTH}" orient="auto-start-reverse">`,
    `      <path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/>`,
    '    </marker>',
  ].join('\n');
}

function markerId(color: string): string {
  return `arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
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

function centerOf(box: Box): { x: number; y: number } {
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

/**
 * Draw a block of text into the room it was given.
 *
 * Two independent questions, which is why there are two words for them. `side`
 * is where the block sits across that room, from the horizontal half of the
 * text's `at`. `align` is how the block's own lines range against each other,
 * which matters whenever they are of unequal length and is a different thing
 * from where the block is.
 *
 * Where the block is as wide as the room — which is every text whose box is
 * sized from it, so nearly all of them — the two coincide and `side` changes
 * nothing.
 */
function textBlock(
  lines: Line[],
  x: number,
  y: number,
  lineHeight: number,
  fontSize: number,
  box: { x: number; y: number; width: number; height: number },
  style: {
    color: string;
    align: 'start' | 'middle' | 'end';
    ink: (run: Run, own: string) => string;
  },
): string {
  // `box` is the ink the text occupies, worked out by the resolver — the one
  // place that decides where a text sits, because `hub text` is a placement
  // target and the answer has to be a number before anything is solved.
  const blockLeft = x + box.x;
  const top = y + box.y;
  const anchorX =
    style.align === 'middle'
      ? blockLeft + box.width / 2
      : style.align === 'end'
        ? blockLeft + box.width
        : blockLeft;
  return lines
    .map((line, index) => {
      if (plain(line).length === 0) return '';
      const baseline = top + index * lineHeight + lineHeight / 2 + fontSize * 0.35;
      // One `<text>` per line, with a `<tspan>` per run inside it, so the runs
      // flow from the line's own anchor and a mark never moves a character.
      // A line drawn in one color says so on the `<text>` and emits no spans at
      // all, which is what keeps a whole quiet line identical to what the
      // `subtext:` it replaced produced.
      const colors = line.map((run) => style.ink(run, style.color));
      const uniform = colors.every((color) => color === colors[0]);
      const body = uniform
        ? escapeXml(plain(line))
        : line
            .map((run, run_index) =>
              colors[run_index] === style.color
                ? escapeXml(run.text)
                : `<tspan fill="${colors[run_index]}">${escapeXml(run.text)}</tspan>`,
            )
            .join('');
      return `  <text x="${round(anchorX)}" y="${round(baseline)}" fill="${uniform ? colors[0] ?? style.color : style.color}" text-anchor="${style.align}">${body}</text>`;
    })
    .filter((element) => element.length > 0)
    .join('\n');
}

/**
 * The color a marked-up run is drawn in. The mark names a *style*, never a
 * color, so the word borrows a meaning the file already has rather than
 * restating a value that goes stale the day the thing it means is recolored.
 * The resolver has already refused a mark naming a style that does not exist or
 * that says nothing about text.
 */
function runInk(
  run: Run,
  own: string,
  markup: Record<string, string>,
  theme: Theme,
): string {
  if (run.style === undefined) return own;
  return namedColor(markup[run.style]!, theme);
}

/**
 * A text's own color. `muted` is the one reserved word: it defers to the theme,
 * so a quiet line stays readable when the theme changes. Anything else is a
 * color, the same as `fill:` and `border:` take.
 */
function textColorOf(textAttrs: Attrs, theme: Theme, fallback: string): string {
  const value = textAttrs['color'];
  return value === undefined ? fallback : namedColor(value, theme);
}

function namedColor(value: string, theme: Theme): string {
  return value === 'muted' ? theme.mutedText : value;
}

/**
 * A color is written as the viewer will receive it — `#14532d`, or any CSS
 * color. The renderer keeps no list of color words of its own, so a diagram
 * is never limited to the ones somebody remembered to add here.
 *
 * Each names the part it colors, so each reads exactly one key. The word these
 * replaced, `stroke:`, named no part and meant a different one on every kind,
 * which is why a box's text could not be colored at all until `text:`.
 */
function borderOf(appearance: Record<string, string>, fallback: string): string {
  return appearance['border'] ?? fallback;
}

function lineOf(appearance: Record<string, string>, fallback: string): string {
  return appearance['line'] ?? fallback;
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
