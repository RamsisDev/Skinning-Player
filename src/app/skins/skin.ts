/**
 * A skin is data, not code: a JSON document of colors, shapes, fonts (system ones or font files it
 * ships), font weights, motion, an optional background image and optional SVG glyphs for the
 * buttons. The app turns it into CSS custom properties on its root view, and every component's
 * stylesheet reads those, so loading a skin restyles the menu, the buttons and the widgets at
 * runtime without a rebuild.
 *
 * Like a Winamp skin missing a bitmap, a skin file only has to name what it changes: everything
 * else comes from the skin it `extends` (the classic one by default).
 */

export const SKIN_FORMAT = 1;

export const COLOR_KEYS = [
  'background',
  'surface',
  'surfaceAlt',
  'border',
  'text',
  'textMuted',
  'accent',
  'accentText',
  'danger',
  'menuBackground',
  'menuText',
  'menuActiveBackground',
  'menuActiveText',
  'buttonBackground',
  'buttonText',
  'buttonBorder',
  'primaryBackground',
  'primaryText',
  'widgetBackground',
  'widgetBorder',
  'widgetText',
  'displayBackground',
  'displayText',
  'progressTrack',
  'progressFill',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const ICON_SLOTS = [
  'play',
  'pause',
  'previous',
  'next',
  'shuffle',
  'repeat',
  'repeatOne',
  'library',
  'playlists',
  'skins',
  'add',
  'addToPlaylist',
  'more',
  'close',
  'back',
  'remove',
  'rename',
  'search',
  'import',
  'check',
  'refresh',
  'cover',
  'warning',
  'settings',
  'sort',
  'queue',
  'moveUp',
  'moveDown',
  'drag',
  'share',
  'info',
] as const;
export type IconSlot = (typeof ICON_SLOTS)[number];

export type BackgroundResize = 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';

/** Body text, labels and titles: the weight each kind of text is drawn in. */
export const WEIGHT_ROLES = ['regular', 'medium', 'bold'] as const;
export type WeightRole = (typeof WEIGHT_ROLES)[number];

/**
 * The curves a skin can ease its motion by. Named rather than free-form because a curve is only
 * read from a stylesheet token, and the stylesheet declares one per name (see `app.ts`).
 */
export const EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'smooth', 'snappy', 'bouncy'] as const;
export type Easing = (typeof EASINGS)[number];

export const MODAL_TRANSITIONS = ['slide', 'fade', 'none'] as const;
export type ModalTransition = (typeof MODAL_TRANSITIONS)[number];

/** A looping effect on the player's display. `blink` blinks the time while paused, as Winamp did. */
export const DISPLAY_EFFECTS = ['none', 'pulse', 'flicker', 'blink'] as const;
export type DisplayEffect = (typeof DISPLAY_EFFECTS)[number];

/** A font file the skin ships, which `typography` can name by its family. */
export interface SkinFont {
  readonly family: string;
  /** 100 to 900. The faces of a family are picked by weight as CSS picks them. */
  readonly weight: number;
  /** `https://`, `file://` or a `data:font/ttf;base64,` URI of a .ttf or .otf file. */
  readonly src: string;
}

export interface SkinShape {
  /** Cards, rows and sheets. */
  readonly radius: number;
  readonly buttonRadius: number;
  readonly widgetRadius: number;
  readonly borderWidth: number;
}

export interface SkinTypography {
  /**
   * A family from the skin's `fonts`, or one the platform knows: `sans-serif`, `serif`,
   * `monospace`, `sans-serif-condensed`...
   */
  readonly fontFamily: string;
  /** The family of the player's display (the time readout and the scrolling title). */
  readonly displayFontFamily: string;
  /** Multiplies every font size, between 0.8 and 1.4. */
  readonly scale: number;
  /** 100 to 900 for each kind of text, in both families. */
  readonly weights: Readonly<Record<WeightRole, number>>;
}

export interface SkinMotion {
  /** Multiplies how fast everything moves, 0 to 4; 0 turns motion off. */
  readonly speed: number;
  readonly easing: Easing;
  /** How a pressed button or card looks: its scale, 0.8 to 1, and its opacity, 0.2 to 1. */
  readonly pressScale: number;
  readonly pressOpacity: number;
  /** How the menus and dialogs come in, and how the full player does. */
  readonly sheetTransition: ModalTransition;
  readonly playerTransition: ModalTransition;
  readonly displayEffect: DisplayEffect;
}

