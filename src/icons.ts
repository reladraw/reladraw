/**
 * The built-in icons, and the pictures a file declares.
 *
 * The built-ins are Lucide's whole set (`lucide.ts`, generated from one pinned
 * version), named as Lucide names them. A set of a few thousand, rather than a
 * few drawn for reladraw, means a writer can name almost anything without
 * drawing it. Nobody types those names from memory, so a name that isn't one
 * is refused with the nearest names and a pointer to the whole set.
 *
 * Every picture is markup written into the SVG. The output contract is a
 * standalone document: an icon font would render as blank boxes on a machine
 * without the font, and an `<image href>` would need the file to travel beside
 * the SVG.
 */

import { SourceError } from './errors.js';
import { LUCIDE, LUCIDE_ROOT, LUCIDE_VERSION } from './lucide.js';
import { readShapeLook, type ShapeLook } from './outline.js';

/**
 * A picture as SVG markup, written into the output as a nested `<svg>` fitted
 * to the icon's square: a built-in, or one the author supplied. It keeps its
 * own colors on every theme. What it leaves to `currentColor` takes the
 * theme's icon line color, which is how a one-color icon, every built-in
 * among them, follows the theme.
 */
export interface PastedIcon {
  /** The root element's attributes, less the ones the placement sets. */
  readonly attrs: string;
  readonly inner: string;
}

/**
 * `icon gh  letters: "GH"  fill: #24292f  text: white`: letters in a circle.
 * A color left unsaid is the theme's, chosen from the letters, so the same
 * letters get the same color in a theme.
 */
export interface LetterIcon {
  readonly letters: string;
  readonly fill?: string;
  readonly text?: string;
}

export type Icon = PastedIcon | LetterIcon;

/** Where to see every built-in icon, named in the message refusing one. */
export const ICONS_URL = 'https://lucide.dev/icons';

/** The built-in icon of this name, if there is one. */
export function builtInIcon(name: string): PastedIcon | undefined {
  const inner = Object.hasOwn(LUCIDE, name) ? LUCIDE[name] : undefined;
  return inner === undefined ? undefined : { attrs: LUCIDE_ROOT, inner };
}

/**
 * Names reladraw's own drawings had before the icons were Lucide's, each with
 * the Lucide icon that replaced it. `laptop`, `package` and `database` kept
 * their names. `instance` was `cube` until 0.3.0.
 */
const RENAMED: Readonly<Record<string, string>> = {
  disk: 'hard-drive',
  desktop: 'monitor',
  cubes: 'boxes',
  cube: 'box',
  instance: 'box',
};

/**
 * The built-in names nearest to one that isn't, best first: a name that holds
 * it or is held by it (`phone` → `smartphone`), one sharing a word with it
 * (`cloud-server` → `server`), then one a few letters away (`databse`).
 */
export function nearestIcons(named: string, count = 5): string[] {
  const words = named.split('-').filter((word) => word.length > 1);
  const scored: { name: string; score: number }[] = [];
  for (const name of Object.keys(LUCIDE)) {
    let score: number;
    if (name.includes(named) || named.includes(name)) {
      score = Math.abs(name.length - named.length);
    } else if (words.some((word) => name.split('-').includes(word))) {
      score = 20 + name.length;
    } else {
      const distance = editDistance(named, name, 3);
      if (distance > 2) continue;
      score = 10 + distance;
    }
    scored.push({ name, score });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, count).map(({ name }) => name);
}

/** Levenshtein distance, giving up past `limit` (returning `limit + 1`) when one is given. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      least = Math.min(least, current[j]!);
    }
    if (least > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length]!;
}

/** The end of a message refusing an icon name: the nearest names, and where the whole set is. */
function iconHelp(named: string, declared: Iterable<string>): string {
  const own = [...declared];
  const near = nearestIcons(named);
  const ask = near.length > 0 ? `Did you mean ${near.join(', ')}? ` : '';
  const mine = own.length > 0 ? `, and this file declares ${own.join(', ')}` : '';
  return `${ask}The icons are Lucide's (${LUCIDE_VERSION}), all listed at ${ICONS_URL}${mine}`;
}

