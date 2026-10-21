import { Component, computed, inject, input, output } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { Dialogs } from '@ng-native/device';
import { type FailureReason, Player } from '../core/player.ts';
import { type Track, formatTime } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { CoverArt } from './cover-art.ts';
import { SkinIcon } from './skin-icon.ts';

/**
 * One track in a list, led by a thumbnail of its cover, or in an album by its track number.
 * Trailing buttons are projected, and win the press over the row. A track that failed to play
 * carries a warning that explains why.
 */
@Component({
  selector: 'app-track-row',
  imports: [CoverArt, Pressable, SkinIcon, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <pressable
      class="row"
      [class.current]="current()"
      [class.selected]="selected()"
      accessibilityRole="button"
      [accessibilityLabel]="accessibleName()"
      [accessibilityState]="{ selected: current() || selected() }"
      (press)="press.emit()"
      (longPress)="longPress.emit()"
    >
      @if (number() === undefined) {
        <app-cover-art [track]="track()" [size]="44" [radius]="6" />
      } @else {
        <text class="number">{{ number() ?? '-' }}</text>
      }
      <view class="body">
        <text class="title" [numberOfLines]="1">{{ track().title }}</text>
        <text class="meta" [numberOfLines]="1">{{ meta() }}</text>
      </view>
      @if (problem(); as reason) {
        <pressable
          class="warning"
          accessibilityRole="button"
          [accessibilityLabel]="warningLabel()"
          [hitSlop]="8"
          (press)="explain(reason)"
        >
          <app-skin-icon slot="warning" [size]="20" color="var(--sk-danger)" />
        </pressable>
      }
      <ng-content />
    </pressable>
  `,
  styles: `
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
    .number {
      width: 32px;
      color: var(--sk-text-muted);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-display-weight);
      text-align: center;
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
    .warning {
      width: 36px;
      height: 36px;
      align-items: center;
      justify-content: center;
    }
  `,
})
export class TrackRow {
  private readonly player = inject(Player);
  private readonly dialogs = inject(Dialogs);
  private readonly t = inject(I18n).messages;

  readonly track = input.required<Track>();
  readonly current = input(false);
  readonly selected = input(false);
  /** Shown in place of the cover when given, as an album lists its songs; null for a song with none. */
  readonly number = input<number | null | undefined>(undefined);
  /** Leaves the album out of the details, for a list of the album's own songs. */
  readonly hideAlbum = input(false);
  readonly press = output<void>();
  readonly longPress = output<void>();

  protected readonly meta = computed(() => {
    const { artist, album, duration } = this.track();
    const shownAlbum = this.hideAlbum() ? '' : album;
    return [artist || this.t().common.unknownArtist, shownAlbum, duration ? formatTime(duration) : ''].filter(Boolean).join('  ·  ');
  });
  protected readonly accessibleName = computed(() => {
    const { title, artist } = this.track();
    return artist ? `${title}, ${artist}` : title;
  });
  protected readonly problem = computed(() => this.player.failures().get(this.track().id) ?? null);
  protected readonly warningLabel = computed(() => this.t().player.whyLabel(this.track().title));

  protected explain(reason: FailureReason): void {
    const t = this.t();
    void this.dialogs.tell(
      t.player.cannotPlay(this.track().title),
      `${t.player[reason]}\n\n${t.player.retry}`,
      t.common.ok,
    );
  }
}
