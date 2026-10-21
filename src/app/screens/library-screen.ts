import { Component, computed, inject, signal } from '@angular/core';
import { ScrollView, Text, TextInput, View, VirtualList, VirtualListRow } from '@ng-native/components';
import { Dialogs } from '@ng-native/device';
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
import { type Track, matchesQuery } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { LibraryStatus } from '../ui/library-status.ts';
import { PlayerView } from '../ui/player-view.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SkinIcon } from '../ui/skin-icon.ts';
import { TrackRow } from '../ui/track-row.ts';
import { AddToPlaylistSheet } from './add-to-playlist-sheet.ts';
import { CoverSheet } from './cover-sheet.ts';
import { FilterSheet } from './filter-sheet.ts';

/**
 * Every song on the device, searchable and filtered by the details its songs have: a filter for
 * each of artist, album, genre and year the library knows, offering only the values left among the
 * songs on show. A tap plays from that song and opens the player; a long
 * press files it; its menu also sets its cover.
 */
@Component({
  selector: 'app-library-screen',
  imports: [
    AddToPlaylistSheet,
    CoverSheet,
    FilterSheet,
    LibraryStatus,
    ScrollView,
    SkinButton,
    SkinIcon,
    Text,
    TextInput,
    TrackRow,
    View,
    VirtualList,
    VirtualListRow,
  ],
  host: { style: 'flex: 1' },
  template: `
    @if (library.status() === 'ready') {
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
    } @else {
      <app-library-status />
    }
    <app-add-to-playlist-sheet [track]="adding()" (close)="adding.set(null)" />
    <app-cover-sheet [track]="editingCover()" (close)="editingCover.set(null)" />
    <app-filter-sheet
      [facet]="picking()"
      [options]="pickerOptions()"
      [selected]="pickerSelected()"
      (pick)="pick($event)"
      (close)="picking.set(null)"
    />
  `,
  styles: `
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
  protected readonly t = inject(I18n).messages;

  protected readonly query = signal('');
  protected readonly adding = signal<Track | null>(null);
  protected readonly editingCover = signal<Track | null>(null);
  protected readonly colors = computed(() => this.skins.active().colors);
  protected readonly filters = signal<Filters>({});
  /** The detail whose filter sheet is open. */
  protected readonly picking = signal<Facet | null>(null);
  protected readonly filtered = computed(() => hasFilters(this.filters()));
  private readonly searched = computed(() => {
    const query = this.query();
    return this.library.tracks().filter((track) => matchesQuery(track, query));
  });
  protected readonly visible = computed(() => {
    const filters = this.filters();
    return this.searched().filter((track) => matchesFilters(track, filters));
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