/**
 * The outlines a node's body can take. `rectangle` is the plain one and needs no
 * word, since it is what a node is when it says nothing.
 *
 * A shape geometry has a word for is named by that word, how it looks:
 * `diamond`, never `decision`, since someone may just want a diamond, and
 * reading `decision` as a diamond is a translation every reader has to make.
 * Those take settings in a bracket for what the box doesn't decide. A
 * flowchart shape geometry has no word for is named `flow-` and what it means,
 * drawn the way the standard draws it, with no settings. No picture has two
 * names. `document`, the folded corner, is older than the rule and keeps its
 * name; the standard's wavy one is `flow-document`.
 *
 * The geometry of each is in `outline.ts`.
 */
export const OUTLINES = [
  'rectangle',
  'document',
  'circle',
  'diamond',
  'pill',
  'parallelogram',
  'hexagon',
  'trapezoid',
  'triangle',
  'cylinder',
  'flow-subprocess',
  'flow-document',
  'flow-off-page',
  'flow-delay',
  'flow-manual-input',
  'flow-stored-data',
  'flow-loop-start',
  'flow-loop-end',
  'flow-card',
  'flow-display',
  'flow-tape',
  'flow-punched-tape',
  'flow-collate',
] as const;
export type Outline = (typeof OUTLINES)[number];

/** Every value `shape:` accepts, `none` included. */
export const SHAPE_WORDS = [...OUTLINES, 'table', 'none'] as const;

/**
 * What a node is drawn as: an outline, a picture, or nothing at all.
 *
 * Two keys name it and each names one part. `shape:` is the outline the node is
 * drawn with, `none` included; `icon:` is the picture the node is drawn *as*.
 * Writing both is an error, because a node has one body.
 *
 * The test that separates them is whether the node still sizes itself from its
 * text: a `document` does, a picture does not — its size is the picture's and
 * its text goes underneath.
 */
export type Body =
  | { kind: 'shape'; outline: Outline; look: ShapeLook }
  | { kind: 'icon'; icon: Icon }
  | { kind: 'none' };

const PLAIN: Body = { kind: 'shape', outline: 'rectangle', look: {} };

/**
 * Which body a node has, from what it wrote and what its style carried.
 *
 * Called once per node while the tree is built, and the answer is kept on the
 * node — so the resolver, which sizes the body, and the renderer, which draws
 * it, cannot disagree about what it is.
 *
 * A key the node wrote itself overrules the other key coming from a style. That
 * is the same permissiveness `checkAttrs` already grants a style: a style is a
 * bundle meant to be shared across kinds, and a key it carries that this node
 * has overridden is unused rather than wrong. Both keys from one level is a
 * genuine contradiction and is refused by name.
 */
