/**
 * `shape: table` (design.org 5.1): a centered title over left-aligned rows,
 * the look shared by an ERD entity, a UML class and a key/value box.
 *
 * A table is written out into what the language already draws before any box
 * is built, the way cards are: the table becomes a column of rows, each row a
 * row of cells, and a child that holds rows of its own becomes a section. What
 * is left for later is what the language has no words for: every cell of one
 * column as wide as the widest, and the band and rules the renderer draws.
 */
import type { Attrs, NodeStmt, Stmt } from './ast.js';
import { SourceError } from './errors.js';
import type { LayoutNode } from './model.js';
import { gapPixels } from './place.js';

/** The room between two cells of a row, in pixels. */
const CELL_GAP = 14;
/** The room above and below a row's text, in pixels. */
const ROW_PAD = 3;

/** What the renderer and the column-matching need to know about one table. */
export interface TableInfo {
  name: string;
  /** `title: (fill: …)`: the band behind the name. */
  titleFill?: string;
  /** The cells of each column, by name, across every row and section. */
  columns: string[][];
  /** The rows and sections with a rule drawn above them. */
  rules: string[];
  /** The headings' row, if the table has one. */
  headings?: string;
  /** `column-widths: 9, -, -`: the least each column is, in pixels; undefined where it is `-`. */
  widths: (number | undefined)[];
}

/** The setting keys a table's bracket is stored under, `shape.headings`. */
const TABLE_KEYS = ['shape.title.fill', 'shape.headings', 'shape.headings.style', 'shape.column-styles', 'shape.column-gap', 'shape.column-widths'];

