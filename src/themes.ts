/**
 * The named themes a file chooses with `diagram theme: <name>`, and the one it
 * gets when it says nothing.
 *
 * A theme supplies every color the file does not state. It never supplies a
 * size or a distance, so switching themes cannot move anything — geometry may
 * not depend on appearance.
 *
 * Most of the palettes are borrowed from editor color schemes, all of them MIT
 * licensed and credited in NOTICE. Those palettes were made for code, where a
 * color marks a keyword or a string; a diagram needs a page, two box fills, a
 * border, text and a line. So each is the scheme read as a diagram rather than
 * a transfer of it: the page is the scheme's background, a leaf is its raised
 * surface, a container sits between the two, and the lines take one of its
 * accents.
 */
export interface Theme {
  background: string;
  boxFill: string;
  boxStroke: string;
  containerFill: string;
  /** A container is a region rather than a thing, so its outline is quieter. */
  containerStroke: string;
  text: string;
  mutedText: string;
  edge: string;
  /** An icon's drawn line. */
  iconInk: string;
  /** The theme's signature color, which `theme-primary` names. */
  primary: Accent;
  /** Its second color, which `theme-secondary` names. */
  secondary: Accent;
}

/**
 * An accent at the two strengths a file can ask for, and the text that reads
 * on it. `subtle` is the accent mixed toward the page — dark on a dark theme,
 * pale on a light one — so `fill: theme-primary-subtle` is a box set apart in
 * every theme, and its text is the theme's ordinary text.
 */
export interface Accent {
  color: string;
  subtle: string;
  /** Text on a solid fill of `color`: `theme-on-primary`. */
  on: string;
}

/** How much of an accent survives in its subtle form; the rest is the page. */
const SUBTLE = 0.25;

function accent(color: string, page: string, on: string, subtle = mix(color, page, SUBTLE)): Accent {
  return { color, subtle, on };
}

/**
 * A venn's overlap when it states no fill: the theme's secondary at its subtle
 * strength laid over the left set's fill, so the shared part reads as both
 * sets at once. A left fill that can't be measured is taken as the theme's
 * primary-subtle, the left set's default.
 */
export function overlapFill(under: string, theme: Theme): string {
  const base = /^#[0-9a-f]{6}$/i.test(under) ? under : theme.primary.subtle;
  return mix(theme.secondary.color, base, SUBTLE);
}

/**
 * A region's fill when it states none (design.org 8.3): the theme's primary
 * mixed toward the page, so that drawn at a region's half opacity it reads as
 * the primary at 12% did, the tint regions have always had. A page color that
 * can't be measured keeps the primary itself, at a quarter of the opacity.
 */
export function regionTint(theme: Theme, opacity: number): { color: string; opacity: number } {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!hex.test(theme.primary.color) || !hex.test(theme.background)) return { color: theme.primary.color, opacity: opacity * REGION_TINT };
  return { color: mix(theme.primary.color, theme.background, REGION_TINT), opacity };
}

/** How much of the primary a region's own tint keeps, so that at half opacity it is 12% of it. */
const REGION_TINT = 0.24;

