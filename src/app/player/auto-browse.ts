import { DestroyRef, Service, computed, effect, inject, untracked } from '@angular/core';
import { type Messages } from '../i18n/messages.ts';
import { I18n } from '../i18n/i18n.ts';
import { AUDIO_ENGINE, type BrowseNode } from '../audio/audio-engine.ts';
import { BehaviorSettings } from '../settings/behavior-settings.ts';
import { CatalogService, type CatalogKind, songsOf } from '../catalog/catalog.ts';
import { Covers } from '../library/covers.ts';
import { Features } from '../audio/features.ts';
import { LibrarySettings } from '../library/library-settings.ts';
import { MusicLibrary } from '../library/music-library.ts';
import { type QueueSource, Player } from './player.ts';
import { Playlists } from '../playlists/playlists.ts';
import { replayGainDb } from '../audio/replay-gain.ts';
import { sortGroups, sortTracks } from '../library/sorting.ts';
import { type Track } from '../library/track.ts';

/** How long the tree waits for the library to stop changing before it is sent again, as during a scan. */
export const BROWSE_DELAY_MS = 1000;

/** A list of songs Android Auto can open, in the order the app's own screens play it. */
export interface BrowseList {
  /** Its key: an album's, artist's or genre's, or a playlist's id. */
  readonly key: string;
  readonly name: string;
  readonly subtitle?: string;
  readonly songs: readonly Track[];
}

/** What the tree is made of, each in the order its tab lists it. */
export interface BrowseContent {
  readonly songs: readonly Track[];
  readonly albums: readonly BrowseList[];
  readonly artists: readonly BrowseList[];
  readonly genres: readonly BrowseList[];
  readonly playlists: readonly BrowseList[];
}

/** The folders under the root of the tree. */
export type BrowseFolder = 'album' | 'artist' | 'genre' | 'playlist';

/** What an id of the tree stands for: a list, or a song in it. */
export type BrowsePick =
  | { readonly list: 'songs'; readonly trackId?: string }
  | { readonly list: BrowseFolder; readonly key: string; readonly trackId?: string };

/**
 * Ids are the parts of the path to a node, each encoded so that a key holding a slash, or the
 * control characters album keys are made with, splits back the same: `songs/41`, `album/<key>`,
 * `album/<key>/41`. The folders of each kind on the root are named in the plural.
 */
const idOf = (...parts: readonly string[]): string => parts.map(encodeURIComponent).join('/');

const ROOTS: Readonly<Record<BrowseFolder, string>> = { album: 'albums', artist: 'artists', genre: 'genres', playlist: 'playlists' };

