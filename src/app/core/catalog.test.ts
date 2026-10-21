import { expect, it } from 'vitest';
import { buildCatalog } from './catalog.ts';
import { type Tags } from './embedded-tags.ts';
import { type Track, trackFromFile, withTags } from './track.ts';

const song = (id: string, folder: string, tags: Tags): Track =>
  withTags(trackFromFile(id, `${id}.mp3`, 100, { path: `${folder}/${id}.mp3` }), tags);

const library = [
  song('1', '/m/queen', { title: 'Hits One', album: 'Greatest Hits', albumArtists: ['Queen'], artists: ['Queen'], track: 1, date: '1981' }),
  song('2', '/m/abba', { title: 'Hits Two', album: 'Greatest Hits', albumArtists: ['ABBA'], artists: ['ABBA'], track: 1, date: '1975' }),
  song('3', '/m/queen', { title: 'Second', album: 'Greatest Hits', albumArtists: ['Queen'], artists: ['Queen'], disc: 2, track: 1 }),
  song('4', '/m/queen', { title: 'First', album: 'Greatest Hits', albumArtists: ['Queen'], artists: ['Queen'], disc: 1, track: 2 }),
  song('5', '/m/duets', { title: 'Duet', album: 'Duets', albumArtists: ['Various Artists'], artists: ['Queen', 'David Bowie'], releaseTypes: ['compilation'] }),
  song('6', '/m/loose', { title: 'Loose A', album: 'Mixes', artists: ['DJ A'], genres: ['House'] }),
  song('7', '/m/loose', { title: 'Loose B', album: 'Mixes', artists: ['DJ B'], genres: ['House', 'Techno'] }),
  song('8', '/m/other', { title: 'Loose C', album: 'Mixes', artists: ['DJ A'] }),
  song('9', '/m/single', { title: 'No Album', artists: ['Solo'] }),
];
const catalog = buildCatalog(library);
const titles = (tracks: readonly Track[]) => tracks.map((track) => track.title);
const albumOf = (id: string) => catalog.albums.find((album) => album.tracks.some((track) => track.id === id))!;

it('tells albums of the same name apart by their album artist, or without one by their folder', () => {
  expect(catalog.albums.map((album) => album.name).sort()).toEqual(['Duets', 'Greatest Hits', 'Greatest Hits', 'Mixes', 'Mixes']);
  expect(albumOf('1')).not.toBe(albumOf('2'));
  expect(albumOf('6')).toBe(albumOf('7'));
  expect(albumOf('6')).not.toBe(albumOf('8'));
});

it('puts an album in disc and track order, and counts its discs', () => {
  const queen = albumOf('1');
  expect(titles(queen.tracks)).toEqual(['Hits One', 'First', 'Second']);
  expect(queen).toMatchObject({ artist: 'Queen', discs: 2, count: 3, duration: 300, date: '1981' });
});

it('names an album without an album artist by its one artist, or as by various artists', () => {
  expect(albumOf('8')).toMatchObject({ artist: 'DJ A', various: false });
  expect(albumOf('6')).toMatchObject({ artist: '', various: true });
  expect(albumOf('5').releaseType).toEqual({ kind: 'compilation', refinement: null });
});

it("lists an artist's own albums, and the albums by others they appear on", () => {
  const queen = catalog.artist.get('queen')!;
  expect(queen.albums.map((album) => album.name)).toEqual(['Greatest Hits']);
  expect(queen.appearsOn.map((album) => album.name)).toEqual(['Duets']);
  expect(titles(queen.tracks).sort()).toEqual(['Duet', 'First', 'Hits One', 'Second']);
  const various = catalog.artist.get('various artists')!;
  expect(various.albums.map((album) => album.name)).toEqual(['Duets']);
  expect(catalog.artist.get('solo')).toMatchObject({ albums: [], count: 1 });
});

it('gathers a genre\'s songs and artists', () => {
  expect(catalog.genre.get('house')).toMatchObject({ name: 'House', count: 2, artistKeys: ['dj a', 'dj b'] });
  expect(catalog.genre.get('techno')?.count).toBe(1);
});

it('credits an album with no album artist to the artists all its songs share', () => {
  const trenza = buildCatalog([
    song('1', '/m/trenza', { title: 'Amárrame', album: 'La Trenza', artists: ['Mon Laferte, Juanes'] }),
    song('2', '/m/trenza', { title: 'Mi Buen Amor', album: 'La Trenza', artists: ['Mon Laferte, Bunbury'] }),
  ]);
  expect(trenza.albums[0]).toMatchObject({ artist: 'Mon Laferte', various: false, artists: [{ key: 'mon laferte', name: 'Mon Laferte' }] });
  expect(trenza.artist.get('mon laferte')?.albums).toHaveLength(1);
  expect(trenza.artist.get('juanes')?.appearsOn.map((album) => album.name)).toEqual(['La Trenza']);
});
