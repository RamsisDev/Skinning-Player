import { Component, computed, inject, signal } from '@angular/core';
import { Modal, SafeAreaProvider, SafeAreaView, Text, View } from '@ng-native/components';
import { Player } from '../core/player.ts';
import { type Track, formatTime } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { CoverArt } from '../ui/cover-art.ts';
import { PlayerView } from '../ui/player-view.ts';
import { SkinBackdrop } from '../ui/skin-backdrop.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SeekBar } from '../widgets/seek-bar.ts';
import { Visualizer } from '../widgets/visualizer.ts';
import { AddToPlaylistSheet } from './add-to-playlist-sheet.ts';
import { CoverSheet } from './cover-sheet.ts';

/** The full player: the cover, the song, the seek bar and the transport, all drawn by the skin. */
@Component({
  selector: 'app-now-playing',
  imports: [AddToPlaylistSheet, CoverArt, CoverSheet, Modal, SafeAreaProvider, SafeAreaView, SeekBar, SkinBackdrop, SkinButton, Text, View, Visualizer],
  template: `
    <modal [visible]="view.open()" [animationType]="skins.playerTransition()" (requestClose)="view.hide()">
      <safe-area-provider [reportInsets]="false" class="fill">
        <view class="screen">
          <app-skin-backdrop />
          <safe-area-view class="fill" [edges]="['top', 'bottom']">
            <view class="header">
              <app-skin-button [label]="t().player.close" icon="close" variant="ghost" [iconOnly]="true" (press)="view.hide()" />
              <text class="heading">{{ t().player.heading }}</text>
              <view class="header-actions">
                <app-skin-button
                  [label]="t().common.changeCover"
                  icon="cover"
                  variant="ghost"
                  [iconOnly]="true"
                  [disabled]="!player.current()"
                  (press)="editingCover.set(player.current())"
                />
                <app-skin-button
                  [label]="t().common.addToPlaylist"
                  icon="addToPlaylist"
                  variant="ghost"
                  [iconOnly]="true"
                  [disabled]="!player.current()"
                  (press)="adding.set(player.current())"
                />
              </view>
            </view>

            <view class="body">
              <view class="art-area" (layout)="artArea.set($event.nativeEvent.layout)">
                <app-cover-art [track]="player.current()" [size]="artSize()" />
              </view>

              <view class="song">
                <text class="title" role="heading" [numberOfLines]="1">{{ title() }}</text>
                <text class="artist" [numberOfLines]="1">{{ artist() }}</text>
              </view>

              @if (skins.active().widgets.visualizer) {
                <app-visualizer />
              }

              <view class="seek">
                <app-seek-bar [progress]="player.progress()" (seek)="player.seek($event)" />
                <view class="times">
                  <text class="time">{{ elapsed() }}</text>
                  <text class="time">{{ total() }}</text>
                </view>
              </view>

              <view class="transport">
                <app-skin-button [label]="t().common.shuffle" icon="shuffle" variant="ghost" [iconOnly]="true" [active]="player.shuffle()" (press)="player.toggleShuffle()" />
                <app-skin-button [label]="t().common.previous" icon="previous" [iconOnly]="true" [disabled]="!player.current()" (press)="player.previous()" />
                <app-skin-button
                  [label]="player.playing() ? t().common.pause : t().common.play"
                  [icon]="player.playing() ? 'pause' : 'play'"
                  variant="primary"
                  size="large"
                  [iconOnly]="true"
                  (press)="player.toggle()"
                />
                <app-skin-button [label]="t().common.next" icon="next" [iconOnly]="true" [disabled]="!player.current()" (press)="player.next()" />
                <app-skin-button
                  [label]="repeatLabel()"
                  [icon]="player.repeat() === 'one' ? 'repeatOne' : 'repeat'"
                  variant="ghost"
                  [iconOnly]="true"
                  [active]="player.repeat() !== 'off'"
                  (press)="player.cycleRepeat()"
                />
              </view>

              @if (player.error(); as error) {
                <text class="error" role="alert">{{ t().player.couldNotPlay(error.track.title) }}</text>
              }
            </view>
          </safe-area-view>
        </view>
        <app-add-to-playlist-sheet [track]="adding()" (close)="adding.set(null)" />
        <app-cover-sheet [track]="editingCover()" (close)="editingCover.set(null)" />
      </safe-area-provider>
    </modal>
  `,
  styles: `
    .fill {
      flex: 1;
    }
    .screen {
      flex: 1;
      background-color: var(--sk-background);
    }
    .header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
    }
    .header-actions {
      flex-direction: row;
    }
    .heading {
      color: var(--sk-text-muted);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight-bold);
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .body {
      flex: 1;
      gap: 18px;
      padding: 8px 20px 16px;
    }
    .art-area {
      flex: 1;
      align-items: center;
      justify-content: center;
    }
    .song {
      align-items: center;
      gap: 2px;
    }
    .title {
      color: var(--sk-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-xl);
      font-weight: var(--sk-weight-bold);
      text-align: center;
    }
    .artist {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
      text-align: center;
    }
    .seek {
      gap: 2px;
    }
    .times {
      flex-direction: row;
      justify-content: space-between;
    }
    .time {
      color: var(--sk-text-muted);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-display-weight);
    }
    .transport {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
    .error {
      color: var(--sk-danger);
      font-family: var(--sk-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight);
      text-align: center;
    }
  `,
})
export class NowPlaying {
  protected readonly player = inject(Player);
  protected readonly skins = inject(SkinManager);
  protected readonly view = inject(PlayerView);
  protected readonly t = inject(I18n).messages;

  protected readonly adding = signal<Track | null>(null);
  protected readonly editingCover = signal<Track | null>(null);
  /** The space left for the cover, which is as large a square as fits in it. */
  protected readonly artArea = signal({ width: 0, height: 0 });
  protected readonly artSize = computed(() => {
    const { width, height } = this.artArea();
    return Math.max(0, Math.floor(Math.min(width, height)));
  });

  protected readonly title = computed(() => this.player.current()?.title ?? this.t().common.nothingPlaying);
  protected readonly artist = computed(() => {
    const track = this.player.current();
    if (!track) return this.t().common.pickASong;
    return track.artist || this.t().common.unknownArtist;
  });
  protected readonly elapsed = computed(() => formatTime(this.player.elapsed()));
  protected readonly total = computed(() => formatTime(this.player.duration()));
  protected readonly repeatLabel = computed(() => this.t().player.repeat[this.player.repeat()]);
}
