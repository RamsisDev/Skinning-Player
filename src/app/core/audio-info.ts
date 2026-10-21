/**
 * What a file's audio is, read from the headers of its stream:
 * the codec, the sample rate, the channels, the bit depth of a lossless stream and the bitrate.
 * The bitrate is the one an MP3 or WAV header states, or else the average over the song, the audio
 * bytes over its length, which is what a variable bitrate stream can only be described by.
 */
import { type ByteReader } from './byte-reader.ts';
import { type Box, findBox } from './embedded-cover.ts';
import { id3TagSize } from './id3-cover.ts';

export interface AudioInfo {
  /** The codec, as people know it: "MP3", "FLAC", "Vorbis", "Opus", "AAC", "ALAC", "WAV". */
  readonly format: string;
  /** In hertz. */
  readonly sampleRate?: number;
  readonly channels?: number;
  /** Bits per sample, for a stream that has them. */
  readonly bitDepth?: number;
  /** In kilobits a second. */
  readonly bitrate?: number;
  /** Seconds, when the headers give the length exactly. */
  readonly duration?: number;
}

/** How far into a file an MP3's first frame is looked for, past its tag. */
const FRAME_SEARCH_BYTES = 65_536;

const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));
const uint16le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const uint32le = (b: Uint8Array, at: number): number =>
  ((b[at + 3]! << 24) | (b[at + 2]! << 16) | (b[at + 1]! << 8) | b[at]!) >>> 0;
const uint32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const uint24 = (b: Uint8Array, at: number): number => (b[at]! << 16) | (b[at + 1]! << 8) | b[at + 2]!;

/** Kilobits a second from bytes over seconds, or nothing without a length to divide by. */
const average = (bytes: number, seconds: number | undefined): number | undefined =>
  seconds && seconds > 0 && bytes > 0 ? Math.round((bytes * 8) / seconds / 1000) : undefined;

/**
 * The audio of a file, or null when its stream is not one this can read. `duration` is the length
 * the media store gives, for an average bitrate when the headers do not give one.
 */
export function audioInfo(file: ByteReader, duration = 0): AudioInfo | null {
  const tagSize = id3TagSize(file.read(0, 10));
  const at = tagSize ? 10 + tagSize : 0;
  const head = file.read(at, 12);
  const magic = ascii(head, 0, 4);
  if (magic === 'fLaC') return flacInfo(file, at + 4);
  if (magic === 'OggS') return oggInfo(file, at, duration);
  if (magic === 'RIFF' && ascii(head, 8, 12) === 'WAVE') return wavInfo(file, at + 12, duration);
  if (ascii(head, 4, 8) === 'ftyp') return mp4Info(file, at);
  return mp3Info(file, at, duration);
}

// MP3

const BITRATES: Readonly<Record<string, readonly number[]>> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
/** By MPEG version: 1, 2 and 2.5. */
const SAMPLE_RATES: Readonly<Record<string, readonly number[]>> = {
  '1': [44100, 48000, 32000],
  '2': [22050, 24000, 16000],
  '2.5': [11025, 12000, 8000],
};

interface MpegFrame {
  readonly version: '1' | '2' | '2.5';
  readonly layer: 1 | 2 | 3;
  readonly bitrate: number;
  readonly sampleRate: number;
  readonly channels: number;
  /** Bytes, header included. */
  readonly length: number;
  readonly samples: number;
}

