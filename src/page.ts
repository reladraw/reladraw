import type { Finding } from './checks.js';
import { SourceError } from './errors.js';
import type { DrawOptions } from './index.js';
import { PAGE_CLIENT } from './page-client.js';
import { dataOf, palettes, partsOf, type PageParts } from './page-data.js';
import { PAGE_STYLE } from './page-style.js';
import { DEFAULT_THEME } from './themes.js';

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

/** One diagram on a page of several: its source, its file's name, and the label the page picks it by. */
/** A grid's rows and columns, in order, each with its label, and what each axis is. */
export interface PageGrid {
  rowsName?: string;
  columnsName?: string;
  rows: { name: string; label: string }[];
  columns: { name: string; label: string }[];
}

/** A spec's grid as the page carries it: names and labels, without the lines they were stated on. */
export function pageGrid(grid: { rowsName?: string; columnsName?: string; rows: { name: string; label: string }[]; columns: { name: string; label: string }[] }): PageGrid {
  return {
    ...(grid.rowsName !== undefined ? { rowsName: grid.rowsName } : {}),
    ...(grid.columnsName !== undefined ? { columnsName: grid.columnsName } : {}),
    rows: grid.rows.map(({ name, label }) => ({ name, label })),
    columns: grid.columns.map(({ name, label }) => ({ name, label })),
  };
}

export interface ListedDiagram {
  source: string;
  file: string;
  label?: string;
  /** The group it is listed under, one of the page's `groups`; none before the first. */
  group?: string;
  /** In a grid, its cell, by its row's and its column's names. */
  cell?: { row: string; column: string };
  options?: DrawOptions;
  /** Served: the diagram's path inside the folder served, which the page follows it by. */
  path?: string;
}

/**
 * `reladraw render --page` of a page spec, several files or a folder: one
 * page holding every diagram. It opens on an overview of them all, each under
 * its label; a diagram opened from there fills the page as a page of one
 * does, with a drop-down in the bar to switch to another and the page's title
 * to go back. `title` heads the page. The overview is in `theme`, whatever
 * theme the diagram last open was in. Findings come back with the file each
 * belongs to. Served (`editing`), it is the page `reladraw serve` follows its
 * files on, and a diagram that doesn't draw yet is drawn empty, not refused.
 * `groups` are the spec's groups in order, empty ones included: each heads
 * the diagrams listed under it, after those listed before any group.
 */
export function drawListPage(
  title: string,
  diagrams: ListedDiagram[],
  at: Date = new Date(),
  theme: string = DEFAULT_THEME,
  editing?: Extract<Editing, { kind: 'list' }>,
  groups: string[] = [],
  grid?: PageGrid,
): { html: string; findings: { file: string; findings: Finding[] }[] } {
  const axisLabel = (axis: { name: string; label: string }[], name: string) => axis.find((one) => one.name === name)?.label ?? name;
  const all = diagrams.map((one, index) => {
    try {
      return { one, parts: partsOf(one.source, one.file, one.options ?? {}, at) };
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      // Served, a diagram that doesn't draw yet gets an empty drawing; its
      // text arrives with the page's first events, fails there too, and the
      // page says why, then draws it as soon as its file does.
      if (editing) return { one, parts: partsOf('', one.file, {}, at) };
      throw new ListedDiagramError(index, error);
    }
  });
  // Served, a page may list nothing yet, as a spec whose diagrams aren't written.
  const first = all[0]?.parts ?? partsOf('', 'diagram.reladraw', {}, at);
  const list = {
    title,
    theme,
    palettes: palettes(),
    groups,
    ...(grid ? { grid } : {}),
    items: all.map(({ one, parts }, i) => ({
      // A cell is labeled by its row and its column.
      label: grid && one.cell ? `${axisLabel(grid.rows, one.cell.row)} · ${axisLabel(grid.columns, one.cell.column)}` : one.label ?? parts.title,
      ...(one.group !== undefined ? { group: one.group } : {}),
      ...(one.cell ? { cell: one.cell } : {}),
      // The label as the spec states it, apart from the title it falls back to.
      ...(editing ? { file: one.path ?? one.file, ...(one.label !== undefined ? { stated: one.label } : {}) } : {}),
      title: parts.title,
      drawn: parts.drawn,
      // The first is the page's own data, so it isn't carried twice.
      data: i === 0 ? null : dataOf(parts),
    })),
  };
  const html = page(first, editing ?? null, undefined, list);
  return { html, findings: all.map(({ one, parts }) => ({ file: one.file, findings: parts.findings })) };
}

/** A diagram on a page of several that doesn't draw: which one, by its place in the list, and why. */
export class ListedDiagramError extends Error {
  constructor(
    readonly index: number,
    override readonly cause: SourceError,
  ) {
    super(cause.message);
  }
}

type ListData = {
  title: string;
  theme: string;
  palettes: Record<string, { colors: Record<string, string>; scheme: string }>;
  groups: string[];
  items: { label: string; group?: string; file?: string; stated?: string; title: string; drawn: string; data: unknown }[];
};

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
  | { kind: 'hosted'; examples: Example[] }
  | { kind: 'list'; from: ListFrom; folder: string };

