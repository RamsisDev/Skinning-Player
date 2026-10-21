import { Service, computed, inject } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';

/** The lists the library tab shows. */
export const LIBRARY_VIEWS = ['songs', 'albums', 'artists', 'genres'] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

/** A library tab, and whether it is on show. */
export interface LibraryTab {
  readonly view: LibraryView;
  readonly shown: boolean;
}

/** What a tap on a song in the library or the search plays: the list it is in, every song, or its album, artist or genre. */
export const PLAY_FROM = ['list', 'all', 'album', 'artist', 'genre'] as const;
export type PlayFrom = (typeof PLAY_FROM)[number];

/** The button the mini player shows after play. */
export const BAR_ACTIONS = ['next', 'repeat', 'shuffle'] as const;
export type BarAction = (typeof BAR_ACTIONS)[number];

/** Every view once, in the order kept, a view the order has not heard of shown at the end. */
function complete(tabs: readonly LibraryTab[]): LibraryTab[] {
  const known = tabs.filter((tab, i) => LIBRARY_VIEWS.includes(tab.view) && tabs.findIndex((t) => t.view === tab.view) === i);
  const missing = LIBRARY_VIEWS.filter((view) => !known.some((tab) => tab.view === view));
  return [...known, ...missing.map((view) => ({ view, shown: true }))];
}

/** How the app behaves, kept on the device: its playback and interface settings. */
@Service()
export class BehaviorSettings {
  private readonly store = inject(Storage);

  readonly playFrom = this.store.signal<PlayFrom>('behavior.playFrom', 'list');
  /** Keeps shuffle on when a song is played from a list; otherwise playing one turns it off. */
  readonly rememberShuffle = this.store.signal('behavior.rememberShuffle', true);
  /** With repeat one, stops at the end of the song rather than playing it again. */
  readonly pauseOnRepeat = this.store.signal('behavior.pauseOnRepeat', false);
  /** "Previous" restarts a song a few seconds in, rather than going back. */
  readonly rewindBeforeSkip = this.store.signal('behavior.rewindBeforeSkip', true);
  /** Skipping, or taking the song playing out of the queue, stays paused while paused. */
  readonly rememberPause = this.store.signal('behavior.rememberPause', false);
  readonly barAction = this.store.signal<BarAction>('behavior.barAction', 'next');
  private readonly tabOrder = this.store.signal<LibraryTab[]>('behavior.libraryTabs', []);

  /** Every library tab, in the order chosen. */
  readonly tabs = computed(() => complete(this.tabOrder()));
  /** The library tabs on show, in order; there is always at least one. */
  readonly shownViews = computed(() => this.tabs().flatMap((tab) => (tab.shown ? [tab.view] : [])));

  /** Shows or hides a tab, keeping at least one on show. */
  toggleTab(view: LibraryView): void {
    const tabs = this.tabs();
    if (tabs.filter((tab) => tab.shown).length === 1 && tabs.find((tab) => tab.view === view)?.shown) return;
    this.tabOrder.set(tabs.map((tab) => (tab.view === view ? { ...tab, shown: !tab.shown } : tab)));
  }

  /** Moves a tab one place earlier (-1) or later (1). */
  moveTab(view: LibraryView, by: -1 | 1): void {
    const tabs = [...this.tabs()];
    const from = tabs.findIndex((tab) => tab.view === view);
    const to = from + by;
    if (from < 0 || to < 0 || to >= tabs.length) return;
    [tabs[from], tabs[to]] = [tabs[to]!, tabs[from]!];
    this.tabOrder.set(tabs);
  }
}
