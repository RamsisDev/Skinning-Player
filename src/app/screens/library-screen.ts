import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Pressable, ScrollView, Text, TextInput, View, VirtualList, VirtualListRow } from '@ng-native/components';
import { Dialogs, HardwareBack } from '@ng-native/device';
import { LibrarySettings } from '../core/library-settings.ts';
import {
  FACETS,
  type Facet,
  type Filters,
  facetOptions,
  hasFilters,
  matchesFilters,
  valuesOf,
} from '../core/library-filter.ts';
import { MusicLibrary } from '../core/music-library.ts';
import { Player } from '../core/player.ts';
import { SORT_MODES, type Sort, sortTracks } from '../core/sorting.ts';
import { type Track, matchesQuery } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { LibraryStatus } from '../ui/library-status.ts';
import { type CatalogRef, LIBRARY_VIEWS, Navigation } from '../ui/navigation.ts';
import { PlayerView } from '../ui/player-view.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SkinIcon } from '../ui/skin-icon.ts';
import { SortSheet } from '../ui/sort-sheet.ts';
import { TrackRow } from '../ui/track-row.ts';
import { AddToPlaylistSheet } from './add-to-playlist-sheet.ts';
import { CatalogDetail } from './catalog-detail.ts';
import { CatalogList } from './catalog-list.ts';
import { CoverSheet } from './cover-sheet.ts';
import { FilterSheet } from './filter-sheet.ts';

/**
 * The library, in tabs: its songs, albums, artists and genres. The songs are searchable,
 * sorted as the user chose and filtered by the details they have: a filter for each of artist,
 * album, genre and year the library knows, offering only the values left among the songs on show.
 * A tap on a song plays from it and opens the player; a long press files it; its menu also sets its
 * cover. An album, artist or genre opens on a screen of its own, which back leaves.
 */
