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
import { PAN_ZOOM } from './viewer.js';

/**
 * `reladraw render --page`: one diagram in one self-contained HTML page, made
 * for looking at rather than embedding. The page is the diagram's own colors,
 * headed with its title, and it pans, zooms, goes full screen, saves itself,
 * its source, the SVG or a PNG, lists the findings, and names a box under the
 * pointer. It needs nothing running and fetches nothing, so it can be
 * attached, mailed or committed. `file` is the source file's name, such as
 * `flow.reladraw`; without its extension it is the title when the file states
 * none, and the name everything saved from the page is given. The page is a
 * snapshot of the file at `at`, and says so under its title.
 */
export function drawPage(
  source: string,
  file: string,
  options: DrawOptions = {},
  at: Date = new Date(),
): { html: string; findings: Finding[] } {
  const name = file.replace(/\.[^.]+$/, '') || file;
  const drawn = `drawn from ${file}, ${stamp(at)}`;
  const run = (text: string) => {
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
      html: page({
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
      }),
      findings: found,
    };
  };
  try {
    return run(source);
  } catch (error) {
    throw error instanceof SourceError ? blame(source, error, run) : error;
  }
}

interface PageParts {
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

function page({ title, name, drawn, source, findings, themes, flipped, guidesShown, guideCount, current, graph }: PageParts): string {
  const shown = themes[current]!;
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
  const data = {
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
  // Replaced by functions, so a `$` in a title or a drawing is taken as written.
  // The zoom's code goes in first, so nothing a diagram says can be taken for its marker.
  return PAGE.replace('{{panzoom}}', () => PAN_ZOOM)
    .replace('{{scheme}}', () => shown.scheme)
    .replace('{{title}}', () => escapeHtml(title))
    .replace('{{heading}}', () => escapeHtml(title))
    .replace('{{drawn}}', () => escapeHtml(drawn))
    .replace('{{colors}}', () =>
      [
        ...Object.entries(shown.colors).map(([key, value]) => `${key}: ${value};`),
        '--sel: #e0b25a; --up: #22b98c; --down: #e5484d;',
      ].join(' '),
    )
    .replace('{{drawing}}', () => shown.tagged)
    .replace('{{data}}', () => scriptJson(data));
}

function escapeHtml(text: string): string {
  // `{` too, so a title or file name can't be taken for a later marker.
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\{/g, '&#123;');
}

/** JSON that can sit inside a `<script>` without ending it. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c');
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="{{scheme}}">
<meta name="generator" content="reladraw">
<title>{{title}}</title>
<style>
  :root { {{colors}} }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; flex-direction: column; height: 100vh; height: 100dvh;
    background: var(--page); color: var(--ink);
    font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  header {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px;
    padding: 10px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--rule) 45%, transparent);
  }
  .heading { flex: 1 1 16rem; min-width: 0; }
  h1 { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
  .drawn { margin: 0; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  .menu-list hr { width: 100%; margin: 2px 0; border: 0; border-top: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .tools .gap { width: 8px; }
  button {
    font: inherit; font-size: 13px; color: var(--ink); background: transparent;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); border-radius: 6px;
    padding: 4px 10px; cursor: pointer; white-space: nowrap;
  }
  button:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); }
  button:disabled { opacity: 0.45; cursor: default; background: transparent; }
  button[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 25%, transparent); border-color: var(--accent); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .menu { position: relative; }
  .menu-list {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: 5;
    flex-direction: column; gap: 4px; padding: 6px;
    background: var(--page); border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); border-radius: 6px;
  }
  .menu-list:not([hidden]) { display: flex; }
  #scale .fitted { color: var(--accent); }
  #scale { min-width: 6em; text-align: center; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 13px; }
  main { position: relative; flex: 1; display: flex; min-height: 0; }
  #view { position: relative; flex: 1; overflow: hidden; touch-action: none; cursor: grab; }
  #view.dragging { cursor: grabbing; }
  #view.grabbed::after {
    content: ''; position: absolute; inset: 0; z-index: 3; pointer-events: none;
    border: 2px solid var(--accent);
  }
  .grab-hint {
    position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 3;
    padding: 3px 10px; border-radius: 4px; font-size: 12px; white-space: nowrap; pointer-events: none;
    background: var(--accent); color: var(--on-accent);
  }
  .grab-hint[hidden] { display: none; }
  #stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  #stage svg { display: block; }
  #view g[data-name].hover { filter: drop-shadow(0 0 3px var(--accent)); }
  #view g[data-name].lit { filter: drop-shadow(0 0 2px var(--accent)) drop-shadow(0 0 6px var(--accent)); animation: lit 0.6s ease-in-out 3 alternate; }
  @keyframes lit { from { opacity: 1; } to { opacity: 0.45; } }
  #tip {
    position: absolute; pointer-events: none; display: none; z-index: 2;
    padding: 2px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap;
    background: var(--accent); color: var(--on-accent);
  }
  #side {
    width: min(24rem, 36vw); display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid color-mix(in srgb, var(--rule) 45%, transparent);
  }
  #side[hidden] { display: none; }
  /* What is selected takes the room it needs and the findings the rest; when
     both want more than there is, each gives up room and scrolls. */
  aside { display: flex; flex-direction: column; min-height: min(8rem, 40%); flex: 1 1 auto;
    border-top: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  aside[hidden] { display: none; }
  select {
    font: inherit; font-size: 13px; color: var(--ink); background: var(--page);
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); border-radius: 6px;
    padding: 3px 6px; cursor: pointer;
  }
  select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* ---- the menus, and the keys that reach them ----
     What the keys act on is ringed in amber, and the amber moves down with
     them: the bar after m, then the open menu and the row the arrows are on,
     then the theme list. The strip under the bar says where the keys are and
     how to get out. */
  .menu > button { position: relative; }
  kbd {
    font: 11px ui-monospace, Menlo, Consolas, monospace; padding: 0 5px; border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); color: var(--muted);
  }
  kbd.tag {
    display: none; position: absolute; top: -8px; right: -7px; z-index: 6;
    padding: 0 4px; border: 0; font-weight: 700; background: var(--sel); color: #1a1406;
  }
  #full { position: relative; }
  .tools.keyed { outline: 2px solid var(--sel); outline-offset: 4px; border-radius: 6px; }
  .tools.keyed kbd.tag { display: inline; }
  .menu > button.open { border-color: var(--sel); background: color-mix(in srgb, var(--sel) 22%, transparent); }
  .menu-list { min-width: 15rem; }
  .menu-list .row {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    border-color: transparent; padding: 5px 8px;
  }
  .menu-list .row .name { flex: 1; }
  .menu-list .row .value { color: var(--muted); }
  .menu-list .row.cur { background: color-mix(in srgb, var(--ink) 12%, transparent); box-shadow: inset 3px 0 0 var(--sel); }
  /* Its rows, not the list, so the theme list inside it stays solid. */
  .menu-list.behind > .row, .menu-list.behind > hr { opacity: 0.5; }
  .menu-list.sub { right: calc(100% + 6px); top: 0; max-height: 70vh; overflow: auto; gap: 0; }
  .menu-list .group { padding: 6px 8px 2px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .menu-list .mark { width: 12px; flex: none; color: var(--up); }
  /* A switch: green and to the right when on, gray and to the left when off,
     with the word beside it, so the state never rests on color alone. */
  .sw { flex: none; position: relative; width: 30px; height: 16px; border-radius: 9px; background: color-mix(in srgb, var(--ink) 25%, transparent); }
  .sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: color-mix(in srgb, var(--ink) 55%, transparent); }
  .switch[aria-checked="true"] .sw { background: #2f9e5a; }
  .switch[aria-checked="true"] .sw::after { left: 16px; background: #fff; }
  .switch .word { width: 2em; text-align: right; font-size: 12px; color: var(--muted); }
  .switch[aria-checked="true"] .word { color: var(--up); }
  .switch[aria-checked="false"] .name { color: var(--muted); }
  .menu-list .row:disabled { opacity: 0.45; }
  #strip {
    display: flex; justify-content: space-between; gap: 16px; padding: 3px 16px; font-size: 12px;
    background: color-mix(in srgb, var(--sel) 16%, var(--page)); color: var(--ink);
    border-bottom: 1px solid color-mix(in srgb, var(--sel) 45%, transparent);
  }
  #strip[hidden] { display: none; }
  #strip .crumbs b { color: var(--sel); }
  #strip .hint { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ---- what is selected ---- */
  #selected { padding: 10px 16px 12px; overflow: auto; flex: 0 1 auto; min-height: 0; }
  #selected .empty { margin: 0; color: var(--muted); font-size: 13px; }
  #selected h2 { margin: 0 0 8px; font-size: 15px; font-weight: 600; color: var(--sel); overflow-wrap: anywhere; }
  #selected h3 {
    display: flex; align-items: center; gap: 8px; margin: 12px 0 4px;
    font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
  }
  #selected h3 svg { flex: none; }
  #selected .none { color: var(--muted); font-size: 13px; }
  #selected .description { font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
  #selected .description p, #selected .description ul, #selected .description ol { margin: 0 0 8px; }
  #selected .description ul, #selected .description ol { padding-left: 20px; }
  #selected .description code { font-size: 12px; padding: 0 3px; border-radius: 3px; background: color-mix(in srgb, var(--ink) 12%, transparent); }
  #selected .description a { color: inherit; text-decoration: underline; }
  #selected .link {
    display: flex; align-items: center; gap: 9px; padding: 4px 6px; margin: 0 -6px;
    border-radius: 5px; color: var(--ink); text-decoration: none;
  }
  #selected .link:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); }
  #selected .link:hover .label { text-decoration: underline; }
  #selected .link svg { flex: none; }
  #selected .ends button { border-color: transparent; padding: 1px 4px; margin: 0 2px 0 -4px; font-size: 14px; }
  #selected .ends button:hover { text-decoration: underline; }
  #selected .all { margin-top: 12px; font-size: 12px; }

  /* A click selects a box or a line. It stays amber; what feeds it is green and
     what it feeds is red, the lines dashed and running the way they go; the
     rest dims. Fixed colors rather than the theme's, so they mean the same in
     every theme, and chosen to stay apart for the commonest color blindness. */
  #view g[data-node], #view g[data-edge] { cursor: pointer; }
  #view g.has-links:hover text { text-decoration: underline; }
  #view svg.selecting g[data-name]:not(.sel):not(.up):not(.down) { opacity: .3; }
  #view g[data-node].sel { filter: drop-shadow(0 0 2px var(--sel)) drop-shadow(0 0 6px var(--sel)); }
  #view g[data-node].up { filter: drop-shadow(0 0 2px var(--up)) drop-shadow(0 0 4px color-mix(in srgb, var(--up) 60%, transparent)); }
  #view g[data-node].down { filter: drop-shadow(0 0 2px var(--down)) drop-shadow(0 0 4px color-mix(in srgb, var(--down) 60%, transparent)); }
  #view g[data-node].sel > :is(rect, path, circle, ellipse, polygon)[stroke]:not([stroke="none"]),
  #view g[data-node].sel > a > :is(rect, path, circle, ellipse, polygon)[stroke]:not([stroke="none"]) { stroke: var(--sel); stroke-width: 2.5; }
  #view g[data-node].up > :is(rect, path, circle, ellipse, polygon)[stroke]:not([stroke="none"]),
  #view g[data-node].up > a > :is(rect, path, circle, ellipse, polygon)[stroke]:not([stroke="none"]) { stroke: var(--up); stroke-width: 2; }
  #view g[data-node].down > :is(rect, path, circle, ellipse, polygon)[stroke]:not([stroke="none"]),
  #view g[data-node].down > a > :is(rect, path, circle, ellipse, polygon)[stroke]:not([stroke="none"]) { stroke: var(--down); stroke-width: 2; }
  #view g[data-edge].sel :is(line, path[fill="none"], polyline):not(.target) { stroke: var(--sel); stroke-width: 2; }
  #view g[data-edge].up :is(line, path[fill="none"], polyline):not(.target) { stroke: var(--up); stroke-dasharray: 8 5; animation: run .9s linear infinite; }
  #view g[data-edge].down :is(line, path[fill="none"], polyline):not(.target) { stroke: var(--down); stroke-dasharray: 8 5; animation: run .9s linear infinite; }
  #view g[data-edge] .target { stroke: #000 !important; stroke-opacity: 0; }
  #view svg.hinting g[data-name]:not(.hint-on) { opacity: .25 !important; }
  #view svg.hinting g[data-name].hint-on { opacity: 1 !important; }
  #hints { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
  .hintkey { font: 700 12px/16px ui-monospace, Menlo, Consolas, monospace; padding: 0 4px; border-radius: 3px;
    background: var(--sel); color: #1a1406; box-shadow: 0 0 0 1px rgba(0, 0, 0, .55); white-space: nowrap; }
  #hints .hintkey { position: absolute; left: 0; top: 0; }
  .hintkey .done { opacity: .45; }
  .hintkey.gone { visibility: hidden; }
  #selected a.link .hintkey { margin-right: 2px; }
  #link-pop { position: absolute; z-index: 5; display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; font-size: 13px;
    background: var(--page); border: 1px solid var(--sel); border-radius: 6px; box-shadow: 0 4px 16px rgba(0, 0, 0, .35); }
  #link-pop a.link { display: flex; align-items: center; gap: 6px; color: var(--ink); text-decoration: none; }
  #link-pop a.link svg { flex: none; }
  #strip .query { color: var(--ink); }
  #strip .query i { font-style: normal; color: var(--sel); }
  @keyframes run { to { stroke-dashoffset: -26; } }
  @media (prefers-reduced-motion: reduce) { #view g[data-edge] :is(line, path, polyline) { animation: none !important; } }
  aside h2 { margin: 0; padding: 10px 16px 6px; font-size: 13px; font-weight: 600; }
  aside h2 .what { display: block; font-weight: 400; font-size: 12px; color: var(--muted); }
  aside ol { list-style: none; margin: 0; padding: 0 8px 12px; overflow: auto; }
  aside li button {
    display: block; width: 100%; text-align: left; white-space: normal; border-color: transparent;
    padding: 6px 8px; margin: 2px 0;
  }
  aside li button.chosen { border-color: var(--accent); }
  aside li.none { padding: 6px 8px; color: var(--muted); font-size: 13px; }
  .where { color: var(--muted); font-variant-numeric: tabular-nums; }
  .kind { color: var(--accent); }
  .note { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
  @media (max-width: 700px) {
    main { flex-direction: column; }
    #side { width: auto; max-height: 45%; border-left: 0; border-top: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  }
</style>
</head>
<body>
<header>
  <div class="heading">
    <h1>{{heading}}</h1>
    <p class="drawn">{{drawn}}</p>
  </div>
  <div class="tools">
    <button id="out" type="button" title="Zoom out (-)" aria-label="Zoom out">−</button>
    <span id="scale" aria-live="polite">100%</span>
    <button id="in" type="button" title="Zoom in (+)" aria-label="Zoom in">+</button>
    <button id="fit" type="button" title="The whole diagram in view (0)">Fit</button>
    <button id="actual" type="button" title="The drawing at its own scale (1)">100%</button>
    <span class="gap"></span>
    <button id="full" type="button" title="Full screen (f)"><span class="label">Full screen</span><kbd class="tag">f</kbd></button>
    <span class="menu">
      <button id="save" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="save-list">Save ▾<kbd class="tag">s</kbd></button>
      <span id="save-list" class="menu-list" role="menu" hidden>
        <button id="save-page" class="row" type="button" role="menuitem" data-key="p" title="Save this page as one HTML file, to keep or send"><span class="name">This page</span><kbd>p</kbd></button>
        <button id="save-source" class="row" type="button" role="menuitem" data-key="r" title="Save the .reladraw file this page was drawn from"><span class="name">.reladraw source</span><kbd>r</kbd></button>
        <hr>
        <button id="save-svg" class="row" type="button" role="menuitem" data-key="s" title="Save the picture as an SVG file"><span class="name">SVG</span><kbd>s</kbd></button>
        <button id="save-png" class="row" type="button" role="menuitem" data-key="n" title="Save the picture as a PNG, at twice its size"><span class="name">PNG</span><kbd>n</kbd></button>
        <button id="copy-svg" class="row" type="button" role="menuitem" data-key="c" title="Copy the picture's SVG to the clipboard"><span class="name">Copy SVG</span><kbd>c</kbd></button>
      </span>
    </span>
    <span class="menu">
      <button id="view-button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="view-list">View ▾<kbd class="tag">v</kbd></button>
      <span id="view-list" class="menu-list" role="menu" hidden>
        <button id="theme-row" class="row" type="button" role="menuitem" data-key="t" aria-haspopup="true" title="Draw the diagram in another theme"><span class="name">Theme <span class="value"></span> ▸</span><kbd>t</kbd></button>
        <hr>
        <button id="panel-row" class="row switch" type="button" role="menuitemcheckbox" data-key="p" title="Show or hide the side panel"><span class="sw"></span><span class="name">Side panel</span><span class="word"></span><kbd>p</kbd></button>
        <button id="auto-row" class="row switch" type="button" role="menuitemcheckbox" data-key="a" title="Show the side panel only while something is selected or the findings are open"><span class="sw"></span><span class="name">Auto-hide panel</span><span class="word"></span><kbd>a</kbd></button>
        <hr>
        <button id="findings-row" class="row switch" type="button" role="menuitemcheckbox" data-key="f" title="Show or hide the findings in the side panel"><span class="sw"></span><span class="name">Findings</span><span class="word"></span><kbd>f</kbd></button>
        <hr>
        <button id="guides-row" class="row switch" type="button" role="menuitemcheckbox" data-key="g" title="Draw the guides: everything written with guide in front"><span class="sw"></span><span class="name">Guides</span><span class="word"></span><kbd>g</kbd></button>
        <span id="theme-list" class="menu-list sub" role="menu" hidden></span>
      </span>
    </span>
  </div>
</header>
<div id="strip" hidden><span class="crumbs"></span><span class="hint"></span></div>
<main>
  <div id="view">
    <div id="stage">
{{drawing}}
    </div>
    <div id="tip"></div>
  </div>
  <div id="side">
    <section id="selected" aria-label="Selected" aria-live="polite">
      <p class="empty">Click a box or a line to see its links and what it connects to.</p>
    </section>
    <aside id="findings" aria-label="Findings">
      <h2>Findings <span class="what">where the picture, drawn as written, may not read as meant</span></h2>
      <ol id="finding-list"></ol>
    </aside>
  </div>
</main>
<script>
(function () {
  // The page as written, taken before anything below changes it, so This
  // page saves what reladraw wrote rather than the current zoom and highlights.
  var written = '<!doctype html>\\n' + document.documentElement.outerHTML + '\\n';
  var DATA = {{data}};
  var view = document.getElementById('view');
  var stage = document.getElementById('stage');
  var svg = stage.querySelector('svg');
  // The theme shown, which the picker changes; Save SVG, PNG and Copy SVG
  // save the drawing in it.
  var shownTheme = DATA.current;
  // Another theme is carried as the colors that differ from the first, put
  // back in place the first time it is shown.
  var VARIES = new RegExp(DATA.varies, 'gi');
  // Whether guides are drawn, which the View menu's switch changes. The
  // drawings with guides the other way are a second set, packed the same way
  // against its own first theme.
  var guidesShown = DATA.guidesShown;
  function unpack(packed, base) {
    if (typeof packed === 'string') return packed;
    var pieces = base.split(VARIES);
    for (var i = 1, j = 0; i < pieces.length; i += 2) pieces[i] = packed[j++];
    return pieces.join('');
  }
  function themed(name) {
    var set = guidesShown === DATA.guidesShown || !DATA.flipped ? DATA.themes : DATA.flipped;
    var view = set[name];
    if (!view.unpacked) {
      var first = set[DATA.current];
      view.svg = unpack(view.svg, first.svg);
      view.tagged = unpack(view.tagged, first.tagged);
      view.unpacked = true;
    }
    return view;
  }
  function shown() { return themed(shownTheme); }
  var tip = document.getElementById('tip');
  var scaleLabel = document.getElementById('scale');
{{panzoom}}
  var zoom = panZoom(view, stage, scaleLabel, {
    out: document.getElementById('out'),
    in: document.getElementById('in'),
    fit: document.getElementById('fit'),
    actual: document.getElementById('actual'),
  });

  /* ---- full screen ---- */

  var full = document.getElementById('full');
  if (!document.fullscreenEnabled) full.hidden = true;
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
  full.onclick = toggleFull;
  document.addEventListener('fullscreenchange', function () {
    full.querySelector('.label').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  });

  /* ---- saving ---- */

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // A tick, so the navigation has the URL before it is taken back.
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function flash(button, text) {
    var label = button.querySelector('.name') || button;
    var was = label.textContent;
    label.textContent = text;
    setTimeout(function () { label.textContent = was; }, 1200);
  }

  // Chrome and Edge ask where to save and under what name, as the
  // playground's Save… does; elsewhere the file goes where the browser puts
  // downloads. The dialog opens before the file is made, because it must
  // open while the click still counts and a PNG takes a moment to draw.
  // \`make\` gives a promise of the blob.
  function saveFile(button, name, description, type, make) {
    function download() {
      make().then(function (blob) { saveBlob(blob, name); }, function () { flash(button, 'Failed'); });
    }
    if (!window.showSaveFilePicker) return download();
    var accept = {};
    accept[type] = [name.slice(name.lastIndexOf('.'))];
    // A page can't start the dialog in its own folder; the \`id\` makes it
    // start in the folder last saved to from any reladraw page instead.
    window.showSaveFilePicker({ id: 'reladraw-page', suggestedName: name, types: [{ description: description, accept: accept }] }).then(
      function (handle) {
        return make().then(function (blob) {
          return handle.createWritable().then(function (out) {
            return out.write(blob).then(function () { return out.close(); });
          });
        }).then(function () { flash(button, 'Saved'); }, function () { flash(button, 'Failed'); });
      },
      function (e) {
        if (e && e.name === 'AbortError') return;
        // Refused outright, as inside a cross-origin frame.
        download();
      },
    );
  }

  function ready(blob) {
    return Promise.resolve(blob);
  }

  // Every way out of the page is under one Save button: the page, its
  // source, and the picture. The list stays open after a choice, so "Copied"
  // can be read. It is one of the menus (below), opened by a click or by m s.
  var saveButton = document.getElementById('save');
  var saveList = document.getElementById('save-list');

  var savePage = document.getElementById('save-page');
  savePage.onclick = function () {
    saveFile(savePage, DATA.name + '.html', 'Web page', 'text/html', function () {
      return ready(new Blob([written], { type: 'text/html' }));
    });
  };

  var saveSource = document.getElementById('save-source');
  saveSource.onclick = function () {
    saveFile(saveSource, DATA.name + '.reladraw', 'reladraw source', 'text/plain', function () {
      return ready(new Blob([DATA.source], { type: 'text/plain' }));
    });
  };

  // The clipboard API needs a secure context; a page opened from disk may
  // not count as one, so the old selection route is the fallback.
  var copySvg = document.getElementById('copy-svg');
  copySvg.onclick = function () {
    function fallback() {
      var area = document.createElement('textarea');
      area.value = shown().svg;
      document.body.appendChild(area);
      area.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) {}
      area.remove();
      flash(copySvg, done ? 'Copied' : 'Blocked');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shown().svg).then(function () { flash(copySvg, 'Copied'); }, fallback);
    } else fallback();
  };

  var saveSvg = document.getElementById('save-svg');
  saveSvg.onclick = function () {
    saveFile(saveSvg, DATA.name + '.svg', 'SVG image', 'image/svg+xml', function () {
      return ready(new Blob([shown().svg], { type: 'image/svg+xml' }));
    });
  };

  // The browser draws the SVG onto a canvas with the fonts the page shows it
  // in, twice the size so it stays sharp on a high-density screen. A data URL
  // rather than a blob one, which some browsers count as foreign and refuse
  // to let the canvas be read back.
  var savePng = document.getElementById('save-png');
  function drawPng() {
    return new Promise(function (done, fail) {
      var image = new Image();
      image.onload = function () {
        var box = svg.viewBox.baseVal;
        var canvas = document.createElement('canvas');
        canvas.width = box.width * 2;
        canvas.height = box.height * 2;
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) { blob ? done(blob) : fail(); }, 'image/png');
      };
      image.onerror = fail;
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(shown().svg);
    });
  }
  savePng.onclick = function () {
    saveFile(savePng, DATA.name + '.png', 'PNG image', 'image/png', drawPng);
  };

  /* ---- a thing's name under the pointer ---- */

  var hovered = null;
  view.addEventListener('pointerover', function (event) {
    var group = event.target.closest && event.target.closest('g[data-name]');
    if (group === hovered) return;
    if (hovered) hovered.classList.remove('hover');
    hovered = group;
    if (!group) {
      tip.style.display = 'none';
      return;
    }
    group.classList.add('hover');
    tip.textContent = group.getAttribute('data-name');
    tip.style.display = 'block';
  });
  view.addEventListener('pointermove', function (event) {
    if (!hovered) return;
    var rect = view.getBoundingClientRect();
    var x = event.clientX - rect.left + 14;
    var y = event.clientY - rect.top + 16;
    // Kept inside the view, so a name near the right edge isn't cut off.
    x = Math.min(x, rect.width - tip.offsetWidth - 4);
    y = Math.min(y, rect.height - tip.offsetHeight - 4);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  view.addEventListener('pointerleave', function () {
    if (hovered) hovered.classList.remove('hover');
    hovered = null;
    tip.style.display = 'none';
  });

  /* ---- findings ---- */

  var panel = document.getElementById('findings');
  var list = document.getElementById('finding-list');
  var count = DATA.findings.length;

  // A row of the View menu that is on or off: its switch, and the word beside it.
  function setSwitch(row, on) {
    row.setAttribute('aria-checked', String(on));
    row.querySelector('.word').textContent = on ? 'on' : 'off';
  }
  var panelRow = document.getElementById('panel-row');
  var autoRow = document.getElementById('auto-row');
  var findingsRow = document.getElementById('findings-row');
  var guidesRow = document.getElementById('guides-row');
  findingsRow.querySelector('.name').textContent = 'Findings (' + count + ')';
  guidesRow.querySelector('.name').textContent = 'Guides (' + DATA.guideCount + ')';

  /* ---- the side panel: shown, hidden, or shown only when wanted ---- */

  // Hidden, it stays hidden whatever is selected. Auto-hide shows it only
  // while something is selected or the findings are open. Both choices are
  // remembered in this browser for every reladraw page.
  var side = document.getElementById('side');
  var KEPT = 'reladraw-page-panel';
  var panelOn = true;
  var autoHide = false;
  try {
    var kept = JSON.parse(localStorage.getItem(KEPT) || 'null');
    if (kept) { panelOn = kept.on !== false; autoHide = kept.autoHide === true; }
  } catch (e) {}
  function keepPanel() {
    try { localStorage.setItem(KEPT, JSON.stringify({ on: panelOn, autoHide: autoHide })); } catch (e) {}
  }
  function layoutSide() {
    side.hidden = !(panelOn && (!autoHide || selection || !panel.hidden));
    // A finding lights what it is about only while the finding can be seen.
    if ((panel.hidden || side.hidden) && lit && lit.length) unlight();
    setSwitch(panelRow, panelOn);
    setSwitch(autoRow, autoHide);
    autoRow.disabled = !panelOn;
    setSwitch(findingsRow, panelOn && !panel.hidden);
  }
  function setPanel(on) {
    panelOn = on;
    keepPanel();
    layoutSide();
  }
  function setAutoHide(on) {
    if (!panelOn) return;
    autoHide = on;
    keepPanel();
    layoutSide();
  }
  panelRow.onclick = function () { setPanel(!panelOn); };
  autoRow.onclick = function () { setAutoHide(!autoHide); };

  function showPanel(open) {
    panel.hidden = !open;
    layoutSide();
  }
  // Asking for the findings shows the panel they are in.
  function flipFindings() {
    if (!panelOn) { panelOn = true; keepPanel(); showPanel(true); }
    else showPanel(panel.hidden);
  }
  findingsRow.onclick = flipFindings;
  if (count === 0) {
    list.append(element('li', 'none', 'No findings.'));
    panel.hidden = true;
  } else {
    // Open from the start, unless the panel is to stay out of the way.
    panel.hidden = autoHide;
  }

  var lit = [];
  var chosen = null;
  function unlight() {
    lit.forEach(function (group) { group.classList.remove('lit'); });
    lit = [];
    if (chosen) chosen.classList.remove('chosen');
    chosen = null;
  }

  // A finding names the line of the statement at fault; what that statement
  // drew lights up, and the view moves to it if it is out of sight.
  function light(finding, button) {
    unlight();
    chosen = button;
    button.classList.add('chosen');
    lit = Array.from(svg.querySelectorAll('g[data-line="' + finding.line + '"]'));
    lit.forEach(function (group) {
      group.classList.remove('lit');
      void group.getBoundingClientRect();
      group.classList.add('lit');
    });
    if (lit.length === 0) return;
    var room = view.getBoundingClientRect();
    var r = null;
    lit.forEach(function (group) {
      var b = group.getBoundingClientRect();
      r = r ? { l: Math.min(r.l, b.left), t: Math.min(r.t, b.top), r: Math.max(r.r, b.right), b: Math.max(r.b, b.bottom) }
            : { l: b.left, t: b.top, r: b.right, b: b.bottom };
    });
    var inside = r.l >= room.left && r.r <= room.right && r.t >= room.top && r.b <= room.bottom;
    if (inside) return;
    zoom.pan((room.left + room.width / 2) - (r.l + r.r) / 2, (room.top + room.height / 2) - (r.t + r.b) / 2);
  }

  DATA.findings.forEach(function (finding) {
    var item = document.createElement('li');
    var button = document.createElement('button');
    button.type = 'button';
    var where = document.createElement('span');
    where.className = 'where';
    where.textContent = 'line ' + finding.line + ' ';
    var kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = finding.kind;
    button.append(where, kind, document.createElement('br'), document.createTextNode(finding.message));
    if (!svg.querySelector('g[data-line="' + finding.line + '"]')) {
      var note = document.createElement('span');
      note.className = 'note';
      note.textContent = 'Nothing drawn comes from that line.';
      button.append(note);
    }
    button.onclick = function () { light(finding, button); };
    item.append(button);
    list.append(item);
  });

  /* ---- selecting a box or a line ---- */

  // A click selects and never follows a link: the links are in the panel,
  // and a link is followed only from there. One line out lights by default;
  // the panel's button lights everything upstream and downstream.
  var graph = DATA.graph;
  var selectedPanel = document.getElementById('selected');
  var selection = null;
  var everything = false;

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function nodeGroups(name) { return svg.querySelectorAll('g[data-node="' + CSS.escape(name) + '"]'); }
  function edgeGroups(index) { return svg.querySelectorAll('g[data-edge="' + index + '"]'); }

  // Run on each drawing the stage is given: at the start, and after a theme change.
  function prepare() {
    // A line is too thin to hit, so each gets an unseen wider copy along it.
    each(svg.querySelectorAll('g[data-edge]'), function (group) {
      each(group.querySelectorAll('line, path[fill="none"], polyline'), function (stroke) {
        if (stroke.getAttribute('stroke-opacity') === '0') { stroke.classList.add('target'); return; }
        var wide = stroke.cloneNode(false);
        ['marker-start', 'marker-end', 'mask', 'stroke-dasharray'].forEach(function (name) { wide.removeAttribute(name); });
        wide.setAttribute('stroke-width', '12');
        wide.setAttribute('pointer-events', 'stroke');
        wide.classList.add('target');
        stroke.parentNode.insertBefore(wide, stroke.nextSibling);
      });
    });
    Object.keys(graph.nodes).forEach(function (name) {
      if (graph.nodes[name].links.length > 0) each(nodeGroups(name), function (group) { group.classList.add('has-links'); });
    });
    graph.edges.forEach(function (edge, index) {
      if (edge.links.length > 0) each(edgeGroups(index), function (group) { group.classList.add('has-links'); });
    });
  }
  prepare();

  function clearMarks() {
    svg.classList.remove('selecting');
    each(svg.querySelectorAll('.sel, .up, .down'), function (group) { group.classList.remove('sel', 'up', 'down'); });
  }

  // What lights: the edges into and out of a node, and the nodes at their far
  // ends; with \`everything\`, on through every line upstream and downstream.
  function lightFrom(startUp, startDown) {
    var up = {}, down = {}, upEdges = {}, downEdges = {};
    function walk(names, seen, edges, toward) {
      var queue = names.slice();
      while (queue.length) {
        var at = queue.shift();
        graph.edges.forEach(function (edge, index) {
          var near = toward === 'up' ? edge.down : edge.up;
          var far = toward === 'up' ? edge.up : edge.down;
          if (near !== at || edges[index]) return;
          edges[index] = true;
          if (!seen[far]) { seen[far] = true; if (everything) queue.push(far); }
        });
      }
    }
    walk(startUp, up, upEdges, 'up');
    walk(startDown, down, downEdges, 'down');
    return { up: up, down: down, upEdges: upEdges, downEdges: downEdges };
  }

  function select(next) {
    selection = next;
    clearMarks();
    if (!next) { showSelected(); return; }
    svg.classList.add('selecting');
    var lit;
    if (next.kind === 'node') {
      each(nodeGroups(next.key), function (group) { group.classList.add('sel'); });
      lit = lightFrom([next.key], [next.key]);
    } else {
      var edge = graph.edges[next.key];
      each(edgeGroups(next.key), function (group) { group.classList.add('sel'); });
      // One line out from a line is its two ends; everything goes on from them.
      lit = everything ? lightFrom([edge.up], [edge.down]) : { up: {}, down: {}, upEdges: {}, downEdges: {} };
      lit.up[edge.up] = true;
      lit.down[edge.down] = true;
      delete lit.upEdges[next.key];
      delete lit.downEdges[next.key];
    }
    Object.keys(lit.upEdges).forEach(function (index) { each(edgeGroups(index), function (group) { group.classList.add('up'); }); });
    Object.keys(lit.downEdges).forEach(function (index) { each(edgeGroups(index), function (group) { group.classList.add('down'); }); });
    Object.keys(lit.up).forEach(function (name) { if (!(next.kind === 'node' && name === next.key)) each(nodeGroups(name), function (group) { group.classList.add('up'); }); });
    Object.keys(lit.down).forEach(function (name) {
      if (next.kind === 'node' && name === next.key) return;
      each(nodeGroups(name), function (group) { if (!group.classList.contains('up')) group.classList.add('down'); });
    });
    showSelected();
  }

  function sample(color) {
    return '<svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="' + color + '" stroke-width="2.4" stroke-dasharray="7 4"/></svg>';
  }

  function element(tag, className, text) {
    var made = document.createElement(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    return made;
  }

  function endsList(names) {
    var holder = element('div', 'ends');
    if (names.length === 0) { holder.append(element('span', 'none', 'nothing')); return holder; }
    names.forEach(function (name) {
      var button = element('button', '', graph.nodes[name] ? graph.nodes[name].label : name);
      button.type = 'button';
      button.onclick = function () { select({ kind: 'node', key: name }); };
      holder.append(button);
    });
    return holder;
  }

  function showSelected() {
    layoutSide();
    selectedPanel.textContent = '';
    if (!selection) {
      selectedPanel.append(element('p', 'empty', 'Click a box or a line to see its links and what it connects to.'));
      return;
    }
    var heading, links, from, to, description;
    if (selection.kind === 'node') {
      var node = graph.nodes[selection.key];
      heading = node ? node.label : selection.key;
      links = node ? node.links : [];
      description = node && node.description;
      from = []; to = [];
      graph.edges.forEach(function (edge) {
        if (edge.down === selection.key && from.indexOf(edge.up) < 0) from.push(edge.up);
        if (edge.up === selection.key && to.indexOf(edge.down) < 0) to.push(edge.down);
      });
    } else {
      var edge = graph.edges[selection.key];
      var name = function (key) { return graph.nodes[key] ? graph.nodes[key].label : key; };
      heading = edge.label || name(edge.up) + ' \\u2192 ' + name(edge.down);
      links = edge.links;
      description = edge.description;
      from = [edge.up]; to = [edge.down];
    }
    selectedPanel.append(element('h2', '', heading));
    selectedPanel.append(element('h3', '', 'Links'));
    if (links.length === 0) selectedPanel.append(element('div', 'none', 'none'));
    links.forEach(function (link) {
      var row = element('a', 'link');
      row.href = link.href;
      row.target = '_blank';
      row.rel = 'noopener';
      row.title = link.href;
      row.innerHTML = link.badges[shownTheme];
      row.append(element('span', 'label', link.label));
      selectedPanel.append(row);
    });
    var comes = element('h3', '', 'Comes from');
    comes.insertAdjacentHTML('beforeend', sample('var(--up)'));
    selectedPanel.append(comes, endsList(from));
    var goes = element('h3', '', 'Goes to');
    goes.insertAdjacentHTML('beforeend', sample('var(--down)'));
    selectedPanel.append(goes, endsList(to));
    var all = element('button', 'all', 'Light everything upstream and downstream');
    all.type = 'button';
    all.setAttribute('aria-pressed', String(everything));
    all.onclick = function () { everything = !everything; select(selection); };
    selectedPanel.append(all);
    // Last, so a long description never pushes the rest out of view, and the
    // sections above stay where they are whatever is selected.
    if (description) {
      // Written by reladraw from the file's Markdown, every character escaped.
      var about = element('div', 'description');
      about.innerHTML = description;
      selectedPanel.append(element('h3', '', 'Description'), about);
    }
  }

  // The pan and zoom capture the pointer, so the click lands on the view; what
  // was under the pointer is noted when it went down, and a drag selects nothing.
  var pressed = null;
  view.addEventListener('pointerdown', function (event) {
    pressed = event.button === 0 ? { x: event.clientX, y: event.clientY, target: event.target } : null;
  }, true);
  view.addEventListener('pointerup', function (event) {
    if (!pressed) return;
    var moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 4;
    var target = pressed.target;
    pressed = null;
    if (moved) return;
    var group = target.closest && target.closest('g[data-node], g[data-edge]');
    if (!group) select(null);
    else if (group.hasAttribute('data-node')) select({ kind: 'node', key: group.getAttribute('data-node') });
    else select({ kind: 'edge', key: Number(group.getAttribute('data-edge')) });
  });
  // A link in the drawing is followed from the panel, not by clicking the drawing.
  view.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a');
    if (link && svg.contains(link)) event.preventDefault();
  });

  /* ---- drawing again: another theme, or guides the other way ---- */

  var schemeMeta = document.querySelector('meta[name="color-scheme"]');

  // Neither a theme nor guides move anything, so the view, the selection and
  // the panel stay as they were.
  function redraw() {
    var next = shown();
    Object.keys(next.colors).forEach(function (key) { document.documentElement.style.setProperty(key, next.colors[key]); });
    schemeMeta.setAttribute('content', next.scheme);
    unlight();
    hovered = null;
    tip.style.display = 'none';
    stage.innerHTML = next.tagged;
    svg = stage.querySelector('svg');
    prepare();
    zoom.show();
    select(selection);
  }

  function showTheme(name) {
    if (!DATA.themes[name] || name === shownTheme) return;
    shownTheme = name;
    redraw();
  }

  // Guides start as the file or --guides says, and a flip lasts for this page
  // only: guides show how one diagram was built, not how a reader likes to
  // read. With none in the diagram the switch still works, and draws nothing new.
  function setGuides(on) {
    if (on === guidesShown) return;
    guidesShown = on;
    setSwitch(guidesRow, on);
    if (DATA.flipped) redraw();
  }
  setSwitch(guidesRow, guidesShown);
  guidesRow.onclick = function () { setGuides(!guidesShown); };

  /* ---- the theme list ---- */

  // "Diagram's theme" follows the file, so an edit to its theme shows on the
  // next render. Any other choice is the reader's, and holds on every reladraw
  // page in this browser, whatever its file says, until the diagram's theme
  // is chosen again.
  var CHOSEN_THEME = 'reladraw-page-theme';
  var chosenName = '';
  var themeRow = document.getElementById('theme-row');
  var themeList = document.getElementById('theme-list');
  var themeItems = [];

  function addThemeItem(value, label) {
    var row = element('button', 'row');
    row.type = 'button';
    row.setAttribute('role', 'menuitemradio');
    row.append(element('span', 'mark'), element('span', 'name', label));
    row.onclick = function () { keepTheme(value); };
    themeItems.push({ value: value, row: row });
    themeList.append(row);
  }
  addThemeItem('', "Diagram's theme (" + DATA.current + ')');
  [['Dark', DATA.themeGroups.dark], ['Light', DATA.themeGroups.light]].forEach(function (group) {
    if (group[1].length === 0) return;
    themeList.append(element('span', 'group', group[0]));
    group[1].forEach(function (name) { addThemeItem(name, name); });
  });

  function showChosen() {
    themeRow.querySelector('.value').textContent = '· ' + (chosenName || "Diagram's theme");
    themeItems.forEach(function (item) {
      var on = item.value === chosenName;
      item.row.setAttribute('aria-checked', String(on));
      item.row.querySelector('.mark').textContent = on ? '\\u25CF' : '';
    });
  }

  function keepTheme(value) {
    chosenName = value;
    try {
      if (value) localStorage.setItem(CHOSEN_THEME, value);
      else localStorage.removeItem(CHOSEN_THEME);
    } catch (e) {}
    showTheme(value || DATA.current);
    showChosen();
    if (level === 'theme') setLevel('view', true);
  }

  // A theme chosen on an earlier page, if this page has it.
  try {
    var kept = localStorage.getItem(CHOSEN_THEME);
    if (kept && DATA.themes[kept]) {
      chosenName = kept;
      showTheme(kept);
    }
  } catch (e) {}
  showChosen();

  /* ---- the menus, by pointer and by key ---- */

  // The keys work in levels: the diagram; m, the bar, each control wearing
  // its letter; then a menu, View or Save; then, from View, the theme list.
  // A letter means what the level it is pressed in says, so no letter is used
  // up however deep the menus go. Keys that aren't letters mean the same at
  // every level: Backspace steps back one level, and beneath the menus lets
  // go of a grab, then a lit finding, then the selection; Escape goes straight
  // back to the plain diagram from anywhere; Enter does what the row the
  // arrows are on does. Opening a menu with a click puts the keys there too.
  var tools = document.querySelector('.tools');
  var viewButton = document.getElementById('view-button');
  var viewList = document.getElementById('view-list');
  var strip = document.getElementById('strip');
  var level = null;
  var cursor = 0;
  var themeBefore = null;

  var STRIP = {
    bar: ['<b>Menu</b>', 'letter to open \\u00B7 \\u232B back \\u00B7 Esc out'],
    view: ['Menu \\u203A <b>View</b>', 'letter to flip \\u00B7 \\u2191\\u2193 Enter \\u00B7 \\u232B back \\u00B7 Esc out'],
    save: ['Menu \\u203A <b>Save</b>', 'letter to save \\u00B7 \\u2191\\u2193 Enter \\u00B7 \\u232B back \\u00B7 Esc out'],
    theme: ['Menu \\u203A View \\u203A <b>Theme</b>', '\\u2191\\u2193 to try \\u00B7 Enter keep \\u00B7 \\u232B back \\u00B7 Esc out'],
  };

  function rows() {
    if (level === 'view') return Array.prototype.slice.call(viewList.querySelectorAll(':scope > .row'));
    if (level === 'save') return Array.prototype.slice.call(saveList.querySelectorAll(':scope > .row'));
    if (level === 'theme') return themeItems.map(function (item) { return item.row; });
    return [];
  }

  function markCursor() {
    each(document.querySelectorAll('.menu-list .row.cur'), function (row) { row.classList.remove('cur'); });
    var all = rows();
    if (!all.length) return;
    cursor = Math.max(0, Math.min(cursor, all.length - 1));
    all[cursor].classList.add('cur');
    if (level === 'theme') all[cursor].scrollIntoView({ block: 'nearest' });
  }

  // \`kept\`: leaving the theme list keeps the theme moved to, as Enter or a
  // click does; any other way out goes back to the theme shown before.
  function setLevel(next, kept) {
    if (level === 'theme' && next !== 'theme' && !kept && themeBefore !== null) showTheme(themeBefore);
    if (next === 'theme' && level !== 'theme') {
      themeBefore = shownTheme;
      cursor = 0;
      themeItems.forEach(function (item, i) { if (item.value === chosenName) cursor = i; });
    } else if (next !== level) {
      // Back from the theme list, the arrows are on Theme, the first row.
      cursor = 0;
    }
    level = next;
    tools.classList.toggle('keyed', level === 'bar');
    saveList.hidden = level !== 'save';
    saveButton.classList.toggle('open', level === 'save');
    saveButton.setAttribute('aria-expanded', String(level === 'save'));
    viewList.hidden = level !== 'view' && level !== 'theme';
    viewButton.classList.toggle('open', level === 'view' || level === 'theme');
    viewButton.setAttribute('aria-expanded', String(level === 'view' || level === 'theme'));
    themeList.hidden = level !== 'theme';
    viewList.classList.toggle('behind', level === 'theme');
    strip.hidden = level === null;
    if (level && STRIP[level]) {
      strip.querySelector('.crumbs').innerHTML = STRIP[level][0];
      strip.querySelector('.hint').textContent = STRIP[level][1];
    }
    if (level !== 'pick' && level !== 'filter') clearHints();
    markCursor();
  }

  function back() {
    if (level === 'theme') setLevel('view');
    else if (level === 'view' || level === 'save') setLevel('bar');
    else setLevel(null);
  }

  // Escape: the plain diagram, in one press, whatever was open or lit.
  function plain() {
    setLevel(null);
    zoom.grab(false);
    unlight();
    select(null);
  }

  /* ---- picking from the keyboard: letters on things ---- */

  // s puts a letter on everything, / starts a filter that narrows what gets
  // one, and with something selected n letters what one edge away from it,
  // i what is inside it and the box it sits in, and l its links. Typing a
  // letter picks. These are two more levels: 'pick', where letters pick, and
  // 'filter', where everything typed goes into the filter until Enter. A
  // filter's plain words match a thing's text; is:node, is:edge,
  // is:container and style:name narrow by kind and style.
  var hint = null;
  var hintLayer = element('div', '');
  hintLayer.id = 'hints';
  view.append(hintLayer);
  var popup = null;
  var frame = 0;
  var noticeTimer = 0;
  var MODE_WORD = { all: 'Select', neighbors: 'Neighbors', inside: 'Inside', links: 'Links' };
  var KINDS = ['node', 'edge', 'container'];

  function shownThing(name) {
    var node = graph.nodes[name];
    return node && !node.badge && (!node.guide || guidesShown);
  }
  function shownEdge(edge) { return !edge.guide || guidesShown; }
  function nameOf(target) {
    if (target.kind === 'node') return graph.nodes[target.key].label;
    var edge = graph.edges[target.key];
    return edge.label || graph.nodes[edge.up].label + ' \\u2192 ' + graph.nodes[edge.down].label;
  }

  // Where a thing's letter goes, in the drawing's own units: a box's top-left
  // corner, or the middle of its top edge when a child's letter already holds
  // the corner; bare text's, just left of it; a line's, somewhere along it
  // clear of its text.
  var anchors = { svg: null, at: {} };
  function anchorOf(target) {
    if (anchors.svg !== svg) anchors = { svg: svg, at: {} };
    var id = target.kind + ' ' + target.key;
    if (anchors.at[id]) return anchors.at[id];
    var at = null;
    if (target.kind === 'node') {
      var node = graph.nodes[target.key];
      var box = node.box;
      var crowded = node.children.some(function (child) {
        var other = graph.nodes[child].box;
        return Math.abs(other[0] - box[0]) < 8 && Math.abs(other[1] - box[1]) < 8;
      });
      if (node.bare) at = { x: box[0], y: box[1] + box[3] / 2, el: svg, side: 'left' };
      else at = { x: crowded ? box[0] + box[2] / 2 : box[0] + 2, y: box[1] + 2, el: svg };
    } else {
      var group = edgeGroups(target.key)[0];
      var stroke = group && group.querySelector('line:not(.target), path[fill="none"]:not(.target), polyline:not(.target)');
      if (stroke && stroke.getTotalLength) {
        var texts = Array.prototype.map.call(group.querySelectorAll('text'), function (text) { return text.getBBox(); });
        var length = stroke.getTotalLength();
        var clear = function (point) {
          return texts.every(function (box) {
            return point.x < box.x - 12 || point.x > box.x + box.width + 12 || point.y < box.y - 12 || point.y > box.y + box.height + 12;
          });
        };
        var point = null;
        [0.3, 0.7, 0.2, 0.8, 0.5, 0.12, 0.88].some(function (along) {
          var tried = stroke.getPointAtLength(length * along);
          if (!point) point = tried;
          if (clear(tried)) { point = tried; return true; }
          return false;
        });
        at = { x: point.x, y: point.y, el: stroke };
      }
    }
    anchors.at[id] = at;
    return at;
  }
  // The same, in pixels from the view's top-left corner, or null.
  function onScreen(target) {
    var at = anchorOf(target);
    if (!at) return null;
    var matrix = at.el.getScreenCTM();
    if (!matrix) return null;
    var point = new DOMPoint(at.x, at.y).matrixTransform(matrix);
    var room = view.getBoundingClientRect();
    return { x: point.x - room.left, y: point.y - room.top, side: at.side, inView: point.x >= room.left && point.x <= room.right && point.y >= room.top && point.y <= room.bottom };
  }

  // Things in view come first, so the one-letter labels go to what can be
  // seen; then top to bottom and left to right. Boxes before lines.
  function ordered(targets) {
    // Links keep the order the source writes them in, as the panel lists them.
    if (targets.length && targets[0].kind === 'link') return targets;
    var placed = targets.map(function (target, i) { return { target: target, at: onScreen(target) || { x: 0, y: 0, inView: false }, i: i }; });
    placed.sort(function (a, b) {
      if (a.target.kind !== b.target.kind) return a.target.kind === 'node' ? -1 : 1;
      if (a.at.inView !== b.at.inView) return a.at.inView ? -1 : 1;
      return Math.round(a.at.y / 24) - Math.round(b.at.y / 24) || a.at.x - b.at.x;
    });
    return placed.map(function (one) { return one.target; });
  }

  function allTargets() {
    var out = [];
    Object.keys(graph.nodes).forEach(function (name) { if (shownThing(name)) out.push({ kind: 'node', key: name }); });
    graph.edges.forEach(function (edge, index) { if (shownEdge(edge)) out.push({ kind: 'edge', key: index }); });
    return out;
  }
  function neighborTargets() {
    var nodes = [], edges = [];
    function addNode(name) {
      if (shownThing(name) && !(selection.kind === 'node' && name === selection.key) && nodes.indexOf(name) < 0) nodes.push(name);
    }
    if (selection.kind === 'edge') {
      var edge = graph.edges[selection.key];
      addNode(edge.up);
      addNode(edge.down);
    } else {
      graph.edges.forEach(function (edge, index) {
        if (!shownEdge(edge) || (edge.up !== selection.key && edge.down !== selection.key)) return;
        edges.push(index);
        addNode(edge.up === selection.key ? edge.down : edge.up);
      });
    }
    return nodes.map(function (name) { return { kind: 'node', key: name }; })
      .concat(edges.map(function (index) { return { kind: 'edge', key: index }; }));
  }
  function insideTargets() {
    var node = graph.nodes[selection.key];
    var out = node.children.filter(shownThing);
    if (node.parent && shownThing(node.parent)) out.push(node.parent);
    return out.map(function (name) { return { kind: 'node', key: name }; });
  }
  function linkTargets() {
    var thing = selection.kind === 'node' ? graph.nodes[selection.key] : graph.edges[selection.key];
    return thing.links.map(function (link, index) { return { kind: 'link', key: index, link: link }; });
  }

  // As many one-letter labels as there are letters; past that, letters from
  // the end of the alphabet start two-letter ones, as few as will do.
  function codes(count) {
    var letters = 'abcdefghijklmnopqrstuvwxyz';
    if (count <= 26) return letters.slice(0, count).split('');
    for (var prefixes = 1; prefixes <= 26; prefixes++) {
      if (26 - prefixes + 26 * prefixes < count) continue;
      var out = letters.slice(0, 26 - prefixes).split('');
      for (var p = 0; out.length < count; p++) {
        for (var q = 0; q < 26 && out.length < count; q++) out.push(letters[25 - p] + letters[q]);
      }
      return out;
    }
    var all = [''];
    while (all.length < count) {
      var longer = [];
      all.forEach(function (start) { for (var i = 0; i < 26; i++) longer.push(start + letters[i]); });
      all = longer;
    }
    return all.slice(0, count);
  }

  var styleNames = {};
  Object.keys(graph.nodes).forEach(function (name) { graph.nodes[name].styles.forEach(function (one) { styleNames[one] = true; }); });
  graph.edges.forEach(function (edge) { edge.styles.forEach(function (one) { styleNames[one] = true; }); });

  // The filter: every word must match. Returns the matches, and a message
  // when a word can match nothing at all, naming what it accepts.
  function filtered(targets, query) {
    var words = query.toLowerCase().split(' ').filter(function (word) { return word !== ''; });
    var message = '';
    var tests = words.map(function (word) {
      var colon = word.indexOf(':');
      var key = colon > 0 ? word.slice(0, colon) : '';
      var value = colon > 0 ? word.slice(colon + 1) : '';
      if (key === 'is') {
        var kinds = KINDS.filter(function (kind) { return kind.indexOf(value) === 0; });
        if (kinds.length === 0) message = 'is: takes node, edge or container';
        return function (target, thing) {
          if (value === '') return true;
          return kinds.some(function (kind) {
            if (kind === 'edge') return target.kind === 'edge';
            if (kind === 'node') return target.kind === 'node';
            return target.kind === 'node' && thing.children.length > 0;
          });
        };
      }
      if (key === 'style') {
        var names = Object.keys(styleNames).filter(function (name) { return name.toLowerCase().indexOf(value) === 0; });
        if (names.length === 0) message = 'no style named "' + value + '"';
        return function (target, thing) {
          return value === '' || (thing.styles || []).some(function (name) { return names.indexOf(name) >= 0; });
        };
      }
      if (key !== '' && /^[a-z]+$/.test(key)) {
        message = key + ': is not a filter; the filters are is: and style:';
        return function () { return false; };
      }
      return function (target, thing) { return (thing.label || '').toLowerCase().indexOf(word) >= 0; };
    });
    var matches = targets.filter(function (target) {
      var thing = target.kind === 'node' ? graph.nodes[target.key] : target.kind === 'edge' ? graph.edges[target.key] : target.link;
      return tests.every(function (test) { return test(target, thing); });
    });
    return { matches: matches, message: message };
  }

  function startHints(mode, filtering) {
    var base;
    if (mode === 'all') base = allTargets();
    else if (!selection) { notice('Select something first: s, then a letter'); return; }
    else if (mode === 'inside' && selection.kind === 'edge') { notice('A line has nothing inside it'); return; }
    else base = mode === 'neighbors' ? neighborTargets() : mode === 'inside' ? insideTargets() : linkTargets();
    if (base.length === 0) {
      notice(mode === 'links' ? nameOf(selection) + ' has no links' : mode === 'inside' ? nameOf(selection) + ' has nothing inside it and sits in nothing' : nameOf(selection) + ' has no lines');
      return;
    }
    hint = { mode: mode, base: base, query: '', typed: '', filtering: !!filtering, direct: !!filtering, shown: [], message: '' };
    setLevel(filtering ? 'filter' : 'pick');
    refresh();
  }

  function clearHints() {
    if (!hint && !popup) return;
    hint = null;
    hintLayer.textContent = '';
    if (popup) { popup.remove(); popup = null; }
    each(document.querySelectorAll('#selected .hintkey'), function (key) { key.remove(); });
    if (svg) {
      svg.classList.remove('hinting');
      each(svg.querySelectorAll('.hint-on'), function (group) { group.classList.remove('hint-on'); });
    }
    cancelAnimationFrame(frame);
  }

  function groupsOf(target) {
    return target.kind === 'node' ? nodeGroups(target.key) : target.kind === 'edge' ? edgeGroups(target.key) : [];
  }

  // Work out what wears a letter, and draw the letters and the strip.
  function refresh() {
    var result = filtered(hint.base, hint.query);
    hint.message = result.message;
    var targets = ordered(result.matches);
    var labels = codes(targets.length);
    hint.shown = targets.map(function (target, i) { return { target: target, code: labels[i] }; });
    hint.typed = '';
    // Dim what can't be picked, unless everything can. Links aren't in the
    // drawing, so picking one dims nothing.
    each(svg.querySelectorAll('.hint-on'), function (group) { group.classList.remove('hint-on'); });
    var narrowed = hint.mode !== 'links' && (hint.mode !== 'all' || hint.shown.length < hint.base.length);
    svg.classList.toggle('hinting', narrowed);
    hint.shown.forEach(function (one) { each(groupsOf(one.target), function (group) { group.classList.add('hint-on'); }); });
    if (selection) each(groupsOf(selection), function (group) { group.classList.add('hint-on'); });
    drawLabels();
    showStrip();
  }

  function keyElement(code) {
    var key = element('span', 'hintkey');
    key.setAttribute('data-code', code);
    key.textContent = code;
    return key;
  }

  function drawLabels() {
    hintLayer.textContent = '';
    if (popup) { popup.remove(); popup = null; }
    each(document.querySelectorAll('#selected .hintkey'), function (key) { key.remove(); });
    if (hint.mode === 'links') {
      if (!side.hidden) {
        // On the panel's own rows, where the links already are.
        var rows = selectedPanel.querySelectorAll('a.link');
        hint.shown.forEach(function (one) { var row = rows[one.target.key]; if (row) row.prepend(keyElement(one.code)); });
      } else {
        // The panel is hidden, so the links come up beside the selection.
        popup = element('div', '');
        popup.id = 'link-pop';
        hint.shown.forEach(function (one) {
          var row = element('a', 'link');
          row.href = one.target.link.href;
          row.target = '_blank';
          row.rel = 'noopener';
          row.append(keyElement(one.code));
          row.insertAdjacentHTML('beforeend', one.target.link.badges[shownTheme]);
          row.append(element('span', 'label', one.target.link.label));
          popup.append(row);
        });
        view.append(popup);
      }
    } else {
      hint.shown.forEach(function (one) {
        var key = keyElement(one.code);
        one.el = key;
        hintLayer.append(key);
      });
    }
    place();
  }

  // Letters follow the drawing as it pans and zooms.
  function place() {
    cancelAnimationFrame(frame);
    if (!hint) return;
    hint.shown.forEach(function (one) {
      if (!one.el) return;
      var at = onScreen(one.target);
      one.el.style.display = at ? '' : 'none';
      if (at) one.el.style.transform = 'translate(' + Math.round(at.x) + 'px,' + Math.round(at.y) + 'px) ' + (at.side === 'left' ? 'translate(calc(-100% - 4px), -50%)' : 'translate(-50%, -50%)');
    });
    if (popup && selection) {
      var at = onScreen(selection);
      if (at) {
        popup.style.left = Math.round(Math.min(Math.max(at.x, 8), view.clientWidth - popup.offsetWidth - 8)) + 'px';
        popup.style.top = Math.round(Math.min(Math.max(at.y - popup.offsetHeight - 10, 8), view.clientHeight - popup.offsetHeight - 8)) + 'px';
      }
    }
    frame = requestAnimationFrame(place);
  }

  function escapeText(text) {
    var holder = element('span', '', text);
    return holder.innerHTML;
  }

  function showStrip() {
    var crumbs = '<b>' + MODE_WORD[hint.mode] + '</b>';
    if (hint.mode !== 'all') crumbs += ' ' + (hint.mode === 'inside' ? '' : 'of ') + escapeText(nameOf(selection));
    if (hint.filtering || hint.query) crumbs += ' \\u203A <span class="query">/' + escapeText(hint.query) + (hint.filtering ? '<i>\\u258C</i>' : '') + '</span>';
    var count = hint.shown.length;
    var said;
    if (hint.filtering) {
      said = (hint.message || (count === 1 ? '1 match \\u00B7 Enter picks it' : count + ' match' + (count === 1 ? '' : 'es') + (count ? ' \\u00B7 Enter to pick' : ''))) + ' \\u00B7 \\u232B \\u00B7 Esc out';
    } else {
      said = (hint.mode === 'links' ? 'letter to open' : 'letter to pick') + (hint.mode === 'links' ? '' : ' \\u00B7 / filter') + ' \\u00B7 \\u232B back \\u00B7 Esc out \\u00B7 ' + count;
    }
    strip.hidden = false;
    strip.querySelector('.crumbs').innerHTML = crumbs;
    strip.querySelector('.hint').textContent = said;
  }

  function notice(text) {
    clearTimeout(noticeTimer);
    if (level) setLevel(null);
    strip.hidden = false;
    strip.querySelector('.crumbs').textContent = '';
    strip.querySelector('.hint').textContent = text;
    noticeTimer = setTimeout(function () { if (!level) strip.hidden = true; }, 1800);
  }

  // A picked thing is selected, and brought into view if it was out of it.
  function act(target) {
    if (target.kind === 'link') {
      setLevel(null);
      window.open(target.link.href, '_blank', 'noopener');
      return;
    }
    setLevel(null);
    select(target);
    var at = onScreen(target);
    if (at && !at.inView) zoom.pan(view.clientWidth / 2 - at.x, view.clientHeight / 2 - at.y);
  }

  // The keys at the two levels. Returns false for a key left to the page.
  function hintKey(event) {
    var key = event.key;
    if (hint.filtering) {
      if (key === 'Enter') {
        if (hint.shown.length === 1) act(hint.shown[0].target);
        else if (hint.shown.length > 1) { hint.filtering = false; setLevel('pick'); showStrip(); }
      } else if (key === 'Backspace') {
        if (hint.query) { hint.query = hint.query.slice(0, -1); refresh(); }
        else if (hint.direct) setLevel(null);
        else { hint.filtering = false; setLevel('pick'); showStrip(); }
      } else if (key.length === 1) { hint.query += key; refresh(); }
      else return false;
      return true;
    }
    if (ZOOM_KEYS[key] || key === 'Tab') return false;
    if (key === 'Backspace') {
      if (hint.typed) { hint.typed = hint.typed.slice(0, -1); markTyped(); }
      else if (hint.query || hint.mode === 'all' && hint.direct) { hint.filtering = true; setLevel('filter'); showStrip(); }
      else setLevel(null);
      return true;
    }
    if (key === '/' && hint.mode !== 'links') { hint.filtering = true; setLevel('filter'); showStrip(); return true; }
    if (key.length === 1 && /[a-z]/i.test(key)) {
      var typed = hint.typed + key.toLowerCase();
      var exact = hint.shown.filter(function (one) { return one.code === typed; })[0];
      if (exact) { act(exact.target); return true; }
      if (hint.shown.some(function (one) { return one.code.indexOf(typed) === 0; })) { hint.typed = typed; markTyped(); }
      return true;
    }
    return key.indexOf('Arrow') !== 0;
  }

  // Letters that no longer fit what has been typed step aside.
  function markTyped() {
    hint.shown.forEach(function (one) {
      var key = one.el || document.querySelector('#selected .hintkey[data-code="' + one.code + '"], #link-pop .hintkey[data-code="' + one.code + '"]');
      if (!key) return;
      var fits = one.code.indexOf(hint.typed) === 0;
      key.classList.toggle('gone', !fits);
      key.innerHTML = fits && hint.typed ? '<span class="done">' + hint.typed + '</span>' + one.code.slice(hint.typed.length) : one.code;
    });
  }

  saveButton.onclick = function () { setLevel(level === 'save' ? null : 'save'); };
  viewButton.onclick = function () { setLevel(level === 'view' || level === 'theme' ? null : 'view'); };
  themeRow.onclick = function () { setLevel(level === 'theme' ? 'view' : 'theme'); };
  document.addEventListener('click', function (event) {
    if (level && !(event.target.closest && event.target.closest('.menu'))) setLevel(null);
  });

  function move(by) {
    var all = rows();
    if (!all.length) return;
    cursor = (cursor + by + all.length) % all.length;
    markCursor();
    if (level === 'theme') showTheme(themeItems[cursor].value || DATA.current);
  }

  function enter() {
    var all = rows();
    if (!all.length) return;
    if (level === 'theme') keepTheme(themeItems[cursor].value);
    else all[cursor].click();
  }

  var ZOOM_KEYS = { '+': 1, '=': 1, '-': 1, '_': 1, '0': 1, '1': 1 };

  // On the window, before the zoom's own keys, so a menu's letters reach the
  // menu and not the diagram underneath: g flips guides in View, not a grab.
  window.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest && event.target.closest('input, textarea, select, [contenteditable]')) return;
    var key = event.key;
    if (key === 'Escape') plain();
    else if (level === 'pick' || level === 'filter') {
      if (!hintKey(event)) return;
    } else if (level === null) {
      if (key === 'm' || key === 'M') setLevel('bar');
      else if (key === 's') startHints('all');
      else if (key === '/') startHints('all', true);
      else if (key === 'n') startHints('neighbors');
      else if (key === 'i') startHints('inside');
      // During a grab, l pans right.
      else if (key === 'l' && !zoom.held()) startHints('links');
      else if (key === 'Backspace') {
        if (zoom.held()) zoom.grab(false);
        else if (lit.length) unlight();
        else if (selection) select(null);
        else return;
      } else return;
    } else {
      if (ZOOM_KEYS[key] || key === 'Tab') return;
      if (key === 'Backspace') back();
      else if (key === 'ArrowDown') move(1);
      else if (key === 'ArrowUp') move(-1);
      else if (key === 'Enter' || key === ' ') enter();
      else if (key.length === 1) {
        var letter = key.toLowerCase();
        if (level === 'bar') {
          if (letter === 'v') setLevel('view');
          else if (letter === 's') setLevel('save');
          else if (letter === 'f' && !full.hidden) { setLevel(null); toggleFull(); }
        } else if (level === 'view' || level === 'save') {
          rows().forEach(function (row, i) {
            if (row.getAttribute('data-key') !== letter) return;
            cursor = i;
            markCursor();
            row.click();
          });
        }
      } else if (key.indexOf('Arrow') !== 0) return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // With the menus closed, p and f still show the panel and go full screen.
  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest && event.target.closest('input, textarea, select')) return;
    if (event.key === 'p') setPanel(!panelOn);
    else if (event.key === 'f' && !full.hidden) toggleFull();
    else return;
    event.preventDefault();
  });

  layoutSide();
  zoom.show();
})();
</script>
</body>
</html>
`;
