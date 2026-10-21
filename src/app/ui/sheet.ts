import { Component, inject, input, output } from '@angular/core';
import { Modal, Pressable, SafeAreaProvider, SafeAreaView, Text, View } from '@ng-native/components';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { SkinButton } from './skin-button.ts';

/**
 * A skinned panel over the app. A modal is a window of its own on Android, so it gets its own
 * safe-area provider; the skin's tokens still reach it, since they cascade down the node tree.
 */
@Component({
  selector: 'app-sheet',
  imports: [Modal, Pressable, SafeAreaProvider, SafeAreaView, SkinButton, Text, View],
  template: `
    <modal [visible]="open()" [transparent]="true" [animationType]="skins.sheetTransition()" (requestClose)="close.emit()">
      <safe-area-provider [reportInsets]="false" class="fill">
        <safe-area-view class="backdrop" [class.top]="placement() === 'top'" [edges]="['top', 'bottom']">
          <pressable class="scrim" [accessibilityLabel]="t().common.close" (press)="close.emit()"></pressable>
          <view class="card" [class.tall]="tall()">
            <view class="header">
              <text class="title" role="heading" [numberOfLines]="1">{{ title() }}</text>
              <app-skin-button [label]="t().common.close" icon="close" variant="ghost" size="small" [iconOnly]="true" (press)="close.emit()" />
            </view>
            <ng-content />
          </view>
        </safe-area-view>
      </safe-area-provider>
    </modal>
  `,
  styles: `
    .fill {
      flex: 1;
    }
    .backdrop {
      flex: 1;
      justify-content: flex-end;
      padding: 12px;
      background-color: rgba(0, 0, 0, 0.55);
    }
    .backdrop.top {
      justify-content: flex-start;
      padding-top: 72px;
    }
    .scrim {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
    }
    .card {
      gap: 12px;
      padding: 16px;
      max-height: 85%;
      border-radius: var(--sk-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: var(--sk-surface);
    }
    .card.tall {
      height: 85%;
    }
    .header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .title {
      flex: 1;
      color: var(--sk-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-lg);
      font-weight: var(--sk-weight-bold);
    }
  `,
})
export class Sheet {
  protected readonly skins = inject(SkinManager);
  protected readonly t = inject(I18n).messages;
  readonly open = input(false);
  readonly title = input.required<string>();
  /** `top` keeps a text field clear of the keyboard. */
  readonly placement = input<'bottom' | 'top'>('bottom');
  /** Fills most of the screen, for a list. */
  readonly tall = input(false);
  readonly close = output<void>();
}
