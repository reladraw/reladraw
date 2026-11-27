/**
 * The page's style, put inline in every page after the colors of the theme it
 * opens in, which come in a style of their own. Kept as text, not a stylesheet,
 * because a page written by render --page is one file that needs nothing else.
 */
export const PAGE_STYLE = String.raw`
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
  /* Bare text has no outline for the glow to follow, and a glow round each
     letter only blurs them, so its text takes the color instead. */
  #view g[data-node].bare { filter: none; }
  #view g[data-node].bare.sel text { fill: var(--sel); }
  #view g[data-node].bare.up text { fill: var(--up); }
  #view g[data-node].bare.down text { fill: var(--down); }
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
  /* The picture's controls float over its foot: Check at the bottom left, the
     zoom on a card at the bottom right. They sit beside the view, not in it,
     so a press on them never starts a pan. */
  #canvas { position: relative; flex: 1; display: flex; min-height: 0; }
  .floating { position: absolute; z-index: 4;
    background: color-mix(in srgb, var(--ink) 7%, var(--page));
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); }
  .floating[hidden] { display: none; }
  #check { left: 12px; bottom: 12px; padding: 5px 14px; }
  #check:hover { background: color-mix(in srgb, var(--ink) 14%, var(--page)); }
  /* The keys' strip shares the bottom left: it starts after Check. */
  #canvas:has(#check:not([hidden])) #strip { left: 92px; max-width: calc(100% - 370px); }
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
  /* A page of several diagrams: its title goes back to the overview, and the drop-down switches. */
  .heading h1.back { cursor: pointer; border-radius: 4px; }
  .heading h1.back::before { content: '← '; color: var(--muted); }
  .heading h1.back:hover { color: var(--accent); }
  .heading h1.back:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .menu.pick { display: inline-block; vertical-align: middle; margin-left: 10px; }
  .menu.pick[hidden] { display: none; }
  .menu.pick > button { font-size: 13px; padding: 3px 8px; white-space: nowrap; }
  .menu.pick > button .name { display: inline-block; max-width: 14em; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
  .menu.pick > .menu-list { left: 0; right: auto; max-height: 70vh; max-width: calc(100vw - 32px); overflow: auto; }
  #pick-rows .line { display: flex; align-items: center; gap: 8px; width: 100%; }
  #pick-rows .name { flex: 1; }
  #pick-rows .row[aria-checked="true"] .name { font-weight: 600; }
  #pick-rows .title { font-size: 11px; color: var(--muted); }
  #pick-rows.tiles:not([hidden]) { display: grid; grid-template-columns: repeat(var(--across), 11rem); gap: 8px; }
  #pick-rows.tiles .row {
    flex-direction: column; align-items: stretch; gap: 4px; padding: 6px;
    border: 1px solid color-mix(in srgb, var(--rule) 50%, transparent); border-radius: 6px;
  }
  #pick-rows.tiles .row[aria-checked="true"] { border-color: var(--sel); box-shadow: inset 0 0 0 1px var(--sel); }
  #pick-rows.tiles .mark { display: none; }
  #pick-rows.tiles .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #pick-rows .thumb {
    height: 6rem; display: flex; align-items: center; justify-content: center; overflow: hidden;
    border-radius: 4px;
  }
  #pick-rows .thumb svg { width: 100%; height: 100%; }
  #pick-rows.columns:not([hidden]) {
    display: grid; grid-auto-flow: column; gap: 2px 10px;
    grid-template-rows: repeat(var(--down), auto); grid-template-columns: repeat(var(--across), 18rem);
  }
  /* Grouped, each group is a box, sized to what is in it; the boxes run in
     order and wrap, every box on a line as tall as the tallest. */
  #pick-rows.boxed:not([hidden]) {
    display: flex; flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: 8px;
    width: max-content; max-width: min(calc(100vw - 32px), 60rem);
  }
  /* A group's box and the cards in it: blue-grays, the box a step from the
     page and the cards a step further (picked 2026-11-14 from a mock-up). */
  :root { --group-bg: #161b24; --group-line: #283042; --card-bg: #1f2633; --card-line: #36405a; --card-over: #283042; }
  :root[data-scheme="light"] { --group-bg: #e8edf5; --group-line: #cdd6e4; --card-bg: #f7f9fc; --card-line: #b8c4d8; --card-over: #ffffff; }
  #pick-rows .group-box {
    display: flex; flex-direction: column; padding: 4px 6px 6px; border-radius: 8px;
    border: 1px solid var(--group-line); background: var(--group-bg);
  }
  #pick-rows .group-box .row { background: var(--card-bg); border-color: var(--card-line); }
  #pick-rows .group-box .row:hover, #pick-rows .group-box .row.cur { background: var(--card-over); }
  #pick-rows .group-box > .group { color: color-mix(in srgb, var(--accent) 70%, var(--ink)); }
  #pick-rows .group-box > .group { border-bottom: 0; padding: 2px 2px 5px; margin: 0; }
  #pick-rows .group-box .inside { display: grid; grid-template-columns: repeat(var(--across), 11rem); gap: 8px; }
  #pick-rows .group-box.empty { min-width: 8rem; }
  .group-box .group.ungrouped { opacity: 0.7; }
  .group-box .none { margin: auto; padding: 8px; font-size: 12px; font-style: italic; color: var(--muted); }
  #pick-rows.flow:not([hidden]) { display: flex; flex-direction: row; gap: 10px; align-items: flex-start; }
  #pick-rows.flow > .column { width: 18rem; display: flex; flex-direction: column; gap: 2px; }
  #pick-rows .group {
    font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted);
    padding: 8px 6px 3px; border-bottom: 1px solid color-mix(in srgb, var(--rule) 60%, transparent); margin-bottom: 2px;
  }
  #pick-rows .group:first-child { padding-top: 2px; }
  #pick-rows.flow .text, #pick-rows.columns .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  #pick-rows .name, #pick-rows.columns .title, #pick-rows.flow .title { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  header:has(.tools.keyed) .menu.pick kbd.tag { display: inline; }
  header:has(.tools.keyed) .menu.pick { outline: 2px solid var(--sel); outline-offset: 4px; border-radius: 6px; }
  #overview .card { position: relative; }
  #overview.keyed .card kbd.tag { display: inline; top: -8px; right: -7px; font-size: 13px; padding: 1px 6px; }
  #overview { flex: 1; overflow: auto; padding: 20px; }
  /* On the overview the picture and its panel give way to the cards; the
     source, when a served page shows it, is the spec, beside them. */
  main.on-overview > #picture, main.on-overview > #side { display: none; }
  #overview .problems { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  #overview .problems li { padding: 6px 10px; border-radius: 6px; border-left: 3px solid var(--down); background: color-mix(in srgb, var(--down) 10%, transparent); }
  #overview .problems .where { color: var(--muted); margin-right: 6px; }
  #overview .problems .where.goto { cursor: pointer; text-decoration: underline; }
  #overview .card .why { font-size: 12px; color: var(--down); white-space: pre-wrap; }
  #overview .card:disabled { opacity: 0.6; cursor: default; }
  #overview .card .dirty, #pick-rows .dirty { color: var(--sel); margin-left: 4px; }
  #overview .group-boxes { display: flex; flex-wrap: wrap; align-items: stretch; gap: 16px; }
  #overview .group-box {
    flex: 0 0 auto; max-width: 100%; display: flex; flex-direction: column; gap: 10px; padding: 12px 14px 14px;
    border: 1px solid var(--group-line); border-radius: 12px; background: var(--group-bg);
  }
  #overview .group-box .card { background: var(--card-bg); border-color: var(--card-line); }
  #overview .group-box .card:hover { background: var(--card-over); }
  #overview h2.group { color: color-mix(in srgb, var(--accent) 70%, var(--ink)); }
  #overview .group-box.empty { min-width: 12rem; }
  #overview h2.group { font-size: 15px; font-weight: 600; margin: 0; }
  /* As many cards across as the overview holds, set by fitGroups(). */
  #overview .group-box .inside { display: grid; grid-template-columns: repeat(var(--across, 1), min(300px, calc(100vw - 100px))); gap: 16px; }
  #overview .group-box .card { min-width: 0; }
  #overview .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 16px; }
  #overview .card {
    display: flex; flex-direction: column; gap: 4px; text-align: left; white-space: normal; padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); border-radius: 10px; background: transparent;
  }
  #overview .card:hover { border-color: var(--accent); background: color-mix(in srgb, var(--ink) 5%, transparent); }
  #overview .card .label { font-size: 15px; font-weight: 600; }
  #overview .card .title { font-size: 12px; color: var(--muted); }
  #overview .card .key { font-size: 11px; color: var(--muted); margin-left: auto; }
  #overview .card .top { display: flex; align-items: baseline; gap: 8px; }
  #overview .thumb { height: 200px; margin-top: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 6px; }
  /* Scaled to fill its card either way, keeping its shape: a wide diagram isn't left a sliver. */
  #overview .thumb svg { width: 100%; height: 100%; }
  /* A grid: the columns' labels across the top, the rows' down the left, the
     axis names in the corner, and each cell a drawing with no label of its
     own. A cell with no diagram is a dashed outline. The same table is the
     drop-down, the open diagram's row and column tinted. */
  .grid-table:not([hidden]) { display: grid; grid-template-columns: auto repeat(var(--across), var(--cell)); gap: var(--gap); align-items: stretch; justify-content: start; }
  #overview .grid-table { --cell: minmax(140px, 260px); --gap: 12px; }
  .grid-table .corner { white-space: nowrap; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); padding: 0 10px 6px 0; }
  .grid-table .column-head { align-self: end; text-align: center; font-weight: 600; color: color-mix(in srgb, var(--accent) 70%, var(--ink)); padding: 0 4px 6px; border-bottom: 1px solid var(--group-line); }
  .grid-table .row-head { display: flex; align-items: center; justify-content: flex-end; text-align: right; font-weight: 600; color: color-mix(in srgb, var(--accent) 70%, var(--ink)); padding: 0 12px 0 0; border-right: 1px solid var(--group-line); }
  #overview .grid-table .column-head, #overview .grid-table .row-head { font-size: 14px; }
  .grid-table .empty-cell { border: 1px dashed color-mix(in srgb, var(--rule) 80%, transparent); border-radius: 8px; min-height: 2rem; }
  #overview .grid-table .card { background: var(--card-bg); border-color: var(--card-line); padding: 8px; }
  #overview .grid-table .card:hover { background: var(--card-over); border-color: var(--accent); }
  #overview .grid-table .thumb { height: 150px; margin-top: 0; }
  #overview .grid-table .empty-cell { min-height: 150px; }
  #pick-rows.gridded:not([hidden]) { --cell: 9rem; --gap: 6px; width: max-content; max-width: calc(100vw - 32px); }
  #pick-rows.gridded.plain:not([hidden]) { --cell: minmax(2.2rem, 6rem); }
  #pick-rows.gridded .column-head, #pick-rows.gridded .row-head { font-size: 12px; }
  #pick-rows.gridded .row {
    flex-direction: column; align-items: stretch; justify-content: center; gap: 0; padding: 7px; position: relative;
    background: var(--card-bg); border: 1px solid var(--card-line); border-radius: 6px;
  }
  #pick-rows.gridded .row:hover, #pick-rows.gridded .row.cur { background: var(--card-over); }
  #pick-rows.gridded .row.tint, #pick-rows.gridded .empty-cell.tint { background: color-mix(in srgb, var(--accent) 30%, var(--card-bg)); }
  #pick-rows.gridded .row.tint.cur, #pick-rows.gridded .row.tint:hover { background: color-mix(in srgb, var(--accent) 40%, var(--card-bg)); }
  #pick-rows.gridded .row-head.tint, #pick-rows.gridded .column-head.tint { color: var(--ink); }
  #pick-rows.gridded .row[aria-checked="true"] { border-color: var(--sel); box-shadow: inset 0 0 0 1px var(--sel); }
  #pick-rows.gridded .thumb { height: 4.5rem; }
  #pick-rows.gridded.plain .row { min-height: 2.2rem; }
  #pick-rows.gridded .line { position: absolute; top: 2px; right: 3px; width: auto; }
  #pick-rows.gridded .mark, #pick-rows.gridded .name { display: none; }
  .links { display: inline-flex; vertical-align: middle; margin-left: 10px; }
  .links a { display: inline-flex; color: var(--muted); padding: 2px; border-radius: 4px; }
  .links a:hover { color: var(--ink); }
  .links a:focus-visible { outline: 2px solid var(--accent); }
  /* A link as a row of a menu, like the buttons around it. */
  .menu-list a.row { color: var(--ink); text-decoration: none; font-size: 13px; border: 1px solid transparent; border-radius: 6px; }
  .menu-list a.row:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); }
  .drawn:empty { display: none; }
  /* The divider between the source and the picture: dragged, or moved with the arrows. */
  #split { flex: none; width: 6px; margin: 0 -3px; z-index: 2; cursor: col-resize; touch-action: none; }
  #split[hidden] { display: none; }
  #split:hover, #split.dragging, #split:focus-visible { background: color-mix(in srgb, var(--accent) 45%, transparent); outline: 0; }
  body.dragging { cursor: col-resize; user-select: none; }
  /* The cheatsheet: a row of the Help menu opens a large window, a
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
  .cs-note a { color: var(--accent); }
  .cs-none { margin: 0; padding: 24px 16px; color: var(--muted); }
  .cs-none[hidden] { display: none; }
  /* The keyboard shortcuts: the cheatsheet's cards, for the page's keys. */
  #keys-sheet { width: min(820px, calc(100vw - 32px)); max-width: none; max-height: calc(100vh - 32px); }
  #keys-sheet[open] { display: flex; flex-direction: column; }
  #keys-sheet .ks-grid { min-height: 0; overflow: auto; padding: 14px 16px 4px; columns: 300px 2; column-gap: 14px; }
  #keys-sheet .cs-card { break-inside: avoid; margin-bottom: 14px; }
  #keys-sheet .cs-row { grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); }
  #keys-sheet .cs-row > div kbd { color: var(--ink); margin-right: 3px; }
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
`;
