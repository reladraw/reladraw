import { spawn } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceError } from './errors.js';
import { OFFERED, START } from './examples.js';
import { SETTINGS_FILE, settingsFileText, withSettings } from './format-settings.js';
import { drawListPage, drawPage, pageGrid, playgroundPage, type Example, type ListedDiagram, type ListFrom, type PageGrid } from './page.js';
import { impliedPageSpec, moveSpecPaths, PAGE_EXTENSION, parsePageSpec } from './page-spec.js';
import { DEFAULT_THEME } from './themes.js';

/**
 * `reladraw serve`: a page for one diagram, served on this machine and tied to
 * its file. The page redraws whenever the file changes on disk, whoever
 * changed it, so a person and an agent can both work on the one file. Given a
 * page spec, a folder or several files, the page is one of several diagrams,
 * and follows the spec and every diagram on it.
 *
 * One server serves a folder, the one it was started in. Asked for a second
 * file in that folder, `serve` finds the server already running and opens a
 * page on it rather than starting another. It listens only on this machine,
 * and serves only `.reladraw` and `.reladraw-page` files inside the folder,
 * and the library the page draws with.
 */

/** The port tried first, and how many after it are tried before giving up. */
export const FIRST_PORT = 4747;
const PORTS = 20;

const HELP = `reladraw serve [<file.reladraw>] [--no-open]
reladraw serve <page.reladraw-page | folder | a.reladraw b.reladraw...> [--no-open]

Serves a page for the diagram on this machine and opens it in the browser.
The page redraws whenever the file changes on disk, and its Save writes the
file. With no file, the page is a playground: the examples, and a Save that
names a file in the folder, after which the page follows that file. One
server serves the folder it was started in: serving another file in that
folder opens a page on the server already running. Ctrl-C stops it.

Given a page spec, a folder or several files, the page opens on an overview
of every diagram and follows each one, and the spec too. Edit on the
overview shows the spec, or the one a folder or the files imply, whose
first Save writes it as a .reladraw-page.

  --no-open   print the page's address instead of opening it.
`;

/** Where the library lives: the compiled files beside this one. */
const LIB = dirname(fileURLToPath(import.meta.url));

/** The examples a page with no file offers, which the package carries beside the library. */
async function examples(): Promise<Example[]> {
  const offered: Example[] = [START];
  for (const [file, name, about] of OFFERED) {
    try {
      offered.push({ name, about, source: await readFile(join(LIB, '..', 'examples', `${file}.reladraw`), 'utf8') });
    } catch {
      // A copy of the package without its examples still has a playground.
    }
  }
  return offered;
}

/** A folder as the page names it: from the home folder, as ~/proj, when it is inside it. */
function shown(folder: string): string {
  const home = homedir();
  const rel = relative(home, folder);
  return rel === '' ? '~' : !rel.startsWith('..') && !isAbsolute(rel) ? `~/${rel.split(sep).join('/')}` : folder;
}

interface Followed {
  /** The file's text as last read, or null before the first read. */
  text: string | null;
  /** When the text was last read, or last changed. */
  at: number;
  changed: boolean;
  /** Each page following the file, told whenever it changes. */
  listeners: Set<(entry: Followed) => void>;
  watcher: FSWatcher | null;
  timer: NodeJS.Timeout | null;
  /** The file's versions since the server first read it, oldest first. */
  versions: Version[];
}

/**
 * One version of a file: who wrote it, as far as the server can tell. A save
 * from the page is the person's; a change on disk is anyone's until an agent
 * describes it with `reladraw note`, which makes it the agent's.
 */
interface Version {
  text: string;
  at: number;
  who: 'opened' | 'you' | 'agent' | 'disk';
  note?: string;
}

/** How many versions a file keeps. */
const KEPT = 20;

function record(entry: Followed, text: string, who: Version['who'], at = Date.now()): void {
  entry.text = text;
  entry.at = at;
  entry.changed = who !== 'opened';
  entry.versions.push({ text, at, who });
  if (entry.versions.length > KEPT) entry.versions.splice(0, entry.versions.length - KEPT);
}

function newEntry(): Followed {
  return { text: null, at: Date.now(), changed: false, listeners: new Set(), watcher: null, timer: null, versions: [] };
}

