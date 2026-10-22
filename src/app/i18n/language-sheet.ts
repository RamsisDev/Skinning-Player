import { Component, computed, inject, input, output } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { I18n, type LanguageChoice } from './i18n.ts';
import { Sheet } from '../shared/sheet.ts';
import { SkinIcon } from '../skins/skin-icon.ts';

/** Picks the app's language, or leaves it to follow the device. */
@Component({
  selector: 'app-language-sheet',
  imports: [Pressable, Sheet, SkinIcon, Text, View],
  template: `
    <app-sheet [open]="open()" [title]="t().language.title" (close)="close.emit()">
      @for (option of options(); track option.choice) {
        <pressable
          class="row"
          accessibilityRole="radio"
          [accessibilityLabel]="option.label"
          [accessibilityState]="{ checked: option.choice === i18n.choice() }"
          (press)="pick(option.choice)"
        >
          <view class="body">
            <text class="name">{{ option.label }}</text>
            @if (option.detail) {
              <text class="detail">{{ option.detail }}</text>
            }
          </view>
          @if (option.choice === i18n.choice()) {
            <app-skin-icon slot="check" [size]="20" color="var(--sk-accent)" />
          }
        </pressable>
      }
    </app-sheet>
  `,
  styles: `
    .row {
      flex-direction: row;
      align-items: center;
      gap: 12px;
      min-height: 52px;
      padding: 8px;
      border-bottom-width: var(--sk-border-width);
      border-color: var(--sk-border);
    }
    .row:active {
      background-color: var(--sk-surface-alt);
    }
    .body {
      flex: 1;
      gap: 2px;
    }
    .name {
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
    .detail {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
    }
  `,
})
export class LanguageSheet {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.messages;

  readonly open = input(false);
  readonly close = output<void>();

  protected readonly options = computed(() => {
    const { language } = this.t();
    const names = { en: language.english, es: language.spanish };
    return [
      { choice: 'system' as const, label: language.device, detail: names[this.i18n.device()] },
      { choice: 'en' as const, label: language.english, detail: '' },
      { choice: 'es' as const, label: language.spanish, detail: '' },
    ];
  });

  protected pick(choice: LanguageChoice): void {
    this.i18n.choose(choice);
    this.close.emit();
  }
}
