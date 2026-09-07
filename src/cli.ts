#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { SourceError } from './errors.js';
import { compile } from './index.js';

const USAGE = `reladraw — render a diagram from stated placement

  reladraw <input.reladraw> [-o <output.svg>]

  -o, --out   where to write the SVG. Defaults to the input path with
              its extension replaced by .svg. Use - for standard output.
  -h, --help  print this.
`;

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return argv.length === 0 ? 1 : 0;
  }

  let input: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '-o' || arg === '--out') {
      out = argv[i + 1];
      if (out === undefined) {
        process.stderr.write('reladraw: -o needs a path\n');
        return 1;
      }
      i += 1;
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
    process.stderr.write('reladraw: no input file\n');
    return 1;
  }

  const source = await readFile(input, 'utf8');

  let svg: string;
  try {
    svg = compile(source);
  } catch (error) {
    if (error instanceof SourceError) {
      process.stderr.write(`${error.format(input)}\n`);
      return 1;
    }
    throw error;
  }

  if (out === '-') {
    process.stdout.write(svg);
    return 0;
  }

  const target = resolvePath(out ?? input.replace(/\.[^.]+$/, '') + '.svg');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, svg, 'utf8');
  process.stderr.write(`${target}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`reladraw: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