/** The entry for a file, its text read if it hasn't been yet. */
async function entryFor(root: string, followed: Map<string, Followed>, path: string): Promise<Followed> {
  let entry = followed.get(path);
  if (!entry) {
    entry = newEntry();
    followed.set(path, entry);
  }
  if (entry.text === null) record(entry, await readFile(join(root, path), 'utf8'), 'opened');
  return entry;
}

function broadcast(entry: Followed): void {
  for (const listener of entry.listeners) listener(entry);
}

async function body(req: IncomingMessage): Promise<string> {
  let text = '';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 5_000_000) throw new Error('too large');
  }
  return text;
}

export async function serve(args: string[]): Promise<number> {
  const inputs: string[] = [];
  let open = true;
  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP);
      return 0;
    } else if (arg === '--no-open') {
      open = false;
    } else if (arg.startsWith('-')) {
      process.stderr.write(`reladraw: serve doesn't take ${arg}; it takes a file, a page spec, a folder or several files, and --no-open\n`);
      return 1;
    } else {
      inputs.push(arg);
    }
  }

  const root = await realpath(process.cwd());
  const asked = await pageAsked(root, inputs);
  if (typeof asked !== 'string') {
    process.stderr.write(`reladraw: ${asked.problem}\n`);
    return 1;
  }
  const path = asked;

  // A server already serving this folder is used as it is.
  for (let port = FIRST_PORT; port < FIRST_PORT + PORTS; port++) {
    const there = await whoIsOn(port);
    if (there === null) continue;
    if (there.root === root) {
      const address = pageAddress(port, path);
      // Said so an agent reading it takes it as done, not as a failure to retry.
      process.stdout.write(
        `reladraw is already serving ${root} at http://127.0.0.1:${port}/, so this uses that server; nothing else needs starting.\n` +
          `${open ? 'Opened ' : 'The page is '}${address}\n` +
          `It redraws whenever the file changes.\n`,
      );
      if (open) openInBrowser(address);
      return 0;
    }
  }

  const port = await listen(root);
  if (port === null) {
    process.stderr.write(`reladraw: no free port from ${FIRST_PORT} to ${FIRST_PORT + PORTS - 1}\n`);
    return 1;
  }
  const address = pageAddress(port, path);
  process.stdout.write(`reladraw is serving ${root} at http://127.0.0.1:${port}/ — Ctrl-C stops it\n${address}\n`);
  if (open) openInBrowser(address);
  // Runs until stopped.
  return new Promise<number>(() => {});
}

/** The page's address after the port: a path, with a query for a folder or several files. */
function pageAddress(port: number, path: string): string {
  const [where, query] = path.split('?');
  return `http://127.0.0.1:${port}/${where!.split('/').map(encodeURIComponent).join('/')}${query !== undefined ? `?${query}` : ''}`;
}

/**
 * The page the command line asks for, as its address on the server: nothing
 * for the playground, a file's or a spec's path, or `.page` with the folder
 * or the files; or what is wrong with what was given.
 */
async function pageAsked(root: string, inputs: string[]): Promise<string | { problem: string }> {
  if (inputs.length === 0) return '';
  const [first] = inputs;
  if (inputs.length === 1) {
    if (await isFolder(resolvePath(root, first!))) {
      const folder = await folderInside(root, first!);
      return typeof folder === 'string' ? `.page?${new URLSearchParams({ folder })}` : folder;
    }
    return insideRoot(root, first!);
  }
  const odd = await Promise.all(inputs.map(async (one) => (one.endsWith(PAGE_EXTENSION) || (await isFolder(resolvePath(root, one))) ? one : null)));
  const alone = odd.find((one) => one !== null);
  if (alone) return { problem: `${alone} makes a page of its own, so it goes on its own — reladraw serve ${alone}` };
  const files: string[] = [];
  for (const one of inputs) {
    const inside = await insideRoot(root, one);
    if (typeof inside !== 'string') return inside;
    if (files.includes(inside)) return { problem: `${one} is given twice — once is enough` };
    files.push(inside);
  }
  const query = new URLSearchParams();
  for (const file of files) query.append('file', file);
  return `.page?${query}`;
}

