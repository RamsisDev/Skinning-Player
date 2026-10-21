import { signal } from '@angular/core';
import { injectService, waitFor } from '@ng-native/testing';
import { describe, expect, it } from 'vitest';
import { TRACKS, engineProvider, fakeEngine, memoryStorage } from '../testing/fakes.ts';
import { MusicLibrary } from './music-library.ts';
import { Player, shuffledOrder } from './player.ts';
import { type Track } from './track.ts';

function setup() {
  const engine = fakeEngine();
  const library = { tracks: signal(TRACKS), uriOf: async (track: Track) => `file:///music/${track.id}.mp3` };
  const player = injectService(Player, {
    providers: [memoryStorage(), engineProvider(engine), { provide: MusicLibrary, useValue: library }],
  });
  return { engine, player };
}

describe('Player', () => {
  it('plays a queue from the chosen track and steps through it', async () => {
    const { engine, player } = setup();
    player.playTracks(TRACKS, 1, 'library');
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/b.mp3']));
    expect(player.current()?.id).toBe('b');
    expect(player.queuePosition()).toBe(2);

    player.next();
    await waitFor(() => expect(player.current()?.id).toBe('c'));
    player.next();
    await waitFor(() => expect(player.current()?.id).toBe('a'));
  });

  it('restarts the track on "previous" once it is a few seconds in', async () => {
    const { engine, player } = setup();
    player.playTracks(TRACKS, 1);
    await waitFor(() => expect(engine.loaded.length).toBe(1));
    engine.seekTo(42);
    player.previous();
    expect(player.current()?.id).toBe('b');
    expect(player.elapsed()).toBe(0);

    player.previous();
    await waitFor(() => expect(player.current()?.id).toBe('a'));
  });

  it('moves on when a track ends, and stops at the end unless repeating', async () => {
    const { engine, player } = setup();
    player.playTracks(TRACKS, 2);
    await waitFor(() => expect(engine.loaded.length).toBe(1));
    engine.finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(player.current()?.id).toBe('c');
    expect(engine.loaded.length).toBe(1);

    player.cycleRepeat();
    expect(player.repeat()).toBe('all');
    engine.play();
    engine.finish();
    await waitFor(() => expect(player.current()?.id).toBe('a'));
  });

  it('repeats one track', async () => {
    const { engine, player } = setup();
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(engine.loaded.length).toBe(1));
    player.cycleRepeat();
    player.cycleRepeat();
    expect(player.repeat()).toBe('one');
    engine.finish();
    await waitFor(() => expect(player.playing()).toBe(true));
    expect(player.current()?.id).toBe('a');
    expect(player.elapsed()).toBe(0);
  });

  it('shuffles around the track that is playing without interrupting it', async () => {
    const { engine, player } = setup();
    player.playTracks(TRACKS, 1);
    await waitFor(() => expect(engine.loaded.length).toBe(1));
    player.toggleShuffle();
    expect(player.shuffle()).toBe(true);
    expect(player.current()?.id).toBe('b');
    expect(engine.loaded.length).toBe(1);

    const seen = new Set<string>(['b']);
    for (let i = 0; i < 2; i++) {
      player.next();
      await waitFor(() => expect(engine.loaded.length).toBe(i + 2));
      seen.add(player.current()!.id);
    }
    expect(seen).toEqual(new Set(['a', 'b', 'c']));

    player.toggleShuffle();
    expect(player.queuePosition()).toBe(TRACKS.findIndex((t) => t.id === player.current()!.id) + 1);
  });

  it('starts the library when play is pressed with nothing queued', async () => {
    const { engine, player } = setup();
    player.toggle();
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/a.mp3']));
    player.toggle();
    expect(player.playing()).toBe(false);
  });
});

describe('with an engine that reports a new source only after a while, as native does', () => {
  function slowSetup() {
    const engine = fakeEngine();
    const slow = { ...engine, load: (uri: string) => void engine.loaded.push(uri) };
    const library = { tracks: signal(TRACKS), uriOf: async (track: Track) => `file:///music/${track.id}.mp3` };
    const player = injectService(Player, {
      providers: [memoryStorage(), engineProvider(slow), { provide: MusicLibrary, useValue: library }],
    });
    return { engine, player };
  }
  const aWhile = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('does not skip the next track because the previous one had ended', async () => {
    const { engine, player } = slowSetup();
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(engine.loaded.length).toBe(1));
    engine.play();
    engine.finish();
    await waitFor(() => expect(engine.loaded.length).toBe(2));
    await aWhile();

    expect(player.current()?.id).toBe('b');
    expect(engine.loaded.length).toBe(2);
  });

  it('does not blame the next track for the error of the one before it', async () => {
    const { engine, player } = slowSetup();
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(engine.loaded.length).toBe(1));
    engine.play();
    engine.fail();
    await waitFor(() => expect(player.failures().has('a')).toBe(true));

    player.next();
    await waitFor(() => expect(engine.loaded.length).toBe(2));
    await aWhile();

    expect(player.failures().has('b')).toBe(false);
    expect(player.error()).toBeNull();
  });
});

it('shuffles every index exactly once, leading with the one asked for', () => {
  const order = shuffledOrder(10, 7);
  expect(order[0]).toBe(7);
  expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
