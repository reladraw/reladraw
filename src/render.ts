import {
  ARROW_LENGTH,
  ARROW_MARKER_WIDTH,
  ATTACH_MARGIN,
  ATTACH_STEP,
  DECK_STEP,
  DEFAULT_FONT_SIZE,
  ICON_LINES,
  LINE_WIDTH,
  BAR,
  PAD,
  SEPARATION_GAP,
  arrowLength,
  fontSizeFor,
  textExtent,
  textStyleFor,
  widestLine,
} from './constants.js';
import type { Attrs, Axis, Mark } from './ast.js';
import { describeAxis } from './ast.js';
import { SourceError } from './errors.js';
import { ICON_STROKE, type Icon, type IconTone, type Outline } from './icons.js';
import { monospaceMeasurer, type Measurer } from './measure.js';
import type { Layout, LayoutEdge, LayoutNode, LayoutPass, LineLook } from './model.js';
import { DARK_THEME, THEMES, textOnFill, themeColor, type Theme } from './themes.js';
import { searchRoute, type SearchEnd, type SearchGate, type SearchWall } from './search.js';
import { plain, type Line, type Run } from './text.js';

export interface RenderOptions {
  measurer?: Measurer;
  fontSize?: number;
  theme?: Theme;
}


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
  // A theme passed in — the command line's `--theme` — beats the one the file
  // names, so one source renders in either. `diagram background:` and `text:`
  // are the author overruling a color of whichever theme that is, and a color
  // written by hand wins over any theme, so they are folded in afterwards and
  // everything downstream sees one theme.
  const named = layout.diagram['theme'];
  const base = options.theme ?? (named === undefined ? undefined : THEMES[named]) ?? DARK_THEME;
  const page = layout.diagram['background'];
  const words = layout.diagram['text.color'];
  const theme: Theme = {
    ...base,
    ...(page !== undefined && { background: themeColor(page, base) }),
    ...(words !== undefined && { text: themeColor(words, base) }),
  };

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
  const corridors = planCorridors(layout.edges, ends);
  const routes = planWays(layout.edges, layout.nodes, ends, corridors, measurer, fontSize);
  // A curved line sweeps along its way, kept off every other line: off the
  // sweeps already drawn, and off the ways of those still to come. Routes are
  // in the order they were placed, inside lanes first, so a line outside
  // another follows the curve of the one inside it rather than its corners.
  const sweeps = new Map<LayoutEdge, string>();
  const swept: Point[][] = [];
  for (const [edge, route] of routes) {
    if (edge.look.path !== 'curved') continue;
    const coming = [...routes]
      .filter(([other]) => other !== edge && !sweeps.has(other))
      .map(([, way]) => way.points);
    const d = sweptPath(
      route.points,
      sweepObstacles(edge, layout.nodes),
      [...swept, ...coming],
      arrowLength(edge.look.thickness),
      edge.marks,
    );
    sweeps.set(edge, d);
    swept.push(traceOf(`d="${d}"`));
  }
  const drawn = layout.edges.map((edge) =>
    drawEdge(
      edge,
      ends.get(edge)!,
      routes.get(edge),
      sweeps.get(edge),
      layout.nodes,
      theme,
      measurer,
      fontSize,
      layout.markup,
    ),
  );
  placeTexts(drawn, layout.nodes);
  // A line with a `crossing:` style is cut where it crosses an earlier one, and
  // the jump drawn over the cut. The cut is a mask rather than a break in the
  // path, so it works the same on a curve as on a corner, and leaves whatever
  // lies underneath — a container's fill — showing through the gap.
  const crossings = findCrossings(drawn);
  const masks: { id: string; holes: Crossing[] }[] = [];
  for (const edge of drawn) {
    const found = crossings.get(edge);
    const parts = [edge.line, ...edge.rest];
    if (found) {
      const id = `cut-${masks.length + 1}`;
      masks.push({ id, holes: found });
      parts[0] = edge.line.replace(/\/>$/, ` mask="url(#${id})"/>`);
      const jumps = found
        .map((crossing) => jumpAt(crossing, edge.edge.look.crossing))
        .filter((d): d is string => d !== undefined)
        .map((d) => `  <path d="${d}" fill="none"${edge.stroke}/>`);
      parts.splice(1, 0, ...jumps);
      for (const crossing of found) {
        edge.ink = union(edge.ink, grow(extentOfPoints([crossing.at]), crossing.reach + edge.edge.look.thickness));
      }
    }
    body.push(linked(parts.join('\n'), edge.edge.attrs['url']));
    ink = union(ink, grow(edge.ink, layout.margin));
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

  // One marker for each mark in each line color the drawing actually uses.
  const markers = new Map<string, [Mark, string]>();
  for (const edge of layout.edges) {
    const color = lineOf(edge.appearance, theme, theme.edge);
    for (const mark of [edge.marks.from, edge.marks.to]) {
      if (mark !== 'none') markers.set(markerId(mark, color), [mark, color]);
    }
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="${canvas.x} ${canvas.y} ${canvas.width} ${canvas.height}" font-family=${quote(measurer.fontFamily)} font-size="${fontSize}px">`,
    '  <defs>',
    ...[...markers.values()].map(([mark, color]) => markMarker(mark, color, theme.background)),
    // Each mask covers the whole page, in page units: the default region is the
    // line's own bounding box, which a straight level line gives no height, and
    // the line would vanish entirely.
    ...masks.map(({ id, holes }) =>
      [
        `    <mask id="${id}" maskUnits="userSpaceOnUse" x="${canvas.x}" y="${canvas.y}" width="${canvas.width}" height="${canvas.height}">`,
        `      <rect x="${canvas.x}" y="${canvas.y}" width="${canvas.width}" height="${canvas.height}" fill="white"/>`,
        ...holes.map(
          (hole) => `      <circle cx="${round(hole.at.x)}" cy="${round(hole.at.y)}" r="${round(hole.reach)}" fill="black"/>`,
        ),
        '    </mask>',
      ].join('\n'),
    ),
    '  </defs>',
    `  <rect x="${canvas.x}" y="${canvas.y}" width="${canvas.width}" height="${canvas.height}" fill="${theme.background}"/>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
  return ownIds(svg);
}

/**
 * Gives every id in a drawing a prefix of its own, taken from a hash of the
 * drawing.
 *
 * Ids are shared by every SVG inlined into one page, and a reference resolves to
 * the first element in the page carrying the name. With plain names, a second
 * drawing's arrowheads came from the first one — and when the first was hidden,
 * in a closed dialog or a collapsed tab, they were not drawn at all. Its masks
 * would have cut the second drawing's lines where the first one's crossed.
 *
 * A hash rather than a counter, so the same source gives the same bytes on every
 * run. Two drawings that share a prefix are byte-for-byte the same, so whichever
 * copy a reference lands on draws the same thing — unless that copy is hidden,
 * which is the one case this does not cover.
 *
 * Only attribute positions are rewritten. Anything a diagram's author wrote is
 * escaped before it reaches an attribute, so it cannot contain the `"` both
 * patterns begin or end with.
 */
function ownIds(svg: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < svg.length; i++) {
    hash = Math.imul(hash ^ svg.charCodeAt(i), 0x01000193);
  }
  const prefix = `r${(hash >>> 0).toString(16).padStart(8, '0')}-`;
  return svg.replaceAll(' id="', ` id="${prefix}`).replaceAll('="url(#', `="url(#${prefix}`);
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
 * that node draws — outline and text — and its children are emitted beside
 * it, each wrapping itself. The reading comes out the same anyway, because the
 * container's filled outline lies under the children and catches every click
 * that does not land on one of them.
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
  const { own, kids } = nodeSvg(node, theme, measurer, fontSize, markup, url);
  return [linked(own.join('\n'), url), ...kids]
    .filter((part) => part.length > 0)
    .join('\n');
}

/**
 * What a node draws, in two pieces: its own ink and its children's. They are
 * kept apart so the node's `<a>` can wrap what is the node's without
 * swallowing what is a child's.
 */
