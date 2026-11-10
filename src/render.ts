import {
  ARROW_LENGTH,
  ARROW_MARKER_WIDTH,
  DEFAULT_FONT_SIZE,
  ICON_LINES,
  LINE_WIDTH,
  PAD,
  arrowLength,
  fontSizeFor,
  lineSize,
  lineTall,
  textStyleFor,
  widestLine,
} from './constants.js';
import type { Attrs, Mark, NodeCorners } from './ast.js';
import { SourceError } from './errors.js';
import { ICON_STROKE, type Icon, type IconTone, type LetterIcon, type Outline } from './icons.js';
import { insideOutline,isBoxy, isRound, placePath, shapeOf, SUBPROCESS_INSET, type ShapeLook } from './outline.js';
import { monospaceMeasurer, type Measurer } from './measure.js';
import { joinedToText, outlineStated, type DepthStatement, type Layout, type LayoutEdge, type LayoutMark, type LayoutNode, type LineLook } from './model.js';
import { DARK_THEME, THEMES, overlapFill, regionTint, textOnFill, themeColor, type Theme } from './themes.js';
import { crossingPoints, planLines, traceRoute, visibleRuns, type Point, type Route } from './lines.js';
import { patchPadding, placeLineTexts } from './linetexts.js';
import { plain, type Line, type Run } from './text.js';
import { linkLabel, linksOf, type Link } from './links.js';
import { markdownPlain } from './markdown.js';

export interface RenderOptions {
  measurer?: Measurer;
  fontSize?: number;
  theme?: Theme;
  /** Draw the guides (`--guides`). Absent: what the file's `diagram guides:` says. */
  guides?: boolean;
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
  return drawing(layout, options)(false);
}

/**
 * The SVG as `render` gives it, and the same drawing with each thing wrapped in
 * a group naming it and its statement's line, for a page that points at things
 * (`--page`). Drawn once, so the two can't disagree.
 */
export function renderTagged(layout: Layout, options: RenderOptions = {}): { svg: string; tagged: string } {
  const assemble = drawing(layout, options);
  return { svg: assemble(false), tagged: assemble(true) };
}

function drawing(layout: Layout, options: RenderOptions): (tagged: boolean) => string {
  const measurer = options.measurer ?? monospaceMeasurer();
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const theme = themeOf(layout, options);

  // Guides are shown by the viewer (`--guides`), or by a file that explains
  // its own construction (`diagram guides: show`).
  const guides: Guides = {
    shown: options.guides ?? layout.diagram['guides'] === 'show',
    color: theme.secondary.color,
    looks: layout.guideLooks,
  };
  // A shown guide line is dashed in the guide color, unless `default guide
  // edge` or its own words say otherwise. Nothing about where it goes changes.
  const edges = layout.edges.map((edge) => {
    if (!edge.guide || !guides.shown) return edge;
    const look = guides.looks.edge;
    const pattern = edge.attrs['line.pattern'] ?? look['line.pattern'] ?? 'dashed';
    return {
      ...edge,
      look: { ...edge.look, pattern: pattern as LineLook['pattern'] },
      appearance: { ...edge.appearance, line: edge.attrs['line'] ?? look['line'] ?? guides.color },
    };
  });
  const hidden = (edge: LayoutEdge) => edge.guide === true && !guides.shown;

  const boxes = layout.roots.flatMap((root) => drawNode(root, theme, measurer, fontSize, layout.markup, guides));
  const marks = layout.marks.map((mark) => ({
    mark,
    item: { key: mark.name, svg: markSvg(mark, theme, guides, layout.markup, fontSize, measurer), fills: markFills(mark, theme) },
  }));
  const lines: Drawn[] = [];
  // Everything the boxes cover. Edges are added to it as they are drawn.
  let ink: Extent = { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height };
  // Every line is worked out from its own statement (design.org 6); the one
  // thing lines share is a side, where several ends spread.
  const routes = planLines(layout);
  const drawn = edges
    .map((edge, index) => ({ edge, route: routes.get(layout.edges[index]!)! }))
    // A hidden guide line takes its place among the ends on a side, but draws nothing.
    .filter(({ edge }) => !hidden(edge))
    .map(({ edge, route }) => drawEdge(edge, route, theme, measurer, fontSize, layout.markup));
  // The drawing order comes first, since where two lines cross the one drawn
  // later is on top, and `depth:` may have moved either (design.org 6.6, 8.4).
  const keyOf = (edge: DrawnEdge): string => `edge ${edges.indexOf(edge.edge)}`;
  const sequence = order(boxes, marks, drawn.map((edge) => ({ key: keyOf(edge), svg: '' })), layout.depths);
  const place = new Map(sequence.map((item, index) => [item.key, index]));
  const inOrder = [...drawn].sort((a, b) => place.get(keyOf(a))! - place.get(keyOf(b))!);
  // `depth: in front of climb` on a line puts it on top only where it crosses the leg climb.
  const onLeg: LegDepth[] = layout.depths.flatMap((depth) =>
    depth.clauses.flatMap((clause) =>
      clause.legs.map(({ leg, line }) => {
        const subject = drawn.find((edge) => keyOf(edge) === depth.subject);
        const owner = drawn.find((edge) => keyOf(edge) === line);
        const trace = routes.get(layout.edges[Number(line.slice('edge '.length))]!)!.legs.get(leg)!;
        return subject && owner ? { top: clause.way === 'in front of' ? subject : owner, pair: [subject, owner], trace } : undefined;
      }),
    ),
  ).filter((one): one is LegDepth => one !== undefined);
  // A line with a `crossing:` style is cut where it crosses a line under it,
  // and the jump drawn over the cut. The cut is a mask rather than a break in
  // the path, so it works the same on a curve as on a corner, and leaves
  // whatever lies underneath — a container's fill — showing through the gap.
  const crossings = findCrossings(inOrder, onLeg);
  const masks: { id: string; holes: Crossing[] }[] = [];
  for (const edge of drawn) {
    const found = crossings.get(edge);
    // Each patch behind a text matches what is drawn under it, which the drawing order says.
    const beneath = sequence.slice(0, place.get(keyOf(edge))!);
    const rest = edge.rest.map((part) => {
      const patch = edge.patches.find((one) => one.marker === part);
      return patch ? patchSvg(patch, beneath, theme) : part;
    });
    const parts = [edge.line, ...rest.filter((part) => part.length > 0)];
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
    const links = linksOf(edge.edge.attrs);
    if (links !== undefined && edge.edge.texts.length === 0) parts.push(lineTarget(edge.line));
    lines.push({ key: keyOf(edge), svg: linked(parts.join('\n'), links) });
    ink = union(ink, grow(edge.ink, layout.margin));
  }
  const lineSvg = new Map(lines.map((line) => [line.key, line.svg]));
  const body = sequence
    .map((item) => ({ item, svg: described(layout, item, lineSvg.get(item.key) ?? item.svg) }))
    .filter(({ svg }) => svg.length > 0);

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
  const markers = new Map<string, [Mark, string, boolean]>();
  for (const edge of edges) {
    if (hidden(edge)) continue;
    const color = lineOf(edge.appearance, theme, theme.edge);
    for (const which of ['from', 'to'] as const) {
      const mark = edge.marks[which];
      const free = freeEnd(edge, which);
      if (mark !== 'none') markers.set(markerId(mark, color, free), [mark, color, free]);
    }
  }

  return (tagged) => ownIds([
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="${canvas.x} ${canvas.y} ${canvas.width} ${canvas.height}" font-family=${quote(measurer.fontFamily)} font-size="${fontSize}px">`,
    // `diagram title:` — what a browser shows on the tab when the SVG is opened
    // on its own, and what a screen reader announces.
    ...(layout.diagram['title'] === undefined ? [] : [`  <title>${escapeXml(layout.diagram['title'])}</title>`]),
    '  <defs>',
    ...[...markers.values()].map(([mark, color, free]) => markMarker(mark, color, theme.background, free)),
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
    ...body.map(({ item, svg }) => (tagged ? tag(layout, item, svg) : svg)),
    '</svg>',
    '',
  ].join('\n'));
}

/**
 * The colors a drawing is made in. A theme passed in — the command line's
 * `--theme` — beats the one the file names, so one source renders in either.
 * `diagram background:` and `text:` are the author overruling a color of
 * whichever theme that is, and a color written by hand wins over any theme, so
 * they are folded in afterwards and everything downstream sees one theme.
 */
export function themeOf(layout: Layout, options: RenderOptions = {}): Theme {
  const named = layout.diagram['theme'];
  const base = options.theme ?? (named === undefined ? undefined : THEMES[named]) ?? DARK_THEME;
  const page = layout.diagram['background'];
  const words = layout.diagram['text.color'];
  return {
    ...base,
    ...(page !== undefined && { background: themeColor(page, base) }),
    ...(words !== undefined && { text: themeColor(words, base) }),
  };
}

/**
 * `<g data-name="api" data-line="12">` round each thing drawn: what a page
 * shows on hover, and what a finding about that line lights up.
 */
/**
 * A box or a line with a description carries it, marks stripped, as hover
 * text. A `<title>` is the tooltip of the element it opens, so the drawing is
 * wrapped in a group of its own; one without a description draws as before.
 */
function described(layout: Layout, item: Drawn, svg: string): string {
  const attrs = item.node?.attrs ?? (item.key.startsWith('edge ') ? layout.edges[Number(item.key.slice('edge '.length))]?.attrs : undefined);
  const text = attrs?.['description'];
  if (text === undefined || svg.length === 0) return svg;
  return `  <g>\n  <title>${escapeXml(markdownPlain(text))}</title>\n${svg}\n  </g>`;
}

function tag(layout: Layout, item: Drawn, svg: string): string {
  let name: string;
  let line: number;
  if (item.node) {
    ({ name, line } = item.node);
  } else if (item.key.startsWith('edge ')) {
    const edge = layout.edges[Number(item.key.slice('edge '.length))]!;
    name = edge.name ?? `${edge.from.name} ${edge.arrow} ${edge.to.name}`;
    line = edge.line;
  } else {
    const mark = layout.marks.find((one) => one.name === item.key);
    if (!mark) return svg;
    ({ name, line } = mark);
  }
  // What the page selects: a node by its name, a line by its place in the list.
  const what = item.node ? ` data-node="${escapeXml(item.node.name).replace(/"/g, '&quot;')}"` : item.key.startsWith('edge ') ? ` data-edge="${item.key.slice('edge '.length)}"` : '';
  return `<g data-name="${escapeXml(name).replace(/"/g, '&quot;')}" data-line="${line}"${what}>\n${svg}\n</g>`;
}

