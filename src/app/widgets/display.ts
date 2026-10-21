import { Component, computed, inject, input, signal } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { Player } from '../core/player.ts';
import { formatTime } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';

/**
 * The player's display panel, an LCD in the skin's `--sk-display-*` colors and display font, with
 * the skin's looping effect. Tapping the time switches between elapsed and remaining, as Winamp's
 * did.
 */
@Component({
  selector: 'app-display',
  imports: [Pressable, Text, View],
  template: `
    <view class="panel" [class.compact]="compact()" [class]="'effect-' + effect()">
      <pressable
        class="clock"
        accessibilityRole="button"
        [accessibilityLabel]="remaining() ? t().player.remaining : t().player.elapsed"
        (press)="remaining.set(!remaining())"
      >
        <text class="status">{{ status() }}</text>
        <text class="time">{{ time() }}</text>
      </pressable>
      @if (!compact()) {
        <view class="lines">
          <text class="title" [numberOfLines]="1">{{ titleLine() }}</text>
          <text class="info" [numberOfLines]="1">{{ infoLine() }}</text>
        </view>
      }
    </view>
  `,
  styles: `
    .panel {
      gap: 8px;
      padding: 12px 14px;
      border-radius: var(--sk-widget-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-widget-border);
      background-color: var(--sk-display-background);
    }
    .panel.compact {
      padding: 4px 8px;
    }
    .clock {
      flex-direction: row;
      align-items: center;
      gap: 10px;
    }
    .status {
      color: var(--sk-display-text);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-display-weight);
    }
    .time {
      color: var(--sk-display-text);
      font-family: var(--sk-display-font-bold);
      font-size: var(--sk-font-xxl);
      font-weight: var(--sk-display-weight-bold);
      font-variant: tabular-nums;
    }
    .compact .status {
      font-size: var(--sk-font-xs);
    }
    .compact .time {
      font-size: var(--sk-font-md);
    }
    .lines {
      gap: 2px;
    }
    .title {
      color: var(--sk-display-text);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-display-weight);
    }
    .info {
      color: var(--sk-display-text);
      opacity: 0.7;
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-display-weight);
      text-transform: uppercase;
    }
    .effect-pulse .clock,
    .effect-pulse .lines {
      animation: display-pulse 2.4s ease-in-out infinite;
      animation-duration: var(--sk-effect-duration);
    }
    .effect-flicker .clock,
    .effect-flicker .lines {
      animation: display-flicker 4s linear infinite;
      animation-duration: var(--sk-effect-duration);
    }
    .effect-blink .time {
      animation: display-blink 1s linear infinite;
      animation-duration: var(--sk-effect-duration);
    }
    @keyframes display-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.55;
      }
    }
    @keyframes display-flicker {
      0%,
      100% {
        opacity: 1;
      }
      3% {
        opacity: 0.4;
      }
      6% {
        opacity: 1;
      }
      52% {
        opacity: 1;
      }
      54% {
        opacity: 0.65;
      }
      56% {
        opacity: 1;
      }
    }
    @keyframes display-blink {
      0%,
      49% {
        opacity: 1;
      }
      50%,
      100% {
        opacity: 0;
      }
    }
  `,
})
export class Display {
  private readonly player = inject(Player);
  private readonly skins = inject(SkinManager);

  protected readonly t = inject(I18n).messages;

  readonly compact = input(false);
  protected readonly remaining = signal(false);

  /** The skin's effect while motion is on; `blink` only while a song is paused. */
  protected readonly effect = computed(() => {
    const { speed, displayEffect } = this.skins.active().motion;
    if (speed === 0) return 'none';
    if (displayEffect === 'blink') return this.player.current() && !this.player.playing() ? 'blink' : 'none';
    return displayEffect;
  });

  protected readonly status = computed(() => {
    if (!this.player.current()) return '■';
    return this.player.playing() ? '▶' : '❚❚';
  });
  protected readonly time = computed(() => {
    const elapsed = this.player.elapsed();
    return this.remaining()
      ? `-${formatTime(Math.max(0, this.player.duration() - elapsed))}`
      : formatTime(elapsed);
  });
  protected readonly titleLine = computed(() => {
    const track = this.player.current();
    if (!track) return 'Skinning Player';
    const name = track.artist ? `${track.artist} - ${track.title}` : track.title;
    return `${this.player.queuePosition()}. ${name} (${formatTime(this.player.duration())})`;
  });
  protected readonly infoLine = computed(() => {
    const track = this.player.current();
    if (!track) return this.t().common.pickASong;
    const kind = /\.([a-z0-9]+)$/i.exec(track.filename)?.[1] ?? 'audio';
    return [kind, `${this.player.queuePosition()}/${this.player.queueLength()}`, this.sourceName()]
      .filter(Boolean)
      .join('  ·  ');
  });

  private sourceName(): string {
    const source = this.player.source();
    if (!source) return '';
    if (typeof source === 'object') return source.playlist;
    return this.t().sources[source];
  }
}
