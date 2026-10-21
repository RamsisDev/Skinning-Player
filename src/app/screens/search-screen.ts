import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Pressable, ScrollView, Text, TextInput, View, VirtualList, VirtualListRow } from '@ng-native/components';
import { Dialogs, HardwareBack, Keyboard } from '@ng-native/device';
import { Storage } from '@ng-native/expo/async-storage';
import { type Group, groupsOf } from '../core/library-filter.ts';
import { MusicLibrary } from '../core/music-library.ts';
import { Player, type QueueSource } from '../core/player.ts';
import { type Playlist, Playlists } from '../core/playlists.ts';
import { SEARCH_KINDS, type SearchKind, type SearchRow, resultRows, rowKey, search, searchable } from '../core/search.ts';
import { type Track } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { CoverArt } from '../ui/cover-art.ts';
import { LibraryStatus } from '../ui/library-status.ts';
import { type Menu, type MenuAction, MenuSheet } from '../ui/menu-sheet.ts';
import { Navigation } from '../ui/navigation.ts';
import { PlayerView } from '../ui/player-view.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SkinIcon } from '../ui/skin-icon.ts';
import { TrackRow } from '../ui/track-row.ts';
import { AddToPlaylistSheet } from './add-to-playlist-sheet.ts';
import { CoverSheet } from './cover-sheet.ts';
import { NamePrompt } from './name-prompt.ts';

const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 64;

/**
 * The search: songs, albums, artists, genres and playlists found by name as the query is typed,
 * each kind under its own heading, narrowed by filters that are kept between visits. A song plays
 * from it among all the songs; anything else opens what it is. Each has a menu, and a long press
 * starts a selection that is played, queued or filed all at once.
 */
