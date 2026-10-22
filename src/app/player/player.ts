import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { AppState } from '@ng-native/device';
import { Storage } from '@ng-native/expo/async-storage';
import { type PlayerState } from '@ng-native/expo/player';
import { AUDIO_ENGINE, type AudioItem } from '../audio/audio-engine.ts';
import { BehaviorSettings } from '../settings/behavior-settings.ts';
import { CatalogService, songsOf } from '../catalog/catalog.ts';
import { Covers } from '../library/covers.ts';
import { Features } from '../audio/features.ts';
import { type Facet, albumKey, entriesOf } from '../library/library-filter.ts';
import { LibrarySettings } from '../library/library-settings.ts';
import { MusicLibrary } from '../library/music-library.ts';
import { replayGainDb } from '../audio/replay-gain.ts';
import { type Track } from '../library/track.ts';

export type RepeatMode = 'off' | 'all' | 'one';

/** Why a track did not play: its file could not be opened, or its audio could not be decoded. */
export type FailureReason = 'unreadable' | 'undecodable';

export interface PlayError {
  readonly track: Track;
  readonly reason: FailureReason;
}

/** What the queue came from: the whole library, a search in it, a playlist, or an album, artist or genre. */
export type QueueSource =
  | 'library'
  | 'search'
  | { readonly playlist: string }
  | { readonly facet: Facet; readonly key: string; readonly name: string };

/** The queue as it is kept between launches: its songs by id, the order they play in, and where it came from. */
interface SavedQueue {
  readonly ids: readonly string[];
  readonly order: readonly number[];
  readonly source: QueueSource | null;
}

/** Where in the queue playback was: its place in the order, and the seconds into that song. */
interface SavedPlace {
  readonly position: number;
  readonly elapsed: number;
}

/** A song in the queue: its place in the order, and the song. */
interface Placed {
  readonly position: number;
  readonly track: Track;
}

/** The song the engine holds to run into once the current one ends, and the gain it was given. */
interface Held {
  readonly id: string;
  readonly position: number;
  readonly gain: number;
}

/** Past this many seconds into a track, "previous" restarts it instead of going back. */
const RESTART_THRESHOLD = 3;

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Every index once, in random order, with `first` leading. */
export function shuffledOrder(n: number, first: number, random: () => number = Math.random): number[] {
  const rest = range(n).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 && first < n ? [first, ...rest] : rest;
}

/**
 * The play queue, its order and the transport controls. The queue, the song playing and how far
 * into it are kept on the device, and come back once the library is read on the next launch.
 *
 * On an engine that plays gaplessly, the song after the current one is handed over ahead of time,
 * and kept up to date as the queue, the order and repeat change; the engine runs into it and says
 * so, and the queue follows. On one that does not, the next song loads as the current one ends.
 */
@Service()
export class Player {
  private readonly engine = inject(AUDIO_ENGINE);
  private readonly library = inject(MusicLibrary);
  private readonly catalog = inject(CatalogService).catalog;
  private readonly librarySettings = inject(LibrarySettings);
  private readonly behavior = inject(BehaviorSettings);
  private readonly covers = inject(Covers);
  private readonly replayGain = inject(Features).on('replayGain');
  private readonly appState = inject(AppState);
  private readonly store = inject(Storage);

  readonly shuffle = this.store.signal('player.shuffle', false);
  readonly repeat = this.store.signal<RepeatMode>('player.repeat', 'off');
  private readonly savedQueue = this.store.signal<SavedQueue | null>('player.queue', null);
  private readonly savedPlace = this.store.signal<SavedPlace | null>('player.place', null);
  /** Whether the saved queue has been brought back, or found to be none: until then nothing is saved over it. */
  private readonly restored = signal(false);

  private readonly queue = signal<readonly Track[]>([]);
  /** Indexes into `queue`, in the order they play. */
  private readonly order = signal<readonly number[]>([]);
  private readonly position = signal(-1);
  /** Where to start a song not loaded yet, as the one a launch brought back. */
  private readonly resume = signal<{ readonly id: string; readonly at: number } | null>(null);

  readonly source = signal<QueueSource | null>(null);
  readonly error = signal<PlayError | null>(null);
  private readonly failed = signal<ReadonlyMap<string, FailureReason>>(new Map());
  /** Why each track that failed to play this session did, by track id. Cleared once it plays. */
  readonly failures = this.failed.asReadonly();
  /** The track the engine holds, which is not the current one while it loads or once it failed. */
  private readonly loadedId = signal<string | null>(null);
  /** The engine's state when the track was handed to it: until it reports again, that is the old track's. */
  private readonly stateAtLoad = signal<PlayerState | null>(null);
  /** Counts the songs the engine started, each of which empties its next slot. */
  private readonly starts = signal(0);
  /** What the engine holds to run into, or null for nothing. */
  private held: Held | null = null;
  /** Counts the requests to hold a song, so the answer to one overtaken by another is dropped. */
  private holdRequest = 0;
  /** The gain the song playing was given, so a change of settings that leaves it alone is not sent. */
  private appliedGain: number | null = null;

