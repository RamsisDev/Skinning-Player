import { expect, it } from 'vitest';
import { type Tags } from './embedded-tags.ts';
import { type Playlist } from './playlists.ts';
import { nameMatches, resultRows, rowKey, search, searchable } from './search.ts';
import { type Track, trackFromFile, withTags } from './track.ts';

const song = (id: string, filename: string, tags: Tags): Track => withTags(trackFromFile(id, filename, 200), tags);

const tracks = [
  song('1', 'juanes-1.mp3', { title: 'A Dios Le Pido', artists: ['Juanes'], album: 'Un Día Normal', genres: ['Rock'] }),
  song('2', 'amarrame.mp3', { title: 'Amárrame', artists: ['Mon Laferte, Juanes'], album: 'La Trenza', genres: ['Pop'] }),
  song('3', 'back-in-black.flac', { title: 'Back in Black', artists: ['AC/DC'], album: 'Back in Black', genres: ['Hard Rock'] }),
  song('4', 'voice-note-0412.m4a', { title: 'Untitled' }),
];
const playlists: Playlist[] = [
  { id: 'p1', name: 'Rock en español', trackIds: ['1', '2'], createdAt: 0 },
  { id: 'p2', name: 'Gym', trackIds: ['3'], createdAt: 0 },
];
const all = searchable(tracks, playlists);

it('matches a name as written, then without accents, case or punctuation', () => {
  expect(nameMatches('Amárrame', 'amarr')).toBe(true);
  expect(nameMatches('Amárrame', 'AMÁRR')).toBe(true);
  expect(nameMatches('AC/DC', 'acdc')).toBe(true);
  expect(nameMatches('AC/DC', 'ac/dc')).toBe(true);
  expect(nameMatches('Juanes', '  jua ')).toBe(true);
  expect(nameMatches('Juanes', 'jaunes')).toBe(false);
  expect(nameMatches('Juanes', '   ')).toBe(false);
});

it('finds songs, albums, artists, genres and playlists by name, and a song also by its file name', () => {
  const found = search(all, 'back');
  expect(found.songs.map((track) => track.title)).toEqual(['Back in Black']);
  expect(found.albums.map((album) => album.name)).toEqual(['Back in Black']);
  expect(found.artists).toEqual([]);

  expect(search(all, 'voice note').songs).toEqual([]);
  expect(search(all, 'voice-note').songs.map((track) => track.title)).toEqual(['Untitled']);
  expect(search(all, 'juanes').artists.map((artist) => [artist.name, artist.tracks.length])).toEqual([['Juanes', 2]]);
  expect(search(all, 'rock').genres.map((genre) => genre.name)).toEqual(['Hard Rock', 'Rock']);
  expect(search(all, 'rock').playlists.map((playlist) => playlist.name)).toEqual(['Rock en español']);
});

it('finds nothing for a blank query', () => {
  expect(resultRows(search(all, '  '))).toEqual([]);
});

it('narrows to the kinds asked for, and looks through all of them when none are', () => {
  const rock = search(all, 'rock', ['playlists']);
  expect(rock.playlists).toHaveLength(1);
  expect(rock.genres).toEqual([]);
  expect(search(all, 'rock', ['genres', 'playlists']).genres).toHaveLength(2);
});

it('lists artists, albums, playlists, genres and then songs, each by name under its heading', () => {
  const rows = resultRows(search(all, 'a'));
  const sections = rows.filter((row) => row.kind === 'header').map((row) => row.kind === 'header' && row.section);
  expect(sections).toEqual(['artists', 'albums', 'playlists', 'genres', 'songs']);
  expect(rows.map(rowKey).slice(0, 4)).toEqual(['header:artists', 'artist:ac/dc', 'artist:juanes', 'artist:mon laferte']);
  const songs = rows.slice(rows.findIndex((row) => rowKey(row) === 'header:songs') + 1);
  expect(songs.map(rowKey)).toEqual(['song:1', 'song:2', 'song:3', 'song:4']);
});