/** The cells of a row's text: split at each `|` that isn't escaped, `\|` kept as a bar. */
export function cellsOf(text: string): string[] {
  return text.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/**
 * Write each table out into rows and cells. `appearance` is a statement's
 * words over its styles', which is where a table's shape and settings may come
 * from.
 */
export function writeOutTables(
  statements: Stmt[],
  appearance: (attrs: Attrs, line: number) => Attrs,
): { statements: Stmt[]; tables: TableInfo[] } {
  const nodes = statements.filter((stmt): stmt is NodeStmt => stmt.kind === 'node');
  const tableStmts = nodes.filter((stmt) => appearance(stmt.attrs, stmt.line)['shape'] === 'table');
  if (tableStmts.length === 0) {
    for (const stmt of nodes) refuseStraySettings(stmt);
    return { statements, tables: [] };
  }

  const childrenOf = (name: string): NodeStmt[] => nodes.filter((stmt) => stmt.name.startsWith(`${name}.`) && !stmt.name.slice(name.length + 1).includes('.'));
  const replaced = new Map<NodeStmt, NodeStmt[]>();
  const tables: TableInfo[] = [];

  for (const table of tableStmts) {
    if (tableStmts.some((other) => other !== table && table.name.startsWith(`${other.name}.`))) {
      throw new SourceError(`"${table.name}" is a table inside the table "${table.name.slice(0, table.name.indexOf('.'))}" — a table's children are its rows`, table.line);
    }
    const look = appearance(table.attrs, table.line);
    const columnStyles = look['shape.column-styles']?.split(',') ?? [];
    for (const style of columnStyles) {
      if (style === '-') continue;
      if (!appearanceHasStyle(appearance, style, table.line)) {
        throw new SourceError(`"${table.name}" column-styles: names "${style}", and there is no style by that name`, table.line);
      }
      if (Object.keys(textOf(appearance({ style }, table.line))).length === 0) {
        throw new SourceError(
          `"${table.name}" column-styles: names "${style}", which says nothing about text, and a column's cells are text — ` +
            `give it text: (…), such as style ${style}  text: (color: theme-muted)`,
          table.line,
        );
      }
    }
    const info: TableInfo = {
      name: table.name,
      ...(look['shape.title.fill'] !== undefined ? { titleFill: look['shape.title.fill'] } : {}),
      columns: [],
      rules: [],
      widths: (look['shape.column-widths']?.split(',') ?? []).map((width) =>
        width === '-' ? undefined : gapPixels(width, `"${table.name}" column-widths`, table.line),
      ),
    };
    tables.push(info);
    const columnGap = look['shape.column-gap'];
    const cellGap = columnGap === undefined ? `${CELL_GAP}px` : (gapPixels(columnGap, `"${table.name}" column-gap`, table.line), columnGap);

    for (const key of ['layout', 'gather-children', 'padding']) {
      if (table.attrs[key] !== undefined) {
        throw new SourceError(`"${table.name}" is a table, and a table lays out its own rows, so it takes no ${key}:`, table.line);
      }
    }
    const kids = childrenOf(table.name);
    const own: Attrs = withoutSettings(table.attrs);
    own['shape'] = 'rectangle';
    const out: NodeStmt[] = [{ ...table, attrs: own }];

    const headings = look['shape.headings'];
    const rowsAndSections: NodeStmt[] = [];
    if (headings !== undefined) {
      const name = `${table.name}.0`;
      if (nodes.some((stmt) => stmt.name === name)) {
        throw new SourceError(`"${name}" is where the headings of "${table.name}" go — give the row another name`, table.line);
      }
      info.headings = name;
      // Muted unless `headings-style:` says how they look.
      const style = look['shape.headings.style'];
      for (const one of style?.split(' ') ?? []) {
        if (!appearanceHasStyle(appearance, one, table.line)) {
          throw new SourceError(`"${table.name}" headings-style: names "${one}", and there is no style by that name`, table.line);
        }
      }
      rowsAndSections.push({
        kind: 'node',
        name,
        text: headings,
        statedText: true,
        textAttrs: style === undefined ? { color: 'theme-muted' } : {},
        placements: [],
        attrs: style === undefined ? {} : { style },
        line: table.line,
      });
    }
    rowsAndSections.push(...kids);
    if (rowsAndSections.length > 0) {
      // The rows reach the border, each padded on its own; with no title they
      // start just inside the top, as they end just inside the bottom.
      own['padding-left'] = '0';
      own['padding-right'] = '0';
      own['padding-bottom'] = `${ROW_PAD}px`;
      if (table.statedText && table.text === '') own['padding-top'] = `${ROW_PAD}px`;
      own['layout'] = 'column';
      own['layout.gap'] = '0';
      own['layout.widths'] = 'fill';
      own['layout.align-children'] = 'left';
    }

    const writeRow = (row: NodeStmt, ruled: boolean): NodeStmt[] => {
      refuseOnRow(row, table.name);
      if (ruled) info.rules.push(row.name);
      const grand = childrenOf(row.name);
      if (grand.length > 0) {
        // A section: rows of its own under a rule.
        if (row.statedText) {
          throw new SourceError(
            `"${row.name}" holds rows, so it is a section of "${table.name}", and a section has no text of its own — ` +
              'drop its text, or write it as a row',
            row.line,
          );
        }
        const section: NodeStmt = {
          ...row,
          text: '',
          statedText: true,
          attrs: { ...row.attrs, shape: 'none', layout: 'column', 'layout.gap': '0', 'layout.widths': 'fill', 'layout.align-children': 'left' },
        };
        return [section, ...grand.flatMap((one) => writeRow(one, false))];
      }
      const own = appearance(row.attrs, row.line);
      const attrs: Attrs = {
        ...row.attrs,
        shape: 'rectangle',
        layout: 'row',
        'layout.gap': cellGap,
        'layout.align-children': 'top',
        'gather-children': 'left',
        'padding-top': `${ROW_PAD}px`,
        'padding-bottom': `${ROW_PAD}px`,
      };
      if (own['fill'] === undefined) attrs['fill'] = 'none';
      if (own['border'] === undefined && own['border.color'] === undefined) attrs['border'] = 'none';
      // A row's band is square, so a fill reads as a stripe across the table.
      if (own['corners'] === undefined) attrs['corners'] = 'sharp';
      // The row wears its style, so a fill colors the row; what the style says
      // about text reaches the cells, under the column's, under the row's own words.
      const rowText = textOf(own);
      const cells = cellsOf(row.text).map((text, index): NodeStmt => {
        if (info.columns[index] === undefined) info.columns[index] = [];
        const name = `${row.name}.${index + 1}`;
        info.columns[index]!.push(name);
        // The headings take their own style, never the columns'.
        const column = row.name === info.headings ? undefined : columnStyles[index];
        const columnText = column === undefined || column === '-' ? {} : textOf(appearance({ style: column }, table.line));
        return {
          kind: 'node',
          name,
          text,
          statedText: true,
          // Against the cell's left side, since a column may be wider than this cell's text.
          textAttrs: { ...rowText, ...columnText, ...withoutKeys(row.textAttrs, ['place', 'align']), place: 'inside left' },
          placements: [],
          attrs: { shape: 'none' },
          line: row.line,
        };
      });
      return [{ ...row, text: '', statedText: true, textAttrs: {}, attrs }, ...cells];
    };

    rowsAndSections.forEach((row, index) => {
      const first = index === 0;
      const afterHeadings = index === 1 && headings !== undefined;
      const isSection = childrenOf(row.name).length > 0;
      out.push(...writeRow(row, afterHeadings || (isSection && !first)));
    });
    replaced.set(table, out);
    for (const kid of kids) markDone(kid, childrenOf, replaced);
  }

  const written: Stmt[] = [];
  for (const stmt of statements) {
    if (stmt.kind !== 'node') {
      written.push(stmt);
      continue;
    }
    const swap = replaced.get(stmt);
    if (swap === undefined) {
      refuseStraySettings(stmt);
      written.push(stmt);
    } else written.push(...swap);
  }
  return { statements: written, tables };
}

/** A row or section has been written out with its table, so it is dropped where it was written. */
function markDone(stmt: NodeStmt, childrenOf: (name: string) => NodeStmt[], replaced: Map<NodeStmt, NodeStmt[]>): void {
  replaced.set(stmt, []);
  for (const kid of childrenOf(stmt.name)) markDone(kid, childrenOf, replaced);
}

function appearanceHasStyle(appearance: (attrs: Attrs, line: number) => Attrs, style: string, line: number): boolean {
  try {
    appearance({ style }, line);
    return true;
  } catch {
    return false;
  }
}

/** What a style's `text: (…)` says, as a text's own bracket: `text.color` as `color`. */
function textOf(look: Attrs): Attrs {
  const said: Attrs = {};
  for (const [key, value] of Object.entries(look)) if (key.startsWith('text.')) said[key.slice('text.'.length)] = value;
  // A cell's text always sits against its left side.
  return withoutKeys(said, ['place', 'align']);
}

function withoutKeys(attrs: Attrs, keys: string[]): Attrs {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => !keys.includes(key)));
}

