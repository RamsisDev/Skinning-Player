import { Injector, computed, signal } from '@angular/core';
import { injectService, settle, waitFor } from '@ng-native/testing';
import { describe, expect, it } from 'vitest';
import { TRACKS, engineProvider, fakeEngine, memoryStorage } from '../testing/fakes.ts';
import { type AudioItem } from '../audio/audio-engine.ts';
import { BehaviorSettings } from '../settings/behavior-settings.ts';
import { albumKey } from '../library/library-filter.ts';
import { MusicLibrary } from '../library/music-library.ts';
import { Player, shuffledOrder } from './player.ts';
import { type Track, trackFromFile } from '../library/track.ts';

const fileOf = async (track: Track) => `file:///music/${track.id}.mp3`;

/** A library already read, holding `tracks`, whose files `uriOf` finds. */
function fakeLibrary(tracks: readonly Track[] = TRACKS, uriOf: (track: Track) => Promise<string> = fileOf) {
  const all = signal(tracks);
  return {
    tracks: all,
    status: signal('ready'),
    byId: computed(() => new Map(all().map((track) => [track.id, track]))),
    uriOf,
  };
}

/** A player over `disk`, the device's storage, which a second setup over the same disk reads back as a relaunch would. */
function setup(disk = new Map<string, string>(), tracks: readonly Track[] = TRACKS, engine = fakeEngine(), uriOf = fileOf) {
  const injector = injectService(Injector, {
    providers: [memoryStorage(disk), engineProvider(engine), { provide: MusicLibrary, useValue: fakeLibrary(tracks, uriOf) }],
  });
  return { engine, disk, player: injector.get(Player), behavior: injector.get(BehaviorSettings) };
}

const ids = (tracks: readonly Track[]) => tracks.map((track) => track.id);
/** The id of the song the engine holds to run into, or null. */
const heldId = (engine: ReturnType<typeof fakeEngine>) => engine.next?.id ?? null;

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
    const slow = { ...engine, load: (item: AudioItem) => void engine.loaded.push(item.uri) };
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

describe('with an engine that plays gaplessly, as Skinning Audio does', () => {
  const gapless = (options: { disk?: Map<string, string>; tracks?: readonly Track[]; uriOf?: (track: Track) => Promise<string> } = {}) =>
    setup(options.disk, options.tracks, fakeEngine({ gapless: true }), options.uriOf);

  it('holds the next song, and moves on to it at the end of the song without loading it', async () => {
    const { engine, player, disk } = gapless();
    player.playTracks(TRACKS, 0, 'library');
    await waitFor(() => expect(heldId(engine)).toBe('b'));
    expect(engine.next?.uri).toBe('file:///music/b.mp3');

    engine.finish();
    await waitFor(() => expect(player.current()?.id).toBe('b'));
    expect(engine.loaded).toEqual(['file:///music/a.mp3']);
    expect(player.playing()).toBe(true);
    expect(player.elapsed()).toBe(0);
    expect(player.queuePosition()).toBe(2);
    await waitFor(() => expect(JSON.parse(disk.get('player.place') ?? 'null')).toEqual({ position: 1, elapsed: 0 }));
    await waitFor(() => expect(heldId(engine)).toBe('c'));
  });

  it('holds nothing at the end of the queue, and stops there', async () => {
    const { engine, player } = gapless();
    player.playTracks(TRACKS, 1);
    await waitFor(() => expect(heldId(engine)).toBe('c'));
    engine.advance();
    await settle();
    expect(player.current()?.id).toBe('c');
    expect(engine.next).toBeNull();

    engine.finish();
    await settle();
    expect(player.current()?.id).toBe('c');
    expect(player.playing()).toBe(false);
    expect(engine.loaded).toHaveLength(1);
  });

  it('holds the first song at the end with repeat all, the same one with repeat one, and none with pause on repeat', async () => {
    const { engine, player, behavior } = gapless();
    player.playTracks(TRACKS, 2);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));
    expect(engine.next).toBeNull();

    player.cycleRepeat();
    await waitFor(() => expect(heldId(engine)).toBe('a'));
    player.cycleRepeat();
    await waitFor(() => expect(heldId(engine)).toBe('c'));
    engine.advance();
    await settle();
    expect(player.current()?.id).toBe('c');
    expect(player.playing()).toBe(true);
    // Running into it empties the slot, so the song is held again for the next time round.
    await waitFor(() => expect(heldId(engine)).toBe('c'));

    behavior.pauseOnRepeat.set(true);
    await waitFor(() => expect(engine.next).toBeNull());
  });

  it('holds the song after the current one in the shuffled order, and again once shuffle is off', async () => {
    const { engine, player } = gapless();
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(heldId(engine)).toBe('b'));

    player.toggleShuffle();
    await waitFor(() => expect(heldId(engine)).toBe(player.queued()[1]!.id));
    engine.advance();
    await settle();
    expect(player.current()?.id).toBe(player.queued()[1]!.id);

    player.toggleShuffle();
    const after = player.queued()[player.queueIndex() + 1];
    await waitFor(() => expect(heldId(engine)).toBe(after?.id ?? null));
  });

  it('holds what the queue puts next as it is edited', async () => {
    const { engine, player } = gapless();
    const [a, b, c] = TRACKS;
    player.playTracks([a!, b!], 0);
    await waitFor(() => expect(heldId(engine)).toBe('b'));

    player.playNext([c!]);
    await waitFor(() => expect(heldId(engine)).toBe('c'));
    player.moveInQueue(2, 1);
    await waitFor(() => expect(heldId(engine)).toBe('b'));
    player.removeFromQueue(1);
    await waitFor(() => expect(heldId(engine)).toBe('c'));
    player.removeFromQueue(1);
    await waitFor(() => expect(engine.next).toBeNull());
    expect(engine.loaded).toHaveLength(1);
  });

  it('plays the song that does come next when the engine runs into one the queue has moved past', async () => {
    const { engine, player } = gapless();
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(heldId(engine)).toBe('b'));

    // The song ends before the slot catches up with the move.
    player.moveInQueue(1, 2);
    engine.advance();
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/a.mp3', 'file:///music/c.mp3']));
    expect(player.current()?.id).toBe('c');
  });

  it('plays the song again when repeat one is turned on just before the engine runs into the next', async () => {
    const { engine, player } = gapless();
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(heldId(engine)).toBe('b'));

    player.cycleRepeat();
    player.cycleRepeat();
    engine.advance();
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/a.mp3', 'file:///music/a.mp3']));
    expect(player.current()?.id).toBe('a');
    expect(player.playing()).toBe(true);
  });

  it('never holds a song whose file was found only after another took its place', async () => {
    let release = () => {};
    const slow = new Promise<void>((resolve) => (release = resolve));
    const uriOf = async (track: Track) => {
      if (track.id === 'b') await slow;
      return fileOf(track);
    };
    const { engine, player } = gapless({ uriOf });
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));
    await settle();
    expect(engine.next).toBeNull();

    player.playNext([TRACKS[2]!]);
    await waitFor(() => expect(heldId(engine)).toBe('c'));
    release();
    await settle();
    expect(heldId(engine)).toBe('c');
  });

  it('holds nothing when the next file cannot be found, and fails it as the song ends', async () => {
    const uriOf = async (track: Track) => {
      if (track.id === 'b') throw new Error('gone');
      return fileOf(track);
    };
    const { engine, player } = gapless({ uriOf });
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));
    await settle();
    expect(engine.next).toBeNull();

    engine.finish();
    await waitFor(() => expect(player.failures().get('b')).toBe('unreadable'));
    expect(player.current()?.id).toBe('b');
  });

  it('skips on next and previous pressed outside the app', async () => {
    const { engine, player } = gapless();
    player.playTracks(TRACKS, 0);
    await waitFor(() => expect(engine.loaded).toHaveLength(1));

    engine.remote('next');
    await waitFor(() => expect(engine.loaded.at(-1)).toBe('file:///music/b.mp3'));
    engine.remote('previous');
    await waitFor(() => expect(engine.loaded.at(-1)).toBe('file:///music/a.mp3'));
    expect(player.current()?.id).toBe('a');
  });
});

