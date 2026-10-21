import { Component, computed, inject, input, output } from '@angular/core';
import { Text, View, VirtualList, VirtualListRow } from '@ng-native/components';
import { Player } from '../core/player.ts';
import { type Track } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { Sheet } from '../ui/sheet.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { TrackRow } from '../ui/track-row.ts';

/** One song in the queue, by its place in the order it plays. */
interface QueueRow {
  readonly track: Track;
  readonly at: number;
  readonly key: string;
}

/**
 * The queue in the order it plays, the song playing marked. A tap plays a song; each can move up
 * or down a place, or come out of the queue.
 */
@Component({
  selector: 'app-queue-sheet',
  imports: [Sheet, SkinButton, Text, TrackRow, View, VirtualList, VirtualListRow],
  template: `
    <app-sheet [open]="open()" [title]="title()" [tall]="true" (close)="close.emit()">
      <virtual-list #list class="list" [items]="rows()" [itemHeight]="64" [keyExtractor]="keyOf">
        @for (row of list.window(); track row.slot) {
          <view [virtualListRow]="row">
            <app-track-row [track]="row.item.track" [current]="row.item.at === player.queueIndex()" (press)="player.jumpTo(row.item.at)">
              <app-skin-button
                [label]="t().queue.moveUp(row.item.track.title)"
                icon="moveUp"
                variant="ghost"
                size="small"
                [iconOnly]="true"
                [disabled]="row.item.at === 0"
                (press)="player.moveInQueue(row.item.at, row.item.at - 1)"
              />
              <app-skin-button
                [label]="t().queue.moveDown(row.item.track.title)"
                icon="moveDown"
                variant="ghost"
                size="small"
                [iconOnly]="true"
                [disabled]="row.item.at === rows().length - 1"
                (press)="player.moveInQueue(row.item.at, row.item.at + 1)"
              />
              <app-skin-button
                [label]="t().queue.remove(row.item.track.title)"
                icon="remove"
                variant="ghost"
                size="small"
                [iconOnly]="true"
                (press)="player.removeFromQueue(row.item.at)"
              />
            </app-track-row>
          </view>
        }
        @if (!rows().length) {
          <text listFooter class="empty">{{ t().queue.empty }}</text>
        }
      </virtual-list>
    </app-sheet>
  `,
  styles: `
    .list {
      flex: 1;
    }
    .empty {
      padding: 24px 12px;
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight);
      text-align: center;
    }
  `,
})
export class QueueSheet {
  protected readonly player = inject(Player);
  protected readonly t = inject(I18n).messages;

  readonly open = input(false);
  readonly close = output<void>();

  /** Keyed by place and song, so a song queued twice is two rows, and a move redraws both rows it swaps. */
  protected readonly rows = computed(() =>
    this.player.queued().map((track, at): QueueRow => ({ track, at, key: `${at}:${track.id}` })),
  );
  protected readonly title = computed(() => {
    const t = this.t().queue;
    const length = this.player.queueLength();
    return length ? t.titleAt(this.player.queuePosition(), length) : t.title;
  });
  protected readonly keyOf = (row: QueueRow): string => row.key;
}