function withoutSettings(attrs: Attrs): Attrs {
  const kept: Attrs = {};
  for (const [key, value] of Object.entries(attrs)) if (!TABLE_KEYS.includes(key)) kept[key] = value;
  return kept;
}

/** The table places its rows and sizes them, so a row says neither. */
function refuseOnRow(row: NodeStmt, table: string): void {
  const said = row.placements.length > 0 ? 'a placement' : ['layout', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'].find((key) => row.attrs[key] !== undefined);
  if (said !== undefined) {
    throw new SourceError(
      `"${row.name}" is a row of the table "${table}", which places and sizes its rows, so it takes ${said === 'a placement' ? 'no placement' : `no ${said}:`}`,
      row.line,
    );
  }
}

/** A table's settings on something that isn't a table. */
function refuseStraySettings(stmt: NodeStmt): void {
  const key = TABLE_KEYS.find((one) => stmt.attrs[one] !== undefined);
  if (key !== undefined) {
    throw new SourceError(`"${stmt.name}" has ${key.split('.')[1]}:, which is a table's — write it in shape: table (…)`, stmt.line);
  }
}

/**
 * Every cell of one column as wide as the widest, so the columns line up down
 * the whole table, across its sections. `natural` is how wide a cell's own
 * text makes it.
 */
export function matchColumns(tables: TableInfo[], byName: Map<string, LayoutNode>, natural: (node: LayoutNode) => number): void {
  for (const table of tables) {
    const node = byName.get(table.name);
    if (node) node.table = { ...(table.titleFill !== undefined ? { titleFill: table.titleFill } : {}) };
    for (const rule of table.rules) {
      const ruled = byName.get(rule);
      if (ruled) ruled.ruleAbove = true;
    }
    table.columns.forEach((column, index) => {
      const cells = column.map((name) => byName.get(name)).filter((cell): cell is LayoutNode => cell !== undefined);
      const widest = Math.max(table.widths[index] ?? 0, ...cells.map(natural));
      for (const cell of cells) cell.appearance['min-width'] = `${Math.ceil(widest)}px`;
    });
  }
}
