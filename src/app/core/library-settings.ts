import { Service, inject } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { DEFAULT_SORTS, type Sort, type SortedList } from './sorting.ts';
import { DEFAULT_SEPARATORS, type Separator } from './track.ts';

/** Whether the folders picked are the only ones read, or the ones left out. */
export type FolderMode = 'exclude' | 'include';

/** How the library is read, kept on the device: what Auxio offers under "Music" and "Content". */
@Service()
export class LibrarySettings {
  private readonly store = inject(Storage);

  /** What separates the values of an artist, album artist or genre tag that holds several. */
  readonly separators = this.store.signal<Separator[]>('library.separators', [...DEFAULT_SEPARATORS]);
  /** Sorts names skipping articles such as "The" and "El", and numbers by their value. */
  readonly smartSort = this.store.signal('library.smartSort', true);
  /** Leaves out podcasts, audiobooks, ringtones, notifications, alarms and recordings. */
  readonly excludeNonMusic = this.store.signal('library.excludeNonMusic', true);
  /** Reads files in hidden folders, and hidden files, which are left out otherwise. */
  readonly includeHidden = this.store.signal('library.includeHidden', false);
  readonly folderMode = this.store.signal<FolderMode>('library.folderMode', 'exclude');
  /** The folders left out, or the only ones read, by their path; each with its subfolders. */
  readonly folders = this.store.signal<string[]>('library.folders', []);
  /** Rescans by itself when the device's music changes. */
  readonly autoReload = this.store.signal('library.autoReload', false);
  /** Shows a folder's cover.jpg, folder.jpg... for a song with no cover of its own. */
  readonly folderCovers = this.store.signal('library.folderCovers', false);
  private readonly sorts = this.store.signal<Partial<Record<SortedList, Sort>>>('library.sorts', {});

  sortOf(list: SortedList): Sort {
    return this.sorts()[list] ?? DEFAULT_SORTS[list];
  }

  setSort(list: SortedList, sort: Sort): void {
    this.sorts.update((sorts) => ({ ...sorts, [list]: sort }));
  }

  toggleSeparator(separator: Separator): void {
    this.separators.update((all) => (all.includes(separator) ? all.filter((s) => s !== separator) : [...all, separator]));
  }

  toggleFolder(folder: string): void {
    this.folders.update((all) => (all.includes(folder) ? all.filter((f) => f !== folder) : [...all, folder]));
  }
}
