// Print how `src/grammar.ts` classifies a .reladraw file, one line at a time.
//
// The syntax coloring in the playground is drawn behind a transparent
// textarea, so every character of the source has to come out of the scanner
// exactly once and in order — a dropped one slides the whole rest of the line
// out of register with the text the reader is typing. That is invisible in a
// screenshot and obvious here, so this checks it as well as showing the
// classification. Reached through ./dev.sh tokens.
import { readFileSync } from 'node:fs';
import { highlightLine } from '../dist/index.js';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: tokens.mjs <file.reladraw>');
  process.exit(2);
}

// A letter per kind, so a whole file's coloring reads as a shape under the
// source rather than as a wall of names.
const MARK = {
  comment: '.',
  string: 's',
  keyword: 'K',
  name: 'N',
  arrow: '>',
  relation: 'r',
  attribute: 'a',
  value: 'v',
  color: '#',
  bracket: '(',
  plain: ' ',
};

let broken = 0;

readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .forEach((line, index) => {
    const spans = highlightLine(line);

    let at = 0;
    let rebuilt = '';
    let marks = '';
    for (const span of spans) {
      if (span.start !== at) broken += 1;
      at = span.end;
      rebuilt += line.slice(span.start, span.end);
      marks += (MARK[span.kind] ?? '?').repeat(span.end - span.start);
    }
    if (rebuilt !== line) broken += 1;

    const number = String(index + 1).padStart(4);
    console.log(`${number}  ${line}`);
    if (marks.trim() !== '') console.log(`      ${marks}`);
  });

console.log(broken === 0 ? '\nevery line reconstructs from its spans' : `\n${broken} line(s) do not`);
process.exit(broken === 0 ? 0 : 1);
