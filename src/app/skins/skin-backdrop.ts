import { Component, computed, inject } from '@angular/core';
import { Image } from '@ng-native/components';
import { SkinManager } from './skin-manager.ts';

/** The skin's background image, behind everything in its parent. Nothing when it has none. */
@Component({
  selector: 'app-skin-backdrop',
  imports: [Image],
  host: { style: 'position: absolute; top: 0; right: 0; bottom: 0; left: 0', pointerEvents: 'none' },
  template: `
    @if (images().background; as uri) {
      <image class="image" [src]="uri" [resizeMode]="images().backgroundResize" [style.opacity]="images().backgroundOpacity" />
    }
  `,
  styles: `
    .image {
      width: 100%;
      height: 100%;
    }
  `,
})
export class SkinBackdrop {
  private readonly skins = inject(SkinManager);
  protected readonly images = computed(() => this.skins.active().images);
}
