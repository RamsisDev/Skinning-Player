/**
 * The details an audio file carries about its song: title, artists, album, album artists, genres,
 * dates, track and disc numbers, release type and sort names. Android's
 * media store indexes them but answers only file names, so the app reads them from the file, as it
 * does covers: an ID3v2 tag at the head (MP3, some FLAC) or in a WAV's `id3 ` chunk, an ID3v1 tag
 * at the end of an MP3, a WAV's LIST INFO chunk, the comments of a FLAC or Ogg (Vorbis, Opus)
 * stream, and the iTunes atoms of an MP4 (M4A, AAC). Only the headers and text are read: never the
 * audio, nor a tag's pictures.
 */
import { type ByteReader, subReader } from './byte-reader.ts';
import { type Box, findBox } from './embedded-cover.ts';
import { type Id3Frame, id3Frames, id3TagSize } from './id3-cover.ts';

/**
 * A song's tags. A field a file can hold several of (artists, album artists, genres, release
 * types) is a list of the values the file itself separates; separators written inside one value,
 * such as "A, B", are split later, by the separators the user chose.
 */
export interface Tags {
  readonly title?: string;
  readonly artists?: readonly string[];
  readonly album?: string;
  readonly albumArtists?: readonly string[];
  readonly genres?: readonly string[];
  /** When this release came out: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  readonly date?: string;
  /** When the music first came out, for a reissue or a remaster; the same form as `date`. */
  readonly originalDate?: string;
  readonly track?: number;
  readonly disc?: number;
  /** MusicBrainz's words for the release: "album", "ep", "single", "compilation", "live"... */
  readonly releaseTypes?: readonly string[];
  /** iTunes' compilation flag, for a release by various artists. */
  readonly compilation?: boolean;
  readonly titleSort?: string;
  readonly artistSort?: string;
  readonly albumSort?: string;
  readonly albumArtistSort?: string;
}

type Field =
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'genre'
  | 'date'
  | 'dayMonth'
  | 'originalDate'
  | 'track'
  | 'disc'
  | 'releaseType'
  | 'compilation'
  | 'titleSort'
  | 'artistSort'
  | 'albumSort'
  | 'albumArtistSort';
/** The values each field was given, by the first tag that names it. */
type Found = Partial<Record<Field, string[]>>;

/** Past this, a text field is more likely corrupt, or lyrics, than a name. */
const MAX_TEXT_BYTES = 16_384;
/** How much of a stream's comments is read: enough for the names, which come before a picture kept among them. */
const MAX_COMMENT_BYTES = 262_144;

const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));
const uint32le = (b: Uint8Array, at: number): number =>
  ((b[at + 3]! << 24) | (b[at + 2]! << 16) | (b[at + 1]! << 8) | b[at]!) >>> 0;
const uint24 = (b: Uint8Array, at: number): number => (b[at]! << 16) | (b[at + 1]! << 8) | b[at + 2]!;

/** The tags a file has, empty when it has none this can read. */
export function embeddedTags(file: ByteReader): Tags {
  const found: Found = {};
  let at = 0;
  const tagSize = id3TagSize(file.read(0, 10));
  if (tagSize) {
    fromId3(id3Frames(file), found);
    at = 10 + tagSize;
  }
  const head = file.read(at, 12);
  const magic = ascii(head, 0, 4);
  if (magic === 'fLaC') flacTags(file, at + 4, found);
  else if (magic === 'OggS') oggTags(file, at, found);
  else if (magic === 'RIFF' && ascii(head, 8, 12) === 'WAVE') wavTags(file, at + 12, found);
  else if (ascii(head, 4, 8) === 'ftyp') mp4Tags(file, at, found);
  else id3v1Tags(file, found);
  return clean(found);
}

/** Sets a field the file has not named yet: the tag read first wins. */
function fill(found: Found, field: Field, value: string | readonly (string | undefined)[] | undefined): void {
  const values = (typeof value === 'string' ? [value] : (value ?? [])).map((text) => text?.trim() ?? '').filter(Boolean);
  if (values.length && !found[field]) found[field] = values;
}

const tidy = (text: string) => text.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Each value once, tidied, in the order the file gives them. */
function list(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of (values ?? []).map(tidy)) {
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}

/** "3", "03" or "3/12": the number before the total, when there is one. */
function position(values: readonly string[] | undefined): number | undefined {
  const n = Number(/^\s*0*(\d{1,4})/.exec(values?.[0] ?? '')?.[1]);
  return n > 0 ? n : undefined;
}