export interface SkinImages {
  /** `https://`, `file://` or a `data:image/...;base64,` URI. */
  readonly background: string | null;
  readonly backgroundOpacity: number;
  readonly backgroundResize: BackgroundResize;
}

export interface SkinWidgets {
  /** The decorative spectrum bars in the player. */
  readonly visualizer: boolean;
  readonly visualizerBars: number;
  /** The display panel in the mini player: time readout instead of plain text. */
  readonly miniDisplay: boolean;
}

export interface Skin {
  readonly format: typeof SKIN_FORMAT;
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly description: string;
  readonly statusBar: 'light' | 'dark';
  readonly colors: Readonly<Record<ColorKey, string>>;
  readonly shape: SkinShape;
  readonly fonts: readonly SkinFont[];
  readonly typography: SkinTypography;
  readonly images: SkinImages;
  /** SVG markup per button slot. A slot not listed draws the default icon. */
  readonly icons: Readonly<Partial<Record<IconSlot, string>>>;
  readonly widgets: SkinWidgets;
  readonly motion: SkinMotion;
}

export type SkinError =
  | { readonly code: 'invalidJson' }
  | { readonly code: 'notObject' }
  | { readonly code: 'unsupportedFormat'; readonly found: string; readonly expected: number }
  | { readonly code: 'noName' };

/** `invalid` lists the path of each value that was left out, such as `colors.accent`. */
export type ParseResult =
  | { readonly ok: true; readonly skin: Skin; readonly invalid: readonly string[] }
  | { readonly ok: false; readonly error: SkinError };

const COLOR =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[-\d.%\s,/]+\)|transparent|[a-z]{3,20})$/i;
const FONT_FAMILY = /^[a-z0-9][a-z0-9 _-]{0,39}$/i;
const IMAGE_URI = /^(https:\/\/|file:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i;
const FONT_URI =
  /^(https:\/\/|file:\/\/|data:(font\/(ttf|otf|sfnt)|application\/(x-font-ttf|x-font-otf|font-sfnt|octet-stream));base64,)/i;
const MAX_IMAGE_URI = 3_000_000;
const MAX_FONT_URI = 3_000_000;
const MAX_FONTS = 8;
const MAX_SVG = 20_000;
const RESIZE_MODES: readonly BackgroundResize[] = ['cover', 'contain', 'stretch', 'repeat', 'center'];

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'skin'
  );
}

/** A CSS weight from 1 to 1000, at the nearest hundred native draws. Null for anything else. */
function weightOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 1000) return null;
  return clamp(Math.round(value / 100) * 100, 100, 900);
}

const sameFace = (a: SkinFont, b: SkinFont): boolean =>
  a.family.toLowerCase() === b.family.toLowerCase() && a.weight === b.weight;

function isSvg(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_SVG) return false;
  const svg = value.trim();
  return svg.startsWith('<svg') && svg.endsWith('</svg>') && !/<script/i.test(svg);
}

/**
 * Reads a skin document, from JSON text or an already-parsed object, over the skins it may
 * extend. A value of the wrong shape is left out with a warning rather than failing the skin:
 * the rest of it still applies, as the base skin fills the gap.
 */
