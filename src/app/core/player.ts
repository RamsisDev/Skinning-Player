import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { type PlayerState } from '@ng-native/expo/player';
import { AUDIO_ENGINE } from './audio-engine.ts';
import { MusicLibrary } from './music-library.ts';
import { type Track } from './track.ts';

export type RepeatMode = 'off' | 'all' | 'one';

/** Why a track did not play: its file could not be opened, or its audio could not be decoded. */
export type FailureReason = 'unreadable' | 'undecodable';

export interface PlayError {
  readonly track: Track;
  readonly reason: FailureReason;
}

/** What the queue came from: the whole library, a search in it, or a playlist. */
export type QueueSource = 'library' | 'search' | { readonly playlist: string };

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

/** The play queue, its order and the transport controls. */
@Service()
export class Player {
  private readonly engine = inject(AUDIO_ENGINE);
  private readonly library = inject(MusicLibrary);
  private readonly store = inject(Storage);

  readonly shuffle = this.store.signal('player.shuffle', false);
  readonly repeat = this.store.signal<RepeatMode>('player.repeat', 'off');

  private readonly queue = signal<readonly Track[]>([]);
  /** Indexes into `queue`, in the order they play. */
  private readonly order = signal<readonly number[]>([]);
  private readonly position = signal(-1);

  readonly source = signal<QueueSource | null>(null);
  readonly error = signal<PlayError | null>(null);
  private readonly failed = signal<ReadonlyMap<string, FailureReason>>(new Map());
  /** Why each track that failed to play this session did, by track id. Cleared once it plays. */
  readonly failures = this.failed.asReadonly();
  /** The track the engine holds, which is not the current one while it loads or once it failed. */
  private readonly loadedId = signal<string | null>(null);
  /** The engine's state when the track was handed to it: until it reports again, that is the old track's. */
  private readonly stateAtLoad = signal<PlayerState | null>(null);

  readonly current = computed<Track | null>(() => {
    const index = this.order()[this.position()];
    return index === undefined ? null : (this.queue()[index] ?? null);
  });
  private readonly state = this.engine.state;
  private readonly loaded = computed(() => this.loadedId() !== null && this.loadedId() === this.current()?.id);
  /** The engine's state, once it describes the current track. */
  private readonly live = computed(() => {
    const state = this.state();
    return this.loaded() && state !== this.stateAtLoad() ? state : null;
  });
  readonly playing = computed(() => this.live()?.playing ?? false);
  readonly elapsed = computed(() => this.live()?.currentTime ?? 0);
  readonly duration = computed(() => this.live()?.duration || this.current()?.duration || 0);
  readonly progress = computed(() => {
    const duration = this.duration();
    return duration > 0 ? Math.min(1, Math.max(0, this.elapsed() / duration)) : 0;
  });
  readonly queueLength = computed(() => this.queue().length);
  readonly queuePosition = computed(() => this.position() + 1);

  constructor() {
    effect(() => {
      if (this.live()?.ended) untracked(() => this.advanceAfterEnd());
    });
    effect(() => {
      if (this.live()?.status !== 'error') return;
      untracked(() => {
        const track = this.current();
        if (track) this.fail(track, 'undecodable');
      });
    });
  }

  /** Replaces the queue and starts playing it at `startIndex`. */
  playTracks(tracks: readonly Track[], startIndex = 0, source: QueueSource | null = null): void {
    if (!tracks.length) return;
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

  /** Starts a shuffled run of the given tracks, turning shuffle on. */
  shuffleTracks(tracks: readonly Track[], source: QueueSource | null = null): void {
    if (!tracks.length) return;
    this.shuffle.set(true);
    this.playTracks(tracks, Math.floor(Math.random() * tracks.length), source);
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
    if (this.elapsed() > RESTART_THRESHOLD) {
      this.engine.seekTo(0);
      return;
    }
    this.step(-1, true);
  }

  /** Seeks to a fraction (0 to 1) of the current track. */
  seek(fraction: number): void {
    const duration = this.duration();
    if (this.live() && duration > 0) this.engine.seekTo(Math.min(1, Math.max(0, fraction)) * duration);
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

  private advanceAfterEnd(): void {
    if (this.repeat() === 'one') {
      this.engine.seekTo(0);
      this.engine.play();
      return;
    }
    this.step(1, false);
  }

  /**
   * Moves through the order. Pressing next or previous wraps around the ends; running off the end
   * on its own only wraps with repeat on, and otherwise stops there.
   */
  private step(by: 1 | -1, pressed: boolean): void {
    const n = this.order().length;
    if (!n) return;
    let next = this.position() + by;
    if (next < 0 || next >= n) {
      if (!pressed && this.repeat() !== 'all') return;
      next = (next + n) % n;
    }
    this.position.set(next);
    void this.loadCurrent();
  }

  private async loadCurrent(): Promise<void> {
    const track = this.current();
    if (!track) return;
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
    this.engine.load(uri, { title: track.title, artist: track.artist });
    this.stateAtLoad.set(this.state() === before ? before : null);
    this.loadedId.set(track.id);
    if (this.failed().has(track.id)) {
      this.failed.update((failed) => new Map([...failed].filter(([id]) => id !== track.id)));
    }
  }

  /** Stops whatever is still sounding, so a track that cannot play never plays the one before it. */
  private fail(track: Track, reason: FailureReason): void {
    if (this.loadedId() !== null) this.engine.pause();
    this.loadedId.set(null);
    this.error.set({ track, reason });
    this.failed.update((failed) => new Map(failed).set(track.id, reason));
  }
}
