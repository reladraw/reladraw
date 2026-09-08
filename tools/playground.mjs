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
const template = join(root, 'tools', 'playground.html');
const target = join(root, 'docs', 'index.html');

/** What the page is allowed to reach: the pipeline, plus what it needs to report an error. */
const EXPOSED = ['compile', 'SourceError'];

const IMPORT = /^import\s+[\s\S]*?\s+from\s+'([^']+)';$/gm;
const REEXPORT = /^export\s+(?:\*|\{[\s\S]*?\})\s+from\s+'[^']+';$/gm;
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
    for (const match of source.matchAll(IMPORT)) {
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

const page = readFileSync(template, 'utf8');
const marker = '<!-- RELADRAW_BUNDLE -->';
if (!page.includes(marker)) throw new Error(`${template} has no ${marker} to replace`);

// A literal </script> anywhere in the library would close the tag early. Nothing
// emits one today; escaping it costs nothing and removes the whole class.
writeFileSync(
  target,
  page.replace(marker, `<script>\n${bundle.replace(/<\/script/gi, '<\\/script')}\n</script>`),
);

console.log(`${target}  (${modules.length} modules, ${bundle.length} bytes inlined)`);
