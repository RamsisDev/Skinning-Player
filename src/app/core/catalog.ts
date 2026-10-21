import { Service, computed, inject } from '@angular/core';
import { type FacetValue, albumKey, entriesOf } from './library-filter.ts';
import { MusicLibrary } from './music-library.ts';
import { PLAIN_ALBUM, type ReleaseType } from './release-type.ts';
import { type Sort, type Sortable, discOrder, newestFirst as newestSongsFirst, sortTracks } from './sorting.ts';
import { type Track, fold } from './track.ts';

/** The songs that share an album name and album artist (or folder), in disc and track order. */
export interface Album extends Sortable {
  readonly key: string;
  readonly sortName: string;
  /** Its album artists, or without them the artists of its songs. */
  readonly artists: readonly FacetValue[];
  /** The album artists as the files name them, or its songs' one artist; empty for various artists. */
  readonly artist: string;
  readonly sortArtist: string;
  /** Whether its songs are by different artists and no album artist is named. */
  readonly various: boolean;
  /** The earliest date of its songs. */
  readonly date: string;
  readonly releaseType: ReleaseType;
  readonly tracks: readonly Track[];
  /** How many discs it spans: more than one splits its songs under a heading per disc. */
  readonly discs: number;
}

/** A name that sings songs or has albums, which Auxio lists as one artist either way. */
export interface Artist extends Sortable {
  readonly key: string;
  readonly sortName: string;
  /** The albums they are the album artist of, or the artist of when an album names none, newest first. */
  readonly albums: readonly Album[];
  /** Albums by others that they sing on, newest first. */
  readonly appearsOn: readonly Album[];
  /** Their songs and the songs of their albums. */
  readonly tracks: readonly Track[];
}

export interface Genre extends Sortable {
  readonly key: string;
  readonly tracks: readonly Track[];
  /** The artists of its songs, by key. */
  readonly artistKeys: readonly string[];
}

export interface Catalog {
  readonly albums: readonly Album[];
  readonly artists: readonly Artist[];
  readonly genres: readonly Genre[];
  readonly album: ReadonlyMap<string, Album>;
  readonly artist: ReadonlyMap<string, Artist>;
  readonly genre: ReadonlyMap<string, Genre>;
}

const durationOf = (tracks: readonly Track[]) => tracks.reduce((sum, track) => sum + track.duration, 0);
const latest = (tracks: readonly Track[]) => tracks.reduce((max, track) => Math.max(max, track.added), 0);
const newestFirst = (a: Album, b: Album) => (b.date || '').localeCompare(a.date || '');

/** The spelling most of the values use. */
function mostUsed(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].reduce((best, next) => (next[1] > best[1] ? next : best))[0];
}

/** The value kept under `key`, made and kept first if there is none. */
function bucket<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let value = map.get(key);
  if (value === undefined) map.set(key, (value = make()));
  return value;
}

function uniqueEntries(entries: readonly FacetValue[]): FacetValue[] {
  const seen = new Map<string, FacetValue>();
  for (const entry of entries) if (!seen.has(entry.key)) seen.set(entry.key, entry);
  return [...seen.values()];
}

function buildAlbum(key: string, tracks: Track[]): Album {
  tracks.sort(discOrder);
  const named = tracks.filter((track) => track.albumArtists.length);
  const asEntries = (names: readonly string[]) => names.map((name) => ({ key: fold(name), name }));
  // Without album artists, an album is by the artists all its songs share, such as Mon Laferte on
  // "Mon Laferte, Juanes" and "Mon Laferte, Bunbury"; the others appear on it.
  const shared = named.length
    ? []
    : uniqueEntries(asEntries(tracks[0]!.artists)).filter(({ key }) =>
        tracks.every((track) => track.artists.some((name) => fold(name) === key)),
      );
  const credits = new Set(tracks.map((track) => track.artist));
  const various = !named.length && credits.size > 1 && !shared.length;
  const artists = uniqueEntries(
    named.length
      ? named.flatMap((track) => asEntries(track.albumArtists))
      : shared.length
        ? shared
        : tracks.flatMap((track) => asEntries(track.artists)),
  );
  const lead = named[0] ?? tracks[0]!;
  const single = credits.size === 1;
  const dates = tracks.map((track) => track.date).filter(Boolean).sort();
  return {
    key,
    name: mostUsed(tracks.map((track) => track.album)),
    sortName: tracks.find((track) => track.sortAlbum)?.sortAlbum ?? '',
    artists,
    artist: various ? '' : named.length ? lead.albumArtist : single ? lead.artist : shared.map(({ name }) => name).join(', '),
    sortArtist: various ? '' : (named.length ? lead.sortAlbumArtist : single ? lead.sortArtist : '') || '',
    various,
    date: dates[0] ?? '',
    releaseType: tracks.find((track) => track.releaseType)?.releaseType ?? PLAIN_ALBUM,
    tracks,
    discs: new Set(tracks.map((track) => track.disc ?? 1)).size,
    duration: durationOf(tracks),
    count: tracks.length,
    added: latest(tracks),
  };
}

