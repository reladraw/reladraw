/**
 * The examples a page with no file offers, in the order its picker lists
 * them: the hosted playground, and `reladraw serve` with no file. Every
 * construct in the language is demonstrated by one of these files, so leaving
 * them out makes the playground a five-line demo. The list is stated rather
 * than globbed: the order is the point (the benchmark first, then placement,
 * appearance, edges), and a new file under examples/ is not automatically
 * something a stranger should be handed.
 *
 * Each file is listed under the name a stranger sees, with one short sentence
 * shown above its preview. The file names are coverage and are referred to
 * elsewhere; these are for someone who has not read the syntax yet, and say
 * what the picture shows. Keep the sentence to one line: the file's own
 * opening comment is there for anyone who wants more.
 */
export const OFFERED: readonly (readonly [file: string, name: string, about: string])[] = [
  ['arch', 'architecture', "A home network's file sync and backups, redrawn from a draw.io diagram."],
  ['regions', 'beside a group', 'A node placed against several others at once.'],
  ['points', 'points and regions', 'Places said in words and worked out from named things; turn on Guides in View to see how.'],
  ['gaps', 'gap sizes', 'Tight, wide and no gap, each on its own placement; a node has none of its own.'],
  ['snug', 'exactly as far', 'A gap is the distance asked for, not a minimum.'],
  ['contents', 'inside a container', 'How children line up in a container wider than they are.'],
  ['shapes', 'shapes', 'The outlines a node can be drawn with, and the pictures it can be drawn as.'],
  ['icons', 'icons', 'The seven icons, and the ways to use one.'],
  ['overlays', 'sides and corners', 'Nodes placed against part of another node: a side, a corner, or its text.'],
  ['frames', "on the parent's edge", "A child placed on its own container's side or corner."],
  ['text', 'room for labels', "A line's text takes no room of its own; the gap it sits in is stated."],
  ['lanes', 'side by side', 'Lines between the same two sides fan out as copies, and copies never cross.'],
  ['coincident', 'parallel edges', 'Several lines between the same two nodes: copies, or a bundle that bows them apart.'],
  ['bundles', 'bundles', 'Lines that travel together, each in its own lane, in one order across.'],
  ['corridors', 'through a gap', 'Lines sent through the point between two named nodes with via:.'],
  ['passes', 'saying where a line goes', 'Sides and points a line passes, named with via:.'],
  ['overhang', 'outside the nodes', 'Lines that run past the nodes, and the page grows to hold them.'],
  ['routing', 'going round boxes', 'Every routing bug reported so far, each line now stating its course.'],
  ['lines', 'line styles', 'Straight, square and curved lines, dashes, and how crossings are drawn.'],
  ['linetexts', 'texts on lines', "Where a line's text sits: the middle, a fraction along, beside, or a gap from an end."],
  ['marks', 'line ends', 'Arrowheads, dots, diamonds and bars at either end of a line, or none.'],
];

/**
 * The first thing a new visitor sees. No comments in it: every statement says
 * where a node goes, which is the whole point, and a paragraph explaining that
 * in advance only gets in the way.
 */
export const START = {
  name: 'start',
  about: 'Three boxes in a row, each a stated distance from the last.',
  source: [
    'node parser "Parser"',
    'node resolver "Resolver"  right of parser (gap: 12)',
    'node renderer "Renderer"  right of resolver (gap: 12)',
    '',
    'edge parser -> resolver    "statements"',
    'edge resolver -> renderer  "layout"',
    '',
  ].join('\n'),
};