/** `amount` of `color` over `page`, both `#rrggbb`. */
function mix(color: string, page: string, amount: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  let out = '#';
  for (const at of [1, 3, 5]) {
    const value = Math.round(channel(page, at) + (channel(color, at) - channel(page, at)) * amount);
    out += value.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Every color a file may name from the theme, and what it is in a given one.
 * The first six are the theme's own defaults for each part — what a line or a
 * box gets when the file says nothing — and the rest are its two accents. All
 * begin `theme-`, so a word that follows the theme says so, and no CSS color
 * name is taken.
 */
const THEME_COLOR_OF: Readonly<Record<string, (theme: Theme) => string>> = {
  'theme-page': (t) => t.background,
  'theme-text': (t) => t.text,
  'theme-muted': (t) => t.mutedText,
  'theme-fill': (t) => t.boxFill,
  'theme-border': (t) => t.boxStroke,
  'theme-line': (t) => t.edge,
  'theme-primary': (t) => t.primary.color,
  'theme-primary-subtle': (t) => t.primary.subtle,
  'theme-on-primary': (t) => t.primary.on,
  'theme-secondary': (t) => t.secondary.color,
  'theme-secondary-subtle': (t) => t.secondary.subtle,
  'theme-on-secondary': (t) => t.secondary.on,
};

export const THEME_COLORS: readonly string[] = Object.keys(THEME_COLOR_OF);

/** A color as written, with a `theme-` word replaced by the theme's value. */
export function themeColor(value: string, theme: Theme): string {
  const of = THEME_COLOR_OF[value];
  return of === undefined ? value : of(theme);
}

/**
 * The text a box gets when its fill is a theme color and its text says
 * nothing: the accent's own `on` color for a solid accent, and otherwise
 * whichever of the theme's text and page colors stands further from the fill.
 * A hand-picked fill is left alone — the theme has no say over it.
 */
export function textOnFill(fill: string, theme: Theme): string | undefined {
  if (fill === 'theme-primary') return theme.primary.on;
  if (fill === 'theme-secondary') return theme.secondary.on;
  if (THEME_COLOR_OF[fill] === undefined) return undefined;
  // `diagram background:` and `text:` may be any CSS color, which cannot be
  // measured here, so an overruled theme keeps its ordinary text.
  const measured = [themeColor(fill, theme), theme.text, theme.background];
  if (!measured.every((color) => /^#[0-9a-f]{6}$/i.test(color))) return theme.text;
  const under = luminance(themeColor(fill, theme));
  const apart = (color: string) => Math.abs(luminance(color) - under);
  return apart(theme.text) >= apart(theme.background) ? theme.text : theme.background;
}

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Sampled out of `examples/reference/arch.png` rather than invented,
 * so the benchmark render and the drawing it is measured against differ by
 * geometry and typography alone. A container is a shade off the page and barely
 * outlined; a leaf is the navy that carries the diagram's weight.
 */
export const DARK_THEME: Theme = {
  background: '#111111',
  boxFill: '#191728',
  boxStroke: '#4f5367',
  containerFill: '#191920',
  containerStroke: '#25242f',
  text: '#d9d9d9',
  mutedText: '#8b8b8b',
  edge: '#5c5c7c',
  // Both sampled off the reference's machine glyphs. Note that the reference
  // gives each icon its own hue — the drive is gray, the laptop periwinkle, the
  // workstation violet — which is a drawing tool's per-shape default and not a
  // system. One pair for the whole set is the deliberate difference: an icon
  // should read as part of the diagram's palette, not as clip art dropped in.
  iconInk: '#8d8d8e',
  // The reference's two colored boxes: `synced` is the green, `dump` the red.
  // The green's fill is sampled rather than mixed, so the benchmark written in
  // theme colors renders as it did in hex. The red's is mixed, as every other
  // theme's is: the sampled #460000 glared across a venn's whole set.
  primary: accent('#486544', '#111111', '#d9d9d9', '#142814'),
  secondary: accent('#8f3a3a', '#111111', '#d9d9d9'),
};

/** The dark theme's counterpart: the same roles, on a white page. */
const LIGHT_THEME: Theme = {
  background: '#ffffff',
  boxFill: '#eef0f7',
  boxStroke: '#8a90a8',
  containerFill: '#f6f7fa',
  containerStroke: '#dcdfe7',
  text: '#1f2328',
  mutedText: '#6e7781',
  edge: '#7c83a0',
  iconInk: '#57606a',
  primary: accent('#3a7d44', '#ffffff', '#ffffff'),
  secondary: accent('#b3423a', '#ffffff', '#ffffff'),
};

/**
 * Every theme a file may name, in the order they are offered. Pairs sit
 * together, dark first, and the two that have no light half follow them.
 */
export const THEMES: Readonly<Record<string, Theme>> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
  // Solarized, Ethan Schoonover. base03 page, base02 leaves, blue lines.
  'solarized-dark': {
    background: '#002b36',
    boxFill: '#073642',
    boxStroke: '#586e75',
    containerFill: '#03313c',
    containerStroke: '#0b3f4c',
    text: '#93a1a1',
    mutedText: '#657b83',
    edge: '#268bd2',
    iconInk: '#839496',
    primary: accent('#268bd2', '#002b36', '#fdf6e3'),
    secondary: accent('#cb4b16', '#002b36', '#fdf6e3'),
  },
  // base3 page, base2 leaves, the same blue.
  'solarized-light': {
    background: '#fdf6e3',
    boxFill: '#eee8d5',
    boxStroke: '#93a1a1',
    containerFill: '#f6efdc',
    containerStroke: '#e3dcc7',
    text: '#586e75',
    mutedText: '#93a1a1',
    edge: '#268bd2',
    iconInk: '#657b83',
    primary: accent('#268bd2', '#fdf6e3', '#fdf6e3'),
    secondary: accent('#cb4b16', '#fdf6e3', '#fdf6e3'),
  },
  // Gruvbox, Pavel Pertsev. bg0 page, bg1 leaves, the warm yellow for lines.
  'gruvbox-dark': {
    background: '#282828',
    boxFill: '#3c3836',
    boxStroke: '#665c54',
    containerFill: '#32302f',
    containerStroke: '#3c3836',
    text: '#ebdbb2',
    mutedText: '#a89984',
    edge: '#d79921',
    iconInk: '#a89984',
    primary: accent('#fe8019', '#282828', '#282828'),
    secondary: accent('#8ec07c', '#282828', '#282828'),
  },
  'gruvbox-light': {
    background: '#fbf1c7',
    boxFill: '#ebdbb2',
    boxStroke: '#bdae93',
    containerFill: '#f2e5bc',
    containerStroke: '#e5d4a7',
    text: '#3c3836',
    mutedText: '#7c6f64',
    edge: '#b57614',
    iconInk: '#7c6f64',
    primary: accent('#af3a03', '#fbf1c7', '#fbf1c7'),
    secondary: accent('#427b58', '#fbf1c7', '#fbf1c7'),
  },
  // Catppuccin. Mocha's base page and surface leaves, blue lines.
  'catppuccin-mocha': {
    background: '#1e1e2e',
    boxFill: '#313244',
    boxStroke: '#6c7086',
    containerFill: '#25253a',
    containerStroke: '#313244',
    text: '#cdd6f4',
    mutedText: '#9399b2',
    edge: '#89b4fa',
    iconInk: '#a6adc8',
    primary: accent('#cba6f7', '#1e1e2e', '#1e1e2e'),
    secondary: accent('#fab387', '#1e1e2e', '#1e1e2e'),
  },
  // Latte's base page and crust leaves, lavender lines.
  'catppuccin-latte': {
    background: '#eff1f5',
    boxFill: '#dce0e8',
    boxStroke: '#9ca0b0',
    containerFill: '#e6e9ef',
    containerStroke: '#ccd0da',
    text: '#4c4f69',
    mutedText: '#7c7f93',
    edge: '#7287fd',
    iconInk: '#6c6f85',
    primary: accent('#8839ef', '#eff1f5', '#eff1f5'),
    secondary: accent('#fe640b', '#eff1f5', '#eff1f5'),
  },
  // Nord, Sven Greb. Polar Night page and leaves, Frost lines.
  nord: {
    background: '#2e3440',
    boxFill: '#3b4252',
    boxStroke: '#4c566a',
    containerFill: '#333a47',
    containerStroke: '#3b4252',
    text: '#d8dee9',
    mutedText: '#7b88a1',
    edge: '#81a1c1',
    iconInk: '#aeb7c6',
    primary: accent('#88c0d0', '#2e3440', '#2e3440'),
    secondary: accent('#d08770', '#2e3440', '#2e3440'),
  },
  // Dracula, the free palette. Current-line leaves, comment borders, purple lines.
  dracula: {
    background: '#282a36',
    boxFill: '#44475a',
    boxStroke: '#6272a4',
    containerFill: '#21222c',
    containerStroke: '#343746',
    text: '#f8f8f2',
    mutedText: '#6272a4',
    edge: '#bd93f9',
    iconInk: '#b6b9cc',
    primary: accent('#bd93f9', '#282a36', '#282a36'),
    secondary: accent('#ff79c6', '#282a36', '#282a36'),
  },
  // Vesper, Rauno Freiberg. Near-black page, its input surface for leaves, and
  // the peach it spends on everything that matters for lines; mint second.
  vesper: {
    background: '#101010',
    boxFill: '#1c1c1c',
    boxStroke: '#505050',
    containerFill: '#161616',
    containerStroke: '#232323',
    text: '#ffffff',
    mutedText: '#a0a0a0',
    edge: '#ffc799',
    iconInk: '#a0a0a0',
    primary: accent('#ffc799', '#101010', '#101010'),
    secondary: accent('#99ffe4', '#101010', '#101010'),
  },
  // For low vision and projectors: no fills to lean on, every line at full
  // strength, and a container told apart by a gray outline alone.
  'high-contrast-dark': {
    background: '#000000',
    boxFill: '#000000',
    boxStroke: '#ffffff',
    containerFill: '#000000',
    containerStroke: '#9a9a9a',
    text: '#ffffff',
    mutedText: '#c8c8c8',
    edge: '#ffffff',
    iconInk: '#ffffff',
    primary: accent('#ffd400', '#000000', '#000000'),
    secondary: accent('#00e5ff', '#000000', '#000000'),
  },
  'high-contrast-light': {
    background: '#ffffff',
    boxFill: '#ffffff',
    boxStroke: '#000000',
    containerFill: '#ffffff',
    containerStroke: '#6a6a6a',
    text: '#000000',
    mutedText: '#3d3d3d',
    edge: '#000000',
    iconInk: '#000000',
    primary: accent('#0033cc', '#ffffff', '#ffffff'),
    secondary: accent('#b00000', '#ffffff', '#ffffff'),
  },
  // For paper: no fill anywhere an ink cartridge would notice, black lines,
  // gray only where the dark theme is quiet.
  print: {
    background: '#ffffff',
    boxFill: '#ffffff',
    boxStroke: '#000000',
    containerFill: '#ffffff',
    containerStroke: '#8c8c8c',
    text: '#000000',
    mutedText: '#666666',
    edge: '#333333',
    iconInk: '#000000',
    // Grays, and pale ones for fills: a box set apart without spending color.
    primary: accent('#333333', '#ffffff', '#ffffff', '#e6e6e6'),
    secondary: accent('#777777', '#ffffff', '#ffffff', '#f2f2f2'),
  },
};

/** The theme a file gets when it names none. */
export const DEFAULT_THEME = 'dark';

export const THEME_NAMES: readonly string[] = Object.keys(THEMES);