export function parseSkin(input: unknown, bases: ReadonlyMap<string, Skin>, fallbackBase: Skin): ParseResult {
  let doc: unknown = input;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input);
    } catch {
      return { ok: false, error: { code: 'invalidJson' } };
    }
  }
  if (!isRecord(doc)) return { ok: false, error: { code: 'notObject' } };
  if (doc['format'] !== undefined && doc['format'] !== SKIN_FORMAT) {
    return { ok: false, error: { code: 'unsupportedFormat', found: String(doc['format']), expected: SKIN_FORMAT } };
  }
  const name = typeof doc['name'] === 'string' ? doc['name'].trim().slice(0, 40) : '';
  if (!name) return { ok: false, error: { code: 'noName' } };

  const invalid: string[] = [];
  const warn = (path: string): void => void invalid.push(path);

  let base = fallbackBase;
  if (doc['extends'] !== undefined) {
    const parent = typeof doc['extends'] === 'string' ? bases.get(doc['extends']) : undefined;
    if (parent) base = parent;
    else warn('extends');
  }

  const colors: Record<ColorKey, string> = { ...base.colors };
  if (isRecord(doc['colors'])) {
    for (const [key, value] of Object.entries(doc['colors'])) {
      if ((COLOR_KEYS as readonly string[]).includes(key) && typeof value === 'string' && COLOR.test(value.trim())) {
        colors[key as ColorKey] = value.trim();
      } else {
        warn(`colors.${key}`);
      }
    }
  } else if (doc['colors'] !== undefined) warn('colors');

  const shape = { ...base.shape };
  if (isRecord(doc['shape'])) {
    const limits: Record<keyof SkinShape, [number, number]> = {
      radius: [0, 40],
      buttonRadius: [0, 40],
      widgetRadius: [0, 40],
      borderWidth: [0, 6],
    };
    for (const [key, value] of Object.entries(doc['shape'])) {
      const limit = limits[key as keyof SkinShape];
      if (limit && typeof value === 'number' && Number.isFinite(value)) {
        shape[key as keyof SkinShape] = clamp(value, limit[0], limit[1]);
      } else warn(`shape.${key}`);
    }
  } else if (doc['shape'] !== undefined) warn('shape');

  // A skin's faces are laid over the ones it inherits: a family and weight it declares replaces
  // the inherited face, and null drops every inherited one.
  let fonts: SkinFont[] = [...base.fonts];
  if (doc['fonts'] === null) fonts = [];
  else if (Array.isArray(doc['fonts'])) {
    doc['fonts'].forEach((entry: unknown, index) => {
      const path = `fonts[${index}]`;
      if (!isRecord(entry)) return warn(path);
      const { family, src } = entry;
      const weight = entry['weight'] === undefined ? 400 : weightOf(entry['weight']);
      if (typeof family !== 'string' || !FONT_FAMILY.test(family)) return warn(`${path}.family`);
      if (weight === null) return warn(`${path}.weight`);
      if (typeof src !== 'string' || src.length > MAX_FONT_URI || !FONT_URI.test(src)) return warn(`${path}.src`);
      const face: SkinFont = { family, weight, src };
      fonts = [...fonts.filter((known) => !sameFace(known, face)), face];
    });
    if (fonts.length > MAX_FONTS) {
      warn('fonts');
      fonts = fonts.slice(-MAX_FONTS);
    }
  } else if (doc['fonts'] !== undefined) warn('fonts');

  const typography = { ...base.typography, weights: { ...base.typography.weights } };
  if (isRecord(doc['typography'])) {
    const t = doc['typography'];
    for (const key of ['fontFamily', 'displayFontFamily'] as const) {
      if (t[key] === undefined) continue;
      if (typeof t[key] === 'string' && FONT_FAMILY.test(t[key])) typography[key] = t[key];
      else warn(`typography.${key}`);
    }
    if (t['scale'] !== undefined) {
      if (typeof t['scale'] === 'number' && Number.isFinite(t['scale'])) typography.scale = clamp(t['scale'], 0.8, 1.4);
      else warn('typography.scale');
    }
    if (isRecord(t['weights'])) {
      for (const [key, value] of Object.entries(t['weights'])) {
        const weight = weightOf(value);
        if (includes(WEIGHT_ROLES, key) && weight !== null) typography.weights[key] = weight;
        else warn(`typography.weights.${key}`);
      }
    } else if (t['weights'] !== undefined) warn('typography.weights');
  } else if (doc['typography'] !== undefined) warn('typography');

  const images = { ...base.images };
  if (isRecord(doc['images'])) {
    const i = doc['images'];
    if (i['background'] !== undefined) {
      if (i['background'] === null) images.background = null;
      else if (typeof i['background'] === 'string' && i['background'].length <= MAX_IMAGE_URI && IMAGE_URI.test(i['background'])) {
        images.background = i['background'];
      } else warn('images.background');
    }
    if (i['backgroundOpacity'] !== undefined) {
      if (typeof i['backgroundOpacity'] === 'number' && Number.isFinite(i['backgroundOpacity'])) {
        images.backgroundOpacity = clamp(i['backgroundOpacity'], 0, 1);
      } else warn('images.backgroundOpacity');
    }
    if (i['backgroundResize'] !== undefined) {
      if (RESIZE_MODES.includes(i['backgroundResize'] as BackgroundResize)) {
        images.backgroundResize = i['backgroundResize'] as BackgroundResize;
      } else warn('images.backgroundResize');
    }
  } else if (doc['images'] !== undefined) warn('images');

  const icons: Partial<Record<IconSlot, string>> = { ...base.icons };
  if (isRecord(doc['icons'])) {
    for (const [key, value] of Object.entries(doc['icons'])) {
      if (!(ICON_SLOTS as readonly string[]).includes(key)) warn(`icons.${key}`);
      else if (value === null) delete icons[key as IconSlot];
      else if (isSvg(value)) icons[key as IconSlot] = value.trim();
      else warn(`icons.${key}`);
    }
  } else if (doc['icons'] !== undefined) warn('icons');

  const widgets = { ...base.widgets };
  if (isRecord(doc['widgets'])) {
    const w = doc['widgets'];
    for (const key of ['visualizer', 'miniDisplay'] as const) {
      if (w[key] === undefined) continue;
      if (typeof w[key] === 'boolean') widgets[key] = w[key];
      else warn(`widgets.${key}`);
    }
    if (w['visualizerBars'] !== undefined) {
      if (typeof w['visualizerBars'] === 'number' && Number.isFinite(w['visualizerBars'])) {
        widgets.visualizerBars = Math.round(clamp(w['visualizerBars'], 4, 32));
      } else warn('widgets.visualizerBars');
    }
  } else if (doc['widgets'] !== undefined) warn('widgets');

  const motion = { ...base.motion };
  if (isRecord(doc['motion'])) {
    const m = doc['motion'];
    const ranges = { speed: [0, 4], pressScale: [0.8, 1], pressOpacity: [0.2, 1] } as const;
    for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
      if (m[key] === undefined) continue;
      const [min, max] = ranges[key];
      if (typeof m[key] === 'number' && Number.isFinite(m[key])) motion[key] = clamp(m[key], min, max);
      else warn(`motion.${key}`);
    }
    if (m['easing'] !== undefined) {
      if (includes(EASINGS, m['easing'])) motion.easing = m['easing'];
      else warn('motion.easing');
    }
    for (const key of ['sheetTransition', 'playerTransition'] as const) {
      if (m[key] === undefined) continue;
      if (includes(MODAL_TRANSITIONS, m[key])) motion[key] = m[key];
      else warn(`motion.${key}`);
    }
    if (m['displayEffect'] !== undefined) {
      if (includes(DISPLAY_EFFECTS, m['displayEffect'])) motion.displayEffect = m['displayEffect'];
      else warn('motion.displayEffect');
    }
  } else if (doc['motion'] !== undefined) warn('motion');

  let statusBar = base.statusBar;
  if (doc['statusBar'] !== undefined) {
    if (doc['statusBar'] === 'light' || doc['statusBar'] === 'dark') statusBar = doc['statusBar'];
    else warn('statusBar');
  }

  const text = (key: string, max: number): string =>
    typeof doc[key] === 'string' ? (doc[key] as string).trim().slice(0, max) : '';

  return {
    ok: true,
    invalid,
    skin: {
      format: SKIN_FORMAT,
      id: typeof doc['id'] === 'string' && doc['id'].trim() ? slugify(doc['id']) : slugify(name),
      name,
      author: text('author', 60),
      description: text('description', 160),
      statusBar,
      colors,
      shape,
      fonts,
      typography,
      images,
      icons,
      widgets,
      motion,
    },
  };
}

