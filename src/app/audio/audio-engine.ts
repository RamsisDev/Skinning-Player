import { InjectionToken, type Signal, inject, signal } from '@angular/core';
import { audioPlayer } from '@ng-native/expo/audio';
import { type PlayerState } from '@ng-native/expo/player';
// Types only, erased from the build: `skinningAudio` below says how the module itself is reached.
import type { AudioItem, AudioOptions, BrowseNode, NativeState, SkinningAudioModule } from '../../../modules/skinning-audio/index.ts';
import { Features } from './features.ts';
import { volumeOf } from './replay-gain.ts';

export type { AudioItem, AudioOptions, BrowseNode };

/**
 * What an engine can do beyond playing one song at a time, and the platform has not hidden (see
 * `features.ts`). Where `expo-audio` stands in, none of it.
 */
export interface EngineFeatures {
  /** Runs into the song given to `setNext` with no gap. Without it, the next song loads as one ends. */
  readonly gapless: boolean;
  /** Opens an equalizer for its audio. */
  readonly equalizer: boolean;
  /** Honours `stopOnTaskRemoved` in `setOptions`. */
  readonly stopOnTaskRemoved: boolean;
  /** Honours `autoplayOnHeadset` in `setOptions`. */
  readonly autoplayOnHeadset: boolean;
  /** Serves Android Auto the tree given to `setBrowseTree`, and plays what it picks there. */
  readonly browseTree: boolean;
}

export type RemoteCommand = 'next' | 'previous';

/** Stops a listener. */
export type Unsubscribe = () => void;

/** The one native player the app plays through. A token, so a test can stand in for it. */
export interface AudioEngine {
  readonly state: Signal<PlayerState>;
  readonly features: EngineFeatures;
  /** Replaces what plays, and drops the next song held. Starts it `startAt` seconds in, playing unless `play` is false. */
  load(item: AudioItem, play?: boolean, startAt?: number): void;
  /** The song to run into when the current one ends, or null for none. Ignored without `features.gapless`. */
  setNext(item: AudioItem | null): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  /** Changes the gain of the song playing, in dB, as when the ReplayGain settings change. */
  setGain(gainDb: number): void;
  setOptions(options: AudioOptions): void;
  /** Whether there is an equalizer to open, the system's or one installed. */
  hasEqualizer(): boolean;
  /** Opens it; false when there is none. */
  openEqualizer(): boolean;
  setBrowseTree(roots: readonly BrowseNode[]): void;
  /** The song held by `setNext` started on its own: it is the one playing now, and nothing is held. */
  onAdvance(listener: (id: string) => void): Unsubscribe;
  /** Next or previous, pressed on the notification, the lock screen, a headset or Android Auto. */
  onRemoteCommand(listener: (command: RemoteCommand) => void): Unsubscribe;
  /** Android Auto asked to play an id of the browse tree, or to play at all. */
  onPlayRequest(listener: (id: string) => void): Unsubscribe;
}

export const AUDIO_ENGINE = new InjectionToken<AudioEngine>('AudioEngine', {
  providedIn: 'root',
  factory: () => {
    // Never both: expo-audio's own media service would fight the app's over the notification and
    // audio focus. A platform that hides the app's own player never loads its module.
    const features = inject(Features);
    const native = features.on('nativeAudio') ? skinningAudio() : null;
    return native ? nativeAudioEngine(native, features) : expoAudioEngine();
  },
});

/**
 * The app's own Android player, where it is built in. A `require` in a function rather than an
 * import: Node cannot load `expo-modules-core`, and nothing in a test asks for the real engine, so
 * there the call throws and answers null, as iOS and Expo Go answer without the module.
 */
function skinningAudio(): SkinningAudioModule | null {
  try {
    const module = require('../../../modules/skinning-audio/index.ts') as typeof import('../../../modules/skinning-audio/index.ts');
    return module.SkinningAudio;
  } catch {
    return null;
  }
}

