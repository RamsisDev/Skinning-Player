import { Storage } from '@ng-native/expo/async-storage';
import { type FakeFabricNode, type RenderResult, render, screen, userEvent, waitFor, within } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from '../app.ts';
import {
  engineProvider,
  fakeDialogs,
  fakeEngine,
  fakeHardwareBack,
  fakeMediaLibrary,
  memoryFiles,
  memoryStorage,
  musicUri,
  taggedMp3,
} from '../testing/fakes.ts';

type AudioFile = [id: string, filename: string, seconds: number];

const files: AudioFile[] = [
  ['1', 'A Dios Le Pido.mp3', 211],
  ['2', 'Amarrame.mp3', 200],
  ['3', 'Al Cielo No.mp3', 240],
  ['4', 'Daft Punk - Digital Love.mp3', 301],
];
const tags = () =>
  new Map([
    [musicUri('1'), taggedMp3({ title: 'A Dios Le Pido', artist: 'Juanes', album: 'Un Día Normal', genre: 'Rock' })],
    [musicUri('2'), taggedMp3({ title: 'Amárrame', artist: 'Mon Laferte, Juanes', album: 'La Trenza', genre: 'Pop' })],
    [musicUri('3'), taggedMp3({ title: 'Al Cielo No', artist: 'El Cuarteto De Nos', album: 'Canciones del Corazón', genre: 'Rock' })],
  ]);

async function launch(storage = new Map<string, string>()) {
  const engine = fakeEngine();
  const dialogs = fakeDialogs();
  const back = fakeHardwareBack();
  const view = await render(App, {
    providers: [
      memoryStorage(storage),
      engineProvider(engine),
      fakeMediaLibrary(files),
      memoryFiles(tags()),
      dialogs.provider,
      back.provider,
    ],
  });
  await screen.findByText('4 songs');
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Search' }));
  const field = await screen.findByPlaceholderText('Search your library');
  return { view, engine, dialogs, back, user, field, storage };
}

/** The headings of the result sections on show. */
const sections = () =>
  ['Artists', 'Albums', 'Playlists', 'Genres', 'Songs'].filter((name) => screen.queryByRole('header', { name }));
const stateOf = (node: FakeFabricNode) => node.props['accessibilityState'];

function fullPlayer() {
  let node: FakeFabricNode = screen.getByText('Now playing');
  while (node.parent && !/Modal/.test(node.viewName)) node = node.parent;
  return within(node);
}

async function restart(view: RenderResult<App>, storage: Map<string, string>) {
  await view.componentRef.injector.get(Storage).flush();
  view.unmount();
  return launch(storage);
}

test('opens on an empty search with the keyboard up, and lists what the query finds under each kind', async () => {
  const { user, field } = await launch();
  expect(field.props['autoFocus']).toBe(true);
  expect(screen.queryByRole('header')).toBeNull();
  expect(screen.queryByText('No music found')).toBeNull();

  await user.type(field, 'juanes');
  expect(await screen.findByRole('button', { name: 'Juanes, 2 albums  ·  2 songs' })).toBeTruthy();
  expect(sections()).toEqual(['Artists']);

  await user.clear(field);
  await user.type(field, 'corazon');
  expect(await screen.findByRole('button', { name: 'Canciones del Corazón, El Cuarteto De Nos  ·  1 song' })).toBeTruthy();
  expect(sections()).toEqual(['Albums']);

  await user.clear(field);
  await user.type(field, 'kraftwerk');
  expect(await screen.findByText('No music found')).toBeTruthy();
});

test('narrows the results with filters that are kept for the next search', async () => {
  const { user, field, view, storage } = await launch();
  await user.type(field, 'rock');
  await screen.findByRole('button', { name: 'Rock, 2 artists  ·  2 songs' });

  await user.press(screen.getByRole('button', { name: 'Songs' }));
  expect(stateOf(screen.getByRole('button', { name: 'Songs' }))).toMatchObject({ selected: true });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Rock, 2 artists  ·  2 songs' })).toBeNull());
  expect(await screen.findByText('No music found')).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Genres' }));
  expect(await screen.findByRole('button', { name: 'Rock, 2 artists  ·  2 songs' })).toBeTruthy();

  const again = await restart(view, storage);
  expect(stateOf(screen.getByRole('button', { name: 'Songs' }))).toMatchObject({ selected: true });
  expect(stateOf(screen.getByRole('button', { name: 'Genres' }))).toMatchObject({ selected: true });
  expect(stateOf(screen.getByRole('button', { name: 'Albums' }))).toMatchObject({ selected: false });
  await again.user.type(again.field, 'rock');
  expect(await screen.findByRole('button', { name: 'Rock, 2 artists  ·  2 songs' })).toBeTruthy();
});

