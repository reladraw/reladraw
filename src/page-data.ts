import { fileChecks, findings, type Finding } from './checks.js';
import { SourceError } from './errors.js';
import type { DrawOptions } from './index.js';
import { blame, parse } from './parser.js';
import type { Icon } from './icons.js';
import { linkLabel, linksOf, type Link } from './links.js';
import { markdownHtml } from './markdown.js';
import type { Layout, LayoutNode } from './model.js';
import { iconSvg, renderTagged, themeOf } from './render.js';
import { resolve } from './resolve.js';
import { DEFAULT_THEME, luminance, THEME_NAMES, THEMES, type Theme } from './themes.js';

/**
 * What a page shows of one diagram: its drawing in every theme, what can be
 * selected in it, and its findings. `page.ts` writes these into a page; a page
 * that redraws as it is edited makes them in the browser, so this module is
 * kept apart from the page's own markup and script, which it has no need of.
 */
/**
 * The page's data for `source`, as a served page takes it when its file
 * changes or its editor is typed in: the same parse, layout, drawings and
 * findings `drawPage` puts in the page it writes. Runs in the browser too.
 */
export function pageData(
  source: string,
  file: string,
  options: DrawOptions = {},
  at: Date = new Date(),
): { title: string; drawn: string; data: PageData } {
  const parts = partsOf(source, file, options, at);
  return { title: parts.title, drawn: parts.drawn, data: dataOf(parts) };
}

export function partsOf(source: string, file: string, options: DrawOptions, at: Date): PageParts {
  const name = file.replace(/\.[^.]+$/, '') || file;
  const drawn = `drawn from ${file}, ${stamp(at)}`;
  const run = (text: string): PageParts => {
    const layout = resolve(parse(text), options);
    const found =
      options.checks === false ? [] : findings(layout, options.checks ? options.checks(fileChecks(layout)) : fileChecks(layout));
    const title = layout.diagram['title'] ?? name;
    // The theme it was drawn in: the one --theme named, else the file's.
    const named = layout.diagram['theme'];
    const current =
      (options.theme && THEME_NAMES.find((one) => THEMES[one] === options.theme)) ??
      (named !== undefined && THEMES[named] !== undefined ? named : DEFAULT_THEME);
    // The same diagram drawn in every theme, for the page's theme picker. A
    // theme moves nothing, so only the colors differ between them. A page or
    // text color the file states still holds in each, as in the playground.
    // Guides start as the file or --guides says, and the View menu's switch
    // shows the drawing the other way. A diagram with no guides draws the
    // same both ways, so it carries one drawing.
    const guidesShown = options.guides ?? layout.diagram['guides'] === 'show';
    const guideCount =
      layout.nodes.filter((node) => node.guide).length +
      layout.edges.filter((edge) => edge.guide).length +
      layout.marks.filter((mark) => mark.guide).length;
    const drawAll = (guides: boolean): Record<string, ThemeView> => {
      const themes: Record<string, ThemeView> = {};
      for (const one of THEME_NAMES) {
        const drawnIn = { ...options, guides, theme: options.theme && one === current ? options.theme : THEMES[one]! };
        const theme = themeOf(layout, drawnIn);
        themes[one] = { ...renderTagged(layout, drawnIn), theme, colors: colorsOf(theme), scheme: schemeOf(theme) };
      }
      // A --theme that is not one of the named ones is drawn as given, and offered as such.
      if (themes[current] === undefined) {
        const drawnIn = { ...options, guides };
        const theme = themeOf(layout, drawnIn);
        themes[current] = { ...renderTagged(layout, drawnIn), theme, colors: colorsOf(theme), scheme: schemeOf(theme) };
      }
      return themes;
    };
    const themes = drawAll(guidesShown);
    const flipped = guideCount > 0 ? drawAll(!guidesShown) : null;
    return {
      title,
      name,
      drawn,
      source,
      findings: found,
      themes,
      flipped,
      guidesShown,
      guideCount,
      current,
      graph: graphOf(layout, themes),
    };
  };
  try {
    return run(source);
  } catch (error) {
    throw error instanceof SourceError ? blame(source, error, run) : error;
  }
}

export interface PageParts {
  title: string;
  /** What a saved file is called, before its extension. */
  name: string;
  /** The line under the title saying which file the page was drawn from, and when. */
  drawn: string;
  /** The `.reladraw` text the page was drawn from, which Save gives back. */
  source: string;
  findings: Finding[];
  /** The diagram in each theme the picker offers, by name, with guides as the page opens. */
  themes: Record<string, ThemeView>;
  /** The same with guides the other way, or null when the diagram has none. */
  flipped: Record<string, ThemeView> | null;
  /** Whether the page opens with guides shown. */
  guidesShown: boolean;
  /** How many guides the diagram has, which the View menu shows. */
  guideCount: number;
  /** The theme the page opens in. */
  current: string;
  graph: Graph;
}