/**
 * A date as precise as the tag gives it: "2004", "2004-05" or "2004-05-12", from ISO 8601,
 * "2004/05/12", "2004.05.12" or "20040512". An ID3v2.3 year is refined by its `TDAT`, "DDMM".
 */
export function parseDate(text: string | undefined, dayMonth?: string): string | undefined {
  const match = /^\s*(\d{4})(?:[-/.]?(\d{2})(?:[-/.]?(\d{2}))?)?/.exec(text ?? '');
  if (!match || match[1] === '0000') return undefined;
  const [, year, month, day] = match;
  const valid = (value: string | undefined, max: number) => !!value && Number(value) >= 1 && Number(value) <= max;
  if (valid(month, 12)) return valid(day, 31) ? `${year}-${month}-${day}` : `${year}-${month}`;
  const ddmm = /^(\d{2})(\d{2})$/.exec(dayMonth ?? '');
  if (ddmm && valid(ddmm[2], 12) && valid(ddmm[1], 31)) return `${year}-${ddmm[2]}-${ddmm[1]}`;
  return year;
}

function clean(found: Found): Tags {
  const tags: { -readonly [K in keyof Tags]: Tags[K] } = {};
  const text = (field: Field) => list(found[field])[0];
  const title = text('title');
  if (title) tags.title = title;
  const album = text('album');
  if (album) tags.album = album;
  const multi = { artists: 'artist', albumArtists: 'albumArtist', genres: 'genre', releaseTypes: 'releaseType' } as const;
  for (const [key, field] of Object.entries(multi) as [keyof typeof multi, Field][]) {
    const values = list(found[field]);
    if (values.length) tags[key] = values;
  }
  const date = parseDate(text('date'), text('dayMonth'));
  if (date) tags.date = date;
  const originalDate = parseDate(text('originalDate'));
  if (originalDate) tags.originalDate = originalDate;
  const track = position(found.track);
  if (track) tags.track = track;
  const disc = position(found.disc);
  if (disc) tags.disc = disc;
  if (/^(1|true|yes)$/i.test(text('compilation') ?? '')) tags.compilation = true;
  for (const field of ['titleSort', 'artistSort', 'albumSort', 'albumArtistSort'] as const) {
    const value = text(field);
    if (value) tags[field] = value;
  }
  return tags;
}

// ID3v2

const ID3_FIELDS: Readonly<Record<string, Field>> = {
  TIT2: 'title',
  TT2: 'title',
  TPE1: 'artist',
  TP1: 'artist',
  TPE2: 'albumArtist',
  TP2: 'albumArtist',
  TALB: 'album',
  TAL: 'album',
  TCON: 'genre',
  TCO: 'genre',
  TDRC: 'date',
  TDRL: 'date',
  TYER: 'date',
  TYE: 'date',
  TDAT: 'dayMonth',
  TDA: 'dayMonth',
  TDOR: 'originalDate',
  TORY: 'originalDate',
  TOR: 'originalDate',
  TRCK: 'track',
  TRK: 'track',
  TPOS: 'disc',
  TPA: 'disc',
  TCMP: 'compilation',
  TCP: 'compilation',
  TSOT: 'titleSort',
  TST: 'titleSort',
  TSOP: 'artistSort',
  TSP: 'artistSort',
  TSOA: 'albumSort',
  TSA: 'albumSort',
  TSO2: 'albumArtistSort',
  TS2: 'albumArtistSort',
};

/**
 * The fields taggers such as MusicBrainz Picard write under a name of their own, uppercased: an
 * ID3v2 `TXXX` frame's description, a Vorbis comment's key, an MP4 freeform atom's name.
 */
const CUSTOM_FIELDS: Readonly<Record<string, Field>> = {
  'MUSICBRAINZ ALBUM TYPE': 'releaseType',
  MUSICBRAINZ_ALBUMTYPE: 'releaseType',
  RELEASETYPE: 'releaseType',
  'RELEASE TYPE': 'releaseType',
  ORIGINALDATE: 'originalDate',
  ORIGINALYEAR: 'originalDate',
  'ORIGINAL DATE': 'originalDate',
  ALBUMARTIST: 'albumArtist',
  'ALBUM ARTIST': 'albumArtist',
  ALBUMARTISTSORT: 'albumArtistSort',
  COMPILATION: 'compilation',
};

