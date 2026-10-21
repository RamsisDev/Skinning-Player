import { Service, signal } from '@angular/core';
import { type LibraryView } from '../core/behavior-settings.ts';
import { type Filters } from '../core/library-filter.ts';
import { type Tab } from './tab-menu.ts';

/** An album, artist or genre, which opens on a screen of its own. */
export interface CatalogRef {
  readonly kind: 'album' | 'artist' | 'genre';
  readonly key: string;
}

/** Where a search result leads: an album, artist or genre, the library filtered, or a playlist. */
export type Destination =
  | { readonly tab: 'library'; readonly filters?: Filters; readonly detail?: CatalogRef }
  | { readonly tab: 'playlists'; readonly playlistId: string };

/**
 * The tab on show, and the search or settings that cover the tabs while they are open. Leaving the
 * search for one of its results keeps what was typed, so back returns to the search as it was.
 */
@Service()
export class Navigation {
  readonly tab = signal<Tab>('library');
  /** Which of its lists the library tab shows; kept while the tab is left. */
  readonly libraryView = signal<LibraryView>('songs');
  readonly searching = signal(false);
  readonly settingsOpen = signal(false);
  readonly query = signal('');
  /** Whether the screen on show was opened from the search, which back returns to. */
  readonly fromSearch = signal(false);
  private pending: Destination | null = null;

  /** Opens a new search, empty. */
  openSearch(): void {
    this.query.set('');
    this.fromSearch.set(false);
    this.settingsOpen.set(false);
    this.searching.set(true);
  }

  /** Back to the search that was left for one of its results. */
  returnToSearch(): void {
    this.fromSearch.set(false);
    this.searching.set(true);
  }

  closeSearch(): void {
    this.searching.set(false);
    this.fromSearch.set(false);
  }

  openSettings(): void {
    this.closeSearch();
    this.settingsOpen.set(true);
  }

  closeSettings(): void {
    this.settingsOpen.set(false);
  }

  selectTab(tab: Tab): void {
    this.closeSearch();
    this.closeSettings();
    this.tab.set(tab);
  }

  /** Leaves the search for one of its results. */
  show(destination: Destination): void {
    this.pending = destination;
    this.searching.set(false);
    this.fromSearch.set(true);
    this.tab.set(destination.tab);
  }

  /** What the screen for `tab` was opened to show, once: a screen opened later starts as usual. */
  take<T extends Tab>(tab: T): Extract<Destination, { tab: T }> | null {
    const pending = this.pending;
    if (pending?.tab !== tab) return null;
    this.pending = null;
    return pending as Extract<Destination, { tab: T }>;
  }
}
