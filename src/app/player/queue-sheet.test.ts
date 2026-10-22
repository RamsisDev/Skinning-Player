import { expect, test } from 'vitest';
import { dropIndex, liftedTop, shiftOf } from './queue-sheet.ts';

test('draws a lifted song under the finger, kept inside the viewport once it is measured', () => {
  expect(liftedTop(2, 30, 0, 0)).toBe(158);
  expect(liftedTop(2, 30, 100, 0)).toBe(58);
  expect(liftedTop(0, -40, 0, 400)).toBe(0);
  expect(liftedTop(5, 200, 0, 400)).toBe(336);
});

test('drops a song into the place nearest to where it is held, within the queue', () => {
  expect(dropIndex(0, 0, 10)).toBe(0);
  expect(dropIndex(31, 0, 10)).toBe(0);
  expect(dropIndex(33, 0, 10)).toBe(1);
  expect(dropIndex(100, 640, 20)).toBe(12);
  expect(dropIndex(5000, 0, 10)).toBe(9);
  expect(dropIndex(0, 0, 0)).toBe(0);
});

test('steps the rows a lifted song passes aside, toward where it came from', () => {
  // Nothing lifted, and the lifted row itself, stay put.
  expect(shiftOf(3, -1, -1)).toBe(0);
  expect(shiftOf(2, 2, 5)).toBe(0);
  // Taken down from 2 to 4: rows 3 and 4 step up.
  expect([1, 2, 3, 4, 5].map((at) => shiftOf(at, 2, 4))).toEqual([0, 0, -64, -64, 0]);
  // Taken up from 4 to 1: rows 1 to 3 step down.
  expect([0, 1, 2, 3, 4, 5].map((at) => shiftOf(at, 4, 1))).toEqual([0, 64, 64, 64, 0, 0]);
});
