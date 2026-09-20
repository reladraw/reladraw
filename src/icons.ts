/**
 * The built-in icon set.
 *
 * Every glyph is path data written into the SVG, and that is the whole reason
 * this file exists rather than a dependency. The output contract is a standalone
 * document: an icon font would render as blank boxes on any machine that does
 * not have the font, and an `<image href>` would need the file to travel beside
 * the SVG. Inline paths cost a few hundred bytes each and always arrive.
 *
 * A name here says what the thing *is*, never what the picture looks like. The
 * same discipline as `gap: wide` over `gap: 110` and `muted` over a hex value:
 * the word is the whole interface, so it has to carry meaning rather than
 * geometry, and naming the meaning is what lets the drawing be improved later
 * without every diagram that uses it changing sense.
 *
 * The set is deliberately small. In a drawing tool you pick a shape out of a
 * visual palette and hundreds are browsable; here you type the word from memory,
 * which caps the useful vocabulary at something that fits in a head. Add a name
 * when a diagram asks for a distinction it cannot otherwise make.
 */

import { SourceError } from './errors.js';

/**
 * Icons carry three tones rather than colors. `ink` is the drawn line, `shade`
 * the body it encloses, and `void` is the page showing through — the same
 * knockout an edge text already uses. Naming tones instead of colors is what
 * lets one glyph sit correctly on a dark theme and a light one.
 */
export type IconTone = 'ink' | 'shade' | 'void';

export interface IconPath {
  d: string;
  fill?: IconTone;
  stroke?: IconTone;
}

export interface Icon {
  /** Side of the square the paths are drawn on. Scaled to the drawn size. */
  readonly grid: number;
  readonly paths: readonly IconPath[];
}

const GRID = 24;
/** Line width on the 24-unit grid, scaled with everything else. */
export const ICON_STROKE = 1.1;

/** A full circle as one path, so the data below can stay declarative. */
function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

/** The three visible faces of an isometric cube, top face centered on `cx, cy`. */
function cube(cx: number, cy: number, s: number): IconPath[] {
  const half = s / 2;
  return [
    { d: `M${cx} ${cy} L${cx + s} ${cy + half} L${cx} ${cy + s} L${cx - s} ${cy + half} Z`, fill: 'shade', stroke: 'ink' },
    { d: `M${cx - s} ${cy + half} L${cx} ${cy + s} L${cx} ${cy + s * 2} L${cx - s} ${cy + s * 1.5} Z`, fill: 'shade', stroke: 'ink' },
    { d: `M${cx + s} ${cy + half} L${cx} ${cy + s} L${cx} ${cy + s * 2} L${cx + s} ${cy + s * 1.5} Z`, fill: 'shade', stroke: 'ink' },
  ];
}

export const ICONS: Record<string, Icon> = {
  /** A spinning disk: the physical drive, not the filesystem on it. */
  disk: {
    grid: GRID,
    paths: [
      { d: 'M4 2 h16 a1.6 1.6 0 0 1 1.6 1.6 v16.8 a1.6 1.6 0 0 1 -1.6 1.6 h-16 a1.6 1.6 0 0 1 -1.6 -1.6 v-16.8 a1.6 1.6 0 0 1 1.6 -1.6 Z', fill: 'shade', stroke: 'ink' },
      { d: circle(12, 10.6, 6.2), fill: 'void', stroke: 'ink' },
      { d: circle(12, 10.6, 1.9), fill: 'ink' },
      { d: 'M11.5 12.6 L12.9 13.4 L8.8 19.6 a1.25 1.25 0 0 1 -2.1 -1.35 Z', fill: 'ink' },
    ],
  },

  /** A workstation: monitor, keyboard and tower. */
  desktop: {
    grid: GRID,
    paths: [
      { d: 'M1.2 2.6 h12.4 v9.2 h-12.4 Z', fill: 'shade', stroke: 'ink' },
      { d: 'M6.3 11.8 h2.2 v1.7 h-2.2 Z', fill: 'ink' },
      { d: 'M4.2 13.5 h6.4 v1.1 h-6.4 Z', fill: 'ink' },
      { d: 'M1.2 16.4 h12.4 v3.2 h-12.4 Z', fill: 'shade', stroke: 'ink' },
      { d: 'M2.6 17.6 h7.8 v0.9 h-7.8 Z', fill: 'ink' },
      { d: 'M16.2 2.6 h6.6 v17 h-6.6 Z', fill: 'shade', stroke: 'ink' },
      { d: circle(19.5, 5.2, 0.9), fill: 'ink' },
      { d: 'M17.4 9.4 h4.2 v0.7 h-4.2 Z M17.4 11.4 h4.2 v0.7 h-4.2 Z M17.4 13.4 h4.2 v0.7 h-4.2 Z', fill: 'ink' },
    ],
  },

  /** A portable machine. Open lid, so the screen is the page showing through. */
  laptop: {
    grid: GRID,
    paths: [
      { d: 'M4 3.6 h16 v11.4 h-16 Z', fill: 'void', stroke: 'ink' },
      { d: 'M2.2 16 h19.6 l1.6 2.6 a0.7 0.7 0 0 1 -0.6 1.1 h-21.6 a0.7 0.7 0 0 1 -0.6 -1.1 Z', fill: 'ink' },
      { d: 'M9.6 17.2 h4.8 v1 h-4.8 Z', fill: 'shade' },
    ],
  },

  /** Something stored as a whole rather than run: an archive, a bucket, a sync root. */
  package: {
    grid: GRID,
    paths: [
      { d: 'M12 2.6 L22 7.4 L12 12.2 L2 7.4 Z', fill: 'shade', stroke: 'ink' },
      { d: 'M2 7.4 L12 12.2 L12 21 L2 16.2 Z', fill: 'shade', stroke: 'ink' },
      { d: 'M22 7.4 L12 12.2 L12 21 L22 16.2 Z', fill: 'shade', stroke: 'ink' },
    ],
  },

  /**
   * Several interchangeable units of the same kind, as a group. Three rather
   * than any particular number: this is the symbol for "several", and at two
   * line-heights square a literal count turns to mush. Where the count carries
   * meaning — where one of them is the end of an arrow — they are nodes, and
   * `icon: cube` is how you draw them.
   */
  cubes: {
    grid: GRID,
    paths: [...cube(6.6, 2.6, 4.4), ...cube(17.4, 2.6, 4.4), ...cube(12, 11.6, 4.4)],
  },

  /**
   * One unit of the kind `cubes` shows several of.
   *
   * Called `instance` until 0.3.0, under the rule that a name says what the
   * thing is rather than what the picture looks like. That rule works where a
   * picture has one conventional meaning — a disk, a laptop, a folded corner —
   * and it misfires here, because a cube has none: it stands for a container in
   * one diagram, a VM in another, a service in a third, and the diagram assigns
   * the meaning. `instance` picked one of those and hid the picture.
   */
  cube: {
    grid: GRID,
    paths: cube(12, 2.6, 8.4),
  },

  /** A store queried rather than read as files. */
  database: {
    grid: GRID,
    paths: [
      { d: 'M3 6.4 v11.2 a9 3.4 0 0 0 18 0 v-11.2 Z', fill: 'shade', stroke: 'ink' },
      { d: 'M3 6.4 a9 3.4 0 0 1 18 0 a9 3.4 0 0 1 -18 0 Z', fill: 'shade', stroke: 'ink' },
      { d: 'M3 11 a9 3.4 0 0 0 18 0', stroke: 'ink' },
      { d: 'M3 15.6 a9 3.4 0 0 0 18 0', stroke: 'ink' },
    ],
  },
};

