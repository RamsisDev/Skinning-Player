import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Pressable, Text, View, VirtualList, VirtualListRow } from '@ng-native/components';
import { Dialogs } from '@ng-native/device';
import { type Album, type Artist, CatalogService, type Genre } from '../core/catalog.ts';
import { LibrarySettings } from '../core/library-settings.ts';
import { Player, type QueueSource } from '../core/player.ts';
import { SORT_MODES, type Sort, sortGroups } from '../core/sorting.ts';
import { type Track } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { CoverArt } from '../ui/cover-art.ts';
import { type Menu, MenuSheet } from '../ui/menu-sheet.ts';
import { type CatalogRef } from '../ui/navigation.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SortSheet } from '../ui/sort-sheet.ts';
import { AddToPlaylistSheet } from './add-to-playlist-sheet.ts';

export type CatalogView = 'albums' | 'artists' | 'genres';

/** One album, artist or genre in a list: what it is, how it is described, and its songs. */
export interface CatalogRow {
  readonly ref: CatalogRef;
  readonly name: string;
  readonly meta: string;
  readonly tracks: readonly Track[];
}

const KIND = { albums: 'album', artists: 'artist', genres: 'genre' } as const;

/** The songs to play for an album, artist or genre, and what the queue says it came from. */
export function sourceOf(row: CatalogRow): QueueSource {
  return { facet: row.ref.kind, key: row.ref.key, name: row.name };
}

/**
 * The library's albums, artists or genres, as listed in its tabs: each with its cover,
 * a line about it and a menu, sorted the way the user chose. A tap opens it.
 */
