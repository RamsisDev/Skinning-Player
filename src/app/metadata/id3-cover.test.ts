import { describe, expect, it } from 'vitest';
import { coverFromId3, id3TagSize, imageExtension } from './id3-cover.ts';

const bytes = (...parts: (string | number[] | Uint8Array)[]): Uint8Array => {
  const chunks = parts.map((part) =>
    typeof part === 'string' ? Uint8Array.from(part, (c) => c.charCodeAt(0)) : Uint8Array.from(part),
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const uint32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** An APIC frame body: Latin-1 text, a MIME type, a picture type, a description and the image. */
const apic = (type: number, image: number[], mime = 'image/jpeg') => bytes([0], mime, [0], [type], 'desc', [0], image);

const frame23 = (id: string, body: Uint8Array) => bytes(id, uint32(body.length), [0, 0], body);
/** A 2.3 tag holding one APIC frame per picture body. */
const tag23 = (...pictures: Uint8Array[]) => {
  const body = bytes(...pictures.map((picture) => frame23('APIC', picture)));
  return bytes('ID3', [3, 0, 0], syncsafe(body.length), body);
};

describe('coverFromId3', () => {
  it('ignores a file that does not start with a tag', () => {
    expect(id3TagSize(bytes('RIFF....WAVE'))).toBe(0);
    expect(coverFromId3(bytes([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('prefers the front cover over the other pictures of a 2.3 tag', () => {
    const tag = tag23(apic(4, [1, 2, 3]), apic(3, [0xff, 0xd8, 0xff, 9], 'image/png'));
    expect(id3TagSize(tag)).toBe(tag.length - 10);
    const cover = coverFromId3(tag);
    expect(cover?.mime).toBe('image/png');
    expect([...cover!.data]).toEqual([0xff, 0xd8, 0xff, 9]);
  });

  it('falls back to the first picture, skipping the frames around it', () => {
    const title = frame23('TIT2', bytes([0], 'Title'));
    const body = bytes(title, frame23('APIC', apic(0, [7, 8, 9])), frame23('APIC', apic(4, [1])), [0, 0, 0, 0]);
    const tag = bytes('ID3', [3, 0, 0], syncsafe(body.length), body);
    expect([...coverFromId3(tag)!.data]).toEqual([7, 8, 9]);
  });

  it('reads a 2.4 frame that is unsynchronised and carries its data length', () => {
    const image = [0xff, 0x00, 0xd8, 0xff, 0x00, 0xe0];
    const frame = bytes(uint32(4), apic(3, image));
    const body = bytes('APIC', syncsafe(frame.length), [0, 0x03], frame);
    const tag = bytes('ID3', [4, 0, 0], syncsafe(body.length), body);
    expect([...coverFromId3(tag)!.data]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('reads the PIC frame of a 2.2 tag', () => {
    const frame = bytes([0], 'PNG', [3], [0], [5, 6]);
    const body = bytes('PIC', [0, 0, frame.length], frame);
    const tag = bytes('ID3', [2, 0, 0], syncsafe(body.length), body);
    expect(coverFromId3(tag)).toEqual({ mime: 'image/png', data: Uint8Array.from([5, 6]) });
  });

  it('skips a UTF-16 description to reach the image', () => {
    const frame = bytes([1], 'image/jpeg', [0], [3], [0xff, 0xfe, 0x41, 0x00, 0, 0], [4, 2]);
    const tag = tag23(frame);
    expect([...coverFromId3(tag)!.data]).toEqual([4, 2]);
  });
});

describe('imageExtension', () => {
  it('names a file from its type, then its name, then as a jpeg', () => {
    expect(imageExtension('image/png')).toBe('png');
    expect(imageExtension(undefined, 'cover.WEBP')).toBe('webp');
    expect(imageExtension('application/octet-stream', 'cover.bmp')).toBe('jpg');
  });
});