export function bodyFor(
  attrs: Record<string, string>,
  appearance: Record<string, string>,
  line: number,
  declared: ReadonlyMap<string, Icon> = new Map(),
): Body {
  const wroteShape = attrs['shape'] !== undefined;
  const wroteIcon = attrs['icon'] !== undefined;
  let shape = wroteIcon && !wroteShape ? undefined : appearance['shape'];
  let icon = wroteShape && !wroteIcon ? undefined : appearance['icon'];

  if (shape !== undefined && icon !== undefined) {
    throw new SourceError(
      `shape: ${shape} and icon: ${icon} both say what this node is drawn as, and it has one ` +
        'body — `shape:` is the outline it is drawn with, `icon:` is the picture it is drawn as',
      line,
    );
  }

  // The settings come from wherever the shape did: a node's own `shape:` takes
  // its own bracket, never a style's.
  const from = wroteShape ? attrs : appearance;
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(from)) if (key.startsWith('shape.')) settings[key.slice('shape.'.length)] = value;
  if (icon !== undefined) return { kind: 'icon', icon: iconNamed(icon, line, declared) };
  if (shape === undefined) return PLAIN;
  if (shape === 'none') {
    if (Object.keys(settings).length > 0) refuse(`\`shape: none\` draws no outline, so it takes no settings`, line);
    return { kind: 'none' };
  }
  if ((OUTLINES as readonly string[]).includes(shape)) {
    return { kind: 'shape', outline: shape as Outline, look: readShapeLook(shape, settings, `shape: ${shape}`, line) };
  }
  if (shape === 'hourglass') {
    return refuse('`shape: hourglass` is the flowchart\'s collate symbol, and it is `flow-collate`', line);
  }
  if (shape === 'pentagon' || shape === 'pointed' || shape === 'home-plate') {
    return refuse(`there is no shape "${shape}" — the flowchart's off-page connector, a box with one end pointed, is \`flow-off-page\``, line);
  }
  if (shape === 'ellipse' || shape === 'oval') {
    return refuse(`there is no shape "${shape}" — an ellipse is a circle given a width and a height: \`shape: circle  width: 20  height: 8\``, line);
  }
  if (shape === 'decision' || shape === 'terminal' || shape === 'process') {
    const look = { decision: 'diamond', terminal: 'pill', process: 'rectangle' }[shape];
    return refuse(`a shape is named for how it looks, so a ${shape} is \`shape: ${look}\``, line);
  }
  if (shape === 'erd' || shape === 'entity' || shape === 'record' || shape === 'class') {
    return refuse(
      `a shape is named for how it looks, so ${shape === 'erd' ? 'an ERD entity' : `a ${shape}`} is \`shape: table\` — ` +
        'name the use with a style, such as style erd_entity  shape: table',
      line,
    );
  }
  // Written out into rows and cells before anything is built, so it is never drawn as itself.
  if (shape === 'table') return PLAIN;

  if (shape === 'box') {
    return refuse(
      '`shape: box` is now `shape: rectangle`, since nothing else in the vocabulary is abbreviated ' +
        '(`icon: box` draws a box as a picture)',
      line,
    );
  }
  // A picture is `icon:`, a separate key since 0.3.0, when `shape:` stopped
  // taking icon names. A file naming one with `shape:` is told which key it
  // wanted rather than being drawn as a plain rectangle.
  const picture = RENAMED[shape] ?? (builtInIcon(shape) === undefined ? undefined : shape);
  if (picture !== undefined) {
    return refuse(`a picture is \`icon:\`, not \`shape:\` — try \`icon: ${picture}\``, line);
  }
  return refuse(
    `there is no shape called "${shape}". The shapes are ${SHAPE_WORDS.join(', ')}, and a ` +
      `picture is \`icon:\` rather than \`shape:\`, one of Lucide's, all listed at ${ICONS_URL}`,
    line,
  );
}

function refuse(message: string, line: number): never {
  throw new SourceError(message, line);
}

/**
 * The icon of that name, or an error saying what to write instead.
 *
 * An unknown name is refused rather than dropped. That is the same rule
 * `DIAGRAM_KEYS` follows and it is here for the same reason: a misspelt
 * `icon: laptp` that quietly draws nothing is indistinguishable from the tool
 * being broken, and an author will stare at the file looking for the mistake in
 * the wrong place. A name reladraw's own drawings used is refused naming the
 * Lucide icon that replaced it; any other gets the nearest names and where the
 * whole set is listed.
 *
 * An icon the file declares wins over a built-in of the same name, so an author
 * who dislikes the drawing of `server` can replace it everywhere at once.
 */
export function iconNamed(named: string, line: number, declared: ReadonlyMap<string, Icon> = new Map()): Icon {
  const icon = declared.get(named) ?? builtInIcon(named);
  if (icon !== undefined) return icon;
  const now = RENAMED[named];
  if (now !== undefined) {
    throw new SourceError(
      `the icon "${named}" is now "${now}" — the built-in icons are Lucide's, all listed at ${ICONS_URL}`,
      line,
    );
  }
  throw new SourceError(`there is no icon called "${named}". ${iconHelp(named, declared.keys())}`, line);
}

/**
 * Read an author's SVG into an icon. `name` makes the drawing's own ids and
 * class names unique, so two pasted icons that both call a gradient `a` do not
 * paint with each other's.
 *
 * Refused, each by name: text with no `<svg>` in it, a drawing with no way to
 * tell its size, and anything that runs script, which a diagram has no use for
 * and a browser showing the diagram might execute.
 */