/** Listeners of one kind, each told of every event until it stops listening. */
function listeners<T>() {
  const all = new Set<(value: T) => void>();
  return {
    add(listener: (value: T) => void): Unsubscribe {
      all.add(listener);
      return () => void all.delete(listener);
    },
    emit(value: T): void {
      for (const listener of [...all]) listener(value);
    },
  };
}

const IDLE: PlayerState = { playing: false, status: 'idle', currentTime: 0, duration: 0, muted: false, volume: 1, ended: false };

/**
 * Skinning Audio, on Media3: gapless, with ReplayGain applied natively, a media session of its
 * own, and Android Auto, each where the platform has not hidden it. It lives as long as the app,
 * so its listeners are never removed.
 */
function nativeAudioEngine(native: SkinningAudioModule, features: Features): AudioEngine {
  const state = signal<PlayerState>(IDLE);
  const advanced = listeners<string>();
  const commands = listeners<RemoteCommand>();
  const requests = listeners<string>();
  native.addListener('onState', (next: NativeState) =>
    state.set({ ...IDLE, playing: next.playing, status: next.status, currentTime: next.currentTime, duration: next.duration, ended: next.ended }),
  );
  native.addListener('onAdvance', ({ id }) => {
    // The song held starts at its beginning. Until native reports on it, the state is still the
    // one before's, near its end, which would show the new song as almost over.
    state.set({ ...state(), currentTime: 0, duration: 0, ended: false });
    advanced.emit(id);
  });
  native.addListener('onRemoteCommand', ({ command }) => commands.emit(command));
  native.addListener('onPlayRequest', ({ id }) => requests.emit(id));
  return {
    state: state.asReadonly(),
    features: {
      gapless: features.on('gapless'),
      equalizer: features.on('equalizer'),
      stopOnTaskRemoved: features.on('stopOnTaskRemoved'),
      autoplayOnHeadset: features.on('autoplayOnHeadset'),
      browseTree: features.on('androidAuto'),
    },
    load: (item, play = true, startAt = 0) => native.load(item, play, startAt),
    setNext: (item) => native.setNext(item),
    play: () => native.play(),
    pause: () => native.pause(),
    seekTo: (seconds) => native.seekTo(seconds),
    setGain: (gainDb) => native.setGain(gainDb),
    setOptions: (options) => native.setOptions(options),
    hasEqualizer: () => native.hasEqualizer(),
    openEqualizer: () => native.openEqualizer(),
    setBrowseTree: (roots) => native.setBrowseTree(roots),
    onAdvance: advanced.add,
    onRemoteCommand: commands.add,
    onPlayRequest: requests.add,
  };
}

/**
 * `expo-audio`, on iOS and in Expo Go, owned by the root injector so playback outlives every
 * screen. Lock screen controls are what keep Android playing past a few minutes in the
 * background, and they need exclusive audio focus (`doNotMix`). It plays one song at a time, so
 * the next one loads as one ends; ReplayGain is its volume, which can cut but not boost.
 */
function expoAudioEngine(): AudioEngine {
  const player = audioPlayer(null, { timeUpdate: 0.5 });
  void import('expo-audio').then(({ setAudioModeAsync }) =>
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }),
  );
  const none: Unsubscribe = () => {};
  return {
    state: player.state,
    features: { gapless: false, equalizer: false, stopOnTaskRemoved: false, autoplayOnHeadset: false, browseTree: false },
    load(item, play = true, startAt = 0) {
      player.native.replace({ uri: item.uri });
      player.native.volume = volumeOf(item.gainDb);
      if (startAt > 0) void player.native.seekTo(startAt);
      if (play) player.native.play();
      player.native.setActiveForLockScreen(true, { title: item.title, artist: item.artist || undefined });
    },
    setNext: () => {},
    play: () => player.native.play(),
    pause: () => player.native.pause(),
    seekTo: (seconds) => void player.native.seekTo(seconds),
    setGain: (gainDb) => void (player.native.volume = volumeOf(gainDb)),
    setOptions: () => {},
    hasEqualizer: () => false,
    openEqualizer: () => false,
    setBrowseTree: () => {},
    onAdvance: () => none,
    onRemoteCommand: () => none,
    onPlayRequest: () => none,
  };
}
