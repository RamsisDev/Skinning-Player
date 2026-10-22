import { Storage } from '@ng-native/expo/async-storage';
import { type RenderResult, type UserEvent, render, screen, userEvent, waitFor, within } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from '../app.ts';
import {
  engineProvider,
  fakeDialogs,
  fakeEngine,
  fakeHardwareBack,
  fakeMediaLibrary,
  memoryStorage,
} from '../testing/fakes.ts';

type File = readonly [string, string | null, number | null];

const DIGITAL_LOVE = 'Digital Love, Daft Punk';
const GENESIS = 'Genesis, Justice';
const LA_FEMME = 'La Femme d Argent, Air';
const SONGS = [DIGITAL_LOVE, GENESIS, LA_FEMME];

const threeSongs = (): File[] => [
  ['1', 'Daft Punk - Digital Love.mp3', 301],
  ['2', 'Air - La Femme d Argent.mp3', 429],
  ['3', 'Justice - Genesis.mp3', 234],
];

async function start(files: File[] = threeSongs(), disk = new Map<string, string>()) {
  const engine = fakeEngine();
  const dialogs = fakeDialogs();
  const back = fakeHardwareBack();
  const view = await render(App, {
    providers: [memoryStorage(disk), engineProvider(engine), fakeMediaLibrary(files), dialogs.provider, back.provider],
  });
  const user = userEvent.setup();
  await screen.findByText(`${files.length} songs`);
  await user.press(screen.getByRole('tab', { name: 'Playlists' }));
  return { view, engine, dialogs, back, user, disk };
}

async function restart(view: RenderResult<App>, files: File[], disk: Map<string, string>) {
  await view.componentRef.injector.get(Storage).flush();
  view.unmount();
  return start(files, disk);
}

async function createPlaylist(user: UserEvent, name: string) {
  await user.press(screen.getByRole('button', { name: 'New playlist' }));
  await user.type(screen.getByPlaceholderText('Playlist name'), name);
  await user.press(screen.getByRole('button', { name: 'Create' }));
  await screen.findByRole('heading', { name });
}

async function addSongs(user: UserEvent, ...songs: string[]) {
  await user.press(await screen.findByRole('button', { name: 'Add songs' }));
  for (const song of songs) await user.press(await screen.findByRole('button', { name: song }));
  await user.press(screen.getByRole('button', { name: `Add ${songs.length} song${songs.length === 1 ? '' : 's'}` }));
}

const listedSongs = () =>
  screen
    .getAllByRole('button')
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label) => SONGS.includes(label));

/** The playlist's own count, Shuffle and Play, apart from the mini player's Play. */
const playlistActions = () => within(screen.getByText(/^\d+ songs/).parent!);

const isDisabled = (node: { props: Record<string, unknown> }) =>
  (node.props.accessibilityState as { disabled?: boolean } | undefined)?.disabled === true;

test('shows an empty state before any playlist exists', async () => {
  await start();

  expect(screen.getByText('0 playlists')).toBeTruthy();
  expect(screen.getByText('No playlists yet. Create one, or long-press a song in the library.')).toBeTruthy();
});

test('cannot create a playlist with a blank name', async () => {
  const { user } = await start();

  await user.press(screen.getByRole('button', { name: 'New playlist' }));
  expect(screen.getByRole('heading', { name: 'New playlist' })).toBeTruthy();
  expect(isDisabled(screen.getByRole('button', { name: 'Create' }))).toBe(true);
  await user.type(screen.getByPlaceholderText('Playlist name'), '   ', { submitEditing: true });
  expect(isDisabled(screen.getByRole('button', { name: 'Create' }))).toBe(true);
  await user.press(screen.getByRole('button', { name: 'Create' }));
  await user.press(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('heading', { name: 'New playlist' })).toBeNull();
  expect(screen.getByText('0 playlists')).toBeTruthy();
});

test('cuts a very long playlist name to 60 characters', async () => {
  const { user } = await start();
  const long = 'A'.repeat(70);

  await user.press(screen.getByRole('button', { name: 'New playlist' }));
  await user.type(screen.getByPlaceholderText('Playlist name'), long);
  await user.press(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByRole('heading', { name: 'A'.repeat(60) })).toBeTruthy();
});