/** The diagram drawn in one theme, and the page's colors to go with it. */
interface ThemeView {
  /** The SVG as `render` writes it, which is what Save SVG and Save PNG save. */
  svg: string;
  /** The same drawing with each thing grouped and named, which is what is shown. */
  tagged: string;
  theme: Theme;
  /** The page's own colors, as CSS custom properties. */
  colors: Record<string, string>;
  /** The browser's controls: `dark`, `light`, or `light dark` when it can't be told. */
  scheme: string;
}

/** A link as the panel shows it: where it goes, what it is called, and its badge drawn in each theme. */
interface LinkView {
  href: string;
  label: string;
  badges: Record<string, string>;
}

/**
 * What a click on the page selects, and what the panel says about it: every
 * node with its text and links, and every line with its two ends, upstream
 * first. A line's index is its place in the layout, which `data-edge` names.
 */
interface Graph {
  nodes: Record<string, GraphNode>;
  edges: {
    up: string;
    down: string;
    label: string;
    links: LinkView[];
    description?: string;
    /** The styles it wears, by name, which a filter's `style:` matches. */
    styles: string[];
    guide?: true;
  }[];
}

interface GraphNode {
  label: string;
  links: LinkView[];
  description?: string;
  /** Where it is in the drawing's own units, `[x, y, width, height]`: where its letter goes, even when it draws nothing. */
  box: number[];
  /** The box it sits in, if any. */
  parent?: string;
  /** The boxes inside it, in the order written, leaving out a picture `badge:` puts beside its text. */
  children: string[];
  styles: string[];
  guide?: true;
  /** The picture a `badge:` writes out: part of its box's heading, never picked on its own. */
  badge?: true;
  /** Text with no outline and nothing inside, whose letter goes beside it rather than over its first words. */
  bare?: true;
}

/** A description as the panel shows it: its Markdown as HTML, or nothing. */
const describe = (attrs: Record<string, string>): { description?: string } =>
  attrs['description'] === undefined ? {} : { description: markdownHtml(attrs['description']) };

const BADGE_SIDE = 20;

function graphOf(layout: Layout, themes: Record<string, ThemeView>): Graph {
  const views = (links: Link[] | undefined): LinkView[] =>
    (links ?? []).map((link) => {
      const label = linkLabel(link, links);
      const icon: Icon =
        link.icon === undefined
          ? { letters: [...label.trim()][0]?.toUpperCase() ?? '?' }
          : 'picture' in link.icon
            ? layout.linkIcons[link.icon.picture]!
            : link.icon;
      const badges: Record<string, string> = {};
      for (const [one, view] of Object.entries(themes)) badges[one] = iconSvg(icon, BADGE_SIDE, view.theme);
      return { href: link.href, label, badges };
    });
  // A node with no links of its own has its container's, as a click on it in
  // the SVG follows its container's.
  const linksFor = (node: LayoutNode): Link[] | undefined => {
    for (let at: LayoutNode | undefined = node; at; at = at.parent) {
      const own = linksOf(at.attrs);
      if (own !== undefined) return own;
    }
    return undefined;
  };
  // A badge's picture is joined to its box's text by `badge:`, not by a
  // `join-with:` anyone wrote.
  const isBadge = (node: LayoutNode) => node.joinWith === 'text' && node.attrs['join-with'] === undefined;
  const nodes: Graph['nodes'] = {};
  for (const node of layout.nodes) {
    const text = plainText(node.text);
    nodes[node.name] = {
      label: text === '' ? node.name.split('.').pop()! : text,
      links: views(linksFor(node)),
      ...describe(node.attrs),
      box: [node.x, node.y, node.width, node.height].map((n) => Math.round(n * 10) / 10),
      ...(node.parent ? { parent: node.parent.name } : {}),
      children: node.children.filter((child) => !isBadge(child)).map((child) => child.name),
      styles: stylesOf(node.attrs),
      ...(node.guide ? { guide: true as const } : {}),
      ...(isBadge(node) ? { badge: true as const } : {}),
      ...(node.kind === 'none' && node.children.length === 0 ? { bare: true as const } : {}),
    };
  }
  const edges = layout.edges.map((edge) => {
    // The upstream end is the one a line runs from: the end without a mark
    // when only the other has one, and otherwise the end written first.
    const [, start = '', , end = ''] = edge.arrow.match(/^(.*?)(-{1,2})(.*)$/) ?? [];
    const backwards = start !== '' && end === '';
    const [up, down] = backwards ? [edge.to, edge.from] : [edge.from, edge.to];
    const text = edge.texts.map((one) => plainText(one.text)).filter((one) => one !== '').join(' · ');
    return {
      up: up.name,
      down: down.name,
      label: text,
      links: views(linksOf(edge.attrs)),
      ...describe(edge.attrs),
      styles: stylesOf(edge.attrs),
      ...(edge.guide ? { guide: true as const } : {}),
    };
  });
  return { nodes, edges };
}

