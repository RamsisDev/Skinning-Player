import { render, screen, userEvent, waitFor, within } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from '../app.ts';
import {
  type AccessAnswer,
  engineProvider,
  fakeAppState,
  fakeDialogs,
  fakeEngine,
  fakeHardwareBack,
  fakeMediaLibrary,
  memoryFiles,
  memoryStorage,
  taggedMp3,
} from '../testing/fakes.ts';

type AudioFile = [id: string, filename: string, seconds: number, modified?: number];

const ROOT = 'file:///storage/emulated/0';
const uris: Record<string, string> = {
  '1': `${ROOT}/Music/Rock/a.mp3`,
  '2': `${ROOT}/Music/Pop/b.mp3`,
  '3': `${ROOT}/Podcasts/show.mp3`,
  '4': `${ROOT}/Music/.hidden/c.mp3`,
  '5': `${ROOT}/Music/Pop/d.mp3`,
};

function setup(answers: AccessAnswer[] = []) {
  const files: AudioFile[] = [
    ['1', 'a.mp3', 100, 1],
    ['2', 'b.mp3', 100, 1],
    ['3', 'show.mp3', 100, 1],
    ['4', 'c.mp3', 100, 1],
  ];
  const disk = new Map<string, Uint8Array>([
    [uris['1']!, taggedMp3({ title: 'Mrs Robinson', artist: 'Simon & Garfunkel', album: 'Bookends' })],
    [uris['2']!, taggedMp3({ title: 'La Camisa Negra', artist: 'Juanes', album: 'Mi Sangre' })],
    [uris['3']!, taggedMp3({ title: 'Episode 1', artist: 'A Podcast' })],
    [uris['4']!, taggedMp3({ title: 'Secret', artist: 'Nobody' })],
    [uris['5']!, taggedMp3({ title: 'Fotografía', artist: 'Juanes', album: 'Un Día Normal' })],
  ]);
  let changed: (() => void) | null = null;
  const appState = fakeAppState();
  return {
    files,
    disk,
    appState,
    changed: () => changed?.(),
    async launch() {
      const dialogs = fakeDialogs();
      const back = fakeHardwareBack();
      await render(App, {
        providers: [
          memoryStorage(),
          engineProvider(fakeEngine()),
          fakeMediaLibrary(files, { uris, answers, onListen: (emit) => (changed = emit) }),
          memoryFiles(disk),
          dialogs.provider,
          back.provider,
          appState.provider,
        ],
      });
      await screen.findByText('2 songs');
      const user = userEvent.setup();
      await user.press(screen.getByRole('button', { name: 'Settings' }));
      await screen.findByRole('heading', { name: 'Settings' });
      return { user, dialogs, back };
    },
  };
}

const closeSettings = (user: ReturnType<typeof userEvent.setup>) => user.press(screen.getByRole('button', { name: 'Close settings' }));
const switchState = (name: string) => screen.getByRole('switch', { name }).props['accessibilityState'];

test('leaves out podcasts and hidden files until the user asks for them', async () => {
  const { user } = await setup().launch();
  expect(switchState('Exclude non-music')).toMatchObject({ checked: true });
  expect(switchState('Include hidden files')).toMatchObject({ checked: false });

  await user.press(screen.getByRole('switch', { name: 'Exclude non-music' }));
  await user.press(screen.getByRole('switch', { name: 'Include hidden files' }));
  await closeSettings(user);

  expect(await screen.findByText('4 songs')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Episode 1, A Podcast' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Secret, Nobody' })).toBeTruthy();
});

test('excludes the folders turned on, or reads only them, and back closes the settings', async () => {
  const { user, back } = await setup().launch();
  expect(screen.getAllByText('Internal storage  ·  1 song')).toHaveLength(4);

  await user.press(screen.getByRole('switch', { name: '/Music/Pop' }));
  await closeSettings(user);
  expect(await screen.findByText('1 song')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mrs Robinson, Simon & Garfunkel' })).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Settings' }));
  await user.press(await screen.findByRole('button', { name: 'Include only' }));
  expect(screen.getByText('Only the folders turned on, and the folders in them, are read.')).toBeTruthy();
  expect(await back.press()).toBe(true);
  expect(await screen.findByText('1 song')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'La Camisa Negra, Juanes' })).toBeTruthy();
});

