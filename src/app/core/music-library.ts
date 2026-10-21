import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { AppState } from '@ng-native/device';
import { FileSystem } from '@ng-native/expo/file-system';
import { AssetField, MediaLibrary, MediaType } from '@ng-native/expo/media-library';
import { readFile } from './byte-reader.ts';
import { type Tags, embeddedTags } from './embedded-tags.ts';
import { type ContentRules, foldersOf, isIncluded, pathOf } from './library-content.ts';
import { LibrarySettings } from './library-settings.ts';
import { MediaAccess } from './media-access.ts';
import { sortTracks } from './sorting.ts';
import { type Track, trackFromFile, withTags } from './track.ts';

export type LibraryStatus = 'idle' | 'scanning' | 'ready' | 'denied' | 'blocked' | 'error';

/** What a scan under way is doing: reading the media store, then each file's tags, then sorting. */
export type ScanStep = 'reading' | 'tagging' | 'indexing';

export interface ScanOptions {
  /** Forgets the tags read before, so every file is read again. */
  readonly full?: boolean;
  /** Keeps the songs on show while the library is read again, as an automatic reload does. */
  readonly quiet?: boolean;
}

/**
 * Files read per query. One query for a large library hands the JS thread thousands of records at
 * once and freezes the screen; pages leave room for frames in between.
 */
export const SCAN_PAGE_SIZE = 250;

/** How long tag reading runs before it lets the screen draw a frame. */
const TAGGING_SLICE_MS = 32;

/** How long the library waits after the device's music changes, so a batch of changes is one rescan. */
export const RELOAD_DELAY_MS = 500;

/** Where the tags read are kept, so a rescan reads only the files that are new or changed. */
const TAG_CACHE = 'library-tags.json';
const TAG_CACHE_FORMAT = 2;

/** What was read from a file: its tags, or null when they could not be read, where it is and its size. */
interface FileRead {
  /** The file's modification time when it was read. */
  readonly modified: number | null;
  readonly tags: Tags | null;
  readonly uri?: string;
  readonly size?: number;
}

/** A file whose tags were read, as kept in the cache. */
interface CachedTags extends FileRead {
  readonly tags: Tags;
}

/** A file the media store lists, named from its file until its tags are read. */
interface Found {
  readonly track: Track;
  readonly modified: number | null;
}

/** A file read: the track its file names, and its tags, or null when they could not be read. */
interface Entry {
  readonly track: Track;
  readonly tags: Tags | null;
}

/** Long enough for the screen to draw a frame before the next piece of work. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

/**
 * The audio files on the device, read from the platform's media store and named by their tags,
 * less the ones the user's settings leave out.
 */
@Service()
export class MusicLibrary {
  private readonly media = inject(MediaLibrary);
  private readonly access = inject(MediaAccess);
  private readonly files = inject(FileSystem);
  private readonly settings = inject(LibrarySettings);
  private readonly uris = new Map<string, string>();

  private readonly entries = signal<readonly Entry[]>([]);
  /** Every audio file read, its values split by the user's separators, before any is left out. */
  readonly scanned = computed(() => {
    const separators = this.settings.separators();
    return this.entries().map(({ track, tags }) => withTags(track, tags ?? {}, separators));
  });
  private readonly rules = computed<ContentRules>(() => ({
    excludeNonMusic: this.settings.excludeNonMusic(),
    includeHidden: this.settings.includeHidden(),
    folderMode: this.settings.folderMode(),
    folders: this.settings.folders(),
  }));
  /** The songs the library holds, by title. */
  readonly tracks = computed(() => {
    const rules = this.rules();
    const included = this.scanned().filter((track) => isIncluded(track, rules));
    return sortTracks(included, { mode: 'name', ascending: true }, this.settings.smartSort());
  });
  /** The folders the audio files are in, for the user to leave out or keep to. */
  readonly folders = computed(() => foldersOf(this.scanned()));
  readonly status = signal<LibraryStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly byId = computed(() => new Map(this.tracks().map((track) => [track.id, track])));
  readonly step = signal<ScanStep>('reading');
  /** Songs the scan under way has found so far. */
  readonly found = signal(0);
  /** Songs whose tags the scan under way has read, out of `found`. */
  readonly tagged = signal(0);
  /** Whether a scan is under way, shown or quiet. */
  readonly refreshing = signal(false);