@Component({
  selector: 'app-search-screen',
  imports: [
    AddToPlaylistSheet,
    CoverArt,
    CoverSheet,
    LibraryStatus,
    MenuSheet,
    NamePrompt,
    Pressable,
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
    @if (selected().size) {
      <view class="toolbar">
        <app-skin-button [label]="t().search.clearSelection" icon="close" variant="ghost" [iconOnly]="true" (press)="clearSelection()" />
        <text class="heading" role="heading" [numberOfLines]="1">{{ t().search.selected(selected().size) }}</text>
        <app-skin-button [label]="t().common.play" icon="play" variant="ghost" [iconOnly]="true" (press)="playSelection(false)" />
        <app-skin-button [label]="t().common.shuffle" icon="shuffle" variant="ghost" [iconOnly]="true" (press)="playSelection(true)" />
        <app-skin-button [label]="t().common.addToPlaylist" icon="addToPlaylist" variant="ghost" [iconOnly]="true" (press)="addSelectionToPlaylist()" />
        <app-skin-button [label]="t().search.moreActions" icon="more" variant="ghost" [iconOnly]="true" (press)="selectionMenu()" />
      </view>
    } @else {
      <view class="toolbar">
        <app-skin-button [label]="t().search.close" icon="back" variant="ghost" [iconOnly]="true" (press)="close()" />
        <view class="search">
          <app-skin-icon slot="search" [size]="18" color="var(--sk-text-muted)" />
          <text-input
            class="input"
            [autoFocus]="autoFocus"
            [placeholder]="t().search.placeholder"
            [placeholderTextColor]="colors().textMuted"
            [cursorColor]="colors().accent"
            returnKeyType="search"
            [(value)]="query"
          />
          @if (query()) {
            <app-skin-button [label]="t().search.clear" icon="close" variant="ghost" size="small" [iconOnly]="true" (press)="query.set('')" />
          }
        </view>
      </view>
    }
    <scroll-view class="filters" [horizontal]="true" [contentContainerStyle]="{ paddingHorizontal: 12, gap: 8 }" keyboardShouldPersistTaps="handled">
      @for (kind of kinds; track kind) {
        <!-- Filled when on: a skin without borders shows nothing for active alone. -->
        <app-skin-button
          [label]="t().search.kinds[kind]"
          size="small"
          [icon]="filters().includes(kind) ? 'check' : null"
          [variant]="filters().includes(kind) ? 'primary' : 'normal'"
          [active]="filters().includes(kind)"
          (press)="toggleFilter(kind)"
        />
      }
    </scroll-view>
    @if (library.status() === 'ready') {
      <virtual-list
        #list
        class="list"
        [items]="rows()"
        [itemHeight]="heightOf"
        [itemType]="typeOf"
        [keyExtractor]="keyOf"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        @for (row of list.window(); track row.slot) {
          <view [virtualListRow]="row">
            @if (sectionOf(row.item); as section) {
              <text class="section" role="header">{{ t().search.kinds[section] }}</text>
            } @else if (songOf(row.item); as track) {
              <app-track-row
                [track]="track"
                [current]="player.current()?.id === track.id"
                [selected]="isSelected(row.item)"
                (press)="tap(row.item)"
                (longPress)="toggleSelected(row.item)"
              >
                <app-skin-button
                  [label]="t().library.moreFor(track.title)"
                  icon="more"
                  variant="ghost"
                  size="small"
                  [iconOnly]="true"
                  (press)="openMenu(row.item)"
                />
              </app-track-row>
            } @else {
              <pressable
                class="row"
                [class.current]="isPlaying(row.item)"
                [class.selected]="isSelected(row.item)"
                accessibilityRole="button"
                [accessibilityLabel]="nameOf(row.item) + ', ' + metaOf(row.item)"
                [accessibilityState]="{ selected: isPlaying(row.item) || isSelected(row.item) }"
                (press)="tap(row.item)"
                (longPress)="toggleSelected(row.item)"
              >
                @if (groupOf(row.item); as group) {
                  <app-cover-art [track]="group.tracks[0]" [size]="44" [radius]="6" />
                } @else {
                  <view class="playlist-art">
                    <app-skin-icon slot="playlists" [size]="22" color="var(--sk-display-text)" />
                  </view>
                }
                <view class="body">
                  <text class="title" [numberOfLines]="1">{{ nameOf(row.item) }}</text>
                  <text class="meta" [numberOfLines]="1">{{ metaOf(row.item) }}</text>
                </view>
                <app-skin-button
                  [label]="t().library.moreFor(nameOf(row.item))"
                  icon="more"
                  variant="ghost"
                  size="small"
                  [iconOnly]="true"
                  (press)="openMenu(row.item)"
                />
              </pressable>
            }
          </view>
        }
        @if (query().trim() && !rows().length) {
          <text listFooter class="empty">{{ t().search.noResults }}</text>
        }
      </virtual-list>
    } @else {
      <app-library-status />
    }
    <app-menu-sheet [menu]="menu()" (close)="menu.set(null)" />
    <app-add-to-playlist-sheet [tracks]="adding()" (close)="adding.set(null)" />
    <app-cover-sheet [track]="editingCover()" (close)="editingCover.set(null)" />
    <app-name-prompt
      [open]="!!renaming()"
      [title]="t().playlists.renamePlaylist"
      [initial]="renaming()?.name ?? ''"
      [confirmLabel]="t().playlists.rename"
      (submit)="rename($event)"
      (close)="renaming.set(null)"
    />
  `,
  styles: `
    .toolbar {
      flex-direction: row;
      align-items: center;
      gap: 4px;
      min-height: 52px;
      padding: 4px 8px;
    }
    .heading {
      flex: 1;
      color: var(--sk-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-lg);
      font-weight: var(--sk-weight-bold);
    }
    .search {
      flex: 1;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      height: 44px;
      padding: 0 4px 0 10px;
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
      padding: 4px 0 8px;
    }
    .list {
      flex: 1;
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
      background-color: transparent;
      transition-property: background-color;
      transition-duration: var(--sk-duration-fast);
      transition-timing-function: var(--sk-easing);
    }
    .row:active {
      background-color: var(--sk-surface-alt);
    }
    .current {
      background-color: var(--sk-surface);
    }
    .selected {
      background-color: var(--sk-surface-alt);
    }
    .current .title {
      color: var(--sk-accent);
    }
    .playlist-art {
      width: 44px;
      height: 44px;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      background-color: var(--sk-display-background);
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
export class SearchScreen {
  protected readonly library = inject(MusicLibrary);
  protected readonly player = inject(Player);
  private readonly playlists = inject(Playlists);
  private readonly navigation = inject(Navigation);
  private readonly playerView = inject(PlayerView);
  private readonly dialogs = inject(Dialogs);
  private readonly keyboard = inject(Keyboard);
  private readonly skins = inject(SkinManager);
  protected readonly t = inject(I18n).messages;

  protected readonly kinds = SEARCH_KINDS;
  protected readonly query = this.navigation.query;
  /** The kinds the results are narrowed to, none meaning all of them; kept between visits. */
  protected readonly filters = inject(Storage).signal<SearchKind[]>('search.filters', []);
  /** The keyboard comes up for a new search, not for one that back returned to. */
  protected readonly autoFocus = !this.query();
  protected readonly colors = computed(() => this.skins.active().colors);

  private readonly searchable = computed(() => searchable(this.library.tracks(), this.playlists.all()));
  protected readonly rows = computed(() => resultRows(search(this.searchable(), this.query(), this.filters())));
  /** What is selected, by row key; it stays selected while the query changes. */
  protected readonly selected = signal<ReadonlyMap<string, SearchRow>>(new Map());
  protected readonly menu = signal<Menu | null>(null);
  protected readonly adding = signal<readonly Track[] | null>(null);
  protected readonly editingCover = signal<Track | null>(null);
  protected readonly renaming = signal<Playlist | null>(null);

  protected readonly heightOf = (row: SearchRow): number => (row.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT);
  protected readonly typeOf = (row: SearchRow): string => row.kind;
  protected readonly keyOf = rowKey;

  constructor() {
    if (this.library.status() === 'idle') void this.library.scan();
    const release = inject(HardwareBack).handle(() => {
      if (this.selected().size) this.clearSelection();
      else this.close();
      return true;
    });
    inject(DestroyRef).onDestroy(release);
  }

  protected sectionOf(row: SearchRow): SearchKind | null {
    return row.kind === 'header' ? row.section : null;
  }

  protected songOf(row: SearchRow): Track | null {
    return row.kind === 'song' ? row.track : null;
  }

  protected groupOf(row: SearchRow): Group | null {
    return row.kind === 'group' ? row.group : null;
  }

  protected nameOf(row: SearchRow): string {
    if (row.kind === 'group') return row.group.name;
    if (row.kind === 'playlist') return row.playlist.name;
    return row.kind === 'song' ? row.track.title : '';
  }

  /** An album's artist, an artist's albums and songs, a genre's artists and songs, a playlist's songs. */
  protected metaOf(row: SearchRow): string {
    const t = this.t();
    if (row.kind === 'playlist') return t.common.songs(row.playlist.trackIds.length);
    if (row.kind !== 'group') return '';
    const { facet, tracks } = row.group;
    const songs = t.common.songs(tracks.length);
    if (facet === 'album') {
      const artists = new Set(tracks.map((track) => track.artist));
      const [artist] = artists;
      return [artists.size > 1 ? t.search.variousArtists : artist || t.common.unknownArtist, songs].join('  ·  ');
    }
    const counted = facet === 'artist' ? 'album' : 'artist';
    const count = groupsOf(tracks, counted).length;
    if (!count) return songs;
    return [counted === 'album' ? t.search.albums(count) : t.search.artists(count), songs].join('  ·  ');
  }

  protected isSelected(row: SearchRow): boolean {
    return this.selected().has(rowKey(row));
  }

  /** Whether the queue is playing from this album, artist, genre or playlist. */
  protected isPlaying(row: SearchRow): boolean {
    const source = this.player.source();
    if (!source || typeof source !== 'object') return false;
    if (row.kind === 'playlist') return 'playlist' in source && source.playlist === row.playlist.name;
    return row.kind === 'group' && 'facet' in source && source.facet === row.group.facet && source.key === row.group.key;
  }

  protected close(): void {
    this.keyboard.dismiss();
    this.navigation.closeSearch();
  }

  protected toggleFilter(kind: SearchKind): void {
    this.filters.update((filters) => (filters.includes(kind) ? filters.filter((k) => k !== kind) : [...filters, kind]));
  }

  /** A tap selects while a selection is under way; otherwise a song plays and anything else opens. */
  protected tap(row: SearchRow): void {
    if (this.selected().size) {
      this.toggleSelected(row);
      return;
    }
    this.keyboard.dismiss();
    if (row.kind === 'song') {
      const all = this.library.tracks();
      this.player.playTracks(all, all.indexOf(row.track), 'library');
      this.playerView.show();
    } else if (row.kind === 'group') {
      this.showGroup(row.group);
    } else if (row.kind === 'playlist') {
      this.navigation.show({ tab: 'playlists', playlistId: row.playlist.id });
    }
  }

  protected toggleSelected(row: SearchRow): void {
    this.keyboard.dismiss();
    const key = rowKey(row);
    this.selected.update((selected) => {
      const next = new Map(selected);
      if (next.has(key)) next.delete(key);
      else next.set(key, row);
      return next;
    });
  }

  protected clearSelection(): void {
    this.selected.set(new Map());
  }

  protected openMenu(row: SearchRow): void {
    this.keyboard.dismiss();
    const t = this.t().common;
    const tracks = this.tracksOf(row);
    const queueing: MenuAction[] = [
      { label: t.playNext, icon: 'next', run: () => this.playNext(tracks) },
      { label: t.addToQueue, icon: 'add', run: () => this.addToQueue(tracks) },
    ];
    const playing: MenuAction[] = [
      { label: t.play, icon: 'play', run: () => this.player.playTracks(tracks, 0, this.sourceOf(row)) },
      { label: t.shuffle, icon: 'shuffle', run: () => this.player.shuffleTracks(tracks, this.sourceOf(row)) },
    ];
    const filing: MenuAction = { label: t.addToPlaylist, icon: 'addToPlaylist', run: () => this.adding.set(tracks) };

    if (row.kind === 'song') {
      const { track } = row;
      const actions = [...queueing];
      if (track.artist) actions.push({ label: t.goToArtist, icon: 'library', run: () => this.goToArtist(tracks) });
      if (track.album) actions.push({ label: t.goToAlbum, icon: 'library', run: () => this.showGroup(groupsOf(tracks, 'album')[0]) });
      actions.push(filing, { label: t.changeCover, icon: 'cover', run: () => this.editingCover.set(track) });
      this.menu.set({ title: track.title, actions });
    } else if (row.kind === 'group') {
      const actions = [...playing, ...queueing];
      if (row.group.facet === 'album' && tracks.some((track) => track.artist)) {
        actions.push({ label: t.goToArtist, icon: 'library', run: () => this.goToArtist(tracks) });
      }
      this.menu.set({ title: row.group.name, actions: [...actions, filing] });
    } else if (row.kind === 'playlist') {
      const { playlist } = row;
      const p = this.t().playlists;
      this.menu.set({
        title: playlist.name,
        actions: [
          ...playing,
          ...queueing,
          { label: p.rename, icon: 'rename', run: () => this.renaming.set(playlist) },
          { label: p.deletePlaylist, icon: 'remove', run: () => void this.deletePlaylist(playlist) },
        ],
      });
    }
  }

  protected playSelection(shuffled: boolean): void {
    const tracks = this.selectedTracks();
    if (shuffled) this.player.shuffleTracks(tracks, 'search');
    else this.player.playTracks(tracks, 0, 'search');
    this.clearSelection();
  }

  protected addSelectionToPlaylist(): void {
    this.adding.set(this.selectedTracks());
    this.clearSelection();
  }

  protected selectionMenu(): void {
    const t = this.t().common;
    const tracks = this.selectedTracks();
    const done = (run: () => void) => () => {
      run();
      this.clearSelection();
    };
    this.menu.set({
      title: this.t().search.selected(this.selected().size),
      actions: [
        { label: t.playNext, icon: 'next', run: done(() => this.playNext(tracks)) },
        { label: t.addToQueue, icon: 'add', run: done(() => this.addToQueue(tracks)) },
      ],
    });
  }

  protected rename(name: string): void {
    const playlist = this.renaming();
    if (playlist) this.playlists.rename(playlist.id, name);
    this.renaming.set(null);
  }

  private async deletePlaylist(playlist: Playlist): Promise<void> {
    const t = this.t().common;
    const confirmed = await this.dialogs.confirm(this.t().playlists.confirmDelete(playlist.name), {
      destructive: true,
      confirm: t.ok,
      cancel: t.cancel,
    });
    if (confirmed) this.playlists.remove(playlist.id);
  }

  private playNext(tracks: readonly Track[]): void {
    this.player.playNext(tracks);
    this.dialogs.notify(this.t().common.playingNext);
  }

  private addToQueue(tracks: readonly Track[]): void {
    this.player.addToQueue(tracks);
    this.dialogs.notify(this.t().common.addedToQueue);
  }

  /** Opens the library on an album's, artist's or genre's songs. */
  private showGroup(group: Group): void {
    this.navigation.show({ tab: 'library', filters: { [group.facet]: group.key } });
  }

  /** The artist of these songs, or a choice among them when there are several. */
  private goToArtist(tracks: readonly Track[]): void {
    const artists = groupsOf(tracks, 'artist');
    if (artists.length === 1) {
      this.showGroup(artists[0]);
      return;
    }
    this.menu.set({
      title: this.t().common.goToArtist,
      actions: artists.map((artist) => ({ label: artist.name, icon: 'library', run: () => this.showGroup(artist) })),
    });
  }

  private tracksOf(row: SearchRow): readonly Track[] {
    if (row.kind === 'song') return [row.track];
    if (row.kind === 'group') return row.group.tracks;
    if (row.kind === 'playlist') return this.playlists.tracksOf(row.playlist, this.library.byId());
    return [];
  }

  private sourceOf(row: SearchRow): QueueSource | null {
    if (row.kind === 'group') return { facet: row.group.facet, key: row.group.key, name: row.group.name };
    if (row.kind === 'playlist') return { playlist: row.playlist.name };
    return null;
  }

  /** The songs of everything selected, each once, in the order they were selected. */
  private selectedTracks(): Track[] {
    return [...new Set([...this.selected().values()].flatMap((row) => this.tracksOf(row)))];
  }
}
