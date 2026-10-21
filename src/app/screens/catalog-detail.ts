import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Pressable, Text, View, VirtualList, VirtualListRow } from '@ng-native/components';
import { Dialogs } from '@ng-native/device';
import { type Album, CatalogService } from '../core/catalog.ts';
import { LibrarySettings } from '../core/library-settings.ts';
import { Player, type QueueSource } from '../core/player.ts';
import { RELEASE_KINDS } from '../core/release-type.ts';
import { SORT_MODES, type Sort, newestFirst, sortGroups, sortTracks } from '../core/sorting.ts';
import { type Track, formatTime } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { CoverArt } from '../ui/cover-art.ts';
import { type Menu, type MenuAction, MenuSheet } from '../ui/menu-sheet.ts';
import { type CatalogRef } from '../ui/navigation.ts';
import { PlayerView } from '../ui/player-view.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SortSheet } from '../ui/sort-sheet.ts';
import { TrackRow } from '../ui/track-row.ts';
import { AddToPlaylistSheet } from './add-to-playlist-sheet.ts';

const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 64;

/** One line under an album, artist or genre: a section's heading, one of its songs, or an album or artist. */
type DetailRow =
  | { readonly kind: 'header'; readonly key: string; readonly label: string }
  | { readonly kind: 'song'; readonly key: string; readonly track: Track; readonly index: number; readonly number?: number | null }
  | { readonly kind: 'group'; readonly key: string; readonly ref: CatalogRef; readonly name: string; readonly meta: string; readonly cover: Track };

/** What the screen shows about what it opened. */
interface Detail {
  readonly name: string;
  readonly cover: Track | null;
  /** The album's artist, which opens them; empty for an artist or a genre. */
  readonly artist: string;
  readonly meta: string;
  /** Its songs, in the order a tap plays them. */
  readonly songs: readonly Track[];
  readonly rows: readonly DetailRow[];
  readonly source: QueueSource;
  /** For an album, its artists, to go to. */
  readonly artists: readonly CatalogRef[];
}

/**
 * An album with its songs in disc and track order, an artist with their albums by release type and
 * the albums they appear on, or a genre with its artists; and in each, its songs. As Auxio's detail
 * screens.
 */