/** The MPEG audio frame header at `at` in `b`, or null when there is none there. */
function mpegFrame(b: Uint8Array, at: number): MpegFrame | null {
  if (b[at] !== 0xff || (b[at + 1]! & 0xe0) !== 0xe0) return null;
  const version = (['2.5', null, '2', '1'] as const)[(b[at + 1]! >> 3) & 3];
  const layer = ([null, 3, 2, 1] as const)[(b[at + 1]! >> 1) & 3];
  const bitrateIndex = b[at + 2]! >> 4;
  const rateIndex = (b[at + 2]! >> 2) & 3;
  if (!version || !layer || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const bitrate = BITRATES[`${version === '1' ? 1 : 2}-${layer}`]![bitrateIndex]!;
  const sampleRate = SAMPLE_RATES[version]![rateIndex]!;
  const padding = (b[at + 2]! >> 1) & 1;
  const samples = layer === 1 ? 384 : layer === 3 && version !== '1' ? 576 : 1152;
  const length =
    layer === 1
      ? (Math.floor((12 * bitrate * 1000) / sampleRate) + padding) * 4
      : Math.floor(((samples / 8) * bitrate * 1000) / sampleRate) + padding;
  return { version, layer, bitrate, sampleRate, channels: b[at + 3]! >> 6 === 3 ? 1 : 2, length, samples };
}

/**
 * The first frame, found past the tag as two frames in a row, so a stray 0xFF in leftover tag
 * bytes is not taken for one. A Xing, Info or VBRI header in it counts the frames of a variable
 * bitrate stream, which gives its length and its average bitrate.
 */
function mp3Info(file: ByteReader, from: number, duration: number): AudioInfo | null {
  const b = file.read(from, FRAME_SEARCH_BYTES);
  for (let i = 0; i + 4 <= b.length; i++) {
    const frame = mpegFrame(b, i);
    if (!frame) continue;
    const next = i + frame.length;
    if (next + 4 <= b.length && !mpegFrame(b, next)) continue;
    const format = frame.layer === 3 ? 'MP3' : `MP${frame.layer}`;
    const base = { format, sampleRate: frame.sampleRate, channels: frame.channels };
    const audioBytes = file.size - from - i;
    const vbr = xingFrames(b, i, frame);
    if (vbr) {
      const seconds = (vbr.frames * frame.samples) / frame.sampleRate;
      return { ...base, duration: seconds, bitrate: average(vbr.bytes || audioBytes, seconds) };
    }
    return { ...base, bitrate: frame.bitrate || average(audioBytes, duration) };
  }
  return null;
}

/** The frame and byte counts of a variable bitrate header in the frame at `at`, when it has one. */
function xingFrames(b: Uint8Array, at: number, frame: MpegFrame): { frames: number; bytes: number } | null {
  const mono = frame.channels === 1;
  const sideInfo = frame.version === '1' ? (mono ? 17 : 32) : mono ? 9 : 17;
  const xing = at + 4 + sideInfo;
  const tag = ascii(b, xing, xing + 4);
  if (tag === 'Xing' || tag === 'Info') {
    const flags = uint32(b, xing + 4);
    let field = xing + 8;
    const frames = flags & 1 ? uint32(b, field) : 0;
    if (flags & 1) field += 4;
    const bytes = flags & 2 ? uint32(b, field) : 0;
    return frames ? { frames, bytes } : null;
  }
  const vbri = at + 4 + 32;
  if (ascii(b, vbri, vbri + 4) === 'VBRI') {
    const frames = uint32(b, vbri + 14);
    return frames ? { frames, bytes: uint32(b, vbri + 10) } : null;
  }
  return null;
}

// FLAC

/** STREAMINFO, the first metadata block: rate, channels, depth and the samples in the stream. */
function flacInfo(file: ByteReader, at: number): AudioInfo {
  let info: AudioInfo = { format: 'FLAC' };
  let streamInfo: Uint8Array | null = null;
  while (at + 4 <= file.size) {
    const header = file.read(at, 4);
    const length = uint24(header, 1);
    if ((header[0]! & 0x7f) === 0) streamInfo = file.read(at + 4, 34);
    at += 4 + length;
    if (header[0]! & 0x80) break;
  }
  if (streamInfo && streamInfo.length >= 18) {
    const b = streamInfo;
    const sampleRate = (b[10]! << 12) | (b[11]! << 4) | (b[12]! >> 4);
    const samples = (b[13]! & 0x0f) * 2 ** 32 + uint32(b, 14);
    const duration = sampleRate && samples ? samples / sampleRate : undefined;
    info = {
      format: 'FLAC',
      sampleRate: sampleRate || undefined,
      channels: ((b[12]! >> 1) & 7) + 1,
      bitDepth: (((b[12]! & 1) << 4) | (b[13]! >> 4)) + 1,
      duration,
      bitrate: average(file.size - at, duration),
    };
  }
  return info;
}

// Ogg

/** The first packet of an Ogg stream, which names its codec: Vorbis, Opus or FLAC. */
function oggInfo(file: ByteReader, at: number, duration: number): AudioInfo | null {
  const header = file.read(at, 27);
  const lacing = file.read(at + 27, header[26] ?? 0);
  const packet = file.read(at + 27 + lacing.length, 64);
  const bitrate = average(file.size, duration);
  if (ascii(packet, 0, 7) === '\u0001vorbis') {
    return { format: 'Vorbis', channels: packet[11], sampleRate: uint32le(packet, 12) || undefined, bitrate };
  }
  // Opus always plays at 48 kHz, whatever rate it was made from.
  if (ascii(packet, 0, 8) === 'OpusHead') return { format: 'Opus', channels: packet[9], sampleRate: 48000, bitrate };
  if (ascii(packet, 0, 5) === '\u007fFLAC') return { format: 'FLAC', bitrate };
  return null;
}

// WAV

/** The `fmt ` chunk: the encoding, channels, rate, bytes a second and bits a sample. */
function wavInfo(file: ByteReader, at: number, duration: number): AudioInfo | null {
  while (at + 8 <= file.size) {
    const chunk = file.read(at, 8);
    const size = uint32le(chunk, 4);
    if (ascii(chunk, 0, 4) === 'fmt ') {
      const b = file.read(at + 8, 16);
      if (b.length < 16) return null;
      const byteRate = uint32le(b, 8);
      return {
        format: 'WAV',
        channels: uint16le(b, 2),
        sampleRate: uint32le(b, 4),
        bitDepth: uint16le(b, 14) || undefined,
        bitrate: byteRate ? Math.round((byteRate * 8) / 1000) : average(file.size, duration),
      };
    }
    at += 8 + size + (size & 1);
  }
  return null;
}

// MP4

const MP4_CODECS: Readonly<Record<string, string>> = {
  mp4a: 'AAC',
  alac: 'ALAC',
  fLaC: 'FLAC',
  Opus: 'Opus',
  '.mp3': 'MP3',
  'ac-3': 'AC-3',
  'ec-3': 'E-AC-3',
};

/** The boxes of `type` between `from` and `to`, one after another. */
function* boxes(file: ByteReader, from: number, to: number, type: string): Generator<Box> {
  let box = findBox(file, from, to, type);
  while (box) {
    yield box;
    box = findBox(file, box.end, to, type);
  }
}

/**
 * The first audio track in `moov`: its sample entry in `stsd` names the codec and gives the
 * channels and bits a sample, and its `mdhd` the rate and length. The bitrate averages the media
 * data, without the tags and covers kept beside it.
 */
function mp4Info(file: ByteReader, at: number): AudioInfo | null {
  const moov = findBox(file, at, file.size, 'moov');
  if (!moov) return null;
  for (const trak of boxes(file, moov.start, moov.end, 'trak')) {
    const mdia = findBox(file, trak.start, trak.end, 'mdia');
    const minf = mdia && findBox(file, mdia.start, mdia.end, 'minf');
    const stbl = minf && findBox(file, minf.start, minf.end, 'stbl');
    const stsd = stbl && findBox(file, stbl.start, stbl.end, 'stsd');
    if (!mdia || !stsd) continue;
    // `stsd` is a full box with an entry count; the first sample entry follows.
    const entry = file.read(stsd.start + 8, 36);
    const format = MP4_CODECS[ascii(entry, 4, 8)];
    if (!format) continue;
    const mdhd = findBox(file, mdia.start, mdia.end, 'mdhd');
    let sampleRate = uint32(entry, 32) >>> 16;
    let duration: number | undefined;
    if (mdhd) {
      const b = file.read(mdhd.start, 32);
      const v1 = b[0] === 1;
      const timescale = uint32(b, v1 ? 20 : 12);
      const units = v1 ? uint32(b, 24) * 2 ** 32 + uint32(b, 28) : uint32(b, 16);
      if (timescale && units) duration = units / timescale;
      // The entry's rate is 16 bits wide: past 65535 Hz it is left out, and the timescale is the rate.
      if (!sampleRate) sampleRate = timescale;
    }
    const media = [...boxes(file, at, file.size, 'mdat')].reduce((sum, box) => sum + box.end - box.start, 0);
    const bitDepth = format === 'ALAC' || format === 'FLAC' ? (entry[26]! << 8) | entry[27]! : undefined;
    return {
      format,
      channels: (entry[24]! << 8) | entry[25]!,
      sampleRate: sampleRate || undefined,
      bitDepth: bitDepth || undefined,
      duration,
      bitrate: average(media, duration),
    };
  }
  return null;
}
