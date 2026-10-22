import { Component, input, output } from '@angular/core';
import { Pressable, ScrollView, Text } from '@ng-native/components';
import { type IconSlot } from '../skins/skin.ts';
import { Sheet } from './sheet.ts';
import { SkinIcon } from '../skins/skin-icon.ts';

export interface MenuAction {
  readonly label: string;
  readonly icon: IconSlot;
  readonly run: () => void;
}

export interface Menu {
  readonly title: string;
  readonly actions: readonly MenuAction[];
}

/**
 * A list of things to do with something, in a sheet. Android's own dialog, which `Dialogs.choose`
 * puts up, holds three buttons at most, and a song's menu has more than that.
 */
@Component({
  selector: 'app-menu-sheet',
  imports: [Pressable, ScrollView, Sheet, SkinIcon, Text],
  template: `
    <app-sheet [open]="!!menu()" [title]="menu()?.title ?? ''" (close)="close.emit()">
      <scroll-view class="list">
        @for (action of menu()?.actions ?? []; track action.label) {
          <pressable class="row" accessibilityRole="button" [accessibilityLabel]="action.label" (press)="choose(action)">
            <app-skin-icon [slot]="action.icon" [size]="20" color="var(--sk-accent)" />
            <text class="label" [numberOfLines]="1">{{ action.label }}</text>
          </pressable>
        }
      </scroll-view>
    </app-sheet>
  `,
  styles: `
    .list {
      flex-grow: 0;
    }
    .row {
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 14px 8px;
      border-bottom-width: var(--sk-border-width);
      border-color: var(--sk-border);
    }
    .row:active {
      background-color: var(--sk-surface-alt);
    }
    .label {
      flex: 1;
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
  `,
})
export class MenuSheet {
  /** The menu to offer; null keeps the sheet closed. */
  readonly menu = input<Menu | null>(null);
  readonly close = output<void>();

  /** Closes the menu before the action runs, which may open a sheet of its own. */
  protected choose(action: MenuAction): void {
    this.close.emit();
    action.run();
  }
}
