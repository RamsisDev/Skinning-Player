import { Storage } from '@ng-native/expo/async-storage';
import { injectService } from '@ng-native/testing';
import { expect, it } from 'vitest';
import { TRACKS, memoryStorage } from '../testing/fakes.ts';
import { Playlists } from './playlists.ts';

it('creates, fills, reorders and deletes playlists, and persists them', async () => {
  const disk = new Map<string, string>();
  const playlists = injectService(Playlists, { providers: [memoryStorage(disk)] });

  expect(playlists.create('   ')).toBeNull();
  const id = playlists.create('  Road trip  ', ['a'])!;
  expect(playlists.get(id)?.name).toBe('Road trip');

  expect(playlists.addTracks(id, ['a', 'b', 'c', 'b'])).toBe(2);
  expect(playlists.get(id)?.trackIds).toEqual(['a', 'b', 'c']);

  playlists.moveTrack(id, 'c', -1);
  playlists.moveTrack(id, 'a', -1);
  expect(playlists.get(id)?.trackIds).toEqual(['a', 'c', 'b']);

  playlists.removeTrack(id, 'a');
  playlists.rename(id, 'Night drive');
  expect(playlists.get(id)).toMatchObject({ name: 'Night drive', trackIds: ['c', 'b'] });

  await injectService(Storage).flush();
  expect(JSON.parse(disk.get('playlists')!)).toEqual([expect.objectContaining({ name: 'Night drive' })]);

  playlists.remove(id);
  expect(playlists.all()).toEqual([]);
});

it('leaves out songs that are no longer on the device', () => {
  const playlists = injectService(Playlists, { providers: [memoryStorage()] });
  const id = playlists.create('Mix', ['c', 'gone', 'a'])!;
  const library = new Map(TRACKS.map((track) => [track.id, track]));
  expect(playlists.tracksOf(playlists.get(id)!, library).map((track) => track.id)).toEqual(['c', 'a']);
});
