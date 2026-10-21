import { describe, expect, it } from 'vitest';
import { type Tags } from './embedded-tags.ts';
import { compareNames, newestFirst, sortGroups, sortKey, sortTracks } from './sorting.ts';
import { type Track, trackFromFile, withTags } from './track.ts';

const song = (id: string, tags: Tags, seconds = 200, added = 0): Track =>
  withTags(trackFromFile(id, `${id}.mp3`, seconds, { added }), tags);
const titles = (tracks: readonly Track[]) => tracks.map((track) => track.title);

describe('intelligent sorting', () => {
  it('skips a leading article and sorts numbers by their value', () => {
    expect(sortKey('The Beatles')).toBe('Beatles');
    expect(sortKey('Los Prisioneros')).toBe('Prisioneros');
    expect(sortKey("L'Arc-en-Ciel")).toBe('Arc-en-Ciel');
    expect(sortKey('The')).toBe('The');
    expect(sortKey('A Dios Le Pido')).toBe('A Dios Le Pido');
    expect(sortKey('An Awesome Wave')).toBe('Awesome Wave');
    expect(sortKey('The Beatles', '', false)).toBe('The Beatles');
    expect(compareNames('Track 2', 'Track 10')).toBeLessThan(0);
    expect(compareNames('Track 2', 'Track 10', '', '', false)).toBeGreaterThan(0);
  });

  it('sorts by the sort tag when the file has one', () => {
    expect(sortKey('Beyoncé', 'Knowles, Beyoncé')).toBe('Knowles, Beyoncé');
    const tracks = [song('1', { title: 'B' }), song('2', { title: 'A', titleSort: 'Z' })];
    expect(titles(sortTracks(tracks, { mode: 'name', ascending: true }))).toEqual(['B', 'A']);
  });
});

describe('sortTracks', () => {
  const tracks = [
    song('1', { title: 'Ocean', artists: ['The Zombies'], album: 'Odessey', date: '1968', track: 2 }, 180, 30),
    song('2', { title: 'Care of Cell 44', artists: ['The Zombies'], album: 'Odessey', date: '1968', track: 1 }, 240, 10),
    song('3', { title: 'Alpha', artists: ['Air'], album: 'Moon Safari', date: '1998', track: 1 }, 300, 20),
  ];

  it('sorts by name, artist, album, date, duration or date added, either way', () => {
    expect(titles(sortTracks(tracks, { mode: 'name', ascending: true }))).toEqual(['Alpha', 'Care of Cell 44', 'Ocean']);
    expect(titles(sortTracks(tracks, { mode: 'name', ascending: false }))).toEqual(['Ocean', 'Care of Cell 44', 'Alpha']);
    expect(titles(sortTracks(tracks, { mode: 'artist', ascending: true }))).toEqual(['Alpha', 'Care of Cell 44', 'Ocean']);
    expect(titles(sortTracks(tracks, { mode: 'album', ascending: true }))).toEqual(['Alpha', 'Care of Cell 44', 'Ocean']);
    expect(titles(sortTracks(tracks, { mode: 'date', ascending: false }))).toEqual(['Alpha', 'Ocean', 'Care of Cell 44']);
    expect(titles(sortTracks(tracks, { mode: 'duration', ascending: true }))).toEqual(['Ocean', 'Care of Cell 44', 'Alpha']);
    expect(titles(sortTracks(tracks, { mode: 'added', ascending: false }))).toEqual(['Ocean', 'Alpha', 'Care of Cell 44']);
  });

  it('puts an album in disc and track order, a song without a number last on its disc', () => {
    const album = [
      song('1', { title: 'Two', disc: 2, track: 1 }),
      song('2', { title: 'Loose' }),
      song('3', { title: 'One B', disc: 1, track: 2 }),
      song('4', { title: 'One A', track: 1 }),
    ];
    expect(titles(sortTracks(album, { mode: 'disc', ascending: true }))).toEqual(['One A', 'One B', 'Loose', 'Two']);
    expect(titles(sortTracks(album, { mode: 'track', ascending: true }))).toEqual(['One A', 'Two', 'One B', 'Loose']);
  });

  it('lists an artist\'s songs newest album first, each album in order', () => {
    expect(titles(newestFirst(tracks))).toEqual(['Alpha', 'Care of Cell 44', 'Ocean']);
  });
});

it('sorts albums, artists and genres by name, artist, date, duration, count or date added', () => {
  const groups = [
    { name: 'The Wall', artist: 'Pink Floyd', date: '1979', duration: 4800, count: 26, added: 1 },
    { name: 'Abbey Road', artist: 'The Beatles', date: '1969', duration: 2800, count: 17, added: 3 },
    { name: 'Discovery', artist: 'Daft Punk', date: '2001', duration: 3600, count: 14, added: 2 },
  ];
  const names = (sorted: readonly { name: string }[]) => sorted.map((group) => group.name);
  expect(names(sortGroups(groups, { mode: 'name', ascending: true }))).toEqual(['Abbey Road', 'Discovery', 'The Wall']);
  expect(names(sortGroups(groups, { mode: 'artist', ascending: true }))).toEqual(['Abbey Road', 'Discovery', 'The Wall']);
  expect(names(sortGroups(groups, { mode: 'date', ascending: true }))).toEqual(['Abbey Road', 'The Wall', 'Discovery']);
  expect(names(sortGroups(groups, { mode: 'duration', ascending: false }))).toEqual(['The Wall', 'Discovery', 'Abbey Road']);
  expect(names(sortGroups(groups, { mode: 'count', ascending: true }))).toEqual(['Discovery', 'Abbey Road', 'The Wall']);
  expect(names(sortGroups(groups, { mode: 'added', ascending: true }))).toEqual(['The Wall', 'Discovery', 'Abbey Road']);
});

it('puts what lacks the value sorted by last, whichever way', () => {
  const tracks = [song('1', { title: 'Undated' }), song('2', { title: 'Old', date: '1970' }), song('3', { title: 'New', date: '2020' })];
  expect(titles(sortTracks(tracks, { mode: 'date', ascending: true }))).toEqual(['Old', 'New', 'Undated']);
  expect(titles(sortTracks(tracks, { mode: 'date', ascending: false }))).toEqual(['New', 'Old', 'Undated']);
  const groups = [
    { name: 'B', date: '', duration: 0, count: 0, added: 0 },
    { name: 'A', date: '1999', duration: 0, count: 0, added: 0 },
  ];
  expect(sortGroups(groups, { mode: 'date', ascending: false }).map((group) => group.name)).toEqual(['A', 'B']);
});
