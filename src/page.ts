import { fileChecks, findings, type Finding } from './checks.js';
import { SourceError } from './errors.js';
import type { DrawOptions } from './index.js';
import { blame, parse } from './parser.js';
import type { Icon } from './icons.js';
import { linkLabel, linksOf, type Link } from './links.js';
import type { Layout, LayoutNode } from './model.js';
import { iconSvg, renderTagged, themeOf } from './render.js';
import { resolve } from './resolve.js';
import { luminance, type Theme } from './themes.js';
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
    const { svg, tagged } = renderTagged(layout, options);
    const found =
      options.checks === false ? [] : findings(layout, options.checks ? options.checks(fileChecks(layout)) : fileChecks(layout));
    const title = layout.diagram['title'] ?? name;
    const theme = themeOf(layout, options);
    return {
      html: page({ title, name, drawn, source, svg, tagged, findings: found, theme, graph: graphOf(layout, theme) }),
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
  /** The SVG as `render` writes it, which is what Save SVG and Save PNG save. */
  svg: string;
  /** The same drawing with each thing grouped and named, which is what is shown. */
  tagged: string;
  findings: Finding[];
  theme: Theme;
  graph: Graph;
}

/** A link as the panel shows it: where it goes, what it is called, and its badge drawn. */
interface LinkView {
  href: string;
  label: string;
  badge: string;
}

/**
 * What a click on the page selects, and what the panel says about it: every
 * node with its text and links, and every line with its two ends, upstream
 * first. A line's index is its place in the layout, which `data-edge` names.
 */
interface Graph {
  nodes: Record<string, { label: string; links: LinkView[] }>;
  edges: { up: string; down: string; label: string; links: LinkView[] }[];
}

const BADGE_SIDE = 20;

