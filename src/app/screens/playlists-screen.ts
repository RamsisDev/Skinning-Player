import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Pressable, ScrollView, Text, View, VirtualList, VirtualListRow } from '@ng-native/components';
import { Dialogs, HardwareBack } from '@ng-native/device';
import { MusicLibrary } from '../core/music-library.ts';
import { Player } from '../core/player.ts';
import { type Playlist, Playlists } from '../core/playlists.ts';
import { type Track } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { LibraryStatus } from '../ui/library-status.ts';
import { Navigation } from '../ui/navigation.ts';
import { PlayerView } from '../ui/player-view.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SkinIcon } from '../ui/skin-icon.ts';
import { TrackRow } from '../ui/track-row.ts';
import { NamePrompt } from './name-prompt.ts';
import { TrackPicker } from './track-picker.ts';

type Prompt = { kind: 'create' } | { kind: 'rename'; playlist: Playlist };

/** The playlists, and one playlist's songs when it is open. */
@Component({
  selector: 'app-playlists-screen',
  imports: [LibraryStatus, NamePrompt, Pressable, ScrollView, SkinButton, SkinIcon, Text, TrackPicker, TrackRow, View, VirtualList, VirtualListRow],
  host: { style: 'flex: 1' },
  template: `
    @if (openPlaylist(); as playlist) {
      <view class="toolbar">
        <app-skin-button [label]="t().playlists.backToPlaylists" icon="back" variant="ghost" [iconOnly]="true" (press)="openId.set(null)" />
        <text class="heading" role="heading" [numberOfLines]="1">{{ playlist.name }}</text>
        <app-skin-button [label]="t().playlists.renamePlaylist" icon="rename" variant="ghost" [iconOnly]="true" (press)="prompt.set({ kind: 'rename', playlist })" />
        <app-skin-button [label]="t().playlists.deletePlaylist" icon="remove" variant="ghost" [iconOnly]="true" (press)="deletePlaylist(playlist)" />
      </view>
      @if (library.status() === 'ready') {
        <view class="actions">
          <text class="count">{{ detailCount() }}</text>
          <app-skin-button [label]="t().playlists.addSongs" icon="add" size="small" (press)="picking.set(true)" />
          <app-skin-button [label]="t().common.shuffle" icon="shuffle" size="small" [disabled]="!openTracks().length" (press)="shuffle(playlist)" />
          <app-skin-button [label]="t().common.play" icon="play" variant="primary" size="small" [disabled]="!openTracks().length" (press)="play(playlist, 0)" />
        </view>
        <virtual-list #list class="list" [items]="openTracks()" [itemHeight]="64" [keyExtractor]="idOf">
          @for (row of list.window(); track row.slot) {
            <view [virtualListRow]="row">
              <app-track-row
                [track]="row.item"
                [current]="player.current()?.id === row.item.id"
                (press)="playSong(playlist, row.index)"
                (longPress)="reorder(playlist, row.item)"
              >
                <app-skin-button [label]="t().playlists.removeFromPlaylist" icon="remove" variant="ghost" size="small" [iconOnly]="true" (press)="removeTrack(playlist, row.item)" />
              </app-track-row>
            </view>
          }
          @if (!openTracks().length) {
            <text listFooter class="empty">{{ t().playlists.empty }}</text>
          }
        </virtual-list>
        <app-track-picker
          [open]="picking()"
          [title]="t().playlists.addTo(playlist.name)"
          [excluded]="playlist.trackIds"
          (done)="addTracks(playlist, $event)"
          (close)="picking.set(false)"
        />
      } @else {
        <app-library-status />
      }
    } @else {
      <view class="actions">
        <text class="count">{{ t().playlists.count(playlists.all().length) }}</text>
        <app-skin-button [label]="t().playlists.newPlaylist" icon="add" variant="primary" size="small" (press)="prompt.set({ kind: 'create' })" />
      </view>
      <scroll-view class="list" [contentContainerStyle]="{ padding: 12, gap: 10 }">
        @for (playlist of playlists.all(); track playlist.id) {
          <pressable class="card" accessibilityRole="button" [accessibilityLabel]="t().playlists.open(playlist.name)" (press)="open(playlist)">
            <view class="cover">
              <app-skin-icon slot="playlists" [size]="26" color="var(--sk-display-text)" />
            </view>
            <view class="card-body">
              <text class="card-title" [numberOfLines]="1">{{ playlist.name }}</text>
              <text class="card-meta">{{ t().common.songs(playlist.trackIds.length) }}</text>
            </view>
            <app-skin-button
              [label]="t().playlists.playName(playlist.name)"
              icon="play"
              variant="primary"
              size="small"
              [iconOnly]="true"
              [disabled]="!playlist.trackIds.length"
              (press)="play(playlist, 0)"
            />
          </pressable>
        } @empty {
          <view class="empty-state">
            <app-skin-icon slot="playlists" [size]="48" color="var(--sk-text-muted)" />
            <text class="empty">{{ t().playlists.none }}</text>
          </view>
        }
      </scroll-view>
    }
    <app-name-prompt
      [open]="!!prompt()"
      [title]="prompt()?.kind === 'rename' ? t().playlists.renamePlaylist : t().playlists.newPlaylist"
      [initial]="promptInitial()"
      [confirmLabel]="prompt()?.kind === 'rename' ? t().playlists.rename : t().common.create"
      (submit)="submitName($event)"
      (close)="prompt.set(null)"
    />
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
    .actions {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
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
    .card {
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 10px;
      border-radius: var(--sk-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: var(--sk-surface);
      transition-property: opacity, transform;
      transition-duration: var(--sk-duration-fast);
      transition-timing-function: var(--sk-easing);
    }
    .card:active {
      opacity: var(--sk-press-opacity);
      transform: scale(var(--sk-press-scale));
    }
    .cover {
      width: 52px;
      height: 52px;
      align-items: center;
      justify-content: center;
      border-radius: var(--sk-widget-radius);
      background-color: var(--sk-display-background);
    }
    .card-body {
      flex: 1;
      gap: 2px;
    }
    .card-title {
      color: var(--sk-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight-bold);
    }
    .card-meta {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
    }
    .empty-state {
      align-items: center;
      gap: 12px;
      padding: 48px 16px;
    }
    .empty {
      padding: 16px;
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight);
      text-align: center;
    }
  `,
})
export class PlaylistsScreen {
  protected readonly playlists = inject(Playlists);
  protected readonly library = inject(MusicLibrary);
  protected readonly player = inject(Player);
  private readonly dialogs = inject(Dialogs);
  private readonly playerView = inject(PlayerView);
  protected readonly t = inject(I18n).messages;

