import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_SKINS, CLASSIC_SKIN } from './builtin-skins.ts';
import { type Skin, fontFaceName, parseSkin, skinCssVars, skinFontSources } from './skin.ts';

const bases: ReadonlyMap<string, Skin> = new Map(BUILTIN_SKINS.map((skin) => [skin.id, skin]));
const parse = (input: unknown) => parseSkin(input, bases, CLASSIC_SKIN);

describe('parseSkin', () => {
  it('rejects text that is not JSON, and a skin with no name', () => {
    expect(parse('{ nope')).toEqual({ ok: false, error: { code: 'invalidJson' } });
    expect(parse('[]')).toEqual({ ok: false, error: { code: 'notObject' } });
    expect(parse({ colors: {} })).toEqual({ ok: false, error: { code: 'noName' } });
    expect(parse({ name: 'X', format: 2 })).toEqual({
      ok: false,
      error: { code: 'unsupportedFormat', found: '2', expected: 1 },
    });
  });

  it('fills what a skin leaves out from the classic skin', () => {
    const result = parse(JSON.stringify({ name: 'Only Accent', colors: { accent: '#ff0000' } }));
    if (!result.ok) throw new Error(result.error.code);
    expect(result.invalid).toEqual([]);
    expect(result.skin.id).toBe('only-accent');
    expect(result.skin.colors.accent).toBe('#ff0000');
    expect(result.skin.colors.background).toBe(CLASSIC_SKIN.colors.background);
    expect(result.skin.icons.play).toBe(CLASSIC_SKIN.icons.play);
  });

  it('inherits from the built-in skin it extends', () => {
    const result = parse({ name: 'Paper Blue', extends: 'paper', colors: { accent: 'rgb(0, 80, 200)' } });
    if (!result.ok) throw new Error(result.error.code);
    const paper = bases.get('paper')!;
    expect(result.skin.colors.background).toBe(paper.colors.background);
    expect(result.skin.typography.fontFamily).toBe('serif');
    expect(result.skin.statusBar).toBe('dark');
    expect(result.skin.colors.accent).toBe('rgb(0, 80, 200)');
  });

  it('drops invalid values, naming each one, and keeps the rest', () => {
    const result = parse({
      name: 'Messy',
      extends: 'nowhere',
      colors: { accent: 'url(evil)', text: '#fff', unknownKey: '#000' },
      shape: { radius: 999, borderWidth: 'thick' },
      typography: { fontFamily: 'Comic; Sans', scale: 9 },
      images: { background: 'javascript:alert(1)', backgroundOpacity: 0.5 },
      icons: { play: '<svg><script/></svg>', stop: '<svg></svg>', pause: '<svg viewBox="0 0 2 2"></svg>' },
      widgets: { visualizerBars: 100, visualizer: 'yes' },
    });
    if (!result.ok) throw new Error(result.error.code);
    const { skin, invalid } = result;
    expect(skin.colors.accent).toBe(CLASSIC_SKIN.colors.accent);
    expect(skin.colors.text).toBe('#fff');
    expect(skin.shape.radius).toBe(40);
    expect(skin.shape.borderWidth).toBe(CLASSIC_SKIN.shape.borderWidth);
    expect(skin.typography.fontFamily).toBe(CLASSIC_SKIN.typography.fontFamily);
    expect(skin.typography.scale).toBe(1.4);
    expect(skin.images.background).toBeNull();
    expect(skin.images.backgroundOpacity).toBe(0.5);
    expect(skin.icons.play).toBe(CLASSIC_SKIN.icons.play);
    expect(skin.icons.pause).toBe('<svg viewBox="0 0 2 2"></svg>');
    expect(skin.widgets.visualizerBars).toBe(32);
    expect(skin.widgets.visualizer).toBe(true);
    expect(invalid).toEqual(
      expect.arrayContaining([
        'extends',
        'colors.accent',
        'colors.unknownKey',
        'shape.borderWidth',
        'typography.fontFamily',
        'images.background',
        'icons.play',
        'icons.stop',
        'widgets.visualizer',
      ]),
    );
  });

  it('lets a skin clear an inherited glyph back to the default icon', () => {
    const result = parse({ name: 'Plain', icons: { play: null } });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.skin.icons.play).toBeUndefined();
    expect(result.skin.icons.pause).toBe(CLASSIC_SKIN.icons.pause);
  });

  it('reads font files, weights and motion, dropping what is invalid', () => {
    const result = parse({
      name: 'Arcade',
      fonts: [
        { family: 'Orbitron', src: 'https://example.com/Orbitron-Regular.ttf' },
        { family: 'Orbitron', weight: 680, src: 'https://example.com/Orbitron-Bold.ttf' },
        { family: 'Evil', src: 'javascript:alert(1)' },
        { family: 'Heavy', weight: 2000, src: 'file:///fonts/heavy.otf' },
      ],
      typography: { fontFamily: 'Orbitron', weights: { regular: 300, bold: 'heavy', huge: 900 } },
      motion: { speed: 9, easing: 'bouncy', pressScale: 0.5, sheetTransition: 'slide', displayEffect: 'spin' },
    });
    if (!result.ok) throw new Error(result.error.code);
    const { skin, invalid } = result;
    expect(skin.fonts).toEqual([
      { family: 'Orbitron', weight: 400, src: 'https://example.com/Orbitron-Regular.ttf' },
      { family: 'Orbitron', weight: 700, src: 'https://example.com/Orbitron-Bold.ttf' },
    ]);
    expect(skin.typography.weights).toEqual({ regular: 300, medium: 600, bold: 700 });
    expect(skin.motion).toMatchObject({ speed: 4, easing: 'bouncy', pressScale: 0.8, sheetTransition: 'slide' });
    expect(skin.motion.displayEffect).toBe('none');
    expect(invalid).toEqual(
      expect.arrayContaining([
        'fonts[2].src',
        'fonts[3].weight',
        'typography.weights.bold',
        'typography.weights.huge',
        'motion.displayEffect',
      ]),
    );
  });

  it('lays a skin\'s faces over the ones it inherits', () => {
    const parent = parse({
      name: 'Parent',
      fonts: [
        { family: 'Inter', src: 'https://example.com/a.ttf' },
        { family: 'Inter', weight: 700, src: 'https://example.com/b.ttf' },
      ],
    });
    if (!parent.ok) throw new Error(parent.error.code);
    const family = new Map([...bases, ['parent', parent.skin]]);
    const child = parseSkin(
      { name: 'Child', extends: 'parent', fonts: [{ family: 'Inter', weight: 700, src: 'https://example.com/c.ttf' }] },
      family,
      CLASSIC_SKIN,
    );
    const cleared = parseSkin({ name: 'Cleared', extends: 'parent', fonts: null }, family, CLASSIC_SKIN);
    if (!child.ok || !cleared.ok) throw new Error('expected both to parse');
    expect(child.skin.fonts.map((face) => face.src)).toEqual(['https://example.com/a.ttf', 'https://example.com/c.ttf']);
    expect(cleared.skin.fonts).toEqual([]);
  });
});

