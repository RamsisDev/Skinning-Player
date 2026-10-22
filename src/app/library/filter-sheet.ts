import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { Pressable, Text, TextInput, View, VirtualList, VirtualListRow } from '@ng-native/components';
import { type Facet, type FacetOption } from './library-filter.ts';
import { fold } from './track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { Sheet } from '../shared/sheet.ts';
import { SkinIcon } from '../skins/skin-icon.ts';

/** Past this many values, the sheet offers a search over them. */
const SEARCH_FROM = 8;
/** Up to this many, the sheet is only as tall as its rows. */
const SHORT_LIST = 6;
const ROW_HEIGHT = 52;

/**
 * Picks the value to filter the library by, among the ones the songs on show have, each with how
 * many songs have it. The first row lifts the filter.
 */
@Component({
  selector: 'app-filter-sheet',
  imports: [Pressable, Sheet, SkinIcon, Text, TextInput, View, VirtualList, VirtualListRow],
  template: `
    <app-sheet [open]="!!facet()" [title]="title()" [tall]="tall()" (close)="close.emit()">
      @if (options().length > searchFrom) {
        <text-input
          class="input"
          [placeholder]="t().filters.search"
          [placeholderTextColor]="colors().textMuted"
          [cursorColor]="colors().accent"
          [(value)]="query"
        />
      }
      <virtual-list #list class="list" [style]="listStyle()" [items]="shown()" [itemHeight]="rowHeight" [keyExtractor]="keyOf" keyboardShouldPersistTaps="handled">
        <pressable
          listHeader
          class="row"
          accessibilityRole="button"
          [accessibilityLabel]="allLabel()"
          [accessibilityState]="{ selected: !selected() }"
          (press)="pick.emit(null)"
        >
          <text class="label all" [numberOfLines]="1">{{ allLabel() }}</text>
          @if (!selected()) {
            <app-skin-icon slot="check" [size]="20" color="var(--sk-accent)" />
          }
        </pressable>
        @for (row of list.window(); track row.slot) {
          <view [virtualListRow]="row">
            <pressable
              class="row"
              [class.selected]="row.item.key === selected()"
              accessibilityRole="button"
              [accessibilityLabel]="t().filters.option(row.item.label, row.item.count)"
              [accessibilityState]="{ selected: row.item.key === selected() }"
              (press)="pick.emit(row.item.key)"
            >
              <text class="label" [numberOfLines]="1">{{ row.item.label }}</text>
              <text class="count">{{ row.item.count }}</text>
              @if (row.item.key === selected()) {
                <app-skin-icon slot="check" [size]="20" color="var(--sk-accent)" />
              }
            </pressable>
          </view>
        }
        @if (!shown().length) {
          <text listFooter class="empty">{{ t().filters.none }}</text>
        }
      </virtual-list>
    </app-sheet>
  `,
  styles: `
    .input {
      height: 44px;
      padding: 0 12px;
      border-radius: var(--sk-button-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: var(--sk-background);
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
    .list {
      flex: 1;
    }
    .row {
      height: 52px;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 0 8px;
      border-bottom-width: var(--sk-border-width);
      border-color: var(--sk-border);
    }
    .row:active,
    .selected {
      background-color: var(--sk-surface-alt);
    }
    .label {
      flex: 1;
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
    .all {
      font-family: var(--sk-font-medium);
      font-weight: var(--sk-weight-medium);
    }
    .count {
      color: var(--sk-text-muted);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-display-weight);
    }
    .empty {
      padding: 12px;
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight);
      text-align: center;
    }
  `,
})
export class FilterSheet {
  private readonly skins = inject(SkinManager);
  protected readonly t = inject(I18n).messages;
  protected readonly searchFrom = SEARCH_FROM;
  protected readonly rowHeight = ROW_HEIGHT;

  /** The detail being picked; null keeps the sheet closed. */
  readonly facet = input<Facet | null>(null);
  readonly options = input<readonly FacetOption[]>([]);
  /** The key picked now, if any. */
  readonly selected = input<string | undefined>(undefined);
  /** The key picked, or null to lift the filter. */
  readonly pick = output<string | null>();
  readonly close = output<void>();

  protected readonly query = linkedSignal({ source: () => this.facet(), computation: () => '' });
  protected readonly colors = computed(() => this.skins.active().colors);
  protected readonly title = computed(() => {
    const facet = this.facet();
    return facet ? this.t().filters[facet] : '';
  });
  protected readonly allLabel = computed(() => {
    const facet = this.facet();
    return facet ? this.t().filters.all[facet] : '';
  });
  protected readonly shown = computed(() => {
    const words = fold(this.query()).split(/\s+/).filter(Boolean);
    const options = this.options();
    return words.length ? options.filter((option) => words.every((word) => fold(option.label).includes(word))) : options;
  });
  protected readonly tall = computed(() => this.options().length > SHORT_LIST);
  /** A short list's height: its rows and the one that lifts the filter. */
  protected readonly listStyle = computed(() =>
    this.tall() ? null : { flex: 0, height: (Math.max(this.options().length, 1) + 1) * ROW_HEIGHT },
  );
  protected readonly keyOf = (option: FacetOption): string => option.key;
}
