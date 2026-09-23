import type {
  Part,
  PartSide,
  Attrs,
  Axis,
  Side,
  Kind,
  OffsetPlacement,
  OnPlacement,
  Placement,
  Document,
  Stmt,
} from './ast.js';
import {
  ALL_ATTR_KEYS,
  ATTR_KEYS,
  PART_SIDES,
  COLOR_KEYS,
  COLOR_PARTS,
  CONTENT_ALIGNMENTS,
  CONTENT_WIDTHS,
  describePlacement,
  nameTarget,
} from './ast.js';
import {
  ARROW_LENGTH,
  CHILD_GAP,
  DECK_STEP,
  DEFAULT_FONT_SIZE,
  DEFAULT_MARGIN,
  GAPS,
  HEADER_GAP,
  ICON_GAP,
  ICON_LINES,
  TEXT_CLEARANCE,
  PAD,
  SEPARATION_GAP,
  fontSizeFor,
  leafTop,
  textExtent,
  textStyleFor,
  widestLine,
} from './constants.js';
import { fix, reachability, tightest, type Constraint, type Contradiction } from './constrain.js';
import { SourceError } from './errors.js';
import { type Body, bodyFor } from './icons.js';
import { monospaceMeasurer, type Measurer } from './measure.js';
import { markupStyles, parseMarkup, plain, splitRuns, wrapLine, type Line } from './text.js';
import type { Layout, LayoutEdge, LayoutNode, LayoutPassage, Reach } from './model.js';

export interface ResolveOptions {
  measurer?: Measurer;
  fontSize?: number;
  /** Blank space kept around the whole diagram. */
  margin?: number;
}

/**
 * Turn a parsed document into solved geometry.
 *
 * Three passes: build the containment tree, size every node bottom-up, then
 * turn each node's placements into minimum distances and solve for the tightest
 * arrangement that satisfies them. That last pass also adds the separations
 * that keep boxes off each other, and solves again until none is left to add.
 *
 * It is a constraint solve, of the kind that computes rather than searches. It
 * works out how far apart things are; nothing about which side of what a node
 * sits on is ever decided here, because the author wrote it down.
 */
export function resolve(doc: Document, options: ResolveOptions = {}): Layout {
  const measurer = options.measurer ?? monospaceMeasurer();
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const margin = options.margin ?? DEFAULT_MARGIN;

  const styles = collectStyles(doc.statements);
  checkStyleKeys(doc.statements);
  const { nodes, byName, roots } = buildTree(doc.statements, styles);
  applyDecks(doc.statements, byName);

  // Edges are resolved to nodes before anything is sized, because a labeled
  // edge claims room in the gap it crosses and so has to be in hand while the
  // gaps are being worked out. Nothing here reads geometry.
  const edges = buildEdges(doc.statements, byName, styles);

  const local = new Map<LayoutNode, { x: number; y: number }>();
  for (const root of roots) sizeNode(root, edges, measurer, fontSize, local);

  placeRoots(roots, byName, edges, measurer, fontSize, local);
  normalize(nodes, margin);

  const extent = bounds(nodes);

  return {
    nodes,
    roots,
    edges,
    markup: markupColors(nodes, edges, styles),
    diagram: collectDiagram(doc.statements),
    width: Math.ceil(extent.maxX + margin),
    height: Math.ceil(extent.maxY + margin),
    margin,
  };
}

// --- pass one: the containment tree -----------------------------------------

function collectStyles(statements: Stmt[]): Map<string, Attrs> {
  const styles = new Map<string, Attrs>();
  for (const stmt of statements) {
    if (stmt.kind !== 'style') continue;
    if (styles.has(stmt.name)) {
      throw new SourceError(`style "${stmt.name}" is declared twice`, stmt.line);
    }
    styles.set(stmt.name, stmt.attrs);
  }
  return styles;
}

/** A file holds one diagram, so a second `diagram` statement is a mistake. */
function collectDiagram(statements: Stmt[]): Attrs {
  let found: Attrs | undefined;
  for (const stmt of statements) {
    if (stmt.kind !== 'diagram') continue;
    if (found) throw new SourceError('the diagram is described twice', stmt.line);
    found = stmt.attrs;
  }
  return found ?? {};
}

function buildTree(statements: Stmt[], styles: Map<string, Attrs>) {
  const nodes: LayoutNode[] = [];
  const byName = new Map<string, LayoutNode>();
  const roots: LayoutNode[] = [];
  /** Each badge child's name, and the node whose `badge:` it was written out from. */
  const badges = new Map<string, string>();

  for (const stmt of statements) {
    if (stmt.kind !== 'node') continue;

    if (byName.has(stmt.name)) {
      const owner = badges.get(stmt.name);
      if (owner !== undefined) {
        throw new SourceError(
          `"${stmt.name}" is the child that "${owner}"'s badge: is written out as. Drop badge: from ` +
            `"${owner}" and write the icon here yourself, or give this node another name`,
          stmt.line,
        );
      }
      throw new SourceError(`"${stmt.name}" is declared twice`, stmt.line);
    }

    const appearance = appearanceOf(stmt.attrs, styles, stmt.line);
    const body = bodyFor(stmt.attrs, appearance, stmt.line);
    const kind = KIND_OF_BODY[body.kind];
    // A node with no text of its own is labelled with its name, because the
    // first lines anybody types are `node a` and `node b right of a` and they
    // mean the boxes to read "a" and "b". A node drawn as a *picture* is the
    // exception: a picture usually is the statement, and the default would
    // caption a row of cubes a, b, db1, c, db2. `""` then says what writing
    // nothing says, which is only true here — on a box it carries information.
    const text = body.kind === 'icon' && !stmt.statedText ? '' : stmt.text;
    // A style has no string of its own, so it says what it has to say about a
    // text through `text: (…)`, which arrives here under dotted keys. What the
    // node wrote in its own brackets wins, key by key, exactly as its own
    // attributes win over the style's.
    const textAttrs = { ...bracketOf('text', appearance), ...stmt.textAttrs };

    const node: LayoutNode = {
      name: stmt.name,
      kind,
      body,
      text,
      lines: linesFor(text, textAttrs, `"${stmt.name}"`, stmt.line),
      children: [],
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      inset: 0,
      deckTexts: [],
      headerHeight: 0,
      reach: { left: 0, top: 0, right: 0, bottom: 0 },
      banded: false,
      textBox: { x: 0, y: 0, width: 0, height: 0 },
      textSide: 'left',
      textAttrs,
      attrs: stmt.attrs,
      appearance,
      placements: stmt.placements,
      line: stmt.line,
    };

    checkAttrs(kind, node.name, stmt.attrs, stmt.line);
    checkStyleUse(kind, node.name, stmt.attrs, styles, stmt.line);

    const cut = stmt.name.lastIndexOf('.');
    if (cut === -1) {
      roots.push(node);
    } else {
      const parentName = stmt.name.slice(0, cut);
      const parent = byName.get(parentName);
      if (!parent) {
        throw new SourceError(
          `"${stmt.name}" is inside "${parentName}", which is not declared yet`,
          stmt.line,
        );
      }
      node.parent = parent;
      parent.children.push(node);
    }

    nodes.push(node);
    byName.set(stmt.name, node);

    // `badge: X` is a shorthand, and this is its expansion:
    //   node <self>.badge  icon: X  right of <self> text (gap: 10)
    // set at the parent's text size, so the picture is two of the parent's
    // lines tall. Read from the merged appearance, so a style carrying a badge
    // gives one to every box wearing it. Only a box has a text to be beside;
    // the other kinds refuse the word in `checkAttrs`, and a style's is unused.
    const named = appearance['badge'];
    if (named !== undefined && body.kind === 'shape') {
      const badge = badgeChild(node, named);
      badges.set(badge.name, node.name);
      node.children.push(badge);
      nodes.push(badge);
      byName.set(badge.name, badge);
    }
  }

  return { nodes, byName, roots };
}

/** The child `badge:` writes out, as `buildTree` describes. */
function badgeChild(parent: LayoutNode, named: string): LayoutNode {
  const icon = { icon: named };
  const size = parent.textAttrs['size'];
  return {
    name: `${parent.name}.badge`,
    kind: 'icon',
    body: bodyFor(icon, icon, parent.line),
    text: '',
    lines: linesFor('', {}, `"${parent.name}.badge"`, parent.line),
    children: [],
    parent,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    inset: 0,
    deckTexts: [],
    headerHeight: 0,
    reach: { left: 0, top: 0, right: 0, bottom: 0 },
    banded: false,
    textBox: { x: 0, y: 0, width: 0, height: 0 },
    textSide: 'center',
    textAttrs: size === undefined ? {} : { size },
    attrs: icon,
    appearance: icon,
    placements: [
      {
        kind: 'offset',
        direction: 'right',
        targets: [{ name: parent.name, part: 'text' }],
        gap: String(ICON_GAP),
        line: parent.line,
      },
    ],
    line: parent.line,
  };
}

/**
 * "a node", "an edge". Only the kind words are ever passed here and only `edge`
 * begins with a vowel, but writing `a ${word}` produced "a edge" the day the
 * keyword changed, so the article follows the word rather than being assumed.
 */
