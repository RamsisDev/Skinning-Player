import { type Track, fold, folderOf } from './track.ts';

/** The details a library can be filtered by, in the order their filters are offered. */
export const FACETS = ['artist', 'album', 'genre', 'year'] as const;
export type Facet = (typeof FACETS)[number];

/** The value picked for each facet, as its key: folded, so "El Cuarteto De Nos" and "El Cuarteto de Nos" are one. */
export type Filters = Partial<Record<Facet, string>>;

export interface FacetOption {
  readonly key: string;
  /** The spelling most of its songs use. */
  readonly label: string;
  readonly count: number;
}

/** One value of a facet a track has: its name, and the key that tells it apart from others. */
export interface FacetValue {
  readonly key: string;
  readonly name: string;
}

/**
 * Which album a track is on. Two albums can share a name, such as "Greatest Hits", so the name is
 * not enough: an album is its name and its album artists, or without album artists,
 * its name and the folder its songs are in.
 */
export function albumKey(track: Track): string {
  const by = track.albumArtists.length ? track.albumArtists.map(fold).join('\u0001') : folderOf(track);
  return `${fold(track.album)}\u0000${by}`;
}

/**
 * A track's values for a facet. An artist's songs are the ones they sing and the ones on their
 * albums, so a track counts for its artists and its album artists.
 */
export function entriesOf(track: Track, facet: Facet): readonly FacetValue[] {
  switch (facet) {
    case 'artist': {
      const seen = new Set<string>();
      return [...track.artists, ...track.albumArtists].flatMap((name) => {
        const key = fold(name);
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ key, name }];
      });
    }
    case 'album':
      return track.album ? [{ key: albumKey(track), name: track.album }] : [];
    case 'genre':
      return track.genres.map((name) => ({ key: fold(name), name }));
    case 'year':
      return track.year ? [{ key: track.year, name: track.year }] : [];
  }
}

/** A track's values for a facet, by name: one artist each for a song by several. */
export function valuesOf(track: Track, facet: Facet): readonly string[] {
  return entriesOf(track, facet).map((entry) => entry.name);
}

export function hasFilters(filters: Filters): boolean {
  return FACETS.some((facet) => !!filters[facet]);
}

/** Whether the track has every value picked, ignoring the facet `except` names. */
export function matchesFilters(track: Track, filters: Filters, except?: Facet): boolean {
  return FACETS.every((facet) => {
    const key = filters[facet];
    return !key || facet === except || entriesOf(track, facet).some((entry) => entry.key === key);
  });
}

export const names = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** The songs that share a value of a facet: an album, an artist, a genre or a year. */
export interface Group {
  readonly facet: Facet;
  readonly key: string;
  /** The spelling most of its songs use. */
  readonly name: string;
  /** In the order they were given. */
  readonly tracks: readonly Track[];
}

/** The tracks gathered by each value they have for a facet, in the order the values first appear. */
export function groupsOf(tracks: readonly Track[], facet: Facet): Group[] {
  const found = new Map<string, { tracks: Track[]; spellings: Map<string, number> }>();
  for (const track of tracks) {
    for (const { key, name } of entriesOf(track, facet)) {
      const entry = found.get(key) ?? { tracks: [], spellings: new Map<string, number>() };
      entry.tracks.push(track);
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
      found.set(key, entry);
    }
  }
  return [...found].map(([key, { tracks, spellings }]) => {
    const [name] = [...spellings].reduce((best, next) => (next[1] > best[1] ? next : best));
    return { facet, key, name, tracks };
  });
}

/** Every value the tracks have for a facet, with how many of them have it: by name, years newest first. */
export function facetOptions(tracks: readonly Track[], facet: Facet): FacetOption[] {
  const options = groupsOf(tracks, facet).map(({ key, name, tracks }) => ({ key, label: name, count: tracks.length }));
  return facet === 'year'
    ? options.sort((a, b) => b.label.localeCompare(a.label))
    : options.sort((a, b) => names.compare(a.label, b.label));
}