const FONT_SIZES = { xs: 11, sm: 13, md: 15, lg: 18, xl: 24, xxl: 40 } as const;
/** Milliseconds at speed 1: a press or a highlight, and the visualizer's bars. */
const DURATIONS = { fast: 120, slow: 450 } as const;
const EFFECT_DURATIONS: Record<DisplayEffect, number> = { none: 0, pulse: 2400, flicker: 4000, blink: 1000 };

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const sourceHashes = new Map<string, string>();

/** A short, stable hash of a font's source, so two files of one family never share a name. */
function sourceHash(src: string): string {
  let hash = sourceHashes.get(src);
  if (hash === undefined) {
    let h = 5381;
    for (let i = 0; i < src.length; i++) h = (Math.imul(h, 33) ^ src.charCodeAt(i)) >>> 0;
    hash = h.toString(36);
    sourceHashes.set(src, hash);
  }
  return hash;
}

/**
 * The name a face is registered with the platform under. Native finds a font by name alone, and
 * a name stays registered until the app restarts, so it carries the file's hash.
 */
export function fontFaceName(face: SkinFont): string {
  return `sk-${slugify(face.family)}-${face.weight}-${sourceHash(face.src)}`;
}

/** Every font file the skin ships, by the name it is registered under. */
export function skinFontSources(skin: Skin): Record<string, string> {
  return Object.fromEntries(skin.fonts.map((face) => [fontFaceName(face), face.src]));
}