async function isFolder(path: string): Promise<boolean> {
  return stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

/** A folder's path inside the served one, with forward slashes, `.` for that folder itself; or what is wrong with it. */
async function folderInside(root: string, folder: string): Promise<string | { problem: string; status: number }> {
  let real: string;
  try {
    real = await realpath(resolvePath(root, folder));
    if (!(await stat(real)).isDirectory()) return { problem: `${folder} isn't a folder`, status: 404 };
  } catch {
    return { problem: `there is no folder ${folder}`, status: 404 };
  }
  const rel = relative(root, real);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { problem: `${folder} is outside ${root}, the folder serve was started in; start it in a folder that holds it`, status: 403 };
  }
  return rel === '' ? '.' : rel.split(sep).join('/');
}

/**
 * The file's path inside the folder, with forward slashes, or what is wrong
 * with it: outside the folder, not a .reladraw file or a page spec, or not there.
 */
async function insideRoot(root: string, file: string): Promise<string | { problem: string; status: number }> {
  if (extname(file) !== '.reladraw' && extname(file) !== PAGE_EXTENSION) {
    return { problem: `${file} isn't a .reladraw file or a ${PAGE_EXTENSION} spec`, status: 404 };
  }
  const full = isAbsolute(file) ? file : resolvePath(root, file);
  let real: string;
  try {
    real = await realpath(full);
    if (!(await stat(real)).isFile()) return { problem: `${file} isn't a file`, status: 404 };
  } catch {
    return { problem: `there is no ${file}`, status: 404 };
  }
  const rel = relative(root, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return {
      problem: `${file} is outside ${root}, the folder serve was started in; start it in a folder that holds the file`,
      status: 403,
    };
  }
  return rel.split(sep).join('/');
}

/** Which folder a reladraw server on this port serves, or null if none is there. */
function whoIsOn(port: number): Promise<{ root: string } | null> {
  return new Promise((done) => {
    const asking = request({ host: '127.0.0.1', port, path: '/.reladraw', timeout: 800 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => {
        try {
          const told = JSON.parse(body) as { reladraw?: boolean; root?: string };
          done(told.reladraw && typeof told.root === 'string' ? { root: told.root } : null);
        } catch {
          done(null);
        }
      });
    });
    asking.on('error', () => done(null));
    asking.on('timeout', () => {
      asking.destroy();
      done(null);
    });
    asking.end();
  });
}

function listen(root: string): Promise<number | null> {
  const followed = new Map<string, Followed>();
  const server = createServer((req, res) => {
    handle(root, followed, req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(error instanceof Error ? error.message : error));
    });
  });
  return new Promise((done) => {
    const attempt = (port: number) => {
      if (port >= FIRST_PORT + PORTS) return done(null);
      // Each try takes its own two listeners off again: a 'listening' left from a
      // taken port would fire when a later port binds, and report the taken one.
      const taken = () => {
        server.off('listening', bound);
        attempt(port + 1);
      };
      const bound = () => {
        server.off('error', taken);
        done(port);
      };
      server.once('error', taken);
      server.once('listening', bound);
      server.listen(port, '127.0.0.1');
    };
    attempt(FIRST_PORT);
  });
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

