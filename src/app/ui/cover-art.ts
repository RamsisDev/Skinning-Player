import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Image, View } from '@ng-native/components';
import { Covers } from '../core/covers.ts';
import { type Track } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinIcon } from './skin-icon.ts';

/**
 * A track's cover, square, or a placeholder in the skin's display colors when it has none or its
 * image does not load.
 */
@Component({
  selector: 'app-cover-art',
  imports: [Image, SkinIcon, View],
  template: `
    <view
      class="art"
      [style.width.px]="size()"
      [style.height.px]="size()"
      role="image"
      [accessibilityLabel]="label()"
    >
      @if (shown(); as src) {
        <image class="image" [src]="src" resizeMode="cover" (error)="failed.set(src)" />
      } @else {
        <app-skin-icon slot="library" [size]="size() * 0.4" color="var(--sk-display-text)" />
      }
    </view>
  `,
  styles: `
    .art {
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: var(--sk-widget-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-widget-border);
      background-color: var(--sk-display-background);
    }
    .image {
      width: 100%;
      height: 100%;
    }
  `,
})
export class CoverArt {
  private readonly covers = inject(Covers);
  private readonly t = inject(I18n).messages;

  readonly track = input<Track | null>(null);
  readonly size = input(64);

  protected readonly failed = signal<string | null>(null);
  protected readonly shown = computed(() => {
    const track = this.track();
    const uri = track ? this.covers.uriOf(track.id) : null;
    return uri && uri !== this.failed() ? uri : null;
  });
  protected readonly label = computed(() => {
    const track = this.track();
    const t = this.t().cover;
    if (!track) return t.noSong;
    return this.shown() ? t.of(track.title) : t.missing(track.title);
  });

  constructor() {
    effect(() => {
      const track = this.track();
      if (track) void this.covers.load(track);
    });
  }
}
