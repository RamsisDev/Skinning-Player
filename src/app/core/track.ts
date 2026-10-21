import { type Tags } from './embedded-tags.ts';
import { type ReleaseType, parseReleaseType } from './release-type.ts';

/** One audio file found on the device. `id` is the media store's asset id. */
export interface Track {
  readonly id: string;
  readonly title: string;
  /** The artists as the file names them, to show; empty when it does not say. */
  readonly artist: string;
  /** Each of the artists, split by the separators the user chose. */
  readonly artists: readonly string[];
  /** Empty when the file does not say, as are the album artist, the genre and the dates. */
  readonly album: string;
  readonly albumArtist: string;
  readonly albumArtists: readonly string[];
  readonly genre: string;
  readonly genres: readonly string[];
  /** When the music came out, the original date before a reissue's: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  readonly date: string;
  /** The year of `date`. */
  readonly year: string;
  readonly trackNumber: number | null;
  readonly disc: number | null;
  /** Null when the file does not say, which an album takes as a plain album. */
  readonly releaseType: ReleaseType | null;
  /** The names to sort by, from the file's sort tags; empty when it has none. */
  readonly sortTitle: string;
  readonly sortArtist: string;
  readonly sortAlbum: string;
  readonly sortAlbumArtist: string;
  readonly filename: string;
  /** Where the file is: a path, or the uri the platform gives when it is not a file. Empty until known. */
  readonly path: string;
  /** Bytes, or 0 when not known. */
  readonly size: number;
  /** Seconds, or 0 when the media store does not know. */
  readonly duration: number;
  /** When the file was added to the device, in milliseconds since 1970; 0 when not known. */
  readonly added: number;
}

/** What the media store and the file system say about a file, besides its name. */
export interface FileDetails {
  readonly path?: string;
  readonly size?: number;
  readonly added?: number | null;
}

/** What can separate the values of a tag that holds several, such as "Mon Laferte, Juanes". */
export const SEPARATORS = [',', ';', '/', '+', '&'] as const;
export type Separator = (typeof SEPARATORS)[number];

/** Commas and semicolons: "&" and "/" are left alone, so "Simon & Garfunkel" and "AC/DC" stay whole. */
export const DEFAULT_SEPARATORS: readonly Separator[] = [',', ';'];

const FEATURING = /\s+(?:feat\.?|ft\.|featuring)\s+/i;

/**
 * The values written in each of `values`, split at the separators given, and for artists at
 * "feat." too. A separator after a backslash is part of the name: "AC\/DC" stays "AC/DC".
 */
export function splitValues(values: readonly string[], separators: readonly Separator[], featuring = false): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const parts: string[] = [];
    let part = '';
    for (let i = 0; i < value.length; i++) {
      const c = value[i]!;
      const next = value[i + 1];
      if (c === '\\' && next && (SEPARATORS as readonly string[]).includes(next)) {
        part += next;
        i++;
      } else if ((separators as readonly string[]).includes(c)) {
        parts.push(part);
        part = '';
      } else part += c;
    }
    parts.push(part);
    for (const piece of featuring ? parts.flatMap((p) => p.split(FEATURING)) : parts) {
      const name = piece.trim();
      if (!name || seen.has(fold(name))) continue;
      seen.add(fold(name));
      out.push(name);
    }
  }
  return out;
}

/** Values as they are shown: as written, without the backslashes that kept a separator in a name. */
const shown = (values: readonly string[]): string => values.map((value) => value.replace(/\\([,;/+&])/g, '$1')).join(', ');

const EXTENSION = /\.[a-z0-9]{2,5}$/i;
/** "03 - " or "03. ", but not the "50 " of "50 Cent". */
const TRACK_NUMBER = /^(\d{1,3})\s*[-.]\s*/;

/**
 * A track named from its file, until its tags are read. "Artist - Title.mp3" is the common
 * convention, so a dash splits the two; anything else is all title. A leading "03 - " is its
 * track number.
 */