  private readonly navigation = inject(Navigation);
  /** Set when the search opened a playlist. */
  protected readonly openId = signal<string | null>(this.navigation.take('playlists')?.playlistId ?? null);
  protected readonly prompt = signal<Prompt | null>(null);
  protected readonly picking = signal(false);

  protected readonly openPlaylist = computed(() => {
    const id = this.openId();
    return id ? (this.playlists.all().find((playlist) => playlist.id === id) ?? null) : null;
  });
  protected readonly openTracks = computed<readonly Track[]>(() => {
    const playlist = this.openPlaylist();
    return playlist ? this.playlists.tracksOf(playlist, this.library.byId()) : [];
  });
  protected readonly detailCount = computed(() => {
    const playlist = this.openPlaylist();
    const present = this.openTracks().length;
    const missing = (playlist?.trackIds.length ?? 0) - present;
    return this.t().playlists.detailCount(present, missing);
  });
  protected readonly promptInitial = computed(() => {
    const prompt = this.prompt();
    return prompt?.kind === 'rename' ? prompt.playlist.name : '';
  });
  protected readonly idOf = (track: Track): string => track.id;

  constructor() {
    const release = inject(HardwareBack).handle(() => {
      // A playlist opened from the search goes back to the search, as in Auxio.
      if (!this.openId() || this.navigation.fromSearch()) return false;
      this.openId.set(null);
      return true;
    });
    inject(DestroyRef).onDestroy(release);
  }

  protected open(playlist: Playlist): void {
    this.openId.set(playlist.id);
    if (this.library.status() === 'idle') void this.library.scan();
  }

  protected async play(playlist: Playlist, index: number): Promise<void> {
    if (this.library.status() !== 'ready') await this.library.scan();
    this.player.playTracks(this.playlists.tracksOf(playlist, this.library.byId()), index, { playlist: playlist.name });
  }

  /** A tap on one of the playlist's songs: plays from it and opens the player. */
  protected async playSong(playlist: Playlist, index: number): Promise<void> {
    await this.play(playlist, index);
    this.playerView.show();
  }

  protected shuffle(playlist: Playlist): void {
    this.player.shuffleTracks(this.openTracks(), { playlist: playlist.name });
  }

  protected submitName(name: string): void {
    const prompt = this.prompt();
    if (prompt?.kind === 'rename') this.playlists.rename(prompt.playlist.id, name);
    else {
      const id = this.playlists.create(name);
      if (id) this.openId.set(id);
    }
    this.prompt.set(null);
  }

  protected async deletePlaylist(playlist: Playlist): Promise<void> {
    const t = this.t().common;
    const confirmed = await this.dialogs.confirm(this.t().playlists.confirmDelete(playlist.name), {
      destructive: true,
      confirm: t.ok,
      cancel: t.cancel,
    });
    if (!confirmed) return;
    this.playlists.remove(playlist.id);
    this.openId.set(null);
  }

  protected removeTrack(playlist: Playlist, track: Track): void {
    this.playlists.removeTrack(playlist.id, track.id);
  }

  protected async reorder(playlist: Playlist, track: Track): Promise<void> {
    const t = this.t();
    const choice = await this.dialogs.choose(track.title, [
      { label: t.playlists.moveUp },
      { label: t.playlists.moveDown },
      { label: t.common.cancel, style: 'cancel' },
    ]);
    if (choice === 0) this.playlists.moveTrack(playlist.id, track.id, -1);
    if (choice === 1) this.playlists.moveTrack(playlist.id, track.id, 1);
  }

  protected addTracks(playlist: Playlist, trackIds: string[]): void {
    const added = this.playlists.addTracks(playlist.id, trackIds);
    this.picking.set(false);
    this.dialogs.notify(this.t().playlists.added(added));
  }
}
