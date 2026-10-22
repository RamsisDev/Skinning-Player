import { Component, computed, inject, input } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideChevronDown,
  lucideChevronLeft,
  lucideEllipsisVertical,
  lucideFolderOpen,
  lucideImage,
  lucideListMusic,
  lucideListPlus,
  lucideMusic,
  lucidePalette,
  lucidePause,
  lucidePencil,
  lucidePlay,
  lucidePlus,
  lucideRefreshCw,
  lucideRepeat,
  lucideRepeat1,
  lucideSearch,
  lucideShuffle,
  lucideSkipBack,
  lucideSkipForward,
  lucideTrash2,
  lucideTriangleAlert,
  lucideSettings,
  lucideArrowUpDown,
  lucideListOrdered,
  lucideArrowUp,
  lucideArrowDown,
  lucideGripVertical,
  lucideShare2,
  lucideInfo,
} from '@ng-icons/lucide';
import { NgIcon } from '@ng-native/icons';
import { type IconSlot, type Skin } from './skin.ts';
import { SkinManager } from './skin-manager.ts';

const DEFAULT_ICONS: Record<IconSlot, string> = {
  play: 'lucidePlay',
  pause: 'lucidePause',
  previous: 'lucideSkipBack',
  next: 'lucideSkipForward',
  shuffle: 'lucideShuffle',
  repeat: 'lucideRepeat',
  repeatOne: 'lucideRepeat1',
  library: 'lucideMusic',
  playlists: 'lucideListMusic',
  skins: 'lucidePalette',
  add: 'lucidePlus',
  addToPlaylist: 'lucideListPlus',
  more: 'lucideEllipsisVertical',
  close: 'lucideChevronDown',
  back: 'lucideChevronLeft',
  remove: 'lucideTrash2',
  rename: 'lucidePencil',
  search: 'lucideSearch',
  import: 'lucideFolderOpen',
  check: 'lucideCheck',
  refresh: 'lucideRefreshCw',
  cover: 'lucideImage',
  warning: 'lucideTriangleAlert',
  settings: 'lucideSettings',
  sort: 'lucideArrowUpDown',
  queue: 'lucideListOrdered',
  moveUp: 'lucideArrowUp',
  moveDown: 'lucideArrowDown',
  drag: 'lucideGripVertical',
  share: 'lucideShare2',
  info: 'lucideInfo',
};

/** An icon for a button slot: the active skin's own SVG for it, or the default glyph. */
@Component({
  selector: 'app-skin-icon',
  imports: [NgIcon],
  providers: [
    provideIcons({
      lucideCheck,
      lucideChevronDown,
      lucideChevronLeft,
      lucideEllipsisVertical,
      lucideFolderOpen,
      lucideImage,
      lucideListMusic,
      lucideListPlus,
      lucideMusic,
      lucidePalette,
      lucidePause,
      lucidePencil,
      lucidePlay,
      lucidePlus,
      lucideRefreshCw,
      lucideRepeat,
      lucideRepeat1,
      lucideSearch,
      lucideShuffle,
      lucideSkipBack,
      lucideSkipForward,
      lucideTrash2,
      lucideTriangleAlert,
  lucideSettings,
  lucideArrowUpDown,
  lucideListOrdered,
  lucideArrowUp,
  lucideArrowDown,
  lucideGripVertical,
  lucideShare2,
  lucideInfo,
    }),
  ],
  template: `
    @if (skinSvg(); as markup) {
      <ng-icon [svg]="markup" [size]="size()" [color]="color()" />
    } @else {
      <ng-icon [name]="defaultName()" [size]="size()" [color]="color()" [strokeWidth]="2" />
    }
  `,
})
export class SkinIcon {
  private readonly skins = inject(SkinManager);

  readonly slot = input.required<IconSlot>();
  readonly size = input(22);
  /** A color or a skin token, such as `var(--sk-accent)`. */
  readonly color = input('var(--sk-button-text)');
  /** Draws another skin's glyph than the active one's, for a preview. */
  readonly skin = input<Skin | null>(null);

  protected readonly skinSvg = computed(() => (this.skin() ?? this.skins.active()).icons[this.slot()]);
  protected readonly defaultName = computed(() => DEFAULT_ICONS[this.slot()]);
}
