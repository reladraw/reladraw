import type { Finding } from './checks.js';
import type { DrawOptions } from './index.js';
import { dataOf, partsOf, type PageParts } from './page-data.js';
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
  editing?: Editing,
): { html: string; findings: Finding[] } {
  const parts = partsOf(source, file, options, at);
  return { html: page(parts, editing ?? null), findings: parts.findings };
}

/**
 * How a page's source can be edited, when it can: served by `reladraw serve`
 * tied to a file, by its path inside the folder served, which the page asks
 * the server about; served with no file, keeping its text in the browser until
 * a first Save names a file in `folder`; or the hosted playground, which keeps
 * its text in the browser and saves by download. A page with no file offers
 * the examples, the first of which a new visitor starts with.
 */
export type Editing =
  | { kind: 'file'; file: string }
  | { kind: 'local'; folder: string; examples: Example[] }
  | { kind: 'hosted'; examples: Example[] };

/** An example a page with no file offers: what it is called, one line about it, and its source. */
export interface Example {
  name: string;
  about: string;
  source: string;
}

/** What makes a page with no file: the examples, and where it is. */
export interface Playground {
  examples: Example[];
  /** Served by `reladraw serve` with no file: the folder it serves, as the page shows it. */
  folder?: string;
  /** The hosted playground: what goes in its `<head>`, such as its description for search engines. */
  head?: string;
  /**
   * The hosted playground: the library as one classic script that sets
   * `globalThis.reladraw`, which the page draws with, since a page opened
   * from disk or a static host can't import modules the way a served one does.
   */
  library?: string;
}

/**
 * The page with no file: the playground. It opens on the first example and
 * draws whatever its visitor last had in that browser, with the source shown.
 */
export function playgroundPage(playground: Playground): string {
  const { examples, folder } = playground;
  const parts = partsOf(examples[0]?.source ?? '', 'diagram.reladraw', {}, new Date());
  const editing: Editing = folder !== undefined ? { kind: 'local', folder, examples } : { kind: 'hosted', examples };
  return page(parts, editing, {
    title: folder !== undefined ? `reladraw · ${folder}` : 'reladraw playground: write diagrams in the browser',
    heading: 'reladraw',
    // The hosted playground has no line under its name: the page shows what it is.
    drawn: folder !== undefined ? `local playground · ${folder} · not saved to a file` : '',
    head: playground.head ?? '',
    library: playground.library ?? '',
  });
}

/** What a page with no file says in place of a diagram's title, and the parts it adds. */
interface Framing {
  title: string;
  heading: string;
  drawn: string;
  head: string;
  library: string;
}

function page(parts: PageParts, editing: Editing | null, framing?: Framing): string {
  const { themes, current } = parts;
  const shown = themes[current]!;
  const data = { ...dataOf(parts), edit: editing };
  const title = framing?.title ?? parts.title;
  const noFile = editing !== null && editing.kind !== 'file';
  const filled: Record<string, string> = {
    panzoom: PAN_ZOOM,
    scheme: shown.scheme,
    title: escapeMarkup(title),
    head: framing?.head ?? '',
    heading: escapeMarkup(framing?.heading ?? parts.title),
    drawn: escapeMarkup(framing?.drawn ?? parts.drawn),
    links: noFile ? LINKS : '',
    colors: [
      ...Object.entries(shown.colors).map(([key, value]) => `${key}: ${value};`),
      '--sel: #e0b25a; --up: #22b98c; --down: #e5484d;',
    ].join(' '),
    cheatsheet: editing ? CHEATSHEET : '',
    dialogs: (editing ? FORMAT_DIALOG : '') + (noFile ? DIALOGS : ''),
    drawing: shown.tagged,
    // A literal </script> in the library's text would end its tag early.
    library: framing?.library ? `<script>\n${framing.library.replace(/<\/script/gi, '<\\/script')}\n</script>` : '',
    data: scriptJson(data),
  };
  // One pass, so nothing put in (a title, a drawing, the library) is read
  // again as a marker, and a function, so a `$` in it is taken as written.
  return PAGE.replace(/\{\{([a-z]+)\}\}/g, (marker, key: string) => filled[key] ?? marker);
}