/** An icon on its own, as a small SVG of `side` pixels: what the page puts beside a link. */
export function iconSvg(icon: Icon, side: number, theme: Theme): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}" font-family="system-ui, sans-serif">\n${drawIcon(icon, 0, 0, side, theme)}\n</svg>`;
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
function linked(svg: string, links: Link[] | undefined): string {
  const first = links?.[0];
  if (first === undefined || svg.length === 0) return svg;
  // A plain SVG can follow one address, so a click follows the first; the
  // tooltip names every link, so a reader learns there are others. A single
  // bare address gets no tooltip, so a file written before several links
  // draws exactly as it did.
  const named = links!.length > 1 || first.name !== undefined;
  const title = named ? `\n    <title>${escapeXml(links!.map((link) => linkLabel(link, links)).join('\n'))}</title>` : '';
  // An `&` between query parameters is ordinary in a url and illegal raw in an
  // attribute, so the value is escaped as markup rather than merely quoted.
  return `  <a href=${quote(escapeXml(first.href))} target="_blank" rel="noopener">${title}\n${svg}\n  </a>`;
}

/**
 * A line with a link and no text is its own target, and a line is too thin to
 * hit, so an unseen wider copy of its path catches the click.
 */
function lineTarget(line: string): string {
  const straight = line.match(/ x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"/);
  const d = straight ? `M${straight[1]} ${straight[2]} L${straight[3]} ${straight[4]}` : line.match(/ d="([^"]*)"/)?.[1];
  return d === undefined ? '' : `  <path d="${d}" fill="none" stroke="#000" stroke-opacity="0" stroke-width="12" pointer-events="stroke"/>`;
}

/** Whether a node holds anything besides its heading and what is joined to its text: what a theme draws as a container. */
function holdsContents(node: LayoutNode): boolean {
  return node.children.some((child) => child !== node.heading && !joinedToText(child));
}

/**
 * One thing in the drawing sequence: a node's own ink, a line, a point or a
 * region. `depth:` moves these (design.org 8.4).
 */
interface Drawn {
  /** A node's, point's or region's name, or `edge <n>` for the nth edge. */
  key: string;
  svg: string;
  node?: LayoutNode;
  /** The areas it fills, bottom first, for the patch behind a line's text to match. */
  fills?: Fill[];
}

/** An area something fills, and with what. */
interface Fill extends Box {
  color: string;
  opacity: number;
}

/** What a node fills of its own. */
function nodeFills(node: LayoutNode, theme: Theme): Fill[] {
  if (node.guide || node.body.kind !== 'shape') return [];
  const face = faceOf(node);
  const fills: Fill[] = [];
  const fill = fillOf(node.appearance, theme, holdsContents(node) ? containerFillOf(node, theme) : theme.boxFill);
  if (fill !== 'none') fills.push({ ...face, color: fill, opacity: 1 });
  return fills;
}

/**
 * The patch behind a line's text (design.org 7.3): the color drawn beneath
 * the text's middle, built up as it was drawn, so a tint over a container's
 * fill is matched as both; or the color its `fill:` states, or none.
 */
function patchSvg(patch: Patch, beneath: Drawn[], theme: Theme): string {
  const rect = `x="${round(patch.rect.x)}" y="${round(patch.rect.y)}" width="${round(patch.rect.width)}" height="${round(patch.rect.height)}"`;
  if (patch.fill === 'none') return '';
  if (patch.fill !== undefined) return `  <rect ${rect} fill="${themeColor(patch.fill, theme)}"/>`;
  const { x, y } = patch.center;
  const under = beneath.flatMap((drawn) => drawn.fills ?? []).filter((fill) => {
    if (fill.polygon) return insideOutline(fill.polygon, { x, y });
    if (!fill.round) return x >= fill.x && x <= fill.x + fill.width && y >= fill.y && y <= fill.y + fill.height;
    const r = Math.min(fill.width, fill.height) / 2;
    return Math.hypot(x - (fill.x + fill.width / 2), y - (fill.y + fill.height / 2)) <= r;
  });
  let base = -1;
  under.forEach((fill, index) => {
    if (fill.opacity >= 1) base = index;
  });
  return [
    `  <rect ${rect} fill="${base < 0 ? theme.background : under[base]!.color}"/>`,
    ...under.slice(base + 1).map((fill) => `  <rect ${rect} fill="${fill.color}" fill-opacity="${fill.opacity}"/>`),
  ].join('\n');
}

/** What shown guides need to know: whether they are shown, their color, and each kind's look. */
interface Guides {
  shown: boolean;
  color: string;
  looks: Layout['guideLooks'];
}

/** The dash a shown guide is drawn with, so construction is told apart from the picture. */
const GUIDE_DASH = '4 3';

