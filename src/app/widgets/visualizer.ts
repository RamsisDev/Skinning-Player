import { Component, computed, inject } from '@angular/core';
import { View } from '@ng-native/components';
import { Player } from '../core/player.ts';
import { SkinManager } from '../skins/skin-manager.ts';

/**
 * Decorative spectrum bars. They do not analyse the audio: their heights follow the playback
 * clock, and a CSS transition eases each update. The bar count comes from the skin.
 */
@Component({
  selector: 'app-visualizer',
  imports: [View],
  template: `
    <view class="bars" aria-hidden="true" importantForAccessibility="no-hide-descendants">
      @for (height of heights(); track $index) {
        <view class="bar" [style.height.%]="height"></view>
      }
    </view>
  `,
  styles: `
    .bars {
      height: 64px;
      flex-direction: row;
      align-items: flex-end;
      gap: 3px;
      padding: 6px;
      border-radius: var(--sk-widget-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-widget-border);
      background-color: var(--sk-display-background);
    }
    .bar {
      flex: 1;
      min-height: 2px;
      border-radius: 1px;
      background-color: var(--sk-progress-fill);
      transition-property: height;
      transition-duration: var(--sk-duration-slow);
      transition-timing-function: var(--sk-easing);
    }
  `,
})
export class Visualizer {
  private readonly player = inject(Player);
  private readonly skins = inject(SkinManager);

  protected readonly heights = computed(() => {
    const count = this.skins.active().widgets.visualizerBars;
    const playing = this.player.playing();
    const t = this.player.elapsed();
    return Array.from({ length: count }, (_, i) => {
      if (!playing) return 4;
      const wave = Math.abs(Math.sin(t * 1.7 + i * 0.9) * Math.cos(t * 0.6 + i * 1.3));
      const tilt = 1 - (i / count) * 0.45;
      return Math.round(10 + 88 * wave * tilt);
    });
  });
}
