import { Injector, computed, signal } from '@angular/core';
import { injectService, waitFor } from '@ng-native/testing';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/messages.ts';
import { engineProvider, fakeEngine, memoryStorage } from '../testing/fakes.ts';
import { AutoBrowse, type BrowseContent, browseTree, parseBrowseId } from './auto-browse.ts';
import { type BrowseNode } from '../audio/audio-engine.ts';
import { albumKey } from '../library/library-filter.ts';
import { MusicLibrary } from '../library/music-library.ts';
import { Player } from './player.ts';
import { Playlists } from '../playlists/playlists.ts';
import { type Track, trackFromFile } from '../library/track.ts';

const song = (id: string, title: string, artist: string, album: string, trackNumber: number): Track => ({
  ...trackFromFile(id, `${title}.mp3`, 100),
  title,
  artist,
  artists: artist ? [artist] : [],
  album,
  trackNumber,
});

const SONGS = [
  song('1', 'Mrs Robinson', 'Simon & Garfunkel', 'Bookends', 2),
  song('2', 'America', 'Simon & Garfunkel', 'Bookends', 1),
  song('3', 'La Camisa Negra', 'Juanes', 'Mi Sangre', 1),
  song('4', 'Untitled', '', '', 1),
];
const BOOKENDS = albumKey(SONGS[0]!);

/** Every id in the tree under `node`, itself included. */
const idsUnder = (node: BrowseNode): string[] => [node.id, ...(node.children ?? []).flatMap(idsUnder)];

describe('browseTree', () => {
  const content: BrowseContent = {
    songs: SONGS,
    albums: [{ key: BOOKENDS, name: 'Bookends', subtitle: 'Simon & Garfunkel', songs: [SONGS[1]!, SONGS[0]!] }],
    artists: [{ key: 'juanes', name: 'Juanes', songs: [SONGS[2]!] }],
    genres: [],
    playlists: [{ key: 'p1', name: 'Road trip', songs: [SONGS[2]!, SONGS[0]!] }],
  };

  it('opens on every song, the albums, artists, genres and playlists, named in the language in use', () => {
    const tree = browseTree(content, en);
    expect(tree.map((root) => [root.id, root.title])).toEqual([
      ['songs', 'Songs'],
      ['albums', 'Albums'],
      ['artists', 'Artists'],
      ['genres', 'Genres'],
      ['playlists', 'Playlists'],
    ]);
    expect(tree[0]!.children!.map((node) => [node.title, node.subtitle])).toEqual([
      ['Mrs Robinson', 'Simon & Garfunkel'],
      ['America', 'Simon & Garfunkel'],
      ['La Camisa Negra', 'Juanes'],
      ['Untitled', 'Unknown artist'],
    ]);
  });

  it('lists each folder with a line about it, and its songs in the order given', () => {
    const [, albums, artists, , playlists] = browseTree(content, en);
    const bookends = albums!.children![0]!;
    expect(bookends).toMatchObject({ title: 'Bookends', subtitle: 'Simon & Garfunkel' });
    expect(bookends.children!.map((node) => node.title)).toEqual(['America', 'Mrs Robinson']);
    expect(artists!.children![0]).toMatchObject({ title: 'Juanes', subtitle: '1 song' });
    expect(playlists!.children![0]).toMatchObject({ title: 'Road trip', subtitle: '2 songs' });
  });

  it('gives the songs and albums the covers known, and leaves the rest without', () => {
    const [songs, albums] = browseTree(content, en, (track) => (track.id === '2' ? 'file:///covers/2.jpg' : null));
    expect(songs!.children![1]!.artworkUri).toBe('file:///covers/2.jpg');
    expect('artworkUri' in songs!.children![0]!).toBe(false);
    expect(albums!.children![0]!.artworkUri).toBe('file:///covers/2.jpg');
  });

  it('gives the songs their file and gain where known, so native can play them with the app closed', () => {
    const [songs, albums] = browseTree(content, en, undefined, (track, list) => ({
      uri: track.id === '2' ? 'file:///music/2.mp3' : null,
      gainDb: list === 'album' ? -3 : 0,
    }));
    expect(songs!.children![1]).toMatchObject({ uri: 'file:///music/2.mp3' });
    expect('uri' in songs!.children![0]!).toBe(false);
    expect('gainDb' in songs!.children![1]!).toBe(false);
    expect(albums!.children![0]!.children![0]!.gainDb).toBe(-3);
  });

  it('gives every node an id of its own, which reads back as the list and the song it stands for', () => {
    const tree = browseTree(content, en);
    const all = tree.flatMap(idsUnder);
    expect(new Set(all).size).toBe(all.length);
    expect(parseBrowseId(tree[0]!.children![2]!.id)).toEqual({ list: 'songs', trackId: '3' });
    const bookends = tree[1]!.children![0]!;
    expect(parseBrowseId(bookends.id)).toEqual({ list: 'album', key: BOOKENDS });
    expect(parseBrowseId(bookends.children![1]!.id)).toEqual({ list: 'album', key: BOOKENDS, trackId: '1' });
    expect(parseBrowseId(tree[4]!.children![0]!.children![0]!.id)).toEqual({ list: 'playlist', key: 'p1', trackId: '3' });
  });

  it('reads no list out of an id it never gave', () => {
    expect(parseBrowseId('albums')).toBeNull();
    expect(parseBrowseId('')).toBeNull();
    expect(parseBrowseId('album/%E0%A4%A')).toBeNull();
    expect(parseBrowseId('album/a/b/c')).toBeNull();
  });
});