@Component({
  selector: 'app-catalog-detail',
  imports: [AddToPlaylistSheet, CoverArt, MenuSheet, Pressable, SkinButton, SortSheet, Text, TrackRow, View, VirtualList, VirtualListRow],
  host: { style: 'flex: 1' },
  template: `
    <view class="toolbar">
      <app-skin-button [label]="t().catalog.back" icon="back" variant="ghost" [iconOnly]="true" (press)="back.emit()" />
      <text class="heading" role="heading" [numberOfLines]="1">{{ detail()?.name ?? '' }}</text>
      @if (ref().kind === 'album') {
        <app-skin-button [label]="t().sorting.button" icon="sort" variant="ghost" [iconOnly]="true" (press)="sorting.set(true)" />
      }
      @if (detail(); as detail) {
        <app-skin-button [label]="t().library.moreFor(detail.name)" icon="more" variant="ghost" [iconOnly]="true" (press)="openMenu(detail)" />
      }
    </view>
    @if (detail(); as detail) {
      <virtual-list #list class="list" [items]="detail.rows" [itemHeight]="heightOf" [itemType]="typeOf" [keyExtractor]="keyOf">
        <view listHeader class="hero">
          <app-cover-art [track]="detail.cover" [size]="96" />
          <view class="hero-body">
            @if (detail.artist && detail.artists.length) {
              <text
                class="artist"
                pressable
                accessibilityRole="button"
                [accessibilityLabel]="t().catalog.goToArtist(detail.artist)"
                [numberOfLines]="1"
                (press)="goToArtist(detail)"
              >{{ detail.artist }}</text>
            } @else if (detail.artist) {
              <text class="artist plain" [numberOfLines]="1">{{ detail.artist }}</text>
            }
            <text class="meta">{{ detail.meta }}</text>
            <view class="buttons">
              <app-skin-button [label]="t().common.shuffle" icon="shuffle" size="small" [disabled]="!detail.songs.length" (press)="player.shuffleTracks(detail.songs, detail.source)" />
              <app-skin-button [label]="t().common.play" icon="play" variant="primary" size="small" [disabled]="!detail.songs.length" (press)="play(detail, 0)" />
            </view>
          </view>
        </view>
        @for (row of list.window(); track row.slot) {
          <view [virtualListRow]="row">
            @switch (row.item.kind) {
              @case ('header') {
                <text class="section" role="header">{{ labelOf(row.item) }}</text>
              }
              @case ('song') {
                @if (songOf(row.item); as song) {
                  <app-track-row
                    [track]="song.track"
                    [number]="song.number"
                    [hideAlbum]="ref().kind === 'album'"
                    [current]="player.current()?.id === song.track.id"
                    (press)="play(detail, song.index)"
                    (longPress)="adding.set([song.track])"
                  />
                }
              }
              @case ('group') {
                @if (groupOf(row.item); as group) {
                  <pressable
                    class="row"
                    accessibilityRole="button"
                    [accessibilityLabel]="group.name + ', ' + group.meta"
                    (press)="open.emit(group.ref)"
                  >
                    <app-cover-art [track]="group.cover" [size]="44" [radius]="6" />
                    <view class="body">
                      <text class="title" [numberOfLines]="1">{{ group.name }}</text>
                      <text class="row-meta" [numberOfLines]="1">{{ group.meta }}</text>
                    </view>
                  </pressable>
                }
              }
            }
          </view>
        }
      </virtual-list>
    } @else {
      <text class="empty">{{ t().filters.none }}</text>
    }
    <app-sort-sheet [open]="sorting()" [modes]="modes" [sort]="albumSort()" (change)="setSort($event)" (close)="sorting.set(false)" />
    <app-menu-sheet [menu]="menu()" (close)="menu.set(null)" />
    <app-add-to-playlist-sheet [tracks]="adding()" (close)="adding.set(null)" />
  `,
  styles: `
    .toolbar {
      flex-direction: row;
      align-items: center;
      gap: 4px;
      padding: 6px 8px 0;
    }
    .heading {
      flex: 1;
      color: var(--sk-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-lg);
      font-weight: var(--sk-weight-bold);
    }
    .list {
      flex: 1;
    }
    .hero {
      flex-direction: row;
      gap: 14px;
      padding: 12px;
    }
    .hero-body {
      flex: 1;
      gap: 4px;
      justify-content: center;
    }
    .artist {
      color: var(--sk-accent);
      font-family: var(--sk-font-medium);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight-medium);
    }
    .artist.plain {
      color: var(--sk-text);
    }
    .meta {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
    }
    .buttons {
      flex-direction: row;
      gap: 8px;
      padding-top: 6px;
    }
    .section {
      height: 40px;
      padding: 14px 12px 0;
      color: var(--sk-accent);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-display-weight);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .row {
      flex: 1;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 0 8px 0 12px;
      border-bottom-width: var(--sk-border-width);
      border-color: var(--sk-border);
    }
    .row:active {
      background-color: var(--sk-surface-alt);
    }
    .body {
      flex: 1;
      gap: 2px;
    }
    .title {
      color: var(--sk-text);
      font-family: var(--sk-font-medium);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight-medium);
    }
    .row-meta {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
    }
    .empty {
      padding: 32px;
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight);
      text-align: center;
    }
  `,
})
export class CatalogDetail {
  private readonly catalog = inject(CatalogService).catalog;
  private readonly settings = inject(LibrarySettings);
  private readonly dialogs = inject(Dialogs);
  private readonly playerView = inject(PlayerView);
  protected readonly player = inject(Player);
  protected readonly t = inject(I18n).messages;

