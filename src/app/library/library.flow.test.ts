import { type Provider } from '@angular/core';
import { type FakeFabricNode, render, screen, userEvent, waitFor, within } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from '../app.ts';
import { SCAN_PAGE_SIZE } from './music-library.ts';
import { FILE_SHARING } from '../songs/song-details.ts';
import {
  type FakeMediaLibraryOptions,
  engineProvider,
  fakeDeepLinks,
  fakeDialogs,
  fakeDocumentPicker,
  fakeEngine,
  fakeMediaLibrary,
  memoryFiles,
  memoryStorage,
  musicUri,
  taggedMp3,
} from '../testing/fakes.ts';

type AudioFile = [id: string, filename: string | null, seconds: number | null, modified?: number];

async function launch(files: AudioFile[], options: FakeMediaLibraryOptions = {}, more: Provider[] = []) {
  const engine = fakeEngine();
  const dialogs = fakeDialogs();
  const deepLinks = fakeDeepLinks();
  await render(App, {
    providers: [
      memoryStorage(),
      engineProvider(engine),
      fakeMediaLibrary(files, options),
      dialogs.provider,
      deepLinks.provider,
      ...more,
    ],
  });
  return { engine, dialogs, deepLinks, user: userEvent.setup() };
}

const songs = (): AudioFile[] => [
  ['1', 'Daft Punk - Digital Love.mp3', 301],
  ['2', 'Air - La Femme d Argent.mp3', 429],
  ['3', 'Daft Punk - One More Time.mp3', 320],
];

function fullPlayer() {
  let node: FakeFabricNode = screen.getByText('Now playing');
  while (node.parent && !/Modal/.test(node.viewName)) node = node.parent;
  return within(node);
}

const stateOf = (node: FakeFabricNode) => node.props['accessibilityState'];

