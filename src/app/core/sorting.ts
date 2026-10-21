import { type Track } from './track.ts';

/** What a list can be sorted by. Each list offers the modes that mean something for it. */
export type SortMode = 'name' | 'artist' | 'album' | 'date' | 'duration' | 'count' | 'disc' | 'track' | 'added';

export interface Sort {
  readonly mode: SortMode;
  readonly ascending: boolean;
}

/** The lists the user can sort, each kept its own way: the songs, the albums, an album's songs... */
export type SortedList = 'songs' | 'albums' | 'artists' | 'genres' | 'album';

/** The modes each list offers, in the order they are offered, as Auxio offers them. */
export const SORT_MODES: Readonly<Record<SortedList, readonly SortMode[]>> = {
  songs: ['name', 'artist', 'album', 'date', 'duration', 'added'],
  albums: ['name', 'artist', 'date', 'duration', 'count', 'added'],
  artists: ['name', 'duration', 'count'],
  genres: ['name', 'duration', 'count'],
  album: ['disc', 'track', 'name', 'duration', 'added'],
};

export const DEFAULT_SORTS: Readonly<Record<SortedList, Sort>> = {
  songs: { mode: 'name', ascending: true },
  albums: { mode: 'name', ascending: true },
  artists: { mode: 'name', ascending: true },
  genres: { mode: 'name', ascending: true },
  album: { mode: 'disc', ascending: true },
};

/** What a sorted thing has: a name, maybe a name to sort by, songs, and for an album an artist and a date. */
export interface Sortable {
  readonly name: string;
  readonly sortName?: string;
  readonly artist?: string;
  readonly sortArtist?: string;
  readonly date?: string;
  readonly duration: number;
  readonly count: number;
  readonly added: number;
}

/**
 * The articles that "intelligent" sorting skips at the start of a name, as Auxio skips "the" and
 * "an": "The Beatles" sorts under B, "Los Prisioneros" under P. Not "a", which in Spanish, Italian
 * and Portuguese is a preposition: "A Dios Le Pido" stays under A.
 */
const ARTICLES = /^(?:the|an|el|la|los|las|lo|une?|des|les?|l'|die|der|das|il|gli|os|as)\s+(?=\S)|^l'(?=\S)/i;

const plain = new Intl.Collator(undefined, { sensitivity: 'base' });
/** Numbers by their value, so that "Track 2" sorts before "Track 10". */
const natural = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** The text a name sorts by: its sort tag if the file has one, otherwise the name, intelligently or not. */
export function sortKey(name: string, sortName = '', smart = true): string {
  if (sortName) return sortName;
  return smart ? name.replace(ARTICLES, '') : name;
}

/** Compares names the way the user chose: intelligently (articles skipped, numbers by value) or as written. */
export function compareNames(a: string, b: string, aSort = '', bSort = '', smart = true): number {
  return (smart ? natural : plain).compare(sortKey(a, aSort, smart), sortKey(b, bSort, smart));
}

type Compare<T> = (a: T, b: T) => number;

const by =
  <T>(...compares: Compare<T>[]): Compare<T> =>
  (a, b) => {
    for (const compare of compares) {
      const order = compare(a, b);
      if (order) return order;
    }
    return 0;
  };

/** Missing numbers and dates go last, whatever the direction. */
const numbers = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);
const dates = (a: string, b: string) => (a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0);

/** The order of an album's songs: by disc, then by track number. */
export const discOrder: Compare<Track> = by(
  (a, b) => numbers(a.disc ?? 1, b.disc ?? 1),
  (a, b) => numbers(a.trackNumber, b.trackNumber),
);

/** An artist's songs as their albums came out, newest first, each album in disc and track order. */
export function newestFirst(tracks: readonly Track[], smart = true): Track[] {
  return [...tracks].sort(
    by(
      (a, b) => dates(b.date, a.date),
      (a, b) => compareNames(a.album, b.album, a.sortAlbum, b.sortAlbum, smart),
      discOrder,
      (a, b) => compareNames(a.title, b.title, a.sortTitle, b.sortTitle, smart),
    ),
  );
}

/** The songs sorted by `sort`, ties by name. A new array: the one given is left as it was. */
export function sortTracks(tracks: readonly Track[], sort: Sort, smart = true): Track[] {
  const name: Compare<Track> = (a, b) => compareNames(a.title, b.title, a.sortTitle, b.sortTitle, smart);
  const album: Compare<Track> = (a, b) => compareNames(a.album, b.album, a.sortAlbum, b.sortAlbum, smart);
  const artist: Compare<Track> = (a, b) =>
    compareNames(a.albumArtist || a.artist, b.albumArtist || b.artist, a.sortAlbumArtist || a.sortArtist, b.sortAlbumArtist || b.sortArtist, smart);
  const primary: Compare<Track> = {
    name,
    artist: by(artist, (a, b) => dates(a.date, b.date), album, discOrder),
    album: by(album, discOrder),
    date: by((a, b) => dates(a.date, b.date), album, discOrder),
    duration: (a: Track, b: Track) => a.duration - b.duration,
    count: name,
    disc: discOrder,
    track: by<Track>(
      (a, b) => numbers(a.trackNumber, b.trackNumber),
      (a, b) => numbers(a.disc ?? 1, b.disc ?? 1),
    ),
    added: (a: Track, b: Track) => a.added - b.added,
  }[sort.mode];
  const has: ((track: Track) => boolean) | undefined = {
    artist: (track: Track) => !!(track.albumArtist || track.artist),
    album: (track: Track) => !!track.album,
    date: (track: Track) => !!track.date,
    track: (track: Track) => track.trackNumber !== null,
  }[sort.mode as string];
  return directed(tracks, by(primary, name), name, sort.ascending, has);
}

/** Albums, artists or genres sorted by `sort`, ties by name. */
export function sortGroups<T extends Sortable>(groups: readonly T[], sort: Sort, smart = true): T[] {
  const name: Compare<T> = (a, b) => compareNames(a.name, b.name, a.sortName, b.sortName, smart);
  const primary: Compare<T> = {
    name,
    artist: by<T>(
      (a, b) => compareNames(a.artist ?? '', b.artist ?? '', a.sortArtist, b.sortArtist, smart),
      (a, b) => dates(a.date ?? '', b.date ?? ''),
    ),
    album: name,
    date: (a: T, b: T) => dates(a.date ?? '', b.date ?? ''),
    duration: (a: T, b: T) => a.duration - b.duration,
    count: (a: T, b: T) => a.count - b.count,
    disc: name,
    track: name,
    added: (a: T, b: T) => a.added - b.added,
  }[sort.mode];
  const has: ((group: T) => boolean) | undefined = {
    artist: (group: T) => !!group.artist,
    date: (group: T) => !!group.date,
  }[sort.mode as string];
  return directed(groups, by(primary, name), name, sort.ascending, has);
}

/**
 * Sorted either way. What lacks the value sorted by comes last, by name, whichever way: an album
 * without a date is neither the newest nor the oldest.
 */
function directed<T>(items: readonly T[], compare: Compare<T>, name: Compare<T>, ascending: boolean, has?: (item: T) => boolean): T[] {
  const known = has ? items.filter(has) : [...items];
  const unknown = has ? items.filter((item) => !has(item)) : [];
  return [...known.sort(ascending ? compare : (a, b) => compare(b, a)), ...unknown.sort(name)];
}