test('opens an artist on their own screen, and back returns to the search as it was', async () => {
  const { user, field, back } = await launch();
  await user.type(field, 'juan');
  await user.press(await screen.findByRole('button', { name: 'Juanes, 2 albums  ·  2 songs' }));

  expect(await screen.findByRole('heading', { name: 'Juanes' })).toBeTruthy();
  expect(screen.getByText('2 albums  ·  2 songs  ·  6:51')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Un Día Normal, Album  ·  1 song' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'A Dios Le Pido, Juanes' })).toBeTruthy();

  expect(await back.press()).toBe(true);
  const restored = await screen.findByDisplayValue('juan');
  expect(restored.props['autoFocus']).toBe(false);
  expect(screen.getByRole('button', { name: 'Juanes, 2 albums  ·  2 songs' })).toBeTruthy();

  expect(await back.press()).toBe(true);
  expect(await screen.findByText('4 songs')).toBeTruthy();
  expect(screen.queryByPlaceholderText('Search your library')).toBeNull();
});

test('plays a song from among all the songs, so next goes on through the library', async () => {
  const { user, field, engine } = await launch();
  await user.type(field, 'amarrame');
  await user.press(await screen.findByRole('button', { name: 'Amárrame, Mon Laferte, Juanes' }));

  await waitFor(() => expect(engine.loaded).toEqual([musicUri('2')]));
  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(engine.loaded).toEqual([musicUri('2'), musicUri('4')]));
});

test('queues a song to play next or at the end from its menu, and goes to its album', async () => {
  const { user, field, engine, dialogs } = await launch();
  await user.type(field, 'cielo');
  await user.press(await screen.findByRole('button', { name: 'More for Al Cielo No' }));

  expect(await screen.findByRole('heading', { name: 'Al Cielo No' })).toBeTruthy();
  const menu = ['Play next', 'Add to queue', 'Go to artist', 'Go to album', 'Add to playlist', 'Change cover', 'Properties', 'Share'];
  for (const label of menu) expect(screen.getByRole('button', { name: label })).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Play next' }));
  await waitFor(() => expect(engine.loaded).toEqual([musicUri('3')]));
  expect(dialogs.toasts).toEqual(['Playing next']);

  await user.press(screen.getByRole('button', { name: 'More for Al Cielo No' }));
  await user.press(await screen.findByRole('button', { name: 'Go to album' }));
  expect(await screen.findByRole('heading', { name: 'Canciones del Corazón' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Go to El Cuarteto De Nos' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Al Cielo No, El Cuarteto De Nos' })).toBeTruthy();
});

test('asks which artist to go to for a song by several', async () => {
  const { user, field } = await launch();
  await user.type(field, 'amarrame');
  await user.press(await screen.findByRole('button', { name: 'More for Amárrame' }));
  await user.press(await screen.findByRole('button', { name: 'Go to artist' }));

  expect(await screen.findByRole('heading', { name: 'Go to artist' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Mon Laferte' }));
  expect(await screen.findByRole('heading', { name: 'Mon Laferte' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'La Trenza, Album  ·  1 song' })).toBeTruthy();
});

test('selects with a long press, plays everything selected, and back clears a selection first', async () => {
  const { user, field, engine, back } = await launch();
  await user.type(field, 'di');
  await user.longPress(await screen.findByRole('button', { name: 'Un Día Normal, Juanes  ·  1 song' }));
  expect(await screen.findByRole('heading', { name: '1 selected' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Digital Love, Daft Punk' }));
  expect(await screen.findByRole('heading', { name: '2 selected' })).toBeTruthy();
  expect(engine.loaded).toEqual([]);

  expect(await back.press()).toBe(true);
  expect(screen.queryByRole('heading', { name: '2 selected' })).toBeNull();
  expect(screen.getByPlaceholderText('Search your library')).toBeTruthy();

  await user.longPress(screen.getByRole('button', { name: 'Digital Love, Daft Punk' }));
  await user.press(screen.getByRole('button', { name: 'Un Día Normal, Juanes  ·  1 song' }));
  // The toolbar's, ahead of the mini player's.
  await user.press(screen.getAllByRole('button', { name: 'Play' })[0]!);
  await waitFor(() => expect(engine.loaded).toEqual([musicUri('4')]));
  expect(screen.queryByRole('heading', { name: '2 selected' })).toBeNull();
  await user.press(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(engine.loaded).toEqual([musicUri('4'), musicUri('1')]));
});

test('opens a playlist it finds, and renames one from its menu', async () => {
  const storage = new Map([
    ['playlists', JSON.stringify([{ id: 'p1', name: 'Rock en español', trackIds: ['1', '3'], createdAt: 0 }])],
  ]);
  const { user, field, back } = await launch(storage);
  await user.type(field, 'rock');
  await user.press(await screen.findByRole('button', { name: 'Rock en español, 2 songs' }));
  expect(await screen.findByRole('heading', { name: 'Rock en español' })).toBeTruthy();

  expect(await back.press()).toBe(true);
  await user.press(await screen.findByRole('button', { name: 'More for Rock en español' }));
  await user.press(await screen.findByRole('button', { name: 'Rename' }));
  const name = await screen.findByPlaceholderText('Playlist name');
  await user.clear(name);
  await user.type(name, 'Rock latino');
  await user.press(screen.getByRole('button', { name: 'Rename' }));
  expect(await screen.findByRole('button', { name: 'Rock latino, 2 songs' })).toBeTruthy();
});
