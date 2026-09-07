export * from './ast.js';
export * from './constants.js';
export * from './errors.js';
export * from './measure.js';
export * from './model.js';
export { parse } from './parser.js';
export { resolve, type ResolveOptions } from './resolve.js';
export { render, DARK_THEME, type RenderOptions, type Theme } from './render.js';

import { parse } from './parser.js';
import { render, type RenderOptions } from './render.js';
import { resolve, type ResolveOptions } from './resolve.js';

/** Source text in, SVG out. The whole pipeline in one call. */
export function compile(source: string, options: ResolveOptions & RenderOptions = {}): string {
  return render(resolve(parse(source), options), options);
}
