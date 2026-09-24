/** Spacing and text sizes shared by the resolver and the renderer, so the two cannot drift. */
import type { Attrs, Position } from './ast.js';
import { POSITIONS, isPosition } from './ast.js';
import { SourceError } from './errors.js';
import type { Measurer } from './measure.js';
import { plain, type Line } from './text.js';

/** Inside a box, between its border and its contents. */
export const PAD = 14;
/** Between stacked children of one container. */
export const CHILD_GAP = 10;
/** Between a container's own text and its first child. */
export const HEADER_GAP = 10;
/**
 * How far each deck copy is offset behind the front face. It has to clear a
 * whole line of text plus the padding above it, or a copy's text is drawn and
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
 * Between two edges meeting the same side of the same box. An author names a
 * side, never a point on it, so this is the tool keeping two attachments apart
 * rather than a distance anyone asked for — small, like `SEPARATION_GAP`, and
 * squeezed further if the side is too short to hold the whole group.
 */
export const ATTACH_STEP = 16;
/** Kept clear at each end of a side, so an attachment never sits on a corner. */
export const ATTACH_MARGIN = 10;

/** How wide an edge's line is drawn. */
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
 * Line left showing between an edge's text and the box at that end of the
 * corridor it crosses.
 *
 * Unlike `SEPARATION_GAP` and `ATTACH_MARGIN` this is not "small on purpose".
 * Those two keep two things from touching, and the least distance that reads as
 * "not touching" is the right one. This one has something to show: a text sits
 * in a knockout that erases the line behind it, so whatever is left either side
 * is the entire evidence that the text belongs to an edge at all. At ten pixels
 * it did not read as a line — the seed diagram in the playground drew as a word
 * with a dash beside it — so it is the length of a run of line, not a margin.
 *
 * Say `gap:` if you want the corridor wider than its contents.
 */
export const TEXT_CLEARANCE = 20;

/**
 * How much room an edge's text takes along one axis.
 *
 * The knockout rectangle drawn behind a text is the text plus five either side,
 * so that rectangle, not the glyphs, is what must not overlap anything.
 *
 * Shared by the resolver, which widens a corridor to hold a text, and the
 * renderer, which spaces the lanes of a channel by it, so the two cannot
 * disagree about how much room a text needs. The two ask different questions of
 * it and both are right: the resolver measures *along* the run, so an edge
 * traveling horizontally needs the text's width; the renderer measures *across*
 * the channel, so an edge traveling horizontally down one needs its height.
 */
export function textExtent(
  lines: Line[],
  textAttrs: Attrs,
  axis: 'x' | 'y',
  measurer: Measurer,
  fontSize: number,
  line: number,
): number {
  const size = fontSizeFor('edge', textAttrs, fontSize, line);
  const width = lines.reduce(
    (widest, drawn) => Math.max(widest, measurer.measure(plain(drawn), size).width),
    0,
  );
  return axis === 'x' ? width + 10 : lines.length * measurer.lineHeight(size);
}

/**
 * The widest of these lines, which is how wide the block of them is. Shared by
 * the resolver, which sizes a node to hold its text, and the renderer, which
 * places that block in the room the node gave it.
 */
export function widestLine(lines: Line[], measurer: Measurer, fontSize: number): number {
  return lines.reduce(
    (widest, line) => Math.max(widest, measurer.measure(plain(line), fontSize).width),
    0,
  );
}

/**
 * An icon is two lines of the text tall, and that ratio is what makes it a
 * *text-sized* ornament rather than a picture with a size of its own. It is
 * read off the reference, where the title lines run 25 pixels baseline to
 * baseline and the drive and machine glyphs are close to 50 tall. Deriving it
 * from the text also means an icon on a `size: small` node shrinks with it,
 * which is what anyone would expect and what a fixed pixel count would not do.
 */
export const ICON_LINES = 2;
/** Between the text column and the icon column beside it. */
export const ICON_GAP = 10;

export const DEFAULT_FONT_SIZE = 14;

/**
 * The named text sizes, each a multiple of the document's own size. A plain
 * number of pixels is accepted too, as it is for a gap: nothing else in the
 * diagram moving can make it wrong. The names stay the default because they
 * follow the document's size when that is retuned, and a number does not.
 *
 * `small` is sampled rather than chosen. In
 * `examples/reference/arch.png` the box and container texts run 25
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
 * What each kind of text is set at when the file says nothing. A node with no
 * body annotates the diagram rather than being part of it, and at the size of a
 * box text an aside reads as a statement — so `shape: none` starts small and
 * says so by having no body. This is a default and not a ceiling: `(size: …)`
 * in the text's brackets overrides it, the same way `fill:` overrides the
 * theme's color.
 */
const DEFAULT_TEXT_SIZE: Record<string, string> = { none: 'small' };

