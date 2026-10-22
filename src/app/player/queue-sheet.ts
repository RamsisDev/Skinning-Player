import {
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  type AccessibilityAction,
  type LayoutEvent,
  Pressable,
  type ScrollEvent,
  Text,
  View,
  VirtualList,
  VirtualListRow,
} from '@ng-native/components';
import { GestureRoot, NativeGesture } from '@ng-native/components/gestures';
import {
  type SharedValue,
  type WorkletStyleSpec,
  WorkletScroll,
  WorkletStyle,
  sharedValue,
  workletScroll,
  workletStyle,
} from '@ng-native/components/reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Features } from '../audio/features.ts';
import { Player } from './player.ts';
import { type Track } from '../library/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { Sheet } from '../shared/sheet.ts';
import { SkinButton } from '../skins/skin-button.ts';
import { SkinIcon } from '../skins/skin-icon.ts';
import { TrackRow } from '../library/track-row.ts';

/** Every row's height, which is what turns a finger's place into a place in the queue. */
const ROW = 64;
/** How near an edge of the list a lifted song has to be held for the list to scroll under it. */
const EDGE = 48;
/** Points the list scrolls each frame while a lifted song is held at an edge. */
const STEP = 8;
/** How long a dropped song takes to settle into its place, and a row to step aside. */
const SETTLE_MS = 150;

/** One song in the queue, by its place in the order it plays. */
interface QueueRow {
  readonly track: Track;
  readonly at: number;
  readonly key: string;
  /** What a screen reader can do to the row in place of dragging it or reaching its buttons. */
  readonly actions: readonly AccessibilityAction[];
}

/**
 * A recycled row's half of a drag, on the UI thread: the place in the queue it draws now, the pan
 * on its handle, and how it steps aside. Kept by the list's slot rather than by place, so a lifted
 * song keeps its pan while the list scrolls other songs through the row's views.
 */
interface Slot {
  readonly at: SharedValue<number>;
  readonly handle: ReturnType<typeof Gesture.Pan>;
  readonly look: WorkletStyleSpec;
}

/**
 * Where a lifted song is drawn, down from the top of the list's viewport: under the finger, and
 * kept inside the viewport once its height is known.
 */
export function liftedTop(from: number, drag: number, startScroll: number, height: number): number {
  'worklet';
  const top = Math.max(0, from * ROW - startScroll + drag);
  return height > ROW ? Math.min(top, height - ROW) : top;
}

/** The place a song drawn `top` points down the viewport drops into, scrolled `scroll` points. */
export function dropIndex(top: number, scroll: number, count: number): number {
  'worklet';
  return Math.min(Math.max(Math.round((top + scroll) / ROW), 0), Math.max(count - 1, 0));
}

/**
 * How far the row at `at` steps aside while the song from `from` is held over `to`: up a row if
 * the song passed it going down, down a row if it passed it going up.
 */
export function shiftOf(at: number, from: number, to: number): number {
  'worklet';
  if (from < 0 || at === from) return 0;
  if (from < at && at <= to) return -ROW;
  if (to <= at && at < from) return ROW;
  return 0;
}

/**
 * The queue in the order it plays, the song playing marked. A tap plays a song; its handle drags
 * it to another place (or, where the platform hides dragging, its buttons move it up and down),
 * and its button takes it out of the queue.
 *
 * The drag runs on the UI thread. The lifted song is drawn by a copy over the list, since raising
 * the row itself would re-order its views mid-gesture, which ends the gesture on iOS; the row
 * under it hides, the rows it passes step aside, and dropping it is one `moveInQueue`. A screen
 * reader gets the same moves, and the removal, as actions on the row.
 */
