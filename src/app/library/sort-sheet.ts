import { Component, inject, input, output } from '@angular/core';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { type Sort, type SortMode } from './sorting.ts';
import { I18n } from '../i18n/i18n.ts';
import { Sheet } from '../shared/sheet.ts';
import { SkinButton } from '../skins/skin-button.ts';
import { SkinIcon } from '../skins/skin-icon.ts';

/** Picks what a list is sorted by, among the modes it offers, and in which direction. */
@Component({
  selector: 'app-sort-sheet',
  imports: [Pressable, ScrollView, Sheet, SkinButton, SkinIcon, Text, View],
  template: `
    <app-sheet [open]="open()" [title]="t().sorting.title" (close)="close.emit()">
      <scroll-view class="list">
        @for (mode of modes(); track mode) {
          <pressable
            class="row"
            role="radio"
            [accessibilityLabel]="t().sorting.modes[mode]"
            [accessibilityState]="{ checked: sort().mode === mode }"
            (press)="change.emit({ mode, ascending: sort().ascending })"
          >
            <text class="label" [class.on]="sort().mode === mode" [numberOfLines]="1">{{ t().sorting.modes[mode] }}</text>
            @if (sort().mode === mode) {
              <app-skin-icon slot="check" [size]="20" color="var(--sk-accent)" />
            }
          </pressable>
        }
      </scroll-view>
      <view class="directions">
        <app-skin-button
          [label]="t().sorting.ascending"
          size="small"
          [variant]="sort().ascending ? 'primary' : 'normal'"
          [active]="sort().ascending"
          (press)="change.emit({ mode: sort().mode, ascending: true })"
        />
        <app-skin-button
          [label]="t().sorting.descending"
          size="small"
          [variant]="sort().ascending ? 'normal' : 'primary'"
          [active]="!sort().ascending"
          (press)="change.emit({ mode: sort().mode, ascending: false })"
        />
      </view>
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
    .label.on {
      color: var(--sk-accent);
      font-family: var(--sk-font-bold);
      font-weight: var(--sk-weight-bold);
    }
    .directions {
      flex-direction: row;
      gap: 8px;
    }
  `,
})
export class SortSheet {
  protected readonly t = inject(I18n).messages;
  readonly open = input(false);
  readonly modes = input.required<readonly SortMode[]>();
  readonly sort = input.required<Sort>();
  readonly change = output<Sort>();
  readonly close = output<void>();
}
