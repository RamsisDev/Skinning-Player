import { Injector } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { featuresOn } from '../testing/fakes.ts';
import { FEATURES, Features, HIDDEN_FEATURES } from './features.ts';

const on = (...providers: Parameters<typeof featuresOn>) =>
  Injector.create({ providers: [Features, ...featuresOn(...providers)] }).get(Features);

describe('Features', () => {
  it('has everything on where nothing is hidden', () => {
    const features = on('android');
    expect(FEATURES.filter((feature) => !features.on(feature))).toEqual([]);
  });

  it('turns off what is hidden on the platform, and only there', () => {
    expect(on('ios', ['queueDrag']).on('queueDrag')).toBe(false);
    expect(on('ios', ['queueDrag']).on('replayGain')).toBe(true);
    expect(on('android', []).on('queueDrag')).toBe(true);
  });

  it('turns off what needs the app own player along with it', () => {
    const features = on('android', ['nativeAudio']);
    expect(['gapless', 'equalizer', 'stopOnTaskRemoved', 'autoplayOnHeadset', 'androidAuto'].map((f) => features.on(f as never))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(features.on('replayGain')).toBe(true);
    expect(features.on('queueDrag')).toBe(true);
  });

  it('hides on iOS what only Android has, and keeps ReplayGain and dragging on both', () => {
    const ios = on('ios', HIDDEN_FEATURES.ios);
    expect(FEATURES.filter((feature) => ios.on(feature))).toEqual(['replayGain', 'queueDrag']);
    const android = on('android', HIDDEN_FEATURES.android);
    expect(FEATURES.every((feature) => android.on(feature))).toBe(true);
  });
});
