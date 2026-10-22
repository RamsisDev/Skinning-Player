import { type EventSubscription, requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Skinning Audio: the app's own Android player, on Media3's ExoPlayer inside a
 * `MediaLibraryService`. It plays one song and holds the next, so the step between them has no
 * gap; applies ReplayGain; shows the notification and lock screen controls; serves Android Auto's
 * browse tree; and stops when the app is swiped out of recents, when asked to.
 *
 * The queue stays the app's: native only ever knows the song playing and the one after it, and
 * reports what it did so the app can follow.
 */

/** A song to play, with what the notification, the lock screen and Android Auto show for it. */
export interface AudioItem {
  /** The app's id for the song, handed back in `onAdvance`. */
  readonly id: string;
  readonly uri: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  /** A `file://` or `content://` image for the notification and Android Auto. */
  readonly artworkUri?: string;
  /** The ReplayGain adjustment to apply, in dB, pre-amp included; 0 leaves the volume as it is. */
  readonly gainDb: number;
}

export type NativeStatus = 'idle' | 'loading' | 'readyToPlay' | 'error';

/** Sent on every change, and twice a second while playing. */
export interface NativeState {
  readonly playing: boolean;
  readonly status: NativeStatus;
  /** Seconds into the song playing. */
  readonly currentTime: number;
  /** Seconds; 0 until known. */
  readonly duration: number;
  /** Set once the song ran to its end with no next one held, and cleared when it plays again. */
  readonly ended: boolean;
  /** The `id` of the item playing, or null with none. */
  readonly itemId: string | null;
}

/**
 * A node of Android Auto's browse tree: a folder when it has `children`, and a song to play
 * otherwise. Ids are the app's, and come back in `onPlayRequest`.
 */
export interface BrowseNode {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly artworkUri?: string;
  readonly children?: readonly BrowseNode[];
  /**
   * A song's file, optional. With it, Android Auto can play the song (and the songs beside it, in
   * order) when the app's JS is not running to answer `onPlayRequest`; the app's next `load` takes
   * over from there. Without it, such a song only plays through `onPlayRequest`.
   */
  readonly uri?: string;
  /** The ReplayGain for that native playback, in dB, as `AudioItem.gainDb`. */
  readonly gainDb?: number;
}

export interface AudioOptions {
  /** Stops playback and the service when the app's task is swiped out of recents. */
  readonly stopOnTaskRemoved: boolean;
  /** Starts playing when headphones (wired or Bluetooth) connect. Disconnecting always pauses. */
  readonly autoplayOnHeadset: boolean;
}

export interface SkinningAudioEvents {
  onState(state: NativeState): void;
  /** The song held by `setNext` started on its own, with no gap; the next slot is now empty. */
  onAdvance(event: { readonly id: string }): void;
  /** Next or previous, pressed on the notification, the lock screen, a headset or Android Auto. */
  onRemoteCommand(event: { readonly command: 'next' | 'previous' }): void;
  /**
   * Android Auto chose a song in the browse tree, or asked to play from a search or "play".
   * `id` is a browse tree id; it is '' for a plain "play" or playback resumption (resume what the
   * app had). A search sends its words in `query`, with `id` the best match in the tree, or ''.
   * Held until the app listens, so a request made while the app starts is not lost.
   */
  onPlayRequest(event: { readonly id: string; readonly query?: string }): void;
}

export interface SkinningAudioModule {
  /** Replaces what plays, and drops the next song held. Starts it at `startAt` seconds, playing if `play`. */
  load(item: AudioItem, play: boolean, startAt: number): void;
  /** The song to run into, gaplessly, when the current one ends; null for none. */
  setNext(item: AudioItem | null): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  /** Changes the gain of the song playing, as when the ReplayGain settings change. */
  setGain(gainDb: number): void;
  setOptions(options: AudioOptions): void;
  /** Opens the system equalizer or one installed (Wavelet and the like); false if there is none. */
  openEqualizer(): boolean;
  /** Whether an app can open as the equalizer for the player's audio session. */
  hasEqualizer(): boolean;
  /** The roots of Android Auto's browse tree. */
  setBrowseTree(roots: readonly BrowseNode[]): void;
  addListener<K extends keyof SkinningAudioEvents>(event: K, listener: SkinningAudioEvents[K]): EventSubscription;
}

/** The module, or null where it is not built in: iOS, Expo Go and the tests. */
export const SkinningAudio = requireOptionalNativeModule<SkinningAudioModule>('SkinningAudio');
