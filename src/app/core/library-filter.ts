import { type Track, fold } from './track.ts';

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

/**
 * What separates the artists of a song with several: "Mon Laferte, Juanes", "A; B", "A / B",
 * "A feat. B". A plain "&" or "/" is left alone, as in "Simon & Garfunkel" or "AC/DC".
 */
const ARTISTS = /\s*[,;]\s+|\s+\/\s+|\s+(?:feat\.?|ft\.|featuring)\s+/i;

/** A track's values for a facet: one artist each for a song by several. */
export function valuesOf(track: Track, facet: Facet): readonly string[] {
  if (facet === 'artist') return track.artist.split(ARTISTS).map((artist) => artist.trim()).filter(Boolean);
  const value = track[facet];
  return value ? [value] : [];
}

export function hasFilters(filters: Filters): boolean {
  return FACETS.some((facet) => !!filters[facet]);
}

/** Whether the track has every value picked, ignoring the facet `except` names. */
export function matchesFilters(track: Track, filters: Filters, except?: Facet): boolean {
  return FACETS.every((facet) => {
    const key = filters[facet];
    return !key || facet === except || valuesOf(track, facet).some((value) => fold(value) === key);
  });
}

const names = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Every value the tracks have for a facet, with how many of them have it: by name, years newest first. */
export function facetOptions(tracks: readonly Track[], facet: Facet): FacetOption[] {
  const found = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const track of tracks) {
    const seen = new Set<string>();
    for (const value of valuesOf(track, facet)) {
      const key = fold(value);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = found.get(key) ?? { count: 0, spellings: new Map<string, number>() };
      entry.count++;
      entry.spellings.set(value, (entry.spellings.get(value) ?? 0) + 1);
      found.set(key, entry);
    }
  }
  const options = [...found].map(([key, { count, spellings }]) => {
    const [label] = [...spellings].reduce((best, next) => (next[1] > best[1] ? next : best));
    return { key, label, count };
  });
  return facet === 'year'
    ? options.sort((a, b) => b.label.localeCompare(a.label))
    : options.sort((a, b) => names.compare(a.label, b.label));
}