async function handle(root: string, followed: Map<string, Followed>, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Only pages from this server may use it: a page on some other site could
  // otherwise reach it through a name that resolves to this machine.
  const host = req.headers.host ?? '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('reladraw serves only this machine\n');
    return;
  }
  const url = new URL(req.url ?? '/', `http://${host}`);
  const path = decodeURIComponent(url.pathname);

  if (path === '/.reladraw') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ reladraw: true, root }));
    return;
  }

  // The library's own files; anything else under /lib/ is a diagram in a
  // folder called lib, served as any other.
  if (/^\/lib\/[a-z0-9-]+\.js$/.test(path)) {
    const name = path.slice('/lib/'.length);
    try {
      const code = await readFile(join(LIB, name));
      res.writeHead(200, { 'content-type': TYPES['.js']!, 'cache-control': 'no-store' });
      res.end(code);
    } catch {
      notFound(res, path);
    }
    return;
  }

  if (path === '/events') {
    const inside = await insideRoot(root, url.searchParams.get('file') ?? '');
    if (typeof inside !== 'string') return refuse(res, inside);
    return follow(root, followed, inside, res);
  }

  if (path === '/list-events') {
    const from = await listFrom(root, url);
    if ('problem' in from) return refuse(res, from);
    return followList(root, followed, from, res);
  }

  if (path === '/.page') {
    const from = await listFrom(root, url);
    if ('problem' in from) return refuse(res, from);
    return listPage(root, followed, from, res);
  }

  // What changes a file comes only from a page this server served: a page on
  // another site sends its own origin, and is refused.
  if (req.method === 'POST' && req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('reladraw: only its own pages may change a file\n');
    return;
  }

  if (path === '/save' && req.method === 'POST') return save(root, followed, url, req, res);
  if (path === '/create' && req.method === 'POST') return create(root, followed, url, req, res);
  if (path === '/note' && req.method === 'POST') return note(root, followed, url, req, res);

  if (path === '/format-settings') {
    const inside = await insideRoot(root, url.searchParams.get('file') ?? '');
    if (typeof inside !== 'string') return refuse(res, inside);
    const settings = await settingsFor(root, inside);
    if (req.method === 'POST') return saveSettings(root, settings, req, res);
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-reladraw-format-file': encodeURIComponent(relative(root, settings.target).split(sep).join('/')),
    });
    res.end(settings.text);
    return;
  }

  if (path === '/') {
    res.writeHead(200, { 'content-type': TYPES['.html']!, 'cache-control': 'no-store' });
    res.end(playgroundPage({ examples: await examples(), folder: shown(root) }));
    return;
  }

  const inside = await insideRoot(root, path.slice(1));
  if (typeof inside !== 'string') return refuse(res, inside);
  if (inside.endsWith(PAGE_EXTENSION)) return listPage(root, followed, { spec: inside }, res);
  const text = await readFile(join(root, inside), 'utf8');
  let html: string;
  try {
    html = drawPage(text, basename(inside), {}, new Date(), { kind: 'file', file: inside }).html;
  } catch {
    // A file that doesn't draw yet still gets its page, drawn empty. The
    // file's text arrives with the page's first event, fails there too, and
    // the page shows the error, then draws as soon as the file does.
    html = drawPage('', basename(inside), {}, new Date(), { kind: 'file', file: inside }).html;
  }
  res.writeHead(200, { 'content-type': TYPES['.html']!, 'cache-control': 'no-store' });
  res.end(html);
}

function notFound(res: ServerResponse, path: string): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`reladraw: nothing at ${path}\n`);
}

function refuse(res: ServerResponse, why: { problem: string; status: number }): void {
  res.writeHead(why.status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`reladraw: ${why.problem}\n`);
}

/**
 * Sends the file's text now and again each time it changes, as server-sent
 * events. The folder is watched rather than the file, because an editor that
 * saves by writing a new file and renaming it over the old one leaves a watch
 * on the old file watching nothing.
 */
async function follow(root: string, followed: Map<string, Followed>, path: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const one = await entryFor(root, followed, path);
  const tell = () => send(res, one);
  one.listeners.add(tell);
  tell();
  const keepAlive = setInterval(() => res.write(': still here\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(keepAlive);
    one.listeners.delete(tell);
  });
  watchEntry(root, path, one);
}

/** Watches a followed file, once, telling its pages when its text changes on disk. */
function watchEntry(root: string, path: string, one: Followed): void {
  if (one.watcher) return;
  const full = join(root, path);
  const name = basename(full);
  one.watcher = watch(dirname(full), (_event, changed) => {
    if (changed !== null && changed.toString() !== name) return;
    // Editors write in bursts; read once they settle.
    if (one.timer) clearTimeout(one.timer);
    one.timer = setTimeout(() => {
      one.timer = null;
      readFile(full, 'utf8').then(
        (text) => {
          if (text === one.text) return;
          record(one, text, 'disk');
          broadcast(one);
        },
        () => {
          // Gone for the moment, as between an editor's delete and its
          // rename; the next change brings it back.
        },
      );
    }, 60);
  });
}

/**
 * The file's text, when it was read or changed and by whom, and its versions,
 * newest last, each with its text, so the page can offer any of them back.
 * On a page of several, `file` says which file it is.
 */
function send(res: ServerResponse, entry: Followed, file?: string): void {
  const last = entry.versions[entry.versions.length - 1];
  const message = {
    ...(file !== undefined ? { file } : {}),
    text: entry.text,
    at: entry.at,
    changed: entry.changed,
    who: last?.who ?? 'opened',
    note: last?.note ?? null,
    versions: entry.versions,
  };
  res.write(`event: source\ndata: ${JSON.stringify(message)}\n\n`);
}

