import { expect, it } from 'vitest';
import { parseReleaseType } from './release-type.ts';

it('reads a primary type, refined by live or remix', () => {
  expect(parseReleaseType(['album'])).toEqual({ kind: 'album', refinement: null });
  expect(parseReleaseType(['EP'])).toEqual({ kind: 'ep', refinement: null });
  expect(parseReleaseType(['single', 'remix'])).toEqual({ kind: 'single', refinement: 'remix' });
  expect(parseReleaseType(['album; live'])).toEqual({ kind: 'album', refinement: 'live' });
});

it('lets a secondary type such as a compilation or a soundtrack replace the primary one', () => {
  expect(parseReleaseType(['album', 'compilation', 'live'])).toEqual({ kind: 'compilation', refinement: 'live' });
  expect(parseReleaseType(['album', 'soundtrack'])).toEqual({ kind: 'soundtrack', refinement: null });
  expect(parseReleaseType(['album', 'dj-mix'])).toEqual({ kind: 'djMix', refinement: null });
  expect(parseReleaseType(['mixtape/street'])).toEqual({ kind: 'mixtape', refinement: null });
  expect(parseReleaseType(['ep', 'demo'])).toEqual({ kind: 'demo', refinement: null });
});

it('takes the compilation flag as a compilation, and says nothing for a file that says nothing', () => {
  expect(parseReleaseType([], true)).toEqual({ kind: 'compilation', refinement: null });
  expect(parseReleaseType(['live'], true)).toEqual({ kind: 'compilation', refinement: 'live' });
  expect(parseReleaseType([])).toBeNull();
});
