// Builds docs/index.html: the playground page with the compiled library inlined.
//
// ES modules do not load over file://, so a page that imports dist/ is neither
// double-clickable nor hostable without a server. Inlining the JavaScript into
// one <script> is what makes the page both, and it is the only reason this
// script exists. Run it through `./dev.sh playground`.
//
// The inlining is a flat concatenation, not a bundler. tsc emits one shape of
// module here — static single-line imports at the top, `export` on top-level
// declarations, no defaults, no cycles — so dropping the import lines and the
// `export` keywords and joining the files in dependency order gives one scope
// that behaves identically. The one thing that would break it silently is two
// modules declaring the same top-level name, so that is checked and refused.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const examples = join(root, 'examples');
const template = join(root, 'tools', 'playground.html');
const target = join(root, 'docs', 'index.html');

/**
 * What the page is allowed to reach: the pipeline, what it needs to report an
 * error, and the line scanner behind the editor's syntax colouring.
 */
const EXPOSED = ['compile', 'SourceError', 'highlightLine'];

// The examples the page offers, in the order the buttons appear. Every construct
// in the language is demonstrated by one of these files and by nothing else the
// page can reach, so leaving them out makes the playground a five-line demo. The
// list is stated rather than globbed: the order is the point (the benchmark
// first, then placement, appearance, links), and a new file under examples/ is
// not automatically something a stranger should be handed.
const OFFERED = [
  'arch',
  'regions',
  'gaps',
  'snug',
  'separation',
  'shapes',
  'icons',
  'labels',
  'lanes',
  'corridors',
  'overhang',
];

const IMPORT = /^import\s+[\s\S]*?\s+from\s+'([^']+)';$/gm;
const REEXPORT = /^export\s+(?:\*|\{[\s\S]*?\})\s+from\s+'([^']+)';$/gm;
const EMPTY_EXPORT = /^export\s*\{\s*\};$/gm;
const DECLARATION = /^export\s+(?:async\s+)?(function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;

function read(name) {
  return readFileSync(join(dist, name), 'utf8');
}

/** Depth-first over the import graph, so a module is emitted after everything it uses. */
function order(entry) {
  const emitted = [];
  const seen = new Set();
  const open = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    if (open.has(name)) throw new Error(`import cycle at ${name} — flat concatenation cannot express it`);
    open.add(name);
    const source = read(name);
    // Re-exports count as edges too. index.js reaches most of the library
    // through `export * from`, and a module that nothing else happens to import
    // would otherwise be left out of the bundle with no complaint until the
    // page called something that was not there.
    for (const match of [...source.matchAll(IMPORT), ...source.matchAll(REEXPORT)]) {
      visit(match[1].replace(/^\.\//, ''));
    }
    open.delete(name);
    seen.add(name);
    emitted.push([name, source]);
  };
  visit(entry);
  return emitted;
}

const modules = order('index.js');

// Two modules declaring one name would quietly shadow each other in a single
// scope, and the failure would be a wrong diagram rather than an error.
const owner = new Map();
for (const [name, source] of modules) {
  for (const match of source.matchAll(DECLARATION)) {
    const declared = match[2];
    const first = owner.get(declared);
    if (first) throw new Error(`${declared} is declared in both ${first} and ${name}`);
    owner.set(declared, name);
  }
}

for (const wanted of EXPOSED) {
  if (!owner.has(wanted)) throw new Error(`${wanted} is not exported by the library`);
}

const body = modules
  .map(([name, source]) =>
    [
      `// ---- ${name} ----`,
      source
        .replace(IMPORT, '')
        .replace(REEXPORT, '')
        .replace(EMPTY_EXPORT, '')
        .replace(/^export\s+/gm, '')
        .trim(),
    ].join('\n'),
  )
  .join('\n\n');

const bundle = [
  '(function () {',
  "'use strict';",
  body,
  `globalThis.reladraw = { ${EXPOSED.join(', ')} };`,
  '})();',
].join('\n');

const catalogue = OFFERED.map((name) => ({
  name,
  source: readFileSync(join(examples, `${name}.reladraw`), 'utf8'),
}));

const page = readFileSync(template, 'utf8');

function fill(text, marker, replacement) {
  if (!text.includes(marker)) throw new Error(`${template} has no ${marker} to replace`);
  // A literal </script> in the inlined text would close the tag early. Nothing
  // emits one today; escaping it costs nothing and removes the whole class.
  return text.replace(marker, `<script>\n${replacement.replace(/<\/script/gi, '<\\/script')}\n</script>`);
}

const catalogueScript = `globalThis.reladrawExamples = ${JSON.stringify(catalogue)};`;

writeFileSync(
  target,
  fill(
    fill(page, '<!-- RELADRAW_EXAMPLES -->', catalogueScript),
    '<!-- RELADRAW_BUNDLE -->',
    bundle,
  ),
);

console.log(
  `${target}  (${modules.length} modules, ${bundle.length} bytes inlined; ` +
    `${catalogue.length} examples, ${catalogueScript.length} bytes)`,
);