test('cancelling the new playlist prompt creates nothing', async () => {
  const { user } = await start();

  await user.press(screen.getByRole('button', { name: 'New playlist' }));
  await user.type(screen.getByPlaceholderText('Playlist name'), 'Gym');
  await user.press(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.getByText('0 playlists')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'New playlist' }));
  expect(screen.getByPlaceholderText('Playlist name')).toBeTruthy();
  expect(screen.queryByDisplayValue('Gym')).toBeNull();
});

test('adds the songs picked in the picker to a playlist', async () => {
  const { user, dialogs } = await start();
  await createPlaylist(user, 'Road trip');

  await user.press(await screen.findByRole('button', { name: 'Add songs' }));
  expect(screen.getByRole('heading', { name: 'Add to Road trip' })).toBeTruthy();
  expect(isDisabled(screen.getByRole('button', { name: 'Select songs' }))).toBe(true);
  await user.press(screen.getByRole('button', { name: DIGITAL_LOVE }));
  expect(screen.getByRole('button', { name: 'Add 1 song' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: LA_FEMME }));
  await user.press(screen.getByRole('button', { name: 'Add 2 songs' }));

  expect(dialogs.toasts).toEqual(['Added 2 songs']);
  expect(screen.queryByRole('heading', { name: 'Add to Road trip' })).toBeNull();
  expect(screen.getByText('2 songs')).toBeTruthy();
  expect(listedSongs()).toEqual([DIGITAL_LOVE, LA_FEMME]);
});

test('unpicks a song pressed a second time in the picker', async () => {
  const { user } = await start();
  await createPlaylist(user, 'Road trip');

  await user.press(await screen.findByRole('button', { name: 'Add songs' }));
  await user.press(screen.getByRole('button', { name: GENESIS }));
  expect(screen.getByRole('button', { name: GENESIS }).props.accessibilityState).toMatchObject({ selected: true });
  await user.press(screen.getByRole('button', { name: GENESIS }));

  expect(screen.getByRole('button', { name: GENESIS }).props.accessibilityState).toMatchObject({ selected: false });
  expect(isDisabled(screen.getByRole('button', { name: 'Select songs' }))).toBe(true);
});

