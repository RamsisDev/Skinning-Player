import { describe, expect, it } from 'vitest';
import { audioInfo } from './audio-info.ts';

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
const uint16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const uint32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const uint32le = (n: number) => uint32(n).reverse();
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const box = (type: string, ...body: (string | number[] | Uint8Array)[]) => {
  const inside = bytes(...body);
  return bytes(uint32(8 + inside.length), type, inside);
};

const infoOf = (file: Uint8Array, duration = 0) =>
  audioInfo({ size: file.length, read: (offset, length) => file.subarray(offset, offset + length) }, duration);

/** An MPEG-1 Layer III frame header at 128 kbps and 44.1 kHz, joint stereo, then the rest of its 417 bytes. */
const mp3Frame = () => bytes([0xff, 0xfb, 0x90, 0x44], new Uint8Array(413));

describe('audioInfo', () => {
  it('reads an MP3 frame past an ID3 tag, and its stated bitrate', () => {
    const tag = bytes('ID3', [4, 0, 0], syncsafe(20), new Uint8Array(20));
    // Leftover bytes that look like a frame sync, but are not followed by a second frame.
    const file = bytes(tag, [0xff, 0xfb, 0x00], mp3Frame(), mp3Frame(), mp3Frame());
    expect(infoOf(file, 180)).toEqual({ format: 'MP3', sampleRate: 44100, channels: 2, bitrate: 128 });
  });

  it('takes the length and average bitrate of a variable bitrate MP3 from its Xing header', () => {
    const frame = mp3Frame();
    // Stereo MPEG-1: the side information takes 32 bytes after the header.
    frame.set(bytes('Xing', uint32(3), uint32(1000), uint32(2_000_000)), 4 + 32);
    const info = infoOf(bytes(frame, mp3Frame()));
    // 1000 frames of 1152 samples at 44.1 kHz.
    expect(info?.duration).toBeCloseTo(26.122, 3);
    // Its 2 MB over those seconds.
    expect(info?.bitrate).toBe(613);
  });

  it('reads the stream info of a FLAC file', () => {
    // 44.1 kHz, 2 channels, 16 bits, 441000 samples: 10 seconds.
    const streamInfo = bytes(new Uint8Array(10), [0x0a, 0xc4, 0x42, 0xf0], uint32(441_000), new Uint8Array(16));
    const file = bytes('fLaC', [0x80, 0, 0, 34], streamInfo, new Uint8Array(1_250_000));
    expect(infoOf(file)).toEqual({ format: 'FLAC', sampleRate: 44100, channels: 2, bitDepth: 16, duration: 10, bitrate: 1000 });
  });

  it('reads the identification header of an Ogg Vorbis or Opus stream', () => {
    const page = (packet: Uint8Array) => bytes('OggS', new Uint8Array(22), [1, packet.length], packet);
    const vorbis = bytes('\u0001vorbis', uint32le(0), [2], uint32le(48000), new Uint8Array(16));
    expect(infoOf(bytes(page(vorbis), new Uint8Array(999_942)), 40)).toEqual({ format: 'Vorbis', channels: 2, sampleRate: 48000, bitrate: 200 });
    const opus = bytes('OpusHead', [1, 1], new Uint8Array(9));
    expect(infoOf(page(opus))).toMatchObject({ format: 'Opus', channels: 1, sampleRate: 48000 });
  });

  it('reads the format chunk of a WAV file', () => {
    const fmt = bytes(uint16le(1), uint16le(2), uint32le(96000), uint32le(576000), uint16le(6), uint16le(24));
    const file = bytes('RIFF', uint32le(36), 'WAVE', 'LIST', uint32le(4), 'INFO', 'fmt ', uint32le(16), fmt);
    expect(infoOf(file)).toEqual({ format: 'WAV', channels: 2, sampleRate: 96000, bitDepth: 24, bitrate: 4608 });
  });

  it('reads the audio track of an M4A, averaging its media data', () => {
    const entry = box('mp4a', new Uint8Array(16), [0, 2, 0, 16], new Uint8Array(4), uint32(44100 * 65536));
    const stsd = box('stsd', [0, 0, 0, 0], uint32(1), entry);
    // Version 0: created, modified, timescale, then the length in its units.
    const mdhd = box('mdhd', [0, 0, 0, 0], uint32(0), uint32(0), uint32(44100), uint32(44100 * 8), new Uint8Array(4));
    const moov = box('moov', box('trak', box('mdia', mdhd, box('minf', box('stbl', stsd)))));
    const file = bytes(box('ftyp', 'M4A ', uint32(0)), moov, box('mdat', new Uint8Array(256_000)));
    expect(infoOf(file)).toEqual({ format: 'AAC', channels: 2, sampleRate: 44100, duration: 8, bitrate: 256 });
  });

  it('gives nothing for a file it cannot read a stream in', () => {
    expect(infoOf(bytes('not audio at all'))).toBeNull();
  });
});
