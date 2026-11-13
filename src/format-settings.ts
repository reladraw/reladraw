import { ALL_ATTR_KEYS } from './ast.js';
import { nearMatch } from './checks.js';
import { SourceError } from './errors.js';

/**
 * How `reladraw format` lays a file out. Each key is a setting as it is
 * written in a `.reladraw-format` file, so an error, the generated file and
 * the code all use one name for each.
 */
export interface FormatSettings {
  'wrap-at': 'off' | number;
  'clause-per-line-at': 'off' | 'always' | number;
  'first-line': 'text' | 'name';
  'continued-lines-indent': number | 'tab' | 'under-name' | 'under-text' | { underName: number };
  'clause-order': 'as-written' | string[];
  'clause-gap': number | 'tab';
  columns: 'aligned' | 'off';
  'columns-shared-by': 'same-keyword-neighbors' | 'neighbors' | 'same-keyword' | 'file';
  'comments-inside': 'keep-lines' | 'move-above' | 'refuse';
  'trailing-comments': 'shared-column' | 'after-statement';
  'blank-lines': 'as-written' | { exactly: number } | { atMost: number };
  'edge-name-and-ends': 'one-column' | 'own-columns';
}

/** One setting: what it controls, its values in words, and how to read one. */
interface Setting {
  name: keyof FormatSettings;
  /** One sentence for the generated file: what the setting controls. */
  about: string;
  /** Each value as written, and what it means. The first is the default. */
  values: [string, string][];
  /** The default, as written. */
  written: string;
  /** The value as written, read; a string thrown is the reason it is refused. */
  read: (value: string) => FormatSettings[keyof FormatSettings];
}

const SETTING_COUNT = /^[1-9]\d*$/;

/**
 * A setting whose values are words, one of them the default. Anything else is
 * refused with the list.
 */
function wordSetting<K extends keyof FormatSettings>(name: K, about: string, values: [string, string][]): Setting {
  return {
    name,
    about,
    values,
    written: values[0]![0],
    read: (value) => {
      if (values.some(([word]) => word === value)) return value as FormatSettings[K];
      const near = nearMatch(value, values.map(([word]) => word));
      throw `${name}: "${value}" is not one of its values${near ? ` — did you mean ${near}?` : ''} — it takes ${orList(values.map(([word]) => word))}`;
    },
  };
}

/**
 * The kinds of clause `clause-order` can list: a statement's texts, its
 * placements, and each key by its own name. `text` is also a style's `text:`
 * key, which is a style's way of saying what a text says.
 */
export const CLAUSE_KINDS: readonly string[] = [...new Set(['text', 'placement', ...ALL_ATTR_KEYS])];