/** What a page of several diagrams lists, from its address's query: a spec, a folder, or files. */
async function listFrom(root: string, url: URL): Promise<ListFrom | { problem: string; status: number }> {
  const spec = url.searchParams.get('spec');
  if (spec !== null) {
    const inside = await insideRoot(root, spec);
    if (typeof inside !== 'string') return inside;
    if (!inside.endsWith(PAGE_EXTENSION)) return { problem: `${spec} isn't a ${PAGE_EXTENSION} spec`, status: 404 };
    return { spec: inside };
  }
  const folder = url.searchParams.get('folder');
  if (folder !== null) {
    const inside = await folderInside(root, folder);
    return typeof inside === 'string' ? { folder: inside } : inside;
  }
  const files: string[] = [];
  for (const file of url.searchParams.getAll('file')) {
    const inside = await insideRoot(root, file);
    if (typeof inside !== 'string') return inside;
    if (!inside.endsWith('.reladraw')) return { problem: `a page lists .reladraw diagrams, and ${file} isn't one`, status: 404 };
    if (!files.includes(inside)) files.push(inside);
  }
  if (files.length === 0) return { problem: 'a page of several diagrams needs a spec, a folder or files', status: 404 };
  return { files };
}

/**
 * What a served page of several diagrams lists now: its title and theme, its
 * diagrams by their paths inside the folder served, with their labels and the
 * spec's line for each; the spec's diagrams that aren't there; why the spec
 * doesn't read, if it doesn't; and with no spec, the spec the folder or files
 * imply, with paths from the folder served.
 */
interface Listing {
  title: string;
  theme: string;
  items: { file: string; label?: string; group?: string; cell?: { row: string; column: string }; line?: number }[];
  /** The spec's groups in order, empty ones included. */
  groups: string[];
  /** A grid's rows and columns; none for a list. */
  grid?: PageGrid;
  missing: { file: string; line: number; problem: string }[];
  error: { message: string; line?: number } | null;
  implied: string | null;
}

async function listingOf(root: string, followed: Map<string, Followed>, from: ListFrom): Promise<Listing> {
  if ('spec' in from) {
    const named = basename(from.spec).slice(0, -PAGE_EXTENSION.length);
    const entry = await entryFor(root, followed, from.spec);
    let read;
    try {
      read = parsePageSpec(entry.text ?? '');
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      return { title: named, theme: DEFAULT_THEME, items: [], groups: [], missing: [], error: { message: error.message, line: error.line }, implied: null };
    }
    const items: Listing['items'] = [];
    const missing: Listing['missing'] = [];
    for (const one of read.entries) {
      const file = posix.normalize(posix.join(posix.dirname(from.spec), one.path));
      const inside = await insideRoot(root, file);
      if (typeof inside === 'string') {
        items.push({
          file: inside,
          ...(one.label !== undefined ? { label: one.label } : {}),
          ...(one.group !== undefined ? { group: one.group } : {}),
          ...(one.cell !== undefined ? { cell: one.cell } : {}),
          line: one.line,
        });
      }
      else {
        missing.push({
          file,
          line: one.line,
          problem: inside.status === 403 ? `${one.path} is outside the folder reladraw serve was started in` : `there is no ${one.path} — a diagram's path is from the spec's folder`,
        });
      }
    }
    return {
      title: read.title ?? named,
      theme: read.theme ?? DEFAULT_THEME,
      items,
      groups: read.groups.map((one) => one.name),
      ...(read.grid ? { grid: pageGrid(read.grid) } : {}),
      missing,
      error: null,
      implied: null,
    };
  }
  let files: string[];
  let title: string;
  if ('folder' in from) {
    const names = (await readdir(join(root, from.folder), { withFileTypes: true }))
      .filter((one) => one.isFile() && one.name.endsWith('.reladraw'))
      .map((one) => one.name)
      .sort((a, b) => a.localeCompare(b));
    files = names.map((name) => (from.folder === '.' ? name : `${from.folder}/${name}`));
    title = basename(join(root, from.folder));
  } else {
    files = from.files;
    title = 'diagrams';
  }
  const implied =
    files.length > 0 ? impliedPageSpec(title, files) : `page  title: ${JSON.stringify(title)}  kind: list\n`;
  return { title, theme: DEFAULT_THEME, items: files.map((file) => ({ file })), groups: [], missing: [], error: null, implied };
}