/**
 * A node and everything inside it, in drawing order: the node's own ink, then
 * each child's. Each node's ink is its own item, wrapped in its own `<a>`, so
 * a destination never encloses a child's.
 */
function drawNode(
  node: LayoutNode,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
  guides: Guides,
  inherited?: Link[],
): Drawn[] {
  const url = linksOf(node.attrs) ?? inherited;
  let own: string[] = [];
  if (!node.guide) {
    own = nodeSvg(node, theme, measurer, fontSize, markup);
  } else if (guides.shown) {
    // A shown guide: its outline dashed in the guide color, unfilled, and its
    // text in the same color, unless `default guide node` or its own words say otherwise.
    const look = guides.looks.node;
    const said = (key: string) => node.attrs[key] ?? look[key];
    const shown: LayoutNode = {
      ...node,
      appearance: { ...node.appearance, fill: said('fill') ?? 'none', border: said('border') ?? guides.color },
      textAttrs: { ...node.textAttrs, color: node.textAttrs['color'] ?? look['text.color'] ?? guides.color },
    };
    own = nodeSvg(shown, theme, measurer, fontSize, markup).map((part) =>
      part.replace(/ stroke="([^"]*)"/g, (all, color: string) => (color === 'none' ? all : `${all} stroke-dasharray="${GUIDE_DASH}"`)),
    );
    if (node.body.kind === 'icon') own = [`  <g opacity="0.5">`, ...own, '  </g>'];
  }
  if (node.appearance['layout'] === 'venn' && !node.guide) return drawVenn(node, theme, measurer, fontSize, markup, guides, url);
  if (node.appearance['layout'] === 'deck' && !node.guide) return drawDeck(node, theme, measurer, fontSize, markup, guides, url);
  return [
    { key: node.name, node, svg: linked(own.join('\n'), url), fills: nodeFills(node, theme) },
    ...node.children.flatMap((child) => drawNode(child, theme, measurer, fontSize, markup, guides, url)),
  ];
}

/**
 * A deck: no outline of its own unless it states a fill or a border, and its
 * cards drawn back to front, so the first, the front card, is on top.
 */
function drawDeck(
  node: LayoutNode,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
  guides: Guides,
  url: Link[] | undefined,
): Drawn[] {
  const outlined = outlineStated(node.appearance);
  const drawn = outlined ? node : { ...node, appearance: { ...node.appearance, fill: 'none', border: 'none' } };
  const cards = node.children.filter((child) => child !== node.heading && !joinedToText(child));
  // The cards are the same thing, so each looks like the front one unless it says otherwise.
  const front = cards[0]!;
  const holds = holdsContents(front);
  const look = {
    fill: fillOf(front.appearance, theme, holds ? containerFillOf(front, theme) : theme.boxFill),
    border: borderOf(front.appearance, theme, holds ? theme.containerStroke : theme.boxStroke),
  };
  const like = (card: LayoutNode): LayoutNode =>
    card === front ? card : { ...card, appearance: { ...look, ...card.appearance } };
  return [
    { key: node.name, node, svg: linked(nodeSvg(drawn, theme, measurer, fontSize, markup).join('\n'), url), fills: nodeFills(drawn, theme) },
    ...[...cards].reverse().flatMap((card) => drawNode(like(card), theme, measurer, fontSize, markup, guides, url)),
    ...node.children
      .filter((child) => !cards.includes(child))
      .flatMap((child) => drawNode(child, theme, measurer, fontSize, markup, guides, url)),
  ];
}

/**
 * A venn (design.org 5.x): no box of its own unless it states one, and its
 * three parts drawn as one picture. The two sets' fills go down first, then
 * the overlap's over where they cross, then both sets' borders over all three
 * fills, so each border shows whole; then everything the parts hold. Each part
 * has a different fill unless it states its own: the left set the theme's
 * primary-subtle, the right its secondary-subtle, the overlap the two stacked.
 */
function drawVenn(
  node: LayoutNode,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
  guides: Guides,
  url: Link[] | undefined,
): Drawn[] {
  const plain = (part: LayoutNode, fill: string): LayoutNode => ({ ...part, appearance: { ...part.appearance, fill, border: 'none' } });
  const own = nodeSvg(plain(node, node.appearance['fill'] ?? 'none'), theme, measurer, fontSize, markup);
  if (node.appearance['border'] !== undefined) own.push(borderSvg(node, theme));
  const [left, shared, right] = node.children.filter((child) => child !== node.heading && !joinedToText(child)) as [LayoutNode, LayoutNode, LayoutNode];
  const leftFill = left.appearance['fill'] ?? 'theme-primary-subtle';
  const rightFill = right.appearance['fill'] ?? 'theme-secondary-subtle';
  const sharedFill = shared.appearance['fill'] ?? overlapFill(themeColor(leftFill, theme), theme);
  const item = (part: LayoutNode, key: string, svg: string[], fills: Fill[] = []): Drawn => ({ key, node: part, svg: linked(svg.join('\n'), linksOf(part.attrs) ?? url), fills });
  const filled = (part: LayoutNode, fill: string) => item(part, part.name, nodeSvg(plain(part, fill), theme, measurer, fontSize, markup), nodeFills(plain(part, fill), theme));
  const rest = (part: LayoutNode) => part.children.flatMap((child) => drawNode(child, theme, measurer, fontSize, markup, guides, linksOf(part.attrs) ?? url));
  return [
    { key: node.name, node, svg: linked(own.join('\n'), url), fills: nodeFills(plain(node, node.appearance['fill'] ?? 'none'), theme) },
    filled(left, leftFill),
    filled(right, rightFill),
    filled(shared, sharedFill),
    item(left, `${left.name} border`, [borderSvg(left, theme)]),
    item(right, `${right.name} border`, [borderSvg(right, theme)]),
    ...rest(left),
    ...rest(shared),
    ...rest(right),
    ...node.children
      .filter((child) => child !== left && child !== shared && child !== right)
      .flatMap((child) => drawNode(child, theme, measurer, fontSize, markup, guides, url)),
  ];
}

/** A container's border alone, unfilled. */
function borderSvg(node: LayoutNode, theme: Theme): string {
  if (node.body.kind !== 'shape') return '';
  const face = faceOf(node);
  const d = outlinePath(node.body.outline, face.x, face.y, face.width, face.height, node.corners, node.body.look);
  const stroke = borderStroke(node.borderWidth, `<path d="${d}"/>`, `rim-${node.name.replace(/[^\w.-]/g, '_')}`);
  const border = borderOf(node.appearance, theme, theme.containerStroke);
  return `${stroke.clip}  <path d="${d}" fill="none" stroke="${border}"${stroke.attr}/>`;
}

/**
 * How a border is stroked. A thick border lies wholly inside the outline: the
 * outline is stroked twice as wide and clipped to itself, so only the inner
 * half shows, and its outer edge is the outline exactly, along every side and
 * at every corner and point of every shape, where a line ends and a gap is
 * measured from (design.org 9.1). A normal border straddles the outline, as
 * every box's always did, and writes nothing here. `detail` is for the lines
 * drawn inside a shape, such as a cylinder's rim, which are as wide as the
 * border and straddle where they run.
 */
function borderStroke(width: number | undefined, outline: string, id: string): { clip: string; attr: string; detail: string } {
  if (width === undefined) return { clip: '', attr: '', detail: '' };
  return {
    clip: `  <clipPath id="${id}">${outline}</clipPath>\n`,
    attr: ` stroke-width="${round(width * 2)}" clip-path="url(#${id})"`,
    detail: ` stroke-width="${round(width)}" clip-path="url(#${id})"`,
  };
}

