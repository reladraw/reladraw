/**
 * Parse every fenced code block in a Markdown file and say which ones the
 * language does not accept.
 *
 * Every code block in `SYNTAX.md`, `README.md` and `SKILL.md` is supposed to be
 * a file this tool can read, and a reference teaching syntax that no longer
 * parses is worse than no reference. The check had never had a command, so it
 * was done by hand after a vocabulary change, or not at all.
 *
 * Not every block is a diagram — a shell snippet and a deliberate error example
 * are both legitimate — so this reports rather than judges, and the caller
 * decides. A block whose first line is not a statement keyword is skipped
 * outright, which is what keeps shell out of the report.
 */
import { readFileSync } from 'node:fs';
import { parse } from '../dist/index.js';

const KEYWORDS = ['node', 'note', 'edge', 'deck', 'style', 'diagram', '//'];

function blocksIn(source) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  let open = null;
  lines.forEach((line, index) => {
    if (line.startsWith('```')) {
      if (open === null) open = { start: index + 2, lines: [] };
      else {
        blocks.push(open);
        open = null;
      }
      return;
    }
    if (open !== null) open.lines.push(line);
  });
  return blocks;
}

/**
 * A block is a diagram if its first non-blank line opens a statement and the
 * block is not a sketch of the grammar. Two things are deliberately not
 * diagrams and would otherwise be reported forever: a form line written with
 * `<name>` placeholders, and the annotated statement whose second line is
 * carets pointing at the parts of the first.
 */
function isDiagram(block) {
  const first = block.lines.find((line) => line.trim() !== '');
  if (first === undefined) return false;
  const word = first.trim().split(/\s+/)[0];
  if (!KEYWORDS.some((keyword) => word === keyword || word.startsWith('//'))) return false;
  if (/<[a-z]/.test(first)) return false;
  return !block.lines.some((line) => /^\s*[\^|]/.test(line));
}

let checked = 0;
let failed = 0;
for (const path of process.argv.slice(2)) {
  for (const block of blocksIn(readFileSync(path, 'utf8'))) {
    if (!isDiagram(block)) continue;
    checked += 1;
    try {
      parse(block.lines.join('\n'));
    } catch (error) {
      failed += 1;
      const at = error.line === undefined ? '' : ` (block line ${error.line})`;
      console.log(`${path}:${block.start}${at}: ${error.message}`);
    }
  }
}
console.log(`${failed} of ${checked} diagram blocks do not parse`);
process.exit(failed === 0 ? 0 : 1);