function fromId3(frames: Iterable<Id3Frame>, found: Found): void {
  for (const frame of frames) {
    const custom = frame.id === 'TXXX' || frame.id === 'TXX';
    const known = ID3_FIELDS[frame.id];
    if ((!known && !custom) || frame.size > MAX_TEXT_BYTES) continue;
    const body = frame.read();
    // 2.4 separates the values of a field with a zero; each may carry its own byte-order mark.
    const values = decode(body.subarray(1), body[0]!)
      .split('\0')
      .map((value) => value.replace(/\uFEFF/g, '').trim());
    // A user-defined frame is its description, then its values.
    const field = custom ? CUSTOM_FIELDS[(values.shift() ?? '').toUpperCase()] : known;
    if (!field) continue;
    const kept = values.filter(Boolean);
    fill(found, field, field === 'genre' ? kept.map(id3Genre) : kept);
  }
}

/**
 * A genre as ID3 writes it: a name, an ID3v1 genre number ("17", or "(17)" in 2.3), or numbers
 * refined by a name ("(17)Rock"); "(RX)" and "(CR)" stand for remix and cover.
 */
function id3Genre(value: string): string {
  const refs = /^(?:\((?:\d+|RX|CR)\))+/.exec(value)?.[0];
  if (refs) {
    const rest = value.slice(refs.length).trim();
    if (rest) return rest;
    return [...refs.matchAll(/\((\d+|RX|CR)\)/g)]
      .map(([, ref]) => (ref === 'RX' ? 'Remix' : ref === 'CR' ? 'Cover' : (ID3V1_GENRES[Number(ref)] ?? '')))
      .filter(Boolean)
      .join(', ');
  }
  return /^\d{1,3}$/.test(value) ? (ID3V1_GENRES[Number(value)] ?? '') : value;
}

// ID3v1

/** The 128 bytes at the end of an MP3: fixed-width Latin-1 fields and a genre number. */
function id3v1Tags(file: ByteReader, found: Found): void {
  if (file.size < 128) return;
  const tag = file.read(file.size - 128, 128);
  if (ascii(tag, 0, 3) !== 'TAG') return;
  const text = (from: number, length: number) => {
    const field = tag.subarray(from, from + length);
    const end = field.indexOf(0);
    return latin1OrUtf8(end < 0 ? field : field.subarray(0, end));
  };
  fill(found, 'title', text(3, 30));
  fill(found, 'artist', text(33, 30));
  fill(found, 'album', text(63, 30));
  fill(found, 'date', text(93, 4));
  fill(found, 'genre', ID3V1_GENRES[tag[127]!]);
  // ID3v1.1 gives the comment's last byte to the track number, after a zero.
  if (tag[125] === 0 && tag[126]) fill(found, 'track', String(tag[126]));
}

// FLAC and Ogg

/** The metadata blocks that open a FLAC stream; block 4 holds its comments. */
function flacTags(file: ByteReader, at: number, found: Found): void {
  while (at + 4 <= file.size) {
    const header = file.read(at, 4);
    const length = uint24(header, 1);
    at += 4;
    if ((header[0]! & 0x7f) === 4) return vorbisComments(file.read(at, Math.min(length, MAX_COMMENT_BYTES)), found);
    if (header[0]! & 0x80) return;
    at += length;
  }
}

/**
 * The comments of an Ogg stream, its second packet, gathered from the pages that carry it: each
 * page lists its segments' lengths, and a segment shorter than 255 bytes ends a packet.
 */
function oggTags(file: ByteReader, at: number, found: Found): void {
  const chunks: Uint8Array[] = [];
  let collected = 0;
  let packet = 0;
  while (packet < 2 && collected < MAX_COMMENT_BYTES && at + 27 <= file.size) {
    const header = file.read(at, 27);
    if (ascii(header, 0, 4) !== 'OggS') break;
    const lacing = file.read(at + 27, header[26]!);
    const data = file.read(at + 27 + lacing.length, lacing.reduce((sum, n) => sum + n, 0));
    let offset = 0;
    for (const length of lacing) {
      if (packet === 1) {
        chunks.push(data.subarray(offset, offset + length));
        collected += length;
      }
      offset += length;
      if (length < 255 && ++packet === 2) break;
    }
    at += 27 + lacing.length + data.length;
  }
  const comments = new Uint8Array(collected);
  let offset = 0;
  for (const chunk of chunks) {
    comments.set(chunk, offset);
    offset += chunk.length;
  }
  if (ascii(comments, 0, 7) === '\u0003vorbis') vorbisComments(comments.subarray(7), found);
  else if (ascii(comments, 0, 8) === 'OpusTags') vorbisComments(comments.subarray(8), found);
}

const VORBIS_FIELDS: Readonly<Record<string, Field>> = {
  ...CUSTOM_FIELDS,
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  GENRE: 'genre',
  DATE: 'date',
  YEAR: 'date',
  TRACKNUMBER: 'track',
  DISCNUMBER: 'disc',
  TITLESORT: 'titleSort',
  ARTISTSORT: 'artistSort',
  ALBUMSORT: 'albumSort',
};