export function trackFromFile(id: string, filename: string, duration: number | null, file: FileDetails = {}): Track {
  const base = filename.replace(EXTENSION, '').replace(/_/g, ' ').trim();
  const number = TRACK_NUMBER.exec(base);
  const name = base.replace(TRACK_NUMBER, '');
  const dash = name.indexOf(' - ');
  const artist = dash > 0 ? name.slice(0, dash).trim() : '';
  const title = (dash > 0 ? name.slice(dash + 3) : name).trim();
  return {
    id,
    title: title || base || filename,
    artist,
    artists: splitValues(artist ? [artist] : [], DEFAULT_SEPARATORS, true),
    album: '',
    albumArtist: '',
    albumArtists: [],
    genre: '',
    genres: [],
    date: '',
    year: '',
    trackNumber: number && Number(number[1]) > 0 ? Number(number[1]) : null,
    disc: null,
    releaseType: null,
    sortTitle: '',
    sortArtist: '',
    sortAlbum: '',
    sortAlbumArtist: '',
    filename,
    path: file.path ?? '',
    size: file.size ?? 0,
    duration: duration && duration > 0 ? duration : 0,
    added: file.added ?? 0,
  };
}

/**
 * The track as its file's tags name it, its artists and genres split by `separators`; what the tags
 * leave out keeps the name from the file. The album artists stand in for a track's own artists
 * when the file names none.
 */
export function withTags(track: Track, tags: Tags, separators: readonly Separator[] = DEFAULT_SEPARATORS): Track {
  const artists = tags.artists ?? tags.albumArtists ?? (track.artist ? [track.artist] : []);
  const albumArtists = tags.albumArtists ?? [];
  const genres = tags.genres ?? (track.genre ? [track.genre] : []);
  const date = tags.originalDate || tags.date || track.date;
  return {
    ...track,
    title: tags.title || track.title,
    artist: shown(artists),
    artists: splitValues(artists, separators, true),
    album: tags.album || track.album,
    albumArtist: shown(albumArtists),
    albumArtists: splitValues(albumArtists, separators, true),
    genre: shown(genres),
    genres: splitValues(genres, separators),
    date,
    year: date.slice(0, 4),
    trackNumber: tags.track ?? track.trackNumber,
    disc: tags.disc ?? track.disc,
    releaseType: parseReleaseType(tags.releaseTypes ?? [], tags.compilation) ?? track.releaseType,
    sortTitle: tags.titleSort ?? track.sortTitle,
    sortArtist: tags.artistSort ?? track.sortArtist,
    sortAlbum: tags.albumSort ?? track.sortAlbum,
    sortAlbumArtist: tags.albumArtistSort ?? track.sortAlbumArtist,
  };
}

/** The folder a track's file is in, or empty when its path is not known. */
export function folderOf(track: Track): string {
  const slash = track.path.lastIndexOf('/');
  return slash > 0 ? track.path.slice(0, slash) : '';
}

/** `m:ss`, or `h:mm:ss` past an hour. */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Lowercase and without accents, so that "musica" finds "Música". Hermes without Intl has no
 * `normalize`, and then only the case is folded.
 */
export function fold(text: string): string {
  const lower = text.toLowerCase();
  try {
    return lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    return lower;
  }
}

/** Each track's searchable text, folded once rather than on every keystroke. */
const searchText = new WeakMap<Track, string>();

/** Whether every word of the query is in the track's title, artists, album, genre, year or file name. */
export function matchesQuery(track: Track, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchText.get(track) ?? indexText(track);
  return words.every((word) => text.includes(word));
}

function indexText(track: Track): string {
  const text = fold(
    [track.title, track.artist, track.albumArtist, track.album, track.genre, track.year, track.filename].join('\n'),
  );
  searchText.set(track, text);
  return text;
}
