import { describe, expect, it } from 'vitest';
import { type ReplayGainSettings, replayGainDb, stepPreAmp, volumeOf } from './replay-gain.ts';

const settings = (mode: ReplayGainSettings['mode'], preAmpTagged = 0, preAmpUntagged = 0): ReplayGainSettings => ({
  mode,
  preAmpTagged,
  preAmpUntagged,
});
const both = { track: -7.5, album: -9 };

describe('replayGainDb', () => {
  it('leaves the volume alone when off, pre-amps and all', () => {
    expect(replayGainDb(both, settings('off', 3, -6), true)).toBe(0);
    expect(replayGainDb(undefined, settings('off', 3, -6), false)).toBe(0);
  });

  it("plays the song's own adjustment, or its album's, as the mode asks", () => {
    expect(replayGainDb(both, settings('track'), true)).toBe(-7.5);
    expect(replayGainDb(both, settings('album'), false)).toBe(-9);
  });

  it("takes the album's adjustment only while the album is what plays, in the dynamic mode", () => {
    expect(replayGainDb(both, settings('dynamic'), true)).toBe(-9);
    expect(replayGainDb(both, settings('dynamic'), false)).toBe(-7.5);
  });

  it('falls back to the other adjustment when the one preferred is missing', () => {
    expect(replayGainDb({ track: -4 }, settings('album'), true)).toBe(-4);
    expect(replayGainDb({ album: -5 }, settings('track'), false)).toBe(-5);
  });

  it('adds the tagged pre-amp to an adjustment, and plays an untagged file at the untagged one', () => {
    expect(replayGainDb(both, settings('track', 2.5, -6), false)).toBe(-5);
    expect(replayGainDb(undefined, settings('track', 2.5, -6), false)).toBe(-6);
    expect(replayGainDb({}, settings('dynamic', 2.5, -3), true)).toBe(-3);
  });
});

it('steps a pre-amp in half decibels, within -15 and +15', () => {
  expect(stepPreAmp(0, 1)).toBe(0.5);
  expect(stepPreAmp(0.5, -3)).toBe(-1);
  expect(stepPreAmp(14.5, 4)).toBe(15);
  expect(stepPreAmp(-15, -1)).toBe(-15);
});

it('turns a gain into the volume closest to it, never past full', () => {
  expect(volumeOf(0)).toBe(1);
  expect(volumeOf(-20)).toBeCloseTo(0.1);
  expect(volumeOf(-6)).toBeCloseTo(0.501, 3);
  expect(volumeOf(6)).toBe(1);
});