/** A vendor string, then `KEY=value` comments in UTF-8, each after its length. A key may repeat. */
function vorbisComments(b: Uint8Array, found: Found): void {
  if (b.length < 8) return;
  let at = 4 + uint32le(b, 0);
  const count = at + 4 <= b.length ? uint32le(b, at) : 0;
  at += 4;
  const values: Partial<Record<Field, string[]>> = {};
  for (let i = 0; i < count && at + 4 <= b.length; i++) {
    const length = uint32le(b, at);
    at += 4;
    if (at + length > b.length) break;
    const comment = b.subarray(at, at + length);
    at += length;
    const equals = comment.indexOf(0x3d);
    const field = equals > 0 ? VORBIS_FIELDS[ascii(comment, 0, equals).toUpperCase()] : undefined;
    if (field && length <= MAX_TEXT_BYTES) (values[field] ??= []).push(utf8(comment.subarray(equals + 1)).trim());
  }
  for (const field of Object.keys(values) as Field[]) fill(found, field, values[field]);
}

// WAV

/** The RIFF chunks after the WAVE header. An `id3 ` chunk wins over the LIST INFO one. */
function wavTags(file: ByteReader, at: number, found: Found): void {
  let id3: Box | null = null;
  let info: Box | null = null;
  while (at + 8 <= file.size) {
    const header = file.read(at, 8);
    const id = ascii(header, 0, 4);
    const size = uint32le(header, 4);
    at += 8;
    if (id.toLowerCase() === 'id3 ') id3 ??= { start: at, end: at + size };
    else if (id === 'LIST' && size <= MAX_COMMENT_BYTES && ascii(file.read(at, 4), 0, 4) === 'INFO') {
      info ??= { start: at + 4, end: at + size };
    }
    at += size + (size & 1);
  }
  if (id3) fromId3(id3Frames(subReader(file, id3.start, id3.end - id3.start)), found);
  if (info) riffInfo(file.read(info.start, info.end - info.start), found);
}

const INFO_FIELDS: Readonly<Record<string, Field>> = {
  INAM: 'title',
  IART: 'artist',
  IPRD: 'album',
  IGNR: 'genre',
  ICRD: 'date',
  ITRK: 'track',
  IPRT: 'track',
};

function riffInfo(b: Uint8Array, found: Found): void {
  let at = 0;
  while (at + 8 <= b.length) {
    const id = ascii(b, at, at + 4);
    const size = uint32le(b, at + 4);
    const text = b.subarray(at + 8, at + 8 + size);
    const end = text.indexOf(0);
    const field = INFO_FIELDS[id];
    if (field) fill(found, field, latin1OrUtf8(end < 0 ? text : text.subarray(0, end)));
    at += 8 + size + (size & 1);
  }
}

// MP4

const MP4_FIELDS: Readonly<Record<string, Field>> = {
  '\u00a9nam': 'title',
  '\u00a9ART': 'artist',
  aART: 'albumArtist',
  '\u00a9alb': 'album',
  '\u00a9gen': 'genre',
  gnre: 'genre',
  '\u00a9day': 'date',
  trkn: 'track',
  disk: 'disc',
  cpil: 'compilation',
  sonm: 'titleSort',
  soar: 'artistSort',
  soal: 'albumSort',
  soaa: 'albumArtistSort',
};

/**
 * The iTunes atoms in `moov/udta/meta/ilst`, each holding `data` atoms: a type, a locale, then the
 * value. A freeform `----` atom names its field in a `name` atom, as Picard writes MusicBrainz's.
 */
function mp4Tags(file: ByteReader, at: number, found: Found): void {
  let box: Box | null = { start: at, end: file.size };
  for (const type of ['moov', 'udta', 'meta', 'ilst']) {
    // `meta` is a full box: a version and flags come before its children.
    const start = type === 'ilst' ? box.start + 4 : box.start;
    box = findBox(file, start, box.end, type);
    if (!box) return;
  }
  for (const item of children(file, box.start, box.end)) {
    const field = item.type === '----' ? freeformField(file, item) : MP4_FIELDS[item.type];
    if (!field) continue;
    const values = [...children(file, item.start, item.end)]
      .filter((child) => child.type === 'data' && child.end - child.start <= MAX_TEXT_BYTES)
      .map((data) => mp4Value(item.type, file.read(data.start, data.end - data.start).subarray(8)));
    fill(found, field, values);
  }
}