function nodeSvg(
  node: LayoutNode,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
  url: string | undefined,
): { own: string[]; kids: string[] } {
  // A note is set smaller than a box text by default, and `size:` overrides
  // that on anything. Only this node's own text takes the size — children are
  // drawn by their own call and carry whatever they say themselves.
  const size = fontSizeFor(node.kind, node.textAttrs, fontSize, node.line);
  const textHeight = measurer.lineHeight(size);
  const blockWidth = widestLine(node.lines, measurer, size);
  const ink = (run: Run, own: string) => runInk(run, own, markup, theme);

  if (node.body.kind === 'none') {
    const style = textStyleFor(node.textAttrs, node.line, 'start', 'center');
    return { kids: [], own: [sized(
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
    return { own: drawn, kids: [] };
  }

  const outline = node.body.outline;
  const parts: string[] = [];
  const kids: string[] = [];
  const face = faceOf(node);
  // A node with children is colored as a backdrop however they are placed,
  // including a lone badge beside its text. Every rule that tried to tell a
  // badge from contents was a guess; this one is visible in the source.
  const container = node.children.length > 0;
  const border = borderOf(node.appearance, theme, container ? theme.containerStroke : theme.boxStroke);
  const fill = fillOf(node.appearance, theme, container ? theme.containerFill : theme.boxFill);
  // A box is the one kind with two inkable parts, which is why its text needs
  // a word of its own — `border:` cannot stand in for it. Left unsaid on a
  // theme fill, it is whatever reads on that fill: `fill: theme-primary` alone
  // makes a badge whose text is legible in every theme.
  const text = textColorOf(node.textAttrs, theme, textOnFill(node.appearance['fill'] ?? '', theme) ?? theme.text);

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
  // its lines against each other is read here. This follows the band, not the
  // colors: a badged leaf is a backdrop but its text still centers.
  const textStyle = textStyleFor(
    node.textAttrs,
    node.line,
    node.banded ? 'start' : 'middle',
    node.banded ? 'top-left' : 'center',
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

  return { own: parts, kids };
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
  if (shape === 'circle') {
    // Two half-turns from the leftmost point, since one arc cannot close.
    const radius = w / 2;
    return [
      `M${round(x)} ${round(y + h / 2)}`,
      `a${round(radius)} ${round(radius)} 0 1 0 ${round(w)} 0`,
      `a${round(radius)} ${round(radius)} 0 1 0 ${round(-w)} 0`,
      'Z',
    ].join(' ');
  }
  if (shape === 'diamond') {
    // The four points are the middles of the box's sides.
    return [
      `M${round(x + w / 2)} ${round(y)}`,
      `L${round(x + w)} ${round(y + h / 2)}`,
      `L${round(x + w / 2)} ${round(y + h)}`,
      `L${round(x)} ${round(y + h / 2)}`,
      'Z',
    ].join(' ');
  }
  if (shape === 'pill' || shape === 'half-pill') {
    // A half circle on the right, and on the left too for a pill; a half pill's
    // left corners are a box's.
    const cap = h / 2;
    const left = shape === 'pill' ? cap : r;
    const start = [
      `M${round(x + left)} ${round(y)}`,
      `H${round(x + w - cap)}`,
      `a${round(cap)} ${round(cap)} 0 0 1 0 ${round(h)}`,
      `H${round(x + left)}`,
    ];
    const back =
      shape === 'pill'
        ? [`a${round(cap)} ${round(cap)} 0 0 1 0 ${round(-h)}`]
        : [`a${r} ${r} 0 0 1 ${-r} ${-r}`, `V${round(y + r)}`, `a${r} ${r} 0 0 1 ${r} ${-r}`];
    return [...start, ...back, 'Z'].join(' ');
  }
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
  if (shape === 'framed') {
    return [`M${round(x + BAR)} ${round(y)} V${round(y + h)}`, `M${round(x + w - BAR)} ${round(y)} V${round(y + h)}`];
  }
  if (shape !== 'document') return [];
  return [
    `M${round(x + w - FOLD)} ${round(y)} V${round(y + FOLD)} H${round(x + w)}`,
  ];
}

/** One icon, scaled from its own grid onto a square of `side` at `x, y`. */
function drawIcon(icon: Icon, x: number, y: number, side: number, theme: Theme): string {
  if ('inner' in icon) {
    // Its own viewBox fits it to the square, centered and in proportion.
    // `color` is set only when the drawing does not set it, so `currentColor`
    // means the theme's icon line unless the author said otherwise.
    const color = /(^|\s)color=/.test(icon.attrs) ? '' : ` color="${theme.iconInk}"`;
    return [
      `  <svg x="${round(x)}" y="${round(y)}" width="${round(side)}" height="${round(side)}"${color} ${icon.attrs}>`,
      icon.inner,
      '  </svg>',
    ].join('\n');
  }
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

/**
 * One edge, drawn. The line is kept apart from the rest so that the crossings,
 * which need every line to exist first, can cut into it afterwards.
 */
interface DrawnEdge {
  edge: LayoutEdge;
  /** The line's element, closed with `/>` so a mask can be added to it. */
  line: string;
  /** Its text, after it. */
  rest: string[];
  ink: Extent;
  /** The line as a polyline, curves flattened, for finding where lines cross. */
  trace: Point[];
  color: string;
  stroke: string;
  /** Its text, placed after every line is drawn — see `placeTexts`. */
  text?: EdgeText;
}

function drawEdge(
  edge: LayoutEdge,
  ends: EdgeEnds,
  route: Route | undefined,
  sweep: string | undefined,
  nodes: LayoutNode[],
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
): DrawnEdge {
  const { start, end } = ends;
  const color = lineOf(edge.appearance, theme, theme.edge);
  const stroke = strokeOf(color, edge.look);

  const markerEnd = edge.marks.to !== 'none' ? ` marker-end="url(#${markerId(edge.marks.to, color)})"` : '';
  const markerStart =
    edge.marks.from !== 'none' ? ` marker-start="url(#${markerId(edge.marks.from, color)})"` : '';

  // A named side is a statement about how the line should leave or arrive, so
  // it is drawn as a curve that actually does leave and arrive that way. With
  // neither side named there is nothing to honor and the line stays straight.
  const curved = start.side !== undefined || end.side !== undefined;
  const bowed = ends.bow !== undefined && (ends.bow.x !== 0 || ends.bow.y !== 0);
  const parts: string[] = [];
  // What the line actually covers, so the canvas can be sized to hold it. A
  // curve leaving a `top` side rides above every box in the drawing, and the
  // node bounds know nothing about it.
  let ink = extentOfPoints([start, end]);
  let midX: number;
  let midY: number;

  const jointed = edge.look.path !== 'curved' && (route || curved || bowed);
  if (jointed) {
    // `path: square` and `path: straight` are the same fixed points — the ends,
    // which way each faces, the run a clause asked for — joined by a different
    // rule, and both come out as straight pieces meeting at corners.
    const textWidth =
      edge.lines === undefined
        ? 0
        : widestLine(edge.lines, measurer, fontSizeFor('edge', edge.textAttrs, fontSize, edge.line));
    const plan = jointedLine(edge, ends, route, nodes, textWidth);
    const d =
      edge.look.corners === 'rounded'
        ? roundedPath(plan.points, arrowLength(edge.look.thickness))
        : sharpPath(plan.points);
    parts.push(`  <path d="${d}" fill="none"${stroke}${markerEnd}${markerStart}/>`);
    ink = union(ink, extentOfPoints(plan.points));
    midX = plan.mid.x;
    midY = plan.mid.y;
  } else if (route) {
    // A curved line along a found way sweeps through each turn, as widely as
    // the room around the turn allows — worked out for every line at once, in
    // `render`, since each sweep keeps off the others.
    parts.push(`  <path d="${sweep!}" fill="none"${stroke}${markerEnd}${markerStart}/>`);
    // A sweep cuts inside its corners, so the way's own points bound it.
    ink = union(ink, extentOfPoints(route.points));
    midX = route.mid.x;
    midY = route.mid.y;
  } else if (curved) {
    const { p0, c1, c2, p3 } = sideCurve(edge, ends);
    const lead = p0.x !== start.x || p0.y !== start.y ? `M ${round(start.x)} ${round(start.y)} L` : 'M';
    const tail = p3.x !== end.x || p3.y !== end.y ? ` L ${round(end.x)} ${round(end.y)}` : '';
    parts.push(
      `  <path d="${lead} ${round(p0.x)} ${round(p0.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(p3.x)} ${round(p3.y)}${tail}" fill="none"${stroke}${markerEnd}${markerStart}/>`,
    );
    ink = union(ink, cubicExtent(p0, c1, c2, p3));
    // The point halfway along the cubic, which is where the text belongs.
    midX = (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8;
    midY = (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8;
  } else if (ends.bow && bowed) {
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
      `  <path d="M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}" fill="none"${stroke}${markerEnd}${markerStart}/>`,
    );
    ink = union(ink, cubicExtent(start, c1, c2, end));
    midX = (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8;
    midY = (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8;
  } else {
    parts.push(
      `  <line x1="${round(start.x)}" y1="${round(start.y)}" x2="${round(end.x)}" y2="${round(end.y)}"${stroke}${markerEnd}${markerStart}/>`,
    );
    midX = (start.x + end.x) / 2;
    midY = (start.y + end.y) / 2;
  }

  let text: EdgeText | undefined;
  if (edge.text !== undefined) {
    // An edge text breaks on ` / ` exactly as a box text does, so a two-line
    // caption on an arrow needs no vocabulary of its own. The block is centered
    // on the midpoint, which keeps a one-line text where it has always been.
    const size = fontSizeFor('edge', edge.textAttrs, fontSize, edge.line);
    const textHeight = measurer.lineHeight(size);
    const lines = edge.lines!;
    const width = widestLine(lines, measurer, size);
    const height = lines.length * textHeight;
    text = {
      at: { x: midX, y: midY },
      width: width + 10,
      height,
      draw: ({ x, y }) => {
        const top = y - height / 2;
        return [
          // The text knocks a hole in whatever it lands on rather than sitting
          // in a chip of its own: an outlined box reads as a node, which is the
          // one thing a text on a line is not.
          `  <rect x="${round(x - width / 2 - 5)}" y="${round(top)}" width="${round(width + 10)}" height="${round(height)}" fill="${theme.background}"/>`,
          sized(
            textBlock(lines, x - width / 2, top, textHeight, size,
              { x: 0, y: 0, width, height },
              {
                // A colored edge carries its meaning into its text; an uncolored
                // one leaves the words to read as ordinary text.
                color: textColorOf(edge.textAttrs, theme, lineOf(edge.appearance, theme, theme.text)),
                align: 'middle',
                ink: (run, own) => runInk(run, own, markup, theme),
              },
            ),
            size,
            fontSize,
          ),
        ];
      },
    };
  }

  // The stroke straddles the path, so half of it lies outside the geometry.
  const [line] = parts;
  return {
    edge,
    line: line!,
    rest: [],
    ink: grow(ink, edge.look.thickness / 2),
    trace: traceOf(line!),
    color,
    stroke,
    text,
  };
}

/** The space a text moved off another keeps from it. */
const TEXT_AIR = 6;

/** An edge's text, not yet drawn: where it would go, how much room it takes, and how to draw it at a point. */
interface EdgeText {
  at: Point;
  width: number;
  height: number;
  draw: (at: Point) => string[];
}

/**
 * Put every edge's text where it goes. A text sits where its line put it unless
 * that lands on a text placed before it; then it slides along its own line to
 * the nearest spot clear of the other texts and of every box. The line never
 * moves for it. With no clear spot anywhere along the line, it stays put.
 */
function placeTexts(drawn: DrawnEdge[], nodes: LayoutNode[]): void {
  const placed: Extent[] = [];
  const boxAt = (at: Point, text: EdgeText): Extent => ({
    minX: at.x - text.width / 2,
    minY: at.y - text.height / 2,
    maxX: at.x + text.width / 2,
    maxY: at.y + text.height / 2,
  });
  const overlaps = (a: Extent, b: Extent): boolean =>
    Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0.5 &&
    Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > 0.5;
  // A box the text is inside, drawn round it, is a container it rides across,
  // not something it lands on.
  const onBox = (area: Extent, at: Point): boolean =>
    nodes.some((node) => {
      const box = extentOfBox(faceOf(node));
      const holds = node.children.length > 0 &&
        box.minX < at.x && at.x < box.maxX && box.minY < at.y && at.y < box.maxY;
      return !holds && overlaps(area, box);
    });

  for (const edge of drawn) {
    const text = edge.text;
    if (!text) continue;
    let at = text.at;
    if (placed.some((other) => overlaps(other, boxAt(at, text)))) {
      // Moved, it keeps a little air from the others rather than touching them.
      const free = (point: Point): boolean => {
        const area = boxAt(point, text);
        return !placed.some((other) => overlaps(grow(other, TEXT_AIR), area)) && !onBox(area, point);
      };
      at = slideAlong(edge.trace, text.at, free) ?? at;
    }
    const area = boxAt(at, text);
    placed.push(area);
    edge.rest = text.draw(at);
    // Grown by half the stroke as the line's own ink is, so a text at the edge
    // of the page sizes it exactly as it always did.
    edge.ink = union(edge.ink, grow(area, edge.edge.look.thickness / 2));
  }
}

/**
 * The point on a polyline nearest `from`, measured along the line, that `free`
 * accepts: tried a few pixels at a time in both directions, nearer first.
 * Undefined when no point along it is accepted.
 */
function slideAlong(trace: Point[], from: Point, free: (point: Point) => boolean): Point | undefined {
  const lengths = [0];
  for (let index = 1; index < trace.length; index += 1) {
    const [a, b] = [trace[index - 1]!, trace[index]!];
    lengths.push(lengths[index - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[lengths.length - 1]!;
  const pointAt = (s: number): Point => {
    let index = 1;
    while (index < trace.length - 1 && lengths[index]! < s) index += 1;
    const [a, b] = [trace[index - 1]!, trace[index]!];
    const piece = lengths[index]! - lengths[index - 1]!;
    const t = piece === 0 ? 0 : (s - lengths[index - 1]!) / piece;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  // Where along the line the text started.
  let start = 0;
  let nearest = Infinity;
  for (let s = 0; s <= total; s += 1) {
    const p = pointAt(s);
    const off = Math.hypot(p.x - from.x, p.y - from.y);
    if (off < nearest) {
      nearest = off;
      start = s;
    }
  }
  const step = 4;
  for (let offset = step; offset <= total; offset += step) {
    for (const s of [start + offset, start - offset]) {
      if (s < 0 || s > total) continue;
      const p = pointAt(s);
      if (free(p)) return p;
    }
  }
  return undefined;
}

/**
 * The stroke of a line: its color, its thickness and its pattern. The dashes
 * are measured in thicknesses, so a pattern keeps its proportions on a thick
 * line, which covers most of what a density setting would be for. A solid line
 * of the ordinary thickness writes exactly what every line always did.
 */
function strokeOf(color: string, look: LineLook): string {
  const w = look.thickness;
  const dashes: Record<LineLook['pattern'], string> = {
    solid: '',
    dashed: ` stroke-dasharray="${round(w * 4)} ${round(w * 3)}"`,
    // A zero-length dash with a round cap is a dot as wide as the line.
    dotted: ` stroke-dasharray="0 ${round(w * 3)}" stroke-linecap="round"`,
    'dash-dot': ` stroke-dasharray="${round(w * 5)} ${round(w * 3)} 0 ${round(w * 3)}" stroke-linecap="round"`,
  };
  return ` stroke="${color}" stroke-width="${w}"${dashes[look.pattern]}`;
}

/**
 * The points of a square or straight line, and where its text sits.
 *
 * Both start from what the file fixed. A square line leaves each side head-on
 * and turns only at right angles; a straight one goes directly from point to
 * point, and bends only where a clause — `below c`, `between a and b` — puts a
 * point it has to pass through.
 */
function jointedLine(
  edge: LayoutEdge,
  ends: EdgeEnds,
  route: Route | undefined,
  nodes: LayoutNode[],
  textWidth: number,
): { points: Point[]; mid: Point } {
  const { start, end } = ends;
  const square = edge.look.path === 'square';
  const stub = ROUTE_RADIUS + arrowLength(edge.look.thickness);
  const fromFace = faceOf(edge.from);
  const toFace = faceOf(edge.to);

  if (route) {
    if (square) return { points: route.points, mid: route.mid };
    if (textWidth === 0) {
      const points = straighten(route.points, edge, nodes);
      return { points, mid: textSpot(points, textWidth) };
    }
    // The route pushed its run out far enough to hold the text clear of the
    // boxes it passes, and that room is only on the run. So a straight line
    // with a text keeps the text's point and straightens either side of it;
    // cutting across the run would put the text back against the box.
    const [before, after] = splitAt(route.points, route.mid);
    const points = tidyRoute([
      ...straighten(before, edge, nodes),
      ...straighten(after, edge, nodes).slice(1),
    ]);
    return { points, mid: route.mid };
  }

  const bow = ends.bow ?? { x: 0, y: 0 };
  const bowed = bow.x !== 0 || bow.y !== 0;
  if (!square) {
    // A bowed line is one of a crowded group, and its middle is the only room
    // left for its text, so it bends there.
    const middle = { x: (start.x + end.x) / 2 + bow.x, y: (start.y + end.y) / 2 + bow.y };
    const points = bowed ? [start, middle, end] : [start, end];
    return { points, mid: bowed ? middle : textSpot(points, textWidth) };
  }

  const out = headingOf(start, fromFace);
  const back = headingOf(end, toFace);
  // A bow is room for the texts of a crowded group, taken in the middle. Between
  // sides that face each other that middle is a run the lanes can widen along;
  // at right angles there is none, and the text finds room on a level piece.
  if (!bowed || (out.x !== 0) !== (back.x !== 0)) {
    const points = tidyRoute(rightAngles(start, out, end, back, stub));
    return { points, mid: textSpot(points, textWidth) };
  }
  // Out of each side, across by the bow, and joined at right angles.
  const a = { x: start.x + out.x * stub, y: start.y + out.y * stub };
  const b = { x: end.x + back.x * stub, y: end.y + back.y * stub };
  const points = tidyRoute(squareUp([start, a, { x: a.x + bow.x, y: a.y + bow.y }, { x: b.x + bow.x, y: b.y + bow.y }, b, end]));
  return { points, mid: textSpot(points, textWidth) };
}

/**
 * Which way an end points, as one of the four directions. A named side says so;
 * an end the renderer placed is on some side of its box, and that is the one.
 */
function headingOf(anchor: Anchor, face: Box): Point {
  if (anchor.side !== undefined) return { x: anchor.tx, y: anchor.ty };
  const candidates: [number, Point][] = [
    [Math.abs(anchor.x - face.x), { x: -1, y: 0 }],
    [Math.abs(anchor.x - (face.x + face.width)), { x: 1, y: 0 }],
    [Math.abs(anchor.y - face.y), { x: 0, y: -1 }],
    [Math.abs(anchor.y - (face.y + face.height)), { x: 0, y: 1 }],
  ];
  candidates.sort((p, q) => p[0] - q[0]);
  return candidates[0]![1];
}

/**
 * A right-angled line from `from`, leaving along `out`, to `to`, arriving
 * against `back` — `back` points out of the far side, so the line's last piece
 * travels the opposite way. The fewest turns that leave and arrive head-on:
 * none when the two face each other in line, one when they are at right angles
 * and the corner lies ahead of both, two in the middle when they face each
 * other offset, and a way round past a stub at each end otherwise.
 */
function rightAngles(from: Point, out: Point, to: Point, back: Point, stub: number): Point[] {
  const across = out.x !== 0;
  const parallel = across === (back.x !== 0);
  const ahead = (p: Point, q: Point, d: Point): number => (q.x - p.x) * d.x + (q.y - p.y) * d.y;

  if (parallel) {
    const facing = out.x * back.x + out.y * back.y < 0;
    if (facing && ahead(from, to, out) > 0) {
      if (Math.abs(across ? to.y - from.y : to.x - from.x) < 0.5) return [from, to];
      const m = across ? (from.x + to.x) / 2 : (from.y + to.y) / 2;
      return across
        ? [from, { x: m, y: from.y }, { x: m, y: to.y }, to]
        : [from, { x: from.x, y: m }, { x: to.x, y: m }, to];
    }
    if (!facing) {
      // Both sides face the same way: out past whichever is further, and back.
      const far = across
        ? (out.x > 0 ? Math.max(from.x, to.x) : Math.min(from.x, to.x)) + out.x * stub
        : (out.y > 0 ? Math.max(from.y, to.y) : Math.min(from.y, to.y)) + out.y * stub;
      return across
        ? [from, { x: far, y: from.y }, { x: far, y: to.y }, to]
        : [from, { x: from.x, y: far }, { x: to.x, y: far }, to];
    }
    // Facing, but the far end is behind: out, across the middle, and in.
    const a = { x: from.x + out.x * stub, y: from.y + out.y * stub };
    const b = { x: to.x + back.x * stub, y: to.y + back.y * stub };
    const m = across ? (from.y + to.y) / 2 : (from.x + to.x) / 2;
    return across
      ? [from, a, { x: a.x, y: m }, { x: b.x, y: m }, b, to]
      : [from, a, { x: m, y: a.y }, { x: m, y: b.y }, b, to];
  }

  const corner = across ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  if (ahead(from, corner, out) > 0 && ahead(to, corner, back) > 0) return [from, corner, to];
  // The one corner lies behind an end: step out of both sides first and join
  // the two stubs with whichever corner does not double back.
  const a = { x: from.x + out.x * stub, y: from.y + out.y * stub };
  const b = { x: to.x + back.x * stub, y: to.y + back.y * stub };
  const options = [
    { x: b.x, y: a.y },
    { x: a.x, y: b.y },
  ];
  const turn =
    options.find((c) => ahead(a, c, out) >= 0 && ahead(b, c, back) >= 0) ?? options[across ? 1 : 0]!;
  return [from, a, turn, b, to];
}

/** Put a right-angled corner between any two points that are not in line. */
function squareUp(points: Point[]): Point[] {
  const out: Point[] = [points[0]!];
  let alongX = true;
  for (let index = 1; index < points.length; index += 1) {
    const a = out[out.length - 1]!;
    const b = points[index]!;
    const dx = Math.abs(b.x - a.x) >= 0.5;
    const dy = Math.abs(b.y - a.y) >= 0.5;
    if (dx && dy) {
      out.push(alongX ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    } else if (dx || dy) {
      alongX = dx;
    }
    out.push(b);
  }
  return out;
}

/**
 * A route's points with every corner dropped that a straight piece can skip.
 * The route already keeps each clause; a straight piece may cut a corner only
 * where it stays clear of every box the route kept clear of, which keeps the
 * clauses too — a piece between two points below a node, touching nothing, is
 * below it all the way.
 */
function straighten(points: Point[], edge: LayoutEdge, nodes: LayoutNode[]): Point[] {
  const own = [faceOf(edge.from), faceOf(edge.to)].map((box) => grow(extentOfBox(box), -1));
  const others = nodes
    .filter((node) => !contains(node, edge.from) && !contains(node, edge.to))
    .map((node) => grow(extentOfBox(faceOf(node)), ATTACH_MARGIN / 2));
  const clear = (a: Point, b: Point): boolean =>
    ![...own, ...others].some((box) => segmentHits(a, b, box));

  const kept = [points[0]!];
  let at = 0;
  while (at < points.length - 1) {
    let next = at + 1;
    for (let far = points.length - 1; far > at + 1; far -= 1) {
      if (clear(points[at]!, points[far]!)) {
        next = far;
        break;
      }
    }
    kept.push(points[next]!);
    at = next;
  }
  return kept;
}

/**
 * A line cut in two at `at`, a point on one of its pieces, each half keeping
 * `at` as its end. A point on no piece cuts at the nearest one.
 */
function splitAt(points: Point[], at: Point): [Point[], Point[]] {
  let piece = 0;
  let nearest = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1,
      ((at.x - a.x) * (b.x - a.x) + (at.y - a.y) * (b.y - a.y)) / (length * length)));
    const off = Math.hypot(a.x + t * (b.x - a.x) - at.x, a.y + t * (b.y - a.y) - at.y);
    if (off < nearest) {
      nearest = off;
      piece = index;
    }
  }
  return [
    tidyRoute([...points.slice(0, piece), at]),
    tidyRoute([at, ...points.slice(piece)]),
  ];
}

function extentOfBox(box: Box): Extent {
  return { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height };
}

/** Whether the segment from `a` to `b` passes through the inside of `box`. */
function segmentHits(a: Point, b: Point, box: Extent): boolean {
  if (box.maxX <= box.minX || box.maxY <= box.minY) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dy, a.y - box.minY],
    [dy, box.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
}

/**
 * Where a jointed line's text rides: the middle of its longest level piece, if
 * one is long enough to hold the text with line showing either side, and the
 * middle of its longest piece otherwise. A level piece comes first because a
 * text knocks a hole as wide as itself, which on an upright piece is a hole far
 * wider than the line — and lines grouped on one side sit a text's height apart
 * on their level pieces, never a text's width apart on their upright ones.
 */
function textSpot(points: Point[], textWidth: number): Point {
  let best = { x: (points[0]!.x + points[points.length - 1]!.x) / 2, y: (points[0]!.y + points[points.length - 1]!.y) / 2 };
  let level: Point | undefined;
  let longest = -1;
  let longestLevel = -1;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const here = Math.hypot(b.x - a.x, b.y - a.y);
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (here > longest + 0.5) {
      longest = here;
      best = middle;
    }
    if (Math.abs(b.y - a.y) < 0.5 && here >= textWidth + ARROW_LENGTH * 2 && here > longestLevel + 0.5) {
      longestLevel = here;
      level = middle;
    }
  }
  return level ?? best;
}

function sharpPath(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`).join(' ');
}

/**
 * A drawn line's element read back as a polyline, curves flattened. Reading
 * the element rather than each drawing branch keeping its own record means the
 * crossings are found on exactly what was drawn.
 */
function traceOf(element: string): Point[] {
  const line = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/.exec(element);
  if (line) {
    return [
      { x: Number(line[1]), y: Number(line[2]) },
      { x: Number(line[3]), y: Number(line[4]) },
    ];
  }
  const d = /d="([^"]*)"/.exec(element)?.[1] ?? '';
  const tokens = d.match(/[MLC]|-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? [];
  const points: Point[] = [];
  let command = 'M';
  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index]!;
    if (/[MLC]/.test(token)) {
      command = token;
      index += 1;
      continue;
    }
    const read = (): Point => {
      const point = { x: Number(tokens[index]), y: Number(tokens[index + 1]) };
      index += 2;
      return point;
    };
    if (command === 'C') {
      const from = points[points.length - 1]!;
      const [c1, c2, to] = [read(), read(), read()];
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        const u = 1 - t;
        points.push({
          x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
          y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
        });
      }
    } else {
      points.push(read());
    }
  }
  return points;
}

// --- crossings ------------------------------------------------------------------

/** Where one line crosses an earlier one, and which way it is heading there. */
interface Crossing {
  at: Point;
  along: Point;
  /** Half the length of line the crossing takes out. */
  reach: number;
}

/**
 * Where each line with a `crossing:` style crosses a line declared before it.
 * The later line is the one that jumps, so the file's order says who goes over,
 * and a line never jumps where it leaves or arrives — a crossing that close to
 * an end is two lines meeting at a box, not passing each other.
 */
function findCrossings(drawn: DrawnEdge[]): Map<DrawnEdge, Crossing[]> {
  const found = new Map<DrawnEdge, Crossing[]>();
  drawn.forEach((later, index) => {
    if (later.edge.look.crossing === 'none') return;
    const crossings: Crossing[] = [];
    for (const earlier of drawn.slice(0, index)) {
      const reach = 3 + later.edge.look.thickness * 1.5 + earlier.edge.look.thickness / 2;
      const clear = reach + arrowLength(later.edge.look.thickness);
      const ends = [later.trace[0]!, later.trace[later.trace.length - 1]!, earlier.trace[0]!, earlier.trace[earlier.trace.length - 1]!];
      for (let i = 1; i < later.trace.length; i += 1) {
        const a = later.trace[i - 1]!;
        const b = later.trace[i]!;
        for (let j = 1; j < earlier.trace.length; j += 1) {
          const at = intersect(a, b, earlier.trace[j - 1]!, earlier.trace[j]!);
          if (!at) continue;
          if (ends.some((end) => Math.hypot(end.x - at.x, end.y - at.y) < clear)) continue;
          if (crossings.some((c) => Math.hypot(c.at.x - at.x, c.at.y - at.y) < (c.reach + reach) * 1.2)) continue;
          const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          crossings.push({ at, along: { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, reach });
        }
      }
    }
    if (crossings.length > 0) found.set(later, crossings);
  });
  return found;
}

/** Where two segments cross, if they do. Lines that only touch or run together do not. */
function intersect(a: Point, b: Point, c: Point, d: Point): Point | undefined {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return undefined;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/**
 * The jump drawn over one crossing: a half circle for `arc`, three sides of a
 * square for `square`, and nothing for `gap`, which is the cut alone. A jump
 * rises to the same side everywhere — up, or right on a line going straight up
 * or down — so a row of them reads as one line hopping.
 */
function jumpAt(crossing: Crossing, style: LineLook['crossing']): string | undefined {
  const { at, along, reach } = crossing;
  let normal = { x: along.y, y: -along.x };
  if (normal.y > 1e-6 || (Math.abs(normal.y) <= 1e-6 && normal.x < 0)) normal = { x: -normal.x, y: -normal.y };
  const a = { x: at.x - along.x * reach, y: at.y - along.y * reach };
  const b = { x: at.x + along.x * reach, y: at.y + along.y * reach };
  if (style === 'arc') {
    // Which way round the arc sweeps depends on which side of the line is up.
    const sweep = along.x * normal.y - along.y * normal.x < 0 ? 1 : 0;
    return `M ${round(a.x)} ${round(a.y)} A ${round(reach)} ${round(reach)} 0 0 ${sweep} ${round(b.x)} ${round(b.y)}`;
  }
  if (style === 'square') {
    const up = (p: Point): Point => ({ x: p.x + normal.x * reach, y: p.y + normal.y * reach });
    return sharpPath([a, up(a), up(b), b]);
  }
  return undefined;
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
  if (box.round) {
    const scale = box.width / 2 / Math.hypot(dx, dy);
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }
  if (box.pointed) {
    const scale = 1 / (Math.abs(dx) / (box.width / 2) + Math.abs(dy) / (box.height / 2));
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }

  const scaleX = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return ontoCaps(box, center, { x: dx, y: dy }, { x: center.x + dx * scale, y: center.y + dy * scale });
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
 * A `between` edge is left out. Its way through the gap it named, lane
 * included, is searched for in `planWays`, which picks a side for any end
 * naming none.
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
  if (face.round) return anchorOnCircle(face, side, at);
  if (face.pointed) return anchorOnDiamond(face, side, at);
  if (face.caps) return anchorOnCaps(face, side, at);
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

/**
 * The same, on a circle: a side is the quarter of the circle around its
 * compass point, and `at` is walked round the arc rather than along a
 * straight edge, so points spaced a step apart on a side are a step apart on
 * the circle too. The line meets the circle square on, heading from its center.
 */
function anchorOnCircle(face: Box, side: AttachSide, at: number): Anchor {
  const radius = face.width / 2;
  const center = centerOf(face);
  const across = side === 'top' || side === 'bottom' ? at - center.x : at - center.y;
  const turn = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, across / radius));
  // SVG's y runs down, so the bottom is a quarter-turn clockwise from the right.
  const angle = {
    right: turn,
    bottom: Math.PI / 2 - turn,
    left: Math.PI - turn,
    top: -Math.PI / 2 + turn,
  }[side];
  const tx = Math.cos(angle);
  const ty = Math.sin(angle);
  return { x: center.x + radius * tx, y: center.y + radius * ty, tx, ty, side };
}

/**
 * The same, on a diamond: a side is its point, and `at` slides along the two
 * edges meeting there, so points spaced a step apart across a side stay a step
 * apart. The line leaves square to the side, as from a rectangle, which keeps
 * it clear of the diamond on its way out.
 */
function anchorOnDiamond(face: Box, side: AttachSide, at: number): Anchor {
  const center = centerOf(face);
  const halfW = face.width / 2;
  const halfH = face.height / 2;
  if (side === 'top' || side === 'bottom') {
    const x = Math.max(face.x, Math.min(face.x + face.width, at));
    const reach = halfH * (1 - Math.abs(x - center.x) / halfW);
    const down = side === 'bottom' ? 1 : -1;
    return { x, y: center.y + down * reach, tx: 0, ty: down, side };
  }
  const y = Math.max(face.y, Math.min(face.y + face.height, at));
  const reach = halfW * (1 - Math.abs(y - center.y) / halfH);
  const right = side === 'right' ? 1 : -1;
  return { x: center.x + right * reach, y, tx: right, ty: 0, side };
}

/**
 * The same, on a box with rounded ends: the point on the border straight out
 * from `at`, which on a rounded end is on its curve. The line still leaves
 * square to the side.
 */
function anchorOnCaps(face: Box, side: AttachSide, at: number): Anchor {
  const flat = anchorOn({ ...face, caps: undefined }, side, at);
  const { left, right } = face.caps!;
  const radius = face.height / 2;
  const cy = face.y + radius;
  if (side === 'top' || side === 'bottom') {
    const cx =
      flat.x < face.x + left
        ? face.x + left
        : flat.x > face.x + face.width - right
          ? face.x + face.width - right
          : undefined;
    if (cx === undefined) return flat;
    const reach = Math.sqrt(Math.max(0, radius * radius - (flat.x - cx) ** 2));
    return { ...flat, y: cy + (side === 'bottom' ? reach : -reach) };
  }
  const cap = side === 'left' ? left : right;
  if (cap === 0) return flat;
  const reach = Math.sqrt(Math.max(0, radius * radius - (flat.y - cy) ** 2));
  const cx = side === 'left' ? face.x + radius : face.x + face.width - radius;
  return { ...flat, x: cx + (side === 'right' ? reach : -reach) };
}

/**
 * Move a point found on a box's rectangle onto its rounded end, when it falls
 * beside one: where the ray from `from` along `dir` leaves that end's circle.
 */
function ontoCaps(
  box: Box,
  from: { x: number; y: number },
  dir: { x: number; y: number },
  point: { x: number; y: number },
): { x: number; y: number } {
  if (!box.caps) return point;
  const radius = box.height / 2;
  const cx =
    point.x < box.x + box.caps.left
      ? box.x + radius
      : point.x > box.x + box.width - box.caps.right
        ? box.x + box.width - radius
        : undefined;
  if (cx === undefined) return point;
  const px = from.x - cx;
  const py = from.y - (box.y + radius);
  const a = dir.x * dir.x + dir.y * dir.y;
  const b = px * dir.x + py * dir.y;
  const reach = b * b - a * (px * px + py * py - radius * radius);
  if (a === 0 || reach < 0) return point;
  const t = Math.max(0, (-b + Math.sqrt(reach)) / a);
  return { x: from.x + dir.x * t, y: from.y + dir.y * t };
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
  if (box.round) {
    // Where the ray leaves the circle: the larger root of |p + t·dir − c| = r.
    const center = centerOf(box);
    const px = x - center.x;
    const py = y - center.y;
    const a = dir.x * dir.x + dir.y * dir.y;
    const b = px * dir.x + py * dir.y;
    const c = px * px + py * py - (box.width / 2) ** 2;
    const reach = b * b - a * c;
    if (a === 0 || reach < 0) return { x, y };
    const t = Math.max(0, (-b + Math.sqrt(reach)) / a);
    return { x: x + dir.x * t, y: y + dir.y * t };
  }
  if (box.pointed) {
    // Where the ray leaves the first of the four edges it heads out through.
    const center = centerOf(box);
    const px = x - center.x;
    const py = y - center.y;
    let t = Infinity;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const along = (sx * dir.x) / (box.width / 2) + (sy * dir.y) / (box.height / 2);
        if (along <= 0) continue;
        const left = 1 - (sx * px) / (box.width / 2) - (sy * py) / (box.height / 2);
        t = Math.min(t, left / along);
      }
    }
    if (!Number.isFinite(t)) return { x, y };
    return { x: x + dir.x * Math.max(0, t), y: y + dir.y * Math.max(0, t) };
  }
  const tx = dir.x === 0 ? Infinity : ((dir.x > 0 ? box.x + box.width : box.x) - x) / dir.x;
  const ty = dir.y === 0 ? Infinity : ((dir.y > 0 ? box.y + box.height : box.y) - y) / dir.y;
  const t = Math.min(tx, ty);
  if (!Number.isFinite(t)) return { x, y };
  return ontoCaps(box, { x, y }, dir, { x: x + dir.x * Math.max(0, t), y: y + dir.y * Math.max(0, t) });
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
  /** The gap on that axis, from the nearer node's edge to the further one's. */
  lo: number;
  hi: number;
  /**
   * Where on the other axis the line has to cross the gap: the middle of the
   * stretch where the two nodes face each other, or of the space between them
   * where they sit diagonally. Which lane the line takes is the search's.
   */
  at: number;
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
 * The gap each `between` edge named, and where along it the line must cross.
 *
 * Only the gap: which lane a line takes through it, and how far it keeps from
 * the others there, is the search's, as it is for every line (see `planWays`).
 */
function planCorridors(
  edges: LayoutEdge[],
  ends: Map<LayoutEdge, EdgeEnds>,
): Map<LayoutEdge, Corridor> {
  const plans = new Map<LayoutEdge, Corridor>();
  for (const edge of edges) {
    if (!edge.between) continue;
    const [first, second] = edge.between.nodes;
    const a = faceOf(first);
    const b = faceOf(second);
    const gap = gapBetween(a, b, first.name, second.name, edge.between.axis, edge.line);
    const run: Axis = gap.axis === 'y' ? 'x' : 'y';
    // The line passes the pair only if its own ends reach past their extent.
    const { start, end } = ends.get(edge)!;
    if (Math.min(gap.across[1], Math.max(start[run], end[run])) <= Math.max(gap.across[0], Math.min(start[run], end[run]))) {
      throw new SourceError(`this edge never passes between "${first.name}" and "${second.name}"`, edge.line);
    }
    // Where the two face each other, the middle of that; where they sit
    // diagonally, the middle of the space between them.
    const near = Math.max(lo(a, run), lo(b, run));
    const far = Math.min(hi(a, run), hi(b, run));
    plans.set(edge, { axis: gap.axis, lo: gap.lo, hi: gap.hi, at: (near + far) / 2 });
  }
  return plans;
}

/**
 * Every line takes the shortest sensible way between its ends, and a way
 * through a box is not sensible. Where the direct line — the fewest turns that
 * leave and arrive head-on, or a plain straight line when no side is named — is
 * clear of every box, that is the shortest way and it is kept as it is drawn
 * today. Where it is not, the way is searched for through the open space (see
 * `search.ts`), and the line is drawn along what was found.
 *
 * A line with clauses is the same line with rules added. `below m` fences off
 * everything above M within M's width (see `fenceOf`), and the direct line is
 * kept only if it keeps clear of the fences as well as the boxes; otherwise
 * the search goes round them as it goes round a box. A `between` line must pass
 * through the gap it names: the search carries the gap as a gate, and finds
 * its lane there with the rest of its way. A clause line whose shortest way
 * never reaches the side a clause names is sent through a point on that side,
 * searched for in legs into and out of it (see `clauseGate`).
 *
 * Lines searched for are placed shortest first, and each later one keeps a lane
 * clear of those already placed where they share a stretch, so a longer line
 * nests outside a shorter one rather than drawing on top of it. Two lines that
 * cross are then placed again the other way round, and kept so if they cross
 * less.
 */
function planWays(
  edges: LayoutEdge[],
  nodes: LayoutNode[],
  ends: Map<LayoutEdge, EdgeEnds>,
  corridors: Map<LayoutEdge, Corridor>,
  measurer: Measurer,
  fontSize: number,
): Map<LayoutEdge, Route> {
  const routes = new Map<LayoutEdge, Route>();
  const wanted: LayoutEdge[] = [];
  // Direct lines that turn twice, across a gap in its middle.
  const turning: { edge: LayoutEdge; points: Point[] }[] = [];
  for (const edge of edges) {
    if (corridors.has(edge)) {
      wanted.push(edge);
      continue;
    }
    // A line from a container to something inside it lives inside the box it
    // leaves, and has no way round anything.
    if (!edge.passes && edge.from !== edge.to && (contains(edge.from, edge.to) || contains(edge.to, edge.from))) continue;
    const plan = ends.get(edge)!;
    // A fence is checked at the box's own edge here, not grown: a line leaving
    // M's bottom with `below m` starts on the fence's border, not inside it.
    const boxes = [...obstaclesFor(edge, nodes), ...(edge.passes ?? []).map((pass) => fenceOf(pass, 0))];
    const { start, end } = plan;
    if (start.side !== undefined && end.side !== undefined) {
      const direct = directWay(start, end);
      if (direct && wayClear(direct, boxes) && passesAll(edge, direct)) {
        // The curve is the direct way with its turns swept, and is kept — unless
        // it bulges into a box the direct way clears, when the way is drawn.
        if (edge.passes || (edge.look.path === 'curved' && curveHits(edge, plan, boxes))) {
          routes.set(edge, { points: direct, mid: textOnWay(direct, edge, nodes, measurer, fontSize) });
        }
        if (direct.length === 4) turning.push({ edge, points: direct });
        continue;
      }
    } else if (start.side === undefined && end.side === undefined) {
      if (wayClear([start, end], boxes) && passesAll(edge, [start, end])) continue;
    } else if (!curveHits(edge, plan, boxes) && passesAll(edge, curveTrace(edge, plan))) {
      continue;
    }
    wanted.push(edge);
  }
  shareGaps(turning, routes, nodes, measurer, fontSize);

  const reach = (edge: LayoutEdge): number => {
    const { start, end } = ends.get(edge)!;
    return Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  };
  wanted.sort((p, q) => reach(p) - reach(q));
  // Lines between the same two sides, told the same things, go the same way
  // round, and the one placed first takes the inside lane. So the one whose end
  // sits furthest the way the line turns goes first: out of a left side and
  // down, the lowest end takes the inside, and none of them crosses another.
  const sameWay = (edge: LayoutEdge): string => {
    const { start, end } = ends.get(edge)!;
    return [
      edge.from.name, edge.to.name, start.side, end.side, start.tx, start.ty, end.tx, end.ty,
      corridors.has(edge) ? 'between' : '',
      ...(edge.passes ?? []).map((pass) => pass.written),
    ].join(' ');
  };
  // Each line of such a group after the first, and the line it is drawn as a
  // copy of: the one a lane inside it.
  const copies = new Map<LayoutEdge, LayoutEdge>();
  for (let index = 0; index < wanted.length; index += 1) {
    const key = sameWay(wanted[index]!);
    const group = wanted.filter((edge) => sameWay(edge) === key);
    if (group.length < 2 || group[0] !== wanted[index] || corridors.has(group[0]!)) continue;
    const trial = searchWay(group[0]!, nodes, ends.get(group[0]!)!.start, group[0]!.from, ends.get(group[0]!)!.end, group[0]!.to, [], ATTACH_STEP);
    if (!trial || trial.points.length < 3) continue;
    const [, bend, after] = trial.points as [Point, Point, Point];
    const turn = { x: Math.sign(after.x - bend.x), y: Math.sign(after.y - bend.y) };
    const ordered = [...group].sort((p, q) => {
      const a = ends.get(p)!.start;
      const b = ends.get(q)!.start;
      return (b.x - a.x) * turn.x + (b.y - a.y) * turn.y;
    });
    const rest = wanted.filter((edge) => !group.includes(edge));
    rest.splice(index, 0, ...ordered);
    wanted.splice(0, wanted.length, ...rest);
    index += group.length - 1;
    // A text widens the lane it rides in, which a copy cannot know; those are searched.
    const named = (edge: LayoutEdge): boolean => {
      const { start, end } = ends.get(edge)!;
      return start.side !== undefined && end.side !== undefined;
    };
    if (ordered.every((edge) => edge.lines === undefined && named(edge))) {
      ordered.slice(1).forEach((edge, at) => copies.set(edge, ordered[at]!));
    }
  }
  // Where several lines leave one side, their ends may be squeezed closer than
  // a lane; the lines then run out of them that close together, and the lanes
  // beyond keep the same spacing, so they nest rather than finding no room.
  const attached: { node: LayoutNode; edge: LayoutEdge; anchor: Anchor }[] = [];
  for (const [edge, { start, end }] of ends) {
    attached.push({ node: edge.from, edge, anchor: start }, { node: edge.to, edge, anchor: end });
  }
  const laneFor = (edge: LayoutEdge): number => {
    const { start, end } = ends.get(edge)!;
    let lane = ATTACH_STEP;
    for (const [node, anchor] of [[edge.from, start], [edge.to, end]] as const) {
      for (const other of attached) {
        if (other.edge === edge || other.node !== node) continue;
        if (other.anchor.tx !== anchor.tx || other.anchor.ty !== anchor.ty) continue;
        const apart = Math.hypot(other.anchor.x - anchor.x, other.anchor.y - anchor.y);
        if (apart > 0.5) lane = Math.min(lane, apart);
      }
    }
    return lane;
  };
  // The ends as planned, before a search chose a side for any end naming none,
  // so a line placed again chooses afresh.
  const planned = new Map(ends);
  const found = new Map<LayoutEdge, { start: Anchor; end: Anchor; points: Point[]; mid: Point }>();
  // For a placed line, per stretch, half the depth across it of its text where
  // the text rides, so a line beside that stretch keeps clear of the words.
  const halvesOf = (other: LayoutEdge): number[] => {
    const { points, mid } = found.get(other)!;
    return points.slice(1).map((q, index) => {
      const p = points[index]!;
      if (other.lines === undefined) return 0;
      const level = Math.abs(p.y - q.y) < 0.5;
      const on = level
        ? Math.abs(mid.y - p.y) < 0.5 && mid.x >= Math.min(p.x, q.x) - 0.5 && mid.x <= Math.max(p.x, q.x) + 0.5
        : Math.abs(mid.x - p.x) < 0.5 && mid.y >= Math.min(p.y, q.y) - 0.5 && mid.y <= Math.max(p.y, q.y) + 0.5;
      return on ? laneExtent(other, level ? 'y' : 'x', measurer, fontSize) / 2 : 0;
    });
  };
  const place = (edge: LayoutEdge, placed: LayoutEdge[]): { start: Anchor; end: Anchor; points: Point[]; mid: Point } => {
    const plan = planned.get(edge)!;
    const lane = laneFor(edge);
    const taken = placed.map((other) => found.get(other)!.points);
    const takenHalves = placed.map(halvesOf);
    const used = [...ends].flatMap(([other, { start, end }]) =>
      other === edge ? [] : [{ node: other.from, anchor: start }, { node: other.to, anchor: end }],
    );
    // The way through a run of stops in order, each a straight stretch entered
    // heading along it and left the same way; each leg between them is
    // searched on its own, with a straight stretch into and out of every stop.
    const through = (stops: { enter: Point; leave: Point; run: Point }[]): { start: Anchor; end: Anchor; points: Point[] } | undefined => {
      let from = plan.start;
      let fromNode: LayoutNode | undefined = edge.from;
      let first: Anchor | undefined;
      const points: Point[] = [];
      for (const { enter, leave, run } of stops) {
        const leg = searchWay(edge, nodes, from, fromNode, { x: enter.x, y: enter.y, tx: -run.x, ty: -run.y }, undefined, taken, lane, used, { takenHalves });
        if (!leg) return undefined;
        first ??= leg.start;
        points.push(...leg.points);
        from = { x: leave.x, y: leave.y, tx: run.x, ty: run.y };
        fromNode = undefined;
      }
      const last = searchWay(edge, nodes, from, fromNode, plan.end, edge.to, taken, lane, used, { takenHalves });
      if (!last) return undefined;
      return { start: first ?? last.start, end: last.end, points: tidyRoute([...points, ...last.points]) };
    };

    const corridor = corridors.get(edge);
    let way: { start: Anchor; end: Anchor; points: Point[] } | undefined;
    let mid: Point | undefined;
    if (corridor) {
      // Somewhere along its way the line crosses the gap, travelling along it;
      // which lane it takes there is found with the rest of the way, and its
      // text, which rides in the gap, keeps the lines beside it clear.
      const run: Axis = corridor.axis === 'y' ? 'x' : 'y';
      const gate: SearchGate = { run, at: corridor.at, lo: corridor.lo, hi: corridor.hi };
      const ownHalf = laneExtent(edge, corridor.axis, measurer, fontSize) / 2;
      way = searchWay(edge, nodes, plan.start, edge.from, plan.end, edge.to, taken, lane, used, { gate, ownHalf, takenHalves });
      if (!way) throw new SourceError(gateMessage(edge, corridor, nodes), edge.line);
      mid = gateCrossing(way.points, gate);
    } else {
      way = searchWay(edge, nodes, plan.start, edge.from, plan.end, edge.to, taken, lane, used, { takenHalves });
      if (!way) throw new SourceError(edge.passes ? clauseMessage(edge, edge.passes) : blockedMessage(edge, plan, nodes), edge.line);
      if (!passesAll(edge, way.points)) {
        // The shortest way keeps clear of every fence without ever coming round
        // to the side a clause names — a line leaving a node that sits over M,
        // told to pass below M, can simply leave sideways. It is sent through a
        // point on that side of each clause it missed, in the order they lie
        // along its way.
        const missed = edge.passes!.filter((pass) => !alongside(way!.points, pass));
        const gates = missed.map((pass) => clauseGate(pass, plan.start, plan.end));
        if (gates.some((gate) => gate === undefined)) {
          throw new SourceError(neverPassesMessage(edge, way.points), edge.line);
        }
        const travel = { x: plan.end.x - plan.start.x, y: plan.end.y - plan.start.y };
        const stops = gates
          .map((gate) => gate!)
          .sort((p, q) => (p.at.x - q.at.x) * travel.x + (p.at.y - q.at.y) * travel.y)
          .map(({ at, run }) => ({ enter: at, leave: at, run }));
        way = through(stops);
        if (!way) throw new SourceError(clauseMessage(edge, edge.passes!), edge.line);
        if (!passesAll(edge, way.points)) throw new SourceError(neverPassesMessage(edge, way.points), edge.line);
      }
    }
    return { ...way, mid: mid ?? textOnWay(way.points, edge, nodes, measurer, fontSize) };
  };

  const order: LayoutEdge[] = [];
  const settle = (edge: LayoutEdge, way: { start: Anchor; end: Anchor; points: Point[]; mid: Point }): void => {
    found.set(edge, way);
    ends.set(edge, { start: way.start, end: way.end });
  };
  // A line identical to one already placed is that line moved out by a lane,
  // not a search of its own: the same way, every stretch shifted to the same
  // side by the distance between their ends. Searching each afresh, keeping
  // clear of every copy before it, made fifteen identical lines take as long as
  // a tangled diagram. Where the copy would not do — its ends do not line up
  // with the shift, a stretch folds up, it meets a box, crowds or crosses a line
  // the first does not — the line is searched for as any other.
  const copyOf = (edge: LayoutEdge, inside: LayoutEdge, placed: LayoutEdge[]): { start: Anchor; end: Anchor; points: Point[]; mid: Point } | undefined => {
    const { start, end } = planned.get(edge)!;
    const base = found.get(inside)!.points;
    const count = base.length - 1;
    if (count < 1) return undefined;
    const heading = base.slice(1).map((q, index) => {
      const p = base[index]!;
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      return { x: (q.x - p.x) / length, y: (q.y - p.y) / length, length };
    });
    if (heading.some((one) => one.length < 0.5 || (Math.abs(one.x) > 1e-6 && Math.abs(one.y) > 1e-6))) return undefined;
    const normal = heading.map((one) => ({ x: -one.y, y: one.x }));
    const along = (from: Point, to: Point, axis: Point): number => (to.x - from.x) * axis.x + (to.y - from.y) * axis.y;
    const shift = along(base[0]!, start, normal[0]!);
    // Any shift will do, however small: where more lines leave a side than it
    // has room for, their ends sit under half a pixel apart, and refusing those
    // sent fifty-six copies to the search and took seconds.
    if (Math.abs(shift) < 1e-6 || Math.abs(along(base[0]!, start, heading[0]!)) > 0.5) return undefined;
    if (Math.abs(along(base[count]!, end, normal[count - 1]!) - shift) > 0.5 || Math.abs(along(base[count]!, end, heading[count - 1]!)) > 0.5) {
      return undefined;
    }
    const points: Point[] = [{ x: start.x, y: start.y }];
    for (let index = 1; index < count; index += 1) {
      const [p, q] = [normal[index - 1]!, normal[index]!];
      const turns = Math.abs(p.x * q.x + p.y * q.y) < 0.5;
      const v = base[index]!;
      points.push(turns ? { x: v.x + shift * (p.x + q.x), y: v.y + shift * (p.y + q.y) } : { x: v.x + shift * q.x, y: v.y + shift * q.y });
    }
    points.push({ x: end.x, y: end.y });
    for (let index = 0; index < count; index += 1) {
      const [p, q] = [points[index]!, points[index + 1]!];
      if (along(p, q, heading[index]!) < 0.5) return undefined;
    }
    const inner = points.slice(1, -1);
    const walls = nodes
      .filter((node) => !contains(node, edge.from) && !contains(node, edge.to))
      .map((node) => grow(extentOfBox(faceOf(node)), ATTACH_MARGIN - 0.5));
    const own = [edge.from, edge.to].map((node) => grow(extentOfBox(faceOf(node)), ATTACH_MARGIN - 0.5));
    const fences = (edge.passes ?? []).map((pass) => fenceOf(pass, 0));
    if (!wayClear(points, [...obstaclesFor(edge, nodes), ...walls]) || !wayClear(inner, [...own, ...fences]) || !passesAll(edge, points)) {
      return undefined;
    }
    const lane = laneFor(edge);
    for (const other of placed) {
      const theirs = found.get(other)!.points;
      if (linesCross(points, theirs) > linesCross(base, theirs)) return undefined;
      if (other !== inside && crowds(points, theirs, lane)) return undefined;
    }
    return { start, end, points, mid: textOnWay(points, edge, nodes, measurer, fontSize) };
  };
  for (const edge of wanted) {
    const inside = copies.get(edge);
    const copy = inside && found.has(inside) ? copyOf(edge, inside, [...order]) : undefined;
    settle(edge, copy ?? place(edge, [...order]));
    order.push(edge);
  }

  // Which line takes the inside of a shared stretch depends on which was placed
  // first, and the wrong order makes two lines cross where they need not. So a
  // pair that crosses is placed again the other way round, and kept that way if
  // it crosses less. This is tidying, not a promise: the pairs are tried a
  // fixed number of times over, however tangled the diagram, since trying every
  // pair that crossed made a diagram of forty lines take minutes. A count, not a
  // clock, so a file draws the same on every machine. A writer who wants a line
  // somewhere in particular says so.
  const crossingsOf = (edge: LayoutEdge): number =>
    order.reduce((sum, other) => (other === edge ? sum : sum + linesCross(found.get(edge)!.points, found.get(other)!.points)), 0);
  let tries = order.length * UNCROSS_TRIES;
  for (let pass = 0; pass < 3 && tries > 0; pass += 1) {
    let better = false;
    for (let i = 0; i < order.length && tries > 0; i += 1) {
      for (let j = i + 1; j < order.length && tries > 0; j += 1) {
        const [first, second] = [order[i]!, order[j]!];
        if (linesCross(found.get(first)!.points, found.get(second)!.points) === 0) continue;
        tries -= 1;
        const before = crossingsOf(first) + crossingsOf(second);
        const kept = [found.get(first)!, found.get(second)!] as const;
        const rest = order.filter((edge) => edge !== first && edge !== second);
        try {
          settle(second, place(second, rest));
          settle(first, place(first, [...rest, second]));
        } catch (error) {
          if (!(error instanceof SourceError)) throw error;
          settle(first, kept[0]);
          settle(second, kept[1]);
          continue;
        }
        if (crossingsOf(first) + crossingsOf(second) < before) {
          order.splice(j, 1);
          order.splice(i, 0, second);
          better = true;
        } else {
          settle(first, kept[0]);
          settle(second, kept[1]);
        }
      }
    }
    if (!better) break;
  }

  // In the order placed, inside lanes first, which is the order sweeps are drawn in.
  for (const edge of order) {
    const { points, mid } = found.get(edge)!;
    routes.set(edge, { points, mid });
  }
  return routes;
}

/**
 * Whether two lines run side by side, along the same stretch, nearer than a
 * lane apart — which a line found by search never does.
 */
function crowds(a: Point[], b: Point[], lane: number): boolean {
  for (let i = 0; i + 1 < a.length; i += 1) {
    const [p, q] = [a[i]!, a[i + 1]!];
    const level = Math.abs(p.y - q.y) < 0.5;
    for (let j = 0; j + 1 < b.length; j += 1) {
      const [r, s] = [b[j]!, b[j + 1]!];
      if (level !== Math.abs(r.y - s.y) < 0.5) continue;
      const [across, lo, hi, otherAcross, otherLo, otherHi] = level
        ? [p.y, Math.min(p.x, q.x), Math.max(p.x, q.x), r.y, Math.min(r.x, s.x), Math.max(r.x, s.x)]
        : [p.x, Math.min(p.y, q.y), Math.max(p.y, q.y), r.x, Math.min(r.y, s.y), Math.max(r.y, s.y)];
      if (Math.min(hi, otherHi) - Math.max(lo, otherLo) > 0.5 && Math.abs(across - otherAcross) < lane - 0.5) return true;
    }
  }
  return false;
}

/** How many times two lines cross, each drawn as straight pieces through its points. */
function linesCross(a: Point[], b: Point[]): number {
  let count = 0;
  for (let i = 0; i + 1 < a.length; i += 1) {
    for (let j = 0; j + 1 < b.length; j += 1) {
      if (intersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) count += 1;
    }
  }
  return count;
}

/** Far enough to stand for the edge of the page on any side. */
const FAR = 1e5;

/**
 * The region a clause fences a line out of: everything from its nodes to the
 * edge of the page on the far side, within their width or height. `below m` is
 * M's whole column above M's bottom; "wherever the line is within M's width, it
 * is below M" is exactly "the line never enters this". Grown by `by`, so the
 * search keeps the margin a box gets.
 */
function fenceOf(pass: LayoutPass, by: number): Extent {
  const box = grow(extentOfBox(boundingBox(pass.nodes.map(faceOf))), by);
  switch (pass.direction) {
    case 'below':
      return { ...box, minY: -FAR };
    case 'above':
      return { ...box, maxY: FAR };
    case 'left':
      return { ...box, maxX: FAR };
    default:
      return { ...box, minX: -FAR };
  }
}

/** Whether a line along these points is alongside every clause's nodes somewhere. */
function passesAll(edge: LayoutEdge, points: Point[]): boolean {
  return (edge.passes ?? []).every((pass) => alongside(points, pass));
}

/**
 * Whether the line passes a clause's nodes on the side it names somewhere:
 * some of it lies within their width (or height) and beyond their named side.
 * A line that is within their width only on the wrong side — leaving a node
 * that sits over M, say — has not passed M at all.
 */
function alongside(points: Point[], pass: LayoutPass): boolean {
  const box = extentOfBox(boundingBox(pass.nodes.map(faceOf)));
  const across = sideAxis(pass) === 'y';
  const [lo, hi] = across ? [box.minX, box.maxX] : [box.minY, box.maxY];
  // The side named, as a test on the other coordinate.
  const beyond = (level: number): boolean =>
    pass.direction === 'below' ? level >= box.maxY - 0.5
      : pass.direction === 'above' ? level <= box.minY + 0.5
      : pass.direction === 'left' ? level <= box.minX + 0.5
      : level >= box.maxX - 0.5;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [p, q] = [points[index]!, points[index + 1]!];
    const [a, b] = across ? [p.x, q.x] : [p.y, q.y];
    const [u, v] = across ? [p.y, q.y] : [p.x, q.x];
    const overlap = Math.min(hi, Math.max(a, b)) - Math.max(lo, Math.min(a, b));
    if (Math.abs(a - b) > 0.5) {
      // Travelling along the run: within the range, at one level.
      if (overlap > 0.5 && beyond(u)) return true;
    } else if (a > lo && a < hi && (beyond(u) || beyond(v))) {
      // Travelling across the run, inside the range: reaching the named side.
      return true;
    }
  }
  return false;
}

/**
 * A point the line must pass through to be on a clause's named side of its
 * nodes: under the middle of them for `below`, a clear gap out, heading the way
 * the line travels. Undefined when the line's ends do not reach past the
 * nodes' width at all, so the clause has nothing to say about it.
 */
function clauseGate(pass: LayoutPass, start: Point, end: Point): { at: Point; run: Point } | undefined {
  const box = extentOfBox(boundingBox(pass.nodes.map(faceOf)));
  const across = sideAxis(pass) === 'y';
  const [lo, hi] = across ? [box.minX, box.maxX] : [box.minY, box.maxY];
  const [a, b] = across ? [start.x, end.x] : [start.y, end.y];
  const from = Math.max(lo, Math.min(a, b));
  const to = Math.min(hi, Math.max(a, b));
  if (to - from < -0.5) return undefined;
  // The middle of the nodes, or as near it as the line's own span reaches.
  const middle = Math.max(Math.min(a, b), Math.min(Math.max(a, b), (lo + hi) / 2));
  const travel = Math.sign(b - a) || 1;
  const level =
    pass.direction === 'below' ? box.maxY + SEPARATION_GAP
      : pass.direction === 'above' ? box.minY - SEPARATION_GAP
      : pass.direction === 'left' ? box.minX - SEPARATION_GAP
      : box.maxX + SEPARATION_GAP;
  return across
    ? { at: { x: middle, y: level }, run: { x: travel, y: 0 } }
    : { at: { x: level, y: middle }, run: { x: 0, y: travel } };
}

function neverPassesMessage(edge: LayoutEdge, points: Point[]): string {
  const pass = edge.passes!.find((one) => !alongside(points, one))!;
  return `edge ${edge.from.name} -> ${edge.to.name}: the line never passes ${quoteNames(pass.nodes)}, so ` +
    `"${pass.written}" says nothing about it`;
}

/**
 * Why no line keeps an edge's clauses. Two clauses that pull opposite ways over
 * the same stretch cannot both hold; two that pull opposite ways one after the
 * other need room between their nodes to cross over in. Otherwise the clauses
 * and the boxes between them leave no way through.
 */
function clauseMessage(edge: LayoutEdge, passes: LayoutPass[]): string {
  const subject = `edge ${edge.from.name} -> ${edge.to.name}`;
  const opposite: Record<string, string> = { below: 'above', above: 'below', left: 'right', right: 'left' };
  for (const floor of passes) {
    for (const ceiling of passes) {
      if (opposite[floor.direction] !== ceiling.direction) continue;
      if (floor.direction !== 'below' && floor.direction !== 'right') continue;
      const f = extentOfBox(boundingBox(floor.nodes.map(faceOf)));
      const c = extentOfBox(boundingBox(ceiling.nodes.map(faceOf)));
      const across = sideAxis(floor) === 'y';
      // The floor's far edge and the ceiling's near edge, on the axis the clauses bound.
      const band = across ? c.minY - f.maxY : c.minX - f.maxX;
      if (band >= CROSSING_ROOM) continue;
      const [flo, fhi, clo, chi] = across ? [f.minX, f.maxX, c.minX, c.maxX] : [f.minY, f.maxY, c.minY, c.maxY];
      const apart = Math.max(clo - fhi, flo - chi);
      if (apart < 0) {
        return `${subject}: "${floor.written}" and "${ceiling.written}" cannot both hold — there is a stretch ` +
          `where the line is alongside both, and it cannot be ${sideWord(floor)} ${quoteNames(floor.nodes)} and ` +
          `${sideWord(ceiling)} ${quoteNames(ceiling.nodes)} at the same point. Drop one`;
      }
      if (apart < CROSSING_ROOM) {
        return `${subject}: to pass "${floor.written}" and "${ceiling.written}" the line has to cross over ` +
          `between ${quoteNames(floor.nodes)} and ${quoteNames(ceiling.nodes)}, and there is no room between ` +
          'them — give the placement between them a gap, or drop one of the two';
      }
    }
  }
  const written = passes.map((pass) => `"${pass.written}"`);
  const listed = written.length === 1 ? written[0]! : `${written.slice(0, -1).join(', ')} and ${written[written.length - 1]}`;
  return `${subject}: no line from ${edge.from.name} to ${edge.to.name} keeps ${listed} without passing through ` +
    'another box. Give the nodes more room, or drop a clause';
}

/** Why a `between` line has no way into or out of its gap. */
function gateMessage(edge: LayoutEdge, corridor: Corridor, nodes: LayoutNode[]): string {
  const [a, b] = edge.between!.nodes;
  // Straight across the gap where the line has to cross it.
  const [p1, p2] = corridor.axis === 'y'
    ? [{ x: corridor.at, y: corridor.lo }, { x: corridor.at, y: corridor.hi }]
    : [{ x: corridor.lo, y: corridor.at }, { x: corridor.hi, y: corridor.at }];
  const blocker = nodes.find(
    (node) => node !== a && node !== b && !contains(node, a) && !contains(node, b) &&
      segmentHits(p1, p2, extentOfBox(faceOf(node))),
  );
  if (blocker) {
    return `edge ${edge.from.name} -> ${edge.to.name}: the gap between "${a.name}" and "${b.name}" is blocked ` +
      `by ${blocker.name}, so the line cannot pass through it`;
  }
  return `edge ${edge.from.name} -> ${edge.to.name}: no way from ${edge.from.name} through the gap between ` +
    `"${a.name}" and "${b.name}" to ${edge.to.name} passes clear of the other boxes. Give them room, or name other sides`;
}

/**
 * Direct lines that turn in the middle of the same gap and share some of it
 * take a lane each, side by side, in the order that keeps them from crossing:
 * of lines heading down a gap, the one whose ends are both higher goes further
 * across, so it turns in above the other's arrival and the other turns down
 * before reaching it. Each is then drawn along its lane, its turns swept.
 */
function shareGaps(
  turning: { edge: LayoutEdge; points: Point[] }[],
  routes: Map<LayoutEdge, Route>,
  nodes: LayoutNode[],
  measurer: Measurer,
  fontSize: number,
): void {
  // The middle piece runs down (x fixed) when the first piece runs across.
  const upright = (points: Point[]): boolean => Math.abs(points[0]!.y - points[1]!.y) < 0.5;
  const level = (points: Point[]): number => (upright(points) ? points[1]!.x : points[1]!.y);
  const span = (points: Point[]): [number, number] => {
    const [a, b] = upright(points) ? [points[1]!.y, points[2]!.y] : [points[1]!.x, points[2]!.x];
    return [Math.min(a, b), Math.max(a, b)];
  };
  const groups: (typeof turning)[] = [];
  for (const line of turning) {
    const group = groups.find((members) =>
      members.some((other) => {
        if (upright(other.points) !== upright(line.points)) return false;
        if (Math.abs(level(other.points) - level(line.points)) > 0.5) return false;
        const [a, b] = span(other.points);
        const [c, d] = span(line.points);
        return Math.min(b, d) - Math.max(a, c) > 0.5;
      }),
    );
    if (group) group.push(line);
    else groups.push([line]);
  }
  for (const group of groups) {
    if (group.length < 2) continue;
    const first = group[0]!.points;
    const down = upright(first);
    // Which way the lines head across the gap, and how wide the gap is.
    const heading = Math.sign(down ? first[1]!.x - first[0]!.x : first[1]!.y - first[0]!.y);
    const width = Math.abs(down ? first[3]!.x - first[0]!.x : first[3]!.y - first[0]!.y);
    const along = (p: Point): number => (down ? p.y : p.x);
    const key = ({ points }: { points: Point[] }): number => {
      const travel = Math.sign(along(points[3]!) - along(points[0]!));
      return travel * (along(points[0]!) + along(points[3]!));
    };
    // Outermost — furthest the way the lines head — first.
    const ordered = [...group].sort((p, q) => key(p) - key(q));
    const step = Math.min(ATTACH_STEP, width / (group.length + 1));
    const middle = level(first);
    ordered.forEach(({ edge, points }, index) => {
      const lane = middle + heading * step * ((group.length - 1) / 2 - index);
      const [s, , , e] = points as [Point, Point, Point, Point];
      const laned = down
        ? [s, { x: lane, y: s.y }, { x: lane, y: e.y }, e]
        : [s, { x: s.x, y: lane }, { x: e.x, y: lane }, e];
      routes.set(edge, { points: laned, mid: textOnWay(laned, edge, nodes, measurer, fontSize) });
    });
  }
}

/**
 * The boxes a line must stay out of, as extents: every node that holds neither
 * end, and the line's own two, shrunk a pixel so it may start and end on their
 * sides. A container holding one end is not among them — the line crosses its
 * border on the way out.
 */
function obstaclesFor(edge: LayoutEdge, nodes: LayoutNode[]): Extent[] {
  return [
    // A circle's or diamond's ends sit inside its square extent, so the square
    // cannot stand for it here; a line meeting either square on does not cross
    // it anyway.
    ...[edge.from, edge.to]
      .filter((node) => !faceOf(node).round && !faceOf(node).pointed && !faceOf(node).caps)
      .map((node) => grow(extentOfBox(faceOf(node)), -1)),
    ...nodes
      .filter((node) => !contains(node, edge.from) && !contains(node, edge.to))
      .map((node) => extentOfBox(faceOf(node))),
  ];
}

/** Whether a line through these points passes through none of the boxes. */
function wayClear(points: Point[], boxes: Extent[]): boolean {
  for (let index = 0; index + 1 < points.length; index += 1) {
    if (boxes.some((box) => segmentHits(points[index]!, points[index + 1]!, box))) return false;
  }
  return true;
}

/**
 * The direct way between two named sides: straight across when they face each
 * other in line, two turns in the middle when they face each other offset, one
 * turn when they are at right angles and the corner lies ahead of both.
 * Undefined when there is no such way — the far end is behind a side, or both
 * sides face the same way — and the line has to go round something.
 */
function directWay(start: Anchor, end: Anchor): Point[] | undefined {
  // Which way each side faces, square to the side even where a circle's point
  // leans off its compass point.
  const s = endOf(start);
  const e = endOf(end);
  const out = { x: s.dx, y: s.dy };
  const back = { x: e.dx, y: e.dy };
  const across = out.x !== 0;
  const ahead = (p: Point, q: Point, d: Point): number => (q.x - p.x) * d.x + (q.y - p.y) * d.y;
  if (across === (back.x !== 0)) {
    const facing = out.x * back.x + out.y * back.y < 0;
    if (!facing || ahead(start, end, out) <= 0) return undefined;
    if (Math.abs(across ? end.y - start.y : end.x - start.x) < 0.5) return [start, end];
    const m = across ? (start.x + end.x) / 2 : (start.y + end.y) / 2;
    return across
      ? [start, { x: m, y: start.y }, { x: m, y: end.y }, end]
      : [start, { x: start.x, y: m }, { x: end.x, y: m }, end];
  }
  const corner = across ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
  if (ahead(start, corner, out) > 0 && ahead(end, corner, back) > 0) return [start, corner, end];
  return undefined;
}

/**
 * Where a line's text rides: the middle of its longest piece on which the text
 * touches no box, or of its longest piece if it touches one on every piece. The
 * text never moves the line — it fits itself onto the line it is given.
 */
function textOnWay(
  points: Point[],
  edge: LayoutEdge,
  nodes: LayoutNode[],
  measurer: Measurer,
  fontSize: number,
): Point {
  const pieces: { mid: Point; length: number }[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [p, q] = [points[index]!, points[index + 1]!];
    pieces.push({ mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, length: Math.hypot(q.x - p.x, q.y - p.y) });
  }
  // Longest first, and of two the same length, the earlier.
  pieces.sort((p, q) => q.length - p.length > 0.5 ? 1 : p.length - q.length > 0.5 ? -1 : 0);
  if (edge.lines === undefined) return pieces[0]!.mid;
  const half = { x: laneExtent(edge, 'x', measurer, fontSize) / 2, y: laneExtent(edge, 'y', measurer, fontSize) / 2 };
  const clear = pieces.find(({ mid }) =>
    nodes.every((node) => {
      const box = extentOfBox(faceOf(node));
      // A container the text sits inside is not something it lands on.
      const holds = box.minX < mid.x && mid.x < box.maxX && box.minY < mid.y && mid.y < box.maxY &&
        node.children.length > 0;
      return holds ||
        mid.x + half.x <= box.minX || mid.x - half.x >= box.maxX ||
        mid.y + half.y <= box.minY || mid.y - half.y >= box.maxY;
    }),
  );
  return (clear ?? pieces[0]!).mid;
}

/** How much a turn costs the search, in the same units as length. */
const SEARCH_TURN = SEPARATION_GAP * 2;

/** How many crossing pairs, per line placed, may be placed again the other way round. */
const UNCROSS_TRIES = 1;

/**
 * The searched way for one edge, or one half of a `between` edge. A named side
 * is fixed; an end with no side named may leave or arrive by any of its box's
 * four, at that side's middle, and takes whichever makes the way cheapest. An
 * end with no node is a point in a gap, heading along it, and is fixed too.
 *
 * The edge's clauses are walls like the boxes: each fences off the region
 * `fenceOf` gives. An end starting inside a fence — a line leaving M's left
 * side with `below m` — crosses its margin on the way out, as it crosses its
 * own box's. An end heading into the fenced side — M's top with `below m` —
 * gets a stub's room before the fence begins, so it leaves, steps round, and
 * comes back below.
 */
function searchWay(
  edge: LayoutEdge,
  nodes: LayoutNode[],
  start: Anchor,
  startNode: LayoutNode | undefined,
  end: Anchor,
  endNode: LayoutNode | undefined,
  taken: Point[][],
  lane: number,
  used: { node: LayoutNode; anchor: Anchor }[] = [],
  more: { gate?: SearchGate; ownHalf?: number; takenHalves?: number[][] } = {},
): { start: Anchor; end: Anchor; points: Point[] } | undefined {
  const holders = (node: LayoutNode | undefined): LayoutNode[] =>
    node ? nodes.filter((other) => contains(other, node)) : [];
  const walls = new Map<LayoutNode, SearchWall>();
  for (const node of nodes) {
    // A container holding an end — one or both — is crossed, or lived inside,
    // not gone round. The line's own boxes are walls, a loop back to one box
    // included.
    if (node !== edge.from && node !== edge.to && (contains(node, edge.from) || contains(node, edge.to))) continue;
    walls.set(node, wallOf(grow(extentOfBox(faceOf(node)), ATTACH_MARGIN)));
  }
  const ownOf = (node: LayoutNode | undefined): SearchWall[] =>
    holders(node).map((holder) => walls.get(holder)).filter((wall): wall is SearchWall => wall !== undefined);

  // An end with no side named takes a side's middle, or the nearest point
  // along it a step clear of where another line already meets that side.
  const choices = (anchor: Anchor, node: LayoutNode | undefined): Anchor[] =>
    anchor.side !== undefined || !node
      ? [anchor]
      : ATTACH_SIDES.map((side) => {
          const face = faceOf(node);
          const center = centerOf(face);
          const level = side === 'top' || side === 'bottom';
          const middle = level ? center.x : center.y;
          const out = endOf(anchorOn(face, side, middle));
          const others = used
            .filter((one) => one.node === node)
            .map((one) => ({ at: one.anchor, heading: endOf(one.anchor) }))
            .filter(({ heading }) => heading.dx === out.dx && heading.dy === out.dy)
            .map(({ at }) => (level ? at.x : at.y));
          const [lo, hi] = level
            ? [face.x + ATTACH_MARGIN, face.x + face.width - ATTACH_MARGIN]
            : [face.y + ATTACH_MARGIN, face.y + face.height - ATTACH_MARGIN];
          const unused = (at: number): boolean => others.every((other) => Math.abs(other - at) >= ATTACH_STEP - 0.5);
          let at = middle;
          for (let step = 1; !unused(at) && step <= 8; step += 1) {
            const candidates = [middle + step * ATTACH_STEP, middle - step * ATTACH_STEP]
              .filter((one) => one >= lo && one <= hi && unused(one));
            if (candidates[0] !== undefined) at = candidates[0];
          }
          return anchorOn(face, side, at);
        });
  const stub = ROUTE_STUB;
  const clear = SEPARATION_GAP - ATTACH_MARGIN;
  // Which way each fence runs off to the edge of the page.
  const far: Record<string, Point> = { below: { x: 0, y: -1 }, above: { x: 0, y: 1 }, left: { x: 1, y: 0 }, right: { x: -1, y: 0 } };
  let best: { start: Anchor; end: Anchor; points: Point[]; cost: number } | undefined;
  for (const from of choices(start, startNode)) {
    for (const to of choices(end, endNode)) {
      const s = endOf(from);
      const e = endOf(to);
      const ownStart = ownOf(startNode);
      const ownEnd = ownOf(endNode);
      const fences: SearchWall[] = [];
      for (const pass of edge.passes ?? []) {
        const fence = wallOf(fenceOf(pass, ATTACH_MARGIN));
        const away = far[pass.direction]!;
        let inStart = false;
        let inEnd = false;
        for (const [point, own] of [[s, ownStart], [e, ownEnd]] as const) {
          if (!within(point, fence)) continue;
          if (point.dx === away.x && point.dy === away.y) {
            const room = stub + clear;
            if (away.y < 0) fence.maxY = Math.min(fence.maxY, point.y - room);
            if (away.y > 0) fence.minY = Math.max(fence.minY, point.y + room);
            if (away.x > 0) fence.minX = Math.max(fence.minX, point.x + room);
            if (away.x < 0) fence.maxX = Math.min(fence.maxX, point.x - room);
          } else if (own === ownStart) {
            inStart = true;
          } else {
            inEnd = true;
          }
        }
        fences.push(fence);
        if (inStart) ownStart.push(fence);
        if (inEnd) ownEnd.push(fence);
      }
      const found = searchRoute(
        s,
        e,
        [...walls.values(), ...fences],
        {
          stub,
          clear,
          turn: SEARCH_TURN,
          ownStart,
          ownEnd,
          taken,
          lane,
          ...more,
          // Only a way cheaper than the best so far is taken, so a search that
          // cannot find one stops early.
          limit: best ? best.cost - 1e-6 : Infinity,
          bounds: wallOf(grow(
            nodes.map((node) => extentOfBox(faceOf(node))).reduce(union),
            ROUTE_STUB * 4,
          )),
        },
      );
      if (found && (!best || found.cost < best.cost - 1e-6)) best = { start: from, end: to, ...found };
    }
  }
  return best;
}

/** An end for the search, heading straight out of its side: a circle's point off its compass point still leaves square to the side. */
function endOf(anchor: Anchor): SearchEnd {
  const outward: Record<AttachSide, Point> = {
    top: { x: 0, y: -1 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const t = anchor.side !== undefined ? outward[anchor.side] : { x: Math.sign(anchor.tx), y: Math.sign(anchor.ty) };
  return { x: anchor.x, y: anchor.y, dx: t.x, dy: t.y };
}

function wallOf(extent: Extent): SearchWall {
  return { minX: extent.minX, minY: extent.minY, maxX: extent.maxX, maxY: extent.maxY };
}

/**
 * Why an edge has no way through, naming the box in the way where one box
 * explains it: a box against the side a line has to leave or arrive by.
 */
function blockedMessage(edge: LayoutEdge, { start, end }: EdgeEnds, nodes: LayoutNode[]): string {
  const subject = `edge ${edge.from.name} -> ${edge.to.name}`;
  const against = (anchor: Anchor, own: LayoutNode): LayoutNode | undefined => {
    if (anchor.side === undefined) return undefined;
    // Room to get out is room for both boxes' margins; anything closer is against it.
    const room = ATTACH_MARGIN * 2;
    const tip = { x: anchor.x + anchor.tx * room, y: anchor.y + anchor.ty * room };
    return nodes.find(
      (node) => !contains(node, own) && segmentHits(anchor, tip, extentOfBox(faceOf(node))),
    );
  };
  const first = against(start, edge.from);
  if (first) return `${subject}: cannot leave ${edge.from.name}'s ${start.side} side, ${first.name} is against it`;
  const last = against(end, edge.to);
  if (last) return `${subject}: cannot arrive at ${edge.to.name}'s ${end.side} side, ${last.name} is against it`;
  return `${subject}: every way from ${edge.from.name} to ${edge.to.name} passes through another box. Give them room, or name other sides`;
}

/**
 * Whether the single curve an edge would otherwise be drawn as passes through
 * a box: either of its own, or any other that holds neither end. Measured on
 * the curve itself, so the answer is the picture's and not a rule about which
 * sides were named.
 *
 * Only passing through counts. Also counting a curve that merely comes close,
 * or whose text touches a node, was tried (2026-09-27) and sent nearly every
 * such edge the long way round with square corners, which the user rejected
 * outright.
 */
function curveHits(edge: LayoutEdge, ends: EdgeEnds, boxes: Extent[]): boolean {
  return !wayClear(curveTrace(edge, ends), boxes);
}

/** The curve an edge with a named side is drawn as, as points close enough together to test against boxes. */
function curveTrace(edge: LayoutEdge, ends: EdgeEnds): Point[] {
  const curve = sideCurve(edge, ends);
  const { p0, c1, c2, p3 } = curve;
  const at = (t: number): Point => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    };
  };
  const steps = 32;
  return [curve.start, ...Array.from({ length: steps + 1 }, (_, step) => at(step / steps)), curve.end];
}

/** Whether a point lies strictly inside a wall. */
function within(point: { x: number; y: number }, wall: SearchWall): boolean {
  return point.x > wall.minX && point.x < wall.maxX && point.y > wall.minY && point.y < wall.maxY;
}

/**
 * The curve a line with a named side is drawn as. Its handles leave along each
 * side's outward normal. At an end carrying an arrowhead the curve stops an
 * arrowhead's length out and the line finishes straight, so the head sits on a
 * straight piece pointing square into the side rather than on a line still
 * bending.
 */
function sideCurve(
  edge: LayoutEdge,
  { start, end, bow }: EdgeEnds,
): { start: Point; p0: Point; c1: Point; c2: Point; p3: Point; end: Point } {
  const head = arrowLength(edge.look.thickness);
  const tip = (anchor: Anchor, arrowed: boolean): Point =>
    arrowed && anchor.side !== undefined
      ? { x: anchor.x + anchor.tx * head, y: anchor.y + anchor.ty * head }
      : { x: anchor.x, y: anchor.y };
  const p0 = tip(start, edge.marks.from !== 'none');
  const p3 = tip(end, edge.marks.to !== 'none');
  const reach = controlReach(start, end);
  // A bundle whose sides were too short to spread it takes the rest of the
  // room in the middle — see `bowBundles`. Displacing both control points
  // equally moves the curve's middle by three quarters as much, so the bow is
  // scaled up by the inverse of that.
  const lift = 4 / 3;
  const bx = (bow?.x ?? 0) * lift;
  const by = (bow?.y ?? 0) * lift;
  return {
    start,
    p0,
    c1: { x: start.x + start.tx * reach + bx, y: start.y + start.ty * reach + by },
    c2: { x: end.x + end.tx * reach + bx, y: end.y + end.ty * reach + by },
    p3,
    end,
  };
}

/** A line drawn as straight pieces with rounded corners, and where its text rides. */
interface Route {
  points: Point[];
  mid: Point;
}

/** The most a route's corner is rounded by. */
const ROUTE_RADIUS = 20;
/**
 * How far a route leaves its side before its first turn: a full corner, and the
 * arrowhead's length on top so the head lands on a straight piece of line.
 */
const ROUTE_STUB = ROUTE_RADIUS + ARROW_LENGTH;
/** The narrowest gap a route will cross over in, between two nodes it passes on opposite sides. */
const CROSSING_ROOM = ATTACH_MARGIN * 2;

/** Which axis a clause's side sits on: above and below are a matter of y. */
function sideAxis(pass: LayoutPass): Axis {
  return pass.direction === 'above' || pass.direction === 'below' ? 'y' : 'x';
}

/** "below", "left of" — the side as the author would say it. */
function sideWord(pass: LayoutPass): string {
  return pass.direction === 'above' || pass.direction === 'below'
    ? pass.direction
    : `${pass.direction} of`;
}

/** The box that just bounds several. */
function boundingBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

/** `"a"`, `"a" and "b"` — for error messages. */
function quoteNames(nodes: LayoutNode[]): string {
  const quoted = nodes.map((node) => `"${node.name}"`);
  return quoted.length <= 1
    ? (quoted[0] ?? '')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** Drop repeated points and ones partway along a straight piece, which are not corners. */
function tidyRoute(points: Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const previous = kept[kept.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) continue;
    const before = kept[kept.length - 2];
    if (
      before && previous &&
      Math.abs((previous.x - before.x) * (point.y - previous.y) - (previous.y - before.y) * (point.x - previous.x)) < 1e-6 &&
      (previous.x - before.x) * (point.x - previous.x) + (previous.y - before.y) * (point.y - previous.y) >= 0
    ) {
      kept[kept.length - 1] = point;
      continue;
    }
    kept.push(point);
  }
  return kept;
}

/**
 * A line through `points` with every corner rounded. A corner takes at most
 * half of each piece it shares with a neighboring corner, and the whole of a
 * piece at either end short of the arrowhead, so two corners never overlap and
 * the head always lands on a straight piece.
 */
function roundedPath(points: Point[], arrow: number = ARROW_LENGTH): string {
  const parts = [`M ${round(points[0]!.x)} ${round(points[0]!.y)}`];
  const kappa = 0.5523; // a cubic's handle, as a share of the radius, for a quarter circle
  for (let index = 1; index + 1 < points.length; index += 1) {
    const [before, corner, after] = [points[index - 1]!, points[index]!, points[index + 1]!];
    const inward = Math.hypot(corner.x - before.x, corner.y - before.y);
    const outward = Math.hypot(after.x - corner.x, after.y - corner.y);
    const radius = Math.max(
      0,
      Math.min(
        ROUTE_RADIUS,
        index === 1 ? inward - arrow : inward / 2,
        index + 2 === points.length ? outward - arrow : outward / 2,
      ),
    );
    const din = { x: (corner.x - before.x) / inward, y: (corner.y - before.y) / inward };
    const dout = { x: (after.x - corner.x) / outward, y: (after.y - corner.y) / outward };
    const enter = { x: corner.x - din.x * radius, y: corner.y - din.y * radius };
    const leave = { x: corner.x + dout.x * radius, y: corner.y + dout.y * radius };
    parts.push(
      `L ${round(enter.x)} ${round(enter.y)}`,
      `C ${round(enter.x + din.x * radius * kappa)} ${round(enter.y + din.y * radius * kappa)}, ` +
        `${round(leave.x - dout.x * radius * kappa)} ${round(leave.y - dout.y * radius * kappa)}, ` +
        `${round(leave.x)} ${round(leave.y)}`,
    );
  }
  const last = points[points.length - 1]!;
  parts.push(`L ${round(last.x)} ${round(last.y)}`);
  return parts.join(' ');
}

/** The furthest a sweep reaches along a piece from the turn it rounds. */
const SWEEP_REACH = 120;

/** The nearest a sweep comes to another line, except where the two cross. */
const SWEEP_AIR = 5;

/**
 * A line through `points` that sweeps through its turns rather than cornering.
 *
 * A jog — a turn one way and straight back the other, as a line stepping into
 * a gap does — is one S from well back along the piece before it to well along
 * the piece after, the middle piece taken up entirely. Any other turn is a
 * quarter sweep, starting as far back along the piece coming in and ending as
 * far along the piece going out as the room allows. A turn may take all of an
 * end piece short of the arrowhead, and half of a piece it shares with the next
 * turn, so a U under a row is two sweeps meeting in its middle.
 *
 * Neither may cut into a box or come near another line; each is tried at its
 * widest and shrunk until clear. A jog that cannot clear as one S is swept as
 * two turns, and a turn at its smallest is the rounded corner a square line
 * has. So where the room is tight the line looks nearly square, and where there
 * is room it flows.
 */
function sweptPath(
  points: Point[],
  boxes: Extent[],
  neighbors: Point[][],
  arrow: number,
  marks: { from: Mark; to: Mark },
): string {
  const kappa = 0.5523;
  const count = points.length;
  const legLength = (leg: number): number =>
    Math.hypot(points[leg + 1]!.x - points[leg]!.x, points[leg + 1]!.y - points[leg]!.y);
  const heading = (leg: number): Point => {
    const length = legLength(leg);
    return { x: (points[leg + 1]!.x - points[leg]!.x) / length, y: (points[leg + 1]!.y - points[leg]!.y) / length };
  };
  // How much of a piece one of its turns may take.
  const room = (leg: number): number => {
    const length = legLength(leg);
    if (leg === 0) return Math.max(0, length - (marks.from !== 'none' ? arrow : 0));
    if (leg === count - 2) return Math.max(0, length - (marks.to !== 'none' ? arrow : 0));
    return length / 2;
  };
  const cubicAt = (p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    };
  };
  const distance = (p: Point, a: Point, b: Point): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const squared = dx * dx + dy * dy;
    const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  };
  // Whether a curve keeps out of every box and clear of every other line.
  const clear = (p0: Point, c1: Point, c2: Point, p3: Point): boolean => {
    const steps = 24;
    const trace = Array.from({ length: steps + 1 }, (_, step) => cubicAt(p0, c1, c2, p3, step / steps));
    for (const point of trace) {
      if (boxes.some((box) => point.x > box.minX && point.x < box.maxX && point.y > box.minY && point.y < box.maxY)) {
        return false;
      }
    }
    // A piece of another line wholly beyond the curve's reach, and its air,
    // can neither cross it nor come near it.
    const reach = {
      minX: Math.min(...trace.map((point) => point.x)) - SWEEP_AIR,
      maxX: Math.max(...trace.map((point) => point.x)) + SWEEP_AIR,
      minY: Math.min(...trace.map((point) => point.y)) - SWEEP_AIR,
      maxY: Math.max(...trace.map((point) => point.y)) + SWEEP_AIR,
    };
    for (const line of neighbors) {
      for (let index = 0; index + 1 < line.length; index += 1) {
        const [p, q] = [line[index]!, line[index + 1]!];
        if (Math.max(p.x, q.x) < reach.minX || Math.min(p.x, q.x) > reach.maxX) continue;
        if (Math.max(p.y, q.y) < reach.minY || Math.min(p.y, q.y) > reach.maxY) continue;
        for (let step = 0; step < steps; step += 1) {
          if (intersect(trace[step]!, trace[step + 1]!, p, q)) return false;
        }
        // The ends of the sweep sit on the line's own way, which already keeps
        // its lane; only the part cut inside the turn is held off.
        if (trace.slice(1, -1).some((point) => distance(point, p, q) < SWEEP_AIR)) return false;
      }
    }
    return true;
  };
  const along = (from: Point, direction: Point, by: number): Point => ({
    x: from.x + direction.x * by,
    y: from.y + direction.y * by,
  });

  const parts = [`M ${round(points[0]!.x)} ${round(points[0]!.y)}`];
  const curve = (p0: Point, c1: Point, c2: Point, p3: Point): void => {
    parts.push(
      `L ${round(p0.x)} ${round(p0.y)}`,
      `C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(p3.x)} ${round(p3.y)}`,
    );
  };
  for (let index = 1; index + 1 < count; index += 1) {
    const din = heading(index - 1);
    const dout = heading(index);
    const wantIn = Math.min(SWEEP_REACH, room(index - 1));

    // A jog: this turn and the next go opposite ways, so the line comes out
    // heading the way it went in.
    if (index + 2 < count) {
      const dafter = heading(index + 1);
      if (Math.abs(dafter.x - din.x) < 1e-6 && Math.abs(dafter.y - din.y) < 1e-6) {
        const wantOut = Math.min(SWEEP_REACH, room(index + 1));
        // The two ends shrink separately, since a neighbor often crowds only
        // one of them, and the widest S that clears wins.
        const sizes = (want: number): number[] => {
          const found: number[] = [];
          for (let size = want; size >= ROUTE_RADIUS; size *= 0.8) found.push(size);
          return found;
        };
        const tries = sizes(wantIn)
          .flatMap((a) => sizes(wantOut).map((b) => [a, b] as const))
          .sort((p, q) => q[0] + q[1] - (p[0] + p[1]));
        const jog = tries
          .map(([a, b]) => {
            const p0 = along(points[index]!, din, -a);
            const p3 = along(points[index + 1]!, din, b);
            const run = (p3.x - p0.x) * din.x + (p3.y - p0.y) * din.y;
            return [p0, along(p0, din, run / 2), along(p3, din, -run / 2), p3] as [Point, Point, Point, Point];
          })
          .find((piece) => clear(...piece));
        if (jog) {
          curve(...jog);
          index += 1;
          continue;
        }
      }
    }

    const wantOut = Math.min(SWEEP_REACH, room(index));
    // The smallest a sweep gets: a square line's rounded corner.
    const least = Math.max(0, Math.min(ROUTE_RADIUS, wantIn, wantOut));
    let a = Math.max(0, wantIn);
    let b = Math.max(0, wantOut);
    const corner = points[index]!;
    const quarter = (a: number, b: number): [Point, Point, Point, Point] => {
      const p0 = along(corner, din, -a);
      const p3 = along(corner, dout, b);
      return [p0, along(p0, din, a * kappa), along(p3, dout, -b * kappa), p3];
    };
    // Within half a pixel of the smallest is the smallest: where an end piece
    // has no room left, the smallest is zero, which shrinking never reaches,
    // and twenty-two lines into one side took the page down.
    const shrink = (size: number): number => (size * 0.85 < least + 0.5 ? least : size * 0.85);
    while ((a > least || b > least) && !clear(...quarter(a, b))) {
      a = shrink(a);
      b = shrink(b);
    }
    curve(...quarter(a, b));
  }
  const last = points[count - 1]!;
  parts.push(`L ${round(last.x)} ${round(last.y)}`);
  return parts.join(' ');
}

/**
 * What a sweep may not cut into: every box that holds neither end, with the
 * margin a line keeps from it, and the line's own two shrunk a pixel, since it
 * starts and ends on their sides.
 */
function sweepObstacles(edge: LayoutEdge, nodes: LayoutNode[]): Extent[] {
  return [
    ...[edge.from, edge.to]
      .filter((node) => !faceOf(node).round && !faceOf(node).pointed && !faceOf(node).caps)
      .map((node) => grow(extentOfBox(faceOf(node)), -1)),
    ...nodes
      .filter((node) => !contains(node, edge.from) && !contains(node, edge.to))
      .map((node) => grow(extentOfBox(faceOf(node)), ATTACH_MARGIN)),
  ];
}

function lo(box: Box, axis: Axis): number {
  return axis === 'x' ? box.x : box.y;
}

function hi(box: Box, axis: Axis): number {
  return axis === 'x' ? box.x + box.width : box.y + box.height;
}

/** Whether `inner` is `outer` or sits somewhere inside it. */
function contains(outer: LayoutNode, inner: LayoutNode): boolean {
  for (let node: LayoutNode | undefined = inner; node; node = node.parent) {
    if (node === outer) return true;
  }
  return false;
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

/** Where a line crosses the line across its gate, inside the gap: where its text rides. */
function gateCrossing(points: Point[], gate: SearchGate): Point {
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [p, q] = [points[index]!, points[index + 1]!];
    const [a, b, level] = gate.run === 'x' ? [p.x, q.x, p.y] : [p.y, q.y, p.x];
    const along = gate.run === 'x' ? Math.abs(p.y - q.y) < 0.5 : Math.abs(p.x - q.x) < 0.5;
    if (along && level > gate.lo && level < gate.hi && Math.min(a, b) <= gate.at + 0.01 && Math.max(a, b) >= gate.at - 0.01) {
      return gate.run === 'x' ? { x: gate.at, y: level } : { x: level, y: gate.at };
    }
  }
  return points[Math.floor(points.length / 2)]!;
}

function sideAttr(edge: LayoutEdge, key: 'from' | 'to'): AttachSide | undefined {
  const value = edge.attrs[key];
  if (value === undefined) return impliedSide(edge, key);
  if (!(ATTACH_SIDES as readonly string[]).includes(value)) {
    throw new SourceError(
      `"${key}: ${value}" is not a side — use ${ATTACH_SIDES.join(', ')}`,
      edge.line,
    );
  }
  return value as AttachSide;
}

/**
 * The side a square line leaves or arrives on when its author named none.
 *
 * A curved or straight line with no sides aims straight at the other box, but a
 * square one can only leave a side head-on, so it has to pick one. Boxes that
 * share a column join top to bottom and boxes that share a row join side to
 * side; otherwise the line goes across first and then down, the tie the mixed
 * passes settled. An end whose partner did name a side keeps the line to one
 * turn where it can. Everything after this treats the side as though it had
 * been written, so the ends are spread and bundled like any named side.
 *
 * An edge through a `between` gap or past a named node is routed by its clauses,
 * and one from a node to itself or to its own container has no outside to pick
 * from, so none of those is given a side here.
 */
function impliedSide(edge: LayoutEdge, key: 'from' | 'to'): AttachSide | undefined {
  if (edge.look.path !== 'square' || edge.between || edge.passes) return undefined;
  if (contains(edge.from, edge.to) || contains(edge.to, edge.from)) return undefined;
  const own = faceOf(key === 'from' ? edge.from : edge.to);
  const other = faceOf(key === 'from' ? edge.to : edge.from);
  const partnerKey = key === 'from' ? 'to' : 'from';
  const partner = edge.attrs[partnerKey] as AttachSide | undefined;
  const overlapX = own.x < other.x + other.width && other.x < own.x + own.width;
  const overlapY = own.y < other.y + other.height && other.y < own.y + own.height;
  const across: AttachSide = centerOf(other).x >= centerOf(own).x ? 'right' : 'left';
  const upDown: AttachSide = centerOf(other).y >= centerOf(own).y ? 'bottom' : 'top';
  if (partner !== undefined && (ATTACH_SIDES as readonly string[]).includes(partner)) {
    // The partner's side is fixed, so take whichever side of this box joins it
    // in the fewest turns. The order breaks ties the way the rest of this does.
    const theirs = anchorOn(other, partner, partner === 'top' || partner === 'bottom' ? centerOf(other).x : centerOf(other).y);
    const order: AttachSide[] = overlapX && !overlapY ? [upDown, across] : [across, upDown];
    const sides = [...order, ...ATTACH_SIDES.filter((side) => !order.includes(side))];
    let best = sides[0]!;
    let fewest = Infinity;
    for (const side of sides) {
      const mine = anchorOn(own, side, side === 'top' || side === 'bottom' ? centerOf(own).x : centerOf(own).y);
      const [from, to] = key === 'from' ? [mine, theirs] : [theirs, mine];
      const turns = tidyRoute(
        rightAngles(from, { x: from.tx, y: from.ty }, to, { x: to.tx, y: to.ty }, ROUTE_STUB),
      ).length;
      if (turns < fewest) {
        fewest = turns;
        best = side;
      }
    }
    return best;
  }
  if (overlapX && !overlapY) return upDown;
  if (overlapY && !overlapX) return across;
  // Across first, then down: the start leaves across and the end is reached down.
  return key === 'from' ? across : upDown;
}

/**
 * The shape of each mark, in a 10 by 10 box whose right edge is the end of the
 * line, pointing along it. The marker scales with the stroke, so a unit is 0.7
 * of the line's width and an outline of 1.4 units is as thick as the line.
 *
 * An outlined mark is filled with the page's background so the line running
 * under it does not show through. Over a filled container that is the wrong
 * color inside the outline; nothing has hit it yet.
 */
function markShape(mark: Mark, color: string, background: string): string {
  const outline = `fill="${background}" stroke="${color}" stroke-width="1.4"`;
  switch (mark) {
    case 'arrow':
      return `<path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/>`;
    case 'oarrow':
      return `<path d="M 0.7 1.2 L 9.3 5 L 0.7 8.8 z" ${outline}/>`;
    case 'dot':
      return `<circle cx="5" cy="5" r="4" fill="${color}"/>`;
    case 'odot':
      return `<circle cx="5.3" cy="5" r="3.4" ${outline}/>`;
    case 'diamond':
      return `<path d="M 0 5 L 5 1.2 L 10 5 L 5 8.8 z" fill="${color}"/>`;
    case 'odiamond':
      return `<path d="M 0.9 5 L 5 1.9 L 9.1 5 L 5 8.1 z" ${outline}/>`;
    case 'bar':
      return `<rect x="5.5" y="0.5" width="1.4" height="9" fill="${color}"/>`;
    case 'none':
      return '';
  }
}

/** One marker, drawn at either end: `auto-start-reverse` turns it round at the start. */
function markMarker(mark: Mark, color: string, background: string): string {
  return [
    `    <marker id="${markerId(mark, color)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${ARROW_MARKER_WIDTH}" markerHeight="${ARROW_MARKER_WIDTH}" orient="auto-start-reverse">`,
    `      ${markShape(mark, color, background)}`,
    '    </marker>',
  ].join('\n');
}

function markerId(mark: Mark, color: string): string {
  return `${mark}-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
}

// --- small shared pieces ------------------------------------------------------

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The circle in this square is what is drawn, so a line meets that instead. */
  round?: boolean;
  /** The diamond in this box is what is drawn, so a line meets that instead. */
  pointed?: boolean;
  /** The radius of each half-circle end, so a line meets the curve instead. */
  caps?: { left: number; right: number };
}

/** The rectangle actually drawn. Differs from the node box only for a deck. */
function faceOf(node: LayoutNode): Box {
  return {
    x: node.x + node.inset,
    y: node.y + node.inset,
    width: node.width - node.inset,
    height: node.height - node.inset,
    round: node.body.kind === 'shape' && node.body.outline === 'circle',
    pointed: node.body.kind === 'shape' && node.body.outline === 'diamond',
    caps: capsOf(node),
  };
}

/** The radius of each rounded end of a pill or a half pill; none on other outlines. */
function capsOf(node: LayoutNode): { left: number; right: number } | undefined {
  if (node.body.kind !== 'shape') return undefined;
  const radius = (node.height - node.inset) / 2;
  if (node.body.outline === 'pill') return { left: radius, right: radius };
  if (node.body.outline === 'half-pill') return { left: 0, right: radius };
  return undefined;
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
  return themeColor(markup[run.style]!, theme);
}

/**
 * A text's own color, the same words `fill:` and `border:` take — so
 * `theme-muted` is a quiet line that stays readable when the theme changes.
 */
function textColorOf(textAttrs: Attrs, theme: Theme, fallback: string): string {
  const value = textAttrs['color'];
  return value === undefined ? fallback : themeColor(value, theme);
}

/**
 * A color is written as the viewer will receive it — `#14532d`, or any CSS
 * color — or as one of the `theme-` words, which the theme answers. The
 * renderer keeps no list of color words of its own, so a diagram is never
 * limited to the ones somebody remembered to add here.
 *
 * Each names the part it colors, so each reads exactly one key. The word these
 * replaced, `stroke:`, named no part and meant a different one on every kind,
 * which is why a box's text could not be colored at all until `text:`.
 */
function borderOf(appearance: Record<string, string>, theme: Theme, fallback: string): string {
  const value = appearance['border'];
  return value === undefined ? fallback : themeColor(value, theme);
}

function lineOf(appearance: Record<string, string>, theme: Theme, fallback: string): string {
  const value = appearance['line'];
  return value === undefined ? fallback : themeColor(value, theme);
}

function fillOf(appearance: Record<string, string>, theme: Theme, fallback: string): string {
  const value = appearance['fill'];
  return value === undefined ? fallback : themeColor(value, theme);
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
