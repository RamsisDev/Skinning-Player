import { Injector, computed, signal } from '@angular/core';
import { injectService, settle, waitFor } from '@ng-native/testing';
import { describe, expect, it } from 'vitest';
import { TRACKS, engineProvider, fakeEngine, memoryStorage } from '../testing/fakes.ts';
import { BehaviorSettings } from './behavior-settings.ts';
import { MusicLibrary } from './music-library.ts';
import { Player, shuffledOrder } from './player.ts';
import { type Track } from './track.ts';

/** A library already read, holding `tracks`. */
function fakeLibrary(tracks: readonly Track[] = TRACKS) {
  const all = signal(tracks);
  return {
    tracks: all,
    status: signal('ready'),
    byId: computed(() => new Map(all().map((track) => [track.id, track]))),
    uriOf: async (track: Track) => `file:///music/${track.id}.mp3`,
  };
}

/** A player over `disk`, the device's storage, which a second setup over the same disk reads back as a relaunch would. */
function setup(disk = new Map<string, string>(), tracks: readonly Track[] = TRACKS) {
  const engine = fakeEngine();
  const injector = injectService(Injector, {
    providers: [memoryStorage(disk), engineProvider(engine), { provide: MusicLibrary, useValue: fakeLibrary(tracks) }],
  });
  return { engine, disk, player: injector.get(Player), behavior: injector.get(BehaviorSettings) };
}

const ids = (tracks: readonly Track[]) => tracks.map((track) => track.id);

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

  it('plays queued tracks right after the one playing, and added ones at the end, without interrupting it', async () => {
    const { engine, player } = setup();
    const [a, b, c] = TRACKS;
    player.playTracks([a, b], 0);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));

    player.addToQueue([c]);
    player.playNext([b]);
    expect(player.current()?.id).toBe('a');
    expect(player.queueLength()).toBe(4);
    expect(engine.loaded).toHaveLength(1);

    const played: string[] = [];
    for (let i = 0; i < 3; i++) {
      player.next();
      await waitFor(() => expect(engine.loaded).toHaveLength(i + 2));
      played.push(player.current()!.id);
    }
    expect(played).toEqual(['b', 'b', 'c']);
  });

  it('keeps a track to play next after the one playing when shuffle is turned off', async () => {
    const { engine, player } = setup();
    player.playTracks(TRACKS, 0);
    player.toggleShuffle();
    await waitFor(() => expect(engine.loaded).toHaveLength(1));
    const playing = player.current()!;

    player.playNext([TRACKS[2]]);
    player.toggleShuffle();
    player.next();
    await waitFor(() => expect(engine.loaded).toHaveLength(2));
    expect(player.current()?.id).toBe('c');
    expect(player.queuePosition()).toBe(TRACKS.indexOf(playing) + 2);
  });

  it('plays what is queued when nothing is playing', async () => {
    const { engine, player } = setup();
    player.addToQueue([TRACKS[1]]);
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/b.mp3']));
    expect(player.queueLength()).toBe(1);
  });

  it('starts the library when play is pressed with nothing queued', async () => {
    const { engine, player } = setup();
    player.toggle();
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/a.mp3']));
    player.toggle();
    expect(player.playing()).toBe(false);
  });
});

