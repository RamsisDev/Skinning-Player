import { describe, expect, it } from 'vitest';
import { embeddedCover } from './embedded-cover.ts';

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
const uint32le = (n: number) => uint32(n).reverse();

const coverOf = (file: Uint8Array) =>
  embeddedCover({ size: file.length, read: (offset, length) => file.subarray(offset, offset + length) });

/** A 2.3 tag holding one APIC frame, or none without an image. */
const id3 = (image?: number[]) => {
  const apic = image && bytes([0], 'image/jpeg', [0], [3], [0], image);
  const body = apic ? bytes('APIC', uint32(apic.length), [0, 0], apic) : bytes('TIT2', uint32(2), [0, 0], [0, 0x41]);
  return bytes('ID3', [3, 0, 0], syncsafe(body.length), body);
};

const flacBlock = (type: number, body: Uint8Array, last = false) =>
  bytes([type | (last ? 0x80 : 0)], uint32(body.length).slice(1), body);
const flacPicture = (type: number, mime: string, image: number[]) =>
  bytes(uint32(type), uint32(mime.length), mime, uint32(4), 'desc', uint32(1), uint32(1), uint32(24), uint32(0), uint32(image.length), image);
const streamInfo = flacBlock(0, new Uint8Array(34));

const box = (type: string, ...children: (string | number[] | Uint8Array)[]) => {
  const body = bytes(...children);
  return bytes(uint32(8 + body.length), type, body);
};

describe('embeddedCover', () => {
  it('reads the ID3v2 tag at the head of an MP3', () => {
    expect([...coverOf(bytes(id3([0xff, 0xd8, 1]), [0xff, 0xfb, 0x90, 0x64]))!.data]).toEqual([0xff, 0xd8, 1]);
  });

  it('prefers the front cover among the PICTURE blocks of a FLAC', () => {
    const file = bytes(
      'fLaC',
      streamInfo,
      flacBlock(6, flacPicture(4, 'image/jpeg', [1, 2])),
      flacBlock(6, flacPicture(3, 'image/png', [3, 4]), true),
      [0xff, 0xf8, 0, 0],
    );
    expect(coverOf(file)).toEqual({ mime: 'image/png', data: Uint8Array.from([3, 4]) });
  });

  it('reads past an ID3v2 tag without a picture to the FLAC behind it', () => {
    const file = bytes(id3(), 'fLaC', streamInfo, flacBlock(6, flacPicture(0, 'image/jpeg', [5]), true));
    expect([...coverOf(file)!.data]).toEqual([5]);
  });

  it('ignores a FLAC picture that only links to an image', () => {
    const file = bytes('fLaC', flacBlock(6, flacPicture(3, '-->', [0x68, 0x74]), true));
    expect(coverOf(file)).toBeNull();
  });

  it('finds the id3 chunk of a WAV past its odd-sized audio', () => {
    const tag = id3([7, 8, 9]);
    const chunks = bytes(
      'fmt ', uint32le(16), new Uint8Array(16),
      'data', uint32le(3), [1, 2, 3, 0],
      'id3 ', uint32le(tag.length), tag,
    );
    const file = bytes('RIFF', uint32le(4 + chunks.length), 'WAVE', chunks);
    expect([...coverOf(file)!.data]).toEqual([7, 8, 9]);
  });

  it('finds the covr atom of an M4A whose moov follows the audio', () => {
    const data = box('data', uint32(14), uint32(0), bytes([0x89, 0x50, 0x4e, 0x47]));
    const meta = box('meta', [0, 0, 0, 0], box('hdlr', new Uint8Array(25)), box('ilst', box('covr', data)));
    const file = bytes(box('ftyp', 'M4A ', uint32(0)), box('mdat', new Uint8Array(64)), box('moov', box('mvhd', new Uint8Array(100)), box('udta', meta)));
    expect(coverOf(file)).toEqual({ mime: 'image/png', data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) });
  });

  it('finds nothing in an M4A without a cover, nor in an Ogg file', () => {
    expect(coverOf(bytes(box('ftyp', 'M4A ', uint32(0)), box('moov', box('mvhd', new Uint8Array(100)))))).toBeNull();
    expect(coverOf(bytes('OggS', new Uint8Array(40)))).toBeNull();
  });
});
