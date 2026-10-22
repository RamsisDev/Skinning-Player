/**
 * The picture an ID3v2 tag carries (versions 2.2, 2.3 and 2.4), as MP3s and some WAVs do. The
 * media store keeps no artwork for audio files, so the app reads it from the file itself.
 */
import { type ByteReader, bytesReader, subReader } from './byte-reader.ts';

export interface EmbeddedPicture {
  readonly mime: string;
  readonly data: Uint8Array;
}

/**
 * The ID3v2 picture type of a front cover, preferred over the band photos a tag may also hold.
 * FLAC numbers its pictures the same way.
 */
export const FRONT_COVER = 3;

const syncsafe = (b: Uint8Array, at: number): number =>
  ((b[at]! & 0x7f) << 21) | ((b[at + 1]! & 0x7f) << 14) | ((b[at + 2]! & 0x7f) << 7) | (b[at + 3]! & 0x7f);

const uint32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));

/**
 * How many bytes of tag follow the 10-byte header at the start of `head`, or 0 when the file
 * does not start with an ID3v2 tag.
 */
export function id3TagSize(head: Uint8Array): number {
  if (head.length < 10 || ascii(head, 0, 3) !== 'ID3') return 0;
  const version = head[3]!;
  if (version < 2 || version > 4) return 0;
  return syncsafe(head, 6);
}

/** Undoes ID3 unsynchronisation: every 0xFF 0x00 was written for a plain 0xFF. */
function resync(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[n++] = bytes[i]!;
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

/** One frame of a tag: its id (`TIT2`, `APIC`, or `TT2`, `PIC` in 2.2) and its body, read on demand. */
export interface Id3Frame {
  readonly id: string;
  readonly size: number;
  read(): Uint8Array;
}

/**
 * The frames of the ID3v2 tag that starts at `start`, reading only their headers until a body is
 * asked for, so a tag's pictures are never loaded to get at its text.
 */
export function* id3Frames(file: ByteReader, start = 0): Generator<Id3Frame> {
  const head = file.read(start, 10);
  const size = id3TagSize(head);
  if (!size) return;
  const version = head[3]!;
  const flags = head[5]!;
  let tag = subReader(file, start + 10, size);
  // In 2.2 and 2.3 unsynchronisation covers the whole tag; in 2.4 each frame says so itself.
  if (flags & 0x80 && version < 4) tag = bytesReader(resync(tag.read(0, tag.size)));

  let at = 0;
  if (flags & 0x40 && version > 2) {
    const extended = tag.read(0, 4);
    at = version === 4 ? syncsafe(extended, 0) : uint32(extended, 0) + 4;
  }

  const v22 = version === 2;
  const headerSize = v22 ? 6 : 10;
  while (at + headerSize <= tag.size) {
    const header = tag.read(at, headerSize);
    const id = ascii(header, 0, v22 ? 3 : 4);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) return;
    const frameSize = v22
      ? (header[3]! << 16) | (header[4]! << 8) | header[5]!
      : version === 4
        ? syncsafe(header, 4)
        : uint32(header, 4);
    const from = at + headerSize;
    if (frameSize <= 0 || from + frameSize > tag.size) return;
    const frameFlags = v22 ? 0 : header[9]!;
    const reader = tag;
    yield {
      id,
      size: frameSize,
      read() {
        let frame = reader.read(from, frameSize);
        if (version === 4) {
          if (frameFlags & 0x02) frame = resync(frame);
          if (frameFlags & 0x01) frame = frame.subarray(4);
        }
        return frame;
      },
    };
    at = from + frameSize;
  }
}

/** Where the text that starts at `from` ends, past its terminator: one zero byte, or two for UTF-16. */
function skipText(b: Uint8Array, from: number, encoding: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i + 2;
    return b.length;
  }
  const end = b.indexOf(0, from);
  return end < 0 ? b.length : end + 1;
}

export function mimeOf(format: string): string {
  const lower = format.toLowerCase();
  if (lower.includes('/')) return lower === 'image/jpg' ? 'image/jpeg' : lower;
  if (lower === 'png') return 'image/png';
  return 'image/jpeg';
}

/** One picture frame's body: `APIC` in 2.3 and 2.4, `PIC` in 2.2. */
function readPicture(body: Uint8Array, v22: boolean): { type: number; picture: EmbeddedPicture } | null {
  const encoding = body[0]!;
  let at: number;
  let mime: string;
  if (v22) {
    mime = mimeOf(ascii(body, 1, 4));
    at = 4;
  } else {
    const end = body.indexOf(0, 1);
    if (end < 0) return null;
    mime = mimeOf(ascii(body, 1, end) || 'image/jpeg');
    at = end + 1;
  }
  const type = body[at]!;
  at = skipText(body, at + 1, encoding);
  const data = body.subarray(at);
  return data.length ? { type, picture: { mime, data } } : null;
}

/** The front cover among a tag's frames if it marks one, otherwise its first picture. */
export function coverFromFrames(frames: Iterable<Id3Frame>): EmbeddedPicture | null {
  let first: EmbeddedPicture | null = null;
  for (const frame of frames) {
    if (frame.id !== 'APIC' && frame.id !== 'PIC') continue;
    const found = readPicture(frame.read(), frame.id === 'PIC');
    if (found?.type === FRONT_COVER) return found.picture;
    first ??= found?.picture ?? null;
  }
  return first;
}

/**
 * The cover in a whole ID3v2 tag, header included: the front cover if the tag marks one,
 * otherwise its first picture. Null when it has none or the tag is not one this can read.
 */
export function coverFromId3(tag: Uint8Array): EmbeddedPicture | null {
  return coverFromFrames(id3Frames(bytesReader(tag)));
}

/** The file extension an image of this type is saved under. */
export function imageExtension(mime: string | undefined, name = ''): string {
  const type = (mime ?? '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  const ext = /\.([a-z0-9]{3,4})$/i.exec(name)?.[1]?.toLowerCase();
  return ext === 'png' || ext === 'webp' || ext === 'gif' ? ext : 'jpg';
}
