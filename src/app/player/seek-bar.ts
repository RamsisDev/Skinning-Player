import { Component, computed, inject, input, output, signal } from '@angular/core';
import { type LayoutEvent, type PressEvent, Pressable, View } from '@ng-native/components';
import { I18n } from '../i18n/i18n.ts';

/** A progress bar that seeks where it is tapped. The touch area is taller than the bar. */
@Component({
  selector: 'app-seek-bar',
  imports: [Pressable, View],
  template: `
    <pressable
      class="hit"
      accessibilityRole="adjustable"
      [accessibilityLabel]="t().player.position"
      [accessibilityValue]="{ min: 0, max: 100, now: percent() }"
      (layout)="onLayout($event)"
      (press)="seekTo($event)"
    >
      <!-- Children never take the touch, so locationX is measured from the bar's own left edge. -->
      <view class="track" pointerEvents="none">
        <view class="fill" [style.width.%]="percent()"></view>
      </view>
      <view class="thumb" pointerEvents="none" [style.left.%]="percent()"></view>
    </pressable>
  `,
  styles: `
    .hit {
      height: 28px;
      justify-content: center;
    }
    .track {
      height: 6px;
      overflow: hidden;
      border-radius: var(--sk-widget-radius);
      background-color: var(--sk-progress-track);
    }
    .fill {
      height: 6px;
      background-color: var(--sk-progress-fill);
    }
    .thumb {
      position: absolute;
      top: 7px;
      width: 14px;
      height: 14px;
      margin-left: -7px;
      border-radius: 7px;
      border-width: 2px;
      border-color: var(--sk-widget-background);
      background-color: var(--sk-progress-fill);
    }
  `,
})
export class SeekBar {
  protected readonly t = inject(I18n).messages;

  /** 0 to 1. */
  readonly progress = input(0);
  readonly seek = output<number>();

  protected readonly width = signal(0);
  protected readonly percent = computed(() => Math.round(this.progress() * 1000) / 10);

  protected onLayout(event: LayoutEvent): void {
    this.width.set(event.nativeEvent.layout.width);
  }

  protected seekTo(event: PressEvent): void {
    const x = event.nativeEvent.locationX;
    const width = this.width();
    if (x === undefined || width <= 0) return;
    this.seek.emit(Math.min(1, Math.max(0, x / width)));
  }
}
