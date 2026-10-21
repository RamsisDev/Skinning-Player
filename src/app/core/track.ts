/** One audio file found on the device. `id` is the media store's asset id. */
export interface Track {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly filename: string;
  /** Seconds, or 0 when the media store does not know. */
  readonly duration: number;
}

const EXTENSION = /\.[a-z0-9]{2,5}$/i;
/** "03 - " or "03. ", but not the "50 " of "50 Cent". */
const TRACK_NUMBER = /^\d{1,3}\s*[-.]\s*/;

/**
 * Tracks are named from their file: the media store has no ID3 tags to offer. "Artist - Title.mp3"
 * is the common convention, so a dash splits the two; anything else is all title.
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
    filename,
    duration: duration && duration > 0 ? duration : 0,
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

export function matchesQuery(track: Track, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    track.title.toLowerCase().includes(needle) ||
    track.artist.toLowerCase().includes(needle) ||
    track.filename.toLowerCase().includes(needle)
  );
}
