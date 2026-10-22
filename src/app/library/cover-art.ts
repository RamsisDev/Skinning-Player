import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Image, View } from '@ng-native/components';
import { Covers } from './covers.ts';
import { type Track } from './track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinIcon } from '../skins/skin-icon.ts';

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
      [class.skin-corners]="radius() === null"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.border-radius.px]="radius()"
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
      border-width: var(--sk-border-width);
      border-color: var(--sk-widget-border);
      background-color: var(--sk-display-background);
    }
    .skin-corners {
      border-radius: var(--sk-widget-radius);
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
  /** Corners in points, in place of the skin's widget radius: a thumbnail stays a square. */
  readonly radius = input<number | null>(null);

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
