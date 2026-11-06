#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearMatch, readChecks, type Checks, type Finding } from './checks.js';
import { SourceError } from './errors.js';
import { format } from './format.js';
import { DEFAULT_FORMAT, readFormatSettings, SETTINGS_FILE, settingsFileText, type FormatSettings } from './format-settings.js';
import { draw, type DrawOptions } from './index.js';
import { drawPage } from './page.js';
import { THEME_NAMES, THEMES } from './themes.js';

const USAGE = `reladraw — draw a diagram from stated placement

  reladraw render <input.reladraw> [-o <output.svg>] [options]
  reladraw render <input.reladraw> --page [-o <output.html>] [options]
  reladraw check <input.reladraw> [options]
  reladraw format <input.reladraw>... [--check]
  reladraw format - [--check]
  reladraw format --init
  reladraw install-skill [skills options]

  render      draw the diagram to an SVG, and print any findings: places
              where the picture, drawn as written, may not read as meant.
  check       lay the diagram out and print only the findings. No SVG is
              written, so a good one is left alone while you iterate.
  format      lay each file out again in place: spacing, columns, comments
              and blank lines. No word is respelled, and a file that
              doesn't parse is left alone. The nearest .reladraw-format, in
              the file's folder or one above it, holds the settings.
              --check changes nothing, and fails if a file would change.
              - reads the diagram from standard input and prints it
              formatted, for an editor; settings come from the current
              folder up.
              --init writes a .reladraw-format here, every setting at its
              default with what it does.
  install-skill
              install the agent skill that came with this version of
              reladraw, so it teaches what this tool accepts. It runs
              npx skills add with --copy, and passes on what follows:
              -g for every project, -a claude-code for one agent.

  -o, --out   where render writes the SVG. Defaults to the input path with
              its extension replaced by .svg. Use - for standard output.
  --page      render writes a page for looking at the diagram instead: one
              HTML file in the diagram's colors, headed with its title, that
              pans, zooms, goes full screen, saves itself, its source, the SVG
              or a PNG, lists the findings and names what is under the
              pointer. Defaults to the input path with .html.
  --theme     render in this theme, whatever the file's \`diagram theme:\`
              says. One of ${THEME_NAMES.join(', ')}.
  --guides    draw the guides: everything written with \`guide\` in front,
              dashed, to see how the picture is built.
  --checks    turn kinds of finding on or off, over what the file says:
              --checks "edge-crossings: on, node-overlap: off"
  --no-checks print no findings. Errors still print.
  -v, --version
              print the version.
  -h, --help  print this.
`;

const COMMANDS = ['render', 'check', 'format', 'install-skill'] as const;

// The version of skills this was tried with, so a change there can't break it.
const SKILLS_PACKAGE = 'skills@1.7.6';