export function pastedIcon(source: string, name: string, line: number): PastedIcon {
  const start = source.search(/<svg[\s>/]/);
  if (start === -1) {
    throw new SourceError(`icon "${name}" is not an SVG — it should contain an <svg> element`, line);
  }
  if (/<script[\s>]/i.test(source) || /\son[a-z]+\s*=/i.test(source)) {
    throw new SourceError(
      `icon "${name}" contains script, which a diagram has no use for and a browser showing it ` +
        'might run — remove the <script> element or the on… attribute',
      line,
    );
  }

  const open = /^<svg((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/.exec(source.slice(start));
  if (open === null) {
    throw new SourceError(`icon "${name}" has an <svg> tag that does not close — it needs its >`, line);
  }
  const bodyStart = start + open[0].length;
  const end = source.lastIndexOf('</svg>');
  if (open[2] !== '/' && end < bodyStart) {
    throw new SourceError(`icon "${name}" has no </svg> to end it`, line);
  }
  let inner = open[2] === '/' ? '' : source.slice(bodyStart, end);

  const attrs = new Map<string, string>();
  for (const [, key, value] of open[1]!.matchAll(/([^\s=]+)(?:\s*=\s*("[^"]*"|'[^']*'))?/g)) {
    attrs.set(key!, value ?? '""');
  }
  // The placement sets where the drawing goes and how big it is, and a nested
  // <svg> needs no namespace of its own.
  const width = attrs.get('width');
  const height = attrs.get('height');
  for (const key of [...attrs.keys()]) {
    if (['x', 'y', 'width', 'height', 'version'].includes(key) || key === 'xmlns' || key.startsWith('xmlns:')) {
      attrs.delete(key);
    }
  }
  if (!attrs.has('viewBox')) {
    const number = (value: string | undefined) => Number(value?.slice(1, -1).replace(/px$/, ''));
    const w = number(width);
    const h = number(height);
    if (!(w > 0 && h > 0)) {
      throw new SourceError(
        `icon "${name}" has no viewBox and no width and height to take one from, so there is no ` +
          'telling how big its drawing is — add viewBox="0 0 <width> <height>"',
        line,
      );
    }
    attrs.set('viewBox', `"0 0 ${w} ${h}"`);
  }

  // The output declares no xlink namespace, and SVG 2 reads a plain `href`.
  inner = inner.replace(/\sxlink:href=/g, ' href=');

  const prefix = `rd-${name.replace(/[^A-Za-z0-9_-]/g, '_')}-`;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // An id is renamed where it is defined and where it is referred to, which is
  // `url(#…)` or `href="#…"` — never a bare `#…`, which may be a color.
  for (const [, , double, single] of inner.matchAll(/\sid\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const id = double ?? single!;
    const pattern = escape(id);
    inner = inner
      .replace(new RegExp(`(\\sid\\s*=\\s*["'])${pattern}(["'])`, 'g'), `$1${prefix}${id}$2`)
      .replace(new RegExp(`(url\\(\\s*['"]?#)${pattern}(?=['"]?\\s*\\))`, 'g'), `$1${prefix}${id}`)
      .replace(new RegExp(`(\\shref\\s*=\\s*["']#)${pattern}(?=["'])`, 'g'), `$1${prefix}${id}`);
  }
  // A class is renamed on the elements that wear it and in the drawing's own
  // <style> blocks, since a stylesheet in an SVG applies to the whole document.
  const classes = new Set<string>();
  for (const [, , double, single] of inner.matchAll(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    for (const each of (double ?? single!).split(/\s+/)) if (each !== '') classes.add(each);
  }
  inner = inner.replace(/(\sclass\s*=\s*["'])([^"']*)/g, (_, key: string, value: string) =>
    key + value.replace(/[^\s]+/g, (each) => prefix + each),
  );
  inner = inner.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, open: string, css: string, close: string) => {
    for (const each of classes) {
      css = css.replace(new RegExp(`\\.${escape(each)}(?![\\w-])`, 'g'), `.${prefix}${each}`);
    }
    return open + css + close;
  });

  const written = [...attrs].map(([key, value]) => `${key}=${value}`).join(' ');
  return { attrs: written, inner: inner.trim() };
}