function escapeMarkup(text: string): string {
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
{{head}}
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
  .heading { flex: 0 1 auto; min-width: 0; }
  header .tools { margin-left: auto; }
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
    width: min(24rem, 36vw); display: flex; flex-direction: column; min-height: 0; position: relative;
    border-left: 1px solid color-mix(in srgb, var(--rule) 45%, transparent);
  }
  /* Its left edge is dragged, or moved with the arrows, to make it wider. */
  #side-split { position: absolute; left: -4px; top: 0; bottom: 0; width: 7px; z-index: 5; cursor: col-resize; touch-action: none; }
  #side-split:hover, #side-split.dragging, #side-split:focus-visible { background: color-mix(in srgb, var(--accent) 45%, transparent); outline: 0; }
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
     then the theme list. The strip at the foot of the picture says where the keys are and
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
  /* Floats over the bottom of the picture, left of the zoom card, so going
     into a keyboard mode never moves the drawing. */
  #strip {
    left: 12px; bottom: 12px; max-width: calc(100% - 290px); box-sizing: border-box;
    display: flex; gap: 16px; padding: 5px 12px; font-size: 12px; border-radius: 7px; pointer-events: none;
    background: color-mix(in srgb, var(--sel) 16%, var(--page)); color: var(--ink);
    border: 1px solid color-mix(in srgb, var(--sel) 45%, transparent);
  }
  #strip .crumbs { white-space: nowrap; }
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
  /* Close: a small square button, bordered like the buttons beside it. */
  button.close { width: 24px; height: 24px; padding: 0; font-size: 17px; line-height: 1; color: var(--ink);
    display: inline-flex; align-items: center; justify-content: center; }
  aside h2 .close { float: right; margin: -2px -8px 0 8px; }
  aside ol { list-style: none; margin: 0; padding: 0 8px 12px; overflow: auto; }
  aside li button {
    display: block; width: 100%; text-align: left; white-space: normal; border-color: transparent;
    padding: 6px 8px; margin: 2px 0;
  }
  aside li button.chosen { border-color: var(--accent); }
  aside li.none { padding: 6px 8px; color: var(--muted); font-size: 13px; }
  /* Findings from an older version of the source: dimmed, not cleared. */
  aside li.again, #band .again { padding: 6px 8px; color: var(--muted); font-size: 12px; }
  aside.stale li:not(.again):not(.error), #band.stale .found { opacity: 0.5; }
  /* While the source is open, the findings sit in a band under the picture,
     taking height from it, never width. */
  #picture { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  #band { flex: none; max-height: 35%; overflow: auto; padding: 4px 12px 8px; font-size: 13px;
    border-top: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  #band[hidden] { display: none; }
  #band .head { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
  #band .head b { font-size: 12px; font-weight: 600; color: var(--muted); }
  #band .head .gap { flex: 1; }
  #band .head button:not(.close) { font-size: 12px; padding: 1px 8px; }
  #band .found button { display: block; width: 100%; text-align: left; white-space: normal; border-color: transparent; padding: 3px 6px; }
  #band .found button.chosen { border-color: var(--accent); }
  #band .again { padding: 2px 0; }
  aside li.error { padding: 6px 8px; margin: 2px 0; border-left: 3px solid var(--down); font-size: 13px; }
  aside li.error .kind { color: var(--down); }
  #live {
    padding: 5px 16px; font-size: 12.5px;
    background: color-mix(in srgb, var(--down) 18%, var(--page)); color: var(--ink);
    border-bottom: 1px solid color-mix(in srgb, var(--down) 45%, transparent);
  }
  #live[hidden] { display: none; }

  /* The editor: a colored layer under a transparent textarea, every property
     that can move a character the same on both, as in the playground. */
  #editor {
    width: 38%; min-width: 280px; max-width: 760px; display: flex; flex-direction: column;
    border-right: 1px solid color-mix(in srgb, var(--rule) 45%, transparent);
    background: color-mix(in srgb, var(--ink) 4%, var(--page));
  }
  #editor[hidden] { display: none; }
  /* The picture's controls float over it: Check at its top left, the zoom
     on a card at its bottom right. They sit beside the view, not in it, so a
     press on them never starts a pan. */
  #canvas { position: relative; flex: 1; display: flex; min-height: 0; }
  .floating { position: absolute; z-index: 4;
    background: color-mix(in srgb, var(--ink) 7%, var(--page));
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); }
  .floating[hidden] { display: none; }
  #check { left: 12px; top: 12px; padding: 5px 14px; }
  #check:hover { background: color-mix(in srgb, var(--ink) 14%, var(--page)); }
  #zoom-card { right: 12px; bottom: 12px; display: flex; align-items: center; gap: 5px; padding: 4px 5px; border-radius: 9px;
    border: 1px solid color-mix(in srgb, var(--rule) 55%, transparent); }
  /* The card a shade darker than its buttons, so each reads as a button. */
  #zoom-card { background: color-mix(in srgb, var(--ink) 4%, var(--page)); }
  #zoom-card button { background: color-mix(in srgb, var(--ink) 13%, var(--page)); }
  #zoom-card button:hover { background: color-mix(in srgb, var(--ink) 20%, var(--page)); }
  #zoom-card button.pm { font-size: 17px; line-height: 1; padding: 2px 9px; min-width: 30px; }
  #zoom-card .divider { width: 1px; height: 18px; margin: 0 3px; background: color-mix(in srgb, var(--rule) 70%, transparent); }
  body:has(.tools.keyed) #check kbd.tag { display: inline; }
  .src-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12.5px;
    border-bottom: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  .src-head .file { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #unsaved { color: var(--sel); }
  #unsaved[hidden] { display: none; }
  .src-head .gap, #changed .gap { flex: 1; }
  #file-menu[hidden] { display: none; }
  #file-list { left: 0; right: auto; min-width: 12rem; }
  #file-button.open { border-color: var(--sel); background: color-mix(in srgb, var(--sel) 22%, transparent); }
  .src-head kbd { font: 11px system-ui, sans-serif; color: var(--muted); margin-left: 4px; }
  #changed { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12.5px;
    background: color-mix(in srgb, var(--sel) 18%, var(--page));
    border-bottom: 1px solid color-mix(in srgb, var(--sel) 45%, transparent); }
  #changed[hidden] { display: none; }
  .code { position: relative; flex: 1; min-height: 0; }
  .code > * {
    position: absolute; inset: 0; margin: 0; border: 0; padding: 12px 14px;
    font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace;
    tab-size: 2; white-space: pre-wrap; overflow-wrap: break-word; word-break: normal;
  }
  #paint { overflow: hidden; color: var(--ink); pointer-events: none; }
  /* The line stating what is selected in the picture, in the selection's amber. */
  #paint .src-mark { display: block; margin: 0 -14px; padding: 0 11px; border-left: 3px solid var(--sel);
    background: color-mix(in srgb, var(--sel) 18%, transparent); }
  #source { resize: none; outline: 0; background: transparent; color: transparent; caret-color: var(--ink); overflow-y: auto; }
  #source::selection { background: rgba(130, 170, 240, 0.28); color: transparent; }
  :root { --syn-comment: #6a6a78; --syn-string: #9ec99a; --syn-keyword: #82aaf0; --syn-name: #b8c9e8;
    --syn-relation: #c79bdc; --syn-attribute: #6fb3ac; --syn-value: #d3a05f; }
  :root[data-scheme="light"] { --syn-comment: #8a8a96; --syn-string: #3f7a3a; --syn-keyword: #2f5fb8; --syn-name: #34495e;
    --syn-relation: #8a3fa8; --syn-attribute: #217a72; --syn-value: #a0601a; }
  .t-comment, .t-bracket, .t-markup { color: var(--syn-comment); }
  .t-string { color: var(--syn-string); }
  .t-keyword { color: var(--syn-keyword); }
  .t-name { color: var(--syn-name); }
  .t-relation, .t-arrow { color: var(--syn-relation); }
  .t-attribute { color: var(--syn-attribute); }
  .t-value, .t-color { color: var(--syn-value); }
  /* Edit | View: which mode the page is in, the one it is in filled. Edit
     is on the left, the side the source opens on. */
  .mode { display: inline-flex; position: relative; }
  .mode[hidden] { display: none; }
  .mode button { border-radius: 0; color: var(--muted); padding: 4px 12px; }
  .mode button:first-child { border-radius: 6px 0 0 6px; }
  .mode button:last-child { border-radius: 0 6px 6px 0; border-left: 0; }
  .mode button[aria-pressed="true"] { background: color-mix(in srgb, var(--ink) 20%, transparent); color: var(--ink); font-weight: 600; }
  .mode button[aria-pressed="true"]:hover { cursor: default; }
  header:has(.tools.keyed) .mode kbd.tag { display: inline; }
  header:has(.tools.keyed) .mode { outline: 2px solid var(--sel); outline-offset: 4px; border-radius: 6px; }
  .menu-list.wide { min-width: 340px; }
  .menu-list .row .when { color: var(--muted); font-variant-numeric: tabular-nums; width: 3.2em; flex: none; }
  .menu-list .row .who { width: 4.5em; flex: none; }
  .menu-list .row .who.you { color: #8fb3ff; }
  .menu-list .row .who.agent { color: var(--up); }
  .menu-list .row .who.disk, .menu-list .row .who.opened { color: var(--muted); }
  .menu-list .row .about { flex: 1; text-align: left; white-space: normal; }
  .where { color: var(--muted); font-variant-numeric: tabular-nums; }
  .kind { color: var(--accent); }
  .note { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
  aside li.error button.copy { float: right; display: inline-block; width: auto; margin: 0 0 0 8px; padding: 0 6px; font-size: 11px;
    border-color: color-mix(in srgb, var(--rule) 70%, transparent); }
  aside li.error .goto { cursor: pointer; text-decoration: underline dotted; }

  /* ---- a page with no file: the playground ---- */
  /* GitHub, as its mark beside the name. */
  .heading h1 { display: inline; vertical-align: middle; }
  .links { display: inline-flex; vertical-align: middle; margin-left: 10px; }
  .links a { display: inline-flex; color: var(--muted); padding: 2px; border-radius: 4px; }
  .links a:hover { color: var(--ink); }
  .links a:focus-visible { outline: 2px solid var(--accent); }
  /* A link as a row of a menu, like the buttons around it. */
  .menu-list a.row { color: var(--ink); text-decoration: none; font-size: 13px; border: 1px solid transparent; border-radius: 6px; }
  .menu-list a.row:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); }
  #help-menu[hidden] { display: none; }
  .drawn:empty { display: none; }
  /* The divider between the source and the picture: dragged, or moved with the arrows. */
  #split { flex: none; width: 6px; margin: 0 -3px; z-index: 2; cursor: col-resize; touch-action: none; }
  #split[hidden] { display: none; }
  #split:hover, #split.dragging, #split:focus-visible { background: color-mix(in srgb, var(--accent) 45%, transparent); outline: 0; }
  body.dragging { cursor: col-resize; user-select: none; }
  /* The cheatsheet: a button in the source's bar opens a large window, a
     card per topic, each row an example in the editor's colors beside what
     it does. The filter narrows the rows as you type. */
  #cheatsheet { width: min(1180px, calc(100vw - 32px)); height: min(820px, calc(100vh - 32px)); max-width: none; max-height: none; }
  #cheatsheet[open] { display: flex; flex-direction: column; }
  #cheatsheet .cs-head { display: flex; align-items: center; gap: 12px; padding: 10px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  #cheatsheet .cs-head h2 { font-size: 14px; }
  #cheat-filter { flex: 0 1 340px; font: inherit; font-size: 13px; color: var(--ink); padding: 4px 10px; border-radius: 6px;
    background: color-mix(in srgb, var(--ink) 4%, var(--page)); border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); }
  #cheat-filter:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  #cheatsheet .cs-head .gap { flex: 1; }
  #cheatsheet .cs-grid { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px 18px; }
  /* Cards fill three columns top to bottom; the page fills each column as the
     window opens, so the columns come out about the same height. */
  .cs-cols { display: grid; grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); gap: 14px; align-items: start; }
  .cs-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .cs-card { border-radius: 8px; overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--hue) 30%, transparent);
    background: color-mix(in srgb, var(--ink) 3%, var(--page)); }
  .cs-card[hidden] { display: none; }
  .cs-card h3 { margin: 0; padding: 7px 12px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
    color: var(--hue); background: color-mix(in srgb, var(--hue) 12%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--hue) 22%, transparent); }
  .cs-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 4px 12px; padding: 6px 12px; font-size: 12.5px;
    border-top: 1px solid color-mix(in srgb, var(--rule) 25%, transparent); }
  .cs-card h3 + .cs-row { border-top: 0; }
  .cs-row[hidden] { display: none; }
  .cs-row code { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; color: var(--ink); }
  .cs-row > span { color: var(--muted); }
  .cs-note { margin: 0; padding: 7px 12px 9px; font-size: 12px; color: var(--muted);
    border-top: 1px solid color-mix(in srgb, var(--rule) 25%, transparent); }
  .cs-note code { font: 11.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--ink); }
  .cs-none { margin: 0; padding: 24px 16px; color: var(--muted); }
  .cs-none[hidden] { display: none; }
  dialog { padding: 0; color: var(--ink); background: var(--page); overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); border-radius: 6px; }
  dialog::backdrop { background: rgba(0, 0, 0, .6); }
  dialog .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  dialog h2 { margin: 0; font-size: 13px; font-weight: 600; }
  dialog footer { display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 12px; color: var(--muted);
    border-top: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  dialog footer .gap { flex: 1; }
  #examples { width: min(1100px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); max-width: none; max-height: none; }
  #examples[open] { display: grid; grid-template-columns: 220px 1fr; grid-template-rows: auto auto minmax(0, 1fr) auto; }
  #examples .bar, #examples footer { grid-column: 1 / -1; }
  #catalog { grid-row: 2 / 4; margin: 0; padding: 6px 0; list-style: none; overflow-y: auto; outline: 0;
    border-right: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  #catalog li { padding: 6px 16px; font-size: 13px; cursor: pointer; border-left: 2px solid transparent; }
  #catalog li:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }
  #catalog li[aria-selected="true"] { background: color-mix(in srgb, var(--ink) 13%, transparent); border-left-color: var(--accent); }
  #catalog:focus-visible li[aria-selected="true"] { outline: 1px solid var(--muted); outline-offset: -1px; }
  #about { margin: 0; padding: 10px 16px; font-size: 13px; border-bottom: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  #preview { min-width: 0; min-height: 0; overflow: auto; padding: 16px; display: flex; }
  #preview svg { max-width: 100%; max-height: 100%; height: auto; margin: auto; }
  #format-settings, #save-as { width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 32px); }
  #format-settings[open], #save-as[open] { display: flex; flex-direction: column; }
  dialog .about { margin: 0; padding: 10px 16px; font-size: 12px; color: var(--muted); }
  dialog .about[hidden] { display: none; }
  #format-save[hidden] { display: none; }
  #format-fields { overflow-y: auto; padding: 4px 16px; }
  #format-fields label { display: grid; grid-template-columns: 190px 1fr; gap: 2px 12px; align-items: center; padding: 8px 0; font-size: 13px;
    border-bottom: 1px solid color-mix(in srgb, var(--rule) 30%, transparent); }
  #format-fields label span { grid-column: 2; color: var(--muted); font-size: 11px; }
  #format-fields select, #format-fields input, #save-as input { font: 12px ui-monospace, Menlo, Consolas, monospace; color: var(--ink); background: var(--page);
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); border-radius: 4px; padding: 4px 6px; min-width: 0; }
  #save-as label { display: flex; align-items: center; gap: 8px; padding: 0 16px 12px; font-size: 13px; }
  #save-as input { flex: 1; font-size: 13px; }
  #format-problem, #save-problem { margin: 0; padding: 0 16px; color: var(--down); font-size: 12px; }
  #format-problem:not(:empty), #save-problem:not(:empty) { padding: 8px 16px; }
  @media (max-width: 760px) {
    #examples[open] { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 2fr) auto minmax(0, 3fr) auto; }
    #catalog { grid-row: auto; border-right: 0; border-bottom: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
    #format-fields label { grid-template-columns: 1fr; }
    #format-fields label span { grid-column: 1; }
    dialog footer .keys { display: none; }
  }
  @media (max-width: 700px) {
    #split { display: none; }
    #editor { width: auto !important; max-width: none; min-width: 0; height: 45%; border-right: 0;
      border-bottom: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
    main { flex-direction: column; }
    #side-split { display: none; }
    #side { width: auto !important; max-height: 45%; border-left: 0; border-top: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  }
</style>
</head>
<body>
<header>
  <div class="heading">
    <h1>{{heading}}</h1>{{links}}
    <p class="drawn">{{drawn}}</p>
  </div>
  <span id="mode" class="mode" role="group" aria-label="Mode" hidden>
    <button id="edit" type="button" title="The source beside the picture (e)" aria-pressed="false">Edit<kbd class="tag">e</kbd></button>
    <button id="mode-view" type="button" title="Only the picture (e)" aria-pressed="true">View</button>
  </span>
  <div class="tools">
    <span class="menu" id="versions-menu" hidden>
      <button id="versions-button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="versions-list">Versions ▾<kbd class="tag">o</kbd></button>
      <span id="versions-list" class="menu-list wide" role="menu" hidden></span>
    </span>
    <span class="menu">
      <button id="save" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="save-list">Export ▾<kbd class="tag">x</kbd></button>
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
      <button id="view-button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="view-list">Settings ▾<kbd class="tag">s</kbd></button>
      <span id="view-list" class="menu-list" role="menu" hidden>
        <button id="theme-row" class="row" type="button" role="menuitem" data-key="t" aria-haspopup="true" title="Draw the diagram in another theme"><span class="name">Theme <span class="value"></span> ▸</span><kbd>t</kbd></button>
        <hr>
        <button id="panel-row" class="row switch" type="button" role="menuitemcheckbox" data-key="p" title="Show or hide the side panel"><span class="sw"></span><span class="name">Side panel</span><span class="word"></span><kbd>p</kbd></button>
        <button id="auto-row" class="row switch" type="button" role="menuitemcheckbox" data-key="a" title="Show the side panel only while something is selected or the findings are open"><span class="sw"></span><span class="name">Auto-hide panel</span><span class="word"></span><kbd>a</kbd></button>
        <hr>
        <button id="findings-row" class="row switch" type="button" role="menuitemcheckbox" data-key="f" title="Show or hide the findings in the side panel"><span class="sw"></span><span class="name">Findings</span><span class="word"></span><kbd>f</kbd></button>
        <button id="autocheck-row" class="row switch" type="button" role="menuitemcheckbox" data-key="c" title="Look for findings every time the picture is drawn, without pressing Check" hidden><span class="sw"></span><span class="name">Check as I type</span><span class="word"></span><kbd>c</kbd></button>
        <hr>
        <button id="guides-row" class="row switch" type="button" role="menuitemcheckbox" data-key="g" title="Draw the guides: everything written with guide in front"><span class="sw"></span><span class="name">Guides</span><span class="word"></span><kbd>g</kbd></button>
        <span id="theme-list" class="menu-list sub" role="menu" hidden></span>
      </span>
    </span>
    <button id="full" type="button" title="Full screen (f)"><span class="label">Full screen</span><kbd class="tag">f</kbd></button>
  </div>
</header>
<div id="live" role="status" hidden></div>
<main>
  <section id="editor" aria-label="Source" hidden>
    <div id="changed" role="alert" hidden><span class="what"></span><span class="gap"></span><button id="load-disk" type="button">Load it</button><button id="keep-mine" type="button">Keep mine</button></div>
    <div class="src-head">
      <span class="file"></span><span id="unsaved" title="Not saved to the file" hidden>●</span><span class="gap"></span>
      <span class="menu" id="file-menu" hidden>
        <button id="file-button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="file-list"><span class="name">File ▾</span></button>
        <span id="file-list" class="menu-list" role="menu" hidden>
          <button id="browse" class="row" type="button" role="menuitem" title="Open one of the examples in the editor" aria-haspopup="dialog"><span class="name">Examples…</span></button>
          <button id="open-file" class="row" type="button" role="menuitem" title="Open a .reladraw file into the source"><span class="name">Open…</span></button>
          <hr>
          <button id="write-row" class="row" type="button" role="menuitem" title="Save the source as a .reladraw file"><span class="name">Save…</span><kbd>⌘S</kbd></button>
        </span>
      </span>
      <input id="file-input" type="file" accept=".reladraw,text/plain" hidden>
      <button id="format" type="button" title="Lay the source out again, as reladraw format does, with the nearest .reladraw-format (Shift+Alt+F)"><span class="name">Format</span></button>
      <button id="format-open" type="button" aria-haspopup="dialog" title="How Format lays the source out" hidden>Format settings…</button>
      <button id="write" type="button" title="Write the source to the file (⌘S or Ctrl+S)"><span class="name">Save</span><kbd>⌘S</kbd></button>
      <span class="menu" id="help-menu" hidden>
        <button id="help-button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="help-list"><span class="name">Help ▾</span></button>
        <span id="help-list" class="menu-list" role="menu" hidden>
          <button id="cheat-open" class="row" type="button" role="menuitem" title="The language on one screen"><span class="name">Cheatsheet</span><kbd>?</kbd></button>
          <a id="syntax-link" class="row" role="menuitem" href="https://github.com/reladraw/reladraw/blob/main/SYNTAX.md" target="_blank" rel="noopener" title="The full syntax reference, on GitHub"><span class="name">Syntax reference ↗</span></a>
        </span>
      </span>
    </div>
    <div class="code">
      <pre id="paint" aria-hidden="true"></pre>
      <textarea id="source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Source"></textarea>
    </div>{{cheatsheet}}
  </section>
  <div id="split" role="separator" aria-orientation="vertical" aria-label="Resize the source and the diagram" tabindex="0" title="Drag to resize; double-click to reset" hidden></div>
  <div id="picture">
  <div id="canvas">
  <div id="strip" class="floating" hidden><span class="crumbs"></span><span class="hint"></span></div>
  <button id="check" class="floating" type="button" title="Look for overlaps and other places the picture may not read as meant (c)" hidden>Check<kbd class="tag">c</kbd></button>
  <div id="zoom-card" class="floating">
    <button id="out" class="pm" type="button" title="Zoom out (-)" aria-label="Zoom out">−</button>
    <span id="scale" aria-live="polite">100%</span>
    <button id="in" class="pm" type="button" title="Zoom in (+)" aria-label="Zoom in">+</button>
    <span class="divider"></span>
    <button id="fit" type="button" title="The whole diagram in view (0)">Fit</button>
    <button id="actual" type="button" title="The drawing at its own scale (1)">100%</button>
  </div>
  <div id="view">
    <div id="stage">
{{drawing}}
    </div>
    <div id="tip"></div>
  </div>
  </div>
  <div id="band" aria-label="Findings" aria-live="polite" hidden></div>
  </div>
  <div id="side">
    <div id="side-split" role="separator" aria-orientation="vertical" aria-label="Resize the side panel" tabindex="0" title="Drag to resize; double-click to reset"></div>
    <section id="selected" aria-label="Selected" aria-live="polite">
      <p class="empty">Click a box or a line to see its links and what it connects to.</p>
    </section>
    <aside id="findings" aria-label="Findings">
      <h2><button id="findings-close" class="close" type="button" title="Close the findings" aria-label="Close the findings">×</button>Findings <span class="what">where the picture, drawn as written, may not read as meant</span></h2>
      <ol id="finding-list"></ol>
    </aside>
  </div>
</main>{{dialogs}}
{{library}}
<script>
(function () {
  var DATA = {{data}};
  // How the source is edited, or null on a snapshot, which has no editor.
  var EDIT = DATA.edit;
  // The page as written, taken before anything below changes it, so This
  // page saves what reladraw wrote rather than the current zoom and highlights.
  // A page with an editor makes a fresh snapshot instead (below).
  var written = EDIT ? '' : '<!doctype html>\\n' + document.documentElement.outerHTML + '\\n';
  document.documentElement.setAttribute('data-scheme', DATA.themes[DATA.current].scheme === 'light' ? 'light' : 'dark');
  var view = document.getElementById('view');
  var stage = document.getElementById('stage');
  var svg = stage.querySelector('svg');
  // The theme shown, which the picker changes; Save SVG, PNG and Copy SVG
  // save the drawing in it.
  var shownTheme = DATA.current;
  // Another theme is carried as the colors that differ from the first, put
  // back in place the first time it is shown.
  var VARIES = new RegExp(DATA.varies, 'gi');
  // Whether guides are drawn, which the Settings menu's switch changes. The
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

  // Every way out of the page is under one Export button: the page, its
  // source, and the picture. The list stays open after a choice, so "Copied"
  // can be read. It is one of the menus (below), opened by a click or by m x.
  // Save is the served page's writing of the file, so this is Export everywhere.
  var saveButton = document.getElementById('save');
  var saveList = document.getElementById('save-list');

  var savePage = document.getElementById('save-page');
  savePage.onclick = function () {
    saveFile(savePage, DATA.name + '.html', 'Web page', 'text/html', function () {
      if (!EDIT) return ready(new Blob([written], { type: 'text/html' }));
      // A page with an editor saves a snapshot of the diagram as last drawn,
      // as render --page writes it: this page itself would be the editor,
      // still looking for its server or holding the whole library.
      return libReady.then(function (lib) {
        return new Blob([lib.drawPage(DATA.source, DATA.name + '.reladraw').html], { type: 'text/html' });
      });
    });
  };

  var saveSource = document.getElementById('save-source');
  saveSource.onclick = function () {
    saveFile(saveSource, DATA.name + '.reladraw', 'reladraw source', 'text/plain', function () {
      return ready(new Blob([EDIT ? sourceBox.value : DATA.source], { type: 'text/plain' }));
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
  var band = document.getElementById('band');
  // A page with an editor looks for findings only when Check is pressed,
  // unless "Check as I type" is on: on a large diagram the checks would hold
  // up the typing. A page without one carries the findings it was made with.
  var AUTO_CHECK = 'reladraw-page-autocheck';
  var autoCheck = false;
  try { autoCheck = localStorage.getItem(AUTO_CHECK) === 'on'; } catch (e) {}
  // The text last checked and what was found in it. Findings outlive edits,
  // dimmed, since they describe the source as it was.
  var checked = !EDIT || autoCheck ? { text: DATA.source, findings: DATA.findings } : null;
  var shownText = DATA.source;
  function found() { return checked ? checked.findings : []; }
  function stale() { return !!checked && checked.text !== shownText; }
  var count = found().length;

  // A row of the Settings menu that is on or off: its switch, and the word beside it.
  function setSwitch(row, on) {
    row.setAttribute('aria-checked', String(on));
    row.querySelector('.word').textContent = on ? 'on' : 'off';
  }
  var panelRow = document.getElementById('panel-row');
  var autoRow = document.getElementById('auto-row');
  var findingsRow = document.getElementById('findings-row');
  var guidesRow = document.getElementById('guides-row');
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
  // While the source is open the panel would squeeze the picture between two
  // columns, so it behaves as if auto-hidden: it comes up for a selection or
  // an error, and for the findings only when asked.
  function editing() {
    var pane = document.getElementById('editor');
    return !!pane && !pane.hidden;
  }
  function layoutSide() {
    side.hidden = !(panelOn && (!(autoHide || editing()) || selection || !panel.hidden));
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

  // The panel's width, dragged from its left edge, is kept in pixels for
  // every page in this browser: a description reads at the same width
  // whatever the window.
  var SIDE_WIDTH = 'reladraw.side';
  var sideSplit = document.getElementById('side-split');
  function sizeSide(width, keep) {
    if (width === null) side.style.removeProperty('width');
    else side.style.width = Math.round(Math.max(200, Math.min(window.innerWidth * 0.7, width))) + 'px';
    if (!keep) return;
    try {
      if (width === null) localStorage.removeItem(SIDE_WIDTH);
      else localStorage.setItem(SIDE_WIDTH, String(parseFloat(side.style.width)));
    } catch (e) {}
  }
  try {
    var keptWidth = parseFloat(localStorage.getItem(SIDE_WIDTH));
    if (keptWidth > 0) sizeSide(keptWidth, false);
  } catch (e) {}
  var sizing = false;
  sideSplit.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    sizing = true;
    try { sideSplit.setPointerCapture(event.pointerId); } catch (e) {}
    sideSplit.classList.add('dragging');
    document.body.classList.add('dragging');
    event.preventDefault();
  });
  sideSplit.addEventListener('pointermove', function (event) {
    if (sizing) sizeSide(side.getBoundingClientRect().right - event.clientX, false);
  });
  function sideLetGo(event) {
    if (!sizing) return;
    sizing = false;
    sideSplit.classList.remove('dragging');
    document.body.classList.remove('dragging');
    sizeSide(side.getBoundingClientRect().right - event.clientX, true);
    zoom.show();
  }
  sideSplit.addEventListener('pointerup', sideLetGo);
  sideSplit.addEventListener('pointercancel', sideLetGo);
  sideSplit.addEventListener('dblclick', function () { sizeSide(null, true); zoom.show(); });
  sideSplit.addEventListener('keydown', function (event) {
    var step = { ArrowLeft: 24, ArrowRight: -24 }[event.key];
    if (!step) return;
    sizeSide(side.getBoundingClientRect().width + step, true);
    event.preventDefault();
    event.stopPropagation();
  });
  findingsRow.onclick = flipFindings;
  document.getElementById('findings-close').onclick = function () { showPanel(false); };
  if (count === 0) {
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

  // Whether the source has stopped parsing, and whether that is what opened
  // the findings, so they close again once it parses.
  var failing = false;
  var openedByError = false;
  // The list, made again when a served page redraws. An error the file has
  // stopped parsing with heads it, over the findings of the last drawing that
  // parsed, which is still the one shown.
  var lastError = null;
  function listFindings(error) {
    failing = !!error;
    lastError = error;
    list.textContent = '';
    count = found().length + (error ? 1 : 0);
    findingsRow.querySelector('.name').textContent = checked || error ? 'Findings (' + count + ')' : 'Findings';
    guidesRow.querySelector('.name').textContent = 'Guides (' + DATA.guideCount + ')';
    panel.classList.toggle('stale', stale());
    if (error) {
      var wrong = element('li', 'error');
      var head = element('span', 'where', error.line ? 'line ' + error.line + ' ' : '');
      if (EDIT) {
        if (error.line) {
          head.classList.add('goto');
          head.title = 'Select the line in the source';
          head.onclick = function () { goToLine(error.line); };
        }
        // For pasting into an issue, or a chat with an agent.
        var copy = element('button', 'copy', 'Copy');
        copy.type = 'button';
        copy.title = 'Copy the error';
        copy.onclick = function () {
          toClipboard((error.line ? 'line ' + error.line + ': ' : '') + error.message)
            .then(function () { flash(copy, 'Copied'); }, function () { flash(copy, 'Blocked'); });
        };
        wrong.append(copy);
      }
      wrong.append(head, element('span', 'kind', 'error'), document.createElement('br'),
        document.createTextNode(error.message), element('span', 'note', 'The picture is the last version that drew.'));
      list.append(wrong);
    }
    if (!checked) {
      list.append(element('li', 'none', 'Automatic checking is off. Press Check in the bar above to look for overlaps and other places the picture may not read as meant.'));
    } else {
      if (stale()) list.append(element('li', 'again', againText()));
      if (found().length === 0) list.append(element('li', 'none', 'No findings.'));
      found().forEach(function (finding) {
        var item = document.createElement('li');
        item.append(findingButton(finding));
        list.append(item);
      });
    }
    showBand();
  }
  function againText() {
    return autoCheck ? 'From the last version that drew; the source has changed since.'
      : 'The source has changed since this check. Press Check again.';
  }

  // The band under the picture while the source is open: the first few
  // findings, and View all for the panel with every one.
  var BAND_ROWS = 3;
  var bandClosed = false;
  function showBand() {
    var list = found();
    band.textContent = '';
    band.hidden = !(EDIT && editing() && checked && !bandClosed && (list.length > 0 || !autoCheck));
    if (band.hidden) return;
    band.classList.toggle('stale', stale());
    var head = element('div', 'head');
    head.append(element('b', '', list.length ? 'Findings \\u00B7 ' + list.length : 'No findings'));
    head.append(element('span', 'gap'));
    if (list.length) {
      var all = element('button', '', list.length > BAND_ROWS ? 'View all ' + list.length : 'View all');
      all.type = 'button';
      all.title = 'Open the findings in the side panel';
      all.onclick = openFindings;
      head.append(all);
    }
    var close = element('button', 'close', '\\u00D7');
    close.type = 'button';
    close.title = 'Close until the next check';
    close.setAttribute('aria-label', 'Close the findings');
    close.onclick = function () { bandClosed = true; showBand(); };
    head.append(close);
    band.append(head);
    if (stale()) band.append(element('div', 'again', againText()));
    var rows = element('div', 'found');
    list.slice(0, BAND_ROWS).forEach(function (finding) { rows.append(findingButton(finding)); });
    band.append(rows);
  }
  // The panel takes the findings over: the band closes until the next check,
  // and closing the panel doesn't bring it back.
  function openFindings() {
    if (!panelOn) { panelOn = true; keepPanel(); }
    bandClosed = true;
    showBand();
    showPanel(true);
  }

  // Looks for findings in the source as it stands, drawing it again to do so.
  var checkButton = document.getElementById('check');
  function runCheck() {
    if (!EDIT || !lib) return;
    bandClosed = false;
    drawnText = null;
    draw(sourceBox.value, true);
    // In View mode there is no band, so what was found shows in the panel.
    if (!editing()) openFindings();
  }
  checkButton.onclick = runCheck;
  var autoCheckRow = document.getElementById('autocheck-row');
  function setAutoCheck(on) {
    autoCheck = on;
    try { localStorage.setItem(AUTO_CHECK, on ? 'on' : 'off'); } catch (e) {}
    setSwitch(autoCheckRow, on);
    checkButton.hidden = !EDIT || on;
    if (on) runCheck();
    else listFindings(lastError);
  }
  autoCheckRow.onclick = function () { setAutoCheck(!autoCheck); };

  function findingButton(finding) {
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
    // With the source shown, the line it names is selected there too.
    button.onclick = function () {
      light(finding, button);
      if (EDIT && !editorPane.hidden) goToLine(finding.line);
    };
    return button;
  }
  listFindings(null);

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
    // The drawing's own hover texts (its title, a description, a list of
    // links) are for the bare SVG. Here the heading has the title, the tip
    // names what is under the pointer and the panel holds the rest, so the
    // browser's tooltip would only cover them. Exports draw from the data.
    each(svg.querySelectorAll('title'), function (title) { title.remove(); });
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
    if (!next) { showSelected(); markSource(null); return; }
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
    markSource(next.kind === 'node' ? nodeGroups(next.key) : edgeGroups(next.key));
  }

  // With the source open, what is selected has the line that states it
  // marked there, scrolled into view, without taking the keyboard from the
  // picture.
  var markedLine = 0;
  function markSource(groups) {
    if (!EDIT) return;
    var line = groups && groups[0] ? Number(groups[0].getAttribute('data-line')) || 0 : 0;
    if (line === markedLine) return;
    markedLine = line;
    // Declared further down; a selection made before then paints on opening.
    if (editorPane && !editorPane.hidden) { paintSource(); showMarked(); }
  }
  function showMarked() {
    var mark = paintBox.querySelector('.src-mark');
    if (!mark) return;
    var top = mark.offsetTop;
    var bottom = top + mark.offsetHeight;
    if (top < sourceBox.scrollTop || bottom > sourceBox.scrollTop + sourceBox.clientHeight) {
      sourceBox.scrollTop = Math.max(0, top - sourceBox.clientHeight / 3);
    }
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
    document.documentElement.setAttribute('data-scheme', next.scheme === 'light' ? 'light' : 'dark');
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
  var versionsButton = document.getElementById('versions-button');
  var versionsList = document.getElementById('versions-list');
  var strip = document.getElementById('strip');
  var level = null;
  var cursor = 0;
  var themeBefore = null;

  var STRIP = {
    bar: ['<b>Menu</b>', 'letter to open \\u00B7 \\u232B back \\u00B7 Esc out'],
    view: ['Menu \\u203A <b>Settings</b>', 'letter to flip \\u00B7 \\u2191\\u2193 Enter \\u00B7 \\u232B back \\u00B7 Esc out'],
    save: ['Menu \\u203A <b>Export</b>', 'letter to save \\u00B7 \\u2191\\u2193 Enter \\u00B7 \\u232B back \\u00B7 Esc out'],
    versions: ['Menu \\u203A <b>Versions</b>', '\\u2191\\u2193 Enter to put one in the editor \\u00B7 \\u232B back \\u00B7 Esc out'],
    theme: ['Menu \\u203A Settings \\u203A <b>Theme</b>', '\\u2191\\u2193 to try \\u00B7 Enter keep \\u00B7 \\u232B back \\u00B7 Esc out'],
  };

  function rows() {
    if (level === 'view') return Array.prototype.slice.call(viewList.querySelectorAll(':scope > .row:not([hidden])'));
    if (level === 'save') return Array.prototype.slice.call(saveList.querySelectorAll(':scope > .row'));
    if (level === 'versions') return Array.prototype.slice.call(versionsList.querySelectorAll(':scope > .row'));
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
    versionsList.hidden = level !== 'versions';
    versionsButton.classList.toggle('open', level === 'versions');
    versionsButton.setAttribute('aria-expanded', String(level === 'versions'));
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
    else if (level === 'view' || level === 'save' || level === 'versions') setLevel('bar');
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

  // The styles the diagram uses, which a filter's style: names; made again
  // when an edited page redraws.
  var styleNames = {};
  function collectStyles() {
    styleNames = {};
    Object.keys(graph.nodes).forEach(function (name) { graph.nodes[name].styles.forEach(function (one) { styleNames[one] = true; }); });
    graph.edges.forEach(function (edge) { edge.styles.forEach(function (one) { styleNames[one] = true; }); });
  }
  collectStyles();

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
  versionsButton.onclick = function () { setLevel(level === 'versions' ? null : 'versions'); };
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
  // menu and not the diagram underneath: g flips guides in Settings, not a grab.
  window.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest && event.target.closest('input, textarea, select, [contenteditable]')) return;
    // A window open over the page has the keys, Escape included.
    if (document.querySelector('dialog[open]')) return;
    var key = event.key;
    if (key === 'Escape') plain();
    else if (level === 'pick' || level === 'filter') {
      if (!hintKey(event)) return;
    } else if (level === null) {
      if (key === 'm' || key === 'M') setLevel('bar');
      else if (key === 'e' && EDIT) toggleEditor();
      else if (key === 'c' && !checkButton.hidden) runCheck();
      else if (key === '?' && cheatBox) openCheatsheet();
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
          if (letter === 's') setLevel('view');
          else if (letter === 'x') setLevel('save');
          else if (letter === 'o' && tiedFile()) setLevel('versions');
          else if (letter === 'e' && EDIT) { setLevel(null); toggleEditor(); }
          else if (letter === 'c' && !checkButton.hidden) { setLevel(null); runCheck(); }
          else if (letter === 'f' && !full.hidden) { setLevel(null); toggleFull(); }
        } else if (level === 'view' || level === 'save' || level === 'versions') {
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

  /* ---- editing: a page tied to a file, and a page with no file ---- */

  // A page with an editor draws in the browser: with the library the server
  // that served it also serves, or, on the hosted playground, with the
  // library inlined in the page. Each drawing keeps the view, the theme and
  // whatever is still there to be selected. A text that doesn't draw leaves
  // the last picture that did, with the error at the head of the findings.
  //
  // Tied to a file, the page follows it: each time the file changes on disk,
  // the server sends its text, and Save writes it. With no file, the text is
  // kept in this browser, the examples and Open are offered, and Save
  // downloads it; served with no file, Save names a file in the folder, and
  // from then on the page is tied to that file as if it had been opened with it.
  var heading = document.querySelector('header h1');
  var drawnLine = document.querySelector('header .drawn');
  var liveNote = document.getElementById('live');

  function tiedFile() { return EDIT && EDIT.kind === 'file' ? EDIT.file : null; }

  function adopt(next, title) {
    next.edit = EDIT;
    DATA = next;
    graph = DATA.graph;
    collectStyles();
    shownTheme = chosenName && DATA.themes[chosenName] ? chosenName : DATA.current;
    // A page with no file is headed reladraw, whatever the diagram is called.
    if (!EDIT || EDIT.kind === 'file') {
      heading.textContent = title;
      document.title = title;
    }
    themeItems[0].row.querySelector('.name').textContent = "Diagram's theme (" + DATA.current + ')';
    if (selection && !(selection.kind === 'node' ? graph.nodes[selection.key] : graph.edges[selection.key])) selection = null;
    if (level === 'pick' || level === 'filter') setLevel(null);
    listFindings(null);
    if (openedByError) { openedByError = false; if (editing()) showPanel(false); }
    redraw();
  }

  var libReady = !EDIT ? Promise.resolve(null)
    : EDIT.kind === 'hosted' ? Promise.resolve(globalThis.reladraw)
    : Promise.all(['/lib/index.js', '/lib/page.js', '/lib/page-data.js'].map(function (path) { return import(path); }))
      .then(function (all) { return Object.assign({}, all[0], all[1], all[2]); });
  var lib = null;

  function clock(at) {
    return ('0' + at.getHours()).slice(-2) + ':' + ('0' + at.getMinutes()).slice(-2);
  }

  function toClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('no clipboard'));
  }

  var editorPane = document.getElementById('editor');
  var editButton = document.getElementById('edit');
  var splitBar = document.getElementById('split');
  var sourceBox = document.getElementById('source');
  var paintBox = document.getElementById('paint');
  var unsavedMark = document.getElementById('unsaved');
  var writeButton = document.getElementById('write');
  // A menu in the source's bar: its button opens and closes its list, and a
  // row chosen, a click elsewhere or Escape closes it. Returns its closer.
  function sourceMenu(menu, button, list) {
    function close() {
      list.hidden = true;
      button.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    }
    button.onclick = function () {
      var open = list.hidden;
      list.hidden = !open;
      button.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
    };
    // Choosing a row closes the menu before the row does its work.
    list.addEventListener('click', function () { close(); }, true);
    document.addEventListener('click', function (event) {
      if (!list.hidden && !menu.contains(event.target)) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !list.hidden) close();
    }, true);
    return close;
  }
  // A page with no file keeps Examples, Open and Save in a File menu.
  var fileMenu = document.getElementById('file-menu');
  var fileButton = document.getElementById('file-button');
  var closeFileMenu = sourceMenu(fileMenu, fileButton, document.getElementById('file-list'));
  // Help: the cheatsheet, and the full reference.
  var helpMenu = document.getElementById('help-menu');
  sourceMenu(helpMenu, document.getElementById('help-button'), document.getElementById('help-list'));
  document.getElementById('write-row').onclick = function () { writeButton.click(); };
  // Where "Saved" flashes: the Save button, or the File menu it is in.
  function saveFlash(text) { flash(writeButton.hidden ? fileButton : writeButton, text); }
  var formatButton = document.getElementById('format');
  var openButton = document.getElementById('open-file');
  var formatOpen = document.getElementById('format-open');
  var browseButton = document.getElementById('browse');

  // \`quiet\` shows it without taking the keys, as when the page opens.
  function toggleEditor(show, quiet) {
    if (!EDIT) return;
    var on = show === undefined ? editorPane.hidden : show;
    var changed = editorPane.hidden === on;
    editorPane.hidden = !on;
    splitBar.hidden = !on;
    editButton.setAttribute('aria-pressed', String(on));
    lookButton.setAttribute('aria-pressed', String(!on));
    // The findings close with the source open, and come back as the page
    // first shows them when it closes.
    if (changed) {
      openedByError = openedByError && on;
      showPanel(on ? failing : count > 0 && !autoHide);
      showBand();
    }
    if (on) { paintSource(); showMarked(); if (!quiet) sourceBox.focus(); }
    else if (document.activeElement === sourceBox) sourceBox.blur();
  }
  // The View half of the Edit | View switch, apart from the Settings menu.
  var lookButton = document.getElementById('mode-view');
  editButton.onclick = function () { toggleEditor(true); };
  lookButton.onclick = function () { toggleEditor(false); };

  function escapeCode(text) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // The scanner covers each line end to end, so this rebuilds the text exactly
  // and only wraps some of it in spans; a lost character would slide the rest
  // of the line out from under the cursor.
  // One line of source as colored HTML; the library has to have loaded.
  function colorLine(line) {
    var out = '';
    lib.highlightLine(line).forEach(function (span) {
      var piece = escapeCode(line.slice(span.start, span.end));
      out += span.kind === 'plain' ? piece : '<span class="t-' + span.kind + '">' + piece + '</span>';
    });
    return out;
  }
  function paintSource() {
    var text = sourceBox.value;
    var out = '';
    try {
      if (!lib) throw new Error('not loaded');
      var lines = text.split(/\\r?\\n/);
      // The mark covers the whole statement: its first line, and every line
      // after it that starts with whitespace or a """ string, as the parser
      // reads one; a blank line ends it.
      var first = markedLine - 1;
      var last = first;
      if (first >= 0) {
        while (last + 1 < lines.length && /^([ \\t]|""")/.test(lines[last + 1]) && lines[last + 1].trim() !== '') last++;
      }
      lines.forEach(function (line, index) {
        // A block of its own, so the mark runs the width of the editor; the
        // block ends its last line, so that line has no line break of its own.
        if (index === first) out += '<span class="src-mark">';
        out += colorLine(line);
        if (index === last && first >= 0) out += '</span>';
        else out += '\\n';
      });
    } catch (e) {
      // Coloring is decoration; the editor has to keep working without it.
      out = escapeCode(text) + '\\n';
    }
    paintBox.innerHTML = out;
    // A textarea's scroll bar comes out of its own width, so the colored
    // layer is given the width the text actually gets.
    paintBox.style.width = sourceBox.clientWidth + 'px';
    paintBox.scrollTop = sourceBox.scrollTop;
  }
  sourceBox.addEventListener('scroll', function () { paintBox.scrollTop = sourceBox.scrollTop; });
  window.addEventListener('resize', function () { if (EDIT && !editorPane.hidden) paintSource(); });

  // Selects a line of the source, as a finding or an error naming it does.
  function goToLine(number) {
    if (!EDIT) return;
    toggleEditor(true, true);
    var lines = sourceBox.value.split('\\n');
    var start = 0;
    for (var i = 0; i < number - 1 && i < lines.length; i++) start += lines[i].length + 1;
    var end = start + (lines[number - 1] || '').length;
    sourceBox.focus();
    sourceBox.setSelectionRange(start, end);
    // Chrome doesn't scroll a selection made from outside the field into
    // view; leaving and coming back is what makes it scroll.
    sourceBox.blur();
    sourceBox.focus();
  }

  /* ---- drawing what is typed ---- */

  // The name the diagram is drawn as, which a saved file is given.
  var fileName = 'diagram.reladraw';
  var drawnText = DATA.source;
  var cost = 0;
  var typing = null;

  // \`check\` looks for findings this once, as Check does.
  function draw(text, check) {
    if (text === drawnText || !lib) return;
    drawnText = text;
    shownText = text;
    var checking = autoCheck || !!check;
    var started = performance.now();
    var made;
    try {
      made = lib.pageData(text, fileName, checking ? {} : { checks: false });
      if (checking) checked = { text: text, findings: made.data.findings };
    } catch (error) {
      cost = performance.now() - started;
      listFindings({ message: error.message, line: error.line });
      if (panelOn && panel.hidden) { openedByError = true; showPanel(true); }
      return;
    }
    cost = performance.now() - started;
    adopt(made.data, made.title);
  }

  // A diagram quick to draw is drawn on every keystroke; a slow one once the
  // typing pauses, so the keys aren't held up behind it.
  function drawSoon() {
    clearTimeout(typing);
    if (cost < 50) draw(sourceBox.value);
    else typing = setTimeout(function () { draw(sourceBox.value); }, 150);
  }

  sourceBox.addEventListener('input', function () {
    paintSource();
    edited();
    drawSoon();
  });
  sourceBox.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { sourceBox.blur(); event.preventDefault(); }
  });

  // Text put in whole: a version, an example, a file opened, the file as it is on disk.
  function load(text) {
    sourceBox.value = text;
    paintSource();
    edited();
    draw(text);
  }

  // Text put in as one edit the browser can undo, with the cursor kept on its line.
  function replaceSource(text) {
    var before = sourceBox.value;
    var line = before.slice(0, sourceBox.selectionStart).split('\\n').length;
    var scroll = sourceBox.scrollTop;
    sourceBox.focus();
    sourceBox.setSelectionRange(0, before.length);
    var undoable = false;
    try { undoable = document.execCommand('insertText', false, text); } catch (e) {}
    if (!undoable || sourceBox.value !== text) {
      sourceBox.value = text;
      sourceBox.dispatchEvent(new Event('input'));
    }
    var lines = text.split('\\n');
    var at = 0;
    for (var i = 0; i < line - 1 && i < lines.length; i++) at += lines[i].length + 1;
    sourceBox.setSelectionRange(at, at);
    sourceBox.scrollTop = scroll;
  }

  /* ---- the divider between the source and the picture ---- */

  // Kept as a share of the width rather than pixels, so a remembered split
  // means the same in a wider or narrower window.
  var SPLIT = 'reladraw.split';
  var mainBox = document.querySelector('main');
  function divide(share, keep) {
    if (share === null) {
      editorPane.style.removeProperty('width');
      editorPane.style.removeProperty('max-width');
    } else {
      share = Math.max(0.15, Math.min(0.8, share));
      editorPane.style.width = (share * 100).toFixed(2) + '%';
      editorPane.style.maxWidth = 'none';
      splitBar.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    }
    paintSource();
    if (!keep) return;
    try {
      if (share === null) localStorage.removeItem(SPLIT);
      else localStorage.setItem(SPLIT, String(share));
    } catch (e) {}
  }
  function shareAt(x) {
    var box = mainBox.getBoundingClientRect();
    return (x - box.left) / box.width;
  }
  var splitting = false;
  splitBar.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    splitting = true;
    try { splitBar.setPointerCapture(event.pointerId); } catch (e) {}
    splitBar.classList.add('dragging');
    document.body.classList.add('dragging');
    event.preventDefault();
  });
  splitBar.addEventListener('pointermove', function (event) { if (splitting) divide(shareAt(event.clientX), false); });
  function letGo(event) {
    if (!splitting) return;
    splitting = false;
    splitBar.classList.remove('dragging');
    document.body.classList.remove('dragging');
    divide(shareAt(event.clientX), true);
    zoom.show();
  }
  splitBar.addEventListener('pointerup', letGo);
  splitBar.addEventListener('pointercancel', letGo);
  splitBar.addEventListener('dblclick', function () { divide(null, true); });
  splitBar.addEventListener('keydown', function (event) {
    var step = { ArrowLeft: -0.02, ArrowRight: 0.02 }[event.key];
    if (!step) return;
    divide(shareAt(splitBar.getBoundingClientRect().left) + step, true);
    event.preventDefault();
    event.stopPropagation();
  });

  /* ---- formatting ---- */

  // Tied to a file, the settings are the nearest .reladraw-format, as
  // reladraw format reads them; with no file, the ones set in this browser.
  function settingsText() {
    var file = tiedFile();
    if (file) return fetch('/format-settings?file=' + encodeURIComponent(file)).then(function (r) { return r.text(); });
    return Promise.resolve(formatText());
  }
  function formatSource() {
    Promise.all([libReady, settingsText()]).then(function (got) {
      var settings;
      try {
        settings = lib.readFormatSettings(got[1]);
      } catch (error) {
        if (tiedFile()) throw error;
        openFormatSettings();
        return;
      }
      var laid = lib.format(sourceBox.value, settings);
      if (laid === sourceBox.value) { flash(formatButton, 'Already formatted'); return; }
      replaceSource(laid);
    }).catch(function (error) { flash(formatButton, 'Can\\u2019t format: ' + error.message.split('\\n')[0]); });
  }
  formatButton.onclick = formatSource;

  // Save on the keyboard works wherever the focus is, and never saves the
  // page; Shift+Alt+F formats, as in VS Code, by the key's code, since on a
  // Mac Alt turns F into another character.
  window.addEventListener('keydown', function (event) {
    if (!EDIT) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 's' || event.key === 'S')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveText();
    } else if (event.shiftKey && event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyF') {
      event.preventDefault();
      event.stopImmediatePropagation();
      formatSource();
    }
  }, true);

  function saveText() {
    if (tiedFile()) write(false);
    else if (EDIT.kind === 'local') openSaveAs();
    else saveDownload();
  }
  writeButton.onclick = saveText;

  /* ---- a page tied to a file ---- */

  // What the file holds, as last heard from the server; and what the
  // editor's text was loaded or saved from, which a save checks the file
  // against, so a change on disk the person kept their text over is asked
  // about rather than written over.
  var disk = null;
  var base = null;
  var versions = [];
  var down = false;
  var changedStrip = document.getElementById('changed');

  function markUnsaved() {
    if (!EDIT) return;
    if (tiedFile()) {
      unsavedMark.hidden = sourceBox.value === disk;
      unsavedMark.title = 'Not saved to the file';
    } else {
      unsavedMark.hidden = !unsavedHere();
      unsavedMark.title = 'Not saved to a file';
    }
  }

  // Ties the page to a file whose text is \`text\`: from a served page's start,
  // or from the first Save of a page with no file, after which the page is
  // what it would have been opened with the file.
  function tie(file, text) {
    var fresh = !!EDIT && EDIT.kind !== 'file';
    EDIT = DATA.edit = { kind: 'file', file: file };
    fileName = file.split('/').pop();
    disk = text;
    base = text;
    // A page tied to a file has only Save, so it is a button, not a File menu.
    closeFileMenu();
    fileMenu.hidden = true;
    writeButton.hidden = false;
    // Its settings are now the nearest .reladraw-format's, which the panel edits.
    formatOpen.hidden = false;
    document.getElementById('versions-menu').hidden = false;
    writeButton.querySelector('.name').textContent = 'Save';
    writeButton.title = 'Write the source to the file (\\u2318S or Ctrl+S)';
    formatButton.title = 'Lay the source out again, as reladraw format does, with the nearest .reladraw-format (Shift+Alt+F)';
    editorPane.querySelector('.file').textContent = file;
    drawnLine.textContent = file + ' \\u00b7 live, read ' + clock(new Date());
    var links = document.querySelector('header .links');
    if (links) links.remove();
    if (fresh) {
      // Drawn again under the file's name, and headed with the diagram's title.
      drawnText = null;
      draw(sourceBox.value);
    }
    markUnsaved();
    follow(file);
  }

  function who(version) {
    if (version.who === 'you') return 'you';
    if (version.who === 'agent') return 'agent' + (version.note ? ': \\u201c' + version.note + '\\u201d' : '');
    return 'changed on disk';
  }

  // A change on disk loads at once, unless the editor holds text that isn't
  // in the file: then the text stays and a strip offers the file instead.
  function heard(message) {
    var clean = sourceBox.value === disk && base === disk;
    disk = message.text;
    versions = message.versions || [];
    listVersions();
    if (clean || sourceBox.value === disk) {
      base = disk;
      changedStrip.hidden = true;
      load(disk);
    } else {
      var last = versions[versions.length - 1];
      changedStrip.querySelector('.what').textContent =
        fileName + ' changed on disk at ' + clock(new Date(message.at)) + (last ? ' (' + who(last) + ')' : '');
      changedStrip.hidden = false;
      if (editorPane.hidden) toggleEditor(true);
    }
    markUnsaved();
  }
  document.getElementById('load-disk').onclick = function () {
    base = disk;
    changedStrip.hidden = true;
    load(disk);
  };
  document.getElementById('keep-mine').onclick = function () { changedStrip.hidden = true; };

  function write(replace) {
    var file = tiedFile();
    var text = sourceBox.value;
    return fetch('/save?file=' + encodeURIComponent(file), {
      method: 'POST',
      body: JSON.stringify({ text: text, base: base, replace: !!replace }),
    }).then(function (answer) {
      if (answer.status === 409) {
        return answer.json().then(function (now) {
          var what = fileName + ' changed on disk at ' + clock(new Date(now.at)) +
            (now.who === 'agent' ? ' (agent' + (now.note ? ': \\u201c' + now.note + '\\u201d' : '') + ')' : '') +
            ' after you started editing. Saving puts your text in its place; the version on disk stays in Versions.\\n\\nReplace the file on disk?';
          if (confirm(what)) return write(true);
        });
      }
      if (!answer.ok) throw new Error('the server said ' + answer.status);
      disk = text;
      base = text;
      changedStrip.hidden = true;
      markUnsaved();
      saveFlash('Saved');
    }).catch(function (error) {
      saveFlash('Not saved');
      liveNote.textContent = 'Couldn\\u2019t save ' + file + ': ' + error.message;
      liveNote.hidden = false;
    });
  }

  // Newest first. Picking one puts it in the editor as unsaved text.
  function listVersions() {
    versionsList.textContent = '';
    versions.slice().reverse().forEach(function (version, i) {
      var row = element('button', 'row');
      row.type = 'button';
      row.setAttribute('role', 'menuitem');
      var label = version.who === 'opened' ? 'opened' : version.who === 'disk' ? 'on disk' : version.who;
      var about = version.who === 'opened' ? 'as the server first read it'
        : version.who === 'disk' ? 'changed on disk'
        : version.who === 'agent' ? (version.note || 'changed by an agent')
        : 'saved from this page';
      row.append(element('span', 'when', clock(new Date(version.at))), element('span', 'who ' + version.who, label),
        element('span', 'about', about + (i === 0 ? ' (in the file now)' : '')));
      row.onclick = function () {
        setLevel(null);
        toggleEditor(true);
        load(version.text);
      };
      versionsList.append(row);
    });
    if (!versions.length) versionsList.append(element('span', 'none', 'No versions yet.'));
  }

  function follow(file) {
    var events = new EventSource('/events?file=' + encodeURIComponent(file));
    events.addEventListener('source', function (event) {
      var message = JSON.parse(event.data);
      if (down) {
        down = false;
        liveNote.hidden = true;
        writeButton.disabled = false;
      }
      drawnLine.textContent = file + ' \\u00b7 live, ' + (message.changed ? 'changed ' : 'read ') + clock(new Date(message.at));
      heard(message);
    });
    events.onerror = function () {
      if (down) return;
      down = true;
      writeButton.disabled = true;
      drawnLine.textContent = file + ' \\u00b7 not live';
      liveNote.textContent = 'The server has stopped, so this page can\\u2019t save or follow ' + file +
        '. Start it again with reladraw serve ' + file + ' in the same folder, and this page picks the file up again. Export \\u25BE still saves what you typed.';
      liveNote.hidden = false;
    };
  }

  window.addEventListener('beforeunload', function (event) {
    if (tiedFile() && sourceBox.value !== disk) { event.preventDefault(); event.returnValue = ''; }
  });

  /* ---- a page with no file: the text kept in this browser ---- */

  // The same names the playground has always kept them under, so a visitor
  // finds their diagram where they left it.
  var STORE = 'reladraw.source';
  var KEPT_TEXT = 'reladraw.kept';
  var KEPT_NAME = 'reladraw.name';
  function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  // The text as last saved or opened, so opening another file asks first only
  // when there is something to lose; and the example the editor holds
  // unchanged, or null once it is edited, since an example left alone is one
  // click away and nothing to lose.
  var keptText = null;
  var current = null;
  var stowing = null;
  var EXAMPLES = EDIT && EDIT.examples ? EDIT.examples : [];

  function named(text) {
    for (var i = 0; i < EXAMPLES.length; i++) if (EXAMPLES[i].source === text) return EXAMPLES[i].name;
    return null;
  }
  function unsavedHere() { return sourceBox.value !== keptText && current === null; }

  function edited() {
    if (EDIT && EDIT.kind !== 'file') {
      current = named(sourceBox.value);
      // The stored copy trails the typing: it isn't read until the page is opened again.
      clearTimeout(stowing);
      stowing = setTimeout(function () { store(STORE, sourceBox.value); }, 400);
    }
    markUnsaved();
  }
  function keep(text, name) {
    keptText = text;
    fileName = name;
    store(KEPT_TEXT, text);
    store(KEPT_NAME, name);
    if (EDIT.kind === 'hosted') editorPane.querySelector('.file').textContent = name;
    markUnsaved();
  }

  // A different diagram opens as a fresh page would, not at the last one's zoom.
  function openText(text) {
    load(text);
    zoom.open();
    sourceBox.focus();
    sourceBox.setSelectionRange(0, 0);
    sourceBox.scrollTop = 0;
  }

  var fileInput = document.getElementById('file-input');
  openButton.onclick = function () {
    if (unsavedHere() && !confirm('Your edits have not been saved to a file. Open another file in their place?')) return;
    fileInput.value = '';
    fileInput.click();
  };
  fileInput.onchange = function () {
    var picked = fileInput.files[0];
    if (!picked) return;
    picked.text().then(function (text) {
      keep(text, picked.name);
      openText(text);
    });
  };

  // Chrome and Edge ask for the name and the folder; elsewhere the file goes
  // where the browser puts downloads, under the suggested name.
  function saveDownload() {
    var text = sourceBox.value;
    function download() {
      saveBlob(new Blob([text], { type: 'text/plain' }), fileName);
      keep(text, fileName);
    }
    if (!window.showSaveFilePicker) return download();
    window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'reladraw source', accept: { 'text/plain': ['.reladraw'] } }] })
      .then(function (handle) {
        return handle.createWritable().then(function (out) {
          return out.write(text).then(function () { return out.close(); }).then(function () {
            keep(text, handle.name);
            saveFlash('Saved');
          });
        });
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return;
        // Refused outright, as inside a cross-origin frame.
        download();
      });
  }

  // Served with no file, the first Save names a file in the folder, typed
  // rather than browsed for, and asks before replacing one that is there.
  var saveAs = document.getElementById('save-as');
  function openSaveAs() {
    var path = document.getElementById('save-path');
    document.getElementById('save-problem').textContent = '';
    if (!path.value) path.value = fileName;
    saveAs.showModal();
    path.select();
  }
  function create(path, replace) {
    var text = sourceBox.value;
    var problem = document.getElementById('save-problem');
    return fetch('/create?file=' + encodeURIComponent(path), {
      method: 'POST',
      body: JSON.stringify({ text: text, replace: !!replace }),
    }).then(function (answer) {
      return answer.json().then(function (told) {
        if (answer.status === 409 && told.exists) {
          if (confirm(told.file + ' is there already. Replace it with this diagram?')) return create(path, true);
          return;
        }
        if (!answer.ok) { problem.textContent = told.error || 'The server said ' + answer.status; return; }
        saveAs.close();
        keep(text, told.file.split('/').pop());
        history.replaceState(null, '', '/' + told.file.split('/').map(encodeURIComponent).join('/'));
        tie(told.file, text);
        saveFlash('Saved');
      });
    }).catch(function (error) {
      problem.textContent = 'Couldn\\u2019t save: ' + error.message + '. Is reladraw serve still running?';
    });
  }
  if (saveAs) {
    document.getElementById('save-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var path = document.getElementById('save-path').value.trim();
      if (!path) return;
      if (!/\\.reladraw$/.test(path)) path += '.reladraw';
      create(path, false);
    });
  }

  /* ---- the examples ---- */

  var examplesBox = document.getElementById('examples');
  var catalog = document.getElementById('catalog');
  var preview = document.getElementById('preview');
  var aboutLine = document.getElementById('about');
  var chosenExample = 0;
  var previews = {};

  function pickExample(i) {
    chosenExample = Math.max(0, Math.min(EXAMPLES.length - 1, i));
    each(catalog.children, function (item, j) { item.setAttribute('aria-selected', String(j === chosenExample)); });
    var item = catalog.children[chosenExample];
    catalog.setAttribute('aria-activedescendant', item.id);
    item.scrollIntoView({ block: 'nearest' });
    var example = EXAMPLES[chosenExample];
    if (!(example.name in previews)) {
      try { previews[example.name] = lib ? lib.compile(example.source) : ''; } catch (e) { previews[example.name] = ''; }
    }
    aboutLine.textContent = example.about || '';
    preview.innerHTML = previews[example.name];
  }
  function openExample() {
    var example = EXAMPLES[chosenExample];
    examplesBox.close();
    if (unsavedHere() && !confirm('Your edits have not been saved to a file. Open ' + example.name + ' in their place?')) return;
    openText(example.source);
  }
  // A click on the backdrop lands on the dialog itself, outside its box.
  function closeOnBackdrop(box) {
    box.addEventListener('click', function (event) {
      if (event.target !== box) return;
      var r = box.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) box.close();
    });
    each(box.querySelectorAll('[data-close]'), function (button) { button.onclick = function () { box.close(); }; });
  }
  if (examplesBox) {
    EXAMPLES.forEach(function (example, i) {
      var item = element('li', '', example.name);
      item.id = 'example-' + i;
      item.setAttribute('role', 'option');
      item.onclick = function () { pickExample(i); };
      item.ondblclick = openExample;
      catalog.append(item);
    });
    browseButton.onclick = function () {
      var at = 0;
      EXAMPLES.forEach(function (example, i) { if (example.name === current) at = i; });
      examplesBox.showModal();
      pickExample(at);
      catalog.focus();
    };
    catalog.addEventListener('keydown', function (event) {
      var step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[event.key];
      if (step) pickExample(chosenExample + step);
      else if (event.key === 'Home') pickExample(0);
      else if (event.key === 'End') pickExample(EXAMPLES.length - 1);
      else if (event.key === 'Enter') openExample();
      else return;
      event.preventDefault();
    });
    document.getElementById('choose').onclick = openExample;
    closeOnBackdrop(examplesBox);
    // Every drawing names its arrowheads alike, and a page takes the first of
    // a name it finds: a preview left in the closed dialog would take the
    // diagram's arrowheads with it.
    examplesBox.addEventListener('close', function () { preview.innerHTML = ''; });
    closeOnBackdrop(saveAs);
  }

  /* ---- format settings ---- */

  // The settings as \`name: value\` lines, the way a .reladraw-format holds
  // them, so the panel, the stored copy and the copied file are one text and
  // the library's own reader refuses what it would refuse in a file. With no
  // file they are kept in this browser; on a file's page they are read from
  // its nearest .reladraw-format each time the panel opens, and written back
  // only by its Save.
  var FORMAT = 'reladraw.format';
  var formatPanel = document.getElementById('format-settings');
  var formatTied = false;
  function settingValues(text) {
    var values = {};
    (text || '').split(/\\r?\\n/).forEach(function (line) {
      line = line.replace(/\\/\\/.*$/, '');
      var colon = line.indexOf(':');
      if (colon > 0) values[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    });
    return values;
  }
  var formatValues = settingValues(stored(FORMAT));
  function formatText() {
    if (!lib) return '';
    return lib.SETTINGS.map(function (setting) {
      var value = formatValues[setting.name];
      return setting.name + ': ' + (value === undefined || value === '' ? setting.written : value);
    }).join('\\n');
  }
  function checkSettings() {
    var problem = document.getElementById('format-problem');
    try { lib.readFormatSettings(formatText()); problem.textContent = ''; } catch (e) { problem.textContent = e.message; }
  }
  // A setting whose values are all words gets a list; one that takes a
  // number or a list gets a field, written as it would be in the file.
  function buildFormatFields() {
    var fields = document.getElementById('format-fields');
    fields.textContent = '';
    lib.SETTINGS.forEach(function (setting) {
      var label = element('label', '');
      label.append(element('code', '', setting.name));
      var words = setting.values.every(function (value) { return /^[a-z-]+$/.test(value[0]); });
      var control;
      if (words) {
        control = element('select', '');
        setting.values.forEach(function (value) {
          var option = element('option', '', value[0]);
          option.value = value[0];
          control.append(option);
        });
      } else {
        control = element('input', '');
        control.type = 'text';
        control.spellcheck = false;
        control.placeholder = setting.written;
      }
      control.value = formatValues[setting.name] || setting.written;
      control.addEventListener(words ? 'change' : 'input', function () {
        formatValues[setting.name] = control.value.trim();
        checkSettings();
        if (!formatTied) store(FORMAT, formatText());
      });
      label.append(control, element('span', '', setting.about.replace(/\\n/g, ' ') + ' ' +
        setting.values.map(function (value) { return value[0] + ': ' + value[1].replace(/\\n/g, ' '); }).join('; ') + '.'));
      fields.append(label);
    });
    checkSettings();
  }
  var formatSave = document.getElementById('format-save');
  function openFormatSettings() {
    var file = tiedFile();
    var reading = file
      ? fetch('/format-settings?file=' + encodeURIComponent(file)).then(function (r) {
        if (!r.ok) throw new Error('the server refused');
        var target = decodeURIComponent(r.headers.get('x-reladraw-format-file') || '.reladraw-format');
        return r.text().then(function (text) { return { text: text, target: target }; });
      })
      : null;
    Promise.all([libReady, reading]).then(function (got) {
      formatTied = !!got[1];
      formatValues = formatTied ? settingValues(got[1].text) : settingValues(stored(FORMAT));
      each(formatPanel.querySelectorAll('.about'), function (about) {
        about.hidden = about.getAttribute('data-for') !== (formatTied ? 'file' : 'browser');
      });
      if (formatTied) formatPanel.querySelector('.target').textContent = got[1].target;
      formatSave.hidden = !formatTied;
      formatSave.textContent = 'Save';
      buildFormatFields();
      formatPanel.showModal();
    }).catch(function (error) { flash(formatOpen, 'Can\\u2019t read them: ' + error.message); });
  }
  if (formatPanel) {
    formatOpen.onclick = openFormatSettings;
    closeOnBackdrop(formatPanel);
    // In the file, a default is written out, so the file says so too.
    document.getElementById('format-reset').onclick = function () {
      formatValues = {};
      if (formatTied) lib.SETTINGS.forEach(function (setting) { formatValues[setting.name] = setting.written; });
      else store(FORMAT, formatText());
      buildFormatFields();
    };
    formatSave.onclick = function () {
      var values = {};
      Object.keys(formatValues).forEach(function (name) { if (formatValues[name] !== '') values[name] = formatValues[name]; });
      fetch('/format-settings?file=' + encodeURIComponent(tiedFile()), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: values }),
      }).then(function (r) {
        return r.json().then(function (answer) {
          if (!r.ok) throw new Error(answer.error || 'the server refused');
          formatSave.textContent = 'Saved';
          setTimeout(function () { formatPanel.close(); }, 500);
        });
      }).catch(function (error) { document.getElementById('format-problem').textContent = error.message; });
    };
    var formatCopy = document.getElementById('format-copy');
    formatCopy.onclick = function () {
      var text = '// .reladraw-format: how reladraw format lays out the diagrams in this folder and below\\n' + formatText() + '\\n';
      toClipboard(text).then(function () { flash(formatCopy, 'Copied'); }, function () { flash(formatCopy, 'Blocked'); });
    };
  }

  /* ---- the cheatsheet ---- */

  // A window of cards, each row an example colored as the editor colors it.
  // The filter keeps the rows holding every word typed, matching the card's
  // name too, so "placement" keeps a whole card.
  var cheatBox = document.getElementById('cheatsheet');
  var openCheatsheet = function () {};
  if (cheatBox) {
    var cheatFilter = document.getElementById('cheat-filter');
    var cheatNone = cheatBox.querySelector('.cs-none');
    var cheatColored = false;
    var cheatGrid = cheatBox.querySelector('.cs-grid');
    var cheatCards = Array.prototype.slice.call(cheatGrid.querySelectorAll('.cs-card'));
    var cheatCols = element('div', 'cs-cols');
    cheatGrid.append(cheatCols);
    // Each card, in order, goes to the shortest column so far.
    var layoutCheat = function () {
      var width = cheatGrid.clientWidth;
      var count = width >= 1000 ? 3 : width >= 640 ? 2 : 1;
      cheatCols.style.setProperty('--cols', String(count));
      cheatCols.textContent = '';
      var cols = [];
      var heights = [];
      for (var i = 0; i < count; i++) {
        cols.push(element('div', 'cs-col'));
        heights.push(0);
        cheatCols.append(cols[i]);
      }
      cheatCards.forEach(function (card) {
        var at = heights.indexOf(Math.min.apply(null, heights));
        cols[at].append(card);
        if (!card.hidden) heights[at] += card.offsetHeight + 14;
      });
    };
    window.addEventListener('resize', function () { if (cheatBox.open) layoutCheat(); });
    openCheatsheet = function () {
      if (!cheatColored && lib) {
        cheatColored = true;
        each(cheatBox.querySelectorAll('.cs-row code'), function (code) {
          try { code.innerHTML = colorLine(code.textContent); } catch (e) {}
        });
      }
      cheatBox.showModal();
      layoutCheat();
      cheatFilter.focus();
      cheatFilter.select();
    };
    helpMenu.hidden = false;
    document.getElementById('cheat-open').onclick = openCheatsheet;
    closeOnBackdrop(cheatBox);
    cheatFilter.addEventListener('input', function () {
      var words = cheatFilter.value.toLowerCase().split(/\\s+/).filter(Boolean);
      var matches = function (text) {
        text = text.toLowerCase();
        return words.every(function (word) { return text.indexOf(word) >= 0; });
      };
      var any = false;
      each(cheatBox.querySelectorAll('.cs-card'), function (card) {
        var title = card.querySelector('h3').textContent;
        var shown = false;
        each(card.querySelectorAll('.cs-row'), function (row) {
          row.hidden = !matches(title + ' ' + row.textContent);
          if (!row.hidden) shown = true;
        });
        var note = card.querySelector('.cs-note');
        if (note) {
          note.hidden = !matches(title + ' ' + note.textContent);
          if (!note.hidden) shown = true;
        }
        card.hidden = !shown;
        if (shown) any = true;
      });
      cheatNone.hidden = any;
      layoutCheat();
    });
  }

  /* ---- the start ---- */

  if (EDIT) {
    document.getElementById('mode').hidden = false;
    checkButton.hidden = autoCheck;
    autoCheckRow.hidden = false;
    setSwitch(autoCheckRow, autoCheck);
    try {
      var share = parseFloat(localStorage.getItem(SPLIT));
      if (share > 0 && share < 1) divide(share, false);
    } catch (e) {}
    if (EDIT.kind === 'file') {
      sourceBox.value = DATA.source;
      tie(EDIT.file, DATA.source);
    } else {
      fileMenu.hidden = false;
      writeButton.hidden = true;
      formatOpen.hidden = false;
      writeButton.querySelector('.name').textContent = 'Save\\u2026';
      writeButton.title = EDIT.kind === 'local'
        ? 'Save the source as a file in ' + EDIT.folder + ' (\\u2318S or Ctrl+S)'
        : 'Save the source as a .reladraw file (\\u2318S or Ctrl+S)';
      formatButton.title = 'Lay the source out again (Shift+Alt+F)';
      if (saveAs) saveAs.querySelector('.folder').textContent = EDIT.folder || '';
      keptText = stored(KEPT_TEXT);
      fileName = stored(KEPT_NAME) || fileName;
      editorPane.querySelector('.file').textContent = EDIT.kind === 'local' ? 'not saved to a file' : fileName;
      var opening = stored(STORE);
      sourceBox.value = opening !== null ? opening : DATA.source;
      current = named(sourceBox.value);
      // The playground opens with the source shown; a file's page with it hidden.
      toggleEditor(true, true);
      markUnsaved();
    }
    libReady.then(function (loaded) {
      lib = loaded;
      paintSource();
      draw(sourceBox.value);
    }, function (error) {
      liveNote.textContent = 'The page couldn\\u2019t load the library it draws with: ' + error.message;
      liveNote.hidden = false;
    });
  }

  layoutSide();
  zoom.show();
})();
</script>
</body>
</html>
`;

/** What a page with an editor shows under its source: the language on one screen. */
const CHEATSHEET = `
<dialog id="cheatsheet" aria-label="Cheatsheet">
  <div class="cs-head">
    <h2>Cheatsheet</h2>
    <input id="cheat-filter" type="search" placeholder="Filter: above, gap, color…" autocomplete="off" spellcheck="false" aria-label="Filter the cheatsheet">
    <span class="gap"></span>
    <button class="close" type="button" data-close title="Close (Esc)" aria-label="Close the cheatsheet">×</button>
  </div>
  <div class="cs-grid">
    <section class="cs-card" style="--hue: var(--syn-keyword)"><h3>Statements</h3>
      <div class="cs-row"><code>node api "API"</code><span>a box, with its text</span></div>
      <div class="cs-row"><code>edge a -&gt; b</code><span>a line from a to b</span></div>
      <div class="cs-row"><code>edge a &lt;- b</code><span>the same line, written target first</span></div>
      <div class="cs-row"><code>edge a &lt;-&gt; b</code><span>arrows at both ends</span></div>
      <div class="cs-row"><code>point p  2 above a top-center</code><span>a named spot, to place against or pass through</span></div>
      <div class="cs-row"><code>region r  a top-left to c bottom-right</code><span>a named area, from one corner to another</span></div>
      <div class="cs-row"><code>bundle trunk  via: through r horizontal</code><span>a path that lines share</span></div>
      <div class="cs-row"><code>guide node g  right of a</code><span>for reference only; Guides in Settings shows it</span></div>
      <div class="cs-row"><code>style hot  fill: red</code><span>a named look, worn with style: hot</span></div>
      <div class="cs-row"><code>default edge  line: (path: square)</code><span>a look every edge wears; also node, leaf, container; the more specific wins</span></div>
      <div class="cs-row"><code>diagram theme: nord  background: #1e2229</code><span>the whole diagram's theme and colors</span></div>
      <p class="cs-note">The picture is drawn exactly as written: nothing moves to make room, and lines go only where they are told. Check reports anything that overlaps.</p>
    </section>
    <section class="cs-card" style="--hue: var(--syn-relation)"><h3>Placement</h3>
      <div class="cs-row"><code>node b  right of a</code><span>beside a, centered on it; also above, below, left of</span></div>
      <div class="cs-row"><code>node b  above-left of a</code><span>diagonally, corner to corner; also above-right, below-left, below-right</span></div>
      <div class="cs-row"><code>node b  3 left of a and 2 above a</code><span>3 units left of a, and 2 above it</span></div>
      <div class="cs-row"><code>node c  right of a and b</code><span>against the box that just bounds a and b</span></div>
      <div class="cs-row"><code>node b  even with a</code><span>on a's center line</span></div>
      <div class="cs-row"><code>node b  top even with a</code><span>tops in line; also bottom, left, right</span></div>
      <div class="cs-row"><code>node f  inside box top-right</code><span>in a corner of box</span></div>
      <div class="cs-row"><code>node g  outside box right</code><span>just outside a side of box</span></div>
      <div class="cs-row"><code>node h  on box bottom-left</code><span>centered on a part of box</span></div>
      <div class="cs-row"><code>node i  on between a and c</code><span>midway between a and c</span></div>
      <div class="cs-row"><code>node j  below down from b and left from a</code><span>at the point straight down from b and left from a</span></div>
      <p class="cs-note">The parts of a box: <code>text</code>, the sides <code>top</code> <code>bottom</code> <code>left</code> <code>right</code>, and <code>top-left</code> <code>top-center</code> <code>top-right</code> <code>left-center</code> <code>center</code> <code>right-center</code> <code>bottom-left</code> <code>bottom-center</code> <code>bottom-right</code>. One node is unplaced; every other is placed against something. Each axis is said once.</p>
    </section>
    <section class="cs-card" style="--hue: var(--syn-value)"><h3>Gaps</h3>
      <div class="cs-row"><code>node b  2 right of a</code><span>exactly 2 units apart</span></div>
      <div class="cs-row"><code>node b  right of a (gap: wide)</code><span>none, tight, normal or wide: 0, 2, 4 or 8 units</span></div>
      <p class="cs-note">A box is about 4 units tall. A gap is exact.</p>
    </section>
    <section class="cs-card" style="--hue: var(--syn-string)"><h3>Labels</h3>
      <div class="cs-row"><code>node parser</code><span>no text, so its name is its text</span></div>
      <div class="cs-row"><code>node parser ""</code><span>deliberately blank</span></div>
      <div class="cs-row"><code>node a "two / lines"</code><span>a space, slash and space breaks the line</span></div>
    </section>
    <section class="cs-card" style="--hue: var(--syn-name)"><h3>Containment</h3>
      <div class="cs-row"><code>node server.docker "Docker"</code><span>a dotted name is a child; declare the parent first</span></div>
      <div class="cs-row"><code>node server  layout: column</code><span>children top to bottom, in written order; or row</span></div>
      <div class="cs-row"><code>layout: column (gap: tight, widths: match, align-children: left)</code><span>how the children line up</span></div>
      <div class="cs-row"><code>layout: deck</code><span>a stack of cards, the first child in front</span></div>
      <div class="cs-row"><code>gather-children: left</code><span>where the children sit in spare room</span></div>
      <div class="cs-row"><code>shape: none</code><span>on a container, draws no box</span></div>
      <p class="cs-note">Without a layout, one child is unplaced and the rest are placed against it.</p>
    </section>
    <section class="cs-card" style="--hue: var(--syn-attribute)"><h3>Sizes</h3>
      <div class="cs-row"><code>width: 30</code><span>30 units wide</span></div>
      <div class="cs-row"><code>height: menu</code><span>as tall as menu</span></div>
      <div class="cs-row"><code>height: 0.5 menu height</code><span>half as tall as menu</span></div>
      <div class="cs-row"><code>height: a top to c bottom</code><span>from a's top to c's bottom</span></div>
      <div class="cs-row"><code>min-width: 10</code><span>at least 10 units wide</span></div>
    </section>
    <section class="cs-card" style="--hue: var(--syn-keyword)"><h3>Appearance</h3>
      <div class="cs-row"><code>style: hot</code><span>wear a named style</span></div>
      <div class="cs-row"><code>fill: #191728</code><span>a box's color</span></div>
      <div class="cs-row"><code>border: none</code><span>no outline</span></div>
      <div class="cs-row"><code>corners: sharp</code><span>square corners; boxes are rounded unless told</span></div>
      <div class="cs-row"><code>line: #d2904e</code><span>a line's color</span></div>
      <div class="cs-row"><code>overlap: allow</code><span>this one may overlap without a finding</span></div>
      <div class="cs-row"><code>url: "https://example.com"</code><span>a link, shown on the page</span></div>
      <div class="cs-row"><code>description: "What it does"</code><span>shown on the page; never drawn</span></div>
    </section>
    <section class="cs-card" style="--hue: var(--syn-string)"><h3>Lines</h3>
      <div class="cs-row"><code>line: (path: square, corners: rounded)</code><span>everything about a line goes in line:</span></div>
      <div class="cs-row"><code>line: (path: curved, curve: subtle)</code><span>straight (the default), square or curved</span></div>
      <div class="cs-row"><code>line: (path: square, turn: 1/3, step-out: tight)</code><span>where a square line turns, and how far it steps out</span></div>
      <div class="cs-row"><code>line: (crossing: arc)</code><span>where lines cross: gap, arc, square or none</span></div>
      <div class="cs-row"><code>line: (pattern: dashed)</code><span>solid, dashed, dotted or dash-dot</span></div>
      <div class="cs-row"><code>line: (thickness: thick)</code><span>thin, normal, thick, a multiple, or 3px</span></div>
    </section>
    <section class="cs-card" style="--hue: var(--syn-relation)"><h3>Where lines go</h3>
      <div class="cs-row"><code>from: right  to: left</code><span>leave and arrive at a side</span></div>
      <div class="cs-row"><code>to: bottom-center</code><span>arrive at a point on a side</span></div>
      <div class="cs-row"><code>to: left 3/4 down</code><span>a fraction of the way along a side</span></div>
      <div class="cs-row"><code>via: c top, between a and b</code><span>the places a line passes, in order</span></div>
      <div class="cs-row"><code>via: through r horizontal</code><span>straight through a region</span></div>
      <div class="cs-row"><code>edge a -&gt; b "calls" (at: start)</code><span>where a line's text sits: start, 1/4, the middle by default</span></div>
      <div class="cs-row"><code>edge a -&gt; b "calls" (above edge)</code><span>text beside the line rather than on it</span></div>
      <div class="cs-row"><code>edge a -&gt; b "calls" (on: longest level)</code><span>text on the longest level stretch</span></div>
      <p class="cs-note">A line runs straight between its two boxes, through anything in between, unless told otherwise.</p>
    </section>
    <section class="cs-card" style="--hue: var(--syn-name)"><h3>Body</h3>
      <div class="cs-row"><code>shape: document</code><span>rectangle, document, circle or none</span></div>
      <div class="cs-row"><code>node note "a note"  right of a  shape: none</code><span>just text: an annotation</span></div>
      <div class="cs-row"><code>icon: database</code><span>the node is the picture, with no box</span></div>
      <div class="cs-row"><code>badge: database</code><span>the picture beside the text, in the box</span></div>
      <div class="cs-row"><code>layout: deck  cards: "v1" "v2"</code><span>a stack of cards, one per text, front first</span></div>
      <div class="cs-row"><code>icon logo """&lt;svg …&gt;…&lt;/svg&gt;"""</code><span>your own picture, used as icon: logo</span></div>
      <p class="cs-note">Pictures: <code>disk</code> <code>desktop</code> <code>laptop</code> <code>package</code> <code>cubes</code> <code>cube</code> <code>database</code>.</p>
    </section>
    <section class="cs-card" style="--hue: var(--syn-value)"><h3>Text</h3>
      <div class="cs-row"><code>node a "Server" (size: large)</code><span>small, normal or large</span></div>
      <div class="cs-row"><code>node a "Server" (color: theme-muted)</code><span>the text's color</span></div>
      <div class="cs-row"><code>node a "A long label" (wrap: 24)</code><span>folds at 24 characters</span></div>
      <div class="cs-row"><code>node a "Server" (inside top, align: left)</code><span>where a container's title sits: on top, outside top, center</span></div>
      <div class="cs-row"><code>style dim  text: (color: theme-muted)</code><span>in a style, the bracket hangs off text:</span></div>
      <div class="cs-row"><code>node a "name / [dim]quieter[/dim]"</code><span>those words in style dim's text color</span></div>
      <div class="cs-row"><code>node a "a \\/ b"</code><span>a slash that doesn't break the line; \\[ for a bracket</span></div>
    </section>
    <section class="cs-card" style="--hue: var(--syn-comment)"><h3>Comments</h3>
      <div class="cs-row"><code>// to the end of the line</code><span>anywhere, including after a statement</span></div>
    </section>
  </div>
  <p class="cs-none" hidden>Nothing matches. Try one word, such as above, gap or color.</p>
</dialog>
`;

/** Where a page with no file sends someone who wants more than the cheatsheet. */
const LINKS = `<nav class="links"><a href="https://github.com/reladraw/reladraw" title="reladraw on GitHub" aria-label="reladraw on GitHub"><svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a></nav>`;

/**
 * How Format lays the source out, on any page with an editor. With no file
 * the settings are kept in the browser; on a file's page they are the
 * nearest .reladraw-format, and Save writes them there.
 */
const FORMAT_DIALOG = `
<dialog id="format-settings" aria-label="Format settings">
  <div class="bar"><h2>Format settings</h2><button type="button" data-close>Close</button></div>
  <p class="about" data-for="browser">How Format lays the source out. These are remembered in this browser only; for a project, put them in a <code>.reladraw-format</code> file beside its diagrams.</p>
  <p class="about" data-for="file" hidden>How Format lays the source out, as <code>reladraw format</code> does. Save writes them to <code class="target"></code>, keeping its comments; nothing changes until you save.</p>
  <form id="format-fields"></form>
  <p id="format-problem" role="alert"></p>
  <footer><button type="button" id="format-reset">Reset to defaults</button><span class="gap"></span><button type="button" id="format-copy" title="Copy these settings as the text of a .reladraw-format file">Copy as .reladraw-format</button><button type="button" id="format-save" hidden>Save</button></footer>
</dialog>`;

/**
 * A page with no file's dialogs: the examples and, served, the name of the
 * file a first Save writes.
 */
const DIALOGS = `
<dialog id="examples" aria-label="Examples">
  <div class="bar"><h2>Examples</h2><button type="button" data-close>Close</button></div>
  <ul id="catalog" role="listbox" tabindex="0" aria-label="Examples"></ul>
  <p id="about" aria-live="polite"></p>
  <div id="preview"></div>
  <footer><span class="keys"><kbd>↑</kbd> <kbd>↓</kbd> to preview · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</span><span class="gap"></span><button type="button" id="choose">Open in editor</button></footer>
</dialog>
<dialog id="save-as" aria-label="Save as a file">
  <form method="dialog" id="save-form">
    <div class="bar"><h2>Save as a file in <span class="folder"></span></h2></div>
    <p class="about">A path inside that folder, such as <code>diagram.reladraw</code> or <code>docs/flow.reladraw</code>. If the file is there already, you'll be asked before it's replaced. From then on this page is tied to the file.</p>
    <label>Path <input id="save-path" type="text" spellcheck="false" autocomplete="off" required></label>
    <p id="save-problem" role="alert"></p>
    <footer><span class="gap"></span><button type="button" data-close>Cancel</button><button type="submit" id="save-go">Save</button></footer>
  </form>
</dialog>`;