export const ICON_NAMES = Object.keys(ICONS);

/**
 * The outlines a node's body can take. `rectangle` is the plain one and needs no
 * word, since it is what a node is when it says nothing.
 *
 * Named for what a node *is*, never for the geometry, which is the same rule the
 * icon names follow: `document` and not `folded-corner`. A shape carrying a
 * conventional meaning is a second channel alongside color, and a stronger one
 * — a fill is whatever the author assigned and has to be learnt from the
 * diagram, while a folded corner has meant "an artifact, not a process" in
 * flowcharts for decades and reads with no legend at all.
 *
 * `circle` and `diamond` join these when a diagram asks. The set being short is
 * a fact about what has been drawn, not about the key.
 */
export const OUTLINES = ['rectangle', 'document'] as const;
export type Outline = (typeof OUTLINES)[number];

/** Every value `shape:` accepts, `none` included. */
export const SHAPE_WORDS = [...OUTLINES, 'none'] as const;

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
  | { kind: 'shape'; outline: Outline }
  | { kind: 'icon'; icon: Icon }
  | { kind: 'none' };

const PLAIN: Body = { kind: 'shape', outline: 'rectangle' };

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

  if (icon !== undefined) return { kind: 'icon', icon: iconNamed(icon, line) };
  if (shape === undefined) return PLAIN;
  if (shape === 'none') return { kind: 'none' };
  if ((OUTLINES as readonly string[]).includes(shape)) {
    return { kind: 'shape', outline: shape as Outline };
  }

  // Until 0.3.0 `shape:` also took an icon name and drew the node as that
  // picture. The two jobs are two parts and now have two keys, so an older file
  // is told which one it wanted rather than being drawn as a plain rectangle.
  if (ICONS[shape] !== undefined) {
    const now = shape === 'instance' ? 'cube' : shape;
    return refuse(
      `\`shape: ${shape}\` drew the node as a picture, and the picture is now \`icon:\` — ` +
        `try \`icon: ${now}\``,
      line,
    );
  }
  if (shape === 'instance') {
    return refuse('`shape: instance` is now `icon: cube` — the icon was renamed with it', line);
  }
  if (shape === 'box') {
    return refuse('`shape: box` is now `shape: rectangle`, since nothing else in the vocabulary is abbreviated', line);
  }
  return refuse(
    `there is no shape called "${shape}". The shapes are ${SHAPE_WORDS.join(', ')}, and a ` +
      `picture is \`icon:\` rather than \`shape:\`: ${ICON_NAMES.join(', ')}`,
    line,
  );
}

function refuse(message: string, line: number): never {
  throw new SourceError(message, line);
}

/**
 * The icon of that name, or an error listing the set.
 *
 * An unknown name is refused rather than dropped. That is the same rule
 * `DIAGRAM_KEYS` follows and it is here for the same reason: a misspelt
 * `icon: laptp` that quietly draws nothing is indistinguishable from the tool
 * being broken, and an author will stare at the file looking for the mistake in
 * the wrong place. Since the vocabulary is closed and short, the error can list
 * the whole of it.
 */
export function iconNamed(named: string, line: number): Icon {
  const icon = ICONS[named];
  if (icon === undefined) {
    const was = named === 'instance' ? ' — the cube was called `instance` until 0.3.0' : '';
    throw new SourceError(
      `there is no icon called "${named}". The icons are ${ICON_NAMES.join(', ')}${was}`,
      line,
    );
  }
  return icon;
}

/** The badge a node wears, or nothing. A small picture stamped beside its text. */
export function badgeFor(appearance: Record<string, string>, line: number): Icon | undefined {
  const named = appearance['badge'];
  if (named === undefined) return undefined;
  return iconNamed(named, line);
}
