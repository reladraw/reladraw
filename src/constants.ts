/** Spacing and text sizes shared by the resolver and the renderer, so the two cannot drift. */
import type { Attrs } from './ast.js';
import { SourceError } from './errors.js';
import type { Measurer } from './measure.js';

/** Inside a box, between its border and its contents. */
export const PAD = 14;
/** Between stacked children of one container. */
export const CHILD_GAP = 10;
/** Between a container's own label and its first child. */
export const HEADER_GAP = 10;
/**
 * How far each deck copy is offset behind the front face. It has to clear a
 * whole line of text plus the padding above it, or a copy's label is drawn and
 * then immediately covered by the copy in front of it.
 */
export const DECK_STEP = 34;
/**
 * The named gaps a placement may ask for, each a *minimum* distance rather than a
 * fixed one. Anything the author puts between two things widens the space
 * between them on its own, so no gap here ever has to be chosen large enough
 * to leave room for something else.
 */
export const GAPS: Record<string, number> = {
  // A zero gap turns an offset into edge-to-edge contact, so "my top edge
  // against Docker's bottom edge" needs no vocabulary of its own.
  none: 0,
  tight: 24,
  normal: 56,
  wide: 110,
};

/**
 * How far apart two boxes are pushed when they would otherwise overlap. Small
 * on purpose: this is the tool enforcing something the author did not write, so
 * the space it leaves should read as "these are not the same box" and never as
 * a relationship someone stated. Say `gap:` if you want breathing room.
 */
export const SEPARATION_GAP = GAPS['tight']!;

/**
 * Between two links meeting the same side of the same box. An author names a
 * side, never a point on it, so this is the tool keeping two attachments apart
 * rather than a distance anyone asked for — small, like `SEPARATION_GAP`, and
 * squeezed further if the side is too short to hold the whole group.
 */
export const ATTACH_STEP = 16;
/** Kept clear at each end of a side, so an attachment never sits on a corner. */
export const ATTACH_MARGIN = 10;

/** How wide a link's line is drawn. */
export const LINE_WIDTH = 1.6;
/**
 * The arrowhead's length, in the `markerUnits="strokeWidth"` the marker is
 * declared in, so its drawn length is this times `LINE_WIDTH`.
 */
export const ARROW_MARKER_WIDTH = 7;
/**
 * How much of the line an arrowhead covers. Derived rather than written down,
 * because the resolver reserves it and the renderer draws it, and a number
 * agreed by coincidence is a number that drifts.
 */
export const ARROW_LENGTH = ARROW_MARKER_WIDTH * LINE_WIDTH;

/**
 * Line left showing between a link's label and the box at that end of the
 * corridor it crosses.
 *
 * Unlike `SEPARATION_GAP` and `ATTACH_MARGIN` this is not "small on purpose".
 * Those two keep two things from touching, and the least distance that reads as
 * "not touching" is the right one. This one has something to show: a label sits
 * in a knockout that erases the line behind it, so whatever is left either side
 * is the entire evidence that the label belongs to a link at all. At ten pixels
 * it did not read as a line — the seed diagram in the playground drew as a word
 * with a dash beside it — so it is the length of a run of line, not a margin.
 *
 * Say `gap:` if you want the corridor wider than its contents.
 */
export const LABEL_CLEARANCE = 20;

/**
 * How much room a link's label takes along one axis.
 *
 * The knockout rectangle drawn behind a label is the text plus five either side,
 * so that rectangle, not the glyphs, is what must not overlap anything.
 *
 * Shared by the resolver, which widens a corridor to hold a label, and the
 * renderer, which spaces the lanes of a channel by it, so the two cannot
 * disagree about how much room a label needs. The two ask different questions of
 * it and both are right: the resolver measures *along* the run, so a link
 * traveling horizontally needs the label's width; the renderer measures *across*
 * the channel, so a link traveling horizontally down one needs its height.
 */
export function labelExtent(
  label: string,
  appearance: Attrs,
  axis: 'x' | 'y',
  measurer: Measurer,
  fontSize: number,
  line: number,
): number {
  const size = fontSizeFor('link', appearance, fontSize, line);
  const { width, lines } = measurer.measure(label, size);
  return axis === 'x' ? width + 10 : lines.length * measurer.lineHeight(size);
}

/**
 * An icon is two lines of the label tall, and that ratio is what makes it a
 * *label-sized* ornament rather than a picture with a size of its own. It is
 * read off the reference, where the title lines run 25 pixels baseline to
 * baseline and the drive and machine glyphs are close to 50 tall. Deriving it
 * from the text also means an icon on a `size: small` node shrinks with it,
 * which is what anyone would expect and what a fixed pixel count would not do.
 */
