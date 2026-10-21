import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { Text, TextInput, View, VirtualList, VirtualListRow } from '@ng-native/components';
import { MusicLibrary } from '../core/music-library.ts';
import { type Track, matchesQuery } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { Sheet } from '../ui/sheet.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SkinIcon } from '../ui/skin-icon.ts';
import { TrackRow } from '../ui/track-row.ts';

/** Picks several songs from the library at once, for adding to a playlist. */
@Component({
  selector: 'app-track-picker',
  imports: [Sheet, SkinButton, SkinIcon, Text, TextInput, TrackRow, View, VirtualList, VirtualListRow],
  template: `
    <app-sheet [open]="open()" [title]="title() ?? t().playlists.addSongs" [tall]="true" (close)="close.emit()">
      <text-input
        class="input"
        [placeholder]="t().picker.search"
        [placeholderTextColor]="colors().textMuted"
        [cursorColor]="colors().accent"
        [(value)]="query"
      />
      <virtual-list #list class="list" [items]="candidates()" [itemHeight]="60" [keyExtractor]="idOf" keyboardShouldPersistTaps="handled">
        @for (row of list.window(); track row.slot) {
          <view [virtualListRow]="row">
            <app-track-row [track]="row.item" [number]="row.index + 1" [selected]="selected().has(row.item.id)" (press)="toggle(row.item)">
              @if (selected().has(row.item.id)) {
                <app-skin-icon slot="check" [size]="22" color="var(--sk-accent)" />
              }
            </app-track-row>
          </view>
        }
        @if (!candidates().length) {
          <text listFooter class="empty">{{ t().picker.none }}</text>
        }
      </virtual-list>
      <app-skin-button [label]="addLabel()" icon="add" variant="primary" [disabled]="!selected().size" (press)="done.emit([...selected()])" />
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
export class TrackPicker {
  private readonly library = inject(MusicLibrary);
  private readonly skins = inject(SkinManager);
  protected readonly t = inject(I18n).messages;

  readonly open = input(false);
  readonly title = input<string>();
  /** Songs already in the playlist, left out of the list. */
  readonly excluded = input<readonly string[]>([]);
  readonly done = output<string[]>();
  readonly close = output<void>();

  protected readonly query = linkedSignal({ source: () => this.open(), computation: () => '' });
  protected readonly selected = linkedSignal<boolean, ReadonlySet<string>>({
    source: () => this.open(),
    computation: () => new Set(),
  });
  protected readonly colors = computed(() => this.skins.active().colors);
  protected readonly candidates = computed(() => {
    const excluded = new Set(this.excluded());
    const query = this.query();
    return this.library.tracks().filter((track) => !excluded.has(track.id) && matchesQuery(track, query));
  });
  protected readonly addLabel = computed(() => this.t().picker.add(this.selected().size));
  protected readonly idOf = (track: Track): string => track.id;

  protected toggle(track: Track): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(track.id)) next.add(track.id);
      return next;
    });
  }
}