/**
 * The size a piece of text is set at. Shared by the resolver, which reserves
 * the room, and the renderer, which fills it, so the two cannot disagree about
 * how much room there is.
 */
export function fontSizeFor(
  kind: string,
  textAttrs: Attrs,
  fontSize: number,
  line: number,
): number {
  const named = textAttrs['size'] ?? DEFAULT_TEXT_SIZE[kind] ?? 'normal';
  const scale = TEXT_SIZES[named];
  if (scale !== undefined) return Math.round(fontSize * scale);
  if (/^\d+(\.\d+)?$/.test(named) && Number(named) > 0) return Number(named);
  const unit = named.match(/^(\d+(?:\.\d+)?)px$/);
  const hint = unit
    ? `; write "size: ${unit[1]}", a size's number is already in pixels`
    : named.startsWith('-') || /^0+(\.0+)?$/.test(named)
      ? '; a text size has to be more than zero'
      : '';
  throw new SourceError(
    `size takes ${Object.keys(TEXT_SIZES).join(', ')} or a number of pixels, not "${named}"${hint}`,
    line,
  );
}

export const DEFAULT_MARGIN = 40;

/**
 * Where a node's own text sits, and how its lines range once it is there.
 *
 * `at` names one of the nine positions of the box — the same closed set the
 * overlay placement uses, and for the same reason: a box has nine points anyone
 * can name without measuring, and a diagram written in them still moves
 * correctly when a box moves. It replaced `top | bottom`, which was a slot: two
 * of the nine handed out because those were the two somebody needed.
 *
 * The two halves are read independently, exactly as `overlaidAt` reads an
 * overlay's. The vertical half says which end of the box the text's band sits
 * at, and the contents of a container take the other end. The horizontal half
 * says where the block of text sits across the room it is given.
 *
 * `align` is a different question and stays one: a text of more than one line
 * has lines of unequal length wherever the block sits, and how those range
 * against each other is not where the block is. A container's lines default to
 * ranged left and a leaf's to centered, which is why the fallback is a
 * parameter.
 */
export interface TextStyle {
  at: Position;
  /** Which end of the box the text's band sits at, from `at`'s vertical half. */
  end: 'top' | 'center' | 'bottom';
  /** Where the block sits across the room, from `at`'s horizontal half. */
  side: 'left' | 'center' | 'right';
  /** How the lines range against each other, in the renderer's own vocabulary. */
  align: 'start' | 'middle' | 'end';
}

/**
 * Author's word to the SVG's. One spelling of each, per the rule that refuses
 * synonyms for `node` and `edge`: an alias is a variant a reader has to learn,
 * and every document and example has to pick one of them anyway.
 */
const TEXT_ALIGNMENTS: Record<string, 'start' | 'middle' | 'end'> = {
  left: 'start',
  center: 'middle',
  right: 'end',
};

/**
 * Read a text's bracketed modifiers. Shared by the resolver, which offsets the
 * contents away from the band, and the renderer, which draws into it, so the two
 * cannot disagree about which end the band is at.
 */
export function textStyleFor(
  attrs: Attrs,
  line: number,
  fallbackAlign: 'start' | 'middle' = 'start',
  fallbackAt: Position = 'top-left',
): TextStyle {
  const written = attrs['at'];
  if (written !== undefined && !isPosition(written)) {
    // A bare side word is the one mistake worth naming rather than only
    // refusing: it was the whole vocabulary until 0.3.0, and the point at the
    // middle of that side is exactly one word away.
    const midpoint = `${written}-center`;
    throw new SourceError(
      isPosition(midpoint)
        ? `a text sits at a *point* of the box, and "${written}" names a side — write "${midpoint}" for the point at the middle of it`
        : `a text's at takes one of ${POSITIONS.join(', ')}, not "${written}"`,
      line,
    );
  }
  const at = (written as Position | undefined) ?? fallbackAt;
  const align = attrs['align'];
  if (align !== undefined && TEXT_ALIGNMENTS[align] === undefined) {
    throw new SourceError(`a text's align takes left, center or right, not "${align}"`, line);
  }
  const parts = at.split('-');
  return {
    at,
    end: parts.includes('top') ? 'top' : parts.includes('bottom') ? 'bottom' : 'center',
    side: parts.includes('left') ? 'left' : parts.includes('right') ? 'right' : 'center',
    align: align === undefined ? fallbackAlign : TEXT_ALIGNMENTS[align]!,
  };
}

/**
 * Where a leaf's text or badge starts vertically, given which end it sits at.
 * Shared, because the resolver works out the text's box and the renderer draws
 * it, and the two must not be able to disagree.
 */
export function leafTop(
  end: 'top' | 'center' | 'bottom',
  y: number,
  height: number,
  own: number,
): number {
  if (end === 'top') return y + PAD;
  if (end === 'bottom') return y + height - PAD - own;
  return y + (height - own) / 2;
}