describe('the queue', () => {
  it('lists the songs in the order they play, and plays one picked from it', async () => {
    const { engine, player } = setup();
    player.playTracks(TRACKS, 1);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));
    expect(ids(player.queued())).toEqual(['a', 'b', 'c']);
    expect(player.queueIndex()).toBe(1);

    player.jumpTo(2);
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/b.mp3', 'file:///music/c.mp3']));
    expect(player.current()?.id).toBe('c');
  });

  it('moves a song without interrupting the one playing, and keeps the move once shuffle is off', async () => {
    const { engine, player } = setup();
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));

    player.moveInQueue(2, 1);
    expect(ids(player.queued())).toEqual(['a', 'c', 'b']);
    player.moveInQueue(0, 2);
    expect(ids(player.queued())).toEqual(['c', 'b', 'a']);
    expect(player.queueIndex()).toBe(2);
    expect(player.current()?.id).toBe('a');
    expect(engine.loaded).toHaveLength(1);

    player.toggleShuffle();
    player.toggleShuffle();
    expect(ids(player.queued())).toEqual(['c', 'b', 'a']);
  });

  it('takes songs out, playing the next one when the one playing goes, and stops once it is empty', async () => {
    const { engine, player } = setup();
    player.playTracks(TRACKS, 1);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));

    player.removeFromQueue(0);
    expect(ids(player.queued())).toEqual(['b', 'c']);
    expect(player.current()?.id).toBe('b');
    expect(engine.loaded).toHaveLength(1);

    player.removeFromQueue(0);
    await waitFor(() => expect(engine.loaded.at(-1)).toBe('file:///music/c.mp3'));
    expect(player.playing()).toBe(true);

    player.removeFromQueue(0);
    expect(player.current()).toBeNull();
    expect(player.queueLength()).toBe(0);
    expect(engine.state().playing).toBe(false);
  });

  it('brings back the queue, the song and the time into it on the next launch, without playing', async () => {
    const first = setup();
    first.player.playTracks(TRACKS, 1, 'library');
    await waitFor(() => expect(first.engine.loaded).toHaveLength(1));
    first.player.next();
    await waitFor(() => expect(first.engine.loaded).toHaveLength(2));
    first.engine.seekTo(42);
    first.player.toggle();
    await waitFor(() => expect(JSON.parse(first.disk.get('player.place') ?? 'null')).toEqual({ position: 2, elapsed: 42 }));

    const { engine, player } = setup(first.disk);
    await waitFor(() => expect(player.current()?.id).toBe('c'));
    expect(ids(player.queued())).toEqual(['a', 'b', 'c']);
    expect(player.source()).toBe('library');
    expect(player.elapsed()).toBe(42);
    expect(engine.loaded).toEqual([]);

    player.toggle();
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/c.mp3']));
    expect(player.playing()).toBe(true);
    expect(player.elapsed()).toBe(42);
  });

  it('leaves out the songs no longer in the library when it brings the queue back', async () => {
    const first = setup();
    first.player.playTracks(TRACKS, 1);
    await waitFor(() => expect(first.engine.loaded).toHaveLength(1));
    first.engine.seekTo(42);
    first.player.toggle();
    await waitFor(() => expect(first.disk.get('player.place')).toContain('42'));

    const { player } = setup(first.disk, [TRACKS[0]!, TRACKS[2]!]);
    await waitFor(() => expect(ids(player.queued())).toEqual(['a', 'c']));
    expect(player.current()?.id).toBe('c');
    expect(player.elapsed()).toBe(0);
  });
});

describe('the behavior settings', () => {
  it('stays paused when skipping while paused, once asked to remember the pause', async () => {
    const { engine, player, behavior } = setup();
    behavior.rememberPause.set(true);
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));
    player.toggle();

    player.next();
    await waitFor(() => expect(engine.loaded).toHaveLength(2));
    expect(player.current()?.id).toBe('b');
    expect(player.playing()).toBe(false);

    player.toggle();
    player.next();
    await waitFor(() => expect(engine.loaded).toHaveLength(3));
    expect(player.playing()).toBe(true);
  });

  it('goes back on "previous" however far into the song, without rewinding first', async () => {
    const { engine, player, behavior } = setup();
    behavior.rewindBeforeSkip.set(false);
    player.playTracks(TRACKS, 1);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));
    engine.seekTo(42);

    player.previous();
    await waitFor(() => expect(player.current()?.id).toBe('a'));
  });

  it('stops at the end of a song on repeat one, and plays it again from the start on play', async () => {
    const { engine, player, behavior } = setup();
    behavior.pauseOnRepeat.set(true);
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));
    player.cycleRepeat();
    player.cycleRepeat();

    engine.finish();
    await settle();
    expect(player.playing()).toBe(false);
    expect(player.current()?.id).toBe('a');

    player.toggle();
    expect(player.playing()).toBe(true);
    expect(player.elapsed()).toBe(0);
    expect(engine.loaded).toHaveLength(1);
  });

  it('turns shuffle off for a new list unless shuffle is to be remembered', async () => {
    const { player, behavior } = setup();
    player.shuffleTracks(TRACKS);
    expect(player.shuffle()).toBe(true);
    player.playTracks(TRACKS, 0);
    expect(player.shuffle()).toBe(true);

    behavior.rememberShuffle.set(false);
    player.playTracks(TRACKS, 0);
    expect(player.shuffle()).toBe(false);
    expect(ids(player.queued())).toEqual(['a', 'b', 'c']);
  });

  it('plays a tapped song from every song in the library when asked, rather than from its list', async () => {
    const { engine, player, behavior } = setup();
    behavior.playFrom.set('all');
    player.playFromList([TRACKS[2]!], 0, 'search');
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/c.mp3']));
    expect(ids(player.queued())).toEqual(['a', 'b', 'c']);
    expect(player.source()).toBe('library');
  });
});

describe('with an engine that reports a new source only after a while, as native does', () => {
  function slowSetup() {
    const engine = fakeEngine();
    const slow = { ...engine, load: (uri: string) => void engine.loaded.push(uri) };
    const player = injectService(Player, {
      providers: [memoryStorage(), engineProvider(slow), { provide: MusicLibrary, useValue: fakeLibrary() }],
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
