import {
  type FakeFabric,
  type FakeFabricNode,
  cleanup,
  fireEvent,
  render,
  screen,
  settle,
  userEvent,
  waitFor,
  within,
} from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from '../app.ts';
import { type FakeEngine, engineProvider, fakeEngine, fakeMediaLibrary, memoryStorage } from '../testing/fakes.ts';

type Files = Parameters<typeof fakeMediaLibrary>[0];

const SONGS: Files = [
  ['1', 'Alpha Band - Aurora.mp3', 200],
  ['2', 'Bravo Band - Breeze.mp3', 180],
  ['3', 'Cascade.mp3', 240],
];

const uri = (id: string) => `file:///music/${id}.mp3`;

async function start(
  options: { files?: Files; unplayable?: string[]; disk?: Map<string, string>; engine?: FakeEngine } = {},
) {
  const engine = options.engine ?? fakeEngine();
  const view = await render(App, {
    providers: [
      memoryStorage(options.disk),
      engineProvider(engine),
      fakeMediaLibrary(options.files ?? SONGS, { unplayable: options.unplayable }),
    ],
  });
  const files = options.files ?? SONGS;
  await screen.findByText(`${files.length} songs`);
  return { engine, fabric: view.fabric, user: userEvent.setup() };
}

async function tapAt(fabric: FakeFabric, node: FakeFabricNode, locationX: number) {
  const point = { identifier: 0, target: node.reactTag, pageX: locationX, pageY: 0, locationX, locationY: 0, timestamp: Date.now() };
  fabric.emit(node, 'topTouchStart', { ...point, touches: [point], changedTouches: [point] });
  fabric.emit(node, 'topTouchEnd', { ...point, touches: [], changedTouches: [point] });
  await settle();
}

function ancestor(node: FakeFabricNode, viewName: string): FakeFabricNode {
  let current: FakeFabricNode | null | undefined = node;
  while (current && current.viewName !== viewName) current = current.parent;
  if (!current) throw new Error(`No ${viewName} above ${node.viewName}.`);
  return current;
}

const fullPlayer = () => within(ancestor(screen.getByRole('button', { name: 'Close player' }), 'ModalHostView'));
const miniPlayer = () => within(screen.getByRole('button', { name: 'Open player' }).parent!);

const state = (node: FakeFabricNode) => node.props['accessibilityState'];

async function playFromLibrary(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.press(await screen.findByRole('button', { name }));
  await screen.findByRole('button', { name: 'Close player' });
}

test('shows nothing playing in the mini player until a song starts, then its title and artist', async () => {
  const { user } = await start();

  const mini = miniPlayer();
  expect(mini.getByText('Nothing playing')).toBeTruthy();
  expect(mini.getByText('Tap play to start your library')).toBeTruthy();
  expect(state(mini.getByRole('button', { name: 'Previous' }))).toMatchObject({ disabled: true });
  expect(state(mini.getByRole('button', { name: 'Next' }))).toMatchObject({ disabled: true });

  await playFromLibrary(user, 'Aurora, Alpha Band');
  await user.press(fullPlayer().getByRole('button', { name: 'Close player' }));

  expect(screen.queryByRole('button', { name: 'Close player' })).toBeNull();
  expect(miniPlayer().getByText('Aurora')).toBeTruthy();
  expect(miniPlayer().getByText('Alpha Band')).toBeTruthy();
  expect(state(miniPlayer().getByRole('button', { name: 'Next' }))).toMatchObject({ disabled: false });

  await user.press(screen.getByRole('button', { name: 'Open player' }));
  expect(await fullPlayer().findByRole('heading', { name: 'Aurora' })).toBeTruthy();
});

