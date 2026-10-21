import { describe, expect, it } from 'vitest';
import { formatTime, matchesQuery, trackFromFile } from './track.ts';

describe('trackFromFile', () => {
  it('splits "Artist - Title" and drops the extension and track number', () => {
    expect(trackFromFile('1', '03 - Daft Punk - One More Time.mp3', 320)).toEqual({
      id: '1',
      title: 'One More Time',
      artist: 'Daft Punk',
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