test('asks for music access again after the user refused it, and lists the songs once allowed', async () => {
  const { user } = await launch(songs(), { answers: ['deny', 'grant'] });

  expect(await screen.findByText('Your music lives on this device')).toBeTruthy();
  expect(screen.queryByText('3 songs')).toBeNull();
  await user.press(screen.getByRole('button', { name: 'Allow access to music' }));

  expect(await screen.findByText('3 songs')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Digital Love, Daft Punk' })).toBeTruthy();
});

test('opens the system settings when access is off for good, and lists the songs after trying again', async () => {
  const { user, deepLinks } = await launch(songs(), { answers: ['block'] });

  expect(await screen.findByText('Music access is turned off')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Open settings' }));
  expect(deepLinks.settingsOpened).toBe(1);

  await user.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('3 songs')).toBeTruthy();
});

test('says why the music could not be read, and lists the songs after trying again', async () => {
  const { user } = await launch(songs(), { scanErrors: ['The media store is busy.'] });

  expect(await screen.findByText('Could not read your music')).toBeTruthy();
  expect(screen.getByText('The media store is busy.')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('3 songs')).toBeTruthy();
  expect(screen.queryByText('Could not read your music')).toBeNull();
});

test('names each song from its file, sorted by title past its article, and leaves out a file with no name', async () => {
  await launch([
    ['1', 'Daft Punk - Digital Love.mp3', 301],
    ['2', 'Interlude.mp3', 75],
    ['3', null, 200],
    ['4', '07 - Air - La_Femme_d_Argent.flac', null],
  ]);

  expect(await screen.findByText('3 songs')).toBeTruthy();
  const digitalLove = screen.getByRole('button', { name: 'Digital Love, Daft Punk' });
  const interlude = screen.getByRole('button', { name: 'Interlude' });
  const laFemme = screen.getByRole('button', { name: 'La Femme d Argent, Air' });

  // "La" is an article, so "La Femme d Argent" sorts under F.
  const rows = [digitalLove, laFemme, interlude];
  expect(screen.getAllByRole('button').filter((node) => rows.includes(node))).toEqual(rows);
  expect(within(interlude).getByText('Unknown artist  ·  1:15')).toBeTruthy();
  expect(within(laFemme).getByText('Air')).toBeTruthy();
});

test('leads each song with a thumbnail of the cover in its file, or a placeholder without one', async () => {
  const disk = new Map([[musicUri('1'), taggedMp3({ title: 'With art', artist: 'Juanes' }, [0xff, 0xd8, 0xff, 0xe0])]]);
  await launch(
    [
      ['1', 'with-art.mp3', 200],
      ['2', 'Without art.mp3', 180],
    ],
    {},
    [memoryFiles(disk)],
  );

  const withArt = await screen.findByRole('button', { name: 'With art, Juanes' });
  expect(await within(withArt).findByRole('image', { name: 'Cover of With art' })).toBeTruthy();
  const withoutArt = screen.getByRole('button', { name: 'Without art' });
  expect(within(withoutArt).getByRole('image', { name: 'No cover for Without art' })).toBeTruthy();
});

test('shows a loading screen that counts the songs while a large library is read a page at a time', async () => {
  const files: AudioFile[] = Array.from({ length: 600 }, (_, i) => [String(i), `Artist - Song ${i}.mp3`, 120]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const offsets: number[] = [];
  await launch(files, {
    beforePage: (offset) => {
      offsets.push(offset);
      return offset === SCAN_PAGE_SIZE ? held : undefined;
    },
  });

  expect(await screen.findByRole('progressbar', { name: `Reading your music, ${SCAN_PAGE_SIZE} songs found` })).toBeTruthy();
  expect(screen.getByText(`${SCAN_PAGE_SIZE} songs found`)).toBeTruthy();
  expect(screen.queryByPlaceholderText('Search songs, artists or albums')).toBeNull();

  release();
  expect(await screen.findByText('600 songs')).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(offsets).toEqual([0, SCAN_PAGE_SIZE, 2 * SCAN_PAGE_SIZE]);
});

test('says when a search matches nothing, and shows every song again once it is cleared', async () => {
  const { user } = await launch(songs());
  const search = await screen.findByPlaceholderText('Search songs, artists or albums');

  await user.type(search, 'kraftwerk');
  expect(await screen.findByText('No songs match your search.')).toBeTruthy();
  expect(screen.getByText('0 of 3 songs')).toBeTruthy();
  expect(stateOf(screen.getByRole('button', { name: 'Play all' }))).toMatchObject({ disabled: true });
  expect(stateOf(screen.getByRole('button', { name: 'Shuffle' }))).toMatchObject({ disabled: true });

  await user.clear(search);
  expect(await screen.findByText('3 songs')).toBeTruthy();
  expect(screen.queryByText('No songs match your search.')).toBeNull();
  expect(stateOf(screen.getByRole('button', { name: 'Play all' }))).toMatchObject({ disabled: false });
});

test('says so when the device has no audio files, and offers nothing to play', async () => {
  const { user, engine } = await launch([]);

  expect(await screen.findByText('No audio files were found on this device.')).toBeTruthy();
  expect(screen.getByText('0 songs')).toBeTruthy();
  const playAll = screen.getByRole('button', { name: 'Play all' });
  expect(stateOf(playAll)).toMatchObject({ disabled: true });

  await user.press(playAll);
  expect(engine.loaded).toEqual([]);
});

test('picks up a song added to the device when the user rescans the library', async () => {
  const files = songs();
  const { user } = await launch(files);
  expect(await screen.findByText('3 songs')).toBeTruthy();

  files.push(['4', 'Justice - D.A.N.C.E..mp3', 242]);
  await user.press(screen.getByRole('button', { name: 'Rescan library' }));

  expect(await screen.findByText('4 songs')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'D.A.N.C.E., Justice' })).toBeTruthy();
});