export const SETTINGS: Setting[] = [
  {
    name: 'wrap-at',
    about: 'Past this many characters, a statement wraps onto more lines, as few as fit.',
    values: [
      ['off', 'never wrap'],
      ['a number', 'wrap past that many characters, such as 80'],
    ],
    written: 'off',
    read: (value) => {
      if (value === 'off') return value;
      if (SETTING_COUNT.test(value)) return Number(value);
      throw `wrap-at: "${value}" is not one of its values — it takes off, or a number of characters such as 80`;
    },
  },
  {
    name: 'clause-per-line-at',
    about: 'Past this many characters, each clause goes on its own line instead.',
    values: [
      ['off', 'never'],
      ['a number', 'past that many characters, such as 120'],
      ['always', 'every statement, whatever its length'],
    ],
    written: 'off',
    read: (value) => {
      if (value === 'off' || value === 'always') return value;
      if (SETTING_COUNT.test(value)) return Number(value);
      throw `clause-per-line-at: "${value}" is not one of its values — it takes off, always, or a number of characters such as 120`;
    },
  },
  wordSetting('first-line', 'When a statement breaks onto more lines, where its first line ends.', [
    ['text', 'after the text: keyword, name and text stay together'],
    ['name', 'after the name'],
  ]),
  {
    name: 'continued-lines-indent',
    about: 'Where the lines after a statement\'s first one start.',
    values: [
      ['4', 'that many spaces in, such as 4'],
      ['tab', 'one tab in'],
      ['under-name', 'under the statement\'s name'],
      ['under-name + 2', 'that many characters past the start of the name'],
      ['under-text', 'under the statement\'s text, or what comes after the name'],
    ],
    written: '4',
    read: (value) => {
      if (SETTING_COUNT.test(value)) return Number(value);
      if (value === 'tab' || value === 'under-name' || value === 'under-text') return value;
      const shifted = /^under-name \+ ([1-9]\d*)$/.exec(value);
      if (shifted) return { underName: Number(shifted[1]) };
      throw `continued-lines-indent: "${value}" is not one of its values — it takes a number of spaces, tab, under-name, under-name + 2 or under-text`;
    },
  },
  {
    name: 'clause-order',
    about:
      'The order a statement\'s clauses are written in after its text, which always\ncomes straight after the name. A list names placement and keys such as style;\nwhat it leaves out follows, in the order written.',
    values: [
      ['as-written', 'the order the writer chose'],
      ['a list', 'that order, such as: placement, style, fill'],
    ],
    written: 'as-written',
    read: (value) => {
      if (value === 'as-written') return value;
      const kinds = value.split(',').map((kind) => kind.trim());
      const seen = new Set<string>();
      for (const kind of kinds) {
        if (kind === '') throw `clause-order: "${value}" has an empty place in its list — name a kind of clause between each comma`;
        if (!CLAUSE_KINDS.includes(kind)) {
          const near = nearMatch(kind, CLAUSE_KINDS);
          throw `clause-order: "${kind}" is not a kind of clause${near ? ` — did you mean ${near}?` : ''} — it takes text, placement and keys such as style or fill`;
        }
        if (seen.has(kind)) throw `clause-order: ${kind} is listed twice — keep one`;
        seen.add(kind);
      }
      return kinds;
    },
  },
  {
    name: 'clause-gap',
    about: 'The least space between two clauses on a line.',
    values: [
      ['2', 'that many spaces, such as 2'],
      ['tab', 'one tab, which only works with columns: off'],
    ],
    written: '2',
    read: (value) => {
      if (SETTING_COUNT.test(value)) return Number(value);
      if (value === 'tab') return 'tab';
      throw `clause-gap: "${value}" is not one of its values — it takes a number of spaces, or tab`;
    },
  },
  wordSetting('columns', 'Whether statements that belong together line their clauses up in columns.', [
    ['aligned', 'each column as wide as its longest clause'],
    ['off', 'each clause straight after the one before, a clause gap apart'],
  ]),
  wordSetting('columns-shared-by', 'Which statements line their clauses up in shared columns. A comment line\nbetween them never ends a set.', [
    ['same-keyword-neighbors', 'adjacent, with the same keyword\n(a blank line or new keyword ends the set)'],
    ['neighbors', 'adjacent, whatever their keyword'],
    ['same-keyword', 'the same keyword, across blank lines'],
    ['file', 'the whole file'],
  ]),
  wordSetting('comments-inside', 'What happens to a statement written over several lines, with comments\namong them.', [
    ['keep-lines', 'it stays on its own lines, with the indent tidied'],
    ['move-above', 'the comments move above it, and it is joined onto one line'],
    ['refuse', 'the file is left alone, and the comment in the way is named'],
  ]),
  wordSetting('trailing-comments', 'Where a comment at the end of a statement\'s line goes.', [
    ['shared-column', 'lined up with the other comments in its set'],
    ['after-statement', 'a clause gap after its own statement'],
  ]),
  {
    name: 'blank-lines',
    about: 'What happens to runs of blank lines. A run is never removed, since a blank\nline starts a new set of columns.',
    values: [
      ['as-written', 'every blank line stays'],
      ['exactly 2', 'every run becomes that many'],
      ['at-most 3', 'longer runs shrink to that many; shorter ones stay'],
    ],
    written: 'as-written',
    read: (value) => {
      if (value === 'as-written') return value;
      const counted = /^(exactly|at-most) ([1-9]\d*)$/.exec(value);
      if (counted) return counted[1] === 'exactly' ? { exactly: Number(counted[2]) } : { atMost: Number(counted[2]) };
      throw `blank-lines: "${value}" is not one of its values — it takes as-written, exactly and a number, or at-most and a number`;
    },
  },
  wordSetting('edge-name-and-ends', 'How an edge\'s name and ends, such as one a -> b, line up.', [
    ['one-column', 'together, as one column, the way a node\'s name is'],
    ['own-columns', 'the name, each end and the arrow in a column each'],
  ]),
];

const SETTING_BY_NAME = new Map(SETTINGS.map((setting) => [setting.name, setting]));

export const DEFAULT_FORMAT: FormatSettings = Object.fromEntries(
  SETTINGS.map((setting) => [setting.name, setting.read(setting.written)]),
) as unknown as FormatSettings;