/** The page of several diagrams, drawn as it stands, which then follows them through `followList`. */
async function listPage(root: string, followed: Map<string, Followed>, from: ListFrom, res: ServerResponse): Promise<void> {
  const listing = await listingOf(root, followed, from);
  const diagrams: ListedDiagram[] = [];
  for (const item of listing.items) {
    const entry = await entryFor(root, followed, item.file);
    diagrams.push({
      source: entry.text ?? '',
      file: basename(item.file),
      path: item.file,
      ...(item.label !== undefined ? { label: item.label } : {}),
      ...(item.group !== undefined ? { group: item.group } : {}),
      ...(item.cell !== undefined ? { cell: item.cell } : {}),
    });
  }
  const { html } = drawListPage(listing.title, diagrams, new Date(), listing.theme, { kind: 'list', from, folder: shown(root) }, listing.groups, listing.grid);
  res.writeHead(200, { 'content-type': TYPES['.html']!, 'cache-control': 'no-store' });
  res.end(html);
}

/**
 * A page of several diagrams' stream: what it lists, now and whenever that
 * changes, as a `list` event, and each file's text, the spec's included, as
 * a `source` event naming the file, now and whenever it changes. One stream
 * carries them all, since a browser opens only a few streams to one server.
 * A spec that changes is read again for its list; a folder is watched for
 * diagrams added to it or taken out.
 */
async function followList(root: string, followed: Map<string, Followed>, from: ListFrom, res: ServerResponse): Promise<void> {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const subscribed = new Map<string, { entry: Followed; tell: (entry: Followed) => void }>();
  let last: Listing | null = null;
  let sent = '';
  let closed = false;
  let queue = Promise.resolve();
  const relist = () => {
    queue = queue.then(step).catch(() => {
      // A folder or spec gone for the moment; the next change lists it again.
    });
  };
  const step = async () => {
    if (closed) return;
    let next = await listingOf(root, followed, from);
    // A spec that stops reading keeps the diagrams it last listed.
    if (next.error && last) next = { ...last, error: next.error };
    last = next;
    const message = JSON.stringify(next);
    if (message !== sent) {
      sent = message;
      res.write(`event: list\ndata: ${message}\n\n`);
    }
    const wanted = new Set(next.items.map((item) => item.file));
    if ('spec' in from) wanted.add(from.spec);
    for (const [file, one] of subscribed) {
      if (wanted.has(file)) continue;
      one.entry.listeners.delete(one.tell);
      subscribed.delete(file);
    }
    for (const file of wanted) {
      if (subscribed.has(file) || closed) continue;
      let entry: Followed;
      try {
        entry = await entryFor(root, followed, file);
        // Read afresh: the page was drawn from an earlier read, which no watcher may have followed.
        const now = await readFile(join(root, file), 'utf8');
        if (now !== entry.text) record(entry, now, 'disk');
      } catch {
        continue;
      }
      const tell = (changed: Followed) => {
        send(res, changed, file);
        if ('spec' in from && file === from.spec) relist();
      };
      entry.listeners.add(tell);
      subscribed.set(file, { entry, tell });
      watchEntry(root, file, entry);
      send(res, entry, file);
    }
  };
  let folderWatch: FSWatcher | null = null;
  let settle: NodeJS.Timeout | null = null;
  if ('folder' in from) {
    folderWatch = watch(join(root, from.folder), (_event, changed) => {
      if (changed !== null && !changed.toString().endsWith('.reladraw')) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(relist, 100);
    });
  }
  const keepAlive = setInterval(() => res.write(': still here\n\n'), 25_000);
  res.on('close', () => {
    closed = true;
    clearInterval(keepAlive);
    if (settle) clearTimeout(settle);
    folderWatch?.close();
    for (const one of subscribed.values()) one.entry.listeners.delete(one.tell);
    subscribed.clear();
  });
  relist();
}

