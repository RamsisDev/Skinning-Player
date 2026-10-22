import { expect, it } from 'vitest';
import { type ContentRules, foldersOf, isHidden, isIncluded, isNonMusic, locate, pathOf } from './library-content.ts';
import { trackFromFile } from './track.ts';

const at = (path: string) => trackFromFile(path, path.split('/').pop()!, 100, { path });
const rules = (more: Partial<ContentRules> = {}): ContentRules => ({
  excludeNonMusic: true,
  includeHidden: false,
  folderMode: 'exclude',
  folders: [],
  ...more,
});

it('tells hidden files, and audio that is not music, by their folders', () => {
  expect(isHidden('/storage/emulated/0/.secret/a.mp3')).toBe(true);
  expect(isHidden('/storage/emulated/0/Music/.a.mp3')).toBe(true);
  expect(isHidden('/storage/emulated/0/Music/a.mp3')).toBe(false);
  expect(isNonMusic('/storage/emulated/0/Podcasts/show.mp3')).toBe(true);
  expect(isNonMusic('/storage/emulated/0/Ringtones/ring.ogg')).toBe(true);
  expect(isNonMusic('/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Voice Notes/1/a.opus')).toBe(true);
  expect(isNonMusic('/storage/emulated/0/Music/Recordings.mp3')).toBe(false);
});

it('leaves out hidden files and non-music unless asked, and the folders excluded with their subfolders', () => {
  const music = at('/s/Music/Rock/a.mp3');
  const podcast = at('/s/Podcasts/b.mp3');
  const hidden = at('/s/.hidden/c.mp3');
  expect([music, podcast, hidden].map((track) => isIncluded(track, rules()))).toEqual([true, false, false]);
  expect(isIncluded(podcast, rules({ excludeNonMusic: false }))).toBe(true);
  expect(isIncluded(hidden, rules({ includeHidden: true }))).toBe(true);
  expect(isIncluded(music, rules({ folders: ['/s/Music'] }))).toBe(false);
  expect(isIncluded(music, rules({ folders: ['/s/Mus'] }))).toBe(true);
  expect(isIncluded(music, rules({ folderMode: 'include', folders: ['/s/Music'] }))).toBe(true);
  expect(isIncluded(at('/s/Other/d.mp3'), rules({ folderMode: 'include', folders: ['/s/Music'] }))).toBe(false);
  expect(isIncluded(trackFromFile('x', 'x.mp3', 1), rules({ folderMode: 'include', folders: ['/s/Music'] }))).toBe(true);
});

it('lists the folders and the folders they are in, with how many files each holds, and says which volume a folder is on', () => {
  expect(foldersOf([at('/s/B/1.mp3'), at('/s/A/2.mp3'), at('/s/B/3.mp3')])).toEqual([
    { path: '/s', count: 3 },
    { path: '/s/A', count: 1 },
    { path: '/s/B', count: 2 },
  ]);
  expect(foldersOf([at('/storage/emulated/0/Music/Rock/1.mp3')]).map((folder) => folder.path)).toEqual([
    '/storage/emulated/0/Music',
    '/storage/emulated/0/Music/Rock',
  ]);
  expect(locate('/storage/emulated/0/Music/Rock')).toEqual({ volume: { kind: 'internal' }, inside: '/Music/Rock' });
  expect(locate('/storage/1A2B-3C4D/Music')).toEqual({ volume: { kind: 'external', name: '1A2B-3C4D' }, inside: '/Music' });
  expect(locate('/music')).toEqual({ volume: null, inside: '/music' });
});

it("reads a file's path from its uri", () => {
  expect(pathOf('file:///storage/emulated/0/Music/My%20Song.mp3')).toBe('/storage/emulated/0/Music/My Song.mp3');
  expect(pathOf('ph://ABC')).toBe('ph://ABC');
});
