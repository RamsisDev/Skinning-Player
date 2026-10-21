import { type Tags } from './embedded-tags.ts';

/** One audio file found on the device. `id` is the media store's asset id. */
export interface Track {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  /** Empty when the file does not say, as are the genre and the year. */
  readonly album: string;
  readonly genre: string;
  readonly year: string;
  readonly filename: string;
  /** Seconds, or 0 when the media store does not know. */
  readonly duration: number;
}

const EXTENSION = /\.[a-z0-9]{2,5}$/i;
/** "03 - " or "03. ", but not the "50 " of "50 Cent". */
const TRACK_NUMBER = /^\d{1,3}\s*[-.]\s*/;

/**
 * A track named from its file, until its tags are read. "Artist - Title.mp3" is the common
 * convention, so a dash splits the two; anything else is all title.
 */
export function trackFromFile(id: string, filename: string, duration: number | null): Track {
  const base = filename.replace(EXTENSION, '').replace(/_/g, ' ').trim();
  const name = base.replace(TRACK_NUMBER, '');
  const dash = name.indexOf(' - ');
  const artist = dash > 0 ? name.slice(0, dash).trim() : '';
  const title = (dash > 0 ? name.slice(dash + 3) : name).trim();
  return {
    id,
    title: title || base || filename,
    artist,
    album: '',
    genre: '',
    year: '',
    filename,
    duration: duration && duration > 0 ? duration : 0,
  };
}

/** The track as its file's tags name it; what they leave out keeps the name from the file. */
export function withTags(track: Track, tags: Tags): Track {
  return {
    ...track,
    title: tags.title || track.title,
    artist: tags.artist || track.artist,
    album: tags.album || track.album,
    genre: tags.genre || track.genre,
    year: tags.year || track.year,
  };
}

/** `m:ss`, or `h:mm:ss` past an hour. */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** One collator for every comparison: `localeCompare` with options builds a new one each call. */
const titles = new Intl.Collator(undefined, { sensitivity: 'base' });

export function byTitle(a: Track, b: Track): number {
  return titles.compare(a.title, b.title);
}

/**
 * Lowercase and without accents, so that "musica" finds "Música". Hermes without Intl has no
 * `normalize`, and then only the case is folded.
 */
export function fold(text: string): string {
  const lower = text.toLowerCase();
  try {
    return lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return lower;
  }
}

/** Each track's searchable text, folded once rather than on every keystroke. */
const searchText = new WeakMap<Track, string>();

/** Whether every word of the query is in the track's title, artist, album, genre, year or file name. */
export function matchesQuery(track: Track, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchText.get(track) ?? indexText(track);
  return words.every((word) => text.includes(word));
}

function indexText(track: Track): string {
  const text = fold([track.title, track.artist, track.album, track.genre, track.year, track.filename].join('\n'));
  searchText.set(track, text);
  return text;
}
