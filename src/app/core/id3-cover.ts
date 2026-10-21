/**
 * The picture an ID3v2 tag carries (versions 2.2, 2.3 and 2.4), as MP3s and some WAVs do. The
 * media store keeps no artwork for audio files, so the app reads it from the file itself.
 */

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

/**
 * The cover in a whole ID3v2 tag, header included: the front cover if the tag marks one,
 * otherwise its first picture. Null when it has none or the tag is not one this can read.
 */
export function coverFromId3(tag: Uint8Array): EmbeddedPicture | null {
  const size = id3TagSize(tag);
  if (!size) return null;
  const version = tag[3]!;
  const flags = tag[5]!;
  let body = tag.subarray(10, 10 + size);
  // In 2.2 and 2.3 unsynchronisation covers the whole tag; in 2.4 each frame says so itself.
  if (flags & 0x80 && version < 4) body = resync(body);

  let at = 0;
  if (flags & 0x40 && version > 2) at = version === 4 ? syncsafe(body, 0) : uint32(body, 0) + 4;

  const v22 = version === 2;
  const headerSize = v22 ? 6 : 10;
  let first: EmbeddedPicture | null = null;
  while (at + headerSize <= body.length) {
    const id = ascii(body, at, at + (v22 ? 3 : 4));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const frameSize = v22
      ? (body[at + 3]! << 16) | (body[at + 4]! << 8) | body[at + 5]!
      : version === 4
        ? syncsafe(body, at + 4)
        : uint32(body, at + 4);
    const start = at + headerSize;
    const end = start + frameSize;
    if (frameSize <= 0 || end > body.length) break;

    if (id === (v22 ? 'PIC' : 'APIC')) {
      let frame = body.subarray(start, end);
      if (version === 4) {
        const frameFlags = body[at + 9]!;
        if (frameFlags & 0x02) frame = resync(frame);
        if (frameFlags & 0x01) frame = frame.subarray(4);
      }
      const found = readPicture(frame, v22);
      if (found?.type === FRONT_COVER) return found.picture;
      first ??= found?.picture ?? null;
    }
    at = end;
  }
  return first;
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