/** The styles a `style:` names; the parser joins them on a space. */
const stylesOf = (attrs: Record<string, string>): string[] => (attrs['style'] === undefined ? [] : attrs['style'].split(' '));

/** A text as a reader sees it: markup such as `[dim]` taken out, its lines run together. */
function plainText(text: string): string {
  return text.replace(/\[\/?[a-z][a-z0-9-]*\]/gi, '').replace(/\s*\n\s*/g, ' ').trim();
}

/** A local time as `2026-11-05 14:32`, which sorts and reads the same everywhere. */
function stamp(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}

const hex = (color: string) => /^#[0-9a-f]{6}$/i.test(color);

/**
 * What may differ between one theme's drawing and another's: colors,
 * opacities, and the ids made from a drawing's hash and an arrowhead's color.
 * Split on, its matches are the odd pieces. Matching too much costs nothing;
 * a drawing whose other pieces differ is carried whole.
 */
const VARIES = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|opacity="[^"]*"|opacity:[^;"]*|\br[0-9a-f]{8}\b|\b[0-9a-f]{6}\b)/gi;

// The browser's own controls (scroll bars, focus rings) follow the page, so
// a dark diagram doesn't get a light one's. A color written by hand in a
// form that can't be measured leaves the choice to the browser.
function schemeOf(theme: Theme): string {
  return hex(theme.text) && hex(theme.background)
    ? luminance(theme.text) > luminance(theme.background)
      ? 'dark'
      : 'light'
    : 'light dark';
}

function colorsOf(theme: Theme): Record<string, string> {
  return {
    '--page': theme.background,
    '--ink': theme.text,
    '--muted': theme.mutedText,
    '--rule': theme.boxStroke,
    '--accent': theme.primary.color,
    '--on-accent': theme.primary.on,
  };
}

export type PageData = ReturnType<typeof dataOf>;

export function dataOf({ name, source, findings, themes, flipped, guidesShown, guideCount, current, graph }: PageParts) {
  // The theme list: first the diagram's own theme, which follows the file;
  // then every theme as the reader's choice, dark ones together and light
  // together, as the playground's picker has them, so stepping through the
  // list doesn't flash between black and white.
  const group = (light: boolean) => Object.keys(themes).filter((one) => (schemeOf(themes[one]!.theme) === 'light') === light);
  // The shown theme goes in whole; another is only the colors that differ
  // from it, when the rest of the drawing is the same, as it is since a theme
  // moves nothing. That keeps the page near its size with one theme.
  const pack = (other: string, base: string): string | string[] => {
    const theirs = other.split(VARIES);
    const ours = base.split(VARIES);
    const same = theirs.length === ours.length && theirs.every((piece, i) => i % 2 === 1 || piece === ours[i]);
    return same ? theirs.filter((_, i) => i % 2 === 1) : other;
  };
  // Each set of drawings, with guides one way, packed against its own drawing
  // in the page's first theme: guides add things, so the two sets differ in
  // more than colors and can't be packed against each other.
  const packAll = (set: Record<string, ThemeView>) => {
    const base = set[current]!;
    return Object.fromEntries(
      Object.entries(set).map(([one, view]) => [
        one,
        one === current
          ? { svg: view.svg, tagged: view.tagged, colors: view.colors, scheme: view.scheme }
          : { svg: pack(view.svg, base.svg), tagged: pack(view.tagged, base.tagged), colors: view.colors, scheme: view.scheme },
      ]),
    );
  };
  return {
    name,
    source,
    current,
    varies: VARIES.source,
    themeGroups: { dark: group(false), light: group(true) },
    themes: packAll(themes),
    flipped: flipped && packAll(flipped),
    guidesShown,
    guideCount,
    findings: findings.map((finding) => ({ kind: finding.kind, message: finding.message, line: finding.line })),
    graph,
  };
}
