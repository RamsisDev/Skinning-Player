import { InjectionToken, type Signal } from '@angular/core';
import { audioPlayer } from '@ng-native/expo/audio';
import { type PlayerState } from '@ng-native/expo/player';

export interface NowPlayingInfo {
  readonly title: string;
  readonly artist: string;
}

/** The one native player the app plays through. A token, so a test can stand in for it. */
export interface AudioEngine {
  readonly state: Signal<PlayerState>;
  /** Replaces the current source and starts playing it. */
  load(uri: string, info: NowPlayingInfo): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
}

export const AUDIO_ENGINE = new InjectionToken<AudioEngine>('AudioEngine', {
  providedIn: 'root',
  factory: expoAudioEngine,
});

/**
 * `expo-audio`, owned by the root injector so playback outlives every screen. Lock screen controls
 * are what keep Android playing past a few minutes in the background, and they need exclusive
 * audio focus (`doNotMix`).
 */
function expoAudioEngine(): AudioEngine {
  const player = audioPlayer(null, { timeUpdate: 0.5 });
  void import('expo-audio').then(({ setAudioModeAsync }) =>
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }),
  );
  return {
    state: player.state,
    load(uri, info) {
      player.native.replace({ uri });
      player.native.play();
      player.native.setActiveForLockScreen(true, { title: info.title, artist: info.artist || undefined });
    },
    play: () => player.native.play(),
    pause: () => player.native.pause(),
    seekTo: (seconds) => void player.native.seekTo(seconds),
  };
}