function reply(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

/**
 * A save from the page. It carries the text the page last had from the file;
 * if the file has changed since, the save is refused with the file as it is
 * now, unless it says to replace it anyway, which the page asks the person
 * first. Nothing else on the page writes the file.
 */
async function save(root: string, followed: Map<string, Followed>, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const inside = await insideRoot(root, url.searchParams.get('file') ?? '');
  if (typeof inside !== 'string') return refuse(res, inside);
  const asked = JSON.parse(await body(req)) as { text: string; base: string; replace?: boolean };
  if (typeof asked.text !== 'string' || typeof asked.base !== 'string') return reply(res, 400, { error: 'text and base are wanted' });
  const entry = await entryFor(root, followed, inside);
  const full = join(root, inside);
  // Read now rather than trust the watcher, which may not have caught up.
  const now = await readFile(full, 'utf8');
  if (now !== entry.text) record(entry, now, 'disk');
  if (now !== asked.base && !asked.replace) {
    const last = entry.versions[entry.versions.length - 1]!;
    return reply(res, 409, { text: now, at: last.at, who: last.who, note: last.note ?? null });
  }
  await writeFile(full, asked.text, 'utf8');
  record(entry, asked.text, 'you');
  reply(res, 200, { at: entry.at });
  broadcast(entry);
}

/**
 * The first Save of a page with no file: a new file at a path inside the
 * folder, typed on the page. Its folder must already be there. A file already
 * at that path is replaced only when the page says to, which it asks the
 * person first. From then on the page saves through `save`, as a page opened
 * with the file does.
 */
async function create(root: string, followed: Map<string, Followed>, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const asked = JSON.parse(await body(req)) as { text: string; replace?: boolean; from?: string };
  if (typeof asked.text !== 'string') return reply(res, 400, { error: 'text is wanted' });
  const typed = (url.searchParams.get('file') ?? '').trim();
  const spec = extname(typed) === PAGE_EXTENSION;
  if (extname(typed) !== '.reladraw' && !spec) {
    return reply(res, 400, { error: `${typed || 'The path'} isn't a .reladraw file${typeof asked.from === 'string' ? ` or a ${PAGE_EXTENSION} spec` : ''}` });
  }
  if (isAbsolute(typed) || typed.split(/[\\/]/).includes('..')) {
    return reply(res, 400, { error: `Give a path inside ${shown(root)}, such as diagram.reladraw or docs/flow.reladraw` });
  }
  const full = resolvePath(root, typed);
  let folder: string;
  try {
    folder = await realpath(dirname(full));
  } catch {
    return reply(res, 400, { error: `There is no folder ${relative(root, dirname(full)).split(sep).join('/')} in ${shown(root)}` });
  }
  const within = relative(root, folder);
  if (within.startsWith('..') || isAbsolute(within)) return reply(res, 403, { error: `That folder is outside ${shown(root)}` });
  const there = await stat(full).then(
    (found) => found,
    () => null,
  );
  if (there !== null) {
    const inside = await insideRoot(root, full);
    if (typeof inside !== 'string') return reply(res, inside.status, { error: inside.problem });
    if (!asked.replace) return reply(res, 409, { exists: true, file: inside });
  }
  // A spec's diagrams are named from its own folder, and the spec the page
  // implied named them from `from`, the folder served, so they are moved.
  let text = asked.text;
  if (spec && typeof asked.from === 'string') {
    const was = asked.from;
    const now = relative(root, folder).split(sep).join('/') || '.';
    text = moveSpecPaths(text, (path) => posix.relative(now, posix.join(was, path)) || path);
  }
  await writeFile(full, text, 'utf8');
  const inside = await insideRoot(root, full);
  if (typeof inside !== 'string') return reply(res, inside.status, { error: inside.problem });
  const entry = followed.get(inside) ?? newEntry();
  followed.set(inside, entry);
  record(entry, text, 'you');
  reply(res, 200, { file: inside, at: entry.at, text });
  broadcast(entry);
}

/**
 * `reladraw note <file> "<what changed>"`: an agent describes the change it
 * just made. The note goes on the file's latest version, read now so a change
 * the watcher hasn't reached yet is the one described, and marks it the agent's.
 */
async function note(root: string, followed: Map<string, Followed>, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const inside = await insideRoot(root, url.searchParams.get('file') ?? '');
  if (typeof inside !== 'string') return refuse(res, inside);
  const asked = JSON.parse(await body(req)) as { note: string };
  if (typeof asked.note !== 'string' || asked.note.trim() === '') return reply(res, 400, { error: 'a note is wanted' });
  const entry = await entryFor(root, followed, inside);
  const now = await readFile(join(root, inside), 'utf8');
  if (now !== entry.text) record(entry, now, 'disk');
  const last = entry.versions[entry.versions.length - 1]!;
  last.who = 'agent';
  last.note = asked.note.trim().slice(0, 300);
  reply(res, 200, { at: last.at });
  broadcast(entry);
}

/** The nearest .reladraw-format from this folder up, or nothing. */
async function nearestSettings(folder: string): Promise<{ path: string; text: string } | null> {
  for (let at = folder; ; at = dirname(at)) {
    const path = join(at, SETTINGS_FILE);
    try {
      return { path, text: await readFile(path, 'utf8') };
    } catch {
      if (dirname(at) === at) return null;
    }
  }
}

/**
 * The settings Format uses for a file, as `reladraw format` finds them, and
 * the file the page's Format settings writes: the nearest .reladraw-format
 * when it is inside the served folder, or else a new one beside the diagram,
 * since the page writes nothing outside the folder.
 */
async function settingsFor(root: string, inside: string): Promise<{ text: string; target: string; there: string | null }> {
  const folder = dirname(join(root, inside));
  const nearest = await nearestSettings(folder);
  const within = nearest !== null && !relative(root, nearest.path).startsWith('..');
  return {
    text: nearest?.text ?? '',
    target: within ? nearest.path : join(folder, SETTINGS_FILE),
    there: within ? nearest.text : null,
  };
}

/** The page's Format settings, written into the file Format reads them from. */
async function saveSettings(
  root: string,
  settings: { target: string; there: string | null },
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const asked = JSON.parse(await body(req)) as { values?: Record<string, string> };
  if (typeof asked.values !== 'object' || asked.values === null) return reply(res, 400, { error: 'values are wanted' });
  let text: string;
  try {
    text = withSettings(settings.there ?? settingsFileText(), asked.values);
  } catch (error) {
    return reply(res, 400, { error: (error as Error).message });
  }
  await writeFile(settings.target, text, 'utf8');
  reply(res, 200, { file: relative(root, settings.target).split(sep).join('/') });
}

const NOTE_HELP = `reladraw note <file.reladraw> "<what changed>"

Describes the change just made to the file, for the page reladraw serve shows
it on: the page's Versions menu lists it as the agent's, with this note. With
no server running for the file's folder, nothing is noted.
`;

/** `reladraw note`: run from the folder the server serves, as serve is. */
export async function noteCommand(args: string[]): Promise<number> {
  if (args.includes('-h') || args.includes('--help')) {
    process.stdout.write(NOTE_HELP);
    return 0;
  }
  const [file, text, ...rest] = args;
  if (file === undefined || text === undefined || rest.length > 0 || text.trim() === '') {
    process.stderr.write('reladraw: note takes a file and one quoted note: reladraw note diagram.reladraw "moved the cache under the API"\n');
    return 1;
  }
  const root = await realpath(process.cwd());
  const inside = await insideRoot(root, file);
  if (typeof inside !== 'string') {
    process.stderr.write(`reladraw: ${inside.problem}\n`);
    return 1;
  }
  for (let port = FIRST_PORT; port < FIRST_PORT + PORTS; port++) {
    const there = await whoIsOn(port);
    if (there?.root !== root) continue;
    const answer = await fetch(`http://127.0.0.1:${port}/note?file=${encodeURIComponent(inside)}`, {
      method: 'POST',
      body: JSON.stringify({ note: text }),
    });
    if (answer.ok) return 0;
    process.stderr.write(`reladraw: the server didn't take the note: ${await answer.text()}\n`);
    return 1;
  }
  // Not an error: an agent told to leave a note shouldn't be stopped by there
  // being no page to show it on.
  process.stdout.write(`reladraw: no server is serving ${root}, so nothing was noted\n`);
  return 0;
}

/** Opens an address in the default browser, as the skill's pages are opened. */
export function openInBrowser(address: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [address]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', address]]
        : ['xdg-open', [address]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {
      process.stderr.write(`reladraw: couldn't open a browser; the page is at ${address}\n`);
    }).unref();
  } catch {
    process.stderr.write(`reladraw: couldn't open a browser; the page is at ${address}\n`);
  }
}
