import { fileChecks, findings, type Finding } from './checks.js';
import { SourceError } from './errors.js';
import type { DrawOptions } from './index.js';
import { blame, parse } from './parser.js';
import { renderTagged, themeOf } from './render.js';
import { resolve } from './resolve.js';
import { luminance, type Theme } from './themes.js';
import { PAN_ZOOM } from './viewer.js';

/**
 * `reladraw render --page`: one diagram in one self-contained HTML page, made
 * for looking at rather than embedding. The page is the diagram's own colors,
 * headed with its title, and it pans, zooms, goes full screen, saves the SVG
 * or a PNG, lists the findings, and names a box under the pointer. It needs
 * nothing running and fetches nothing, so it can be attached, mailed or
 * committed. `name` is the file's name, the title when the file states none.
 */
export function drawPage(source: string, name: string, options: DrawOptions = {}): { html: string; findings: Finding[] } {
  const run = (text: string) => {
    const layout = resolve(parse(text), options);
    const { svg, tagged } = renderTagged(layout, options);
    const found =
      options.checks === false ? [] : findings(layout, options.checks ? options.checks(fileChecks(layout)) : fileChecks(layout));
    const title = layout.diagram['title'] ?? name;
    return { html: page({ title, name, svg, tagged, findings: found, theme: themeOf(layout, options) }), findings: found };
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
  /** The SVG as `render` writes it, which is what Save SVG and Save PNG save. */
  svg: string;
  /** The same drawing with each thing grouped and named, which is what is shown. */
  tagged: string;
  findings: Finding[];
  theme: Theme;
}

function page({ title, name, svg, tagged, findings, theme }: PageParts): string {
  const hex = (color: string) => /^#[0-9a-f]{6}$/i.test(color);
  // The browser's own controls (scroll bars, focus rings) follow the page, so
  // a dark diagram doesn't get a light one's. A color written by hand in a
  // form that can't be measured leaves the choice to the browser.
  const scheme =
    hex(theme.text) && hex(theme.background) ? (luminance(theme.text) > luminance(theme.background) ? 'dark' : 'light') : 'light dark';
  const data = {
    svg,
    name,
    findings: findings.map((finding) => ({ kind: finding.kind, message: finding.message, line: finding.line })),
  };
  // Replaced by functions, so a `$` in a title or a drawing is taken as written.
  // The zoom's code goes in first, so nothing a diagram says can be taken for its marker.
  return PAGE.replace('{{panzoom}}', () => PAN_ZOOM)
    .replace('{{scheme}}', () => scheme)
    .replace('{{title}}', () => escapeHtml(title))
    .replace('{{heading}}', () => escapeHtml(title))
    .replace('{{colors}}', () =>
      [
        `--page: ${theme.background};`,
        `--ink: ${theme.text};`,
        `--muted: ${theme.mutedText};`,
        `--rule: ${theme.boxStroke};`,
        `--accent: ${theme.primary.color};`,
        `--on-accent: ${theme.primary.on};`,
      ].join(' '),
    )
    .replace('{{drawing}}', () => tagged)
    .replace('{{data}}', () => scriptJson(data));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  h1 { flex: 1 1 16rem; margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
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
  aside {
    width: min(26rem, 38vw); display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid color-mix(in srgb, var(--rule) 45%, transparent);
  }
  aside[hidden] { display: none; }
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
    aside { width: auto; max-height: 40%; border-left: 0; border-top: 1px solid color-mix(in srgb, var(--rule) 45%, transparent); }
  }
</style>
</head>
<body>
<header>
  <h1>{{heading}}</h1>
  <div class="tools">
    <button id="out" type="button" title="Zoom out (-)" aria-label="Zoom out">−</button>
    <span id="scale" aria-live="polite">100%</span>
    <button id="in" type="button" title="Zoom in (+)" aria-label="Zoom in">+</button>
    <button id="fit" type="button" title="The whole diagram in view (0)">Fit</button>
    <button id="actual" type="button" title="The drawing at its own scale (1)">100%</button>
    <span class="gap"></span>
    <button id="full" type="button" title="Full screen (f)">Full screen</button>
    <span class="menu">
      <button id="export" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="export-list">Export ▾</button>
      <span id="export-list" class="menu-list" hidden>
        <button id="copy-svg" type="button">Copy SVG</button>
        <button id="save-svg" type="button" title="Save the picture as an SVG file">Save SVG</button>
        <button id="save-png" type="button" title="Save the picture as a PNG, at twice its size">Save PNG</button>
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
  <aside id="findings" aria-label="Findings">
    <h2>Findings <span class="what">where the picture, drawn as written, may not read as meant</span></h2>
    <ol id="finding-list"></ol>
  </aside>
</main>
<script>
(function () {
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

  // Copy SVG, Save SVG and Save PNG are under one Export button, as in the
  // playground. The list stays open after a choice, so "Copied" can be read,
  // and closes on a click elsewhere or Escape.
  var exportButton = document.getElementById('export');
  var exportList = document.getElementById('export-list');
  function showExport(open) {
    exportList.hidden = !open;
    exportButton.setAttribute('aria-expanded', String(open));
  }
  exportButton.onclick = function () { showExport(exportList.hidden); };
  document.addEventListener('click', function (event) {
    if (!exportList.hidden && !event.target.closest('.menu')) showExport(false);
  });

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

  document.getElementById('save-svg').onclick = function () {
    saveBlob(new Blob([DATA.svg], { type: 'image/svg+xml' }), DATA.name + '.svg');
  };

  // The browser draws the SVG onto a canvas with the fonts the page shows it
  // in, twice the size so it stays sharp on a high-density screen. A data URL
  // rather than a blob one, which some browsers count as foreign and refuse
  // to let the canvas be read back.
  var savePng = document.getElementById('save-png');
  savePng.onclick = function () {
    var image = new Image();
    image.onload = function () {
      var box = svg.viewBox.baseVal;
      var canvas = document.createElement('canvas');
      canvas.width = box.width * 2;
      canvas.height = box.height * 2;
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        blob ? saveBlob(blob, DATA.name + '.png') : flash(savePng, 'Failed');
      }, 'image/png');
    };
    image.onerror = function () { flash(savePng, 'Failed'); };
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(DATA.svg);
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

  /* ---- keys, beyond the zoom's own ---- */

  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest && event.target.closest('input, textarea')) return;
    if (event.key === 'f' && !full.hidden) toggleFull();
    else if (event.key === 'Escape') { showExport(false); unlight(); }
    else return;
    event.preventDefault();
  });

  zoom.show();
})();
</script>
</body>
</html>
`;