/** What a node draws of its own, without its children, which are drawn as items of their own. */
function nodeSvg(
  node: LayoutNode,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
): string[] {
  // A note is set smaller than a box text by default, and `size:` overrides
  // that on anything. Only this node's own text takes the size — children are
  // drawn by their own call and carry whatever they say themselves.
  const size = fontSizeFor(node.kind, node.textAttrs, fontSize, node.line);
  const textHeight = measurer.lineHeight(size);
  const blockWidth = widestLine(node.lines, measurer, size);
  const ink = (run: Run, own: string) => runInk(run, own, markup, theme);

  // No outline and no fill: only the text, and the children of an invisible
  // container, are drawn.
  if (node.body.kind === 'none') {
    const style = textStyleFor(node.textAttrs, node.line, 'start', 'center');
    // With no fill of its own, its text reads on whatever box it sits in:
    // a badge's heading text on a box filled theme-primary is that box's text.
    let behind = node.parent;
    while (behind && behind.body.kind === 'none') behind = behind.parent;
    const onFill = behind ? textOnFill(behind.appearance['fill'] ?? '', theme) : undefined;
    return [sized(
      textBlock(node.lines, node.x, node.y, measurer, size, node.textBox, {
        color: textColorOf(node.textAttrs, theme, onFill ?? theme.text),
        align: style.align,
        ink,
        reads: node.textAttrs['reads'],
      }),
      size,
      fontSize,
    )];
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
          textBlock(node.lines, node.x, node.y, measurer, size, node.textBox, {
            color: textColorOf(node.textAttrs, theme, theme.text),
            align: style.align,
            ink,
            reads: node.textAttrs['reads'],
          }),
          size,
          fontSize,
        ),
      );
    }
    return drawn;
  }

  const outline = node.body.outline;
  const look = node.body.look;
  const parts: string[] = [];
  const face = faceOf(node);
  // A node with children is colored as a backdrop however they are placed,
  // except its heading, which is its title: a badged box with nothing else in
  // it looks like the boxes beside it. Every rule that tried to tell a badge
  // from contents by looking was a guess; `badge:` and `heading:` say it.
  const container = holdsContents(node);
  const border = borderOf(node.appearance, theme, container ? theme.containerStroke : theme.boxStroke);
  const fill = fillOf(node.appearance, theme, container ? containerFillOf(node, theme) : theme.boxFill);
  // A box is the one kind with two inkable parts, which is why its text needs
  // a word of its own — `border:` cannot stand in for it. Left unsaid on a
  // theme fill, it is whatever reads on that fill: `fill: theme-primary` alone
  // makes a badge whose text is legible in every theme.
  const text = textColorOf(node.textAttrs, theme, textOnFill(node.appearance['fill'] ?? '', theme) ?? theme.text);

  // A title on the border breaks it: the stroke is masked where the title sits,
  // and the fill, drawn without a stroke, still shows behind the title's inner
  // half.
  const onBorder = node.lines.length > 0 && node.textAttrs['place']?.startsWith('on ') === true;
  const d = outlinePath(outline, face.x, face.y, face.width, face.height, node.corners, look);
  const stroke = borderStroke(node.borderWidth, `<path d="${d}"/>`, `border-${node.name.replace(/[^\w.-]/g, '_')}`);
  if (stroke.clip) parts.push(stroke.clip.trimEnd());
  if (onBorder) {
    const id = `title-${node.name.replace(/[^\w.-]/g, '_')}`;
    const room = PAD / 2;
    const hole = node.textBox;
    const grown = { x: face.x - PAD, y: face.y - PAD, w: face.width + PAD * 2, h: face.height + PAD * 2 };
    parts.push(
      `  <mask id="${id}" maskUnits="userSpaceOnUse" x="${round(grown.x)}" y="${round(grown.y)}" width="${round(grown.w)}" height="${round(grown.h)}">`,
      `    <rect x="${round(grown.x)}" y="${round(grown.y)}" width="${round(grown.w)}" height="${round(grown.h)}" fill="white"/>`,
      `    <rect x="${round(node.x + hole.x - room)}" y="${round(node.y + hole.y)}" width="${round(hole.width + room * 2)}" height="${round(hole.height)}" fill="black"/>`,
      '  </mask>',
      `  <path d="${d}" fill="${fill}" stroke="none"/>`,
      `  <path d="${d}" fill="none" stroke="${border}"${stroke.attr} mask="url(#${id})"/>`,
    );
  } else {
    parts.push(`  <path d="${d}" fill="${fill}" stroke="${border}"${stroke.attr}/>`);
  }
  for (const extra of outlineDetail(outline, face.x, face.y, face.width, face.height, look)) {
    parts.push(`  <path d="${extra}" fill="none" stroke="${border}"${stroke.detail}/>`);
  }

  // A leaf's text defaults to the middle of its box, a container's to the top
  // left of the band; both then read `at` for where it really goes. Where the
  // text sits is the resolver's answer, in `textBox`; only the alignment of
  // its lines against each other is read here. This follows the band, not the
  // colors: a badged leaf is a backdrop but its text still centers. A box
  // whose only children are joined to its text is a leaf, and its lines center
  // against each other as a leaf's do.
  // Collate's text sits on the point where its two triangles meet, so the
  // lines break behind it on a patch of its own fill, as a line's text does.
  const patch = node.textAttrs['fill'];
  if (outline === 'flow-collate' && patch !== 'none' && node.lines.length > 0) {
    const box = node.textBox;
    const reach = 4;
    const color = patch !== undefined ? themeColor(patch, theme) : fill === 'none' ? theme.background : fill;
    parts.push(
      `  <rect x="${round(node.x + box.x - reach)}" y="${round(node.y + box.y)}" width="${round(box.width + reach * 2)}" height="${round(box.height)}" fill="${color}"/>`,
    );
  }

  const titled = node.banded && container;
  const textStyle = textStyleFor(
    node.textAttrs,
    node.line,
    titled ? 'start' : 'middle',
    titled ? 'top-left' : 'center',
  );
  parts.push(
    sized(
      textBlock(node.lines, node.x, node.y, measurer, size, node.textBox, {
        color: text,
        align: textStyle.align,
        ink,
        reads: node.textAttrs['reads'],
      }),
      size,
      fontSize,
    ),
  );
  return parts;
}

/**
 * A named point or region (design.org 8.1, 8.3). A region is a light tint
 * with a quiet border, thin, at about half strength, solid, in the theme's
 * primary color; a point is a dot. A guide is drawn only when guides are
 * shown, dashed and unfilled in the guide color.
 */