/** The albums, artists and genres the tracks make up, each once, in no particular order. */
export function buildCatalog(tracks: readonly Track[]): Catalog {
  const albumTracks = new Map<string, Track[]>();
  for (const track of tracks) {
    if (track.album) bucket(albumTracks, albumKey(track), () => []).push(track);
  }
  const albums = [...albumTracks].map(([key, songs]) => buildAlbum(key, songs));

  const artistNames = new Map<string, string[]>();
  const artistSorts = new Map<string, string>();
  const artistTracks = new Map<string, Set<Track>>();
  for (const track of tracks) {
    for (const { key, name } of entriesOf(track, 'artist')) {
      bucket(artistNames, key, () => []).push(name);
      bucket(artistTracks, key, () => new Set()).add(track);
    }
    // A sort tag names the whole credit, so it sorts an artist only when the credit is them alone.
    if (track.artists.length === 1 && track.sortArtist) artistSorts.set(fold(track.artists[0]!), track.sortArtist);
    if (track.albumArtists.length === 1 && track.sortAlbumArtist) artistSorts.set(fold(track.albumArtists[0]!), track.sortAlbumArtist);
  }
  const albumsOf = new Map<string, Album[]>();
  const sungOn = new Map<string, Set<Album>>();
  for (const album of albums) {
    for (const { key } of album.artists) bucket(albumsOf, key, () => []).push(album);
    for (const track of album.tracks) for (const name of track.artists) bucket(sungOn, fold(name), () => new Set()).add(album);
  }
  const artists = [...artistNames].map(([key, names]): Artist => {
    const own = (albumsOf.get(key) ?? []).sort(newestFirst);
    const appearsOn = [...(sungOn.get(key) ?? [])].filter((album) => !own.includes(album));
    const songs = new Set(artistTracks.get(key));
    for (const album of own) for (const track of album.tracks) songs.add(track);
    const all = [...songs];
    return {
      key,
      name: mostUsed(names),
      sortName: artistSorts.get(key) ?? '',
      albums: own,
      appearsOn: appearsOn.sort(newestFirst),
      tracks: all,
      duration: durationOf(all),
      count: all.length,
      added: latest(all),
    };
  });

  const genreTracks = new Map<string, { names: string[]; tracks: Track[] }>();
  for (const track of tracks) {
    for (const { key, name } of entriesOf(track, 'genre')) {
      const genre = bucket(genreTracks, key, () => ({ names: [], tracks: [] }));
      genre.names.push(name);
      genre.tracks.push(track);
    }
  }
  const genres = [...genreTracks].map(([key, { names, tracks: songs }]): Genre => ({
    key,
    name: mostUsed(names),
    tracks: songs,
    artistKeys: [...new Set(songs.flatMap((track) => track.artists.map(fold)))],
    duration: durationOf(songs),
    count: songs.length,
    added: latest(songs),
  }));

  return {
    albums,
    artists,
    genres,
    album: new Map(albums.map((album) => [album.key, album])),
    artist: new Map(artists.map((artist) => [artist.key, artist])),
    genre: new Map(genres.map((genre) => [genre.key, genre])),
  };
}

/** What opens on a screen of its own. */
export type CatalogKind = 'album' | 'artist' | 'genre';

/**
 * An album's, artist's or genre's name and songs, in the order its screen lists and plays them:
 * an album's as the user sorts albums, an artist's newest first, a genre's by name.
 */
export function songsOf(
  catalog: Catalog,
  kind: CatalogKind,
  key: string,
  albumSort: Sort,
  smart = true,
): { readonly name: string; readonly songs: Track[] } | null {
  if (kind === 'album') {
    const album = catalog.album.get(key);
    return album ? { name: album.name, songs: sortTracks(album.tracks, albumSort, smart) } : null;
  }
  if (kind === 'artist') {
    const artist = catalog.artist.get(key);
    return artist ? { name: artist.name, songs: newestSongsFirst(artist.tracks, smart) } : null;
  }
  const genre = catalog.genre.get(key);
  return genre ? { name: genre.name, songs: sortTracks(genre.tracks, { mode: 'name', ascending: true }, smart) } : null;
}

/** The library's albums, artists and genres, worked out again whenever its songs change. */
@Service()
export class CatalogService {
  private readonly library = inject(MusicLibrary);
  readonly catalog = computed(() => buildCatalog(this.library.tracks()));
}