  /** Set once access is granted, which watching the device's music needs. */
  private readonly granted = signal(false);
  private busy = false;
  /** A quiet scan asked for while another was under way, to run once it is done. */
  private again = false;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    let changes: ReturnType<MediaLibrary['watch']> | null = null;
    let seen: unknown = null;
    effect(() => {
      if (!this.settings.autoReload() || !this.granted()) return;
      changes ??= this.media.watch();
      const change = changes();
      if (!change || change === seen) return;
      seen = change;
      untracked(() => this.reloadSoon());
    });
    // On Android the media library only reports changes to photos and videos, never to audio, so
    // music added or deleted while the app was away is found when it comes back to the front.
    // Every change of state, not the AppState signal: JavaScript does not run in the background,
    // so "background" and "active" arrive together on the way back, and the signal only ever
    // shows the app in front.
    let away = false;
    const stop = inject(AppState.SOURCE).subscribe((state) => {
      if (state !== 'active') away = true;
      else if (away) {
        away = false;
        if (this.settings.autoReload() && this.granted()) this.reloadSoon();
      }
    });
    inject(DestroyRef).onDestroy(stop);
  }

  /**
   * Asks for access to audio files if it is not granted yet, then reads every one of them: the
   * tags of only the files that are new or changed, or of every file with `full`.
   */
  async scan(options: ScanOptions = {}): Promise<void> {
    if (this.busy) {
      if (options.quiet) this.again = true;
      return;
    }
    this.busy = true;
    this.refreshing.set(true);
    const shown = !options.quiet || this.status() !== 'ready';
    if (shown) {
      this.status.set('scanning');
      this.step.set('reading');
      this.found.set(0);
      this.tagged.set(0);
      this.error.set(null);
    }
    try {
      const access = await this.access.ensure('audio');
      if (access !== 'granted') {
        this.status.set(access);
        return;
      }
      if (options.full) this.forgetTags();
      const found = await this.readAll();
      this.step.set('tagging');
      this.uris.clear();
      const entries = await this.readTags(found);
      this.step.set('indexing');
      await nextFrame();
      this.entries.set(entries);
      this.granted.set(true);
      this.status.set('ready');
    } catch (error) {
      if (shown) {
        this.error.set(error instanceof Error ? error.message : String(error));
        this.status.set('error');
      }
    } finally {
      this.busy = false;
      this.refreshing.set(false);
      if (this.again) {
        this.again = false;
        void this.scan({ quiet: true });
      }
    }
  }

  /** A quiet rescan, once the device's music has stopped changing for a moment. */
  private reloadSoon(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.scan({ quiet: true });
    }, RELOAD_DELAY_MS);
  }

  /** Every audio file with a name, a page at a time, counting them into `found` as they come. */
  private async readAll(): Promise<Found[]> {
    const found: Found[] = [];
    const seen = new Set<string>();
    for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
      const page = await this.media.metadata((query) =>
        query.eq(AssetField.MEDIA_TYPE, MediaType.AUDIO).limit(SCAN_PAGE_SIZE).offset(offset),
      );
      let fresh = 0;
      for (const asset of page) {
        if (seen.has(asset.id)) continue;
        seen.add(asset.id);
        fresh++;
        if (!asset.filename) continue;
        const track = trackFromFile(asset.id, asset.filename, asset.duration === null ? null : asset.duration / 1000, {
          added: asset.creationTime ?? asset.modificationTime ?? 0,
        });
        found.push({ track, modified: asset.modificationTime ?? null });
      }
      this.found.set(found.length);
      // A page with nothing new means the store ignored the offset: stop rather than loop forever.
      if (page.length < SCAN_PAGE_SIZE || !fresh) return found;
      await nextFrame();
    }
  }

  /**
   * Reads each file's tags, path and size: kept from an earlier scan when the file has not changed
   * since, read from the file otherwise. A file whose tags cannot be read keeps its file name.
   */
  private async readTags(found: readonly Found[]): Promise<Entry[]> {
    const cache = this.loadTagCache();
    const kept: Record<string, CachedTags> = {};
    const entries: Entry[] = [];
    let slice = Date.now();
    for (const { track, modified } of found) {
      const cached = cache[track.id];
      let read: FileRead | null;
      if (cached && cached.modified === modified) {
        read = cached;
        if (cached.uri) this.uris.set(track.id, cached.uri);
      } else {
        read = await this.readFile(track, modified);
      }
      if (read?.tags) kept[track.id] = { ...read, tags: read.tags };
      const uri = read?.uri ?? this.uris.get(track.id);
      entries.push({ track: { ...track, path: uri ? pathOf(uri) : '', size: read?.size ?? 0 }, tags: read?.tags ?? null });
      this.tagged.set(entries.length);
      if (Date.now() - slice > TAGGING_SLICE_MS) {
        await nextFrame();
        slice = Date.now();
      }
    }
    this.saveTagCache(kept);
    return entries;
  }

  private async readFile(track: Track, modified: number | null): Promise<FileRead | null> {
    let uri: string;
    try {
      uri = await this.uriOf(track);
    } catch {
      return null;
    }
    try {
      return await readFile(this.files, uri, (file) => ({ modified, tags: embeddedTags(file), uri, size: file.size }));
    } catch {
      return { modified, tags: null, uri };
    }
  }

  private loadTagCache(): Record<string, CachedTags> {
    try {
      const file = this.files.cache(TAG_CACHE);
      if (!file.exists) return {};
      const saved = JSON.parse(file.textSync()) as { format?: number; tracks?: Record<string, CachedTags> };
      return saved.format === TAG_CACHE_FORMAT && saved.tracks ? saved.tracks : {};
    } catch {
      return {};
    }
  }

  private saveTagCache(tracks: Record<string, CachedTags>): void {
    try {
      this.files.write(this.files.cache(TAG_CACHE), JSON.stringify({ format: TAG_CACHE_FORMAT, tracks }));
    } catch {
      // Without a cache the next scan reads the tags again, which is slower but just as right.
    }
  }

  private forgetTags(): void {
    try {
      const file = this.files.cache(TAG_CACHE);
      if (file.exists) file.delete();
    } catch {
      // A cache that cannot be deleted is overwritten by the scan anyway.
    }
  }

  /** The playable URI of a track, resolved on first use and kept. */
  async uriOf(track: Track): Promise<string> {
    const known = this.uris.get(track.id);
    if (known) return known;
    const asset = this.media.asset(track.id);
    if (!asset) throw new Error('The media library is not available.');
    const uri = await asset.getUri();
    this.uris.set(track.id, uri);
    return uri;
  }
}
