import { type Tags } from '../metadata/embedded-tags.ts';

/**
 * Which ReplayGain adjustment evens out the volume: none, the song's own, its album's, or its
 * album's while the album is what plays and the song's otherwise ("dynamic"), so an album keeps
 * its quiet and loud songs as they were mastered.
 */
export const REPLAY_GAIN_MODES = ['off', 'track', 'album', 'dynamic'] as const;
export type ReplayGainMode = (typeof REPLAY_GAIN_MODES)[number];

/** The pre-amps go from -15 to +15 dB, in half decibels. */
export const PRE_AMP_LIMIT = 15;
export const PRE_AMP_STEP = 0.5;

export interface ReplayGainSettings {
  readonly mode: ReplayGainMode;
  /** Added to the adjustment of a file that has one. */
  readonly preAmpTagged: number;
  /** The whole adjustment of a file that has none. */
  readonly preAmpUntagged: number;
}

/**
 * The gain to play a song at, in dB: the adjustment the mode prefers, or without it the other one,
 * plus the pre-amp for tagged files; or the pre-amp for untagged files when it has neither.
 * `playingAlbum` says whether the queue is the song's album, which the dynamic mode asks.
 */
export function replayGainDb(gain: Tags['replayGain'] | null | undefined, settings: ReplayGainSettings, playingAlbum: boolean): number {
  if (settings.mode === 'off') return 0;
  const album = settings.mode === 'album' || (settings.mode === 'dynamic' && playingAlbum);
  const found = album ? (gain?.album ?? gain?.track) : (gain?.track ?? gain?.album);
  return found === undefined ? settings.preAmpUntagged : found + settings.preAmpTagged;
}

/** A pre-amp moved by `steps` half decibels, kept within its limits. */
export function stepPreAmp(value: number, steps: number): number {
  const next = Math.round((value + steps * PRE_AMP_STEP) / PRE_AMP_STEP) * PRE_AMP_STEP;
  return Math.min(PRE_AMP_LIMIT, Math.max(-PRE_AMP_LIMIT, next));
}

/**
 * The volume, 0 to 1, that comes closest to a gain on a player with no gain of its own: a cut
 * plays as it should, and a boost, which would need more than full volume, plays at full.
 */
export function volumeOf(gainDb: number): number {
  return Math.min(1, Math.max(0, 10 ** (gainDb / 20)));
}
