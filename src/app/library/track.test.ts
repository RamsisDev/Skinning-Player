import { describe, expect, it } from 'vitest';
import { fold, formatTime, matchesQuery, splitValues, trackFromFile, withTags } from './track.ts';

describe('trackFromFile', () => {
  it('splits "Artist - Title" and drops the extension and track number', () => {
    expect(trackFromFile('1', '03 - Daft Punk - One More Time.mp3', 320)).toMatchObject({
      id: '1',
      title: 'One More Time',
      artist: 'Daft Punk',
      artists: ['Daft Punk'],
      album: '',
      genre: '',
      year: '',
      trackNumber: 3,
      filename: '03 - Daft Punk - One More Time.mp3',
      duration: 320,
    });
  });

  it('keeps a name without a dash as the title', () => {
    const track = trackFromFile('2', '07. intro_theme.m4a', null);
    expect(track.title).toBe('intro theme');
    expect(track.artist).toBe('');
    expect(track.duration).toBe(0);
  });

  it('does not mistake a number in an artist name for a track number', () => {
    expect(trackFromFile('3', '50 Cent - In da Club.mp3', 200).artist).toBe('50 Cent');
  });
});

describe('withTags', () => {
  it('names the track by its tags, and keeps the file name for what they leave out', () => {
    const track = withTags(trackFromFile('1', 'Bipolar_spotdown.org.mp3', 240), {
      title: 'Bipolar',
      album: 'Raro',
      date: '2006',
    });
    expect(track).toMatchObject({ title: 'Bipolar', artist: '', album: 'Raro', genre: '', year: '2006' });
    expect(withTags(trackFromFile('2', 'Queen - Bohemian Rhapsody.mp3', 354), {}).artist).toBe('Queen');
  });
});

describe('splitValues', () => {
  it('splits at the separators chosen, and at "feat." for artists', () => {
    expect(splitValues(['Mon Laferte, Juanes'], [',', ';'], true)).toEqual(['Mon Laferte', 'Juanes']);
    expect(splitValues(['A; B', 'C'], [',', ';'])).toEqual(['A', 'B', 'C']);
    expect(splitValues(['Bad Bunny feat. Drake'], [], true)).toEqual(['Bad Bunny', 'Drake']);
    expect(splitValues(['Bad Bunny feat. Drake'], [])).toEqual(['Bad Bunny feat. Drake']);
  });

  it('leaves a separator that is not chosen, or comes after a backslash, in the name', () => {
    expect(splitValues(['Simon & Garfunkel'], [',', ';'])).toEqual(['Simon & Garfunkel']);
    expect(splitValues(['AC/DC'], ['/'])).toEqual(['AC', 'DC']);
    expect(splitValues(['AC\\/DC'], ['/'])).toEqual(['AC/DC']);
    expect(splitValues(['Earth\\, Wind & Fire, Chicago'], [',', '&'])).toEqual(['Earth, Wind', 'Fire', 'Chicago']);
  });

  it('keeps each value once, whatever its case or accents', () => {
    expect(splitValues(['Maná, MANA', 'Mana'], [','])).toEqual(['Maná']);
  });
});

describe('withTags, with separators', () => {
  it('splits artists, album artists and genres by the separators given, and shows them as written', () => {
    const tags = { artists: ['A / B'], albumArtists: ['Various'], genres: ['Rock/Pop'] };
    const split = withTags(trackFromFile('1', 'x.mp3', 1), tags, ['/']);
    expect(split).toMatchObject({ artist: 'A / B', artists: ['A', 'B'], albumArtists: ['Various'], genres: ['Rock', 'Pop'] });
    expect(withTags(trackFromFile('1', 'x.mp3', 1), tags, [',']).artists).toEqual(['A / B']);
    expect(withTags(trackFromFile('1', 'x.mp3', 1), { artists: ['AC\\/DC'] }, ['/']).artist).toBe('AC/DC');
  });

  it('prefers the original date, and takes the numbers, release type and sort names', () => {
    const track = withTags(trackFromFile('1', '02 - x.mp3', 1), {
      date: '2011-03-14',
      originalDate: '1975-10-31',
      disc: 2,
      releaseTypes: ['ep'],
      titleSort: 'X',
    });
    expect(track).toMatchObject({ date: '1975-10-31', year: '1975', trackNumber: 2, disc: 2, sortTitle: 'X' });
    expect(track.releaseType).toEqual({ kind: 'ep', refinement: null });
  });

  it('takes the album artists for a track whose file names no artist', () => {
    expect(withTags(trackFromFile('1', 'x.mp3', 1), { albumArtists: ['Blondie'] }).artists).toEqual(['Blondie']);
  });
});

it('formats times as m:ss and h:mm:ss', () => {
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(65.9)).toBe('1:05');
  expect(formatTime(3723)).toBe('1:02:03');
  expect(formatTime(Number.NaN)).toBe('0:00');
});

it('matches a search on title, artist or file name', () => {
  const track = trackFromFile('1', 'Queen - Bohemian Rhapsody.mp3', 354);
  expect(matchesQuery(track, 'queen')).toBe(true);
  expect(matchesQuery(track, 'RHAP')).toBe(true);
  expect(matchesQuery(track, '.mp3')).toBe(true);
  expect(matchesQuery(track, 'abba')).toBe(false);
  expect(matchesQuery(track, '  ')).toBe(true);
});

it('matches every word of a search across the album, genre and year too, with or without accents', () => {
  const track = withTags(trackFromFile('1', 'track01.mp3', 250), {
    title: 'De Música Ligera',
    artists: ['Soda Stereo'],
    album: 'Canción Animal',
    genres: ['Rock en Español'],
    date: '1990',
  });
  expect(matchesQuery(track, 'musica')).toBe(true);
  expect(matchesQuery(track, 'CANCION animal')).toBe(true);
  expect(matchesQuery(track, 'soda 1990')).toBe(true);
  expect(matchesQuery(track, 'espanol')).toBe(true);
  expect(matchesQuery(track, 'soda 1991')).toBe(false);
  expect(fold('Él Ñandú')).toBe('el nandu');
});