/**
 * What a served page of several diagrams lists: a spec's diagrams, a folder's
 * `.reladraw` files, or the files given, each by its path inside the folder
 * served. The page follows the spec and each diagram, and edits whichever is
 * in view: the spec on the overview, which a folder or files imply until the
 * first Save writes one.
 */
export type ListFrom = { spec: string } | { folder: string } | { files: string[] };

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

function page(parts: PageParts, editing: Editing | null, framing?: Framing, list?: ListData): string {
  const { themes, current } = parts;
  const shown = themes[current]!;
  // A list opens on its overview, in the page's own colors.
  const opening = list ? list.palettes[list.theme]! : shown;
  const data ={ ...dataOf(parts), edit: editing, ...(list ? { list } : {}) };
  const title = list?.title ?? framing?.title ?? parts.title;
  const noFile = editing !== null && (editing.kind === 'local' || editing.kind === 'hosted');
  // A served list's spec may be implied, and its first Save names a file.
  const savesAs = noFile || editing?.kind === 'list';
  const filled: Record<string, string> = {
    style: PAGE_STYLE,
    client: PAGE_CLIENT,
    scheme: opening.scheme,
    title: escapeMarkup(title),
    head: framing?.head ?? '',
    heading: escapeMarkup(list?.title ?? framing?.heading ?? parts.title),
    drawn: escapeMarkup(list ? `${list.items.length} diagrams` : (framing?.drawn ?? parts.drawn)),
    links: noFile ? LINKS : '',
    pick: list ? PICK : '',
    colors: [
      ...Object.entries(opening.colors).map(([key, value]) => `${key}: ${value};`),
      '--sel: #e0b25a; --up: #22b98c; --down: #e5484d;',
    ].join(' '),
    cheatsheet: editing ? CHEATSHEET : '',
    dialogs: (editing ? FORMAT_DIALOG : '') + (savesAs ? DIALOGS : ''),
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
</style>
<style>{{style}}</style>
</head>
<body>
<header>
  <div class="heading">
    <h1>{{heading}}</h1>{{links}}{{pick}}
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
    <span class="menu">
      <button id="help-button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="help-list">Help ▾<kbd class="tag">h</kbd></button>
      <span id="help-list" class="menu-list" role="menu" hidden>
        <button id="cheat-open" class="row" type="button" role="menuitem" data-key="?" title="The language on one screen" hidden><span class="name">Language cheatsheet</span><kbd>?</kbd></button>
        <button id="keys-open" class="row" type="button" role="menuitem" data-key="k" title="Every key the page answers to"><span class="name">Keyboard shortcuts</span><kbd>k</kbd></button>
        <hr>
        <a id="syntax-link" class="row" role="menuitem" data-key="r" href="https://github.com/reladraw/reladraw/blob/main/SYNTAX.md" target="_blank" rel="noopener" title="The full syntax reference, on GitHub"><span class="name">Syntax reference ↗</span><kbd>r</kbd></a>
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
    </div>
    <div class="code">
      <pre id="paint" aria-hidden="true"></pre>
      <textarea id="source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Source"></textarea>
    </div>{{cheatsheet}}
  </section>
  <div id="split" role="separator" aria-orientation="vertical" aria-label="Resize the source and the diagram" tabindex="0" title="Drag to resize; double-click to reset" hidden></div>
  <section id="overview" aria-label="Every diagram on this page" hidden></section>
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
<dialog id="keys-sheet" aria-label="Keyboard shortcuts">
  <div class="bar"><h2>Keyboard shortcuts</h2><button type="button" data-close>Close</button></div>
  <div class="ks-grid">
    <section class="cs-card" style="--hue: var(--syn-keyword)"><h3>The picture</h3>
      <div class="cs-row"><div><kbd>+</kbd><kbd>−</kbd></div><span>zoom in, zoom out</span></div>
      <div class="cs-row"><div><kbd>0</kbd></div><span>fit the diagram to the window</span></div>
      <div class="cs-row"><div><kbd>1</kbd></div><span>100%</span></div>
      <div class="cs-row"><div><kbd>g</kbd></div><span>grab the diagram, then pan it with the arrows or <kbd>h</kbd> <kbd>j</kbd> <kbd>k</kbd> <kbd>l</kbd>; Shift pans further</span></div>
      <div class="cs-row"><div><kbd>p</kbd></div><span>show or hide the side panel</span></div>
      <div class="cs-row"><div><kbd>f</kbd></div><span>full screen</span></div>
    </section>
    <section class="cs-card" style="--hue: var(--syn-type)" data-on="list"><h3>Diagrams</h3>
      <div class="cs-row"><div><kbd>o</kbd></div><span>the overview of every diagram on this page</span></div>
      <div class="cs-row"><div><kbd>[</kbd><kbd>]</kbd></div><span>the diagram before or after this one; from the overview, the first or last</span></div>
      <div class="cs-row"><div><kbd>s</kbd></div><span>on the overview, a letter on every diagram; type one to open it</span></div>
      <div class="cs-row"><div><kbd>m</kbd> <kbd>d</kbd></div><span>with a diagram open, the drop-down of every diagram</span></div>
    </section>
    <section class="cs-card" style="--hue: var(--syn-relation)"><h3>Selecting</h3>
      <div class="cs-row"><div><kbd>s</kbd></div><span>a letter on every box and line; type one to select it</span></div>
      <div class="cs-row"><div><kbd>/</kbd></div><span>filter what gets a letter: words in its text, or is:node, is:edge, is:container, style:name</span></div>
      <div class="cs-row"><div><kbd>n</kbd></div><span>letters on what the selection connects to</span></div>
      <div class="cs-row"><div><kbd>i</kbd></div><span>letters on what is inside the selection, and the box it is in</span></div>
      <div class="cs-row"><div><kbd>l</kbd></div><span>letters on the selection's links, to open one</span></div>
      <div class="cs-row"><div><kbd>⌫</kbd></div><span>step back: let go of a grab, then a lit finding, then the selection</span></div>
      <div class="cs-row"><div><kbd>Esc</kbd></div><span>back to the plain diagram, from anywhere</span></div>
    </section>
    <section class="cs-card" style="--hue: var(--syn-value)"><h3>Menus</h3>
      <div class="cs-row"><div><kbd>m</kbd></div><span>the bar: each control shows its letter</span></div>
      <div class="cs-row"><div><kbd>m</kbd> <kbd>s</kbd></div><span>Settings</span></div>
      <div class="cs-row"><div><kbd>m</kbd> <kbd>x</kbd></div><span>Export</span></div>
      <div class="cs-row" data-on="file"><div><kbd>m</kbd> <kbd>o</kbd></div><span>Versions</span></div>
      <div class="cs-row"><div><kbd>m</kbd> <kbd>h</kbd></div><span>Help</span></div>
      <div class="cs-row"><div><kbd>↑</kbd><kbd>↓</kbd> <kbd>Enter</kbd></div><span>in a menu, choose a row; or press the row's letter</span></div>
      <div class="cs-row"><div><kbd>⌫</kbd></div><span>up one level</span></div>
    </section>
    <section class="cs-card" style="--hue: var(--syn-attribute)" data-on="edit"><h3>Editing</h3>
      <div class="cs-row"><div><kbd>e</kbd></div><span>show or hide the source</span></div>
      <div class="cs-row"><div><kbd>c</kbd></div><span>Check: look for overlaps and other places the picture may not read as meant, unless Check as I type is on</span></div>
      <div class="cs-row"><div><kbd>?</kbd></div><span>the language cheatsheet</span></div>
      <div class="cs-row"><div><kbd>⌘S</kbd> or <kbd>Ctrl+S</kbd></div><span>save</span></div>
      <div class="cs-row"><div><kbd>Shift+Alt+F</kbd></div><span>format the source</span></div>
      <div class="cs-row"><div><kbd>Esc</kbd></div><span>in the source, leave it so the keys above work again</span></div>
    </section>
  </div>
</dialog>
{{library}}
<script type="application/json" id="reladraw-data">{{data}}</script>
<script>{{client}}</script>
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
      <p class="cs-note">Pictures are Lucide's icons, by Lucide's names, all listed at <a href="https://lucide.dev/icons" target="_blank" rel="noopener">lucide.dev/icons</a>: <code>server</code> <code>database</code> <code>laptop</code> <code>smartphone</code> <code>hard-drive</code> <code>boxes</code>.</p>
    </section>
    <section class="cs-card" style="--hue: var(--syn-value)"><h3>Text</h3>
      <div class="cs-row"><code>node a "Server" (size: large)</code><span>small, normal or large</span></div>
      <div class="cs-row"><code>node a "Server" (color: theme-muted)</code><span>the text's color</span></div>
      <div class="cs-row"><code>node a "Server" (weight: bold, italic: on, underline: on)</code><span>bold, italic, underlined</span></div>
      <div class="cs-row"><code>node a "A long label" (wrap: 24)</code><span>folds at 24 characters</span></div>
      <div class="cs-row"><code>node a "Server" (inside top, align: left)</code><span>where a container's title sits: on top, outside top, center</span></div>
      <div class="cs-row"><code>style dim  text: (color: theme-muted)</code><span>in a style, the bracket hangs off text:</span></div>
      <div class="cs-row"><code>node a "name / [dim]quieter[/dim]"</code><span>those words in style dim's text color, size and face</span></div>
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
// The drop-down a page of several diagrams switches between them with; the script fills it.
const PICK = `<span class="menu pick" id="pick-menu" hidden><button id="pick-button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="pick-rows" title="Another diagram on this page ([ and ])"><span class="name"></span> ▾<kbd class="tag">d</kbd></button><span id="pick-rows" class="menu-list" role="menu" aria-label="Which diagram" hidden></span></span>`;

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