test('plays only the songs that match the search with play all, and moves to the next match', async () => {
  const { user, engine } = await launch(songs());

  await user.type(await screen.findByPlaceholderText('Search songs, artists or albums'), 'daft');
  expect(await screen.findByText('2 of 3 songs')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Play all' }));

  expect(await screen.findByRole('heading', { name: 'Digital Love' })).toBeTruthy();
  expect(engine.loaded).toEqual(['file:///music/1.mp3']);

  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('heading', { name: 'One More Time' })).toBeTruthy();
  expect(engine.loaded).toEqual(['file:///music/1.mp3', 'file:///music/3.mp3']);
});

test('starts a shuffled run with shuffle, which the full player shows as on', async () => {
  const { user, engine } = await launch(songs());

  await user.press(await screen.findByRole('button', { name: 'Shuffle' }));
  await waitFor(() => expect(engine.loaded).toHaveLength(1));
  expect(engine.loaded[0]).toMatch(/^file:\/\/\/music\/[123]\.mp3$/);
  expect(screen.queryByText('Nothing playing')).toBeNull();

  await user.press(screen.getByRole('button', { name: 'Open player' }));
  const shuffle = fullPlayer().getByRole('button', { name: 'Shuffle' });
  expect(stateOf(shuffle)).toMatchObject({ selected: true });
});

test('marks the song that is playing in the list', async () => {
  const { user } = await launch(songs());

  await user.press(await screen.findByRole('button', { name: 'One More Time, Daft Punk' }));
  await user.press(await screen.findByRole('button', { name: 'Close player' }));

  expect(stateOf(screen.getByRole('button', { name: 'One More Time, Daft Punk' }))).toMatchObject({ selected: true });
  expect(stateOf(screen.getByRole('button', { name: 'Digital Love, Daft Punk' }))).toMatchObject({ selected: false });
});

test('says a song cannot be played when its file cannot be opened', async () => {
  const { user, engine } = await launch(songs(), { unplayable: ['2'] });

  await user.press(await screen.findByRole('button', { name: 'La Femme d Argent, Air' }));

  expect(await screen.findByRole('alert', { name: 'Could not play "La Femme d Argent".' })).toBeTruthy();
  expect(engine.loaded).toEqual([]);
});

/** Opens a song's menu in the songs tab and picks one of its actions. */
async function fromMenu(user: ReturnType<typeof userEvent.setup>, title: string, action: string) {
  await user.press(await screen.findByRole('button', { name: `More for ${title}` }));
  await user.press(await screen.findByRole('button', { name: action }));
}

test('offers everything a song can do from its menu, and closing it does nothing', async () => {
  const { user, engine } = await launch(songs());

  await user.press(await screen.findByRole('button', { name: 'More for Digital Love' }));
  expect(await screen.findByRole('heading', { name: 'Digital Love' })).toBeTruthy();
  // A song named only by its file has an artist but no album to go to.
  const menu = ['Play next', 'Add to queue', 'Go to artist', 'Add to playlist', 'Change cover', 'Properties', 'Share'];
  for (const label of menu) expect(screen.getByRole('button', { name: label })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Go to album' })).toBeNull();
  expect(engine.loaded).toEqual([]);

  await user.press(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('heading', { name: 'Digital Love' })).toBeNull();
  expect(screen.queryByText('Now playing')).toBeNull();
});

test('plays a song next or adds it to the queue from its menu, without interrupting the one playing', async () => {
  const { user, engine, dialogs } = await launch(songs());

  await fromMenu(user, 'Digital Love', 'Add to queue');
  await waitFor(() => expect(engine.loaded).toEqual([musicUri('1')]));
  await fromMenu(user, 'One More Time', 'Add to queue');
  await fromMenu(user, 'La Femme d Argent', 'Play next');
  expect(dialogs.toasts).toEqual(['Added to queue', 'Added to queue', 'Playing next']);
  expect(engine.loaded).toEqual([musicUri('1')]);

  await user.press(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(engine.loaded.at(-1)).toBe(musicUri('2')));
  await user.press(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(engine.loaded.at(-1)).toBe(musicUri('3')));
});

test('goes to the artist of a song from its menu, and back returns to the songs', async () => {
  const { user } = await launch(songs());

  await fromMenu(user, 'Digital Love', 'Go to artist');
  expect(await screen.findByRole('heading', { name: 'Daft Punk' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'One More Time, Daft Punk' })).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByRole('button', { name: 'La Femme d Argent, Air' })).toBeTruthy();
});

