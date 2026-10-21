import { type FakeFabricNode, render, screen, userEvent, waitFor, within } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from '../app.ts';
import {
  engineProvider,
  fakeDialogs,
  fakeEngine,
  fakeMediaLibrary,
  memoryStorage,
} from '../testing/fakes.ts';

const SONGS: Parameters<typeof fakeMediaLibrary>[0] = [
  ['1', 'Alpha Band - Aurora.mp3', 200],
  ['2', 'Bravo Band - Breeze.mp3', 180],
  ['3', 'Cascade.mp3', 240],
];

const uri = (id: string) => `file:///music/${id}.mp3`;

async function start(unplayable: string[] = []) {
  const engine = fakeEngine();
  const dialogs = fakeDialogs();
  await render(App, {
    providers: [memoryStorage(), engineProvider(engine), fakeMediaLibrary(SONGS, { unplayable }), dialogs.provider],
  });
  await screen.findByText('3 songs');
  return { engine, dialogs, user: userEvent.setup() };
}

function ancestor(node: FakeFabricNode, viewName: string): FakeFabricNode {
  let current: FakeFabricNode | null | undefined = node;
  while (current && current.viewName !== viewName) current = current.parent;
  if (!current) throw new Error(`No ${viewName} above ${node.viewName}.`);
  return current;
}

const fullPlayer = () => within(ancestor(screen.getByRole('button', { name: 'Close player' }), 'ModalHostView'));

test('stops the song that was playing when the next one cannot be opened', async () => {
  const { engine, user } = await start(['2']);
  await user.press(await screen.findByRole('button', { name: 'Aurora, Alpha Band' }));
  await fullPlayer().findByRole('heading', { name: 'Aurora' });
  engine.seekTo(30);

  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));

  expect(await fullPlayer().findByRole('alert', { name: 'Could not play "Breeze".' })).toBeTruthy();
  expect(fullPlayer().getByRole('heading', { name: 'Breeze' })).toBeTruthy();
  expect(engine.state().playing).toBe(false);
  expect(fullPlayer().getByRole('button', { name: 'Play' })).toBeTruthy();
  expect(fullPlayer().getAllByText('0:00').length).toBeGreaterThan(0);
  expect(fullPlayer().getByText('3:00')).toBeTruthy();
});

test('tries the broken song again on play, instead of resuming the one before it', async () => {
  const { engine, user } = await start(['2']);
  await user.press(await screen.findByRole('button', { name: 'Aurora, Alpha Band' }));
  await fullPlayer().findByRole('heading', { name: 'Aurora' });
  await user.press(fullPlayer().getByRole('button', { name: 'Next' }));
  await fullPlayer().findByRole('alert', { name: 'Could not play "Breeze".' });

  await user.press(fullPlayer().getByRole('button', { name: 'Play' }));

  expect(await fullPlayer().findByRole('alert', { name: 'Could not play "Breeze".' })).toBeTruthy();
  expect(engine.state().playing).toBe(false);
  expect(engine.loaded).toEqual([uri('1')]);
});

test('marks a song that cannot be opened with a warning that explains why', async () => {
  const { dialogs, user } = await start(['2']);
  expect(screen.queryByRole('button', { name: 'Why Breeze cannot play' })).toBeNull();

  await user.press(screen.getByRole('button', { name: 'Breeze, Bravo Band' }));
  await fullPlayer().findByRole('alert', { name: 'Could not play "Breeze".' });
  await user.press(fullPlayer().getByRole('button', { name: 'Close player' }));

  await user.press(await screen.findByRole('button', { name: 'Why Breeze cannot play' }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Cannot play "Breeze"'));
  expect(dialogs.open?.message).toBe(
    'The file could not be opened. It may have been moved or deleted, or it is on storage that is not available right now.' +
      '\n\nTap the song to try again.',
  );
  expect(screen.queryByRole('button', { name: 'Why Aurora cannot play' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Why Cascade cannot play' })).toBeNull();
  await dialogs.answer('OK');
  expect(dialogs.open).toBeNull();
});

test('marks a song the device cannot decode, and drops the warning once it plays', async () => {
  const { engine, dialogs, user } = await start();
  await user.press(await screen.findByRole('button', { name: 'Aurora, Alpha Band' }));
  await fullPlayer().findByRole('heading', { name: 'Aurora' });

  engine.fail();

  expect(await fullPlayer().findByRole('alert', { name: 'Could not play "Aurora".' })).toBeTruthy();
  expect(fullPlayer().getByRole('button', { name: 'Play' })).toBeTruthy();
  await user.press(fullPlayer().getByRole('button', { name: 'Close player' }));
  await user.press(await screen.findByRole('button', { name: 'Why Aurora cannot play' }));
  await waitFor(() => expect(dialogs.open?.message).toContain('could not be decoded'));
  await dialogs.answer('OK');

  await user.press(screen.getByRole('button', { name: 'Aurora, Alpha Band' }));

  await waitFor(() => expect(engine.loaded).toEqual([uri('1'), uri('1')]));
  expect(fullPlayer().queryByRole('alert')).toBeNull();
  expect(fullPlayer().getByRole('button', { name: 'Pause' })).toBeTruthy();
  await user.press(fullPlayer().getByRole('button', { name: 'Close player' }));
  expect(screen.queryByRole('button', { name: 'Why Aurora cannot play' })).toBeNull();
});

test('shows the warning on the song inside a playlist too', async () => {
  const { dialogs, user } = await start(['2']);
  await user.press(screen.getByRole('button', { name: 'Breeze, Bravo Band' }));
  await fullPlayer().findByRole('alert', { name: 'Could not play "Breeze".' });
  await user.press(fullPlayer().getByRole('button', { name: 'Close player' }));
  await user.longPress(screen.getByRole('button', { name: 'Breeze, Bravo Band' }));
  await user.type(await screen.findByPlaceholderText('New playlist name'), 'Broken');
  await user.press(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(dialogs.toasts).toContain('Created Broken'));

  await user.press(screen.getByRole('tab', { name: 'Playlists' }));
  await user.press(screen.getByRole('button', { name: 'Open Broken' }));

  expect(await screen.findByRole('button', { name: 'Why Breeze cannot play' })).toBeTruthy();
});