function freeformField(file: ByteReader, item: Atom): Field | undefined {
  const name = [...children(file, item.start, item.end)].find((child) => child.type === 'name');
  // `name` is a full box: its text follows a version and flags.
  return name ? CUSTOM_FIELDS[utf8(file.read(name.start + 4, name.end - name.start - 4)).toUpperCase()] : undefined;
}

/** A value as text, from the atoms that hold numbers too: a genre, a track or disc, a flag. */
function mp4Value(type: string, value: Uint8Array): string | undefined {
  // `gnre` is an ID3v1 genre number, plus one, in two bytes.
  if (type === 'gnre') return ID3V1_GENRES[((value[0]! << 8) | value[1]!) - 1];
  // `trkn` and `disk`: two reserved bytes, then the position and the total, two bytes each.
  if (type === 'trkn' || type === 'disk') return String((value[2]! << 8) | value[3]!);
  if (type === 'cpil') return String(value[0] ?? 0);
  return utf8(value);
}

interface Atom extends Box {
  readonly type: string;
}

/** The boxes between `from` and `to`, each by its type and body. */
function* children(file: ByteReader, from: number, to: number): Generator<Atom> {
  let at = from;
  while (at + 8 <= to) {
    const header = file.read(at, 8);
    const size = ((header[0]! << 24) | (header[1]! << 16) | (header[2]! << 8) | header[3]!) >>> 0;
    if (size < 8) return;
    yield { type: ascii(header, 4, 8), start: at + 8, end: Math.min(at + size, to) };
    at += size;
  }
}

// Text

function decode(b: Uint8Array, encoding: number): string {
  if (encoding === 3) return utf8(b);
  if (encoding === 1) return utf16(b, true);
  if (encoding === 2) return utf16(b, false);
  return latin1OrUtf8(b);
}

/** UTF-16 in either byte order; a byte-order mark sets it, and one read backwards flips it. */
function utf16(b: Uint8Array, littleEndian: boolean): string {
  let out = '';
  let le = littleEndian;
  for (let i = 0; i + 1 < b.length; i += 2) {
    const unit = le ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!;
    if (unit === 0xfffe) le = !le;
    else if (unit !== 0xfeff) out += String.fromCharCode(unit);
  }
  return out;
}

function utf8(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const lead = b[i++]!;
    if (lead < 0x80) {
      out += String.fromCharCode(lead);
      continue;
    }
    const extra = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : -1;
    if (extra < 0 || i + extra > b.length) {
      out += '\ufffd';
      continue;
    }
    let point = lead & (0x3f >> extra);
    for (let k = 0; k < extra; k++) point = (point << 6) | (b[i++]! & 0x3f);
    out += point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
  }
  return out;
}

/**
 * Text a tag says is Latin-1. Many taggers write UTF-8 there anyway, which reads as "MÃºsica";
 * bytes that are valid UTF-8, with at least one character past ASCII, are taken as UTF-8.
 */
function latin1OrUtf8(b: Uint8Array): string {
  let multibyte = false;
  for (let i = 0; i < b.length; ) {
    const lead = b[i++]!;
    if (lead < 0x80) continue;
    const extra = lead >= 0xf8 ? -1 : lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc2 ? 1 : -1;
    if (extra < 0 || i + extra > b.length) return latin1(b);
    for (let k = 0; k < extra; k++) if ((b[i++]! & 0xc0) !== 0x80) return latin1(b);
    multibyte = true;
  }
  return multibyte ? utf8(b) : latin1(b);
}

function latin1(b: Uint8Array): string {
  let out = '';
  for (const byte of b) out += String.fromCharCode(byte);
  return out;
}

/** The genres ID3v1 numbers, with Winamp's additions up to 125. */
export const ID3V1_GENRES: readonly string[] = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
  'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk',
  'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic',
  'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes',
  'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
  'Folk', 'Folk-Rock', 'National Folk', 'Swing', 'Fast Fusion', 'Bebop', 'Latin', 'Revival', 'Celtic', 'Bluegrass',
  'Avantgarde', 'Gothic Rock', 'Progressive Rock', 'Psychedelic Rock', 'Symphonic Rock', 'Slow Rock', 'Big Band', 'Chorus', 'Easy Listening', 'Acoustic',
  'Humour', 'Speech', 'Chanson', 'Opera', 'Chamber Music', 'Sonata', 'Symphony', 'Booty Bass', 'Primus', 'Porn Groove',
  'Satire', 'Slow Jam', 'Club', 'Tango', 'Samba', 'Folklore', 'Ballad', 'Power Ballad', 'Rhythmic Soul', 'Freestyle',
  'Duet', 'Punk Rock', 'Drum Solo', 'A Cappella', 'Euro-House', 'Dance Hall',
];