  readonly current = computed<Track | null>(() => {
    const index = this.order()[this.position()];
    return index === undefined ? null : (this.queue()[index] ?? null);
  });
  private readonly state = this.engine.state;
  private readonly loaded = computed(() => this.loadedId() !== null && this.loadedId() === this.current()?.id);
  /**
   * Where the end of the current song leads on its own, as `advanceAfterEnd` takes it: the next
   * song, the first again with repeat all, the same one with repeat one; or nowhere at the end of
   * the queue, and with "pause on repeat".
   */
  private readonly upcoming = computed<Placed | null>(
    () => {
      const order = this.order();
      const position = this.position();
      if (position < 0 || position >= order.length) return null;
      let next = position;
      if (this.repeat() === 'one') {
        if (this.behavior.pauseOnRepeat()) return null;
      } else if (++next >= order.length) {
        if (this.repeat() !== 'all') return null;
        next = 0;
      }
      const track = this.queue()[order[next]!];
      return track ? { position: next, track } : null;
    },
    { equal: (a, b) => a === b || (!!a && !!b && a.position === b.position && a.track === b.track) },
  );
  /** The engine's state, once it describes the current track. */
  private readonly live = computed(() => {
    const state = this.state();
    return this.loaded() && state !== this.stateAtLoad() ? state : null;
  });
  readonly playing = computed(() => this.live()?.playing ?? false);
  readonly elapsed = computed(() => {
    const live = this.live();
    if (live) return live.currentTime;
    const resume = this.resume();
    return resume && resume.id === this.current()?.id ? resume.at : 0;
  });
  readonly duration = computed(() => this.live()?.duration || this.current()?.duration || 0);
  readonly progress = computed(() => {
    const duration = this.duration();
    return duration > 0 ? Math.min(1, Math.max(0, this.elapsed() / duration)) : 0;
  });
  /** The queue in the order it plays. */
  readonly queued = computed<readonly Track[]>(() => {
    const queue = this.queue();
    return this.order().map((index) => queue[index]!);
  });
  /** The current track's place in `queued`, or -1 with nothing queued. */
  readonly queueIndex = this.position.asReadonly();
  readonly queueLength = computed(() => this.queue().length);
  readonly queuePosition = computed(() => this.position() + 1);