function article(word: string): string {
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

/** The same phrase opening a sentence. */
function capital(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Which kind a body makes the node. */
const KIND_OF_BODY: Record<Body['kind'], Exclude<Kind, 'edge'>> = {
  shape: 'shape',
  icon: 'icon',
  none: 'none',
};

/** How each kind reads in an error, and what it is actually made of. */
const KIND_WORD: Record<Kind, string> = {
  shape: 'node',
  icon: 'node drawn as a picture',
  none: 'node with no body',
  edge: 'edge',
};
const KIND_PARTS: Record<Kind, string> = {
  shape: 'a fill, a border and text',
  icon: 'a picture and the text under it',
  none: 'text and nothing else',
  edge: 'a line and its text',
};

/**
 * An attribute is refused on a kind that has no use for it — the same rule as
 * an unknown `diagram` key, and for the same reason: a key that silently does
 * nothing looks like the tool being broken. A color names a part and so is a
 * special case of this, which is why the two checks are one.
 *
 * What is checked is what the author wrote *on this statement*, not what a
 * style contributed. A style is a bundle meant to be shared across kinds — the
 * benchmark's `synced` carries a fill and a border for the green boxes and a
 * line for the four edges joining them — so a key it carries that this kind has
 * no part for is simply unused, and is not a mistake anybody made here. That is
 * forced rather than chosen: checking the merged appearance would refuse the
 * benchmark's own central idiom four times over. `checkStyleUse` is what keeps
 * the permissiveness honest.
 */
function checkAttrs(kind: Kind, name: string, attrs: Attrs, line: number): void {
  const allowed = ATTR_KEYS[kind];
  // In the author's own order, so the error names the first offending word as
  // it is read rather than the first in some list of ours.
  for (const [written, value] of Object.entries(attrs)) {
    const key = topKey(written);
    if (allowed.includes(key)) continue;

    // Quoted back the way it was written. A bracketed value arrives one dotted
    // key at a time, and `contents: match` is not a line anybody could look for.
    const wrote =
      written === key ? `${key}: ${value}` : `${key}: (${written.slice(key.length + 1)}: ${value})`;

    if (!ALL_ATTR_KEYS.includes(key)) {
      // Nothing anywhere in the language answers to this word, so the only
      // remedy is the vocabulary itself.
      throw new SourceError(
        `"${name}" has ${wrote}, which is not an attribute. ${capital(article(KIND_WORD[kind]))} takes ${allowed.join(', ')}`,
        line,
      );
    }

    // A real word in the wrong place, and the two sorts of word want different
    // explanations. A color names a *part*, so saying what the kind is made of
    // is the whole reason it has no such color, and the remedy is the narrower
    // list of parts it does have: `line:` on a box is a different mistake from
    // `border:` on a note, and one hint cannot serve both.
    if ((COLOR_KEYS as readonly string[]).includes(key)) {
      const parts = COLOR_PARTS[kind].map((part) => `\`${part}\``).join(', ');
      throw new SourceError(
        `"${name}" is ${article(KIND_WORD[kind])} and has ${wrote}. ${capital(article(KIND_WORD[kind]))} is ${KIND_PARTS[kind]}, so it has no ${key} — it takes ${parts}`,
        line,
      );
    }

    // Anything else names no part, so what the kind is made of explains
    // nothing. What does explain it is where the word *does* belong, which is
    // also the more useful thing to be told: the author has usually written a
    // real statement about the wrong half of the diagram.
    throw new SourceError(
      `"${name}" is ${article(KIND_WORD[kind])} and has ${wrote}. \`${key}:\` belongs to ` +
        `${listKinds(belongTo(key))} — ${article(KIND_WORD[kind])} takes ${allowed.join(', ')}`,
      line,
    );
  }
}

/**
 * A style may carry keys this kind has no use for, but it may not carry *only*
 * those. Partial overlap is the normal case and the reason styles exist; zero
 * overlap is a style name written on the wrong sort of thing, and nothing else.
 *
 * This is the check that lets `checkAttrs` ignore style-contributed keys
 * without the silence coming back. It cannot catch a style that names every key
 * in the language, since such a style contributes to everything by
 * construction — that hole is left open, because nobody writes one by accident.
 */
function checkStyleUse(
  kind: Kind,
  name: string,
  attrs: Attrs,
  styles: Map<string, Attrs>,
  line: number,
): void {
  const named = attrs['style'];
  if (named === undefined) return;
  const base = styles.get(named);
  if (base === undefined) return; // `appearanceOf` reports the missing style.

  // A style naming another style is the one way to carry nothing at all: the
  // parser already refuses one with no attributes, and `appearanceOf` does not
  // recurse, so the name would sit there doing nothing.
  const carried = [...new Set(Object.keys(base).map(topKey))].filter((key) => key !== 'style');
  if (carried.length === 0) {
    throw new SourceError(`style "${named}" carries nothing but a style name`, line);
  }
  if (carried.some((key) => ATTR_KEYS[kind].includes(key))) return;

  throw new SourceError(
    `style "${named}" gives "${name}" nothing. It carries ${carried.join(' and ')}; ` +
      `${article(KIND_WORD[kind])} is ${KIND_PARTS[kind]}`,
    line,
  );
}

/**
 * A style is a bundle spanning kinds, so its keys cannot be checked against any
 * one of them — but a word that is an attribute of *nothing* is a misspelling
 * wherever it sits, and a style was the last place in the language where one
 * could hide.
 */
function checkStyleKeys(statements: Stmt[]): void {
  for (const stmt of statements) {
    if (stmt.kind !== 'style') continue;
    for (const [key, value] of Object.entries(stmt.attrs)) {
      if (ALL_ATTR_KEYS.includes(topKey(key))) continue;
      throw new SourceError(
        `style "${stmt.name}" has ${key}: ${value}, which is not an attribute. ` +
          `The attributes are ${ALL_ATTR_KEYS.join(', ')}`,
        stmt.line,
      );
    }
  }
}

/**
 * The attribute a key belongs to. A bracketed value arrives under dotted keys —
 * `text: (color: muted)` is stored as `text.color` — so that a style merges into
 * a node exactly the way every other attribute does; every check above asks
 * about the part, which is the half before the dot.
 */
function topKey(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

/** Which kinds understand an attribute, in the order the table declares them. */
function belongTo(key: string): Kind[] {
  return (Object.keys(ATTR_KEYS) as Kind[]).filter((kind) => ATTR_KEYS[kind].includes(key));
}

/** "an edge", "a node or a glyph body", "a node, a note or a glyph body". */
function listKinds(kinds: Kind[]): string {
  const words = kinds.map((kind) => article(KIND_WORD[kind]));
  if (words.length <= 1) return words[0] ?? 'nothing';
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

function appearanceOf(attrs: Attrs, styles: Map<string, Attrs>, line: number): Attrs {
  const named = attrs['style'];
  if (named === undefined) return { ...attrs };
  const base = styles.get(named);
  if (!base) throw new SourceError(`no style named "${named}"`, line);
  return { ...base, ...attrs };
}

function applyDecks(statements: Stmt[], byName: Map<string, LayoutNode>): void {
  for (const stmt of statements) {
    if (stmt.kind !== 'deck') continue;
    const node = byName.get(stmt.name);
    if (!node) throw new SourceError(`deck names "${stmt.name}", which does not exist`, stmt.line);
    node.deckTexts = stmt.texts;
  }
}

function buildEdges(
  statements: Stmt[],
  byName: Map<string, LayoutNode>,
  styles: Map<string, Attrs>,
): LayoutEdge[] {
  const edges: LayoutEdge[] = [];
  for (const stmt of statements) {
    if (stmt.kind !== 'edge') continue;
    const from = byName.get(stmt.from);
    const to = byName.get(stmt.to);
    if (!from) throw new SourceError(`edge from "${stmt.from}", which does not exist`, stmt.line);
    if (!to) throw new SourceError(`edge to "${stmt.to}", which does not exist`, stmt.line);
    const between: LayoutPassage | undefined = stmt.between && {
      nodes: stmt.between.targets.map(({ name, part }) => {
        if (part !== undefined) {
          // A passage is the gap between two boxes, and a side or a point has
          // no gap on either hand. Refused by name rather than dropped.
          throw new SourceError(
            `edge passes between "${name} ${part}", and a passage runs between two whole boxes ` +
              `— drop "${part}"`,
            stmt.line,
          );
        }
        const node = byName.get(name);
        if (!node) {
          throw new SourceError(`edge passes between "${name}", which does not exist`, stmt.line);
        }
        return node;
      }) as [LayoutNode, LayoutNode],
      ...(stmt.between.axis !== undefined ? { axis: stmt.between.axis } : {}),
    };
    const appearance = appearanceOf(stmt.attrs, styles, stmt.line);
    const what = `${stmt.from} -> ${stmt.to}`;
    checkAttrs('edge', what, stmt.attrs, stmt.line);
    checkStyleUse('edge', what, stmt.attrs, styles, stmt.line);
    if (stmt.attrs['url'] !== undefined && stmt.text === undefined) {
      // Wrapping the line works, and `LINE_WIDTH` is 1.5 — a destination that
      // technically has a target and practically has none. That is the silent
      // defect shape the language refuses everywhere else, so it is refused
      // here rather than shipped and explained.
      throw new SourceError(
        `edge ${what} has a url and no text. A destination needs something to click, and a line ` +
          'is too thin to be it — give the edge a text, or put the url on one of the nodes',
        stmt.line,
      );
    }
    const textAttrs = { ...bracketOf('text', appearance), ...stmt.textAttrs };
    edges.push({
      from,
      to,
      both: stmt.both,
      textAttrs,
      ...(stmt.text !== undefined
        ? { text: stmt.text, lines: linesFor(stmt.text, textAttrs, `edge ${what}`, stmt.line) }
        : {}),
      ...(between ? { between } : {}),
      attrs: stmt.attrs,
      appearance,
      line: stmt.line,
    });
  }
  return edges;
}

// --- pass two: sizes, bottom-up ---------------------------------------------

type Local = Map<LayoutNode, { x: number; y: number }>;

/**
 * Give a node a width and height, sizing its children first. Also records each
 * child's offset within this node, which pass three turns into absolute
 * coordinates once this node itself is placed.
 */
function sizeNode(
  node: LayoutNode,
  edges: LayoutEdge[],
  measurer: Measurer,
  fontSize: number,
  local: Local,
): void {
  for (const child of node.children) sizeNode(child, edges, measurer, fontSize, local);

  // Text is measured at the size it will be drawn at — the size lives in
  // `constants.ts` precisely so the resolver reserving the room and the
  // renderer filling it cannot disagree about how much room there is.
  const textSize = fontSizeFor(node.kind, node.textAttrs, fontSize, node.line);
  const lineHeight = measurer.lineHeight(textSize);
  // A node with empty text takes no room for it. This is what makes an
  // invisible grouping container size to exactly its contents.
  const hasText = node.lines.some((line) => plain(line).length > 0);
  const textWidth = hasText ? widestLine(node.lines, measurer, textSize) : 0;
  const textHeight = hasText ? node.lines.length * lineHeight : 0;

  const glyphSide = ICON_LINES * lineHeight;

  if (node.body.kind === 'none') {
    // No body, so the node is its text: no padding, no outline, no children.
    if (node.children.length > 0) {
      throw new SourceError(
        `"${node.name}" has shape: none and has children. With no body there is no box for ` +
          'anything to go inside',
        node.line,
      );
    }
    node.width = textWidth;
    node.height = textHeight;
    node.textBox = textBoxIn(
      { x: 0, y: 0, width: node.width, height: node.height },
      (node.textSide = textStyleFor(node.textAttrs, node.line, 'start', 'center').side),
      textWidth,
      textHeight,
    );
    return;
  }

  if (node.body.kind === 'icon') {
    // Drawn as a picture, so there is no box to pad and the node's size is the
    // picture's. A text goes under it rather than inside it, which is the
    // arrangement that makes a row of these read as captioned things.
    if (node.children.length > 0) {
      throw new SourceError(
        `"${node.name}" is drawn as a picture and has children. A picture is not a box, so nothing can go inside it`,
        node.line,
      );
    }
    node.width = Math.max(glyphSide, textWidth);
    node.height = glyphSide + (hasText ? ICON_GAP + textHeight : 0);
    // The caption is under the picture and nowhere else, so only the
    // horizontal half of `at` reaches it.
    node.textBox = textBoxIn(
      { x: 0, y: glyphSide + ICON_GAP, width: node.width, height: textHeight },
      (node.textSide = textStyleFor(node.textAttrs, node.line, 'middle', 'center').side),
      textWidth,
      textHeight,
    );
    return;
  }

  // Read before the split, so a misspelt word is refused on a childless node
  // too. The *absence* of children makes the setting inert, which stays silent;
  // a value the language does not have is wrong wherever it is written.
  const contents = contentsStyleFor(node);

  if (node.children.length === 0) {
    // `at` is read on a leaf too, and is inert wherever the box is exactly the
    // size of what it holds — which is every leaf, since a leaf is sized from
    // its own text. It bites once the box is sized by something else: a
    // `widths:` that widens it, or a child placed beside the text. Inert-but-
    // legal stays silent here, the same treatment `align` gets on a leaf with
    // one line.
    const style = textStyleFor(node.textAttrs, node.line, 'middle', 'center');
    node.width = textWidth + PAD * 2;
    node.height = textHeight + PAD * 2;
    node.textBox = textBoxIn(
      {
        x: PAD,
        y: leafTop(style.end, 0, node.height, textHeight),
        width: node.width - PAD * 2,
        height: textHeight,
      },
      (node.textSide = style.side),
      textWidth,
      textHeight,
    );
  } else if (framedChildren(node).size > 0) {
    // Something is placed against this node's own frame or text, so where its
    // text sits and how big it is come out of one solve with its children.
    const own: OwnText = { textWidth, textHeight, contents };
    const lay = (width: number): void => {
      layoutFramed(node, own, edges, measurer, fontSize, local, width - node.deckTexts.length * DECK_STEP);
      applyDeck(node, local);
    };
    lay(0);
    relayout.set(node, lay);
    return;
  } else {
    if (contents.widths === 'match') matchWidths(node.children);
    let content = layoutChildren(node.children, edges, measurer, fontSize, local);
    if (contents.widths === 'fill') {
      // The band is the wider of the title and the contents, so filling it
      // needs the contents measured first. Where they already set the width
      // this is `match` exactly; where the title wins it is the answer `match`
      // could not give.
      const band = Math.max(textWidth, content.width);
      for (const child of node.children) widenTo(child, band);
      content = layoutChildren(node.children, edges, measurer, fontSize, local);
    }
    // `headerHeight` is the band the text takes, whichever end of the box that
    // band is at. Only the contents' offset depends on the side.
    node.headerHeight = hasText ? textHeight + HEADER_GAP : 0;
    node.width = Math.max(textWidth, content.width) + PAD * 2;
    node.height = node.headerHeight + content.height + PAD * 2;

    const style = textStyleFor(node.textAttrs, node.line);
    if (style.end === 'center') throw bandInMiddle(node, style.at);
    const above = style.end === 'top' ? node.headerHeight : 0;
    // The text has a band at one end of the box, and the contents have the
    // other.
    node.textBox = textBoxIn(
      {
        x: PAD,
        y: style.end === 'top' ? PAD : node.height - PAD - textHeight,
        width: node.width - PAD * 2,
        height: textHeight,
      },
      (node.textSide = style.side),
      textWidth,
      textHeight,
    );
    // Where the title is wider than the contents, the slack is all on the right
    // — every member sits at the smallest position its constraints allow and
    // nothing pushes it along. `align` is what says where the block goes in it.
    const slack = node.width - PAD * 2 - content.width;
    const shift = contents.align === 'left' ? 0 : contents.align === 'center' ? slack / 2 : slack;
    for (const child of node.children) {
      const offset = local.get(child)!;
      offset.x += PAD + shift;
      offset.y += PAD + above;
    }
    node.banded = true;
  }

  applyDeck(node, local);
}

/**
 * Make room for a deck's copies, once the node's own face has been sized.
 *
 * The copies sit behind and above-left, so the whole node grows by the depth
 * of the stack and its own face moves down and right by the same.
 */
function applyDeck(node: LayoutNode, local: Local): void {
  if (node.deckTexts.length > 0) {
    node.inset = node.deckTexts.length * DECK_STEP;
    node.width += node.inset;
    node.height += node.inset;
    node.textBox.x += node.inset;
    node.textBox.y += node.inset;
    for (const child of node.children) {
      const offset = local.get(child)!;
      offset.x += node.inset;
      offset.y += node.inset;
    }
  }
}

/**
 * Where a block of text ends up in the room it was given: the *ink* box, which
 * is what `hub text` names as a placement target and what the renderer draws.
 *
 * Only the horizontal is decided here. The vertical is settled by whoever
 * knows which end of the box the text sits at, which differs between a leaf, a
 * container's band and a caption under a picture, and arrives as `room.y`.
 */
function textBoxIn(
  room: { x: number; y: number; width: number; height: number },
  side: 'left' | 'center' | 'right',
  inkWidth: number,
  inkHeight: number,
): { x: number; y: number; width: number; height: number } {
  const x =
    side === 'left'
      ? room.x
      : side === 'right'
        ? room.x + room.width - inkWidth
        : room.x + (room.width - inkWidth) / 2;
  return { x, y: room.y, width: inkWidth, height: inkHeight };
}

/**
 * What `contents: (…)` said, with its two words checked. Read from the merged
 * appearance rather than from what the node wrote, so a style may carry it —
 * `align: widths` read only the node's own attributes, which made a style
 * carrying it do nothing at all and say nothing about it.
 */
interface ContentsStyle {
  widths: 'natural' | 'match' | 'fill';
  align: 'left' | 'center' | 'right';
}

function contentsStyleFor(node: LayoutNode): ContentsStyle {
  const written = bracketOf('contents', node.appearance);
  const widths = written['widths'] ?? 'natural';
  const align = written['align'] ?? 'left';
  if (!(CONTENT_WIDTHS as readonly string[]).includes(widths)) {
    throw new SourceError(
      `"${node.name}" has contents: (widths: ${widths}), which is not one of ${CONTENT_WIDTHS.join(', ')}`,
      node.line,
    );
  }
  if (!(CONTENT_ALIGNMENTS as readonly string[]).includes(align)) {
    throw new SourceError(
      `"${node.name}" has contents: (align: ${align}), which is not one of ${CONTENT_ALIGNMENTS.join(', ')}`,
      node.line,
    );
  }
  return { widths, align } as ContentsStyle;
}

/**
 * `widths: match` widens every direct child to the widest one's natural width,
 * before layoutChildren sizes and positions anything from those widths. A
 * container's own children are already sized by this point.
 */
function matchWidths(children: LayoutNode[]): void {
  const maxWidth = Math.max(...children.map((child) => child.width));
  for (const child of children) widenTo(child, maxWidth);
}

/**
 * Make a node wider than it was sized, carrying its text with it.
 *
 * `widths: match` and `widths: fill` both set a child's width after that child
 * was sized from its own contents, and the text's box was worked out against
 * the old one. A left-ranged text stays where it is; a centered or right-ranged
 * one moves by its share of the difference.
 */
function widenTo(node: LayoutNode, width: number): void {
  // A node with something placed against its own frame is laid out by a
  // solve, and a wider frame is one more thing that solve has to hold: the
  // things against its right edge move, and a centered text re-centers.
  const again = relayout.get(node);
  if (again) {
    again(width);
    return;
  }
  const grew = width - node.width;
  node.width = width;
  if (node.textSide === 'center') node.textBox.x += grew / 2;
  else if (node.textSide === 'right') node.textBox.x += grew;
}

/**
 * Position a container's children relative to each other. Children that make
 * no placement stack vertically in written order; the rest are solved against the
 * siblings they name, by the same constraint pass that positions top-level
 * nodes. A placement may only name a sibling — containment scopes the group.
 */
function layoutChildren(
  children: LayoutNode[],
  edges: LayoutEdge[],
  measurer: Measurer,
  fontSize: number,
  local: Local,
): { width: number; height: number } {
  const siblings = new Map(children.map((child) => [child.name, child]));

  // Children that say nothing keep the written order, down the page and flush
  // left. Written as constraints rather than a cursor so a placed sibling can
  // push them along like anything else.
  const stack: Constraint[] = [];
  const alignment: Constraint[] = [];
  const quiet = children.filter((child) => child.placements.length === 0);
  const indexOf = new Map(children.map((child, index) => [child, index]));
  quiet.forEach((child, position) => {
    const previous = quiet[position - 1];
    if (!previous) return;
    const before = indexOf.get(previous)!;
    const after = indexOf.get(child)!;
    stack.push({ from: before, to: after, weight: previous.height + CHILD_GAP });
    alignment.push(...fix(before, after, 0));
  });

  const positions = positionGroup(
    children,
    (placement, owner) =>
      placement.targets.map(({ name, part }) => {
        const target = siblings.get(name);
        if (!target) {
          throw new SourceError(
            `"${owner.name}" is placed against "${name}", which is not one of its siblings or its parent`,
            placement.line,
          );
        }
        return partOf(
          {
            name,
            node: target,
            index: indexOf.get(target)!,
            offset: { x: 0, y: 0 },
            width: target.width,
            height: target.height,
          },
          part,
          owner,
          placement.line,
        );
      }),
    { x: alignment, y: stack },
    corridorsIn(edges, (node) => liftTo(node, indexOf, local), measurer, fontSize),
  );

  for (const child of children) local.set(child, positions.get(child)!);
  return extentOf(children, local);
}

function extentOf(children: LayoutNode[], local: Local): { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // What a child has placed outside itself is still part of it, so the block
  // holding the child holds that too.
  for (const child of children) {
    const offset = local.get(child)!;
    const { reach } = child;
    minX = Math.min(minX, offset.x - reach.left);
    minY = Math.min(minY, offset.y - reach.top);
    maxX = Math.max(maxX, offset.x + child.width + reach.right);
    maxY = Math.max(maxY, offset.y + child.height + reach.bottom);
  }

  for (const child of children) {
    const offset = local.get(child)!;
    offset.x -= minX;
    offset.y -= minY;
  }

  return { width: maxX - minX, height: maxY - minY };
}

/** What a node's own text takes, measured once by `sizeNode`. */
interface OwnText {
  textWidth: number;
  textHeight: number;
  contents: ContentsStyle;
}

/** How to lay a framed node out again at a given width, which is what `widenTo` needs. */
const relayout = new WeakMap<LayoutNode, (width: number) => void>();

/**
 * The children placed against their parent — its frame, a part of it, or its
 * text — together with any child placed against one of those, and so on.
 *
 * These hang off the frame. The rest hang off the default position under the
 * text, which is the contents stack as it always was. Nothing sorts a child
 * into one or the other; it is read off what each placement names.
 */
function framedChildren(parent: LayoutNode): Set<LayoutNode> {
  const framed = new Set<LayoutNode>();
  const byName = new Map(parent.children.map((child) => [child.name, child]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const child of parent.children) {
      if (framed.has(child)) continue;
      const names = child.placements.flatMap((placement) => placement.targets.map((target) => target.name));
      const hangs = names.some((name) => {
        if (name === parent.name) return true;
        const sibling = byName.get(name);
        return sibling !== undefined && framed.has(sibling);
      });
      if (hangs) {
        framed.add(child);
        grew = true;
      }
    }
  }
  return framed;
}

/**
 * The sides of its parent's frame a child is not held inside by the padding.
 *
 * Every child is held a padding in from the frame on all four sides, which is
 * how a box grows to hold what is in it. A child placed against a side is
 * held by that placement instead — tucked a gap in with `inside`, straddling
 * it with `on`, beyond it with `outside` — and holding it by the padding as
 * well would contradict the placement whenever the gap is the smaller.
 *
 * `overlap: allow` on a child is "do not grow for me": it lies over whatever
 * is there, and the frame is not held open around it at all.
 */
function freeSides(child: LayoutNode, parent: LayoutNode): Set<PartSide> {
  if (allowsOverlap(child)) return new Set(PART_SIDES);
  const free = new Set<PartSide>();
  const across = (direction: string): PartSide[] => [
    ...(/left|right/.test(direction) ? (['left', 'right'] as const) : []),
    ...(/above|below/.test(direction) ? (['top', 'bottom'] as const) : []),
  ];
  for (const placement of child.placements) {
    for (const target of placement.targets) {
      if (target.name !== parent.name || target.part === 'text') continue;
      if (placement.kind === 'offset' && placement.written !== 'inside') {
        // Beyond the frame, so it neither holds the frame open nor is held in
        // by it — on either axis. Held on the other one, a note taller than
        // its parent's text would stretch the parent to fit a thing outside it.
        for (const side of PART_SIDES) free.add(side);
        continue;
      }
      const words = (target.part ?? '').split('-');
      for (const side of PART_SIDES) if (words.includes(side)) free.add(side);
      if (placement.kind === 'align' && placement.side !== 'center') free.add(placement.side as PartSide);
    }
  }
  return free;
}

/**
 * The parent's frame as a target, narrowed to the part that was named.
 *
 * The frame is two members of the child system, its top-left corner and its
 * bottom-right, so a part of it is read off those two per axis: `right` is
 * across at the bottom-right corner and spans both down, `top-center` spans
 * both across and is down at the top-left. A part that spans comes as its two
 * ends, and a placement against two targets already means the region that
 * bounds them.
 */
function frameTargets(parent: LayoutNode, part: Part | undefined, first: number, last: number): Target[] {
  const words = (part ?? '').split('-');
  const pick = (near: string, far: string): number[] =>
    words.includes(near) ? [first] : words.includes(far) ? [last] : [first, last];
  const xs = pick('left', 'right');
  const ys = pick('top', 'bottom');
  const name = part === undefined ? parent.name : `${parent.name} ${part}`;
  const point = (x: number, y: number): Target => ({
    name,
    node: parent,
    index: x,
    byAxis: { x, y },
    frame: true,
    offset: { x: 0, y: 0 },
    width: 0,
    height: 0,
  });
  const start = point(xs[0]!, ys[0]!);
  const end = point(xs[xs.length - 1]!, ys[ys.length - 1]!);
  return xs.length === 1 && ys.length === 1 ? [start] : [start, end];
}

/**
 * A stand-in member for something of the parent's own that takes room among
 * its children: its text, its badge, the block of its contents, a corner of
 * its frame. Named after the parent so an error about it reads in the
 * author's words — `"hub text" and "star" overlap`.
 */
function stand(of: LayoutNode, what: string, width: number, height: number): LayoutNode {
  return {
    ...of,
    name: `${of.name} ${what}`,
    parent: undefined,
    children: [],
    placements: [],
    attrs: {},
    appearance: {},
    deckTexts: [],
    reach: NO_REACH,
    x: 0,
    y: 0,
    width,
    height,
  };
}

function bandInMiddle(node: LayoutNode, at: string): SourceError {
  // A container's band is at one end precisely so its contents can have the
  // other, so the three positions that name neither end have nothing to mean
  // here. Refused rather than rounded to an end, for the reason every other
  // word in the language is: a value that quietly becomes a different value
  // looks like the tool being broken.
  return new SourceError(
    `"${node.name}" holds things and its text is at: ${at}. A container's text sits at ` +
      'the top or the bottom so its contents can have the other end, so name a position on ' +
      'one of those edges',
    node.line,
  );
}

/**
 * Lay out a node that has something placed against its own frame or text.
 *
 * One solve holds everything: the children placed against the frame, the
 * block of ordinary contents solved as it always was, the node's text and
 * badge, and the frame's two corners. Every one of them is held a padding in
 * from the frame, so the frame is the smallest box that holds them all, which
 * is what a node's size has always been. A part of the frame is then just a
 * target like any other.
 *
 * The band falls out rather than being decided. It exists because the
 * contents stack below the text; where every child hangs off the frame
 * instead, nothing is below the text, there is no band, and the node reads as
 * a leaf — its text centered, and whatever is beside the text centered with
 * it as one group.
 */
function layoutFramed(
  node: LayoutNode,
  own: OwnText,
  edges: LayoutEdge[],
  measurer: Measurer,
  fontSize: number,
  local: Local,
  minWidth: number,
): void {
  const { textWidth, textHeight, contents } = own;
  const hasText = textWidth > 0;
  const framed = framedChildren(node);
  const stacked = node.children.filter((child) => !framed.has(child));
  const placed = node.children.filter((child) => framed.has(child));
  const banded = stacked.length > 0;
  const style = banded
    ? textStyleFor(node.textAttrs, node.line)
    : textStyleFor(node.textAttrs, node.line, 'middle', 'center');
  if (banded && style.end === 'center') throw bandInMiddle(node, style.at);
  // The children placed against this node's text. With it they make the
  // text's row: the contents stack past all of them, and they range and
  // center with the text as one group.
  const againstText = (placement: Placement) =>
    placement.targets.some((target) => target.name === node.name && target.part === 'text');
  const withText = placed.filter((child) => child.placements.some(againstText));

  let block = { width: 0, height: 0 };
  if (banded) {
    if (contents.widths === 'match') matchWidths(stacked);
    block = layoutChildren(stacked, edges, measurer, fontSize, local);
    if (contents.widths === 'fill') {
      // The row is the text and whatever stands beside it, each at its gap.
      let row = textWidth;
      for (const child of withText) {
        const beside = child.placements.find(
          (placement): placement is OffsetPlacement =>
            placement.kind === 'offset' && /left|right/.test(placement.direction) && againstText(placement),
        );
        if (beside) row += child.width + (hasText ? gapFor(child, beside, node) : 0);
      }
      const across = Math.max(row, block.width);
      for (const child of stacked) widenTo(child, across);
      block = layoutChildren(stacked, edges, measurer, fontSize, local);
    }
  }

  const members: LayoutNode[] = [...placed];
  const add = (member: LayoutNode): number => members.push(member) - 1;
  const K = banded ? add(stand(node, 'contents', block.width, block.height)) : -1;
  // An empty text is still somewhere, so a thing placed against it has a
  // place to be: it is a point where the text would have been, and it takes
  // no room — including the gap beside it, which `Target.empty` drops.
  const T = hasText || withText.length > 0 ? add(stand(node, 'text', textWidth, textHeight)) : -1;
  const TL = add(stand(node, 'frame', 0, 0));
  const BR = add(stand(node, 'frame', 0, 0));

  const x: Constraint[] = [];
  const y: Constraint[] = [];
  const hold = (index: number, free: Set<PartSide>): void => {
    const { width, height, reach } = members[index]!;
    if (!free.has('left')) x.push({ from: TL, to: index, weight: PAD + reach.left });
    if (!free.has('right')) x.push({ from: index, to: BR, weight: width + reach.right + PAD });
    if (!free.has('top')) y.push({ from: TL, to: index, weight: PAD + reach.top });
    if (!free.has('bottom')) y.push({ from: index, to: BR, weight: height + reach.bottom + PAD });
  };
  placed.forEach((child, index) => hold(index, freeSides(child, node)));
  for (const index of [K, T]) if (index >= 0) hold(index, new Set());
  if (minWidth > 0) x.push({ from: TL, to: BR, weight: minWidth });

  // The text's row, as members: the text and everything placed against it.
  const row = [...(T >= 0 ? [T] : []), ...withText.map((child) => placed.indexOf(child))];
  if (banded) {
    // The text's row is at one end, the contents the other.
    for (const index of row) {
      const { height, reach } = members[index]!;
      if (style.end === 'top') y.push({ from: index, to: K, weight: height + reach.bottom + HEADER_GAP });
      else y.push({ from: K, to: index, weight: block.height + HEADER_GAP + reach.top });
    }
  }

  const siblings = new Map(node.children.map((child) => [child.name, child]));
  const indexOf = new Map(members.map((member, index) => [member, index]));
  const locate = (placement: Placement, owner: LayoutNode): Target[] =>
    placement.targets.flatMap(({ name, part }): Target[] => {
      if (name === node.name) {
        if (part !== 'text') return frameTargets(node, part, TL, BR);
        const text = { x: 0, y: 0 };
        return [
          {
            name: `${name} text`,
            node,
            index: T,
            offset: text,
            width: textWidth,
            height: textHeight,
            ...(hasText ? {} : { empty: true }),
          },
        ];
      }
      const sibling = siblings.get(name);
      if (!sibling) {
        throw new SourceError(
          `"${owner.name}" is placed against "${name}", which is not one of its siblings or its parent`,
          placement.line,
        );
      }
      // A child of the contents is reached through the block that holds it,
      // at the offset the contents solve already gave it.
      const inBlock = !framed.has(sibling);
      const target: Target = {
        name,
        node: sibling,
        index: inBlock ? K : indexOf.get(sibling)!,
        offset: inBlock ? { ...local.get(sibling)! } : { x: 0, y: 0 },
        width: sibling.width,
        height: sibling.height,
      };
      return [partOf(target, part, owner, placement.line)];
    });

  // Which way a child against a side stands from the rest of the box: across
  // for a left or right side or corner, down for the top or bottom.
  const facing = new Map<number, Axis>();
  placed.forEach((child, index) => {
    for (const placement of child.placements) {
      for (const target of placement.targets) {
        if (target.name !== node.name || target.part === undefined || target.part === 'text') continue;
        const words = target.part.split('-');
        if (words.includes('left') || words.includes('right')) facing.set(index, 'x');
        else if (words.includes('top') || words.includes('bottom')) facing.set(index, 'y');
      }
    }
  });
  const across = (i: number, j: number): Axis | undefined => facing.get(i) ?? facing.get(j);

  // An edge end inside this node, as a member of this solve: a framed child
  // or something inside one, or something in the contents, reached through
  // the block at the offset the contents solve gave it. An end outside the
  // node is none of this solve's business.
  const endOf = (end: LayoutNode): Target | undefined => {
    let member = end;
    const offset = { x: 0, y: 0 };
    while (member.parent !== node) {
      const step = local.get(member);
      if (!step || !member.parent) return undefined;
      offset.x += step.x;
      offset.y += step.y;
      member = member.parent;
    }
    const inBlock = !framed.has(member);
    if (inBlock) {
      const step = local.get(member)!;
      offset.x += step.x;
      offset.y += step.y;
    }
    return {
      name: end.name,
      node: end,
      index: inBlock ? K : indexOf.get(member)!,
      offset,
      width: end.width,
      height: end.height,
    };
  };
  // Two ends both in the contents come out as one member and are skipped:
  // the contents solve already made room for that edge's text.
  const corridors = corridorsIn(edges, endOf, measurer, fontSize);

  const solve = (pins: Record<Axis, Constraint[]>) =>
    // Everything here is inside one box, so a collision separates by the step
    // the contents stack by, not by the gap kept between strangers.
    positionGroup(members, locate, { x: [...x, ...pins.x], y: [...y, ...pins.y] }, corridors, across, CHILD_GAP);
  let solved = solve({ x: [], y: [] });

  // Where a text is centered or ranged right, where it goes depends on how
  // wide the frame came out, which depends on everything else. So it is
  // measured off the first solve and pinned, the move `settle` makes.
  const at = (index: number) => solved.get(members[index]!)!;
  const inner = (axis: Axis) => ({
    start: at(TL)[axis] + PAD,
    size: at(BR)[axis] - at(TL)[axis] - PAD * 2,
  });
  const pins: Record<Axis, Constraint[]> = { x: [], y: [] };
  const pin = (axis: Axis, index: number, to: number): void => {
    if (to - at(index)[axis] <= 1e-9) return;
    pins[axis].push(...fix(TL, index, to - at(TL)[axis]));
  };
  // The text and the things placed against it range and center as a group,
  // which is the fan rule's sentence again: several things against one target
  // are balanced on it together.
  const extent = (axis: Axis) => {
    let start = Infinity;
    let end = -Infinity;
    for (const index of row) {
      const size = axis === 'x' ? members[index]!.width : members[index]!.height;
      start = Math.min(start, at(index)[axis]);
      end = Math.max(end, at(index)[axis] + size);
    }
    return { start, end };
  };
  if (banded) {
    if (T >= 0 && style.side !== 'left') {
      const { start, end } = extent('x');
      pin('x', T, at(T).x + (alignedAt(style.side, inner('x'), end - start) - start));
    }
    if (contents.align !== 'left') pin('x', K, alignedAt(contents.align, inner('x'), block.width));
  } else if (T >= 0) {
    const sides: Record<Axis, Side> = { x: style.side, y: style.end };
    // The text and its group range in the room their own row (across) or
    // column (down) leaves them — between whatever sits beside, above or below
    // them — not in the whole box. Ranged against the whole width, a
    // right-ranged title runs into a child in the top-right corner, pushes it
    // out and grows the box; centered on the whole height, a title with things
    // placed below it and more in the bottom corners drops into the middle.
    const room = (axis: Axis): { start: number; size: number } => {
      const cross: Axis = axis === 'x' ? 'y' : 'x';
      const whole = inner(axis);
      const along = extent(axis);
      const beside = extent(cross);
      const size = (member: LayoutNode, on: Axis) => (on === 'x' ? member.width : member.height);
      let start = whole.start;
      let end = whole.start + whole.size;
      members.forEach((member, index) => {
        if (row.includes(index) || index === TL || index === BR) return;
        const c0 = at(index)[cross];
        if (c0 + size(member, cross) <= beside.start || c0 >= beside.end) return;
        const a0 = at(index)[axis];
        if (a0 + size(member, axis) <= along.start) start = Math.max(start, a0 + size(member, axis) + CHILD_GAP);
        else if (a0 >= along.end) end = Math.min(end, a0 - CHILD_GAP);
      });
      return { start, size: end - start };
    };
    for (const axis of AXES) {
      if (sides[axis] === 'left' || sides[axis] === 'top') continue;
      const { start, end } = extent(axis);
      const want = alignedAt(sides[axis], room(axis), end - start);
      pin(axis, T, at(T)[axis] + (want - start));
    }
  }
  if (pins.x.length > 0 || pins.y.length > 0) solved = solve(pins);

  const origin = at(TL);
  const corner = at(BR);
  node.inset = 0;
  node.width = corner.x - origin.x;
  node.height = corner.y - origin.y;
  node.banded = banded;
  node.headerHeight = banded && hasText ? textHeight + HEADER_GAP : 0;
  node.textSide = style.side;
  const relative = (index: number, width: number, height: number) => ({
    x: at(index).x - origin.x,
    y: at(index).y - origin.y,
    width,
    height,
  });
  node.textBox = T >= 0 ? relative(T, textWidth, textHeight) : { x: 0, y: 0, width: 0, height: 0 };
  const reach = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const child of placed) {
    const position = solved.get(child)!;
    const offset = { x: position.x - origin.x, y: position.y - origin.y };
    local.set(child, offset);
    // Whatever sticks out past the frame — a child placed outside it, or
    // something one of the children placed outside itself.
    reach.left = Math.max(reach.left, child.reach.left - offset.x);
    reach.top = Math.max(reach.top, child.reach.top - offset.y);
    reach.right = Math.max(reach.right, offset.x + child.width + child.reach.right - node.width);
    reach.bottom = Math.max(reach.bottom, offset.y + child.height + child.reach.bottom - node.height);
  }
  node.reach = reach;
  if (banded) {
    const shift = relative(K, 0, 0);
    for (const child of stacked) {
      const offset = local.get(child)!;
      offset.x += shift.x;
      offset.y += shift.y;
    }
  }
}

// --- pass three: solve for positions -----------------------------------------

function placeRoots(
  roots: LayoutNode[],
  byName: Map<string, LayoutNode>,
  edges: LayoutEdge[],
  measurer: Measurer,
  fontSize: number,
  local: Local,
): void {
  const anchors = roots.filter((root) => root.placements.length === 0);
  if (anchors.length === 0) {
    throw new SourceError('every node is placed relative to another, so nothing anchors the diagram', 1);
  }
  if (anchors.length > 1) {
    const names = anchors.map((node) => `"${node.name}"`).join(', ');
    throw new SourceError(
      `exactly one node may say nothing about where it goes, but ${anchors.length} do: ${names}`,
      anchors[1]!.line,
    );
  }

  const indexOf = new Map(roots.map((root, index) => [root, index]));

  // A placement may name something nested — `right of server.docker` places a top-level
  // node against a box inside another. Sizes and offsets within a container are
  // already settled, so a nested target is its root's position plus a constant.
  const positions = positionGroup(
    roots,
    (placement, owner) =>
      placement.targets.map(({ name, part }) => {
        const target = byName.get(name);
        if (!target) {
          throw new SourceError(
            `"${owner.name}" is placed against "${name}", which does not exist`,
            placement.line,
          );
        }
        let root = target;
        const offset = { x: 0, y: 0 };
        while (root.parent) {
          const step = local.get(root)!;
          offset.x += step.x;
          offset.y += step.y;
          root = root.parent;
        }
        return partOf(
          {
            name,
            node: target,
            index: indexOf.get(root)!,
            offset,
            width: target.width,
            height: target.height,
          },
          part,
          owner,
          placement.line,
        );
      }),
    { x: [], y: [] },
    corridorsIn(edges, (node) => liftTo(node, indexOf, local), measurer, fontSize),
  );

  for (const root of roots) {
    const position = positions.get(root)!;
    root.x = position.x;
    root.y = position.y;
    spreadToChildren(root, local);
  }
}

/** Once a node has an absolute position, its whole subtree follows from the offsets. */
function spreadToChildren(node: LayoutNode, local: Local): void {
  for (const child of node.children) {
    const offset = local.get(child)!;
    child.x = node.x + offset.x;
    child.y = node.y + offset.y;
    spreadToChildren(child, local);
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const AXES: Axis[] = ['x', 'y'];
const NO_REACH: Reach = { left: 0, top: 0, right: 0, bottom: 0 };
const AXIS_WORD: Record<Axis, string> = { x: 'horizontally', y: 'vertically' };

/** Where a placement's target sits: which member owns it, and where inside that member. */
interface Target {
  name: string;
  /** The node that was named, which may be nested inside the member holding it. */
  node: LayoutNode;
  index: number;
  /**
   * A different member per axis, where one target's two coordinates come from
   * two members. Only a point of a parent's frame needs this: its left and
   * right edges are two members of the child system and its top and bottom
   * two more, so `top-right` is across one and down another.
   */
  byAxis?: Record<Axis, number>;
  /**
   * A point or side of the parent's own frame, from inside it. The frame grows
   * to hold the child, so every child is ahead of the frame's far edges by
   * construction — which is not the circle `settle` refuses, and the one
   * place it is told so.
   */
  frame?: boolean;
  /** What a whole-node target has placed outside itself, kept clear with it. */
  reach?: Reach;
  /**
   * An empty text, which takes no room: nothing stands a gap off it, so a
   * thing placed beside it lands where the text would have been.
   */
  empty?: boolean;
  offset: { x: number; y: number };
  width: number;
  height: number;
}

/** Which member a target's position on this axis is measured from. */
function memberOn(target: Target, axis: Axis): number {
  return target.byAxis ? target.byAxis[axis] : target.index;
}

/**
 * An edge with text's claim on the gap between its two ends.
 *
 * An edge is not a placement and never says where anything goes. But its text is
 * drawn in the gap it crosses, and a gap sized for two boxes to breathe is not a
 * gap sized to hold a word — which is how a diagram that says nothing wrong ends
 * up with `rclone` written across the box it points at. So an edge with text is
 * treated the way anything else put between two things is: it widens the space
 * between them by exactly what it needs, and closes it again when the text goes.
 *
 * The room is worked out per axis here, before anything is solved, because which
 * axis the text ends up crossing is not known until the boxes have landed once.
 */
interface Corridor {
  edge: LayoutEdge;
  from: Target;
  to: Target;
  /** Room the text needs in a gap on each axis, clearance included. */
  need: Record<Axis, number>;
}

/**
 * Where a node sits within the group being solved: which member holds it, and
 * where inside that member. An edge may name anything at any depth, so its ends
 * are lifted to the members of whichever group is being solved — and a node
 * outside that group has no answer, which is how an edge is sorted into the one
 * group where its two ends are different members.
 */
function liftTo(
  node: LayoutNode,
  indexOf: Map<LayoutNode, number>,
  local: Local,
): Target | undefined {
  let member = node;
  const offset = { x: 0, y: 0 };
  while (!indexOf.has(member)) {
    const step = local.get(member);
    if (!step || !member.parent) return undefined;
    offset.x += step.x;
    offset.y += step.y;
    member = member.parent;
  }
  return {
    name: node.name,
    node,
    index: indexOf.get(member)!,
    offset,
    width: node.width,
    height: node.height,
  };
}

/** The edges with text whose two ends are different members of this group. */
function corridorsIn(
  edges: LayoutEdge[],
  locate: (node: LayoutNode) => Target | undefined,
  measurer: Measurer,
  fontSize: number,
): Corridor[] {
  const corridors: Corridor[] = [];
  for (const edge of edges) {
    // An edge with no text asks for nothing: every gap holds an arrowhead. And a
    // edge told to pass between two named things carries its text in *that*
    // corridor rather than in the gap between its own ends, so widening this one
    // would make room where the text never goes.
    if (edge.text === undefined || edge.between) continue;
    const from = locate(edge.from);
    const to = locate(edge.to);
    if (!from || !to || from.index === to.index) continue;
    // The clearance is doubled because the text is drawn at the *midpoint* of
    // the line, so the room it needs is symmetric about that point whatever sits
    // at either end. The arrowhead is charged on both sides for the same reason:
    // it covers `ARROW_LENGTH` of the line it arrives on, and reserving that at
    // one end only would move the midpoint rather than lengthen the run.
    const extent = (axis: Axis): number =>
      textExtent(edge.lines!, edge.textAttrs, axis, measurer, fontSize, edge.line) +
      (TEXT_CLEARANCE + ARROW_LENGTH) * 2;
    corridors.push({ edge, from, to, need: { x: extent('x'), y: extent('y') } });
  }
  return corridors;
}

/**
 * An alignment whose target region cannot be measured yet.
 *
 * Naming several targets aligns a node to the box that just bounds them, and
 * where those targets sit at fixed offsets from one another — siblings in a
 * container, say — that box is a constant and the alignment is an ordinary
 * constraint. Where they do not, its sides are a minimum and a maximum over
 * positions the solve has yet to produce, which is not a distance the solver
 * can be told in advance. So it is measured off the first solution instead.
 */
interface Pending {
  node: LayoutNode;
  me: number;
  axis: Axis;
  side: Side;
  targets: Target[];
  placement: Placement;
  /** The extent being aligned, where it is not the node's own — a fan's whole height. */
  own?: number;
}

/**
 * Position a set of nodes against each other from their placements.
 *
 * Every placement becomes a minimum distance, and the answer is the arrangement
 * where nothing is further apart than its placements require — which is what an
 * author does by hand when they push two things apart to fit something between
 * them and then pull the slack back out.
 *
 * Because a gap is a floor rather than a fixed distance, a corridor widens to
 * hold whatever is put in it and closes again when that is removed. No number
 * anywhere has to be guessed, and nothing is ever tried and rejected.
 */
function positionGroup(
  members: LayoutNode[],
  locate: (placement: Placement, owner: LayoutNode) => Target[],
  extra: { x: Constraint[]; y: Constraint[] },
  corridors: Corridor[] = [],
  across?: (i: number, j: number) => Axis | undefined,
  clearance = SEPARATION_GAP,
): Map<LayoutNode, { x: number; y: number }> {
  const constraints: Record<Axis, Constraint[]> = { x: [...extra.x], y: [...extra.y] };
  const indexOf = new Map(members.map((member, index) => [member, index]));
  const pending: Pending[] = [];
  /** Pairs an overlay put on top of each other, which is the point of it. */
  const overlaid: Array<[number, number]> = [];

  // Several nodes saying the identical thing are one list, running down the
  // page in the order they were written. The first carries the placement for
  // the whole list; each of the rest hangs a fixed step below the one before,
  // and places itself across as it said.
  const fans = fansIn(members);
  for (const fan of fans.values()) {
    for (let at = 1; at < fan.members.length; at += 1) {
      const previous = fan.members[at - 1]!;
      constraints.y.push(
        ...fix(indexOf.get(previous)!, indexOf.get(fan.members[at]!)!, previous.height + CHILD_GAP),
      );
    }
  }

  for (const node of members) {
    // Checked here as well as in `gapFor`, so a misspelt node-wide gap is caught
    // on a node whose placements all name their own or are alignments — and on
    // one that carries no placements at all, where it now still has an effect.
    namedGap(node, node.attrs['gap'], node.line);
    if (node.placements.length === 0) continue;
    const me = indexOf.get(node)!;
    const fan = fans.get(node);
    // A later member of a fan has its vertical from the list, so its own
    // placements speak only across; the first speaks for the whole list.
    const follows = fan !== undefined && fan.members[0] !== node;
    const size: Record<Axis, number> = { x: node.width, y: fan ? fan.height : node.height };
    const located = node.placements.map((placement) => ({ placement, targets: locate(placement, node) }));
    const speaks = (axis: Axis): boolean => !(follows && axis === 'y');

    const spokenFor: Record<Axis, boolean> = { x: false, y: false };
    for (const { placement } of located) {
      if (placement.kind === 'align') {
        spokenFor[placement.axis] = true;
      } else if (placement.kind === 'on') {
        // An overlay names a point of a box, so it settles both axes at once.
        spokenFor.x = true;
        spokenFor.y = true;
      } else {
        if (/left|right/.test(placement.direction)) spokenFor.x = true;
        if (/above|below/.test(placement.direction)) spokenFor.y = true;
      }
    }

    // Aligning to several targets means aligning to the box that just bounds
    // them. That box is a constant only while its members hold still relative
    // to one another; otherwise the alignment waits for the first solution.
    const alignOn = (axis: Axis, side: Side, targets: Target[], placement: Placement): void => {
      if (!speaks(axis)) return;
      const anchor = sharedMember(targets, axis);
      if (anchor === undefined) {
        pending.push({ node, me, axis, side, targets, placement, own: size[axis] });
        return;
      }
      const span = spanOf(targets, axis, () => 0);
      constraints[axis].push(...fix(anchor, me, alignedAt(side, span, size[axis]), placement));
    };

    for (const { placement, targets } of located) {
      if (placement.kind === 'align') {
        alignOn(placement.axis, placement.side, targets, placement);
        continue;
      }
      if (placement.kind === 'on') {
        // The node's center at the part's center, on both axes. That is the
        // ordinary center alignment the language already has on one axis, said
        // twice — which is why `on` needs nothing of its own in the solver.
        // A side of a parent's frame comes as its two ends, so centering on
        // the part is centering on everything it came as.
        overlaid.push([me, targets[0]!.index]);
        for (const axis of AXES) alignOn(axis, 'center', targets, placement);
        continue;
      }
      // Saying `inside` is the author stating the overlap, so there is
      // nothing for the separation pass to report. `outside` is clear of the
      // box by construction and needs no exemption.
      if (placement.written === 'inside') {
        for (const target of targets) overlaid.push([me, target.index]);
      }
      // One constraint per target, so the node clears the furthest of them.
      // Taking that maximum is what longest paths already does, which is why a
      // direction against a whole region needs nothing added to the solver.
      const { direction } = placement;
      // A gap belongs to the relationship rather than to either box in it, so
      // each placement may name its own and the node's `gap:` is only the
      // default. That is what lets a node wedged between two things sit tight
      // against one of them and wide of the other.
      for (const target of targets) {
        const gap = target.empty ? 0 : gapFor(node, placement, target.node);
        // Tucked inside the frame of the box that holds it, a child is *at*
        // that edge rather than at least so far from it: the frame is also
        // held open around every child, which is a pull the other way, and
        // without this the child would sit wherever that left it.
        const exact = target.frame === true && placement.written === 'inside';
        const push = (axis: Axis, from: number, to: number, weight: number): void => {
          if (!speaks(axis)) return;
          constraints[axis].push({ from, to, weight, placement });
          if (exact) constraints[axis].push({ from: to, to: from, weight: -weight, placement });
        };
        const x = memberOn(target, 'x');
        const y = memberOn(target, 'y');
        // The gap is between what each has placed outside itself, not only
        // their boxes: a note beside a box is part of it.
        const theirs = target.reach ?? NO_REACH;
        const mine = node.reach;
        if (direction.includes('right')) {
          push('x', x, me, target.offset.x + target.width + theirs.right + gap + mine.left);
        }
        if (direction.includes('left')) push('x', me, x, size.x + mine.right + gap + theirs.left - target.offset.x);
        if (direction.includes('below')) {
          push('y', y, me, target.offset.y + target.height + theirs.bottom + gap + mine.top);
        }
        if (direction.includes('above')) push('y', me, y, size.y + mine.bottom + gap + theirs.top - target.offset.y);
      }
    }

    // An axis nobody spoke to falls back to the center line of whatever the
    // node was placed against, which is why "right of docker" alone is a whole
    // position. Two different targets would decide which row the node shares,
    // so that is refused rather than guessed — but two targets named by one
    // placement are a single region, and centering on it is unambiguous.
    for (const axis of AXES) {
      if (spokenFor[axis] || !speaks(axis)) continue;
      const offers = located.filter((entry) => entry.placement.kind === 'offset');
      const first = offers[0];
      if (!first) {
        throw new SourceError(
          `"${node.name}" says nothing about where it sits ${AXIS_WORD[axis]}`,
          node.placements[0]!.line,
        );
      }
      const named = (entry: { placement: Placement }) =>
        entry.placement.targets.map(nameTarget).join('\u0000');
      const other = offers.find((entry) => named(entry) !== named(first));
      if (other) {
        throw new SourceError(
          `"${node.name}" does not say where it sits ${AXIS_WORD[axis]}: ` +
            `"${describePlacement(first.placement)}" and "${describePlacement(other.placement)}" ` +
            `would put it in different places`,
          other.placement.line,
        );
      }
      alignOn(axis, 'center', first.targets, first.placement);
    }
  }

  const solved: Record<Axis, number[]> = { x: [], y: [] };
  const solveAll = (): void => {
    for (const axis of AXES) {
      const outcome = tightest(members.length, constraints[axis]);
      if ('contradiction' in outcome) throw noRoom(outcome.contradiction, axis, members);
      solved[axis] = outcome.positions;
    }
  };

  solveAll();
  // A member still waiting to be centered on an axis is not yet where it
  // will be on that axis, so a pair that looks clear there is judged again
  // after everything is in place, below.
  const unsettled = (index: number, axis: Axis) =>
    pending.some((entry) => entry.me === index && entry.axis === axis);
  room(corridors, constraints, solved, solveAll, unsettled);
  settle(pending, members, constraints, solved, solveAll);
  snug(members, constraints, solved, solveAll);
  separate(members, constraints, solved, solveAll, overlaid, across, clearance);
  // A pair the separation pass pulled apart may only now have a corridor
  // between them, with a text in it, and so may a pair one of which was
  // waiting to be centered. Widening it can push something into something
  // else, so that is separated in turn.
  if (room(corridors, constraints, solved, solveAll)) {
    separate(members, constraints, solved, solveAll, overlaid, across, clearance);
  }
  confirm(pending, solved);

  return new Map(
    members.map((member, index) => [
      member,
      { x: solved.x[index]!, y: solved.y[index]! },
    ]),
  );
}

/** The member every target belongs to on this axis, or nothing if they are spread across several. */
function sharedMember(targets: Target[], axis: Axis): number | undefined {
  const first = memberOn(targets[0]!, axis);
  return targets.every((target) => memberOn(target, axis) === first) ? first : undefined;
}

interface Fan {
  /** In declaration order, which is the order they run down the page. */
  members: LayoutNode[];
  /** The whole list, top of the first to bottom of the last. */
  height: number;
}

/**
 * The fans in a group: two or more members whose placements say the identical
 * thing, each member mapped to the one fan it is in.
 *
 * `b right of a`, `c right of a` and `d right of a` otherwise put three boxes
 * on one spot, and what they mean is "a points at three things" — the three
 * balanced against `a`, which no chain of placements can say. The same holds
 * of a part: three children `inside parent right` are a column against that
 * edge. The list runs down the page whatever the direction, including at a
 * corner, where it stacks into the corner and grows down.
 *
 * A node saying `overlap: allow` has asked for the literal pile, and gets it.
 */
function fansIn(members: LayoutNode[]): Map<LayoutNode, Fan> {
  const bySaying = new Map<string, LayoutNode[]>();
  for (const node of members) {
    if (node.placements.length === 0 || allowsOverlap(node)) continue;
    const saying = node.placements.map(describePlacement).join('\n');
    const list = bySaying.get(saying) ?? [];
    list.push(node);
    bySaying.set(saying, list);
  }
  const fans = new Map<LayoutNode, Fan>();
  for (const list of bySaying.values()) {
    if (list.length < 2) continue;
    const height = list.reduce((sum, node) => sum + node.height, 0) + CHILD_GAP * (list.length - 1);
    const fan = { members: list, height };
    for (const node of list) fans.set(node, fan);
  }
  return fans;
}

/** The stretch of one axis that just covers every target. */
function spanOf(
  targets: Target[],
  axis: Axis,
  base: (target: Target) => number,
): { start: number; size: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const target of targets) {
    const at = base(target) + target.offset[axis];
    start = Math.min(start, at);
    end = Math.max(end, at + (axis === 'x' ? target.width : target.height));
  }
  return { start, size: end - start };
}

/**
 * Narrow a target to the part of it the placement named — its text, one of its
 * four sides, or one of its nine points.
 *
 * A side comes back as a segment of zero thickness and a point as a rectangle
 * of no size at all, which is the whole of what a part is to the solver: an
 * extent, exactly as a whole box is, just a thinner one. Everything else — the
 * direction, the gap, the alignment on the axis nobody spoke to — then works
 * on it unchanged, which is why a part target needed nothing added to the
 * constraint system.
 *
 * Each position is read as two independent halves, one per axis, which is why
 * nine words need no table of nine entries: `top-right` is "right" across and
 * "top" down, `top-center` is "top" down and centered across.
 */
function partOf(target: Target, part: Part | undefined, owner: LayoutNode, line: number): Target {
  // The whole node is what it has placed outside itself too; a part of it is
  // just that part.
  if (part === undefined) return { ...target, reach: target.node.reach };
  const box = { ...target, offset: { ...target.offset } };

  if (part === 'text') {
    const text = target.node.textBox;
    if (text.width === 0 && text.height === 0) {
      throw new SourceError(
        `"${owner.name}" is placed against "${target.name} text", and "${target.name}" has no text`,
        line,
      );
    }
    box.offset.x += text.x;
    box.offset.y += text.y;
    box.width = text.width;
    box.height = text.height;
    return box;
  }

  const words = part.split('-');
  const isSide = (PART_SIDES as readonly string[]).includes(part);
  const narrow = (axis: Axis, near: string, far: string): void => {
    const size = axis === 'x' ? box.width : box.height;
    const named = words.includes(near) ? 0 : words.includes(far) ? size : undefined;
    // A *side* leaves the axis it does not name alone: `right` is the whole
    // right edge, top to bottom, where `right-center` is the one point on it.
    if (named === undefined && isSide) return;
    box.offset[axis] += named ?? size / 2;
    if (axis === 'x') box.width = 0;
    else box.height = 0;
  };
  narrow('x', 'left', 'right');
  narrow('y', 'top', 'bottom');
  return box;
}

/** Where a node of this size sits so that the named side of it meets the span's. */
function alignedAt(side: Side, span: { start: number; size: number }, own: number): number {
  if (side === 'center') return span.start + (span.size - own) / 2;
  if (side === 'top' || side === 'left') return span.start;
  return span.start + span.size - own;
}

/**
 * Widen a corridor to hold the text of the edge crossing it.
 *
 * This is the one place an edge reaches the constraint system, and it is the same
 * measure-then-constrain move `settle` makes rather than edges joining the graph
 * outright: the first solution says which gap each text actually falls in, and
 * from there the room it needs is an ordinary minimum distance like any other.
 * Nothing is nudged and no layout is repaired — a constraint the file already
 * implied is derived and the whole system is solved again.
 *
 * Which gap that is, is derived and never chosen. A pair clear of each other on
 * exactly one axis has exactly one corridor between them, and the text is in
 * it. A pair clear on *both* axes sits corner to corner, so the line runs
 * diagonally through open space and there is no corridor to widen; a pair clear
 * on neither overlaps, which is the separation pass's business and not this
 * one's. Both are left alone, which is why this only ever moves boxes that a
 * text is genuinely wedged between.
 *
 * A gap being a minimum does the rest. Where the corridor is already wide enough
 * — because the author said `gap: wide`, or because something else is in there
 * — the constraint is slack and nothing moves; delete the text and the corridor
 * closes back to whatever the file asked for.
 */
function room(
  corridors: Corridor[],
  constraints: Record<Axis, Constraint[]>,
  solved: Record<Axis, number[]>,
  solveAll: () => void,
  unsettled: (index: number, axis: Axis) => boolean = () => false,
): boolean {
  let added = false;

  for (const { from, to, need } of corridors) {
    const clear = (axis: Axis): { before: Target; after: Target } | undefined => {
      const at = (end: Target): number => solved[axis][end.index]! + end.offset[axis];
      const size = (end: Target): number => (axis === 'x' ? end.width : end.height);
      if (at(to) - (at(from) + size(from)) > 1e-9) return { before: from, after: to };
      if (at(from) - (at(to) + size(to)) > 1e-9) return { before: to, after: from };
      return undefined;
    };

    const open = AXES.filter((axis) => clear(axis));
    if (open.length !== 1) continue;
    const axis = open[0]!;
    if (unsettled(from.index, axis) || unsettled(to.index, axis)) continue;
    const { before, after } = clear(axis)!;

    constraints[axis].push({
      from: before.index,
      to: after.index,
      weight:
        before.offset[axis] +
        (axis === 'x' ? before.width : before.height) +
        need[axis] -
        after.offset[axis],
    });
    added = true;
  }

  if (added) solveAll();
  return added;
}

/**
 * Fix the alignments that had to wait, by measuring what they align to.
 *
 * The first solution says where every target actually landed, so the region
 * they bound is now a number rather than an expression, and the alignment
 * becomes an ordinary constraint at a fixed distance. Nothing already solved is
 * moved by hand; a distance is read off and added, which is the same shape as
 * the separation pass and not the repair pass this design refuses.
 *
 * That is exact so long as the region does not depend on the node being aligned
 * to it. Where it does, measuring changes the thing measured and there is no
 * order that settles, so the file is refused rather than iterated at. The test
 * is the same reachability the separation pass uses.
 */
function settle(
  pending: Pending[],
  members: LayoutNode[],
  constraints: Record<Axis, Constraint[]>,
  solved: Record<Axis, number[]>,
  solveAll: () => void,
): void {
  if (pending.length === 0) return;

  for (const axis of AXES) {
    const here = pending.filter((entry) => entry.axis === axis);
    if (here.length === 0) continue;
    const reach = reachability(members.length, constraints[axis]);

    for (const entry of here) {
      for (const target of entry.targets) {
        if (target.frame) continue;
        const at = memberOn(target, axis);
        if (at !== entry.me && !reach[entry.me]![at]) continue;
        throw new SourceError(
          `"${entry.node.name}" is ${describePlacement(entry.placement)}, but "${target.name}" ` +
            `is placed ${AXIS_WORD[axis]} against "${entry.node.name}" in turn, so there is no ` +
            `arrangement where each waits for the other`,
          entry.placement.line,
        );
      }

      const span = spanOf(entry.targets, axis, (target) => solved[axis][memberOn(target, axis)]!);
      const own = entry.own ?? (axis === 'x' ? entry.node.width : entry.node.height);
      const anchor = memberOn(entry.targets[0]!, axis);
      constraints[axis].push(
        ...fix(anchor, entry.me, alignedAt(entry.side, span, own) - solved[axis][anchor]!, entry.placement),
      );
    }
  }

  solveAll();
}

/**
 * Check the measured alignments still hold.
 *
 * Separation runs afterwards and only ever adds, so it can push two targets
 * apart and leave a region wider than it was when it was measured. Nothing here
 * repairs that — the picture is reported as unbuildable, because silently
 * drawing a node that is no longer level with what it names is the failure the
 * diagnostics work exists to prevent.
 */
function confirm(pending: Pending[], solved: Record<Axis, number[]>): void {
  for (const entry of pending) {
    const { axis } = entry;
    const span = spanOf(entry.targets, axis, (target) => solved[axis][memberOn(target, axis)]!);
    const own = entry.own ?? (axis === 'x' ? entry.node.width : entry.node.height);
    if (Math.abs(alignedAt(entry.side, span, own) - solved[axis][entry.me]!) <= 0.5) continue;
    throw new SourceError(
      `"${entry.node.name}" cannot be ${describePlacement(entry.placement)}: keeping boxes off ` +
        `each other moved them apart after that region was measured`,
      entry.placement.line,
    );
  }
}

/**
 * Pull in a node that nothing pushes back the other way.
 *
 * Every constraint reads "this one is at least so far along the axis from that
 * one", and the solve puts each member at the smallest position its constraints
 * allow. That is the tightest arrangement for anything with something behind
 * it — but `left of X` and `above X` bound *X*, not the node that wrote them,
 * so a node carrying only those has nothing behind it at all. It settles at the
 * far edge of the drawing while the thing it names is carried away by the rest
 * of the diagram, which is neither what the file says nor what the language
 * promises: as close together as the placements allow.
 *
 * The remedy is to look the other way for exactly those members. A member with
 * no incoming edge cannot be pushed by anything, so moving it along the axis
 * disturbs nothing; the furthest it may travel is set by whichever of its own
 * placements binds first, and pinning that one placement to an exact distance
 * puts it there. Every other placement it wrote had more room to spare and is
 * still satisfied.
 *
 * The pins are worked out against the first solution and applied together,
 * which keeps them independent: a member with no incoming edge is never the
 * target of another member's pin, because being a target is what an incoming
 * edge is.
 */
function snug(
  members: LayoutNode[],
  constraints: Record<Axis, Constraint[]>,
  solved: Record<Axis, number[]>,
  solveAll: () => void,
): void {
  const pins: { axis: Axis; constraint: Constraint }[] = [];

  for (const axis of AXES) {
    const pushed = new Array<boolean>(members.length).fill(false);
    for (const constraint of constraints[axis]) pushed[constraint.to] = true;

    for (let index = 0; index < members.length; index += 1) {
      if (pushed[index]) continue;

      let binding: Constraint | undefined;
      let slack = Infinity;
      for (const constraint of constraints[axis]) {
        if (constraint.from !== index) continue;
        const room = solved[axis][constraint.to]! - solved[axis][index]! - constraint.weight;
        if (room < slack) {
          slack = room;
          binding = constraint;
        }
      }
      // Nothing to travel toward, or already against it.
      if (!binding || slack <= 1e-9) continue;

      pins.push({
        axis,
        constraint: {
          from: binding.to,
          to: index,
          weight: -binding.weight,
          ...(binding.placement ? { placement: binding.placement } : {}),
        },
      });
    }
  }

  if (pins.length === 0) return;
  for (const pin of pins) constraints[pin.axis].push(pin.constraint);
  solveAll();
}

/**
 * Push apart any two boxes that landed on top of each other.
 *
 * Two boxes not overlapping is a placement the author never has to write, but on
 * its own it says nothing about *which way* to separate them — left, right,
 * above and below all satisfy it, and choosing among four is the search this
 * whole design refuses. So the direction is never chosen. It is read off the
 * constraints already built from the file: if the file lets one box travel away
 * from the other along an axis and offers no way back, that is the only
 * separation consistent with what was written. Where nothing in the file orders
 * a pair on either axis, this reports the pair instead of guessing.
 *
 * One case is genuinely free. When both axes already imply an order, either
 * would do, and the tie is broken by separating along the axis where the two
 * overlap least — the smallest movement, and the one a person makes by hand.
 * That is the single place the tool decides something nobody wrote.
 *
 * The loop only ever adds constraints and re-solves the whole system, so no
 * arrangement is ever tried and rejected and it settles without backtracking.
 * A solved layout is never nudged in place; that is a different thing and it is
 * the thing the design rules out.
 *
 * Members here are always siblings, or the roots of the diagram, so no member
 * ever contains another and containment needs no exemption of its own.
 */
function separate(
  members: LayoutNode[],
  constraints: Record<Axis, Constraint[]>,
  solved: Record<Axis, number[]>,
  solveAll: () => void,
  overlaid: Array<[number, number]> = [],
  across?: (i: number, j: number) => Axis | undefined,
  clearance = SEPARATION_GAP,
): void {
  const eligible = members.map(allowsOverlap).map((allowed) => !allowed);
  if (eligible.filter(Boolean).length < 2) return;
  // An overlay and the box it is on overlap by construction, so that one pair
  // is exempt while both remain ordinary boxes to everything else. This is a
  // pair exemption rather than `overlap: allow` on the node for exactly that
  // reason: a badge sitting on its box says nothing about the box next door.
  const stamped = new Set(overlaid.map(([a, b]) => pairKey(a, b)));

  // Adding only, so the number of separations is bounded; the cap is a
  // backstop against a bug rather than an expected outcome.
  for (let round = 0; round < members.length * members.length + 1; round += 1) {
    let reach: Record<Axis, boolean[][]> | undefined;
    let added = false;

    // One separation per round, then solve again: a pair that collided only
    // because another pair had not yet been moved apart is not a collision,
    // and separating it anyway leaves an ordering that later moves drag along.
    scan: for (let i = 0; i < members.length; i += 1) {
      if (!eligible[i]) continue;
      for (let j = i + 1; j < members.length; j += 1) {
        if (!eligible[j]) continue;

        if (stamped.has(pairKey(i, j))) continue;

        const over = overlapOf(members, solved, i, j);
        if (!over) continue;

        reach ??= { x: reachability(members.length, constraints.x), y: reachability(members.length, constraints.y) };
        const orders: Partial<Record<Axis, { before: number; after: number }>> = {};
        for (const axis of AXES) {
          const order = impliedOrder(reach[axis], i, j);
          if (order) orders[axis] = order;
        }

        // A child against a side of its parent's frame has said which way it
        // stands from the rest of the box — `inside p right` is beside it —
        // so where that way is open, it is the way, and the smaller overlap
        // is not asked.
        const named = across?.(i, j);
        const axis = named !== undefined && orders[named] ? named : pickAxis(orders, over);
        if (!axis) throw unordered(members[i]!, members[j]!);

        const { before, after } = orders[axis]!;
        const span = axis === 'x' ? members[before]!.width : members[before]!.height;
        const [near, far] = axis === 'x' ? (['left', 'right'] as const) : (['top', 'bottom'] as const);
        const past = members[before]!.reach[far] + members[after]!.reach[near];
        constraints[axis].push({ from: before, to: after, weight: span + past + clearance });
        reach = undefined;
        added = true;
        break scan;
      }
    }

    if (!added) return;
    solveAll();
  }
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** How far two members share space on each axis, or nothing if they are clear of each other. */
function overlapOf(
  members: LayoutNode[],
  solved: Record<Axis, number[]>,
  i: number,
  j: number,
): Record<Axis, number> | undefined {
  const shared = (axis: Axis): number => {
    const [near, far] = axis === 'x' ? (['left', 'right'] as const) : (['top', 'bottom'] as const);
    const start = (index: number) => solved[axis][index]! - members[index]!.reach[near];
    const end = (index: number) =>
      solved[axis][index]! + (axis === 'x' ? members[index]!.width : members[index]!.height) + members[index]!.reach[far];
    return Math.min(end(i), end(j)) - Math.max(start(i), start(j));
  };
  const x = shared('x');
  const y = shared('y');
  return x > 1e-9 && y > 1e-9 ? { x, y } : undefined;
}

/** Which of two members the file lets the other move past, if either. */
function impliedOrder(
  reach: boolean[][],
  i: number,
  j: number,
): { before: number; after: number } | undefined {
  const forward = reach[i]![j]!;
  const backward = reach[j]![i]!;
  if (forward === backward) return undefined;
  return forward ? { before: i, after: j } : { before: j, after: i };
}

/** Of the axes that can separate a pair, the one where they overlap least. */
function pickAxis(
  orders: Partial<Record<Axis, { before: number; after: number }>>,
  over: Record<Axis, number>,
): Axis | undefined {
  const available = AXES.filter((axis) => orders[axis]);
  if (available.length < 2) return available[0];
  return over.x <= over.y ? 'x' : 'y';
}

function allowsOverlap(node: LayoutNode): boolean {
  const value = node.attrs['overlap'];
  if (value === undefined) return false;
  if (value !== 'allow') {
    throw new SourceError(`"${node.name}" has overlap: ${value}, which is not one of allow`, node.line);
  }
  return true;
}

function unordered(first: LayoutNode, second: LayoutNode): SourceError {
  const [earlier, later] = first.line <= second.line ? [first, second] : [second, first];
  return new SourceError(
    `"${earlier.name}" and "${later.name}" overlap, and nothing says which side of the ` +
      `other either one sits on — place one against the other, or say overlap: allow`,
    later.line,
  );
}

/** Report a set of placements that cannot all hold, in the words they were written in. */
function noRoom(contradiction: Contradiction, axis: Axis, members: LayoutNode[]): SourceError {
  const { placements } = contradiction;
  if (placements.length === 0) {
    return new SourceError(
      `these placements run in a circle ${AXIS_WORD[axis]} and cannot all hold`,
      members[0]?.line ?? 1,
    );
  }
  const quoted = placements.map((placement) => `"${describePlacement(placement)}"`).join(' and ');
  return new SourceError(
    `${quoted} cannot all hold — they leave no room ${AXIS_WORD[axis]}`,
    placements[placements.length - 1]!.line,
  );
}


/**
 * How far this placement holds the node off its target.
 *
 * A gap is a property of the relationship, not of either box in it, so the
 * placement's own bracketed gap is the specific statement about this pair and
 * wins outright. Where it says nothing, `gap:` on a node is a default — and both
 * ends of the relationship may offer one. The node doing the placing wrote its
 * gap down; the target had someone else's placement written against it. Neither
 * is more entitled than the other, so the larger applies, which is the only
 * answer consistent with a gap being a minimum in the first place.
 *
 * That is what makes `gap: wide` on a node that carries no placements of its own
 * do the obvious thing rather than nothing at all: an author looking at two boxes
 * pushed too close together has no reason to know which of the two happened to
 * name the other.
 */
function gapFor(node: LayoutNode, placement: OffsetPlacement, target: LayoutNode): number {
  if (placement.gap !== undefined) return namedGap(node, placement.gap, placement.line);
  // Against the box that holds it, a child is spaced as that box spaces what it
  // holds: tucked in by the padding, and deaf to the box's own `gap:`, which
  // says how that box stands off its neighbours and not how it holds things.
  const own = target.children.includes(node);
  if (own && placement.written === 'inside') return PAD;
  // Beside or below the text of the box holding it, as the contents sit below
  // a title: a band said by placing things below the text is the band the
  // contents would have made.
  if (own && placement.targets.some((each) => each.name === target.name && each.part === 'text')) return CHILD_GAP;
  // An `inside` placement is an inset rather than a standoff, and the two want
  // different defaults: "beside that box" reads as room to breathe, "tucked in
  // that corner" reads as close to it. A node-wide `gap:`, which says how this
  // node stands off its *neighbours*, has no business setting an inset either
  // — so `inside` takes `tight` and stops there unless the placement says.
  if (placement.written === 'inside') return namedGap(node, 'tight', placement.line);
  const mine = node.attrs['gap'];
  const theirs = own ? undefined : target.attrs['gap'];
  // Only a gap somebody actually wrote down counts. Reading an absent one as the
  // default would make it a floor rather than a fallback, and every `gap: tight`
  // placed against a silent node would quietly widen back to normal.
  const stated: number[] = [];
  if (mine !== undefined) stated.push(namedGap(node, mine, node.line));
  if (theirs !== undefined) stated.push(namedGap(target, theirs, target.line));
  if (stated.length === 0) return namedGap(node, undefined, node.line);
  return Math.max(...stated);
}

/**
 * A gap is one of the named steps or a plain number of pixels. The names are
 * the default because retuning `tight` moves every tight gap together, but a
 * number is no less relative: it is still a minimum distance from the target,
 * and nothing unrelated moving can make it wrong.
 */
function namedGap(node: LayoutNode, named: string | undefined, line: number): number {
  const gap = GAPS[named ?? 'normal'];
  if (gap !== undefined) return gap;
  if (named !== undefined && /^\d+(\.\d+)?$/.test(named)) return Number(named);
  const known = Object.keys(GAPS).join(', ');
  const unit = named?.match(/^(\d+(?:\.\d+)?)px$/);
  const hint = unit
    ? `; write "gap: ${unit[1]}", a gap's number is already in pixels`
    : named?.startsWith('-')
      ? '; a gap is a distance and cannot be negative, and "overlap: allow" is what lets two boxes meet'
      : '';
  throw new SourceError(
    `"${node.name}" asks for gap: ${named}, which is not one of ${known} or a number of pixels${hint}`,
    line,
  );
}

// --- shared helpers ----------------------------------------------------------

/** The keys a bracketed attribute contributed, with its prefix taken off. */
function bracketOf(key: string, attrs: Attrs): Attrs {
  const found: Attrs = {};
  for (const [written, value] of Object.entries(attrs)) {
    if (written.startsWith(`${key}.`)) found[written.slice(key.length + 1)] = value;
  }
  return found;
}

/**
 * Every style the markup in this file names, resolved to the color it lends.
 *
 * A style is the only thing markup may name — never a color — so that a marked
 * word borrows a meaning the file already has instead of restating a value that
 * goes stale the day the thing it means is recolored. Both ways that can fail
 * are refused by name: a style nobody declared, and one that says nothing about
 * text and so would lend nothing.
 */
function markupColors(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  styles: Map<string, Attrs>,
): Record<string, string> {
  const colors: Record<string, string> = {};
  const used: Array<{ lines: Line[]; what: string; line: number }> = [
    ...nodes.map((node) => ({ lines: node.lines, what: `"${node.name}"`, line: node.line })),
    ...edges.flatMap((edge) =>
      edge.lines ? [{ lines: edge.lines, what: `edge ${edge.from.name} -> ${edge.to.name}`, line: edge.line }] : [],
    ),
  ];
  for (const { lines, what, line } of used) {
    for (const name of markupStyles(lines)) {
      const style = styles.get(name);
      if (style === undefined) {
        throw new SourceError(
          `${what}: its text marks [${name}], and there is no style called "${name}"`,
          line,
        );
      }
      const color = style['text.color'];
      if (color === undefined) {
        throw new SourceError(
          `${what}: its text marks [${name}], and style "${name}" says nothing about text — ` +
            `write \`style ${name}  text: (color: …)\``,
          line,
        );
      }
      colors[name] = color;
    }
  }
  return colors;
}

/**
 * Split a text into the lines that get drawn. ` / ` always breaks a line, and
 * `(wrap: n)` additionally folds each of those at word boundaries, which is
 * what stops a long note running across the whole diagram.
 *
 * The wrap is a character count rather than a distance. It says how much text
 * fits on a line, not where anything sits, so it stays a property of the text
 * and never becomes a coordinate in disguise.
 *
 * Markup is read off first, so everything downstream works in runs: a break or
 * a fold inside a marked-up stretch carries the mark onto both lines, which is
 * what makes markup general where the `subtext:` slice it replaced could only
 * ever reach the tail of a text.
 */
function linesFor(text: string, textAttrs: Attrs, subject: string, line: number): Line[] {
  const lines = splitRuns(parseMarkup(text, subject, line));
  const stated = textAttrs['wrap'];
  if (stated === undefined) return lines;

  const columns = Number(stated);
  if (!Number.isInteger(columns) || columns < 1) {
    throw new SourceError(`wrap must be a whole number of characters, not "${stated}"`, line);
  }
  return lines.flatMap((part) => wrapLine(part, columns));
}

function bounds(nodes: LayoutNode[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { minX, minY, maxX, maxY };
}

/** Shift everything so the diagram starts at the margin rather than wherever the anchor fell. */
function normalize(nodes: LayoutNode[], margin: number): void {
  const { minX, minY } = bounds(nodes);
  const dx = margin - minX;
  const dy = margin - minY;
  for (const node of nodes) {
    node.x += dx;
    node.y += dy;
  }
}