// The skill ships in the package beside dist/, as the one in the repository.
// skills does the work of knowing where each agent keeps its skills; --copy
// because an npx run leaves the package in a cache, where a link would break.
function installSkill(args: string[]): number {
  const skills = fileURLToPath(new URL('../.claude/skills/', import.meta.url));
  if (!existsSync(skills)) {
    process.stderr.write(`reladraw: the skill isn't in this install of reladraw (looked in ${skills})\n`);
    return 1;
  }
  const windows = process.platform === 'win32';
  const command = [SKILLS_PACKAGE, 'add', skills, '--copy', ...args];
  // On Windows npx is a .cmd, which Node runs only through a shell.
  const result = spawnSync(windows ? 'npx.cmd' : 'npx', windows ? command.map((a) => `"${a}"`) : command, {
    stdio: 'inherit',
    shell: windows,
  });
  if (result.error) {
    process.stderr.write(`reladraw: couldn't run npx to install the skill: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}
type Command = (typeof COMMANDS)[number];

async function main(argv: string[]): Promise<number> {
  // Everything after install-skill is for skills, -h and -v included.
  if (argv[0] === 'install-skill') return installSkill(argv.slice(1));
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return argv.length === 0 ? 1 : 0;
  }
  if (argv.includes('-v') || argv.includes('--version')) {
    // package.json ships beside dist/, so the number is the installed one.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  const verb = argv[0]!;
  if (!(COMMANDS as readonly string[]).includes(verb)) {
    // A file where the command goes is the old form, and is told the new one;
    // anything else is a command that does not exist, with the near one.
    if (/\.reladraw$/.test(verb) || existsSync(verb)) {
      process.stderr.write(`reladraw: a command comes first — reladraw render ${argv.join(' ')}\n`);
    } else {
      const near = nearMatch(verb, COMMANDS);
      process.stderr.write(
        `reladraw: there is no command "${verb}"` +
          (near ? ` — did you mean ${near}?\n` : ` — the commands are ${COMMANDS.join(', ')}\n`),
      );
    }
    return 1;
  }
  const command = verb as Command;
  if (command === 'format') return formatFiles(argv.slice(1));

  let input: string | undefined;
  let out: string | undefined;
  let theme: string | undefined;
  let checks: string | undefined;
  let noChecks = false;
  let guides = false;
  let page = false;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if ((arg === '-o' || arg === '--out') && command === 'render') {
      out = argv[i + 1];
      if (out === undefined) {
        process.stderr.write('reladraw: -o needs a path\n');
        return 1;
      }
      i += 1;
    } else if (arg === '-o' || arg === '--out') {
      process.stderr.write('reladraw: check writes no SVG, so it takes no -o; reladraw render writes one\n');
      return 1;
    } else if (arg === '--theme') {
      theme = argv[i + 1];
      if (theme === undefined) {
        process.stderr.write(`reladraw: --theme needs a name: ${THEME_NAMES.join(', ')}\n`);
        return 1;
      }
      if (THEMES[theme] === undefined) {
        process.stderr.write(
          `reladraw: there is no theme called "${theme}" — the themes are ${THEME_NAMES.join(', ')}\n`,
        );
        return 1;
      }
      i += 1;
    } else if (arg === '--checks') {
      checks = argv[i + 1];
      if (checks === undefined) {
        process.stderr.write('reladraw: --checks needs a list, such as --checks "edge-crossings: on"\n');
        return 1;
      }
      i += 1;
    } else if (arg === '--no-checks') {
      noChecks = true;
    } else if (arg === '--guides') {
      guides = true;
    } else if (arg === '--page' && command === 'render') {
      page = true;
    } else if (arg === '--page') {
      process.stderr.write('reladraw: check writes nothing, so it takes no --page; reladraw render --page writes one\n');
      return 1;
    } else if (arg.startsWith('-') && arg !== '-') {
      process.stderr.write(`reladraw: unknown option ${arg}\n`);
      return 1;
    } else if (input === undefined) {
      input = arg;
    } else {
      process.stderr.write(`reladraw: unexpected argument ${arg}\n`);
      return 1;
    }
  }

  if (input === undefined) {
    process.stderr.write(`reladraw: no input file — reladraw ${command} <input.reladraw>\n`);
    return 1;
  }
  if (noChecks && checks !== undefined) {
    process.stderr.write('reladraw: --no-checks and --checks say opposite things; give one\n');
    return 1;
  }
  if (noChecks && command === 'check') {
    process.stderr.write('reladraw: check with --no-checks would print nothing; reladraw render draws\n');
    return 1;
  }

  // Read once here, so a mistake in --checks is reported before the file is drawn.
  let overChecks: ((fromFile: Checks) => Checks) | undefined;
  if (checks !== undefined) {
    const written = checks;
    try {
      readChecks(written, {} as Checks);
    } catch (error) {
      process.stderr.write(`reladraw: --checks: ${(error as Error).message}\n`);
      return 1;
    }
    overChecks = (fromFile) => readChecks(written, fromFile);
  }

  const source = await readFile(input, 'utf8');

  const options: DrawOptions = {
    ...(theme === undefined ? {} : { theme: THEMES[theme]! }),
    ...(guides ? { guides: true } : {}),
    // An icon's file is found from the diagram, not from wherever the tool
    // happens to be run.
    readIconFile: (path) => readFileSync(resolvePath(dirname(input), path), 'utf8'),
    ...(noChecks ? { checks: false as const } : overChecks ? { checks: overChecks } : {}),
  };
  let drawn: { text: string; findings: Finding[] };
  try {
    if (page) {
      const made = drawPage(source, basename(input), options);
      drawn = { text: made.html, findings: made.findings };
    } else {
      const made = draw(source, options);
      drawn = { text: made.svg, findings: made.findings };
    }
  } catch (error) {
    if (error instanceof SourceError) {
      process.stderr.write(`${error.format(input)}\n`);
      return 1;
    }
    throw error;
  }

  for (const finding of drawn.findings) process.stderr.write(`${finding.format(input)}\n`);
  if (command === 'check') return 0;

  if (out === '-') {
    process.stdout.write(drawn.text);
    return 0;
  }

  const target = resolvePath(out ?? input.replace(/\.[^.]+$/, '') + (page ? '.html' : '.svg'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, drawn.text, 'utf8');
  process.stderr.write(`${target}\n`);
  return 0;
}

/**
 * `reladraw format`: each file laid out again in place, by the settings in
 * the nearest `.reladraw-format`. A file that fails is reported and the rest
 * still run, so one broken file doesn't hide the state of the others.
 */
async function formatFiles(args: string[]): Promise<number> {
  const files: string[] = [];
  let check = false;
  let init = false;
  for (const arg of args) {
    if (arg === '--check') check = true;
    else if (arg === '--init') init = true;
    else if (arg.startsWith('-') && arg !== '-') {
      process.stderr.write(`reladraw: format takes --check and --init, not ${arg}\n`);
      return 1;
    } else files.push(arg);
  }

  if (init) {
    if (check || files.length > 0) {
      process.stderr.write('reladraw: --init writes a settings file and formats nothing — run reladraw format --init on its own\n');
      return 1;
    }
    if (existsSync(SETTINGS_FILE)) {
      process.stderr.write(`reladraw: there is already a ${SETTINGS_FILE} here — delete it first to write a fresh one\n`);
      return 1;
    }
    await writeFile(SETTINGS_FILE, settingsFileText(), 'utf8');
    process.stderr.write(`${resolvePath(SETTINGS_FILE)}\n`);
    return 0;
  }
  if (files.length === 0) {
    process.stderr.write('reladraw: no input file — reladraw format <input.reladraw>..., or - to read standard input\n');
    return 1;
  }
  if (files.includes('-')) return formatStandardInput(files, check);

  let status = 0;
  const found = new Map<string, { path: string; settings: FormatSettings } | null>();
  for (const file of files) {
    let settings = DEFAULT_FORMAT;
    try {
      const nearest = nearestSettings(dirname(resolvePath(file)), found);
      if (nearest) settings = nearest.settings;
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      process.stderr.write(`${error.cause.format(error.path)}\n`);
      status = 1;
      continue;
    }

    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      process.stderr.write(`reladraw: can't read ${file}\n`);
      status = 1;
      continue;
    }
    let laid: string;
    try {
      laid = format(source, settings);
    } catch (error) {
      process.stderr.write(error instanceof SourceError ? `${error.format(file)}\n` : `reladraw: ${file}: ${(error as Error).message}\n`);
      status = 1;
      continue;
    }
    if (laid === source) continue;
    if (check) {
      process.stderr.write(`${file}: not formatted — reladraw format ${file} lays it out\n`);
      status = 1;
      continue;
    }
    await writeFile(file, laid, 'utf8');
    process.stderr.write(`formatted ${file}\n`);
  }
  return status;
}