describe('ReplayGain', () => {
  const tagged = (id: string, gain: Track['replayGain']): Track => ({ ...trackFromFile(id, `${id}.mp3`, 100), album: 'Same Album', replayGain: gain });
  const tracks = [tagged('a', { track: -6, album: -9 }), tagged('b', { track: -3 }), trackFromFile('c', 'c.mp3', 100)];

  it("plays a song at its own gain, and at its album's while its album is what plays", async () => {
    const { engine, player } = setup(undefined, tracks, fakeEngine({ gapless: true }));
    player.playTracks(tracks, 0, 'library');
    await waitFor(() => expect(engine.item?.gainDb).toBe(-6));
    await waitFor(() => expect(engine.next?.gainDb).toBe(-3));

    player.playTracks(tracks, 0, { facet: 'album', key: albumKey(tracks[0]!), name: 'Same Album' });
    await waitFor(() => expect(engine.item?.gainDb).toBe(-9));
    // A song with no album gain falls back to its own.
    await waitFor(() => expect(engine.next?.gainDb).toBe(-3));
  });

  it('applies a change of settings to the song playing and the one held, untagged files at their own pre-amp', async () => {
    const { engine, player, behavior } = setup(undefined, tracks, fakeEngine({ gapless: true }));
    player.playTracks(tracks, 1);
    await waitFor(() => expect(heldId(engine)).toBe('c'));
    expect(engine.next?.gainDb).toBe(0);

    behavior.preAmpTagged.set(2);
    behavior.preAmpUntagged.set(-6);
    await waitFor(() => expect(engine.gains.at(-1)).toBe(-1));
    await waitFor(() => expect(engine.next?.gainDb).toBe(-6));

    behavior.replayGain.set('off');
    await waitFor(() => expect(engine.gains.at(-1)).toBe(0));
    await waitFor(() => expect(engine.next?.gainDb).toBe(0));
  });

  it('does not set the gain again when nothing about it changed', async () => {
    const { engine, player, behavior } = setup(undefined, tracks);
    player.playTracks(tracks, 0);
    await waitFor(() => expect(engine.item?.gainDb).toBe(-6));
    behavior.rememberPause.set(true);
    await settle();
    expect(engine.gains).toEqual([]);
  });
});

it('hands the engine the options for leaving recents and connecting headphones as they change', async () => {
  const { engine, behavior } = setup();
  await waitFor(() => expect(engine.options).toEqual({ stopOnTaskRemoved: false, autoplayOnHeadset: false }));
  behavior.stopOnTaskRemoved.set(true);
  behavior.autoplayOnHeadset.set(true);
  await waitFor(() => expect(engine.options).toEqual({ stopOnTaskRemoved: true, autoplayOnHeadset: true }));
});

it('shuffles every index exactly once, leading with the one asked for', () => {
  const order = shuffledOrder(10, 7);
  expect(order[0]).toBe(7);
  expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
