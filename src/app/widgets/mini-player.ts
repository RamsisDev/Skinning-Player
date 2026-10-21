import { Component, computed, inject, output } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { Player } from '../core/player.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { CoverArt } from '../ui/cover-art.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { Display } from './display.ts';

/** The player docked above the menu. Tapping it opens the full player. */
@Component({
  selector: 'app-mini-player',
  imports: [CoverArt, Display, Pressable, SkinButton, Text, View],
  template: `
    <view class="widget">
      <view class="progress" pointerEvents="none">
        <view class="progress-fill" [style.width.%]="player.progress() * 100"></view>
      </view>
      <view class="row">
        <pressable
          class="info"
          accessibilityRole="button"
          [accessibilityLabel]="t().player.open"
          (press)="expand.emit()"
        >
          <app-cover-art [track]="player.current()" [size]="40" />
          @if (skins.active().widgets.miniDisplay) {
            <app-display [compact]="true" />
          }
          <view class="text">
            <text class="title" [numberOfLines]="1">{{ title() }}</text>
            <text class="artist" [numberOfLines]="1">{{ subtitle() }}</text>
          </view>
        </pressable>
        <app-skin-button [label]="t().common.previous" icon="previous" variant="ghost" size="small" [iconOnly]="true" [disabled]="!player.current()" (press)="player.previous()" />
        <app-skin-button
          [label]="player.playing() ? t().common.pause : t().common.play"
          [icon]="player.playing() ? 'pause' : 'play'"
          variant="primary"
          size="small"
          [iconOnly]="true"
          (press)="player.toggle()"
        />
        <app-skin-button [label]="t().common.next" icon="next" variant="ghost" size="small" [iconOnly]="true" [disabled]="!player.current()" (press)="player.next()" />
      </view>
    </view>
  `,
  styles: `
    .widget {
      margin: 0 8px 6px;
      overflow: hidden;
      border-radius: var(--sk-widget-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-widget-border);
      background-color: var(--sk-widget-background);
    }
    .progress {
      height: 3px;
      background-color: var(--sk-progress-track);
    }
    .progress-fill {
      height: 3px;
      background-color: var(--sk-progress-fill);
    }
    .row {
      flex-direction: row;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
    }
    .info {
      flex: 1;
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .text {
      flex: 1;
    }
    .title {
      color: var(--sk-widget-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight-bold);
    }
    .artist {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
    }
  `,
})
export class MiniPlayer {
  protected readonly player = inject(Player);
  protected readonly skins = inject(SkinManager);
  protected readonly t = inject(I18n).messages;
  readonly expand = output<void>();

  protected readonly title = computed(() => this.player.current()?.title ?? this.t().common.nothingPlaying);
  protected readonly subtitle = computed(() => {
    const track = this.player.current();
    if (!track) return this.t().player.idle;
    return track.artist || this.t().common.unknownArtist;
  });
}