/**
 * `reladraw format -`: the diagram read from standard input and printed
 * formatted, which is how an editor formats a buffer it hasn't saved. The
 * settings are the nearest `.reladraw-format` from the current folder. With
 * `--check` nothing is printed, and it fails if the text would change.
 */
async function formatStandardInput(files: string[], check: boolean): Promise<number> {
  if (files.length > 1) {
    process.stderr.write('reladraw: - reads standard input, so it goes on its own — reladraw format -\n');
    return 1;
  }
  if (process.stdin.isTTY) {
    process.stderr.write('reladraw: format - reads a diagram from standard input — pipe one in: reladraw format - < diagram.reladraw\n');
    return 1;
  }
  let settings = DEFAULT_FORMAT;
  try {
    settings = nearestSettings(process.cwd(), new Map())?.settings ?? DEFAULT_FORMAT;
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    process.stderr.write(`${error.cause.format(error.path)}\n`);
    return 1;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const source = Buffer.concat(chunks).toString('utf8');
  let laid: string;
  try {
    laid = format(source, settings);
  } catch (error) {
    process.stderr.write(error instanceof SourceError ? `${error.format('<stdin>')}\n` : `reladraw: <stdin>: ${(error as Error).message}\n`);
    return 1;
  }
  if (check) {
    if (laid === source) return 0;
    process.stderr.write('<stdin>: not formatted\n');
    return 1;
  }
  process.stdout.write(laid);
  return 0;
}

/** A `.reladraw-format` that doesn't read, and where it is. */
class SettingsError extends Error {
  constructor(
    readonly path: string,
    override readonly cause: SourceError,
  ) {
    super(cause.message);
  }
}

/**
 * The settings in the nearest `.reladraw-format`, looking in `folder` and
 * then each folder above it, or nothing when there is none. Each folder is
 * looked in once however many files share it.
 */
function nearestSettings(
  folder: string,
  found: Map<string, { path: string; settings: FormatSettings } | null>,
): { path: string; settings: FormatSettings } | null {
  const known = found.get(folder);
  if (known !== undefined) return known;
  const path = resolvePath(folder, SETTINGS_FILE);
  let result: { path: string; settings: FormatSettings } | null;
  if (existsSync(path)) {
    try {
      result = { path, settings: readFormatSettings(readFileSync(path, 'utf8')) };
    } catch (error) {
      if (error instanceof SourceError) throw new SettingsError(path, error);
      throw error;
    }
  } else {
    const parent = dirname(folder);
    result = parent === folder ? null : nearestSettings(parent, found);
  }
  found.set(folder, result);
  return result;
}

// The exit code is set, not exited with: process.exit ends the process at
// once, and a write to a pipe that hasn't drained yet is lost, which cut
// `format -` and `render -o -` off at 64 KB. Node exits on its own once the
// output is written. `./dev.sh pipe` checks it.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`reladraw: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