/**
 * The face CSS's matching picks among a family's for a weight (CSS Fonts 4, section 5.2): for 400
 * to 500, the weights up to 500 first, then lighter ones, then heavier; under 400, lighter then
 * heavier; over 500, heavier then lighter. Each direction nearest first.
 */
function pickFace(faces: readonly SkinFont[], weight: number): SkinFont | undefined {
  const heavier = (from: number, to: number) =>
    faces.filter((f) => f.weight >= from && f.weight <= to).sort((a, b) => a.weight - b.weight)[0];
  const lighter = (upTo: number) => faces.filter((f) => f.weight <= upTo).sort((a, b) => b.weight - a.weight)[0];
  if (weight >= 400 && weight <= 500) return heavier(weight, 500) ?? lighter(weight) ?? heavier(500, Infinity);
  if (weight < 400) return lighter(weight) ?? heavier(weight, Infinity);
  return heavier(weight, Infinity) ?? lighter(weight);
}

/**
 * The family and weight a text is committed with. A family the skin ships a file for is pointed at
 * the face for the weight, at a plain weight: the face draws its own, and a weight beside a
 * custom face makes Android draw its system font instead. Any other family is the platform's, at
 * the weight as written.
 */
function resolveFont(skin: Skin, family: string, weight: number): { family: string; weight: string } {
  const faces = skin.fonts.filter((face) => face.family.toLowerCase() === family.toLowerCase());
  const face = pickFace(faces, weight);
  return face ? { family: fontFaceName(face), weight: '400' } : { family, weight: String(weight) };
}

/**
 * The skin as the custom properties every stylesheet in the app reads: `--sk-<color>` for each
 * color (kebab-cased), `--sk-radius`, `--sk-button-radius`, `--sk-widget-radius`,
 * `--sk-border-width` and `--sk-font-xs` to `--sk-font-xxl`.
 *
 * A text sets its family and weight together, from one pair: `--sk-font` with `--sk-weight`,
 * `--sk-font-medium` with `--sk-weight-medium`, `--sk-font-bold` with `--sk-weight-bold`, and
 * `--sk-display-font` and `--sk-display-font-bold` with their `--sk-display-weight*`.
 *
 * Motion is `--sk-duration-fast`, `--sk-duration-slow`, `--sk-effect-duration`,
 * `--sk-press-scale` and `--sk-press-opacity`; the curve is a class on the root (`easing-<name>`).
 */
export function skinCssVars(skin: Skin): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of COLOR_KEYS) vars[`--sk-${kebab(key)}`] = skin.colors[key];
  vars['--sk-radius'] = `${skin.shape.radius}px`;
  vars['--sk-button-radius'] = `${skin.shape.buttonRadius}px`;
  vars['--sk-widget-radius'] = `${skin.shape.widgetRadius}px`;
  vars['--sk-border-width'] = `${skin.shape.borderWidth}px`;
  for (const [size, points] of Object.entries(FONT_SIZES)) {
    vars[`--sk-font-${size}`] = `${Math.round(points * skin.typography.scale)}px`;
  }

  const { fontFamily, displayFontFamily, weights } = skin.typography;
  const fontPairs: [string, string, string, WeightRole][] = [
    ['--sk-font', '--sk-weight', fontFamily, 'regular'],
    ['--sk-font-medium', '--sk-weight-medium', fontFamily, 'medium'],
    ['--sk-font-bold', '--sk-weight-bold', fontFamily, 'bold'],
    ['--sk-display-font', '--sk-display-weight', displayFontFamily, 'regular'],
    ['--sk-display-font-bold', '--sk-display-weight-bold', displayFontFamily, 'bold'],
  ];
  for (const [familyVar, weightVar, family, role] of fontPairs) {
    const resolved = resolveFont(skin, family, weights[role]);
    vars[familyVar] = resolved.family;
    vars[weightVar] = resolved.weight;
  }

  const { speed, displayEffect } = skin.motion;
  const scaled = (ms: number): string => `${speed > 0 ? Math.round(ms / speed) : 0}ms`;
  vars['--sk-duration-fast'] = scaled(DURATIONS.fast);
  vars['--sk-duration-slow'] = scaled(DURATIONS.slow);
  vars['--sk-effect-duration'] = scaled(EFFECT_DURATIONS[displayEffect]);
  vars['--sk-press-scale'] = String(skin.motion.pressScale);
  vars['--sk-press-opacity'] = String(skin.motion.pressOpacity);
  return vars;
}