@Component({
  selector: 'app-queue-sheet',
  imports: [
    GestureRoot,
    NativeGesture,
    Pressable,
    Sheet,
    SkinButton,
    SkinIcon,
    Text,
    TrackRow,
    View,
    VirtualList,
    VirtualListRow,
    WorkletScroll,
    WorkletStyle,
  ],
  template: `
    <app-sheet [open]="open()" [title]="title()" [tall]="true" (close)="close.emit()">
      @if (scroller; as scroller) {
        <!-- A modal is a window of its own on Android, outside the app's gesture root. -->
        <gesture-root>
          <view class="frame" (layout)="measure($event)">
            <virtual-list
              #list
              class="list"
              [items]="rows()"
              [itemHeight]="64"
              [keyExtractor]="keyOf"
              [gesture]="scroller"
              [workletScroll]="follow"
              [scrollEventThrottle]="16"
              (scroll)="scrolled($event)"
            >
              @for (row of list.window(); track row.slot) {
                @let slot = slotOf(row.slot);
                <view [virtualListRow]="row">
                  <view class="slot" [workletStyle]="slot.look">
                    <app-track-row
                      [track]="row.item.track"
                      [current]="row.item.at === player.queueIndex()"
                      [actions]="row.item.actions"
                      (press)="player.jumpTo(row.item.at)"
                      (action)="act(row.item, $event)"
                    >
                      <pressable
                        class="handle"
                        [gesture]="slot.handle"
                        [accessibilityLabel]="t().queue.reorder(row.item.track.title)"
                        aria-hidden="true"
                        importantForAccessibility="no-hide-descendants"
                      >
                        <app-skin-icon slot="drag" [size]="20" color="var(--sk-text-muted)" />
                      </pressable>
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
                </view>
              }
              @if (!rows().length) {
                <text listFooter class="empty">{{ t().queue.empty }}</text>
              }
            </virtual-list>
            <view class="lifted" [workletStyle]="lift" pointerEvents="none" aria-hidden="true" importantForAccessibility="no-hide-descendants">
              @if (held(); as held) {
                <app-track-row [track]="held.track" [current]="held.current">
                  <view class="handle">
                    <app-skin-icon slot="drag" [size]="20" color="var(--sk-text-muted)" />
                  </view>
                  <app-skin-button [label]="t().queue.remove(held.track.title)" icon="remove" variant="ghost" size="small" [iconOnly]="true" />
                </app-track-row>
              }
            </view>
          </view>
        </gesture-root>
      } @else {
        <virtual-list #list class="list" [items]="rows()" [itemHeight]="64" [keyExtractor]="keyOf">
          @for (row of list.window(); track row.slot) {
            <view [virtualListRow]="row">
              <app-track-row
                [track]="row.item.track"
                [current]="row.item.at === player.queueIndex()"
                [actions]="row.item.actions"
                (press)="player.jumpTo(row.item.at)"
                (action)="act(row.item, $event)"
              >
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
      }
    </app-sheet>
  `,
  styles: `
    .frame {
      flex: 1;
    }
    .list {
      flex: 1;
    }
    .slot {
      flex: 1;
    }
    .handle {
      width: 36px;
      height: 44px;
      align-items: center;
      justify-content: center;
    }
    .lifted {
      position: absolute;
      top: 0;
      right: 0;
      left: 0;
      height: 64px;
      opacity: 0;
      border-radius: var(--sk-radius);
      background-color: var(--sk-surface-alt);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
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
  private readonly injector = inject(Injector);

  readonly open = input(false);
  readonly close = output<void>();

  /**
   * Keyed by place and song, so a song queued twice is two rows, and a move redraws both rows it
   * swaps. Each carries its screen-reader actions, built once per change rather than per render.
   */
  protected readonly rows = computed(() => {
    const t = this.t().queue;
    const queued = this.player.queued();
    return queued.map((track, at): QueueRow => {
      const actions: AccessibilityAction[] = [];
      if (at > 0) actions.push({ name: 'moveUp', label: t.moveUp(track.title) });
      if (at < queued.length - 1) actions.push({ name: 'moveDown', label: t.moveDown(track.title) });
      actions.push({ name: 'remove', label: t.remove(track.title) });
      return { track, at, key: `${at}:${track.id}`, actions };
    });
  });
  protected readonly title = computed(() => {
    const t = this.t().queue;
    const length = this.player.queueLength();
    return length ? t.titleAt(this.player.queuePosition(), length) : t.title;
  });
  protected readonly keyOf = (row: QueueRow): string => row.key;

  private readonly list = viewChild<VirtualList<QueueRow>>('list');

  // The drag, as both runtimes see it.
  /** The place of the song lifted, or -1 while nothing is. */
  private readonly lifted = sharedValue(-1);
  /** The place it would drop into. */
  private readonly target = sharedValue(-1);
  /** How far the finger has moved since the song was lifted. */
  private readonly drag = sharedValue(0);
  /** How far the list is scrolled, and how far it was when the song was lifted. */
  private readonly scroll = sharedValue(0);
  private readonly startScroll = sharedValue(0);
  /** The list's viewport, and how many songs it holds. */
  private readonly height = sharedValue(0);
  private readonly count = sharedValue(0);
  /** Which edge the lifted song is held at: -1 the top, 1 the bottom, 0 neither. */
  private readonly edge = sharedValue(0);

  /**
   * The song the lifted copy draws, taken as a finger lands on a handle. Kept as it was rather than
   * by place, so the copy still shows it in the frame the queue's new order is drawn.
   */
  protected readonly held = signal<{ readonly track: Track; readonly current: boolean } | null>(null);

  /**
   * The scroll view's own pan, which a handle's pan holds off, so a drag moves the song instead.
   * None where the platform hides dragging: then no gesture is made, and the rows have buttons.
   */
  protected readonly scroller = inject(Features).on('queueDrag') ? Gesture.Native() : null;
  private readonly slots = new Map<number, Slot>();

  /** The lifted copy: under the finger while a song is lifted, and nothing otherwise. */
  protected readonly lift = workletStyle([this.lifted, this.drag, this.startScroll, this.height], (lifted, drag, startScroll, height) => {
    'worklet';
    if (lifted.value < 0) return { opacity: 0, transform: [{ translateY: 0 }] };
    return { opacity: 1, transform: [{ translateY: liftedTop(lifted.value, drag.value, startScroll.value, height.value) }] };
  });

  /** The offset, on the UI thread; and with a song held still at an edge, where it now drops. */
  protected readonly follow = workletScroll(
    [this.scroll, this.lifted, this.drag, this.startScroll, this.height, this.count, this.target],
    (event, scroll, lifted, drag, startScroll, height, count, target) => {
      'worklet';
      scroll.value = event.contentOffset.y;
      if (lifted.value < 0) return;
      target.value = dropIndex(liftedTop(lifted.value, drag.value, startScroll.value, height.value), scroll.value, count.value);
    },
  );

  /** The offset as JavaScript knows it, which the scroll at an edge moves on from. */
  private offset = 0;
  private viewport = 0;
  private scrolling: ReturnType<typeof setInterval> | undefined;

  constructor() {
    effect(() => {
      this.count.value = this.rows().length;
    });
    // Tell each slot which place it draws, as the list recycles them, and forget the slots it has
    // let go of. After a render, since the list has no window before its inputs are set.
    afterRenderEffect(() => {
      if (!this.scroller) return;
      const window = this.list()?.window() ?? [];
      const live = new Set<number>();
      for (const row of window) {
        live.add(row.slot);
        this.slotOf(row.slot).at.value = row.parked ? -1 : row.index;
      }
      for (const slot of this.slots.keys()) if (!live.has(slot)) this.slots.delete(slot);
    });
    inject(DestroyRef).onDestroy(() => clearInterval(this.scrolling));
  }

  protected slotOf(slot: number): Slot {
    let found = this.slots.get(slot);
    if (!found) this.slots.set(slot, (found = this.createSlot()));
    return found;
  }

  protected act(row: QueueRow, action: string): void {
    if (action === 'moveUp') this.player.moveInQueue(row.at, row.at - 1);
    else if (action === 'moveDown') this.player.moveInQueue(row.at, row.at + 1);
    else if (action === 'remove') this.player.removeFromQueue(row.at);
  }

  protected measure(event: LayoutEvent): void {
    this.viewport = event.nativeEvent.layout.height;
    this.height.value = this.viewport;
  }

  protected scrolled(event: ScrollEvent): void {
    this.offset = event.nativeEvent.contentOffset.y;
  }

  private createSlot(): Slot {
    // Locals, since a worklet cannot close over this.
    const { lifted, target, drag, startScroll, scroll, height, count, edge } = this;
    const scroller = this.scroller!;
    const at = sharedValue(-1);
    const hold = this.hold;
    const release = this.release;
    const drop = this.drop;
    const autoscroll = this.autoscroll;
    /** Where the row stands now, and the step aside it is easing to. */
    const shift = sharedValue(0);
    const toward = sharedValue(0);
    const drew = sharedValue(-1);

    const look = workletStyle([at, lifted, target, shift], (at, lifted, target, shift) => {
      'worklet';
      const to = shiftOf(at.value, lifted.value, target.value);
      if (to !== toward.value || at.value !== drew.value) {
        // Eased while a song passes the row; a row taking another song, or a drop, jumps.
        const passing = lifted.value >= 0 && at.value === drew.value;
        toward.value = to;
        drew.value = at.value;
        shift.value = passing ? withTiming(to, { duration: SETTLE_MS }) : to;
      }
      const hidden = lifted.value >= 0 && at.value === lifted.value;
      return { opacity: hidden ? 0 : 1, transform: [{ translateY: shift.value }] };
    });

    const handle = Gesture.Pan()
      .blocksExternalGesture(scroller)
      .onBegin(() => {
        'worklet';
        scheduleOnRN(hold, at.value);
      })
      .onStart(() => {
        'worklet';
        if (at.value < 0) return;
        drag.value = 0;
        startScroll.value = scroll.value;
        target.value = at.value;
        lifted.value = at.value;
      })
      .onUpdate((event) => {
        'worklet';
        if (lifted.value < 0) return;
        drag.value = event.translationY;
        const top = liftedTop(lifted.value, drag.value, startScroll.value, height.value);
        target.value = dropIndex(top, scroll.value, count.value);
        const near = top < EDGE ? -1 : height.value > ROW && top > height.value - ROW - EDGE ? 1 : 0;
        if (near !== edge.value) {
          edge.value = near;
          scheduleOnRN(autoscroll, near);
        }
      })
      .onEnd(() => {
        'worklet';
        if (edge.value !== 0) {
          edge.value = 0;
          scheduleOnRN(autoscroll, 0);
        }
        const from = lifted.value;
        const to = target.value;
        if (from < 0) return;
        // Settle the copy over the place it drops into, then move the song there.
        const landing = to * ROW - scroll.value - from * ROW + startScroll.value;
        drag.value = withTiming(landing, { duration: SETTLE_MS }, () => {
          'worklet';
          scheduleOnRN(drop, from, to);
        });
      })
      .onFinalize(() => {
        'worklet';
        // A touch that never became a drag lifted nothing.
        if (lifted.value < 0) scheduleOnRN(release);
      });

    return { at, handle, look };
  }

  private readonly hold = (at: number): void => {
    const row = this.rows()[at];
    this.held.set(row ? { track: row.track, current: at === this.player.queueIndex() } : null);
  };

  private readonly release = (): void => {
    this.held.set(null);
  };

  /**
   * The song lands. The rows stand aside until the queue's new order is drawn, and only then go
   * back: reset first, they would show the old order for a frame.
   */
  private readonly drop = (from: number, to: number): void => {
    const settle = () => {
      this.lifted.value = -1;
      this.target.value = -1;
      this.drag.value = 0;
      this.held.set(null);
    };
    if (from === to) {
      settle();
      return;
    }
    this.player.moveInQueue(from, to);
    afterNextRender(settle, { injector: this.injector });
  };

  /** Scrolls the list under a song held at one of its edges, until it leaves the edge or drops. */
  private readonly autoscroll = (toward: number): void => {
    clearInterval(this.scrolling);
    this.scrolling = undefined;
    if (!toward) return;
    this.scrolling = setInterval(() => {
      const end = Math.max(0, this.rows().length * ROW - this.viewport);
      const offset = Math.min(Math.max(this.offset + toward * STEP, 0), end);
      if (offset === this.offset) return;
      this.offset = offset;
      this.list()?.scrollToOffset({ offset, animated: false });
    }, 16);
  };
}