test('pauses and resumes the song from the mini player', async () => {
  const { engine, user } = await start();
  await playFromLibrary(user, 'Aurora, Alpha Band');
  await user.press(fullPlayer().getByRole('button', { name: 'Close player' }));

  await user.press(miniPlayer().getByRole('button', { name: 'Pause' }));
  expect(engine.state().playing).toBe(false);
  expect(miniPlayer().getByRole('button', { name: 'Play' })).toBeTruthy();
  expect(miniPlayer().queryByRole('button', { name: 'Pause' })).toBeNull();

  await user.press(miniPlayer().getByRole('button', { name: 'Play' }));
  expect(engine.state().playing).toBe(true);
  expect(miniPlayer().getByRole('button', { name: 'Pause' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('1')]);
});

test('plays the library from its first song when play is pressed with nothing queued', async () => {
  const { engine, user } = await start();

  await user.press(miniPlayer().getByRole('button', { name: 'Play' }));

  expect(engine.loaded).toEqual([uri('1')]);
  expect(await miniPlayer().findByText('Aurora')).toBeTruthy();
  expect(miniPlayer().getByRole('button', { name: 'Pause' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Close player' })).toBeNull();
});

test('opens an empty full player from the mini player, and starts the library from its play button', async () => {
  const { engine, user } = await start();

  await user.press(screen.getByRole('button', { name: 'Open player' }));
  const full = fullPlayer();
  expect(full.getByRole('heading', { name: 'Nothing playing' })).toBeTruthy();
  expect(full.getByText('Pick a song to start')).toBeTruthy();
  expect(full.getByRole('image', { name: 'No song' })).toBeTruthy();
  expect(full.getAllByText('0:00')).toHaveLength(2);
  for (const name of ['Previous', 'Next', 'Change cover', 'Add to playlist']) {
    expect(state(full.getByRole('button', { name }))).toMatchObject({ disabled: true });
  }

  await user.press(full.getByRole('button', { name: 'Play' }));

  expect(await fullPlayer().findByRole('heading', { name: 'Aurora' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('1')]);
  expect(state(fullPlayer().getByRole('button', { name: 'Next' }))).toMatchObject({ disabled: false });
});

test('goes to the next and the previous song from the full player', async () => {
  const { engine, user } = await start();
  await playFromLibrary(user, 'Aurora, Alpha Band');

  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
  expect(await fullPlayer().findByRole('heading', { name: 'Breeze' })).toBeTruthy();
  expect(fullPlayer().getByText('Bravo Band')).toBeTruthy();
  expect(engine.loaded).toEqual([uri('1'), uri('2')]);

  await user.press(fullPlayer().getByRole('button', { name: 'Previous' }));
  expect(await fullPlayer().findByRole('heading', { name: 'Aurora' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('1'), uri('2'), uri('1')]);
});

test('restarts the song when previous is pressed a few seconds in, and goes back a song before that', async () => {
  const { engine, user } = await start();
  await playFromLibrary(user, 'Breeze, Bravo Band');

  engine.seekTo(42);
  expect(await fullPlayer().findByText('0:42')).toBeTruthy();
  await user.press(fullPlayer().getByRole('button', { name: 'Previous' }));

  expect(engine.state().currentTime).toBe(0);
  expect(await fullPlayer().findByText('0:00')).toBeTruthy();
  expect(fullPlayer().getByRole('heading', { name: 'Breeze' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('2')]);

  engine.seekTo(3);
  await fullPlayer().findByText('0:03');
  await user.press(fullPlayer().getByRole('button', { name: 'Previous' }));
  expect(await fullPlayer().findByRole('heading', { name: 'Aurora' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('2'), uri('1')]);
});

test('wraps around both ends of the list when previous and next are pressed', async () => {
  const { engine, user } = await start();
  await playFromLibrary(user, 'Aurora, Alpha Band');

  await user.press(fullPlayer().getByRole('button', { name: 'Previous' }));
  expect(await fullPlayer().findByRole('heading', { name: 'Cascade' })).toBeTruthy();
  expect(fullPlayer().getByText('Unknown artist')).toBeTruthy();

  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
  expect(await fullPlayer().findByRole('heading', { name: 'Aurora' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('1'), uri('3'), uri('1')]);
});

test('moves on to the next song when one ends, stops after the last, and plays the last again from the start', async () => {
  const { engine, user } = await start();
  await playFromLibrary(user, 'Breeze, Bravo Band');

  engine.finish();
  expect(await fullPlayer().findByRole('heading', { name: 'Cascade' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('2'), uri('3')]);

  engine.finish();
  expect(await fullPlayer().findByRole('button', { name: 'Play' })).toBeTruthy();
  expect(fullPlayer().getByRole('heading', { name: 'Cascade' })).toBeTruthy();
  expect(fullPlayer().getAllByText('3:20')).toHaveLength(2);
  expect(engine.loaded).toEqual([uri('2'), uri('3')]);

  await user.press(fullPlayer().getByRole('button', { name: 'Play' }));
  expect(engine.state()).toMatchObject({ playing: true, currentTime: 0 });
  expect(await fullPlayer().findByText('0:00')).toBeTruthy();
  expect(fullPlayer().getByRole('button', { name: 'Pause' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('2'), uri('3')]);
});

test('cycles the repeat button through off, all, one and back to off', async () => {
  const { user } = await start();
  await playFromLibrary(user, 'Aurora, Alpha Band');

  expect(state(fullPlayer().getByRole('button', { name: 'Repeat off' }))).toMatchObject({ selected: false });
  await user.press(fullPlayer().getByRole('button', { name: 'Repeat off' }));
  expect(state(fullPlayer().getByRole('button', { name: 'Repeat all' }))).toMatchObject({ selected: true });
  await user.press(fullPlayer().getByRole('button', { name: 'Repeat all' }));
  expect(state(fullPlayer().getByRole('button', { name: 'Repeat one' }))).toMatchObject({ selected: true });
  await user.press(fullPlayer().getByRole('button', { name: 'Repeat one' }));
  expect(state(fullPlayer().getByRole('button', { name: 'Repeat off' }))).toMatchObject({ selected: false });
});

test('starts the list over after the last song with repeat all', async () => {
  const { engine, user } = await start();
  await playFromLibrary(user, 'Cascade');
  await user.press(fullPlayer().getByRole('button', { name: 'Repeat off' }));

  engine.finish();

  expect(await fullPlayer().findByRole('heading', { name: 'Aurora' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('3'), uri('1')]);
  expect(engine.state().playing).toBe(true);
});

test('plays the same song again with repeat one', async () => {
  const { engine, user } = await start();
  await playFromLibrary(user, 'Breeze, Bravo Band');
  await user.press(fullPlayer().getByRole('button', { name: 'Repeat off' }));
  await user.press(fullPlayer().getByRole('button', { name: 'Repeat all' }));

  engine.finish();

  await waitFor(() => expect(engine.state()).toMatchObject({ playing: true, currentTime: 0 }));
  expect(await fullPlayer().findByText('0:00')).toBeTruthy();
  expect(fullPlayer().getByRole('heading', { name: 'Breeze' })).toBeTruthy();
  expect(fullPlayer().getByRole('button', { name: 'Pause' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('2')]);
});

test('keeps the song playing when shuffle is turned on, then reaches every song once with next', async () => {
  const files: Files = [
    ['1', 'Alpha Band - Aurora.mp3', 200],
    ['2', 'Bravo Band - Breeze.mp3', 180],
    ['3', 'Cascade.mp3', 240],
    ['4', 'Delta - Dune.mp3', 210],
    ['5', 'Echo - Ember.mp3', 190],
  ];
  const titles = ['Aurora', 'Breeze', 'Cascade', 'Dune', 'Ember'];
  const { engine, user } = await start({ files });
  await playFromLibrary(user, 'Cascade');
  expect(state(fullPlayer().getByRole('button', { name: 'Shuffle' }))).toMatchObject({ selected: false });

  await user.press(fullPlayer().getByRole('button', { name: 'Shuffle' }));

  expect(state(fullPlayer().getByRole('button', { name: 'Shuffle' }))).toMatchObject({ selected: true });
  expect(fullPlayer().getByRole('heading', { name: 'Cascade' })).toBeTruthy();
  expect(engine.loaded).toEqual([uri('3')]);

  const heard = ['Cascade'];
  for (let i = 1; i < titles.length; i++) {
    await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
    const title = titles.find((candidate) => fullPlayer().queryByRole('heading', { name: candidate }));
    heard.push(title ?? 'none');
  }
  expect([...heard].sort()).toEqual(titles);
  expect(engine.loaded).toHaveLength(titles.length);
});

test('goes back to the list order from the song playing when shuffle is turned off', async () => {
  const { engine, user } = await start();
  await playFromLibrary(user, 'Aurora, Alpha Band');
  await user.press(fullPlayer().getByRole('button', { name: 'Shuffle' }));
  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
  const playing = ['Breeze', 'Cascade'].find((title) => fullPlayer().queryByRole('heading', { name: title }))!;

  await user.press(fullPlayer().getByRole('button', { name: 'Shuffle' }));

  expect(state(fullPlayer().getByRole('button', { name: 'Shuffle' }))).toMatchObject({ selected: false });
  expect(fullPlayer().getByRole('heading', { name: playing })).toBeTruthy();
  expect(engine.loaded).toHaveLength(2);
  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
  const following = playing === 'Breeze' ? 'Cascade' : 'Aurora';
  expect(await fullPlayer().findByRole('heading', { name: following })).toBeTruthy();
});

test('shows the elapsed and total time, and the elapsed time follows the song', async () => {
  const { engine, user } = await start();
  await playFromLibrary(user, 'Aurora, Alpha Band');

  const times = fullPlayer();
  expect(times.getByText('0:00')).toBeTruthy();
  expect(times.getByText('3:20')).toBeTruthy();

  engine.seekTo(65);

  expect(await fullPlayer().findByText('1:05')).toBeTruthy();
  expect(fullPlayer().getByText('3:20')).toBeTruthy();
  expect(fullPlayer().queryByText('0:00')).toBeNull();
});

test('moves the song to where the seek bar is tapped', async () => {
  const { engine, fabric, user } = await start();
  await playFromLibrary(user, 'Aurora, Alpha Band');
  const bar = fullPlayer().getByRole('adjustable', { name: 'Position' });
  expect(bar.props['accessibilityValue']).toEqual({ min: 0, max: 100, now: 0 });

  await fireEvent.layout(bar, { width: 300 });
  await tapAt(fabric, fullPlayer().getByRole('adjustable', { name: 'Position' }), 225);

  expect(engine.state().currentTime).toBe(150);
  expect(await fullPlayer().findByText('2:30')).toBeTruthy();
  expect(fullPlayer().getByRole('adjustable', { name: 'Position' }).props['accessibilityValue']).toEqual({
    min: 0,
    max: 100,
    now: 75,
  });
});

test('says a song could not be played, and lets the user go on to the next one', async () => {
  const { engine, user } = await start({ unplayable: ['2'] });

  await playFromLibrary(user, 'Breeze, Bravo Band');

  expect(await fullPlayer().findByRole('alert', { name: 'Could not play "Breeze".' })).toBeTruthy();
  expect(fullPlayer().getByRole('heading', { name: 'Breeze' })).toBeTruthy();
  expect(engine.loaded).toEqual([]);

  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));

  expect(await fullPlayer().findByRole('heading', { name: 'Cascade' })).toBeTruthy();
  expect(fullPlayer().queryByRole('alert')).toBeNull();
  expect(engine.loaded).toEqual([uri('3')]);
  expect(fullPlayer().getByRole('button', { name: 'Pause' })).toBeTruthy();
});

test('remembers shuffle and repeat after the app is restarted', async () => {
  const disk = new Map<string, string>();
  const first = await start({ disk });
  await first.user.press(screen.getByRole('button', { name: 'Open player' }));
  await first.user.press(fullPlayer().getByRole('button', { name: 'Shuffle' }));
  await first.user.press(fullPlayer().getByRole('button', { name: 'Repeat off' }));
  await waitFor(() => {
    expect(disk.get('player.shuffle')).toBe('true');
    expect(disk.get('player.repeat')).toBe('"all"');
  });
  cleanup();

  const { user } = await start({ disk });
  await user.press(screen.getByRole('button', { name: 'Open player' }));

  expect(state(await fullPlayer().findByRole('button', { name: 'Repeat all' }))).toMatchObject({ selected: true });
  expect(state(fullPlayer().getByRole('button', { name: 'Shuffle' }))).toMatchObject({ selected: true });
});

test('shows the playback status and time on the mini player display, and the time left when it is tapped', async () => {
  const { engine, user } = await start();
  expect(miniPlayer().getByText('■')).toBeTruthy();
  expect(miniPlayer().getByText('0:00')).toBeTruthy();

  await user.press(miniPlayer().getByRole('button', { name: 'Play' }));
  expect(await miniPlayer().findByText('▶')).toBeTruthy();
  engine.seekTo(65);
  expect(await miniPlayer().findByText('1:05')).toBeTruthy();

  await user.press(miniPlayer().getByRole('button', { name: 'Time elapsed' }));
  expect(miniPlayer().getByRole('button', { name: 'Time remaining' })).toBeTruthy();
  expect(miniPlayer().getByText('-2:15')).toBeTruthy();

  await user.press(miniPlayer().getByRole('button', { name: 'Pause' }));
  expect(await miniPlayer().findByText('❚❚')).toBeTruthy();
  expect(miniPlayer().getByText('-2:15')).toBeTruthy();

  await user.press(miniPlayer().getByRole('button', { name: 'Time remaining' }));
  expect(miniPlayer().getByText('1:05')).toBeTruthy();
});

test('drops the display from the mini player with a skin that has none', async () => {
  const { user } = await start();
  expect(miniPlayer().getByRole('button', { name: 'Time elapsed' })).toBeTruthy();

  await user.press(screen.getByRole('tab', { name: 'Skins' }));
  await user.press(screen.getByRole('button', { name: 'Use skin Paper' }));

  expect(miniPlayer().queryByRole('button', { name: 'Time elapsed' })).toBeNull();
  expect(miniPlayer().getByText('Nothing playing')).toBeTruthy();
});

test('marks the playing song in the library and follows it as the mini player skips', async () => {
  const { user } = await start();
  await playFromLibrary(user, 'Aurora, Alpha Band');
  await user.press(fullPlayer().getByRole('button', { name: 'Close player' }));

  expect(state(screen.getByRole('button', { name: 'Aurora, Alpha Band' }))).toMatchObject({ selected: true });
  expect(state(screen.getByRole('button', { name: 'Breeze, Bravo Band' }))).toMatchObject({ selected: false });

  await user.press(miniPlayer().getByRole('button', { name: 'Next' }));

  expect(await miniPlayer().findByText('Breeze')).toBeTruthy();
  expect(state(screen.getByRole('button', { name: 'Aurora, Alpha Band' }))).toMatchObject({ selected: false });
  expect(state(screen.getByRole('button', { name: 'Breeze, Bravo Band' }))).toMatchObject({ selected: true });

  await user.press(miniPlayer().getByRole('button', { name: 'Previous' }));
  expect(await miniPlayer().findByText('Aurora')).toBeTruthy();
});

test('plays only the songs found by a search', async () => {
  const { engine, user } = await start();
  await user.type(screen.getByPlaceholderText('Search songs, artists or albums'), 'band');
  expect(await screen.findByText('2 of 3 songs')).toBeTruthy();

  await playFromLibrary(user, 'Breeze, Bravo Band');
  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
  expect(await fullPlayer().findByRole('heading', { name: 'Aurora' })).toBeTruthy();
  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
  expect(await fullPlayer().findByRole('heading', { name: 'Breeze' })).toBeTruthy();

  expect(engine.loaded).toEqual([uri('2'), uri('1'), uri('2')]);
});

test('plays the whole library in order with play all, and shuffled with shuffle', async () => {
  const { engine, user } = await start();

  await user.press(screen.getByRole('button', { name: 'Play all' }));
  expect(await fullPlayer().findByRole('heading', { name: 'Aurora' })).toBeTruthy();
  expect(state(fullPlayer().getByRole('button', { name: 'Shuffle' }))).toMatchObject({ selected: false });
  expect(engine.loaded).toEqual([uri('1')]);
  await user.press(fullPlayer().getByRole('button', { name: 'Close player' }));

  await user.press(screen.getByRole('button', { name: 'Shuffle' }));
  expect(engine.loaded).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Close player' })).toBeNull();
  await user.press(screen.getByRole('button', { name: 'Open player' }));
  expect(state(fullPlayer().getByRole('button', { name: 'Shuffle' }))).toMatchObject({ selected: true });
});