/** The file a project's settings are written in. */
export const SETTINGS_FILE = '.reladraw-format';

/**
 * Read a `.reladraw-format` file: one `key: value` setting a line, `//`
 * comments, blank lines. An unknown setting, one written twice, or a value it
 * doesn't take is refused by name, with the line.
 */
export function readFormatSettings(text: string): FormatSettings {
  const settings = { ...DEFAULT_FORMAT };
  const seen = new Map<string, number>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const written = raw.replace(/\/\/.*$/, '').trim();
    if (written === '') return;
    const colon = written.indexOf(':');
    if (colon === -1) throw new SourceError(`"${written}" is not a setting — write one as name: value, such as columns: aligned`, line);
    const name = written.slice(0, colon).trim();
    const value = written.slice(colon + 1).trim().replace(/\s+/g, ' ');
    const setting = SETTING_BY_NAME.get(name as keyof FormatSettings);
    if (setting === undefined) {
      const near = nearMatch(name, SETTINGS.map((one) => one.name));
      throw new SourceError(
        `there is no setting "${name}"` + (near ? ` — did you mean ${near}?` : ` — the settings are ${orList(SETTINGS.map((one) => one.name))}`),
        line,
      );
    }
    const before = seen.get(name);
    if (before !== undefined) throw new SourceError(`${name} is set twice, here and on line ${before} — keep one`, line);
    seen.set(name, line);
    if (value === '') throw new SourceError(`${name} has no value — it takes ${orList(setting.values.map(([word]) => word))}`, line);
    try {
      (settings as Record<string, unknown>)[name] = setting.read(value);
    } catch (reason) {
      if (typeof reason === 'string') throw new SourceError(reason, line);
      throw reason;
    }
  });
  if (settings['clause-gap'] === 'tab' && settings.columns === 'aligned') {
    throw new SourceError(
      `clause-gap: tab can't line columns up, since how wide a tab is depends on the editor — use a number of spaces, or columns: off`,
      seen.get('clause-gap') ?? seen.get('columns') ?? 1,
    );
  }
  return settings;
}

/**
 * The `.reladraw-format` that `reladraw format --init` writes: every setting
 * at its default, each under a comment saying what it controls and what each
 * of its values means.
 */
export function settingsFileText(): string {
  const blocks = SETTINGS.map((setting) => {
    const width = Math.max(...setting.values.map(([word]) => word.length));
    // A meaning written over two lines carries on under where it started.
    const values = setting.values.flatMap(([word, meaning], index) => {
      const [first, ...rest] = meaning.split('\n');
      return [
        `//   ${word.padEnd(width)}  ${first}${index === 0 ? ' (default)' : ''}`,
        ...rest.map((more) => `//   ${' '.repeat(width)}  ${more}`),
      ];
    });
    const about = setting.about.split('\n').map((line) => `// ${line}`);
    return [...about, ...values, `${setting.name}: ${setting.written}`].join('\n');
  });
  const header = [
    '// .reladraw-format: how `reladraw format` lays out the .reladraw files in this',
    '// folder and every folder below it, unless a nearer one says otherwise.',
    '// Every setting is written out at its default; change the ones you want, or',
    '// delete a line to use the default.',
  ].join('\n');
  return `${header}\n\n${blocks.join('\n\n')}\n`;
}

/**
 * A `.reladraw-format`'s text with these values written in. A setting already
 * there keeps its line, its place and any comment after it; one not there is
 * added at the end; everything else stays as it was. The result is read
 * back, so a value the file would refuse is refused here, by name.
 */
export function withSettings(text: string, values: Record<string, string>): string {
  const left = new Map(Object.entries(values).filter(([name]) => SETTING_BY_NAME.has(name as keyof FormatSettings)));
  const lines = text.split(/\r?\n/).map((raw) => {
    const found = raw.match(/^(\s*)([a-z-]+)(\s*:\s*)(.*?)(\s*\/\/.*)?$/);
    if (!found || !left.has(found[2]!)) return raw;
    const value = left.get(found[2]!)!;
    left.delete(found[2]!);
    return `${found[1]}${found[2]}${found[3]}${value}${found[5] ?? ''}`;
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const [name, value] of left) lines.push(`${name}: ${value}`);
  const out = `${lines.join('\n')}\n`;
  readFormatSettings(out);
  return out;
}

function orList(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}