@Component({
  selector: 'app-library-screen',
  imports: [
    AddToPlaylistSheet,
    CatalogDetail,
    CatalogList,
    CoverSheet,
    FilterSheet,
    LibraryStatus,
    Pressable,
    ScrollView,
    SkinButton,
    SkinIcon,
    SortSheet,
    Text,
    TextInput,
    TrackRow,
    View,
    VirtualList,
    VirtualListRow,
  ],
  host: { style: 'flex: 1' },
  template: `
    @if (library.status() !== 'ready') {
      <app-library-status />
    } @else if (detail(); as ref) {
      <app-catalog-detail [ref]="ref" (back)="leaveDetail()" (open)="openDetail($event)" />
    } @else {
      <view class="views" role="tablist">
        @for (view of views; track view) {
          <pressable
            class="view"
            [class.active]="navigation.libraryView() === view"
            role="tab"
            [accessibilityLabel]="t().library.views[view]"
            [accessibilityState]="{ selected: navigation.libraryView() === view }"
            (press)="navigation.libraryView.set(view)"
          >
            <text class="view-label" [numberOfLines]="1">{{ t().library.views[view] }}</text>
          </pressable>
        }
      </view>
      @if (navigation.libraryView(); as view) {
        @if (view !== 'songs') {
          <app-catalog-list [view]="view" (open)="openDetail($event)" />
        } @else {
          <view class="toolbar">
            <view class="search">
              <app-skin-icon slot="search" [size]="18" color="var(--sk-text-muted)" />
              <text-input
                class="input"
                [placeholder]="t().library.search"
                [placeholderTextColor]="colors().textMuted"
                [cursorColor]="colors().accent"
                returnKeyType="search"
                [(value)]="query"
              />
            </view>
            <app-skin-button [label]="t().library.rescan" icon="refresh" [iconOnly]="true" (press)="library.scan()" />
          </view>
          @if (chips().length) {
            <scroll-view class="filters" [horizontal]="true" [contentContainerStyle]="{ paddingHorizontal: 12, gap: 8 }" keyboardShouldPersistTaps="handled">
              @for (chip of chips(); track chip.facet) {
                <app-skin-button [label]="chip.label" size="small" [active]="chip.active" (press)="picking.set(chip.facet)" />
              }
              @if (filtered()) {
                <app-skin-button [label]="t().filters.clear" variant="ghost" size="small" (press)="filters.set({})" />
              }
            </scroll-view>
          }
          <view class="actions">
            <text class="count">{{ countLabel() }}</text>
            <app-skin-button [label]="t().sorting.button" icon="sort" size="small" [iconOnly]="true" (press)="sorting.set(true)" />
            <app-skin-button [label]="t().common.shuffle" icon="shuffle" size="small" [disabled]="!visible().length" (press)="shuffleAll()" />
            <app-skin-button [label]="t().library.playAll" icon="play" variant="primary" size="small" [disabled]="!visible().length" (press)="play(0)" />
          </view>
          <virtual-list #list class="list" [items]="visible()" [itemHeight]="64" [keyExtractor]="idOf" keyboardDismissMode="on-drag">
            @for (row of list.window(); track row.slot) {
              <view [virtualListRow]="row">
                <app-track-row
                  [track]="row.item"
                  [current]="player.current()?.id === row.item.id"
                  (press)="play(row.index)"
                  (longPress)="adding.set(row.item)"
                >
                  <app-skin-button
                    [label]="t().library.moreFor(row.item.title)"
                    icon="more"
                    variant="ghost"
                    size="small"
                    [iconOnly]="true"
                    (press)="more(row.item)"
                  />
                </app-track-row>
              </view>
            }
            @if (!visible().length) {
              <text listFooter class="empty">{{ emptyLabel() }}</text>
            }
          </virtual-list>
        }
      }
    }
    <app-add-to-playlist-sheet [track]="adding()" (close)="adding.set(null)" />
    <app-cover-sheet [track]="editingCover()" (close)="editingCover.set(null)" />
    <app-sort-sheet [open]="sorting()" [modes]="sortModes" [sort]="sort()" (change)="setSort($event)" (close)="sorting.set(false)" />
    <app-filter-sheet
      [facet]="picking()"
      [options]="pickerOptions()"
      [selected]="pickerSelected()"
      (pick)="pick($event)"
      (close)="picking.set(null)"
    />
  `,
  styles: `
    .views {
      flex-direction: row;
      gap: 4px;
      padding: 6px 12px 0;
    }
    .view {
      flex: 1;
      align-items: center;
      padding: 8px 0;
      border-bottom-width: 2px;
      border-color: transparent;
    }
    .view:active {
      opacity: var(--sk-press-opacity);
    }
    .view.active {
      border-color: var(--sk-accent);
    }
    .view-label {
      color: var(--sk-text-muted);
      font-family: var(--sk-font-medium);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight-medium);
    }
    .active .view-label {
      color: var(--sk-accent);
    }
    .toolbar {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      padding: 8px 12px 4px;
    }
    .search {
      flex: 1;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      height: 44px;
      padding: 0 10px;
      border-radius: var(--sk-button-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: var(--sk-surface);
    }
    .input {
      flex: 1;
      height: 44px;
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
    .filters {
      flex-grow: 0;
      padding: 4px 0;
    }
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
export class LibraryScreen {
  protected readonly library = inject(MusicLibrary);
  protected readonly player = inject(Player);
  private readonly skins = inject(SkinManager);
  private readonly playerView = inject(PlayerView);
  private readonly dialogs = inject(Dialogs);
  private readonly settings = inject(LibrarySettings);
  protected readonly navigation = inject(Navigation);
  protected readonly t = inject(I18n).messages;

  protected readonly views = LIBRARY_VIEWS;
  private readonly opened = this.navigation.take('library');
  /** The albums, artists and genres opened, the one on show last. */
  private readonly details = signal<readonly CatalogRef[]>(this.opened?.detail ? [this.opened.detail] : []);
  protected readonly detail = computed(() => this.details().at(-1) ?? null);
  protected readonly sorting = signal(false);
  protected readonly sortModes = SORT_MODES.songs;
  protected readonly sort = computed(() => this.settings.sortOf('songs'));

  protected readonly query = signal('');
  protected readonly adding = signal<Track | null>(null);
  protected readonly editingCover = signal<Track | null>(null);
  protected readonly colors = computed(() => this.skins.active().colors);
  /** Set when the search opened the library filtered. */
  protected readonly filters = signal<Filters>(this.opened?.filters ?? {});
  /** The detail whose filter sheet is open. */
  protected readonly picking = signal<Facet | null>(null);
  protected readonly filtered = computed(() => hasFilters(this.filters()));
  private readonly searched = computed(() => {
    const query = this.query();
    return this.library.tracks().filter((track) => matchesQuery(track, query));
  });
  protected readonly visible = computed(() => {
    const filters = this.filters();
    const sort = this.sort();
    const shown = this.searched().filter((track) => matchesFilters(track, filters));
    // The library is by name already.
    return sort.mode === 'name' && sort.ascending ? shown : sortTracks(shown, sort, this.settings.smartSort());
  });
  /** Each detail's values across the whole library, by key: a library without genres offers no genre filter. */
  private readonly known = computed(() => {
    const tracks = this.library.tracks();
    return FACETS.flatMap((facet) => {
      if (!tracks.some((track) => valuesOf(track, facet).length)) return [];
      const labels = new Map(facetOptions(tracks, facet).map((option) => [option.key, option.label]));
      return [{ facet, labels }];
    });
  });
  protected readonly chips = computed(() => {
    const t = this.t().filters;
    const filters = this.filters();
    return this.known().map(({ facet, labels }) => {
      const key = filters[facet];
      const value = key && (labels.get(key) ?? key);
      return { facet, active: !!value, label: value ? t.chip(t[facet], value) : t[facet] };
    });
  });
  /** The open filter's values among the songs the search and the other filters leave. */
  protected readonly pickerOptions = computed(() => {
    const facet = this.picking();
    if (!facet) return [];
    const filters = this.filters();
    return facetOptions(this.searched().filter((track) => matchesFilters(track, filters, facet)), facet);
  });
  protected readonly pickerSelected = computed(() => {
    const facet = this.picking();
    return facet ? this.filters()[facet] : undefined;
  });
  protected readonly countLabel = computed(() =>
    this.t().library.count(this.visible().length, this.library.tracks().length),
  );
  protected readonly emptyLabel = computed(() =>
    this.library.tracks().length ? this.t().library.noMatch : this.t().library.noAudio,
  );
  protected readonly idOf = (track: Track): string => track.id;

  constructor() {
    if (this.library.status() === 'idle') void this.library.scan();
    const release = inject(HardwareBack).handle(() => {
      const depth = this.details().length;
      // The first screen opened from the search goes back to the search.
      if (!depth || (depth === 1 && this.navigation.fromSearch())) return false;
      this.details.update((details) => details.slice(0, -1));
      return true;
    });
    inject(DestroyRef).onDestroy(release);
  }

  protected openDetail(ref: CatalogRef): void {
    this.details.update((details) => [...details, ref]);
  }

  /** Back from an album, artist or genre: to the one before, or to the search that opened it. */
  protected leaveDetail(): void {
    if (this.details().length === 1 && this.navigation.fromSearch()) {
      this.navigation.returnToSearch();
      return;
    }
    this.details.update((details) => details.slice(0, -1));
  }

  protected setSort(sort: Sort): void {
    this.settings.setSort('songs', sort);
  }

  protected play(index: number): void {
    this.player.playTracks(this.visible(), index, this.query().trim() || this.filtered() ? 'search' : 'library');
    this.playerView.show();
  }

  /** Filters by the key picked in the open sheet, or lifts its filter for null. */
  protected pick(key: string | null): void {
    const facet = this.picking();
    if (!facet) return;
    this.filters.update(({ [facet]: _, ...rest }) => (key ? { ...rest, [facet]: key } : rest));
    this.picking.set(null);
  }

  protected async more(track: Track): Promise<void> {
    const t = this.t().common;
    const choice = await this.dialogs.choose(track.title, [
      { label: t.addToPlaylist },
      { label: t.changeCover },
      { label: t.cancel, style: 'cancel' },
    ]);
    if (choice === 0) this.adding.set(track);
    if (choice === 1) this.editingCover.set(track);
  }

  protected shuffleAll(): void {
    this.player.shuffleTracks(this.visible(), 'library');
  }
}
