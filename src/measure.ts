/**
 * Text measurement, kept behind one interface on purpose.
 *
 * The parser and resolver are pure — text in, geometry out — and the only part
 * of the system that needs to know about fonts is this. In Node there is no
 * rendering engine to ask, so the default implementation assumes a monospace
 * face, where every glyph has the same advance width and the answer is
 * arithmetic. In a browser the same interface can be backed by the DOM, which
 * measures exactly.
 */

export interface TextBox {
  width: number;
  height: number;
  lines: string[];
}

export interface Measurer {
  /** Font family written into the SVG. Must match what was measured. */
  readonly fontFamily: string;
  measure(text: string, fontSize: number): TextBox;
  lineHeight(fontSize: number): number;
}

/**
 * A slash with whitespace on both sides marks a line break, so a label is
 * really a short stack of lines. Each line is trimmed; empty ones are dropped.
 *
 * The whitespace is what makes the marker safe. Splitting on a bare `/` meant
 * no label could contain one, so `TCP/IP` came out as two lines, and so did
 * `16/9`, `I/O` and every path or URL. Requiring the spaces keeps the marker
 * legible where it is meant — `"Computer 1 / Ubuntu"` — while a
 * slash inside a word stays an ordinary character.
 *
 * That leaves the label that wants a spaced slash and no break — `Before / After`
 * — which writes it `\/`. The lexer preserves that escape rather than resolving
 * it, so the backslash is still here to suppress the split, and is dropped once
 * the splitting is done.
 */
export function splitLines(text: string): string[] {
  const lines = text
    .split(/\s+\/\s+/)
    .map((part) => part.trim().replace(/\\\//g, '/'))
    .filter((part) => part.length > 0);
  return lines.length > 0 ? lines : [''];
}

/**
 * Every monospace face used here is assumed to advance 0.6 em per character.
 * DejaVu Sans Mono and Menlo both sit at 0.602; Consolas is narrower at 0.55,
 * so a diagram viewed with Consolas substituted in comes out uniformly tight
 * rather than raggedly wrong.
 */
const DEFAULT_ADVANCE_RATIO = 0.6;
const LINE_HEIGHT_RATIO = 1.35;

/**
 * Named families only, in order of likelihood, ending in the generic.
 * Deliberately no `ui-monospace`: it is a CSS keyword many SVG renderers do
 * not know, and it means "whatever this interface uses", which is not
 * guaranteed to be monospace at all. Every width here is computed on the
 * assumption that it is.
 */
const DEFAULT_STACK =
  '"DejaVu Sans Mono", "Menlo", "Consolas", "Liberation Mono", "Courier New", monospace';

export function monospaceMeasurer(
  fontFamily: string = DEFAULT_STACK,
  advanceRatio: number = DEFAULT_ADVANCE_RATIO,
): Measurer {
  return {
    fontFamily,

    lineHeight(fontSize: number): number {
      return Math.round(fontSize * LINE_HEIGHT_RATIO);
    },

    measure(text: string, fontSize: number): TextBox {
      const lines = splitLines(text);
      const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
      const lineHeight = Math.round(fontSize * LINE_HEIGHT_RATIO);
      return {
        width: Math.ceil(longest * fontSize * advanceRatio),
        height: lines.length * lineHeight,
        lines,
      };
    },
  };
}
