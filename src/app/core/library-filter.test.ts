import { expect, it } from 'vitest';
import { type Tags } from './embedded-tags.ts';
import { facetOptions, hasFilters, matchesFilters, valuesOf } from './library-filter.ts';
import { type Track, trackFromFile, withTags } from './track.ts';

const song = (id: string, tags: Tags): Track => withTags(trackFromFile(id, `${id}.mp3`, 200), tags);

const library = [
  song('1', { title: 'A Dios Le Pido', artist: 'Juanes', album: 'Un Día Normal', year: '2002' }),
  song('2', { title: 'Amárrame', artist: 'Mon Laferte, Juanes', album: 'La Trenza', year: '2017' }),
  song('3', { title: 'Al Cielo No', artist: 'El Cuarteto De Nos', album: 'Canciones del Corazón', year: '2007' }),
  song('4', { title: 'Así Soy Yo', artist: 'El Cuarteto de Nos', album: 'Raro', year: '2006' }),
  song('5', { title: 'Untagged' }),
];

it('counts each artist of a song by several, and leaves names with "&" or "/" whole', () => {
  expect(valuesOf(library[1]!, 'artist')).toEqual(['Mon Laferte', 'Juanes']);
  expect(valuesOf(song('6', { artist: 'Simon & Garfunkel' }), 'artist')).toEqual(['Simon & Garfunkel']);
  expect(valuesOf(song('7', { artist: 'AC/DC' }), 'artist')).toEqual(['AC/DC']);
  expect(valuesOf(song('8', { artist: 'Bad Bunny feat. Drake' }), 'artist')).toEqual(['Bad Bunny', 'Drake']);
  expect(valuesOf(library[4]!, 'album')).toEqual([]);
});

it('offers each value once with its count, under the spelling most songs use, sorted by name', () => {
  expect(facetOptions(library, 'artist')).toEqual([
    { key: 'el cuarteto de nos', label: 'El Cuarteto De Nos', count: 2 },
    { key: 'juanes', label: 'Juanes', count: 2 },
    { key: 'mon laferte', label: 'Mon Laferte', count: 1 },
  ]);
  expect(facetOptions(library, 'year').map((option) => option.label)).toEqual(['2017', '2007', '2006', '2002']);
  expect(facetOptions(library, 'genre')).toEqual([]);
});

it('keeps the songs that have every value picked, and can leave one filter out', () => {
  const filters = { artist: 'juanes', year: '2017' };
  expect(library.filter((track) => matchesFilters(track, filters)).map((track) => track.id)).toEqual(['2']);
  expect(library.filter((track) => matchesFilters(track, filters, 'year')).map((track) => track.id)).toEqual(['1', '2']);
  expect(library.filter((track) => matchesFilters(track, {})).length).toBe(5);
  expect(hasFilters({})).toBe(false);
  expect(hasFilters(filters)).toBe(true);
});