test('splits artists by the separators the user turns on', async () => {
  const { user } = await setup().launch();
  await closeSettings(user);
  await user.press(screen.getByRole('tab', { name: 'Artists' }));
  expect(await screen.findByText('2 artists')).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Settings' }));
  await user.press(await screen.findByRole('switch', { name: 'Ampersand (&)' }));
  await closeSettings(user);
  expect(await screen.findByText('3 artists')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Garfunkel, 1 album  ·  1 song' })).toBeTruthy();
});

test('reads every file again on a full rescan, and only the changed ones on a rescan', async () => {
  const library = setup();
  const { user } = await library.launch();
  library.disk.set(uris['2']!, taggedMp3({ title: 'Retagged', artist: 'Juanes' }));

  await user.press(screen.getByRole('button', { name: 'Rescan' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rescan' }).props['accessibilityState']).toMatchObject({ disabled: false }));
  await closeSettings(user);
  expect(await screen.findByRole('button', { name: 'La Camisa Negra, Juanes' })).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Settings' }));
  await user.press(await screen.findByRole('button', { name: 'Full rescan' }));
  await closeSettings(user);
  expect(await screen.findByRole('button', { name: 'Retagged, Juanes' })).toBeTruthy();
});

test('rescans by itself when the music on the device changes, once automatic reloading is on', async () => {
  const library = setup();
  const { user } = await library.launch();
  await user.press(screen.getByRole('switch', { name: 'Automatic reloading' }));
  await closeSettings(user);

  library.files.push(['5', 'd.mp3', 100, 1]);
  library.changed();
  expect(await screen.findByText('3 songs', {}, { timeout: 3000 })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Fotografía, Juanes' })).toBeTruthy();
});

test('rescans when the app comes back to the front, since Android does not report changes to audio', async () => {
  const library = setup();
  const { user } = await library.launch();
  await closeSettings(user);
  library.files.splice(1, 1);
  await library.appState.move('background', 'active');
  await new Promise((resolve) => setTimeout(resolve, 700));
  expect(screen.getByText('2 songs')).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Settings' }));
  await user.press(await screen.findByRole('switch', { name: 'Automatic reloading' }));
  await closeSettings(user);
  await library.appState.move('background', 'active');
  expect(await screen.findByText('1 song', {}, { timeout: 3000 })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'La Camisa Negra, Juanes' })).toBeNull();
});

test("shows a folder's cover.jpg for a song with none of its own, once allowed to read images", async () => {
  const library = setup();
  library.disk.set(`${ROOT}/Music/Rock/cover.jpg`, Uint8Array.from([0xff, 0xd8, 0xff]));
  const { user } = await library.launch();
  await closeSettings(user);
  const row = () => screen.getByRole('button', { name: 'Mrs Robinson, Simon & Garfunkel' });
  expect(await within(row()).findByRole('image', { name: 'No cover for Mrs Robinson' })).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Settings' }));
  await user.press(await screen.findByRole('switch', { name: 'Folder covers' }));
  await waitFor(() => expect(switchState('Folder covers')).toMatchObject({ checked: true }));
  await closeSettings(user);

  expect(await within(row()).findByRole('image', { name: 'Cover of Mrs Robinson' })).toBeTruthy();
});

test('leaves folder covers off when the user refuses access to images', async () => {
  const { user, dialogs } = await setup(['grant', 'deny']).launch();
  await user.press(screen.getByRole('switch', { name: 'Folder covers' }));

  await waitFor(() => expect(dialogs.toasts).toEqual(['Folder covers need access to the images on this device.']));
  expect(switchState('Folder covers')).toMatchObject({ checked: false });
});

test("shows the library's statistics", async () => {
  await setup().launch();
  expect(screen.getByRole('header', { name: 'Statistics' })).toBeTruthy();
  expect(screen.getByText('Total duration')).toBeTruthy();
  expect(screen.getByText('3:20')).toBeTruthy();
  expect(screen.getByText('Total size')).toBeTruthy();
  expect(screen.getByText(/^\d+ B$/)).toBeTruthy();
});

const libraryViews = () =>
  screen
    .getAllByRole('tab')
    .map((tab) => tab.props['accessibilityLabel'] as string)
    .filter((name) => ['Songs', 'Albums', 'Artists', 'Genres'].includes(name));

test('shows only the library tabs turned on, in the order chosen, keeping one on', async () => {
  const { user } = await setup().launch();
  await user.press(screen.getByRole('switch', { name: 'Songs' }));
  await user.press(screen.getByRole('button', { name: 'Move Genres up' }));
  await closeSettings(user);

  expect(libraryViews()).toEqual(['Albums', 'Genres', 'Artists']);
  // With songs hidden, the library opens on the first tab left.
  expect(screen.getByRole('tab', { name: 'Albums' }).props['accessibilityState']).toMatchObject({ selected: true });

  await user.press(screen.getByRole('button', { name: 'Settings' }));
  for (const name of ['Albums', 'Genres', 'Artists']) await user.press(await screen.findByRole('switch', { name }));
  expect(switchState('Artists')).toMatchObject({ checked: true });
  await closeSettings(user);
  // One tab alone needs no tabs to pick it.
  expect(libraryViews()).toEqual([]);
  expect(await screen.findByText('2 artists')).toBeTruthy();
});

test('plays a tapped song from its artist when the user asks for that, rather than from the list', async () => {
  const library = setup();
  const { user } = await library.launch();
  library.files.push(['5', 'd.mp3', 100, 1]);
  await user.press(screen.getByRole('button', { name: 'Rescan' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rescan' }).props['accessibilityState']).toMatchObject({ disabled: false }));
  expect(screen.getByText('The list')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Its artist' }));
  expect(screen.getByText("Plays the songs of the song's artist, newest first.")).toBeTruthy();
  await closeSettings(user);

  await user.press(await screen.findByRole('button', { name: 'La Camisa Negra, Juanes' }));
  const player = () => {
    let node = screen.getByRole('button', { name: 'Close player' });
    while (node.parent && !/Modal/.test(node.viewName)) node = node.parent;
    return within(node);
  };
  await user.press(player().getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('heading', { name: 'Fotografía' })).toBeTruthy();
  await user.press(player().getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('heading', { name: 'La Camisa Negra' })).toBeTruthy();
});

test('puts the button the user chose after play in the mini player', async () => {
  const { user } = await setup().launch();
  await user.press(screen.getByRole('button', { name: 'Repeat mode' }));
  await closeSettings(user);
  const mini = () => within(screen.getByRole('button', { name: 'Open player' }).parent!);
  expect(mini().queryByRole('button', { name: 'Next' })).toBeNull();

  await user.press(mini().getByRole('button', { name: 'Repeat off' }));
  expect(mini().getByRole('button', { name: 'Repeat all' }).props['accessibilityState']).toMatchObject({ selected: true });
});
