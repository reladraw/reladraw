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
 * knockout a link label already uses. Naming tones instead of colors is what
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
   * `shape: instance` is how you draw them.
   */
  cubes: {
    grid: GRID,
    paths: [...cube(6.6, 2.6, 4.4), ...cube(17.4, 2.6, 4.4), ...cube(12, 11.6, 4.4)],
  },

  /** One unit of the kind `cubes` shows several of. */
  instance: {
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
 * The icon a node asks for, or nothing. Called by the resolver, which reserves
 * the room, and by the renderer, which fills it, so the two cannot disagree
 * about whether there is an icon at all.
 *
 * An unknown name is refused rather than dropped. That is the same rule
 * `DIAGRAM_KEYS` follows and it is here for the same reason: a misspelt
 * `icon: laptp` that quietly draws nothing is indistinguishable from the tool
 * being broken, and an author will stare at the file looking for the mistake in
 * the wrong place. Since the vocabulary is closed and short, the error can list
 * the whole of it.
 */
/**
 * The outlines a box can take. `box` is the plain rectangle and needs no word.
 *
 * Named for what a node *is*, never for the geometry, which is the same rule the
 * icon names follow: `document` and not `folded-corner`. A shape carrying a
 * conventional meaning is a second channel alongside color, and a stronger one
 * — a fill is whatever the author assigned and has to be learnt from the
 * diagram, while a folded corner has meant "an artifact, not a process" in
 * flowcharts for decades and reads with no legend at all.
 */
export const BOX_SHAPES = ['document'] as const;
export type BoxShape = 'box' | (typeof BOX_SHAPES)[number];

export interface NodeShape {
  outline: BoxShape;
  /**
   * Set when the node is drawn as a glyph rather than as a box. There is then
   * no outline, no fill and no padding: the node *is* the picture, and its size
   * is the picture's. `icon:` decorates a box, this replaces it.
   */
  body?: Icon;
}

const PLAIN: NodeShape = { outline: 'box' };

/**
 * What a node is drawn as. Shared by the resolver, which sizes it, and the
 * renderer, which draws it.
 *
 * The value is either a box outline or the name of a glyph. Those are the two
 * things "what is this drawn as" can answer, and the author has no reason to
 * care which category their answer fell into. The test that separates them is
 * whether the node still sizes itself from its label: a `document` does, a
 * glyph does not.
 */
export function shapeFor(appearance: Record<string, string>, line: number): NodeShape {
  const named = appearance['shape'];
  if (named === undefined) return PLAIN;
  if (named === 'box') return PLAIN;
  if ((BOX_SHAPES as readonly string[]).includes(named)) return { outline: named as BoxShape };
  const glyph = ICONS[named];
  if (glyph !== undefined) return { outline: 'box', body: glyph };
  throw new SourceError(
    `there is no shape called "${named}". The shapes are box, ${BOX_SHAPES.join(', ')}, ` +
      `and any icon drawn as the node itself: ${ICON_NAMES.join(', ')}`,
    line,
  );
}

export function iconFor(appearance: Record<string, string>, line: number): Icon | undefined {
  const named = appearance['icon'];
  if (named === undefined) return undefined;
  const icon = ICONS[named];
  if (icon === undefined) {
    throw new SourceError(`there is no icon called "${named}". The icons are ${ICON_NAMES.join(', ')}`, line);
  }
  return icon;
}