function markSvg(mark: LayoutMark, theme: Theme, guides: Guides, markup: Record<string, string>, fontSize: number, measurer: Measurer): string {
  const said = (key: string) => mark.appearance[key] ?? (mark.guide ? guides.looks[mark.kind][key] : undefined);
  if (mark.guide && !guides.shown) return '';
  const color = (value: string | undefined) => (value === undefined ? undefined : themeColor(value, theme));
  const label = markTextSvg(mark, theme, mark.guide ? guides.color : theme.text, markup, fontSize, measurer);
  if (mark.kind === 'point') {
    const fill = color(said('fill')) ?? (mark.guide ? guides.color : theme.edge);
    return `  <circle cx="${round(mark.x)}" cy="${round(mark.y)}" r="3" fill="${fill}"/>${label}`;
  }
  // A region with no height or no width, such as one between two corners on
  // a line, is drawn as that line: a rectangle of no size draws nothing.
  const flat = mark.width < 0.5 || mark.height < 0.5;
  const box = flat
    ? `d="M${round(mark.x)} ${round(mark.y)}L${round(mark.x + mark.width)} ${round(mark.y + mark.height)}"`
    : `x="${round(mark.x)}" y="${round(mark.y)}" width="${round(mark.width)}" height="${round(mark.height)}" rx="4"`;
  const shape = flat ? 'path' : 'rect';
  // A thick border lies inside the region's stated edge, as a box's does; one
  // drawn as a line has no inside, so it is only wider.
  const edge = flat
    ? { clip: '', attr: mark.borderWidth === undefined ? '' : ` stroke-width="${round(mark.borderWidth)}"` }
    : borderStroke(mark.borderWidth, `<rect ${box}/>`, `edge-${mark.name.replace(/[^\w.-]/g, '_')}`);
  // A text on the border breaks it, as a title on a box's border does.
  const hole = mark.text && mark.text.textAttrs['place']?.startsWith('on ') ? mark.text.box : undefined;
  const id = `region-${mark.name.replace(/[^\w.-]/g, '_')}`;
  const masked = hole
    ? `  <mask id="${id}" maskUnits="userSpaceOnUse" x="${round(mark.x - PAD)}" y="${round(mark.y - PAD)}" width="${round(mark.width + PAD * 2)}" height="${round(mark.height + PAD * 2)}">\n` +
      `    <rect x="${round(mark.x - PAD)}" y="${round(mark.y - PAD)}" width="${round(mark.width + PAD * 2)}" height="${round(mark.height + PAD * 2)}" fill="white"/>\n` +
      `    <rect x="${round(hole.x - PAD / 2)}" y="${round(hole.y)}" width="${round(hole.width + PAD)}" height="${round(hole.height)}" fill="black"/>\n` +
      '  </mask>\n'
    : '';
  const mask = hole ? ` mask="url(#${id})"` : '';
  if (mark.guide) {
    const fill = color(said('fill')) ?? 'none';
    const border = color(said('border')) ?? guides.color;
    return `${edge.clip}${masked}  <${shape} ${box} fill="${fill}" stroke="${border}"${edge.attr} stroke-dasharray="${GUIDE_DASH}"${mask}/>${label}`;
  }
  const fill = regionFill(mark, theme);
  const border = color(said('border'));
  const opacity = fill.color === 'none' || fill.opacity >= 1 ? '' : ` fill-opacity="${round(fill.opacity)}"`;
  return (
    `${edge.clip}${masked}  <${shape} ${box} fill="${fill.color}"${opacity}` +
    ` stroke="${border ?? theme.primary.color}"${border === undefined ? ' stroke-opacity="0.5"' : ''}${edge.attr || ' stroke-width="1"'}${mask}/>${label}`
  );
}

/**
 * A region's fill (design.org 8.3): what it states, or the theme's tint, at
 * half opacity unless it says otherwise, so overlapping regions show both and
 * a region never hides what it covers.
 */
function regionFill(mark: LayoutMark, theme: Theme): { color: string; opacity: number } {
  const said = mark.appearance['opacity'];
  const opacity = said === undefined ? REGION_OPACITY : Number(said);
  const stated = mark.appearance['fill'];
  if (stated === undefined) return regionTint(theme, opacity);
  return { color: themeColor(stated, theme), opacity };
}

/** How opaque a region's fill is when it doesn't say. */
const REGION_OPACITY = 0.5;

/** What a region fills, for the patch behind a line's text: nothing for a guide, a point or a flat region. */
function markFills(mark: LayoutMark, theme: Theme): Fill[] {
  if (mark.kind !== 'region' || mark.guide || mark.width < 0.5 || mark.height < 0.5) return [];
  const fill = regionFill(mark, theme);
  if (fill.color === 'none' || fill.opacity <= 0) return [];
  return [{ x: mark.x, y: mark.y, width: mark.width, height: mark.height, ...fill }];
}

/** A point's or a region's text (design.org 7.4), on a line of its own after the mark. */
function markTextSvg(mark: LayoutMark, theme: Theme, fallback: string, markup: Record<string, string>, fontSize: number, measurer: Measurer): string {
  const text = mark.text;
  if (!text) return '';
  const align = text.textAttrs['align'];
  const block = textBlock(text.lines, 0, 0, measurer, text.size, text.box, {
    color: textColorOf(text.textAttrs, theme, fallback),
    align: align === 'left' || align === 'top' ? 'start' : align === 'right' || align === 'bottom' ? 'end' : 'middle',
    ink: (run, own) => runInk(run, own, markup, theme),
    reads: text.textAttrs['reads'],
  });
  return `\n${sized(block, text.size, fontSize)}`;
}

/**
 * The drawing sequence (design.org 8.3, 8.4). By default a container comes
 * before its own children, boxes before regions, regions before lines, and
 * points last. A region goes in front of every box it doesn't name and behind
 * what it does: the boxes it names, with what is inside them, are drawn after
 * it. Then each `depth:` moves one thing, with what is inside it, to just
 * before or just after another, and moves nothing else.
 */