test('shows the properties of a song read from its file', async () => {
  const disk = new Map([[musicUri('1'), taggedMp3({ title: 'Digital Love', artist: 'Daft Punk', album: 'Discovery' })]]);
  const { user } = await launch(songs(), {}, [memoryFiles(disk)]);

  await fromMenu(user, 'Digital Love', 'Properties');
  expect(await screen.findByRole('heading', { name: 'Properties' })).toBeTruthy();
  expect(await screen.findByText('MP3')).toBeTruthy();
  expect(screen.getByText('128 kbps')).toBeTruthy();
  expect(screen.getByText('44100 Hz')).toBeTruthy();
  expect(screen.getByText('/music/1.mp3')).toBeTruthy();
});

test('shares the file of a song from its menu', async () => {
  const shared: { uri: string; title: string; mimeType: string }[] = [];
  const sharing = { provide: FILE_SHARING, useValue: { share: async (uri: string, options: { title: string; mimeType: string }) => (shared.push({ uri, ...options }), true) } };
  const { user, dialogs } = await launch(songs(), {}, [sharing]);

  await fromMenu(user, 'Digital Love', 'Share');
  await waitFor(() => expect(shared).toEqual([{ uri: musicUri('1'), title: 'Digital Love', mimeType: 'audio/mpeg' }]));
  expect(dialogs.toasts).toEqual([]);
});

test('says so when the device cannot share a file', async () => {
  const sharing = { provide: FILE_SHARING, useValue: { share: async () => false } };
  const { user, dialogs } = await launch(songs(), {}, [sharing]);

  await fromMenu(user, 'Digital Love', 'Share');
  await waitFor(() => expect(dialogs.toasts).toEqual(['Sharing is not available on this device.']));
});

test('opens the cover sheet from a song\'s menu', async () => {
  const { user } = await launch(songs());

  await fromMenu(user, 'Digital Love', 'Change cover');

  expect(await screen.findByRole('heading', { name: 'Cover of "Digital Love"' })).toBeTruthy();
  expect(screen.getByText('This song has no cover yet.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Choose image' })).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('heading', { name: 'Cover of "Digital Love"' })).toBeNull();
});

test('creates a playlist with a song from its menu, which then shows in the playlists tab', async () => {
  const { user, dialogs } = await launch(songs());

  await fromMenu(user, 'Digital Love', 'Add to playlist');

  expect(await screen.findByRole('heading', { name: 'Add "Digital Love"' })).toBeTruthy();
  expect(screen.getByText('No playlists yet. Name one above to create it with this song.')).toBeTruthy();
  const create = screen.getByRole('button', { name: 'Create' });
  expect(stateOf(create)).toMatchObject({ disabled: true });

  await user.type(screen.getByPlaceholderText('New playlist name'), '  Road trip ');
  await user.press(screen.getByRole('button', { name: 'Create' }));

  expect(dialogs.toasts).toEqual(['Created Road trip']);
  expect(screen.queryByRole('heading', { name: 'Add "Digital Love"' })).toBeNull();
  await user.press(screen.getByRole('tab', { name: 'Playlists' }));
  const card = screen.getByRole('button', { name: 'Open Road trip' });
  expect(within(card).getByText('1 song')).toBeTruthy();
});