  readonly ref = input.required<CatalogRef>();
  readonly back = output<void>();
  readonly open = output<CatalogRef>();

  protected readonly sorting = signal(false);
  protected readonly menu = signal<Menu | null>(null);
  protected readonly adding = signal<readonly Track[] | null>(null);
  protected readonly modes = SORT_MODES.album;
  protected readonly albumSort = computed(() => this.settings.sortOf('album'));

  protected readonly detail = computed((): Detail | null => {
    const { kind, key } = this.ref();
    const catalog = this.catalog();
    if (kind === 'album') {
      const album = catalog.album.get(key);
      return album ? this.albumDetail(album) : null;
    }
    if (kind === 'artist') {
      const artist = catalog.artist.get(key);
      if (!artist) return null;
      const t = this.t();
      const smart = this.settings.smartSort();
      const rows: DetailRow[] = [];
      for (const kind of RELEASE_KINDS) {
        const albums = artist.albums.filter((album) => album.releaseType.kind === kind);
        if (!albums.length) continue;
        rows.push({ kind: 'header', key: `release:${kind}`, label: t.catalog.releases[kind] });
        rows.push(...albums.map((album) => this.albumRow(album, false)));
      }
      if (artist.appearsOn.length) {
        rows.push({ kind: 'header', key: 'appearsOn', label: t.catalog.appearsOn });
        rows.push(...artist.appearsOn.map((album) => this.albumRow(album, true)));
      }
      const songs = newestFirst(artist.tracks, smart);
      rows.push({ kind: 'header', key: 'songs', label: t.catalog.songs });
      rows.push(...songs.map((track, index): DetailRow => ({ kind: 'song', key: `song:${track.id}`, track, index })));
      const albums = artist.albums.length ? t.search.albums(artist.albums.length) : '';
      return {
        name: artist.name,
        cover: artist.albums[0]?.tracks[0] ?? songs[0] ?? null,
        artist: '',
        meta: [albums, t.common.songs(songs.length), formatTime(artist.duration)].filter(Boolean).join('  ·  '),
        songs,
        rows,
        source: { facet: 'artist', key, name: artist.name },
        artists: [],
      };
    }
    const genre = catalog.genre.get(key);
    if (!genre) return null;
    const t = this.t();
    const smart = this.settings.smartSort();
    const artists = sortGroups(
      genre.artistKeys.flatMap((artistKey) => catalog.artist.get(artistKey) ?? []),
      { mode: 'name', ascending: true },
      smart,
    );
    const songs = sortTracks(genre.tracks, { mode: 'name', ascending: true }, smart);
    const rows: DetailRow[] = [];
    if (artists.length) {
      rows.push({ kind: 'header', key: 'artists', label: t.catalog.artists });
      for (const artist of artists) {
        rows.push({
          kind: 'group',
          key: `artist:${artist.key}`,
          ref: { kind: 'artist', key: artist.key },
          name: artist.name,
          meta: t.common.songs(artist.tracks.filter((track) => genre.tracks.includes(track)).length),
          cover: artist.tracks[0]!,
        });
      }
    }
    rows.push({ kind: 'header', key: 'songs', label: t.catalog.songs });
    rows.push(...songs.map((track, index): DetailRow => ({ kind: 'song', key: `song:${track.id}`, track, index })));
    return {
      name: genre.name,
      cover: songs[0] ?? null,
      artist: '',
      meta: [artists.length ? t.search.artists(artists.length) : '', t.common.songs(songs.length), formatTime(genre.duration)]
        .filter(Boolean)
        .join('  ·  '),
      songs,
      rows,
      source: { facet: 'genre', key, name: genre.name },
      artists: [],
    };
  });

  protected readonly heightOf = (row: DetailRow): number => (row.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT);
  protected readonly typeOf = (row: DetailRow): string => row.kind;
  protected readonly keyOf = (row: DetailRow): string => row.key;