function order(boxes: Drawn[], marks: { mark: LayoutMark; item: Drawn }[], lines: Drawn[], depths: DepthStatement[]): Drawn[] {
  const inside = (item: Drawn, names: Set<string>) => {
    for (let at = item.node; at; at = at.parent) if (names.has(at.name)) return true;
    return names.has(item.key);
  };
  let sequence = [...boxes];
  for (const { mark, item } of marks) {
    if (mark.kind !== 'region') continue;
    const names = new Set(mark.names);
    const named = sequence.filter((drawn) => inside(drawn, names));
    sequence = [...sequence.filter((drawn) => !inside(drawn, names)), item, ...named];
  }
  sequence.push(...lines, ...marks.filter(({ mark }) => mark.kind === 'point').map(({ item }) => item));

  const position = (key: string) => sequence.findIndex((drawn) => drawn.key === key);
  /** A thing and what is inside it, which move together. */
  const group = (key: string) => {
    const head = sequence.find((drawn) => drawn.key === key)!;
    return sequence.filter((drawn) => drawn === head || (head.node !== undefined && drawn.node !== undefined && drawn.node !== head.node && inside(drawn, new Set([key]))));
  };
  const holds = (outer: string, inner: string) => group(outer).some((drawn) => drawn.key === inner && drawn.key !== outer);

  for (const depth of depths) {
    for (const clause of depth.clauses) {
      for (const name of clause.names) {
        if (holds(depth.subject, name) && clause.way === 'in front of') {
          throw new SourceError(
            `${depth.written}: depth: in front of "${name}", which is inside it — a container is drawn before its own children`,
            depth.line,
          );
        }
        if (holds(name, depth.subject) && clause.way === 'behind') {
          throw new SourceError(
            `${depth.written}: depth: behind "${name}", which holds it — a container is drawn before its own children`,
            depth.line,
          );
        }
      }
      // A hidden guide line is not in the sequence: it neither moves nor is moved against.
      if (position(depth.subject) < 0) continue;
      const targets = clause.names.filter((name) => position(name) >= 0 && !holds(depth.subject, name) && !holds(name, depth.subject));
      if (targets.length === 0) continue;
      const moving = group(depth.subject);
      sequence = sequence.filter((drawn) => !moving.includes(drawn));
      const at =
        clause.way === 'behind'
          ? Math.min(...targets.map(position))
          : Math.max(...targets.map((name) => position(name))) + 1;
      sequence.splice(at, 0, ...moving);
    }
  }
  // A later move can undo an earlier one only where the file asks for a cycle.
  for (const depth of depths) {
    for (const clause of depth.clauses) {
      for (const [index, name] of clause.names.entries()) {
        if (holds(depth.subject, name) || holds(name, depth.subject)) continue;
        // A hidden guide line is not in the sequence, so nothing is in front of or behind it.
        if (position(name) < 0 || position(depth.subject) < 0) continue;
        const holdsNow = clause.way === 'behind' ? position(depth.subject) < position(name) : position(depth.subject) > position(name);
        if (holdsNow) continue;
        const others = depths
          .filter((other) => other !== depth && (other.subject === name || other.clauses.some((c) => c.names.includes(depth.subject))))
          .map((other) => `${other.written}'s depth: ${other.clauses.map((c) => `${c.way} ${c.shown.join(', ')}`).join(', ')} (line ${other.line})`);
        throw new SourceError(
          `${depth.written}: depth: ${clause.way} "${clause.shown[index] ?? name}" can't hold together with ${others.length > 0 ? others.join(' and ') : 'the other depth: statements'} — ` +
            'they ask for a circle in the drawing order, so one of them has to go',
          depth.line,
        );
      }
    }
  }
  return sequence;
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

/**
 * The node's outline, as path data. `corners: sharp` squares a rectangle's
 * corners and a document's three round ones; the fold and the circle are as
 * they are either way.
 */
function outlinePath(shape: Outline, x: number, y: number, w: number, h: number, corners: NodeCorners, look: ShapeLook = {}): string {
  const r = CORNER;
  const fold = shape === 'document' ? (look.fold ?? FOLD) : FOLD;
  if (!isBoxy(shape) && !isRound(shape, w, h)) return placePath(shapeOf(shape, look, w, h).path, x, y);
  if (corners === 'sharp' && shape !== 'circle') {
    return [
      `M${round(x)} ${round(y)}`,
      ...(shape === 'document' ? [`H${round(x + w - fold)}`, `L${round(x + w)} ${round(y + fold)}`] : [`H${round(x + w)}`]),
      `V${round(y + h)}`,
      `H${round(x)}`,
      'Z',
    ].join(' ');
  }
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
  if (shape === 'document') {
    // Every corner rounded but the top-right one, which is cut away and folded.
    return [
      `M${round(x + r)} ${round(y)}`,
      `H${round(x + w - fold)}`,
      `L${round(x + w)} ${round(y + fold)}`,
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

/** Lines drawn inside the outline: the flap of a fold, a subprocess's bars, a cylinder's near rim. */
function outlineDetail(shape: Outline, x: number, y: number, w: number, h: number, look: ShapeLook = {}): string[] {
  if (shape === 'document') {
    const fold = look.fold ?? FOLD;
    return [`M${round(x + w - fold)} ${round(y)} V${round(y + fold)} H${round(x + w)}`];
  }
  if (shape === 'flow-subprocess') {
    const inset = SUBPROCESS_INSET;
    return [`M${round(x + inset)} ${round(y)} V${round(y + h)} M${round(x + w - inset)} ${round(y)} V${round(y + h)}`];
  }
  if (isBoxy(shape) || isRound(shape, w, h)) return [];
  return shapeOf(shape, look, w, h).detail.map((d) => placePath(d, x, y));
}

/**
 * A letter badge's circle and letters. Unsaid, the circle is one of the
 * theme's two accents, picked from the letters so the same letters always get
 * the same one, and the letters are that accent's own text color; a stated
 * fill with no text color takes the theme's text color.
 */
export function letterColors(icon: LetterIcon, theme: Theme): { fill: string; text: string } {
  const sum = [...icon.letters].reduce((total, char) => total + char.codePointAt(0)!, 0);
  const accent = sum % 2 === 0 ? theme.primary : theme.secondary;
  const fill = icon.fill === undefined ? accent.color : themeColor(icon.fill, theme);
  const text = icon.text !== undefined ? themeColor(icon.text, theme) : icon.fill === undefined ? accent.on : theme.text;
  return { fill, text };
}

/** One icon, scaled from its own grid onto a square of `side` at `x, y`. */
function drawIcon(icon: Icon, x: number, y: number, side: number, theme: Theme): string {
  if ('letters' in icon) {
    const colors = letterColors(icon, theme);
    const r = side / 2;
    // Letters shrink as there are more of them, so two or three still fit the circle.
    const size = round(side * (icon.letters.length <= 1 ? 0.55 : icon.letters.length === 2 ? 0.42 : 0.32));
    return [
      `  <circle cx="${round(x + r)}" cy="${round(y + r)}" r="${round(r)}" fill="${colors.fill}"/>`,
      `  <text x="${round(x + r)}" y="${round(y + r)}" text-anchor="middle" dominant-baseline="central" font-size="${size}px" font-weight="700" fill="${colors.text}">${escapeXml(icon.letters)}</text>`,
    ].join('\n');
  }
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
  /** Its text, after it, with a marker where each text's patch goes. */
  rest: string[];
  /** The patch behind each text, drawn once the drawing order says what lies beneath it. */
  patches: Patch[];
  ink: Extent;
  /** The line as a polyline, curves flattened, for sliding its text along. */
  trace: Point[];
  /** What is drawn of it, one polyline per part, for finding where lines cross: a line along a bus is two. */
  traces: Point[][];
  color: string;
  stroke: string;
}

/** The patch behind one text on a line: the line's knockout under the words. */
interface Patch {
  /** The item in the edge's `rest` it replaces. */
  marker: string;
  rect: { x: number; y: number; width: number; height: number };
  /** The middle of the words, where what lies beneath is judged. */
  center: Point;
  /** The text's own `fill:`, when it states one. */
  fill?: string;
}

function drawEdge(
  edge: LayoutEdge,
  route: Route,
  theme: Theme,
  measurer: Measurer,
  fontSize: number,
  markup: Record<string, string>,
): DrawnEdge {
  const color = lineOf(edge.appearance, theme, theme.edge);
  const stroke = strokeOf(color, edge.look);

  const markerEnd = edge.marks.to !== 'none' ? ` marker-end="url(#${markerId(edge.marks.to, color, freeEnd(edge, 'to'))})"` : '';
  const markerStart =
    edge.marks.from !== 'none' ? ` marker-start="url(#${markerId(edge.marks.from, color, freeEnd(edge, 'from'))})"` : '';

  const points = route.points;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const parts: string[] = [];
  // What the line actually covers, so the canvas can be sized to hold it. A
  // line stepping out of a `top` side rides above every box in the drawing,
  // and the node bounds know nothing about it.
  let ink = extentOfPoints(points);

  if (route.hidden) {
    // A line along a collapsed bundle: drawn up to where it merges and from
    // where it splits, the bus between drawn once by the bundle (6.6). One
    // path of several parts, so its marks stay at its own two ends.
    const d = visibleRuns(route)
      .map((run) => {
        if (run.pieces.some((piece) => 'c1' in piece)) return piecesPath(run);
        const corners = [run.start, ...run.pieces.map((piece) => piece.to)];
        return edge.look.corners === 'rounded' && corners.length > 2 ? roundedPath(corners, arrowLength(edge.look.thickness)) : sharpPath(corners);
      })
      .join(' ');
    parts.push(`  <path d="${d}" fill="none"${stroke}${markerEnd}${markerStart}/>`);
    ink = extentOfPoints(traceRoute(route));
  } else if (route.pieces.some((piece) => 'c1' in piece)) {
    // A curved line is a spline through its points (design.org 6.3); a
    // straight leg of it, or a run along a side, stays straight.
    const lead = arrowLength(edge.look.thickness);
    const d = piecesPath(route, { start: edge.marks.from !== 'none' ? lead : 0, end: edge.marks.to !== 'none' ? lead : 0 });
    parts.push(`  <path d="${d}" fill="none"${stroke}${markerEnd}${markerStart}/>`);
    ink = extentOfPoints(traceRoute(route));
  } else if (points.length > 2) {
    const d =
      edge.look.corners === 'rounded' ? roundedPath(points, arrowLength(edge.look.thickness)) : sharpPath(points);
    parts.push(`  <path d="${d}" fill="none"${stroke}${markerEnd}${markerStart}/>`);
  } else {
    parts.push(
      `  <line x1="${round(start.x)}" y1="${round(start.y)}" x2="${round(end.x)}" y2="${round(end.y)}"${stroke}${markerEnd}${markerStart}/>`,
    );
  }

  // Each text is a measurement on the drawn line (design.org 7.3). A text
  // breaks on ` / ` exactly as a box text does, so a two-line caption on an
  // arrow needs no vocabulary of its own.
  const rest: string[] = [];
  const patches: Patch[] = [];
  for (const placed of placeLineTexts(edge, route)) {
    const { text, center, angle } = placed;
    const { width, height } = text;
    const top = center.y - height / 2;
    const turn = angle === 0 ? '' : ` transform="rotate(${round(angle)} ${round(center.x)} ${round(center.y)})"`;
    // The text knocks a hole in whatever it lands on rather than sitting in
    // a chip of its own: an outlined box reads as a node, which is the one
    // thing a text on a line is not.
    const pad = patchPadding(text, `edge ${edge.from.name} ${edge.arrow} ${edge.to.name}`, edge.line);
    const marker = `\u0000patch ${patches.length}`;
    patches.push({
      marker,
      rect: { x: center.x - width / 2 - pad.x, y: top - pad.y, width: width + pad.x * 2, height: height + pad.y * 2 },
      center,
      ...(text.textAttrs['fill'] !== undefined ? { fill: text.textAttrs['fill'] } : {}),
    });
    rest.push(
      ...(turn ? ['  <g' + turn + '>'] : []),
      marker,
      sized(
        textBlock(text.lines, center.x - width / 2, top, measurer, text.size,
          { x: 0, y: 0, width, height },
          {
            // A colored edge carries its meaning into its text; an uncolored
            // one leaves the words to read as ordinary text.
            color: textColorOf(text.textAttrs, theme, lineOf(edge.appearance, theme, theme.text)),
            align: 'middle',
            ink: (run, own) => runInk(run, own, markup, theme),
          },
        ),
        text.size,
        fontSize,
      ),
      ...(turn ? ['  </g>'] : []),
    );
    ink = union(ink, placed.box);
  }

  // The stroke straddles the path, so half of it lies outside the geometry.
  const [line] = parts;
  return {
    edge,
    line: line!,
    rest,
    ink: grow(ink, edge.look.thickness / 2),
    trace: route.hidden ? traceRoute(route) : tracesOf(line!)[0]!,
    traces: tracesOf(line!),
    color,
    patches,
    stroke,
  };
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

function sharpPath(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`).join(' ');
}

/** A line's path, from its pieces. */
function piecesPath(route: { start: Point; pieces: Route['pieces'] }, leads: { start: number; end: number } = { start: 0, end: 0 }): string {
  const parts = [`M ${round(route.start.x)} ${round(route.start.y)}`];
  let from = route.start;
  const last = route.pieces.length - 1;
  for (const [index, piece] of route.pieces.entries()) {
    if (!('c1' in piece)) {
      parts.push(`L ${round(piece.to.x)} ${round(piece.to.y)}`);
      from = piece.to;
      continue;
    }
    // Under a mark the curve runs straight, so the line goes into the mark
    // along its axis instead of bending out of its side. The handles stay
    // put, on the same axis, so the curve leaves and arrives the same way.
    const { c1, c2, to } = piece;
    const room = Math.hypot(to.x - from.x, to.y - from.y);
    const lead = (length: number, toward: Point, at: Point): Point | undefined => {
      const span = Math.hypot(toward.x - at.x, toward.y - at.y);
      if (length <= 0 || span < 1e-6 || room < length * 3) return undefined;
      return { x: ((toward.x - at.x) / span) * length, y: ((toward.y - at.y) / span) * length };
    };
    const head = index === 0 ? lead(leads.start, c1, from) : undefined;
    const tail = index === last ? lead(leads.end, c2, to) : undefined;
    if (head) {
      from = { x: from.x + head.x, y: from.y + head.y };
      parts.push(`L ${round(from.x)} ${round(from.y)}`);
    }
    const end = tail ? { x: to.x + tail.x, y: to.y + tail.y } : to;
    parts.push(`C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`);
    if (tail) parts.push(`L ${round(to.x)} ${round(to.y)}`);
    from = to;
  }
  return parts.join(' ');
}

/**
 * A drawn line's element read back as polylines, curves flattened, one for
 * each part the path draws (a line along a bus has two). Reading the element
 * rather than each drawing branch keeping its own record means the crossings
 * are found on exactly what was drawn.
 */
function tracesOf(element: string): Point[][] {
  const line = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/.exec(element);
  if (line) {
    return [[
      { x: Number(line[1]), y: Number(line[2]) },
      { x: Number(line[3]), y: Number(line[4]) },
    ]];
  }
  const d = /d="([^"]*)"/.exec(element)?.[1] ?? '';
  const tokens = d.match(/[MLC]|-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? [];
  const parts: Point[][] = [];
  let points: Point[] = [];
  let command = 'M';
  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index]!;
    if (/[MLC]/.test(token)) {
      command = token;
      if (token === 'M' && points.length > 0) {
        parts.push(points);
        points = [];
      }
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
  if (points.length > 0) parts.push(points);
  return parts;
}

// --- crossings ------------------------------------------------------------------

/** Where one line crosses an earlier one, and which way it is heading there. */
interface Crossing {
  at: Point;
  along: Point;
  /** Half the length of line the crossing takes out. */
  reach: number;
}

/** `depth:` naming a leg: which of two lines is on top where they cross on that leg. */
interface LegDepth {
  top: DrawnEdge;
  pair: [DrawnEdge, DrawnEdge];
  trace: Point[];
}

/**
 * Where each line with a `crossing:` style crosses a line under it. Lines come
 * in drawing order, and the one drawn later is on top and jumps, so the file's
 * order says who goes over unless `depth:` moved one; a `depth:` naming a leg
 * turns over only the crossings on that leg. A line never jumps where it
 * leaves or arrives — a crossing that close to an end is two lines meeting at
 * a box, not passing each other.
 */
function findCrossings(drawn: DrawnEdge[], onLeg: LegDepth[]): Map<DrawnEdge, Crossing[]> {
  const found = new Map<DrawnEdge, Crossing[]>();
  drawn.forEach((later, index) => {
    for (const earlier of drawn.slice(0, index)) {
      const turned = onLeg.filter((one) => one.pair.includes(later) && one.pair.includes(earlier));
      const thickness = Math.max(later.edge.look.thickness, earlier.edge.look.thickness);
      const clear = 3 + thickness * 2 + arrowLength(thickness);
      const points = later.traces.flatMap((a) => earlier.traces.flatMap((b) => crossingPoints(a, b, clear)));
      for (const { at, along, other } of points) {
        const leg = turned.find((one) => nearTrace(one.trace, at));
        const [top, under] = leg && leg.top === earlier ? [earlier, later] : [later, earlier];
        if (top.edge.look.crossing === 'none') continue;
        const reach = 3 + top.edge.look.thickness * 1.5 + under.edge.look.thickness / 2;
        const crossings = found.get(top) ?? [];
        if (crossings.some((c) => Math.hypot(c.at.x - at.x, c.at.y - at.y) < (c.reach + reach) * 1.2)) continue;
        crossings.push({ at, along: top === later ? along : other, reach });
        found.set(top, crossings);
      }
    }
  });
  return found;
}

/** Whether a point lies on a polyline. */
function nearTrace(trace: Point[], at: Point): boolean {
  for (let index = 1; index < trace.length; index += 1) {
    const a = trace[index - 1]!;
    const b = trace[index]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const t = Math.max(0, Math.min(1, ((at.x - a.x) * (b.x - a.x) + (at.y - a.y) * (b.y - a.y)) / (length * length)));
    if (Math.hypot(a.x + (b.x - a.x) * t - at.x, a.y + (b.y - a.y) * t - at.y) < 1.5) return true;
  }
  return false;
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

/** The most a square line's corner is rounded by. */
const ROUTE_RADIUS = 20;

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
      return `<circle cx="5" cy="5" r="3.4" ${outline}/>`;
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

/**
 * Whether a line's end is free of any box: on another line, at a named point,
 * or a bundle's own end. A dot there is a junction, centered on the point.
 */
function freeEnd(edge: LayoutEdge, which: 'from' | 'to'): boolean {
  return edge.bundle !== undefined || edge.onLine?.[which] !== undefined || edge.onMark?.[which] === 'point';
}

/**
 * One marker, drawn at either end: `auto-start-reverse` turns it round at the
 * start. A dot keeps an ordinary line's size on any line, since scaled with a
 * thick line it became a blob. At a box it sits just outside the border; at a
 * free end it is centered on the point, since set back like an arrowhead, two
 * dots meeting at one point from either side ran together.
 */
function markMarker(mark: Mark, color: string, background: string, free: boolean): string {
  const round = mark === 'dot' || mark === 'odot';
  const size = round ? ` markerUnits="userSpaceOnUse" markerWidth="${ARROW_MARKER_WIDTH * LINE_WIDTH}" markerHeight="${ARROW_MARKER_WIDTH * LINE_WIDTH}"` : ` markerWidth="${ARROW_MARKER_WIDTH}" markerHeight="${ARROW_MARKER_WIDTH}"`;
  return [
    `    <marker id="${markerId(mark, color, free)}" viewBox="0 0 10 10" refX="${round && free ? 5 : 9}" refY="5"${size} orient="auto-start-reverse">`,
    `      ${markShape(mark, color, background)}`,
    '    </marker>',
  ].join('\n');
}

function markerId(mark: Mark, color: string, free: boolean): string {
  return `${mark}-${color.replace(/[^a-zA-Z0-9]/g, '')}${free && (mark === 'dot' || mark === 'odot') ? '-free' : ''}`;
}

// --- small shared pieces ------------------------------------------------------

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The circle in this square is what is drawn, so a line meets that instead. */
  round?: boolean;
  /** Any other outline but a rectangle's, on the page. */
  polygon?: Point[];
}

/** The rectangle drawn, and whether it is round or another shape. */
function faceOf(node: LayoutNode): Box {
  const box: Box = {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    round: node.body.kind === 'shape' && isRound(node.body.outline, node.width, node.height),
  };
  if (node.body.kind === 'shape' && !isBoxy(node.body.outline) && !box.round) {
    box.polygon = shapeOf(node.body.outline, node.body.look, node.width, node.height).polygon.map((p) => ({ x: node.x + p.x, y: node.y + p.y }));
  }
  return box;
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
  heights: Measurer,
  fontSize: number,
  box: { x: number; y: number; width: number; height: number },
  style: {
    color: string;
    align: 'start' | 'middle' | 'end';
    ink: (run: Run, own: string) => string;
    /** `reads: up` or `down` (design.org 7.2): the block is laid out level and turned about its middle. */
    reads?: string;
  },
): string {
  if (style.reads === 'up' || style.reads === 'down') {
    // `box` is the turned ink, so the level block is the same box on its side.
    const cx = x + box.x + box.width / 2;
    const cy = y + box.y + box.height / 2;
    const level = { x: cx - box.height / 2, y: cy - box.width / 2, width: box.height, height: box.width };
    const inner = textBlock(lines, 0, 0, heights, fontSize, level, { ...style, reads: undefined });
    return `  <g transform="rotate(${style.reads === 'up' ? -90 : 90} ${round(cx)} ${round(cy)})">\n${inner}\n  </g>`;
  }
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
  // Each line is as tall as its largest text (design.org 7.1), so the lines are
  // stacked by their own heights rather than at one spacing.
  let lineTop = top;
  return lines
    .map((line) => {
      const tall = lineTall(line, heights, fontSize);
      const largest = lineSize(line, fontSize);
      const at = lineTop;
      lineTop += tall;
      if (plain(line).length === 0) return '';
      // The runs on a line share one baseline, set by the largest of them.
      const baseline = at + tall / 2 + largest * 0.35;
      // One `<text>` per line, with a `<tspan>` per run inside it, so the runs
      // flow from the line's own anchor and a mark never moves a character.
      // A line drawn in one color and one size says so on the `<text>` and
      // emits no spans at all, which is what keeps a whole quiet line identical
      // to what the `subtext:` it replaced produced.
      const colors = line.map((run) => style.ink(run, style.color));
      const sizes = line.map((run) => run.size);
      const uniform = colors.every((color) => color === colors[0]) && sizes.every((size) => size === sizes[0]);
      const sizeAttr = (size: number | undefined) => (size === undefined ? '' : ` font-size="${size}px"`);
      const body = uniform
        ? escapeXml(plain(line))
        : line
            .map((run, run_index) => {
              const fill = colors[run_index] === style.color ? '' : ` fill="${colors[run_index]}"`;
              const sized = sizeAttr(run.size);
              return fill || sized ? `<tspan${fill}${sized}>${escapeXml(run.text)}</tspan>` : escapeXml(run.text);
            })
            .join('');
      return `  <text x="${round(anchorX)}" y="${round(baseline)}" fill="${uniform ? colors[0] ?? style.color : style.color}"${uniform ? sizeAttr(sizes[0]) : ''} text-anchor="${style.align}">${body}</text>`;
    })
    .filter((element) => element.length > 0)
    .join('\n');
}

/**
 * The color a marked-up run is drawn in. The mark names a *style*, never a
 * color, so the word borrows a meaning the file already has rather than
 * restating a value that goes stale the day the thing it means is recolored.
 * The resolver has already refused a mark naming a style that does not exist or
 * that gives text neither a color nor a size; a style that lends only a size
 * leaves the run in the text's own color.
 */
function runInk(
  run: Run,
  own: string,
  markup: Record<string, string>,
  theme: Theme,
): string {
  const color = run.style === undefined ? undefined : markup[run.style];
  return color === undefined ? own : themeColor(color, theme);
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

/**
 * A container's fill when it states none. A container inside another one is a
 * step further from the page than the fill it sits on, the same step the theme
 * takes from the page to a container, so engine inside host reads as a second
 * backdrop rather than as host showing through. An invisible container is
 * passed over, since nothing of it is drawn to sit on.
 */
function containerFillOf(node: LayoutNode, theme: Theme): string {
  let below = node.parent;
  // A container that draws no fill is not a layer: an invisible one, or a deck that states none.
  const unfilled = (one: LayoutNode) =>
    one.body.kind === 'none' || !holdsContents(one) || (one.appearance['layout'] === 'deck' && one.appearance['fill'] === undefined);
  while (below !== undefined && unfilled(below)) below = below.parent;
  if (below === undefined) return theme.containerFill;
  const base = fillOf(below.appearance, theme, containerFillOf(below, theme));
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  if (!/^#[0-9a-f]{6}$/i.test(base)) return theme.containerFill;
  let out = '#';
  for (const at of [1, 3, 5]) {
    const step = channel(theme.containerFill, at) - channel(theme.background, at);
    out += Math.max(0, Math.min(255, channel(base, at) + step)).toString(16).padStart(2, '0');
  }
  return out;
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