test('adds a long-pressed song to an existing playlist, and says when it is already there', async () => {
  const { user, dialogs } = await launch(songs());

  await user.longPress(await screen.findByRole('button', { name: 'Digital Love, Daft Punk' }));
  await user.type(await screen.findByPlaceholderText('New playlist name'), 'Gym');
  await user.press(screen.getByRole('button', { name: 'Create' }));

  await user.longPress(screen.getByRole('button', { name: 'One More Time, Daft Punk' }));
  expect(await screen.findByRole('heading', { name: 'Add "One More Time"' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Add to Gym' }));
  expect(dialogs.toasts.at(-1)).toBe('Added to Gym');

  await user.longPress(screen.getByRole('button', { name: 'One More Time, Daft Punk' }));
  await user.press(await screen.findByRole('button', { name: 'Add to Gym' }));
  expect(dialogs.toasts).toEqual(['Created Gym', 'Added to Gym', 'Already in Gym']);

  await user.press(screen.getByRole('tab', { name: 'Playlists' }));
  expect(within(screen.getByRole('button', { name: 'Open Gym' })).getByText('2 songs')).toBeTruthy();
});

test('removes a cover the user chose, which brings back the placeholder', async () => {
  const disk = new Map([['file:///picked/art.png', Uint8Array.from([1, 2, 3])]]);
  const picked = { uri: 'file:///picked/art.png', name: 'art.png', mimeType: 'image/png', size: 3, lastModified: 0 };
  const { user } = await launch(songs(), {}, [memoryFiles(disk), fakeDocumentPicker([picked])]);
  const saved = () => [...disk.keys()].filter((uri) => uri.startsWith('file:///documents/covers/1-'));

  await fromMenu(user, 'Digital Love', 'Change cover');
  await user.press(await screen.findByRole('button', { name: 'Choose image' }));
  expect(await screen.findByText('Your image.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Change image' })).toBeTruthy();
  expect(saved()).toHaveLength(1);

  await user.press(screen.getByRole('button', { name: 'Remove my cover' }));

  expect(await screen.findByText('This song has no cover yet.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Remove my cover' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Choose image' })).toBeTruthy();
  expect(saved()).toEqual([]);
});

test('refuses an image too large for a cover, and says why', async () => {
  const picked = { uri: 'file:///picked/huge.png', name: 'huge.png', mimeType: 'image/png', size: 20_000_000, lastModified: 0 };
  const { user, dialogs } = await launch(songs(), {}, [memoryFiles(), fakeDocumentPicker([picked])]);

  await fromMenu(user, 'Digital Love', 'Change cover');
  await user.press(await screen.findByRole('button', { name: 'Choose image' }));

  await waitFor(() => expect(dialogs.open?.title).toBe('Could not set the cover'));
  expect(dialogs.open?.message).toBe('The image is too large for a cover (10 MB at most).');
  await dialogs.answer('OK');
  expect(screen.getByText('This song has no cover yet.')).toBeTruthy();
});

/** Three songs whose files are tagged, and one whose file has no tags to read. */
function taggedLibrary() {
  const files: AudioFile[] = [
    ['1', 'A Dios Le Pido.mp3', 211],
    ['2', 'Amarrame_spotdown.org.mp3', 200],
    ['3', 'Al Cielo No.mp3', 240],
    ['4', 'Daft Punk - Digital Love.mp3', 301],
  ];
  const disk = new Map([
    [musicUri('1'), taggedMp3({ title: 'A Dios Le Pido', artist: 'Juanes', album: 'Un Día Normal', year: '2002' })],
    [musicUri('2'), taggedMp3({ title: 'Amárrame', artist: 'Mon Laferte, Juanes', album: 'La Trenza', year: '2017' })],
    [musicUri('3'), taggedMp3({ title: 'Al Cielo No', artist: 'El Cuarteto De Nos', album: 'Canciones del Corazón', year: '2007' })],
  ]);
  return { files, disk };
}

test('names each song by the tags in its file, and finds it by album, without accents', async () => {
  const { files, disk } = taggedLibrary();
  const { user } = await launch(files, {}, [memoryFiles(disk)]);

  expect(await screen.findByText('4 songs')).toBeTruthy();
  const amarrame = screen.getByRole('button', { name: 'Amárrame, Mon Laferte, Juanes' });
  expect(within(amarrame).getByText('Mon Laferte, Juanes  ·  La Trenza  ·  3:20')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Digital Love, Daft Punk' })).toBeTruthy();

  await user.type(screen.getByPlaceholderText('Search songs, artists or albums'), 'corazon');
  expect(await screen.findByText('1 of 4 songs')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Al Cielo No, El Cuarteto De Nos' })).toBeTruthy();
});

test('filters by artist, then offers only the years that artist has, and clears the filters', async () => {
  const { files, disk } = taggedLibrary();
  const { user, engine } = await launch(files, {}, [memoryFiles(disk)]);
  expect(await screen.findByText('4 songs')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Genre' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

  await user.press(screen.getByRole('button', { name: 'Artist' }));
  expect(await screen.findByRole('heading', { name: 'Artist' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mon Laferte, 1 song' })).toBeTruthy();
  expect(stateOf(screen.getByRole('button', { name: 'All artists' }))).toMatchObject({ selected: true });
  await user.press(screen.getByRole('button', { name: 'Juanes, 2 songs' }));

  expect(await screen.findByText('2 of 4 songs')).toBeTruthy();
  expect(stateOf(screen.getByRole('button', { name: 'Artist: Juanes' }))).toMatchObject({ selected: true });

  await user.press(screen.getByRole('button', { name: 'Year' }));
  expect(await screen.findByRole('button', { name: '2017, 1 song' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '2002, 1 song' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '2007, 1 song' })).toBeNull();
  await user.press(screen.getByRole('button', { name: '2017, 1 song' }));

  expect(await screen.findByText('1 of 4 songs')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Play all' }));
  expect(engine.loaded).toEqual([musicUri('2')]);

  await user.press(screen.getByRole('button', { name: 'Clear filters' }));
  expect(await screen.findByText('4 songs')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Artist' })).toBeTruthy();
});

test('lifts a filter from its sheet, keeping the others', async () => {
  const { files, disk } = taggedLibrary();
  const { user } = await launch(files, {}, [memoryFiles(disk)]);

  await user.press(await screen.findByRole('button', { name: 'Album' }));
  await user.press(await screen.findByRole('button', { name: 'La Trenza, 1 song' }));
  await user.press(await screen.findByRole('button', { name: 'Year' }));
  await user.press(await screen.findByRole('button', { name: '2017, 1 song' }));
  expect(await screen.findByText('1 of 4 songs')).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Album: La Trenza' }));
  await user.press(await screen.findByRole('button', { name: 'All albums' }));

  expect(await screen.findByText('1 of 4 songs')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Album' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Year: 2017' })).toBeTruthy();
});

test('reads the tags of a file again on a rescan only once the file has changed', async () => {
  const files: AudioFile[] = [['1', 'track01.mp3', 200, 1000]];
  const disk = new Map([[musicUri('1'), taggedMp3({ title: 'First take' })]]);
  const { user } = await launch(files, {}, [memoryFiles(disk)]);
  expect(await screen.findByRole('button', { name: 'First take' })).toBeTruthy();
  expect(disk.has('file:///cache/library-tags.json')).toBe(true);

  disk.set(musicUri('1'), taggedMp3({ title: 'Second take' }));
  await user.press(screen.getByRole('button', { name: 'Rescan library' }));
  expect(await screen.findByText('1 song')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'First take' })).toBeTruthy();

  files[0] = ['1', 'track01.mp3', 200, 2000];
  await user.press(screen.getByRole('button', { name: 'Rescan library' }));
  expect(await screen.findByRole('button', { name: 'Second take' })).toBeTruthy();
});
