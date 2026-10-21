import { type FakeFabricNode, render, screen, userEvent, waitFor, within } from '@ng-native/testing';
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

type AudioFile = [id: string, filename: string, seconds: number, modified?: number];

const files: AudioFile[] = [
  ['1', '1.mp3', 200, 1],
  ['2', '2.mp3', 210, 2],
  ['3', '3.mp3', 190, 3],
  ['4', '4.mp3', 300, 4],
  ['5', '5.mp3', 250, 5],
  ['6', '6.mp3', 230, 6],
];
const disk = () =>
  new Map([
    [musicUri('1'), taggedMp3({ title: 'Too Long', artist: 'Daft Punk', albumArtist: 'Daft Punk', album: 'Discovery', year: '2001', track: '1', disc: '2', genre: 'House' })],
    [musicUri('2'), taggedMp3({ title: 'Aerodynamic', artist: 'Daft Punk', albumArtist: 'Daft Punk', album: 'Discovery', year: '2001', track: '2', disc: '1', genre: 'House' })],
    [musicUri('3'), taggedMp3({ title: 'One More Time', artist: 'Daft Punk', albumArtist: 'Daft Punk', album: 'Discovery', year: '2001', track: '1', disc: '1', genre: 'House' })],
    [musicUri('4'), taggedMp3({ title: 'Da Funk', artist: 'Daft Punk', albumArtist: 'Daft Punk', album: 'Da Funk', year: '1995', track: '1', releaseType: 'ep', genre: 'House' })],
    [musicUri('5'), taggedMp3({ title: 'Get Lucky', artist: 'Daft Punk, Pharrell Williams', albumArtist: 'Various Artists', album: 'Hits 2013', year: '2013', releaseType: 'compilation', genre: 'Disco' })],
    [musicUri('6'), taggedMp3({ title: 'Happy', artist: 'Pharrell Williams', album: 'GIRL', year: '2014', genre: 'Pop' })],
  ]);

async function launch() {
  const engine = fakeEngine();
  const back = fakeHardwareBack();
  await render(App, {
    providers: [memoryStorage(), engineProvider(engine), fakeMediaLibrary(files), memoryFiles(disk()), fakeDialogs().provider, back.provider],
  });
  await screen.findByText('6 songs');
  return { engine, back, user: userEvent.setup() };
}

/** The text of the section headings on show, in order. */
const headings = () => screen.queryAllByRole('header').map((node) => textOf(node));
const textOf = (node: FakeFabricNode): string =>
  typeof node.props['text'] === 'string' ? node.props['text'] : node.children.map(textOf).join('');
const stateOf = (node: FakeFabricNode) => node.props['accessibilityState'];

test('lists the albums, each with its artist, year and songs, and opens one in disc and track order', async () => {
  const { user, engine } = await launch();
  await user.press(screen.getByRole('tab', { name: 'Albums' }));

  expect(stateOf(screen.getByRole('tab', { name: 'Albums' }))).toMatchObject({ selected: true });
  expect(await screen.findByText('4 albums')).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Discovery, Daft Punk  ·  2001  ·  3 songs' }));

  expect(await screen.findByRole('heading', { name: 'Discovery' })).toBeTruthy();
  expect(screen.getByText('Album  ·  2001  ·  3 songs  ·  10:00')).toBeTruthy();
  expect(headings()).toEqual(['Disc 1', 'Disc 2']);
  const rows = ['One More Time, Daft Punk', 'Aerodynamic, Daft Punk', 'Too Long, Daft Punk'].map((name) => screen.getByRole('button', { name }));
  expect(screen.getAllByRole('button').filter((node) => rows.includes(node))).toEqual(rows);
  expect(within(rows[0]!).getByText('1')).toBeTruthy();

  // The album plays in its own order, so after Aerodynamic comes the second disc.
  await user.press(rows[1]!);
  await waitFor(() => expect(engine.loaded).toEqual([musicUri('2')]));
  engine.finish();
  await waitFor(() => expect(engine.loaded).toEqual([musicUri('2'), musicUri('1')]));
});