test('closing the picker forgets the songs picked in it', async () => {
  const { user, dialogs } = await start();
  await createPlaylist(user, 'Road trip');

  await user.press(await screen.findByRole('button', { name: 'Add songs' }));
  await user.press(screen.getByRole('button', { name: GENESIS }));
  await user.press(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByText('This playlist is empty. Use "Add songs" to fill it.')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Add songs' }));

  expect(screen.getByRole('button', { name: 'Select songs' })).toBeTruthy();
  expect(dialogs.toasts).toEqual([]);
});

test('narrows the picker to the songs matching the search', async () => {
  const { user } = await start();
  await createPlaylist(user, 'Road trip');

  await user.press(await screen.findByRole('button', { name: 'Add songs' }));
  await user.type(screen.getByPlaceholderText('Search songs'), 'daft');

  expect(listedSongs()).toEqual([DIGITAL_LOVE]);
  await user.clear(screen.getByPlaceholderText('Search songs'));
  await user.type(screen.getByPlaceholderText('Search songs'), 'beatles');
  expect(listedSongs()).toEqual([]);
  expect(screen.getByText('No songs to add.')).toBeTruthy();
});

test('does not offer songs that are already in the playlist', async () => {
  const { user, dialogs } = await start();
  await createPlaylist(user, 'Road trip');
  await addSongs(user, GENESIS);

  await user.press(screen.getByRole('button', { name: 'Add songs' }));
  expect(screen.getAllByRole('button', { name: GENESIS })).toHaveLength(1);
  await user.press(screen.getByRole('button', { name: DIGITAL_LOVE }));
  await user.press(screen.getByRole('button', { name: LA_FEMME }));
  await user.press(screen.getByRole('button', { name: 'Add 2 songs' }));
  await user.press(screen.getByRole('button', { name: 'Add songs' }));

  expect(screen.getByText('No songs to add.')).toBeTruthy();
  expect(dialogs.toasts).toEqual(['Added 1 song', 'Added 2 songs']);
});

test('an empty playlist says so and cannot be played or shuffled', async () => {
  const { user, engine } = await start();
  await createPlaylist(user, 'Empty');

  expect(await screen.findByText('This playlist is empty. Use "Add songs" to fill it.')).toBeTruthy();
  expect(playlistActions().getByText('0 songs')).toBeTruthy();
  expect(isDisabled(playlistActions().getByRole('button', { name: 'Play' }))).toBe(true);
  expect(isDisabled(playlistActions().getByRole('button', { name: 'Shuffle' }))).toBe(true);
  await user.press(playlistActions().getByRole('button', { name: 'Play' }));

  await user.press(screen.getByRole('button', { name: 'Back to playlists' }));
  expect(screen.getByText('0 songs')).toBeTruthy();
  expect(isDisabled(screen.getByRole('button', { name: 'Play Empty' }))).toBe(true);
  await user.press(screen.getByRole('button', { name: 'Play Empty' }));
  expect(engine.loaded).toEqual([]);
});

test('counts one song in the singular on the playlist card', async () => {
  const { user } = await start();
  await createPlaylist(user, 'Solo');
  await addSongs(user, GENESIS);

  await user.press(screen.getByRole('button', { name: 'Back to playlists' }));

  expect(screen.getByText('1 song')).toBeTruthy();
  expect(isDisabled(screen.getByRole('button', { name: 'Play Solo' }))).toBe(false);
});

test('tapping a song in a playlist plays it, and next follows the playlist rather than the library', async () => {
  const { user, engine } = await start();
  await createPlaylist(user, 'Road trip');
  await addSongs(user, DIGITAL_LOVE, LA_FEMME);

  await user.press(screen.getByRole('button', { name: DIGITAL_LOVE }));
  expect(await screen.findByRole('heading', { name: 'Digital Love' })).toBeTruthy();
  expect(engine.loaded).toEqual(['file:///music/1.mp3']);
  await user.press(screen.getAllByRole('button', { name: 'Next' }).at(-1)!);

  expect(await screen.findByRole('heading', { name: 'La Femme d Argent' })).toBeTruthy();
  expect(engine.loaded).toEqual(['file:///music/1.mp3', 'file:///music/2.mp3']);
});

test('marks the song that is playing in the playlist', async () => {
  const { user } = await start();
  await createPlaylist(user, 'Road trip');
  await addSongs(user, DIGITAL_LOVE, LA_FEMME);

  await user.press(screen.getByRole('button', { name: LA_FEMME }));
  await user.press(await screen.findByRole('button', { name: 'Close player' }));

  expect(screen.getByRole('button', { name: LA_FEMME }).props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByRole('button', { name: DIGITAL_LOVE }).props.accessibilityState).toMatchObject({ selected: false });
});

test('plays a playlist from its first song from the card', async () => {
  const { user, engine } = await start();
  await createPlaylist(user, 'Road trip');
  await addSongs(user, LA_FEMME, GENESIS);
  await user.press(screen.getByRole('button', { name: 'Back to playlists' }));

  await user.press(screen.getByRole('button', { name: 'Play Road trip' }));

  await waitFor(() => expect(engine.loaded).toEqual(['file:///music/2.mp3']));
  expect(screen.getByText('1 playlist')).toBeTruthy();
  expect(screen.getByText('La Femme d Argent')).toBeTruthy();
});

test('plays a playlist from its first song with its Play button', async () => {
  const { user, engine } = await start();
  await createPlaylist(user, 'Road trip');
  await addSongs(user, LA_FEMME, GENESIS);

  await user.press(playlistActions().getByRole('button', { name: 'Play' }));

  await waitFor(() => expect(engine.loaded).toEqual(['file:///music/2.mp3']));
  expect(screen.getByRole('button', { name: LA_FEMME }).props.accessibilityState).toMatchObject({ selected: true });
});

test('shuffles a playlist, playing one of its songs with shuffle turned on', async () => {
  const { user, engine } = await start();
  await createPlaylist(user, 'Road trip');
  await addSongs(user, LA_FEMME, GENESIS);

  await user.press(playlistActions().getByRole('button', { name: 'Shuffle' }));
  await waitFor(() => expect(engine.loaded).toHaveLength(1));
  await user.press(screen.getByRole('button', { name: 'Open player' }));

  expect(['file:///music/2.mp3', 'file:///music/3.mp3']).toContain(engine.loaded[0]);
  const shuffle = screen.getAllByRole('button', { name: 'Shuffle' }).at(-1)!;
  expect(shuffle.props.accessibilityState).toMatchObject({ selected: true });
});

test('removes a song from a playlist', async () => {
  const { user } = await start();
  await createPlaylist(user, 'Road trip');
  await addSongs(user, DIGITAL_LOVE, LA_FEMME);

  const row = screen.getByRole('button', { name: DIGITAL_LOVE });
  await user.press(within(row).getByRole('button', { name: 'Remove from playlist' }));

  expect(listedSongs()).toEqual([LA_FEMME]);
  expect(screen.getByText('1 song')).toBeTruthy();
});

test('reorders a playlist from the menu of a long-pressed song', async () => {
  const { user, dialogs } = await start();
  await createPlaylist(user, 'Road trip');
  await addSongs(user, DIGITAL_LOVE, GENESIS, LA_FEMME);

  await user.longPress(screen.getByRole('button', { name: LA_FEMME }));
  await waitFor(() => expect(dialogs.open?.title).toBe('La Femme d Argent'));
  expect(dialogs.open?.buttons).toEqual(['Move up', 'Move down', 'Cancel']);
  await dialogs.answer('Move up');
  await waitFor(() => expect(listedSongs()).toEqual([DIGITAL_LOVE, LA_FEMME, GENESIS]));

  await user.longPress(screen.getByRole('button', { name: DIGITAL_LOVE }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Digital Love'));
  await dialogs.answer('Move down');
  await waitFor(() => expect(listedSongs()).toEqual([LA_FEMME, DIGITAL_LOVE, GENESIS]));

  await user.longPress(screen.getByRole('button', { name: GENESIS }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Genesis'));
  await dialogs.answer('Cancel');
  await user.longPress(screen.getByRole('button', { name: GENESIS }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Genesis'));
  await dialogs.answer('Move up');
  await waitFor(() => expect(listedSongs()).toEqual([LA_FEMME, GENESIS, DIGITAL_LOVE]));
});

test('moving the first song up or the last song down changes nothing', async () => {
  const { user, dialogs } = await start();
  await createPlaylist(user, 'Road trip');
  await addSongs(user, DIGITAL_LOVE, GENESIS, LA_FEMME);

  await user.longPress(screen.getByRole('button', { name: DIGITAL_LOVE }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Digital Love'));
  await dialogs.answer('Move up');
  await user.longPress(screen.getByRole('button', { name: LA_FEMME }));
  await waitFor(() => expect(dialogs.open?.title).toBe('La Femme d Argent'));
  await dialogs.answer('Move down');
  await user.longPress(screen.getByRole('button', { name: GENESIS }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Genesis'));
  await dialogs.answer('Move up');

  await waitFor(() => expect(listedSongs()).toEqual([GENESIS, DIGITAL_LOVE, LA_FEMME]));
});

test('renames a playlist from a prompt filled with its current name', async () => {
  const { user } = await start();
  await createPlaylist(user, 'Road trip');

  await user.press(screen.getByRole('button', { name: 'Rename playlist' }));
  expect(screen.getByRole('heading', { name: 'Rename playlist' })).toBeTruthy();
  expect(screen.getByDisplayValue('Road trip')).toBeTruthy();
  await user.clear(screen.getByDisplayValue('Road trip'));
  expect(isDisabled(screen.getByRole('button', { name: 'Rename' }))).toBe(true);
  await user.type(screen.getByPlaceholderText('Playlist name'), 'Night drive');
  await user.press(screen.getByRole('button', { name: 'Rename' }));

  expect(await screen.findByRole('heading', { name: 'Night drive' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Back to playlists' }));
  expect(screen.getByRole('button', { name: 'Open Night drive' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Road trip' })).toBeNull();
  expect(screen.getByText('1 playlist')).toBeTruthy();
});

test('cancelling a rename keeps the old name', async () => {
  const { user } = await start();
  await createPlaylist(user, 'Road trip');

  await user.press(screen.getByRole('button', { name: 'Rename playlist' }));
  await user.clear(screen.getByDisplayValue('Road trip'));
  await user.type(screen.getByPlaceholderText('Playlist name'), 'Night drive');
  await user.press(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.getByRole('heading', { name: 'Road trip' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Rename playlist' }));
  expect(screen.getByDisplayValue('Road trip')).toBeTruthy();
});

test('deletes a playlist only once the user confirms', async () => {
  const { user, dialogs } = await start();
  await createPlaylist(user, 'Road trip');

  await user.press(screen.getByRole('button', { name: 'Delete playlist' }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Delete "Road trip"?'));
  await dialogs.answer('Cancel');
  expect(screen.getByRole('heading', { name: 'Road trip' })).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Delete playlist' }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Delete "Road trip"?'));
  await dialogs.answer('OK');

  expect(await screen.findByText('0 playlists')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Road trip' })).toBeNull();
  expect(screen.getByText('No playlists yet. Create one, or long-press a song in the library.')).toBeTruthy();
});

test('a song deleted from the device is counted as missing and left out of its playlist', async () => {
  const first = await start();
  await createPlaylist(first.user, 'Road trip');
  await addSongs(first.user, DIGITAL_LOVE, GENESIS, LA_FEMME);

  const withoutLaFemme = threeSongs().filter(([id]) => id !== '2');
  const { user } = await restart(first.view, withoutLaFemme, first.disk);
  await user.press(screen.getByRole('button', { name: 'Open Road trip' }));

  expect(await screen.findByText('2 songs · 1 missing')).toBeTruthy();
  expect(listedSongs()).toEqual([DIGITAL_LOVE, GENESIS]);
});

test('Android back closes an open playlist, then the playlists tab, then leaves the app', async () => {
  const { user, back } = await start();
  await createPlaylist(user, 'Road trip');

  expect(await back.press()).toBe(true);
  expect(screen.queryByRole('heading', { name: 'Road trip' })).toBeNull();
  expect(screen.getByText('1 playlist')).toBeTruthy();

  expect(await back.press()).toBe(true);
  expect(screen.getByRole('tab', { name: 'Library' }).props.accessibilityState).toMatchObject({ selected: true });
  expect(await back.press()).toBe(false);
});

test('playlists and their songs survive restarting the app', async () => {
  const first = await start();
  await createPlaylist(first.user, 'Road trip');
  await addSongs(first.user, LA_FEMME, DIGITAL_LOVE);
  await first.user.press(screen.getByRole('button', { name: 'Back to playlists' }));
  await createPlaylist(first.user, 'Focus');
  await addSongs(first.user, GENESIS);

  const { user } = await restart(first.view, threeSongs(), first.disk);

  expect(await screen.findByText('2 playlists')).toBeTruthy();
  expect(screen.getByText('2 songs')).toBeTruthy();
  expect(screen.getByText('1 song')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Open Road trip' }));
  expect(await screen.findByRole('heading', { name: 'Road trip' })).toBeTruthy();
  expect(listedSongs()).toEqual([LA_FEMME, DIGITAL_LOVE]);
});

test('adds a long-pressed library song to an existing playlist, once', async () => {
  const { user, dialogs } = await start();
  await createPlaylist(user, 'Road trip');
  await user.press(screen.getByRole('tab', { name: 'Library' }));

  await user.longPress(await screen.findByRole('button', { name: GENESIS }));
  expect(await screen.findByRole('heading', { name: 'Add "Genesis"' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Add to Road trip' }));
  await user.longPress(screen.getByRole('button', { name: GENESIS }));
  await user.press(await screen.findByRole('button', { name: 'Add to Road trip' }));
  expect(dialogs.toasts).toEqual(['Added to Road trip', 'Already in Road trip']);

  await user.press(screen.getByRole('tab', { name: 'Playlists' }));
  await user.press(screen.getByRole('button', { name: 'Open Road trip' }));
  expect(listedSongs()).toEqual([GENESIS]);
});

test('creates a playlist holding a long-pressed library song', async () => {
  const { user, dialogs } = await start();
  await user.press(screen.getByRole('tab', { name: 'Library' }));

  await user.longPress(await screen.findByRole('button', { name: DIGITAL_LOVE }));
  expect(await screen.findByText('No playlists yet. Name one above to create it with this song.')).toBeTruthy();
  await user.type(screen.getByPlaceholderText('New playlist name'), 'Chill');
  await user.press(screen.getByRole('button', { name: 'Create' }));
  expect(dialogs.toasts).toEqual(['Created Chill']);

  await user.press(screen.getByRole('tab', { name: 'Playlists' }));
  expect(screen.getByText('1 song')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Open Chill' }));
  expect(listedSongs()).toEqual([DIGITAL_LOVE]);
});
