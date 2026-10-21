import { Service, computed, inject, signal } from '@angular/core';
import { AssetField, MediaLibrary, MediaType } from '@ng-native/expo/media-library';
import { type Track, byTitle, trackFromFile } from './track.ts';

export type LibraryStatus = 'idle' | 'scanning' | 'ready' | 'denied' | 'blocked' | 'error';

/** What a scan under way is doing: reading the media store, then sorting what it found. */
export type ScanStep = 'reading' | 'indexing';

/**
 * Files read per query. One query for a large library hands the JS thread thousands of records at
 * once and freezes the screen; pages leave room for frames in between.
 */
export const SCAN_PAGE_SIZE = 250;

/** Long enough for the screen to draw a frame before the next piece of work. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

/** The audio files on the device, read from the platform's media store. */
@Service()
export class MusicLibrary {
  private readonly media = inject(MediaLibrary);
  private readonly uris = new Map<string, string>();

  private readonly list = signal<readonly Track[]>([]);
  readonly tracks = this.list.asReadonly();
  readonly status = signal<LibraryStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly byId = computed(() => new Map(this.tracks().map((track) => [track.id, track])));
  readonly step = signal<ScanStep>('reading');
  /** Songs the scan under way has found so far. */
  readonly found = signal(0);

  /** Asks for access to audio files if it is not granted yet, then reads every one of them. */
  async scan(): Promise<void> {
    if (this.status() === 'scanning') return;
    this.status.set('scanning');
    this.step.set('reading');
    this.found.set(0);
    this.error.set(null);
    try {
      const granted =
        (await this.media.permission.check()) || (await this.media.requestPermission(false, ['audio']));
      if (!granted) {
        this.status.set(this.media.permission.blocked() ? 'blocked' : 'denied');
        return;
      }
      const tracks = await this.readAll();
      this.step.set('indexing');
      await nextFrame();
      tracks.sort(byTitle);
      this.uris.clear();
      this.list.set(tracks);
      this.status.set('ready');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      this.status.set('error');
    }
  }

  /** Every audio file with a name, a page at a time, counting them into `found` as they come. */
  private async readAll(): Promise<Track[]> {
    const tracks: Track[] = [];
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
        tracks.push(trackFromFile(asset.id, asset.filename, asset.duration === null ? null : asset.duration / 1000));
      }
      this.found.set(tracks.length);
      // A page with nothing new means the store ignored the offset: stop rather than loop forever.
      if (page.length < SCAN_PAGE_SIZE || !fresh) return tracks;
      await nextFrame();
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