  constructor() {
    effect(() => {
      if (this.live()?.ended) untracked(() => this.advanceAfterEnd());
    });
    // The next slot follows the song after the current one, and is filled again once the engine
    // empties it by starting a song.
    effect(() => {
      if (!this.engine.features.gapless) return;
      this.starts();
      const next = this.loaded() ? this.upcoming() : null;
      const gain = next ? this.gainOf(next.track) : 0;
      untracked(() => void this.holdNext(next, gain));
    });
    // A change to the ReplayGain settings, or to what the queue came from, reaches the song playing.
    effect(() => {
      const track = this.current();
      if (!track || !this.loaded()) return;
      const gain = this.gainOf(track);
      untracked(() => {
        if (gain === this.appliedGain) return;
        this.appliedGain = gain;
        this.engine.setGain(gain);
      });
    });
    // A setting the platform hides stays off, whatever was kept for it.
    effect(() => {
      const { features } = this.engine;
      const options = {
        stopOnTaskRemoved: features.stopOnTaskRemoved && this.behavior.stopOnTaskRemoved(),
        autoplayOnHeadset: features.autoplayOnHeadset && this.behavior.autoplayOnHeadset(),
      };
      untracked(() => this.engine.setOptions(options));
    });
    const stops = [
      this.engine.onAdvance((id) => this.advanced(id)),
      this.engine.onRemoteCommand((command) => (command === 'next' ? this.next() : this.previous())),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
    effect(() => {
      if (this.live()?.status !== 'error') return;
      untracked(() => {
        const track = this.current();
        if (track) this.fail(track, 'undecodable');
      });
    });

    // The queue comes back once the stored one is read and the library knows its songs.
    effect(() => {
      if (this.restored() || !this.store.ready() || this.library.status() !== 'ready') return;
      untracked(() => this.restore());
    });
    effect(() => {
      if (!this.restored()) return;
      const queue = this.queue();
      const order = this.order();
      const source = this.source();
      untracked(() => this.savedQueue.set(queue.length ? { ids: queue.map((track) => track.id), order: [...order], source } : null));
    });
    // The place is kept as the song changes, and the time into it on a pause and on leaving the app.
    effect(() => {
      if (!this.restored()) return;
      this.position();
      this.playing();
      this.appState.active();
      untracked(() => this.savePlace());
    });
  }

  /** Replaces the queue and starts playing it at `startIndex`; turns shuffle off unless it is to be remembered. */
  playTracks(tracks: readonly Track[], startIndex = 0, source: QueueSource | null = null): void {
    if (!tracks.length) return;
    if (!this.behavior.rememberShuffle()) this.shuffle.set(false);
    this.start(tracks, startIndex, source);
  }

  /** Starts a shuffled run of the given tracks, turning shuffle on. */
  shuffleTracks(tracks: readonly Track[], source: QueueSource | null = null): void {
    if (!tracks.length) return;
    this.shuffle.set(true);
    this.start(tracks, Math.floor(Math.random() * tracks.length), source);
  }

  /**
   * Plays a song tapped in a list as the user chose: from that list, from every song, or from its
   * album, artist or genre, in the order their screens list them. A song with no album, artist or
   * genre to play from plays from the list.
   */
  playFromList(list: readonly Track[], index: number, source: QueueSource | null = null): void {
    const track = list[index];
    if (!track) return;
    const from = this.behavior.playFrom();
    if (from === 'all') {
      const all = this.library.tracks();
      this.playTracks(all, Math.max(0, all.indexOf(track)), 'library');
      return;
    }
    if (from !== 'list') {
      const entry = entriesOf(track, from)[0];
      const settings = this.librarySettings;
      const group = entry && songsOf(this.catalog(), from, entry.key, settings.sortOf('album'), settings.smartSort());
      if (entry && group) {
        this.playTracks(group.songs, Math.max(0, group.songs.indexOf(track)), { facet: from, key: entry.key, name: group.name });
        return;
      }
    }
    this.playTracks(list, index, source);
  }

  private start(tracks: readonly Track[], startIndex: number, source: QueueSource | null): void {
    const start = Math.min(Math.max(0, startIndex), tracks.length - 1);
    this.queue.set(tracks);
    this.source.set(source);
    if (this.shuffle()) {
      this.order.set(shuffledOrder(tracks.length, start));
      this.position.set(0);
    } else {
      this.order.set(range(tracks.length));
      this.position.set(start);
    }
    void this.loadCurrent();
  }

  /** Puts tracks right after the one playing, in their order. With nothing playing, plays them. */
  playNext(tracks: readonly Track[]): void {
    this.enqueue(tracks, true);
  }

  /** Puts tracks at the end of the queue. With nothing playing, plays them. */
  addToQueue(tracks: readonly Track[]): void {
    this.enqueue(tracks, false);
  }

  /**
   * Adds to the queue without touching the track playing. Tracks to play next also go right after
   * it in the queue itself, so they are still next once shuffle is turned off.
   */
  private enqueue(tracks: readonly Track[], next: boolean): void {
    if (!tracks.length) return;
    if (!this.current()) {
      this.playTracks(tracks);
      return;
    }
    const queue = this.queue();
    const order = this.order();
    const position = this.position();
    const at = next ? order[position] + 1 : queue.length;
    const added = range(tracks.length).map((i) => at + i);
    const shifted = order.map((i) => (i >= at ? i + tracks.length : i));
    const where = next ? position + 1 : shifted.length;
    this.queue.set([...queue.slice(0, at), ...tracks, ...queue.slice(at)]);
    this.order.set([...shifted.slice(0, where), ...added, ...shifted.slice(where)]);
  }

  /** Plays the song at `at` in `queued`. */
  jumpTo(at: number): void {
    if (at < 0 || at >= this.order().length) return;
    this.position.set(at);
    void this.loadCurrent();
  }

  /**
   * Moves the song at `from` in `queued` to `to`, the song playing going on as it was. Unshuffled,
   * the queue itself changes, so the move outlasts turning shuffle on and off.
   */
  moveInQueue(from: number, to: number): void {
    const order = [...this.order()];
    if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved!);
    if (this.shuffle()) {
      this.order.set(order);
    } else {
      const queue = this.queue();
      this.queue.set(order.map((index) => queue[index]!));
      this.order.set(range(order.length));
    }
    const position = this.position();
    if (from === position) this.position.set(to);
    else if (from < position && to >= position) this.position.set(position - 1);
    else if (from > position && to <= position) this.position.set(position + 1);
  }