  protected labelOf(row: DetailRow): string {
    return row.kind === 'header' ? row.label : '';
  }

  protected songOf(row: DetailRow) {
    return row.kind === 'song' ? row : null;
  }

  protected groupOf(row: DetailRow) {
    return row.kind === 'group' ? row : null;
  }

  protected play(detail: Detail, index: number): void {
    this.player.playTracks(detail.songs, index, detail.source);
    this.playerView.show();
  }

  protected setSort(sort: Sort): void {
    this.settings.setSort('album', sort);
  }

  /** The album's artist, or a choice among them when it has several. */
  protected goToArtist(detail: Detail): void {
    if (!detail.artists.length) return;
    if (detail.artists.length === 1) {
      this.open.emit(detail.artists[0]!);
      return;
    }
    const catalog = this.catalog();
    this.menu.set({
      title: this.t().common.goToArtist,
      actions: detail.artists.map((ref) => ({
        label: catalog.artist.get(ref.key)?.name ?? ref.key,
        icon: 'library',
        run: () => this.open.emit(ref),
      })),
    });
  }

  protected openMenu(detail: Detail): void {
    const t = this.t().common;
    const actions: MenuAction[] = [
      {
        label: t.playNext,
        icon: 'next',
        run: () => {
          this.player.playNext(detail.songs);
          this.dialogs.notify(t.playingNext);
        },
      },
      {
        label: t.addToQueue,
        icon: 'add',
        run: () => {
          this.player.addToQueue(detail.songs);
          this.dialogs.notify(t.addedToQueue);
        },
      },
    ];
    if (detail.artists.length) actions.push({ label: t.goToArtist, icon: 'library', run: () => this.goToArtist(detail) });
    actions.push({ label: t.addToPlaylist, icon: 'addToPlaylist', run: () => this.adding.set(detail.songs) });
    this.menu.set({ title: detail.name, actions });
  }

  private albumDetail(album: Album): Detail {
    const t = this.t();
    const sort = this.albumSort();
    const songs = sortTracks(album.tracks, sort, this.settings.smartSort());
    const byDisc = album.discs > 1 && sort.mode === 'disc';
    // An album whose files give no track numbers shows its covers instead.
    const numbered = album.tracks.some((track) => track.trackNumber !== null);
    const rows: DetailRow[] = [];
    let disc: number | null = null;
    songs.forEach((track, index) => {
      if (byDisc && (track.disc ?? 1) !== disc) {
        disc = track.disc ?? 1;
        rows.push({ kind: 'header', key: `disc:${disc}`, label: t.catalog.disc(disc) });
      }
      rows.push({ kind: 'song', key: `song:${track.id}`, track, index, number: numbered ? track.trackNumber : undefined });
    });
    const release = t.catalog.release(album.releaseType.kind, album.releaseType.refinement);
    return {
      name: album.name,
      cover: album.tracks[0] ?? null,
      artist: album.various ? t.catalog.variousArtists : album.artist || t.common.unknownArtist,
      meta: [release, album.date, t.common.songs(album.count), formatTime(album.duration)].filter(Boolean).join('  ·  '),
      songs,
      rows,
      source: { facet: 'album', key: album.key, name: album.name },
      artists: album.various ? [] : album.artists.map((artist) => ({ kind: 'artist' as const, key: artist.key })),
    };
  }

  /** An album under an artist: its release type and year, or for one they appear on, its artist. */
  private albumRow(album: Album, appearance: boolean): DetailRow {
    const t = this.t();
    const by = appearance ? (album.various ? t.catalog.variousArtists : album.artist) : t.catalog.release(album.releaseType.kind, album.releaseType.refinement);
    return {
      kind: 'group',
      key: `album:${album.key}`,
      ref: { kind: 'album', key: album.key },
      name: album.name,
      meta: [by, album.date.slice(0, 4), t.common.songs(album.count)].filter(Boolean).join('  ·  '),
      cover: album.tracks[0]!,
    };
  }
}