describe('skinCssVars', () => {
  it('turns every token into a custom property, scaling the font sizes', () => {
    const paper = bases.get('paper')!;
    const vars = skinCssVars(paper);
    expect(vars['--sk-background']).toBe(paper.colors.background);
    expect(vars['--sk-menu-active-text']).toBe(paper.colors.menuActiveText);
    expect(vars['--sk-button-radius']).toBe('8px');
    expect(vars['--sk-font']).toBe('serif');
    expect(vars['--sk-font-md']).toBe(`${Math.round(15 * 1.05)}px`);
  });

  it('gives a platform font its weights as written', () => {
    const result = parse({ name: 'Light', typography: { weights: { regular: 300, bold: 900 } } });
    if (!result.ok) throw new Error(result.error.code);
    const vars = skinCssVars(result.skin);
    expect(vars['--sk-font']).toBe('sans-serif');
    expect(vars['--sk-weight']).toBe('300');
    expect(vars['--sk-font-bold']).toBe('sans-serif');
    expect(vars['--sk-weight-bold']).toBe('900');
    expect(vars['--sk-display-font-bold']).toBe('monospace');
    expect(vars['--sk-display-weight-bold']).toBe('900');
  });

  it('points each weight of a shipped family at its nearest face', () => {
    const result = parse({
      name: 'Faces',
      fonts: [
        { family: 'Inter', weight: 300, src: 'https://example.com/light.ttf' },
        { family: 'Inter', weight: 800, src: 'https://example.com/extrabold.ttf' },
      ],
      typography: { fontFamily: 'Inter', weights: { regular: 400, medium: 600, bold: 700 } },
    });
    if (!result.ok) throw new Error(result.error.code);
    const [light, extrabold] = result.skin.fonts;
    const vars = skinCssVars(result.skin);
    expect(vars['--sk-font']).toBe(fontFaceName(light!));
    expect(vars['--sk-font-medium']).toBe(fontFaceName(extrabold!));
    expect(vars['--sk-font-bold']).toBe(fontFaceName(extrabold!));
    expect(vars['--sk-weight']).toBe('400');
    expect(vars['--sk-weight-bold']).toBe('400');
    expect(vars['--sk-display-font']).toBe('monospace');
    expect(skinFontSources(result.skin)).toEqual({
      [fontFaceName(light!)]: 'https://example.com/light.ttf',
      [fontFaceName(extrabold!)]: 'https://example.com/extrabold.ttf',
    });
    expect(fontFaceName(light!)).toMatch(/^sk-inter-300-[a-z0-9]+$/);
  });

  it('scales durations by the skin\'s speed, and stops them at speed 0', () => {
    const fast = parse({ name: 'Fast', motion: { speed: 2, pressScale: 0.9, displayEffect: 'pulse' } });
    const still = parse({ name: 'Still', motion: { speed: 0, displayEffect: 'pulse' } });
    if (!fast.ok || !still.ok) throw new Error('expected both to parse');
    expect(skinCssVars(fast.skin)).toMatchObject({
      '--sk-duration-fast': '60ms',
      '--sk-duration-slow': '225ms',
      '--sk-effect-duration': '1200ms',
      '--sk-press-scale': '0.9',
      '--sk-press-opacity': '0.7',
    });
    expect(skinCssVars(still.skin)).toMatchObject({ '--sk-duration-fast': '0ms', '--sk-effect-duration': '0ms' });
  });
});

it('ships built-in skins with distinct ids', () => {
  const ids = BUILTIN_SKINS.map((skin) => skin.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it('keeps the example skin files in skins/ valid', () => {
  const dir = new URL('../../../skins/', import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);
  for (const name of files) {
    const result = parse(readFileSync(new URL(name, dir), 'utf8'));
    expect(result, name).toMatchObject({ ok: true, invalid: [] });
  }
});