  /** Takes the song at `at` in `queued` out of the queue. Taking out the one playing plays the one after it. */
  removeFromQueue(at: number): void {
    const order = this.order();
    const index = order[at];
    if (index === undefined) return;
    if (order.length === 1) {
      this.clear();
      return;
    }
    const position = this.position();
    const wasPlaying = this.playing();
    this.queue.update((queue) => queue.filter((_, i) => i !== index));
    this.order.set(order.filter((_, i) => i !== at).map((i) => (i > index ? i - 1 : i)));
    if (at < position) {
      this.position.set(position - 1);
    } else if (at === position) {
      this.position.set(Math.min(at, order.length - 2));
      void this.loadCurrent(!this.behavior.rememberPause() || wasPlaying);
    }
  }

  /** Empties the queue and stops. */
  clear(): void {
    if (this.loadedId() !== null) this.engine.pause();
    this.loadedId.set(null);
    this.resume.set(null);
    this.queue.set([]);
    this.order.set([]);
    this.position.set(-1);
    this.source.set(null);
  }

  toggle(): void {
    if (!this.current()) {
      this.playTracks(this.library.tracks(), 0, 'library');
      return;
    }
    if (this.playing()) {
      this.engine.pause();
      return;
    }
    if (!this.loaded()) {
      void this.loadCurrent();
      return;
    }
    if (this.live()?.ended) this.engine.seekTo(0);
    this.engine.play();
  }

  next(): void {
    this.step(1, true);
  }

  previous(): void {
    if (this.behavior.rewindBeforeSkip() && this.elapsed() > RESTART_THRESHOLD) {
      if (this.loaded()) this.engine.seekTo(0);
      else this.resume.set(null);
      return;
    }
    this.step(-1, true);
  }

  /** Seeks to a fraction (0 to 1) of the current track; one not loaded yet starts there. */
  seek(fraction: number): void {
    const duration = this.duration();
    const track = this.current();
    if (!track || duration <= 0) return;
    const at = Math.min(1, Math.max(0, fraction)) * duration;
    if (this.live()) this.engine.seekTo(at);
    else if (!this.loaded()) this.resume.set({ id: track.id, at });
  }

  /** Reshuffles or restores the order around the track that is playing, which keeps playing. */
  toggleShuffle(): void {
    const on = !this.shuffle();
    this.shuffle.set(on);
    const n = this.queue().length;
    if (!n) return;
    const playing = this.order()[this.position()] ?? 0;
    this.order.set(on ? shuffledOrder(n, playing) : range(n));
    this.position.set(on ? 0 : playing);
  }

  cycleRepeat(): void {
    const next: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
    this.repeat.set(next[this.repeat()]);
  }

  /** With repeat one the song plays again, or with "pause on repeat" stays at its end until play is pressed. */
  private advanceAfterEnd(): void {
    if (this.repeat() === 'one') {
      if (this.behavior.pauseOnRepeat()) return;
      this.engine.seekTo(0);
      this.engine.play();
      return;
    }
    this.step(1, false);
  }

  /**
   * Moves through the order. Pressing next or previous wraps around the ends; running off the end
   * on its own only wraps with repeat on, and otherwise stops there. A press while paused stays
   * paused when the user asked for that.
   */
  private step(by: 1 | -1, pressed: boolean): void {
    const n = this.order().length;
    if (!n) return;
    let next = this.position() + by;
    if (next < 0 || next >= n) {
      if (!pressed && this.repeat() !== 'all') return;
      next = (next + n) % n;
    }
    const play = !pressed || !this.behavior.rememberPause() || this.playing();
    this.position.set(next);
    void this.loadCurrent(play);
  }

  private async loadCurrent(play = true): Promise<void> {
    const track = this.current();
    if (!track) return;
    const resume = this.resume();
    this.resume.set(null);
    this.error.set(null);
    let uri: string;
    try {
      uri = await this.library.uriOf(track);
    } catch {
      if (this.current() === track) this.fail(track, 'unreadable');
      return;
    }
    if (this.current() !== track) return;
    const before = this.state();
    const gain = this.gainOf(track);
    // Loading drops the song held, and the answer to a request to hold one is for the song before.
    this.held = null;
    this.holdRequest++;
    this.engine.load(this.itemOf(track, uri, gain), play, resume?.id === track.id ? resume.at : 0);
    this.appliedGain = gain;
    this.stateAtLoad.set(this.state() === before ? before : null);
    this.started(track);
  }

  /** The engine holds `track` now: the song it was given, or the one it ran into. */
  private started(track: Track): void {
    this.loadedId.set(track.id);
    this.starts.update((n) => n + 1);
    if (this.failed().has(track.id)) {
      this.failed.update((failed) => new Map([...failed].filter(([id]) => id !== track.id)));
    }
  }