function graphOf(layout: Layout, theme: Theme): Graph {
  const views = (links: Link[] | undefined): LinkView[] =>
    (links ?? []).map((link) => {
      const label = linkLabel(link, links);
      const icon: Icon =
        link.icon === undefined
          ? { letters: [...label.trim()][0]?.toUpperCase() ?? '?' }
          : 'picture' in link.icon
            ? layout.linkIcons[link.icon.picture]!
            : link.icon;
      return { href: link.href, label, badge: iconSvg(icon, BADGE_SIDE, theme) };
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
  const nodes: Graph['nodes'] = {};
  for (const node of layout.nodes) {
    const text = plainText(node.text);
    nodes[node.name] = { label: text === '' ? node.name.split('.').pop()! : text, links: views(linksFor(node)) };
  }
  const edges = layout.edges.map((edge) => {
    // The upstream end is the one a line runs from: the end without a mark
    // when only the other has one, and otherwise the end written first.
    const [, start = '', , end = ''] = edge.arrow.match(/^(.*?)(-{1,2})(.*)$/) ?? [];
    const backwards = start !== '' && end === '';
    const [up, down] = backwards ? [edge.to, edge.from] : [edge.from, edge.to];
    const text = edge.texts.map((one) => plainText(one.text)).filter((one) => one !== '').join(' · ');
    return { up: up.name, down: down.name, label: text, links: views(linksOf(edge.attrs)) };
  });
  return { nodes, edges };
}

/** A text as a reader sees it: markup such as `[dim]` taken out, its lines run together. */
function plainText(text: string): string {
  return text.replace(/\[\/?[a-z][a-z0-9-]*\]/gi, '').replace(/\s*\n\s*/g, ' ').trim();
}

/** A local time as `2026-11-05 14:32`, which sorts and reads the same everywhere. */
function stamp(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}

function page({ title, name, drawn, source, svg, tagged, findings, theme, graph }: PageParts): string {
  const hex = (color: string) => /^#[0-9a-f]{6}$/i.test(color);
  // The browser's own controls (scroll bars, focus rings) follow the page, so
  // a dark diagram doesn't get a light one's. A color written by hand in a
  // form that can't be measured leaves the choice to the browser.
  const scheme =
    hex(theme.text) && hex(theme.background) ? (luminance(theme.text) > luminance(theme.background) ? 'dark' : 'light') : 'light dark';
  const data = {
    svg,
    name,
    source,
    findings: findings.map((finding) => ({ kind: finding.kind, message: finding.message, line: finding.line })),
    graph,
  };
  // Replaced by functions, so a `$` in a title or a drawing is taken as written.
  // The zoom's code goes in first, so nothing a diagram says can be taken for its marker.
  return PAGE.replace('{{panzoom}}', () => PAN_ZOOM)
    .replace('{{scheme}}', () => scheme)
    .replace('{{title}}', () => escapeHtml(title))
    .replace('{{heading}}', () => escapeHtml(title))
    .replace('{{drawn}}', () => escapeHtml(drawn))
    .replace('{{colors}}', () =>
      [
        `--page: ${theme.background};`,
        `--ink: ${theme.text};`,
        `--muted: ${theme.mutedText};`,
        `--rule: ${theme.boxStroke};`,
        `--accent: ${theme.primary.color};`,
        `--on-accent: ${theme.primary.on};`,
        '--sel: #e0b25a; --up: #22b98c; --down: #e5484d;',
      ].join(' '),
    )
    .replace('{{drawing}}', () => tagged)
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
  aside { display: flex; flex-direction: column; min-height: 0; flex: 1;
    border-top: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  aside[hidden] { display: none; }

  /* ---- what is selected ---- */
  #selected { padding: 10px 16px 12px; overflow: auto; flex: none; max-height: 60%; }
  #selected .empty { margin: 0; color: var(--muted); font-size: 13px; }
  #selected h2 { margin: 0 0 8px; font-size: 15px; font-weight: 600; color: var(--sel); overflow-wrap: anywhere; }
  #selected h3 {
    display: flex; align-items: center; gap: 8px; margin: 12px 0 4px;
    font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
  }
  #selected h3 svg { flex: none; }
  #selected .none { color: var(--muted); font-size: 13px; }
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
    <button id="full" type="button" title="Full screen (f)">Full screen</button>
    <span class="menu">
      <button id="save" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="save-list">Save ▾</button>
      <span id="save-list" class="menu-list" hidden>
        <button id="save-page" type="button" title="Save this page as one HTML file, to keep or send">This page</button>
        <button id="save-source" type="button" title="Save the .reladraw file this page was drawn from">.reladraw source</button>
        <hr>
        <button id="save-svg" type="button" title="Save the picture as an SVG file">SVG</button>
        <button id="save-png" type="button" title="Save the picture as a PNG, at twice its size">PNG</button>
        <button id="copy-svg" type="button" title="Copy the picture's SVG to the clipboard">Copy SVG</button>
      </span>
    </span>
    <button id="toggle-findings" type="button" aria-controls="findings"></button>
  </div>
</header>
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
    full.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
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
    var was = button.textContent;
    button.textContent = text;
    setTimeout(function () { button.textContent = was; }, 1200);
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
  // can be read, and closes on a click elsewhere or Escape.
  var saveButton = document.getElementById('save');
  var saveList = document.getElementById('save-list');
  function showSave(open) {
    saveList.hidden = !open;
    saveButton.setAttribute('aria-expanded', String(open));
  }
  saveButton.onclick = function () { showSave(saveList.hidden); };
  document.addEventListener('click', function (event) {
    if (!saveList.hidden && !event.target.closest('.menu')) showSave(false);
  });

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
      area.value = DATA.svg;
      document.body.appendChild(area);
      area.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) {}
      area.remove();
      flash(copySvg, done ? 'Copied' : 'Blocked');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(DATA.svg).then(function () { flash(copySvg, 'Copied'); }, fallback);
    } else fallback();
  };

  var saveSvg = document.getElementById('save-svg');
  saveSvg.onclick = function () {
    saveFile(saveSvg, DATA.name + '.svg', 'SVG image', 'image/svg+xml', function () {
      return ready(new Blob([DATA.svg], { type: 'image/svg+xml' }));
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
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(DATA.svg);
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
  var toggle = document.getElementById('toggle-findings');
  var count = DATA.findings.length;

  function showPanel(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-pressed', String(open));
  }
  if (count === 0) {
    toggle.textContent = 'No findings';
    toggle.disabled = true;
    panel.hidden = true;
  } else {
    toggle.textContent = count === 1 ? '1 finding' : count + ' findings';
    toggle.onclick = function () { showPanel(panel.hidden); };
    showPanel(true);
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
    selectedPanel.textContent = '';
    if (!selection) {
      selectedPanel.append(element('p', 'empty', 'Click a box or a line to see its links and what it connects to.'));
      return;
    }
    var heading, links, from, to;
    if (selection.kind === 'node') {
      var node = graph.nodes[selection.key];
      heading = node ? node.label : selection.key;
      links = node ? node.links : [];
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
      row.innerHTML = link.badge;
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

  /* ---- keys, beyond the zoom's own ---- */

  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest && event.target.closest('input, textarea')) return;
    if (event.key === 'f' && !full.hidden) toggleFull();
    else if (event.key === 'Escape') { showSave(false); unlight(); select(null); }
    else return;
    event.preventDefault();
  });

  zoom.show();
})();
</script>
</body>
</html>
`;
