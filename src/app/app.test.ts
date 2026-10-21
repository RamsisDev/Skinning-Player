import { FontRegistry, Fonts } from '@ng-native/expo/fonts';
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';
import { SkinManager } from './skins/skin-manager.ts';
import { fontFaceName } from './skins/skin.ts';
import {
  engineProvider,
  fakeDocumentPicker,
  fakeEngine,
  fakeMediaLibrary,
  memoryFiles,
  memoryStorage,
} from './testing/fakes.ts';

const providers = () => [memoryStorage(), engineProvider(fakeEngine())];

test('sends the user to settings when music access is refused for good', async () => {
  await render(App, { providers: providers() });

  expect(await screen.findByText('Music access is turned off')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open settings' })).toBeTruthy();
  expect(screen.getByText('Nothing playing')).toBeTruthy();
});

const twoSongs = () =>
  fakeMediaLibrary([
    ['1', 'Daft Punk - Digital Love.mp3', 301],
    ['2', 'Air - La Femme d Argent.mp3', 429],
  ]);

test('lists the songs on the device, and plays the one pressed in the full player', async () => {
  const engine = fakeEngine();
  await render(App, { providers: [memoryStorage(), engineProvider(engine), twoSongs()] });
  const user = userEvent.setup();

  expect(await screen.findByText('2 songs')).toBeTruthy();
  expect(screen.getByText('Daft Punk  ·  5:01')).toBeTruthy();
  await user.press(await screen.findByRole('button', { name: 'Digital Love, Daft Punk' }));

  expect(await screen.findByRole('heading', { name: 'Digital Love' })).toBeTruthy();
  // The full player's, the mini player's and the library row's.
  expect((await screen.findAllByRole('image', { name: 'No cover for Digital Love' })).length).toBe(3);
  expect(engine.loaded).toEqual(['file:///music/1.mp3']);
  expect(screen.getAllByRole('button', { name: 'Pause' }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: 'Shuffle' }).length).toBeGreaterThan(0);

  await user.press(screen.getByRole('button', { name: 'Close player' }));
  await user.type(screen.getByPlaceholderText('Search songs, artists or albums'), 'air');
  expect(await screen.findByText('1 of 2 songs')).toBeTruthy();
});

test('sets a song\'s cover from the full player', async () => {
  const disk = new Map([['file:///picked/art.png', Uint8Array.from([1, 2, 3])]]);
  await render(App, {
    providers: [
      memoryStorage(),
      engineProvider(fakeEngine()),
      twoSongs(),
      memoryFiles(disk),
      fakeDocumentPicker([{ uri: 'file:///picked/art.png', name: 'art.png', mimeType: 'image/png', size: 3, lastModified: 0 }]),
    ],
  });
  const user = userEvent.setup();

  await user.press(await screen.findByRole('button', { name: 'Digital Love, Daft Punk' }));
  await user.press(await screen.findByRole('button', { name: 'Change cover' }));
  expect(await screen.findByText('This song has no cover yet.')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Choose image' }));

  expect(await screen.findByText('Your image.')).toBeTruthy();
  expect(screen.getAllByRole('image', { name: 'Cover of Digital Love' }).length).toBeGreaterThan(0);
  expect([...disk.keys()].some((uri) => uri.startsWith('file:///documents/covers/1-'))).toBe(true);
});

test('switches skins from the skins tab', async () => {
  await render(App, { providers: providers() });
  const user = userEvent.setup();

  expect(screen.getByText('Llama Classic')).toBeTruthy();
  await user.press(screen.getByRole('tab', { name: 'Skins' }));
  await user.press(screen.getByRole('button', { name: 'Use skin Paper' }));

  expect(screen.getAllByText('Paper').length).toBeGreaterThan(1);
  expect(screen.getByText('In use')).toBeTruthy();
});

test('loads the font files of the skin in use and draws its text in them', async () => {
  const loads: Record<string, unknown>[] = [];
  const fonts = new FontRegistry({
    loadAsync: async (map) => void loads.push(map),
    isLoaded: () => true,
    getLoadedFonts: () => [],
  });
  const view = await render(App, { providers: [...providers(), { provide: Fonts, useValue: fonts }] });
  const skins = view.componentRef.injector.get(SkinManager);

  const face = { family: 'Orbitron', weight: 700, src: 'https://example.com/Orbitron-Bold.ttf' };
  const result = skins.install({ name: 'Arcade', fonts: [face], typography: { fontFamily: 'Orbitron' }, motion: { speed: 0 } });
  if (!result.ok) throw new Error(result.error.code);
  skins.apply(result.skin.id);
  await view.detectChanges();

  expect(loads).toEqual([{ [fontFaceName(face)]: face.src }]);
  expect(screen.getByText('Nothing playing').props).toMatchObject({ fontFamily: fontFaceName(face), fontWeight: '400' });
  expect(skins.playerTransition()).toBe('none');

  skins.apply('classic');
  await view.detectChanges();
  skins.apply(result.skin.id);
  await view.detectChanges();
  expect(loads).toHaveLength(1);
});

test('creates a playlist from the playlists tab', async () => {
  await render(App, { providers: providers() });
  const user = userEvent.setup();

  await user.press(screen.getByRole('tab', { name: 'Playlists' }));
  expect(screen.getByText('0 playlists')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'New playlist' }));
  await user.type(screen.getByPlaceholderText('Playlist name'), 'Gym');
  await user.press(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByRole('heading', { name: 'Gym' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Back to playlists' }));
  expect(screen.getByText('1 playlist')).toBeTruthy();
});