describe('AutoBrowse', () => {
  function setup() {
    const engine = fakeEngine();
    const tracks = signal<readonly Track[]>(SONGS);
    const library = {
      tracks,
      status: signal('ready'),
      byId: computed(() => new Map(tracks().map((track) => [track.id, track]))),
      uriOf: async (track: Track) => `file:///music/${track.id}.mp3`,
      knownUriOf: (track: Track) => `file:///music/${track.id}.mp3`,
    };
    const injector = injectService(Injector, {
      providers: [memoryStorage(), engineProvider(engine), { provide: MusicLibrary, useValue: library }],
    });
    const browse = injector.get(AutoBrowse);
    return { engine, tracks, status: library.status, browse, player: injector.get(Player), playlists: injector.get(Playlists) };
  }
  const titles = (tracks: readonly Track[]) => tracks.map((track) => track.title);

  it('sends the tree once the library is read, and again as the library and the playlists change', async () => {
    const { engine, tracks, playlists } = setup();
    await waitFor(() => expect(engine.tree).not.toBeNull(), { timeout: 3000 });
    expect(engine.tree![0]!.children).toHaveLength(4);
    expect(engine.tree![1]!.children!.map((node) => node.title)).toEqual(['Bookends', 'Mi Sangre']);

    tracks.set(SONGS.slice(0, 2));
    playlists.create('Road trip', ['1']);
    await waitFor(() => expect(engine.tree![0]!.children).toHaveLength(2), { timeout: 3000 });
    expect(engine.tree![4]!.children!.map((node) => node.title)).toEqual(['Road trip']);
  });

  it('plays a song picked in an album from that album, in its order', async () => {
    const { engine, player } = setup();
    engine.request(`album/${encodeURIComponent(BOOKENDS)}/1`);
    await waitFor(() => expect(engine.loaded).toEqual(['file:///music/1.mp3']));
    expect(titles(player.queued())).toEqual(['America', 'Mrs Robinson']);
    expect(player.source()).toEqual({ facet: 'album', key: BOOKENDS, name: 'Bookends' });
  });

  it('plays a song picked among every song from the library, and a playlist from its start', async () => {
    const { engine, player, playlists } = setup();
    engine.request('songs/3');
    await waitFor(() => expect(player.current()?.id).toBe('3'));
    expect(player.queueLength()).toBe(4);
    expect(player.source()).toBe('library');

    const id = playlists.create('Road trip', ['3', '1'])!;
    engine.request(`playlist/${id}`);
    await waitFor(() => expect(titles(player.queued())).toEqual(['La Camisa Negra', 'Mrs Robinson']));
    expect(player.source()).toEqual({ playlist: 'Road trip' });
  });

  it('plays a song asked for before the library was read once it is', async () => {
    const { engine, player, status } = setup();
    status.set('scanning');
    engine.request('songs/2');
    await waitFor(() => expect(engine.tree).toBeNull());
    expect(player.current()).toBeNull();

    status.set('ready');
    await waitFor(() => expect(player.current()?.id).toBe('2'));
  });

  it('plays the library on a plain "play" with nothing queued', async () => {
    const { engine, player } = setup();
    engine.request('');
    await waitFor(() => expect(player.playing()).toBe(true));
    expect(player.source()).toBe('library');
  });
});
