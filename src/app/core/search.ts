import { type Group, groupsOf, names } from './library-filter.ts';
import { type Playlist } from './playlists.ts';
import { type Track, fold } from './track.ts';

/** What a search can be narrowed to, in the order its filters are offered. */
export const SEARCH_KINDS = ['songs', 'albums', 'artists', 'genres', 'playlists'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Everything a search looks through, grouped once per library rather than on every keystroke. */
export interface Searchable {
  readonly songs: readonly Track[];
  readonly albums: readonly Group[];
  readonly artists: readonly Group[];
  readonly genres: readonly Group[];
  readonly playlists: readonly Playlist[];
}

export type SearchResults = Searchable;

/** One line of the results: a section's heading, or something found. */
export type SearchRow =
  | { readonly kind: 'header'; readonly section: SearchKind }
  | { readonly kind: 'song'; readonly track: Track }
  | { readonly kind: 'group'; readonly group: Group }
  | { readonly kind: 'playlist'; readonly playlist: Playlist };

/** The sections in the order they are listed. */
const SECTIONS: readonly SearchKind[] = ['artists', 'albums', 'playlists', 'genres', 'songs'];

/** ASCII punctuation, which is dropped from a name before its last try. */
const PUNCTUATION = /[!-/:-@[-`{-~]/g;

export function searchable(tracks: readonly Track[], playlists: readonly Playlist[]): Searchable {
  return {
    songs: tracks,
    albums: groupsOf(tracks, 'album'),
    artists: groupsOf(tracks, 'artist'),
    genres: groupsOf(tracks, 'genre'),
    playlists,
  };
}

/**
 * Whether a name holds the query: the name as it is written, then without
 * its accents and punctuation, so "acdc" finds "AC/DC". Case and accents are folded on both sides,
 * so "musica" and "música" both find "Música".
 */
export function nameMatches(name: string, query: string): boolean {
  const wanted = fold(query.trim());
  if (!wanted) return false;
  const folded = fold(name);
  return folded.includes(wanted) || folded.replace(PUNCTUATION, '').includes(wanted);
}

/**
 * What the query finds among the kinds asked for, each by name; no kinds means all of them. A song
 * is also found by its file name. A blank query finds nothing.
 */
export function search(all: Searchable, query: string, kinds: readonly SearchKind[] = []): SearchResults {
  const wanted = (kind: SearchKind) => !!query.trim() && (!kinds.length || kinds.includes(kind));
  const groups = (kind: 'albums' | 'artists' | 'genres') =>
    wanted(kind) ? all[kind].filter((group) => nameMatches(group.name, query)).sort((a, b) => names.compare(a.name, b.name)) : [];
  return {
    songs: wanted('songs')
      ? all.songs
          .filter((track) => nameMatches(track.title, query) || fold(track.filename).includes(fold(query.trim())))
          .sort((a, b) => names.compare(a.title, b.title))
      : [],
    albums: groups('albums'),
    artists: groups('artists'),
    genres: groups('genres'),
    playlists: wanted('playlists')
      ? all.playlists.filter((playlist) => nameMatches(playlist.name, query)).sort((a, b) => names.compare(a.name, b.name))
      : [],
  };
}

/** The results as a list: each section that found something under its heading. */
export function resultRows(results: SearchResults): SearchRow[] {
  return SECTIONS.flatMap((section): SearchRow[] => {
    const rows: SearchRow[] =
      section === 'songs'
        ? results.songs.map((track) => ({ kind: 'song', track }))
        : section === 'playlists'
          ? results.playlists.map((playlist) => ({ kind: 'playlist', playlist }))
          : results[section].map((group) => ({ kind: 'group', group }));
    return rows.length ? [{ kind: 'header', section }, ...rows] : [];
  });
}

/** A row's identity, for the list and for the selection. */
export function rowKey(row: SearchRow): string {
  switch (row.kind) {
    case 'header':
      return `header:${row.section}`;
    case 'song':
      return `song:${row.track.id}`;
    case 'group':
      return `${row.group.facet}:${row.group.key}`;
    case 'playlist':
      return `playlist:${row.playlist.id}`;
  }
}
