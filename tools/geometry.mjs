// Print the solved geometry of a .reladraw file, and any boxes that share space.
//
// This exists so a change to the resolver can be checked without rendering an
// image and looking at it. Reached through ./dev.sh boxes and ./dev.sh overlaps.
import { readFileSync } from 'node:fs';
import { parse, resolve } from '../dist/index.js';

const [mode, file] = process.argv.slice(2);
if (!file) {
  console.error('usage: geometry.mjs <boxes|overlaps> <file.reladraw>');
  process.exit(2);
}

let layout;
try {
  layout = resolve(parse(readFileSync(file, 'utf8')));
} catch (error) {
  console.error(`${file}:${error.line ?? '?'}: ${error.message}`);
  process.exit(1);
}

const round = (value) => Math.round(value * 10) / 10;

if (mode === 'boxes') {
  console.log(`canvas ${layout.width}x${layout.height}`);
  for (const node of layout.nodes) {
    console.log(
      `${node.name.padEnd(40)} x ${String(round(node.x)).padStart(7)}` +
        ` y ${String(round(node.y)).padStart(7)}` +
        ` w ${String(round(node.width)).padStart(7)}` +
        ` h ${String(round(node.height)).padStart(7)}`,
    );
  }
  process.exit(0);
}

if (mode !== 'overlaps') {
  console.error(`unknown mode "${mode}"`);
  process.exit(2);
}

// A container is meant to contain its descendants, so only unrelated pairs count.
const related = (a, b) => {
  for (let at = a; at; at = at.parent) if (at === b) return true;
  for (let at = b; at; at = at.parent) if (at === a) return true;
  return false;
};

// `overlap: allow` is the author saying they meant it, and the resolver already
// honors it. A check that reported those anyway would be reporting the file
// doing what it says, which trains you to ignore the output.
const allowed = (node) => node.attrs['overlap'] === 'allow';

let found = 0;
let permitted = 0;
for (let i = 0; i < layout.nodes.length; i += 1) {
  for (let j = i + 1; j < layout.nodes.length; j += 1) {
    const a = layout.nodes[i];
    const b = layout.nodes[j];
    if (related(a, b)) continue;
    const shared = {
      x: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
      y: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    };
    if (shared.x <= 0.001 || shared.y <= 0.001) continue;
    const by = `by ${round(shared.x)} x ${round(shared.y)}`;
    if (allowed(a) || allowed(b)) {
      permitted += 1;
      console.log(`${a.name} overlaps ${b.name} ${by} — allowed`);
      continue;
    }
    found += 1;
    console.log(`${a.name} overlaps ${b.name} ${by}`);
  }
}

const note = permitted === 0 ? '' : ` (${permitted} allowed)`;
console.log(found === 0 ? `no unintended overlapping boxes${note}` : `${found} overlapping pair(s)${note}`);
process.exit(found === 0 ? 0 : 1);