export const ICON_LINES = 2;
/** Between the label column and the icon column beside it. */
export const ICON_GAP = 10;

export const DEFAULT_FONT_SIZE = 14;

/**
 * The named text sizes, each a multiple of the document's own size. Named
 * rather than numeric for the reason gaps are: a number here is typography by
 * coordinate. It goes stale the moment the document is set at another size, and
 * it says nothing about why one piece of text is smaller than another.
 *
 * `small` is sampled rather than chosen. In
 * `examples/reference/arch.png` the box and container labels run 25
 * pixels baseline to baseline and every annotation runs 21, which is this
 * ratio; `./dev.sh textrows` is how that was read off. `large` is the same step
 * taken the other way, so the scale is symmetric about the document size.
 */
export const TEXT_SIZES: Record<string, number> = {
  small: 21 / 25,
  normal: 1,
  large: 25 / 21,
};

/**
 * What each kind of text is set at when the file says nothing. A note annotates
 * the diagram rather than being part of it, and at the size of a box label an
 * aside reads as a statement — so `note` starts small and says so by being a
 * note. This is a default and not a ceiling: `size:` overrides it, the same way
 * `fill:` overrides the theme's color.
 */
const DEFAULT_TEXT_SIZE: Record<string, string> = { note: 'small' };

/**
 * The size a piece of text is set at. Shared by the resolver, which reserves
 * the room, and the renderer, which fills it, so the two cannot disagree about
 * how much room there is.
 */
export function fontSizeFor(
  kind: string,
  appearance: Attrs,
  fontSize: number,
  line: number,
): number {
  const named = appearance['size'] ?? DEFAULT_TEXT_SIZE[kind] ?? 'normal';
  const scale = TEXT_SIZES[named];
  if (scale === undefined) {
    throw new SourceError(`size takes ${Object.keys(TEXT_SIZES).join(', ')}, not "${named}"`, line);
  }
  return Math.round(fontSize * scale);
}

export const DEFAULT_MARGIN = 40;

/**
 * Where a container's own label sits. Every container reserves a band for its
 * label and its icon; `at` says which end of the box that band is, and the
 * contents take what is left. `align` says how the text sits across it.
 *
 * The two are independent and neither implies the other. A label at the bottom
 * is an ordinary label that happens to be at the bottom — there is no kind of
 * label being named here and no second thing quietly coming along with the
 * first. An earlier version bundled them as `label: heading | caption`, which
 * read a position as though it were a meaning; a folded corner means "artifact
 * rather than process" and a reader decodes it, while "lower down" means only
 * lower down.
 *
 * A leaf has no band, so `at` says nothing about one and is refused there. But
 * `align` is not about the band: a label of more than one line has lines of
 * unequal length whatever kind of box it is in, and how those sit across each
 * other is a real question anywhere. A leaf's default is centered rather than
 * ranged left, which is why the fallback is a parameter.
 */
export const LABEL_ENDS = ['top', 'bottom'] as const;
export type LabelEnd = (typeof LABEL_ENDS)[number];

/**
 * Author's word to the SVG's. One spelling of each, per the rule that refuses
 * synonyms for `box` and `link`: an alias is a variant a reader has to learn,
 * and every document and example has to pick one of them anyway.
 */
const LABEL_ALIGNMENTS: Record<string, 'start' | 'middle' | 'end'> = {
  left: 'start',
  center: 'middle',
  right: 'end',
};

export interface LabelStyle {
  /** Which end of the box the band sits at. */
  at: LabelEnd;
  /** How the text sits in the band, in the renderer's own vocabulary. */
  align: 'start' | 'middle' | 'end';
}

/**
 * Read a label's bracketed modifiers. Shared by the resolver, which offsets the
 * contents away from the band, and the renderer, which draws into it, so the two
 * cannot disagree about which end the band is at.
 */
export function labelStyleFor(
  label: Attrs,
  line: number,
  fallbackAlign: 'start' | 'middle' = 'start',
): LabelStyle {
  const at = label['at'];
  if (at !== undefined && !(LABEL_ENDS as readonly string[]).includes(at)) {
    throw new SourceError(`a label's at takes ${LABEL_ENDS.join(' or ')}, not "${at}"`, line);
  }
  const align = label['align'];
  if (align !== undefined && LABEL_ALIGNMENTS[align] === undefined) {
    throw new SourceError(`a label's align takes left, center or right, not "${align}"`, line);
  }
  return {
    at: (at as LabelEnd | undefined) ?? 'top',
    align: align === undefined ? fallbackAlign : LABEL_ALIGNMENTS[align]!,
  };
}
