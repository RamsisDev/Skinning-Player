import { InjectionToken, Service, inject } from '@angular/core';

/** What the app can do without on a platform. */
export const FEATURES = [
  /** Skinning Audio, the app's own player on Media3; without it the app plays through `expo-audio`. */
  'nativeAudio',
  /** Running from one song into the next with no gap. */
  'gapless',
  /** ReplayGain: its settings, and the gain applied to each song. */
  'replayGain',
  /** The button that opens the system's equalizer, or one installed. */
  'equalizer',
  /** The setting that stops playback when the app is swiped out of recents. */
  'stopOnTaskRemoved',
  /** The setting that plays when headphones connect. */
  'autoplayOnHeadset',
  /** Android Auto's browse tree, kept in step with the library. */
  'androidAuto',
  /** Dragging songs in the queue by a handle; without it each has buttons to move it up and down. */
  'queueDrag',
] as const;
export type Feature = (typeof FEATURES)[number];

export type DevicePlatform = 'ios' | 'android';

/**
 * The features each platform goes without. A feature listed is not shown there, and what it
 * needs is not loaded: no native module, no service, no gesture. The one place to change it.
 */
export const HIDDEN_FEATURES: Readonly<Record<DevicePlatform, readonly Feature[]>> = {
  // iOS plays through expo-audio: Skinning Audio is Android's only, and so is all that needs it.
  ios: ['nativeAudio', 'gapless', 'equalizer', 'stopOnTaskRemoved', 'autoplayOnHeadset', 'androidAuto'],
  android: [],
};

/** What a feature needs on as well: everything the app's own player does goes with it. */
const NEEDS: Partial<Record<Feature, Feature>> = {
  gapless: 'nativeAudio',
  equalizer: 'nativeAudio',
  stopOnTaskRemoved: 'nativeAudio',
  autoplayOnHeadset: 'nativeAudio',
  androidAuto: 'nativeAudio',
};

/** The platform the app runs on. A token, so a test can say which. */
export const DEVICE_PLATFORM = new InjectionToken<DevicePlatform>('DevicePlatform', {
  providedIn: 'root',
  factory: devicePlatform,
});

/** The features hidden on each platform: `HIDDEN_FEATURES`, unless a test gives others. */
export const HIDDEN = new InjectionToken<Readonly<Record<DevicePlatform, readonly Feature[]>>>('HiddenFeatures', {
  providedIn: 'root',
  factory: () => HIDDEN_FEATURES,
});

/**
 * React Native's own answer. A `require` in a function, as in `audio-engine.ts`: Node cannot load
 * `react-native`, and there the tests run as Android, with everything on.
 */
function devicePlatform(): DevicePlatform {
  try {
    const { Platform } = require('react-native') as typeof import('react-native');
    return Platform.OS === 'ios' ? 'ios' : 'android';
  } catch {
    return 'android';
  }
}

/** Which features are on, on this platform: those not hidden, whose needs are not hidden either. */
@Service()
export class Features {
  readonly platform = inject(DEVICE_PLATFORM);
  private readonly hidden: ReadonlySet<Feature> = new Set(inject(HIDDEN)[this.platform]);

  on(feature: Feature): boolean {
    if (this.hidden.has(feature)) return false;
    const needs = NEEDS[feature];
    return !needs || this.on(needs);
  }
}
