import { Service, computed, inject, signal } from '@angular/core';
import { FileSystem } from '@ng-native/expo/file-system';
import { AssetField, MediaLibrary, MediaType } from '@ng-native/expo/media-library';
import { readFile } from './byte-reader.ts';
import { type Tags, embeddedTags } from './embedded-tags.ts';
import { type Track, byTitle, trackFromFile, withTags } from './track.ts';

export type LibraryStatus = 'idle' | 'scanning' | 'ready' | 'denied' | 'blocked' | 'error';

/** What a scan under way is doing: reading the media store, then each file's tags, then sorting. */
export type ScanStep = 'reading' | 'tagging' | 'indexing';

/**
 * Files read per query. One query for a large library hands the JS thread thousands of records at
 * once and freezes the screen; pages leave room for frames in between.
 */
export const SCAN_PAGE_SIZE = 250;

/** How long tag reading runs before it lets the screen draw a frame. */
const TAGGING_SLICE_MS = 32;

/** Where the tags read are kept, so a rescan reads only the files that are new or changed. */
const TAG_CACHE = 'library-tags.json';
const TAG_CACHE_FORMAT = 1;

interface CachedTags {
  /** The file's modification time when its tags were read. */
  readonly modified: number | null;
  readonly tags: Tags;
}

/** A file the media store lists, named from its file until its tags are read. */
interface Found {
  readonly track: Track;
  readonly modified: number | null;
}

/** Long enough for the screen to draw a frame before the next piece of work. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

/** The audio files on the device, read from the platform's media store and named by their tags. */
@Service()
export class MusicLibrary {
  private readonly media = inject(MediaLibrary);
  private readonly files = inject(FileSystem);
  private readonly uris = new Map<string, string>();

  private readonly list = signal<readonly Track[]>([]);
  readonly tracks = this.list.asReadonly();
  readonly status = signal<LibraryStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly byId = computed(() => new Map(this.tracks().map((track) => [track.id, track])));
  readonly step = signal<ScanStep>('reading');
  /** Songs the scan under way has found so far. */
  readonly found = signal(0);
  /** Songs whose tags the scan under way has read, out of `found`. */
  readonly tagged = signal(0);

  /** Asks for access to audio files if it is not granted yet, then reads every one of them. */
  async scan(): Promise<void> {
    if (this.status() === 'scanning') return;
    this.status.set('scanning');
    this.step.set('reading');
    this.found.set(0);
    this.tagged.set(0);
    this.error.set(null);
    try {
      const granted =
        (await this.media.permission.check()) || (await this.media.requestPermission(false, ['audio']));
      if (!granted) {
        this.status.set(this.media.permission.blocked() ? 'blocked' : 'denied');
        return;
      }
      const found = await this.readAll();
      this.step.set('tagging');
      this.uris.clear();
      const tracks = await this.readTags(found);
      this.step.set('indexing');
      await nextFrame();
      tracks.sort(byTitle);
      this.list.set(tracks);
      this.status.set('ready');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      this.status.set('error');
    }
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
        const track = trackFromFile(asset.id, asset.filename, asset.duration === null ? null : asset.duration / 1000);
        found.push({ track, modified: asset.modificationTime ?? null });
      }
      this.found.set(found.length);
      // A page with nothing new means the store ignored the offset: stop rather than loop forever.
      if (page.length < SCAN_PAGE_SIZE || !fresh) return found;
      await nextFrame();
    }
  }

  /**
   * Names each track by its file's tags: kept from an earlier scan when the file has not changed
   * since, read from the file otherwise. A file whose tags cannot be read keeps its file name.
   */
  private async readTags(found: readonly Found[]): Promise<Track[]> {
    const cache = this.loadTagCache();
    const kept: Record<string, CachedTags> = {};
    const tracks: Track[] = [];
    let slice = Date.now();
    for (const { track, modified } of found) {
      const cached = cache[track.id];
      const tags = cached && cached.modified === modified ? cached.tags : await this.tagsOf(track);
      if (tags) kept[track.id] = { modified, tags };
      tracks.push(tags ? withTags(track, tags) : track);
      this.tagged.set(tracks.length);
      if (Date.now() - slice > TAGGING_SLICE_MS) {
        await nextFrame();
        slice = Date.now();
      }
    }
    this.saveTagCache(kept);
    return tracks;
  }

  private async tagsOf(track: Track): Promise<Tags | null> {
    try {
      return await readFile(this.files, await this.uriOf(track), embeddedTags);
    } catch {
      return null;
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
