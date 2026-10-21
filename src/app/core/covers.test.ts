import { injectService } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { Covers } from './covers.ts';
import { MusicLibrary } from './music-library.ts';
import { fakeDocumentPicker, fakeMediaLibrary, memoryFiles, memoryStorage } from '../testing/fakes.ts';

const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];

/** An MP3's head: a 2.3 tag with a front cover of `image`, then a frame of audio. */
function mp3With(image: number[]): Uint8Array {
  const picture = [0, ...Array.from('image/jpeg', (c) => c.charCodeAt(0)), 0, 3, 0, ...image];
  const frame = [0x41, 0x50, 0x49, 0x43, 0, 0, 0, picture.length, 0, 0, ...picture];
  return Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, ...syncsafe(frame.length), ...frame, 0xff, 0xfb, 0x90, 0x64]);
}

async function setUp(picks: Parameters<typeof fakeDocumentPicker>[0] = []) {
  const disk = new Map<string, Uint8Array>([
    ['file:///music/1.mp3', mp3With([0xff, 0xd8, 1, 2])],
    ['file:///music/2.mp3', Uint8Array.from([0xff, 0xfb, 0x90, 0x64])],
  ]);
  const providers = [
    memoryStorage(),
    memoryFiles(disk),
    fakeDocumentPicker(picks),
    fakeMediaLibrary([
      ['1', 'Tagged.mp3', 100],
      ['2', 'Bare.mp3', 100],
    ]),
  ];
  const library = injectService(MusicLibrary, { providers });
  await library.scan();
  const covers = injectService(Covers);
  const [tagged, bare] = [library.byId().get('1')!, library.byId().get('2')!];
  return { covers, disk, tagged, bare };
}

test('finds the art embedded in a file, and keeps it in the cache', async () => {
  const { covers, disk, tagged, bare } = await setUp();
  await covers.load(tagged);
  await covers.load(bare);

  expect(covers.uriOf(tagged.id)).toBe('file:///cache/covers/embedded-1.jpg');
  expect([...disk.get('file:///cache/covers/embedded-1.jpg')!]).toEqual([0xff, 0xd8, 1, 2]);
  expect(covers.uriOf(bare.id)).toBeNull();
});

test('puts the image the user picks over the embedded art, until it is removed', async () => {
  const { covers, disk, tagged } = await setUp([
    { uri: 'file:///picked/one.png', name: 'one.png', mimeType: 'image/png', size: 3, lastModified: 0 },
    { uri: 'file:///picked/two.jpg', name: 'two.jpg', mimeType: 'image/jpeg', size: 3, lastModified: 0 },
  ]);
  disk.set('file:///picked/one.png', Uint8Array.from([1, 1, 1]));
  disk.set('file:///picked/two.jpg', Uint8Array.from([2, 2, 2]));
  await covers.load(tagged);

  expect(await covers.choose(tagged)).toEqual({ ok: true });
  const first = covers.uriOf(tagged.id)!;
  expect(first).toMatch(/^file:\/\/\/documents\/covers\/1-[a-z0-9]+\.png$/);
  expect(covers.hasCustom(tagged.id)).toBe(true);

  await covers.choose(tagged);
  const second = covers.uriOf(tagged.id)!;
  expect([...disk.get(second)!]).toEqual([2, 2, 2]);
  expect(disk.has(first)).toBe(false);

  covers.removeCustom(tagged);
  expect(disk.has(second)).toBe(false);
  expect(covers.uriOf(tagged.id)).toBe('file:///cache/covers/embedded-1.jpg');
  expect(await covers.choose(tagged)).toBeNull();
});

test('refuses an image too large to be a cover', async () => {
  const { covers, tagged } = await setUp([
    { uri: 'file:///picked/huge.jpg', name: 'huge.jpg', mimeType: 'image/jpeg', size: 50_000_000, lastModified: 0 },
  ]);
  expect(await covers.choose(tagged)).toMatchObject({ ok: false });
  expect(covers.hasCustom(tagged.id)).toBe(false);
});