@Component({
  selector: 'app-catalog-list',
  imports: [AddToPlaylistSheet, CoverArt, MenuSheet, Pressable, SkinButton, SortSheet, Text, View, VirtualList, VirtualListRow],
  host: { style: 'flex: 1' },
  template: `
    <view class="actions">
      <text class="count">{{ countLabel() }}</text>
      <app-skin-button [label]="t().sorting.button" icon="sort" size="small" [iconOnly]="true" (press)="sorting.set(true)" />
      <app-skin-button [label]="t().common.shuffle" icon="shuffle" size="small" [disabled]="!rows().length" (press)="shuffleAll()" />
    </view>
    <virtual-list #list class="list" [items]="rows()" [itemHeight]="64" [keyExtractor]="keyOf">
      @for (row of list.window(); track row.slot) {
        <view [virtualListRow]="row">
          <pressable
            class="row"
            [class.current]="isPlaying(row.item)"
            accessibilityRole="button"
            [accessibilityLabel]="row.item.name + ', ' + row.item.meta"
            [accessibilityState]="{ selected: isPlaying(row.item) }"
            (press)="open.emit(row.item.ref)"
            (longPress)="openMenu(row.item)"
          >
            <app-cover-art [track]="row.item.tracks[0]" [size]="44" [radius]="6" />
            <view class="body">
              <text class="title" [numberOfLines]="1">{{ row.item.name }}</text>
              <text class="meta" [numberOfLines]="1">{{ row.item.meta }}</text>
            </view>
            <app-skin-button
              [label]="t().library.moreFor(row.item.name)"
              icon="more"
              variant="ghost"
              size="small"
              [iconOnly]="true"
              (press)="openMenu(row.item)"
            />
          </pressable>
        </view>
      }
      @if (!rows().length) {
        <text listFooter class="empty">{{ t().library.none[view()] }}</text>
      }
    </virtual-list>
    <app-sort-sheet [open]="sorting()" [modes]="modes()" [sort]="sort()" (change)="setSort($event)" (close)="sorting.set(false)" />
    <app-menu-sheet [menu]="menu()" (close)="menu.set(null)" />
    <app-add-to-playlist-sheet [tracks]="adding()" (close)="adding.set(null)" />
  `,
  styles: `
    .actions {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      padding: 4px 12px 8px;
    }
    .count {
      flex: 1;
      color: var(--sk-text-muted);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-display-weight);
      text-transform: uppercase;
    }
    .list {
      flex: 1;
    }
    .row {
      flex: 1;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 0 8px 0 12px;
      border-bottom-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: transparent;
    }
    .row:active {
      background-color: var(--sk-surface-alt);
    }
    .current {
      background-color: var(--sk-surface);
    }
    .current .title {
      color: var(--sk-accent);
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
    .meta {
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
export class CatalogList {
  private readonly catalog = inject(CatalogService).catalog;
  private readonly settings = inject(LibrarySettings);
  private readonly player = inject(Player);
  private readonly dialogs = inject(Dialogs);
  protected readonly t = inject(I18n).messages;

  readonly view = input.required<CatalogView>();
  readonly open = output<CatalogRef>();

  protected readonly sorting = signal(false);
  protected readonly menu = signal<Menu | null>(null);
  protected readonly adding = signal<readonly Track[] | null>(null);
  protected readonly modes = computed(() => SORT_MODES[this.view()]);
  protected readonly sort = computed(() => this.settings.sortOf(this.view()));

  protected readonly rows = computed((): CatalogRow[] => {
    const catalog = this.catalog();
    const sort = this.sort();
    const smart = this.settings.smartSort();
    switch (this.view()) {
      case 'albums':
        return sortGroups(catalog.albums, sort, smart).map((album) => this.albumRow(album));
      case 'artists':
        return sortGroups(catalog.artists, sort, smart).map((artist) => this.artistRow(artist));
      case 'genres':
        return sortGroups(catalog.genres, sort, smart).map((genre) => this.genreRow(genre));
    }
  });
  protected readonly countLabel = computed(() => {
    const n = this.rows().length;
    const t = this.t().search;
    return { albums: t.albums, artists: t.artists, genres: t.genres }[this.view()](n);
  });
  protected readonly keyOf = (row: CatalogRow): string => `${row.ref.kind}:${row.ref.key}`;

  /** Whether the queue is playing from this album, artist or genre. */
  protected isPlaying(row: CatalogRow): boolean {
    const source = this.player.source();
    return !!source && typeof source === 'object' && 'facet' in source && source.facet === row.ref.kind && source.key === row.ref.key;
  }

  protected setSort(sort: Sort): void {
    this.settings.setSort(this.view(), sort);
  }

  protected shuffleAll(): void {
    this.player.shuffleTracks([...new Set(this.rows().flatMap((row) => row.tracks))], 'library');
  }

  protected openMenu(row: CatalogRow): void {
    const t = this.t().common;
    this.menu.set({
      title: row.name,
      actions: [
        { label: t.play, icon: 'play', run: () => this.player.playTracks(row.tracks, 0, sourceOf(row)) },
        { label: t.shuffle, icon: 'shuffle', run: () => this.player.shuffleTracks(row.tracks, sourceOf(row)) },
        {
          label: t.playNext,
          icon: 'next',
          run: () => {
            this.player.playNext(row.tracks);
            this.dialogs.notify(t.playingNext);
          },
        },
        {
          label: t.addToQueue,
          icon: 'add',
          run: () => {
            this.player.addToQueue(row.tracks);
            this.dialogs.notify(t.addedToQueue);
          },
        },
        { label: t.addToPlaylist, icon: 'addToPlaylist', run: () => this.adding.set(row.tracks) },
      ],
    });
  }

  private albumRow(album: Album): CatalogRow {
    const t = this.t();
    const artist = album.various ? t.catalog.variousArtists : album.artist || t.common.unknownArtist;
    return {
      ref: { kind: KIND.albums, key: album.key },
      name: album.name,
      meta: [artist, album.date.slice(0, 4), t.common.songs(album.count)].filter(Boolean).join('  ·  '),
      tracks: album.tracks,
    };
  }

  private artistRow(artist: Artist): CatalogRow {
    const t = this.t();
    const albums = artist.albums.length ? t.search.albums(artist.albums.length) : '';
    return {
      ref: { kind: KIND.artists, key: artist.key },
      name: artist.name,
      meta: [albums, t.common.songs(artist.count)].filter(Boolean).join('  ·  '),
      tracks: artist.tracks,
    };
  }

  private genreRow(genre: Genre): CatalogRow {
    const t = this.t();
    const artists = genre.artistKeys.length ? t.search.artists(genre.artistKeys.length) : '';
    return {
      ref: { kind: KIND.genres, key: genre.key },
      name: genre.name,
      meta: [artists, t.common.songs(genre.count)].filter(Boolean).join('  ·  '),
      tracks: genre.tracks,
    };
  }
}