  /**
   * The engine ran into the song it held. The queue moves on to it as an end of song would, with
   * nothing to load. The song can be one the queue has moved past, when the song ended before the
   * slot caught up with a change to the queue or to repeat: then what does come next plays
   * instead, or with nothing next the song that ended waits at its start, as at the end of a queue.
   */
  private advanced(id: string): void {
    const held = this.held;
    this.held = null;
    this.holdRequest++;
    // A song loading in its place replaces it anyway.
    if (!this.loaded()) return;
    const next = this.upcoming();
    if (!held || !next || held.id !== id || next.track.id !== id || next.position !== held.position) {
      if (next) this.position.set(next.position);
      void this.loadCurrent(!!next);
      return;
    }
    this.position.set(next.position);
    this.resume.set(null);
    this.error.set(null);
    // The engine's state is the new song's from here on: see `nativeAudioEngine`.
    this.stateAtLoad.set(null);
    this.appliedGain = held.gain;
    this.started(next.track);
  }

  /** Hands the engine the song to run into, once its file is found; or empties its next slot. */
  private async holdNext(next: Placed | null, gain: number): Promise<void> {
    const request = ++this.holdRequest;
    const held = this.held;
    if (!next) {
      if (!held) return;
      this.held = null;
      this.engine.setNext(null);
      return;
    }
    if (held && held.id === next.track.id && held.position === next.position && held.gain === gain) return;
    let uri: string;
    try {
      uri = await this.library.uriOf(next.track);
    } catch {
      // With nothing held the song ends, and the next one fails to load, as without gapless.
      if (request === this.holdRequest && this.held) {
        this.held = null;
        this.engine.setNext(null);
      }
      return;
    }
    if (request !== this.holdRequest) return;
    this.held = { id: next.track.id, position: next.position, gain };
    this.engine.setNext(this.itemOf(next.track, uri, gain));
  }

  /** What the engine plays a track as, with what the notification shows for it. */
  private itemOf(track: Track, uri: string, gainDb: number): AudioItem {
    const artworkUri = this.covers.uriOf(track.id);
    return { id: track.id, uri, title: track.title, artist: track.artist, album: track.album, gainDb, ...(artworkUri ? { artworkUri } : {}) };
  }

  /** The ReplayGain to play a track at. It plays from its album when the queue came from that album. */
  private gainOf(track: Track): number {
    if (!this.replayGain) return 0;
    const source = this.source();
    const playingAlbum = typeof source === 'object' && source !== null && 'facet' in source && source.facet === 'album' && source.key === albumKey(track);
    return replayGainDb(track.replayGain, this.behavior.replayGainSettings(), playingAlbum);
  }

  /** Stops whatever is still sounding, so a track that cannot play never plays the one before it. */
  private fail(track: Track, reason: FailureReason): void {
    if (this.loadedId() !== null) this.engine.pause();
    this.loadedId.set(null);
    this.error.set({ track, reason });
    this.failed.update((failed) => new Map(failed).set(track.id, reason));
  }

  /**
   * Brings back the queue kept from the last launch, without playing it: the songs no longer in
   * the library are left out, and the song that was playing starts where it was left once played.
   */
  private restore(): void {
    this.restored.set(true);
    const saved = this.savedQueue();
    if (!saved || this.queue().length) return;
    const byId = this.library.byId();
    const tracks: Track[] = [];
    const moved = saved.ids.map((id) => {
      const track = byId.get(id);
      return track ? tracks.push(track) - 1 : -1;
    });
    if (!tracks.length) return;
    let order = saved.order.flatMap((index) => (moved[index] ?? -1) >= 0 ? [moved[index]!] : []);
    if (order.length !== tracks.length || new Set(order).size !== order.length) order = range(tracks.length);
    const place = this.savedPlace();
    const was = saved.order[place?.position ?? 0];
    const kept = was !== undefined && (moved[was] ?? -1) >= 0;
    const position = kept ? order.indexOf(moved[was]!) : Math.min(Math.max(0, place?.position ?? 0), order.length - 1);
    this.queue.set(tracks);
    this.order.set(order);
    this.position.set(position);
    this.source.set(saved.source);
    const track = tracks[order[position]!]!;
    if (kept && place && place.elapsed > 0) this.resume.set({ id: track.id, at: place.elapsed });
  }

  private savePlace(): void {
    const position = this.position();
    this.savedPlace.set(position < 0 ? null : { position, elapsed: Math.floor(this.elapsed()) });
  }
}
