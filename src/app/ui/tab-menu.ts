import { Component, inject, input, output } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { I18n } from '../i18n/i18n.ts';
import { type IconSlot } from '../skins/skin.ts';
import { SkinIcon } from './skin-icon.ts';

export type Tab = 'library' | 'playlists' | 'skins';

const TABS: readonly { id: Tab; icon: IconSlot }[] = [
  { id: 'library', icon: 'library' },
  { id: 'playlists', icon: 'playlists' },
  { id: 'skins', icon: 'skins' },
];

/** The bottom menu, drawn from the skin's `--sk-menu-*` tokens rather than the platform's tab bar. */
@Component({
  selector: 'app-tab-menu',
  imports: [Pressable, SkinIcon, Text, View],
  template: `
    <view class="menu" role="tablist">
      @for (tab of tabs; track tab.id) {
        <pressable
          class="item"
          [class.active]="active() === tab.id"
          role="tab"
          [accessibilityLabel]="t().tabs[tab.id]"
          [accessibilityState]="{ selected: active() === tab.id }"
          (press)="select.emit(tab.id)"
        >
          <app-skin-icon
            [slot]="tab.icon"
            [size]="22"
            [color]="active() === tab.id ? 'var(--sk-menu-active-text)' : 'var(--sk-menu-text)'"
          />
          <text class="label">{{ t().tabs[tab.id] }}</text>
        </pressable>
      }
    </view>
  `,
  styles: `
    .menu {
      flex-direction: row;
      gap: 6px;
      padding: 6px 8px;
      border-top-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: var(--sk-menu-background);
    }
    .item {
      flex: 1;
      align-items: center;
      gap: 2px;
      padding: 6px 0;
      border-radius: var(--sk-button-radius);
      transition-property: background-color, opacity;
      transition-duration: var(--sk-duration-fast);
      transition-timing-function: var(--sk-easing);
    }
    .item:active {
      opacity: var(--sk-press-opacity);
    }
    .item.active {
      background-color: var(--sk-menu-active-background);
    }
    .label {
      color: var(--sk-menu-text);
      font-family: var(--sk-font-medium);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight-medium);
    }
    .active .label {
      color: var(--sk-menu-active-text);
    }
  `,
})
export class TabMenu {
  readonly active = input.required<Tab>();
  readonly select = output<Tab>();
  protected readonly tabs = TABS;
  protected readonly t = inject(I18n).messages;
}