test("opens an artist with their albums by release type, the albums they appear on, and their songs", async () => {
  const { user, back } = await launch();
  await user.press(screen.getByRole('tab', { name: 'Artists' }));
  await user.press(await screen.findByRole('button', { name: 'Daft Punk, 2 albums  ·  5 songs' }));

  expect(await screen.findByRole('heading', { name: 'Daft Punk' })).toBeTruthy();
  expect(headings()).toEqual(['Albums', 'EPs', 'Appears on', 'Songs']);
  expect(screen.getByRole('button', { name: 'Discovery, Album  ·  2001  ·  3 songs' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Da Funk, EP  ·  1995  ·  1 song' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Hits 2013, Various Artists  ·  2013  ·  1 song' })).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Da Funk, EP  ·  1995  ·  1 song' }));
  expect(await screen.findByRole('heading', { name: 'Da Funk' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Go to Daft Punk' }));
  expect(await screen.findByRole('heading', { name: 'Daft Punk' })).toBeTruthy();

  expect(await back.press()).toBe(true);
  expect(await screen.findByRole('heading', { name: 'Da Funk' })).toBeTruthy();
  expect(await back.press()).toBe(true);
  expect(await back.press()).toBe(true);
  expect(await screen.findByText('3 artists')).toBeTruthy();
});

test('opens a genre with its artists and songs', async () => {
  const { user } = await launch();
  await user.press(screen.getByRole('tab', { name: 'Genres' }));
  await user.press(await screen.findByRole('button', { name: 'House, 1 artist  ·  4 songs' }));

  expect(await screen.findByRole('heading', { name: 'House' })).toBeTruthy();
  expect(headings()).toEqual(['Artists', 'Songs']);
  expect(screen.getByRole('button', { name: 'Daft Punk, 4 songs' })).toBeTruthy();
});

test('sorts the songs by what the user picks, either way, and keeps it', async () => {
  const { user } = await launch();
  const order = () =>
    screen
      .getAllByRole('button')
      .map((node) => node.props['accessibilityLabel'] as string)
      .filter((label) => /, (Daft Punk|Pharrell Williams)/.test(label))
      .map((label) => label.split(',')[0]);
  expect(order()).toEqual(['Aerodynamic', 'Da Funk', 'Get Lucky', 'Happy', 'One More Time', 'Too Long']);

  await user.press(screen.getByRole('button', { name: 'Sort' }));
  await user.press(await screen.findByRole('radio', { name: 'Duration' }));
  await user.press(screen.getByRole('button', { name: 'Descending' }));
  expect(stateOf(screen.getByRole('radio', { name: 'Duration' }))).toMatchObject({ checked: true });
  await user.press(screen.getByRole('button', { name: 'Close' }));

  await waitFor(() => expect(order()).toEqual(['Da Funk', 'Get Lucky', 'Happy', 'Aerodynamic', 'Too Long', 'One More Time']));
});

test('sorts the albums by date', async () => {
  const { user } = await launch();
  await user.press(screen.getByRole('tab', { name: 'Albums' }));
  await screen.findByText('4 albums');
  await user.press(screen.getByRole('button', { name: 'Sort' }));
  await user.press(await screen.findByRole('radio', { name: 'Date' }));

  const albums = screen
    .getAllByRole('button')
    .map((node) => node.props['accessibilityLabel'] as string)
    .filter((label) => / songs?$/.test(label) && label.includes('  ·  '))
    .map((label) => label.split(',')[0]);
  expect(albums).toEqual(['Da Funk', 'Discovery', 'Hits 2013', 'GIRL']);
});

test("gives each of an album's songs a menu, which goes to its artists but not to the album on show", async () => {
  const { user, back } = await launch();
  await user.press(screen.getByRole('tab', { name: 'Albums' }));
  await user.press(await screen.findByRole('button', { name: 'Hits 2013, Various Artists  ·  2013  ·  1 song' }));
  await user.press(await screen.findByRole('button', { name: 'More for Get Lucky' }));

  expect(await screen.findByRole('button', { name: 'Properties' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Go to album' })).toBeNull();
  await user.press(screen.getByRole('button', { name: 'Go to artist' }));
  expect(await screen.findByRole('heading', { name: 'Go to artist' })).toBeTruthy();
  await user.press(screen.getByRole('button', { name: 'Pharrell Williams' }));

  expect(await screen.findByRole('heading', { name: 'Pharrell Williams' })).toBeTruthy();
  expect(await back.press()).toBe(true);
  expect(await screen.findByRole('heading', { name: 'Hits 2013' })).toBeTruthy();
});
