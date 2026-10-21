/**
 * The cover embedded in an audio file, whatever its container: an ID3v2 tag at the head (MP3,
 * and some FLAC files), a FLAC PICTURE block, the `id3 ` chunk of a WAV, or the `covr` atom of
 * an MP4 (M4A, AAC). Other files (Ogg, Opus) have none this can read.
 */
import { type EmbeddedPicture, FRONT_COVER, coverFromId3, id3TagSize, mimeOf } from './id3-cover.ts';

/** Random access to a file, so the audio between the pieces that matter is never loaded. */
export interface ByteReader {
  readonly size: number;
  /** Up to `length` bytes from `offset`, fewer past the end of the file. */
  read(offset: number, length: number): Uint8Array;
}

/** Past this, a tag or block is more likely corrupt than a cover worth reading. */
const MAX_PICTURE_BYTES = 16_000_000;

const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));
const uint32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const uint32le = (b: Uint8Array, at: number): number =>
  ((b[at + 3]! << 24) | (b[at + 2]! << 16) | (b[at + 1]! << 8) | b[at]!) >>> 0;
const uint24 = (b: Uint8Array, at: number): number => (b[at]! << 16) | (b[at + 1]! << 8) | b[at + 2]!;

export function embeddedCover(file: ByteReader): EmbeddedPicture | null {
  let at = 0;
  const tagSize = id3TagSize(file.read(0, 10));
  if (tagSize) {
    if (tagSize > MAX_PICTURE_BYTES) return null;
    const picture = coverFromId3(file.read(0, 10 + tagSize));
    if (picture) return picture;
    at = 10 + tagSize;
  }
  const head = file.read(at, 12);
  if (ascii(head, 0, 4) === 'fLaC') return flacCover(file, at + 4);
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE') return wavCover(file, at + 12);
  if (ascii(head, 4, 8) === 'ftyp') return mp4Cover(file, at);
  return null;
}

/** The metadata blocks that open a FLAC stream, the last one flagged as such. */
function flacCover(file: ByteReader, at: number): EmbeddedPicture | null {
  let first: EmbeddedPicture | null = null;
  while (at + 4 <= file.size) {
    const header = file.read(at, 4);
    const length = uint24(header, 1);
    at += 4;
    if ((header[0]! & 0x7f) === 6 && length <= MAX_PICTURE_BYTES) {
      const found = flacPicture(file.read(at, length));
      if (found?.type === FRONT_COVER) return found.picture;
      first ??= found?.picture ?? null;
    }
    if (header[0]! & 0x80) break;
    at += length;
  }
  return first;
}

/** A PICTURE block: its type, then a MIME type, a description, four sizes and the image. */
function flacPicture(b: Uint8Array): { type: number; picture: EmbeddedPicture } | null {
  if (b.length < 32) return null;
  const type = uint32(b, 0);
  const mimeEnd = 8 + uint32(b, 4);
  const mime = ascii(b, 8, mimeEnd);
  // "-->" marks a link to an image elsewhere, not the image itself.
  if (mime === '-->') return null;
  const dataAt = mimeEnd + 4 + uint32(b, mimeEnd) + 16;
  const data = b.subarray(dataAt + 4, dataAt + 4 + uint32(b, dataAt));
  return data.length ? { type, picture: { mime: mimeOf(mime || 'image/jpeg'), data } } : null;
}

/** The RIFF chunks after the WAVE header, little-endian and padded to an even length. */
function wavCover(file: ByteReader, at: number): EmbeddedPicture | null {
  while (at + 8 <= file.size) {
    const header = file.read(at, 8);
    const size = uint32le(header, 4);
    at += 8;
    if (ascii(header, 0, 4).toLowerCase() === 'id3 ') {
      return size <= MAX_PICTURE_BYTES ? coverFromId3(file.read(at, size)) : null;
    }
    at += size + (size & 1);
  }
  return null;
}

/** The iTunes cover: `moov/udta/meta/ilst/covr/data`, wherever `moov` sits in the file. */
function mp4Cover(file: ByteReader, at: number): EmbeddedPicture | null {
  let box: Box | null = { start: at, end: file.size };
  for (const type of ['moov', 'udta', 'meta', 'ilst', 'covr', 'data']) {
    // `meta` is a full box: a version and flags come before its children.
    const start = type === 'ilst' ? box.start + 4 : box.start;
    box = findBox(file, start, box.end, type);
    if (!box) return null;
  }
  if (box.end - box.start > MAX_PICTURE_BYTES) return null;
  const data = file.read(box.start, box.end - box.start);
  const image = data.subarray(8);
  // The low three bytes of the first word name the image's type; 14 is PNG, 13 JPEG.
  const mime = (uint32(data, 0) & 0xffffff) === 14 ? 'image/png' : 'image/jpeg';
  return image.length ? { mime, data: image } : null;
}

interface Box {
  readonly start: number;
  readonly end: number;
}

/** The body of the first box of `type` between `from` and `to`. */
function findBox(file: ByteReader, from: number, to: number, type: string): Box | null {
  let at = from;
  while (at + 8 <= to) {
    const header = file.read(at, 16);
    let size = uint32(header, 0);
    let headerSize = 8;
    if (size === 1) {
      size = uint32(header, 8) * 2 ** 32 + uint32(header, 12);
      headerSize = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < headerSize) return null;
    if (ascii(header, 4, 8) === type) return { start: at + headerSize, end: Math.min(at + size, to) };
    at += size;
  }
  return null;
}