/** What an id of the tree stands for, or null for one it never had. */
export function parseBrowseId(id: string): BrowsePick | null {
  let parts: string[];
  try {
    parts = id.split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  const [head, key, trackId] = parts;
  if (head === 'songs') return parts.length <= 2 ? (key ? { list: 'songs', trackId: key } : { list: 'songs' }) : null;
  if (!(head === 'album' || head === 'artist' || head === 'genre' || head === 'playlist') || !key || parts.length > 3) return null;
  return trackId ? { list: head, key, trackId } : { list: head, key };
}

/**
 * What a song of the tree plays as when the app's own code is not running, as when Android Auto
 * starts the service alone: its file where known, and its gain as played from `list`.
 */
export type PlayableOf = (track: Track, list: BrowseFolder | 'songs') => { readonly uri: string | null; readonly gainDb: number };

/**
 * Android Auto's browse tree: every song, then the albums, artists, genres and playlists, each
 * opening on its songs. `artworkOf` answers a song's cover where one is known without reading a
 * file, for its row and its album's.
 */
export function browseTree(
  content: BrowseContent,
  t: Messages,
  artworkOf: (track: Track) => string | null = () => null,
  playableOf: PlayableOf = () => ({ uri: null, gainDb: 0 }),
): BrowseNode[] {
  const song = (track: Track, list: BrowseFolder | 'songs', ...path: string[]): BrowseNode => {
    const { uri, gainDb } = playableOf(track, list);
    return {
      ...node(idOf(...path, track.id), track.title, track.artist || t.common.unknownArtist, artworkOf(track)),
      ...(uri ? { uri } : {}),
      ...(gainDb ? { gainDb } : {}),
    };
  };
  const folder = (kind: BrowseFolder, list: BrowseList, artwork: string | null): BrowseNode => ({
    ...node(idOf(kind, list.key), list.name, list.subtitle, artwork),
    children: list.songs.map((track) => song(track, kind, kind, list.key)),
  });
  const songs = t.common.songs;
  return [
    { id: 'songs', title: t.library.views.songs, children: content.songs.map((track) => song(track, 'songs', 'songs')) },
    {
      id: ROOTS.album,
      title: t.library.views.albums,
      children: content.albums.map((album) => folder('album', album, album.songs[0] ? artworkOf(album.songs[0]) : null)),
    },
    {
      id: ROOTS.artist,
      title: t.library.views.artists,
      children: content.artists.map((artist) => folder('artist', { ...artist, subtitle: songs(artist.songs.length) }, null)),
    },
    {
      id: ROOTS.genre,
      title: t.library.views.genres,
      children: content.genres.map((genre) => folder('genre', { ...genre, subtitle: songs(genre.songs.length) }, null)),
    },
    {
      id: ROOTS.playlist,
      title: t.tabs.playlists,
      children: content.playlists.map((playlist) => folder('playlist', { ...playlist, subtitle: songs(playlist.songs.length) }, null)),
    },
  ];
}

/** A node with only the details it has: the tree crosses the bridge whole, so it carries no empty fields. */
function node(id: string, title: string, subtitle: string | undefined, artworkUri: string | null): BrowseNode {
  return { id, title, ...(subtitle ? { subtitle } : {}), ...(artworkUri ? { artworkUri } : {}) };
}

/**
 * Keeps Android Auto's browse tree in step with the library, its albums, artists and genres, and
 * the playlists, and plays what is picked in it from the list it was picked in. Only where the
 * engine serves Android Auto: elsewhere it does nothing.
 */
@Service()
export class AutoBrowse {
  private readonly engine = inject(AUDIO_ENGINE);
  private readonly library = inject(MusicLibrary);
  private readonly catalog = inject(CatalogService).catalog;
  private readonly settings = inject(LibrarySettings);
  private readonly playlists = inject(Playlists);
  private readonly covers = inject(Covers);
  private readonly behavior = inject(BehaviorSettings);
  private readonly replayGain = inject(Features).on('replayGain');
  private readonly player = inject(Player);
  private readonly t = inject(I18n).messages;

  /** The lists of the tree, as the library's tabs and screens sort them. */
  readonly content = computed<BrowseContent>(() => {
    const smart = this.settings.smartSort();
    const catalog = this.catalog();
    const t = this.t();
    const group = (kind: CatalogKind, key: string, subtitle?: string): BrowseList | null => {
      const found = songsOf(catalog, kind, key, this.settings.sortOf('album'), smart);
      return found ? { key, name: found.name, ...(subtitle ? { subtitle } : {}), songs: found.songs } : null;
    };
    const byId = this.library.byId();
    return {
      songs: sortTracks(this.library.tracks(), this.settings.sortOf('songs'), smart),
      albums: sortGroups(catalog.albums, this.settings.sortOf('albums'), smart).flatMap(
        (album) => group('album', album.key, album.various ? t.catalog.variousArtists : album.artist) ?? [],
      ),
      artists: sortGroups(catalog.artists, this.settings.sortOf('artists'), smart).flatMap((artist) => group('artist', artist.key) ?? []),
      genres: sortGroups(catalog.genres, this.settings.sortOf('genres'), smart).flatMap((genre) => group('genre', genre.key) ?? []),
      playlists: this.playlists.all().map((playlist) => ({ key: playlist.id, name: playlist.name, songs: this.playlists.tracksOf(playlist, byId) })),
    };
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** A request that came before the library was read, as when Android Auto starts the app: it plays once it is. */
  private pending: string | null = null;

  constructor() {
    // Only made where Android Auto is on (see `App`), but a test or a stray inject can still ask.
    if (!this.engine.features.browseTree) return;
    effect(() => {
      if (this.library.status() !== 'ready') return;
      const content = this.content();
      const t = this.t();
      untracked(() => this.publishSoon(content, t));
    });
    effect(() => {
      if (this.library.status() !== 'ready' || this.pending === null) return;
      const id = this.pending;
      this.pending = null;
      untracked(() => this.play(id));
    });
    const stop = this.engine.onPlayRequest((id) => this.play(id));
    inject(DestroyRef).onDestroy(() => {
      stop();
      if (this.timer) clearTimeout(this.timer);
    });
  }

  /** Sends the tree once the library has stopped changing for a moment. Covers are read as it goes, not watched. */
  private publishSoon(content: BrowseContent, t: Messages): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const gains = this.replayGain ? this.behavior.replayGainSettings() : null;
      this.engine.setBrowseTree(
        browseTree(
          content,
          t,
          (track) => this.covers.uriOf(track.id),
          (track, list) => ({ uri: this.library.knownUriOf(track), gainDb: gains ? replayGainDb(track.replayGain, gains, list === 'album') : 0 }),
        ),
      );
    }, BROWSE_DELAY_MS);
  }

  /**
   * Plays an id of the tree: a song from the list it is in, or a list from its start. Any other id,
   * as for a plain "play" from Android Auto, plays what was playing, or else the library.
   */
  play(id: string): void {
    if (this.library.status() !== 'ready') {
      this.pending = id;
      return;
    }
    const pick = parseBrowseId(id);
    const list = pick && this.listOf(pick);
    if (!list?.songs.length) {
      if (!this.player.playing()) this.player.toggle();
      return;
    }
    const index = pick?.trackId ? list.songs.findIndex((track) => track.id === pick.trackId) : 0;
    this.player.playTracks(list.songs, Math.max(0, index), list.source);
  }

  /** The songs of a list of the tree, as it is now, and what the queue says it came from. */
  private listOf(pick: BrowsePick): { readonly songs: readonly Track[]; readonly source: QueueSource } | null {
    const content = this.content();
    if (pick.list === 'songs') return { songs: content.songs, source: 'library' };
    if (pick.list === 'playlist') {
      const playlist = content.playlists.find((list) => list.key === pick.key);
      return playlist ? { songs: playlist.songs, source: { playlist: playlist.name } } : null;
    }
    const lists = { album: content.albums, artist: content.artists, genre: content.genres }[pick.list];
    const found = lists.find((list) => list.key === pick.key);
    return found ? { songs: found.songs, source: { facet: pick.list, key: found.key, name: found.name } } : null;
  }
}
