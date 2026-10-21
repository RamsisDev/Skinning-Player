import { Service, inject, signal } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { DocumentPicker } from '@ng-native/expo/document-picker';
import { FileSystem } from '@ng-native/expo/file-system';
import { readFile } from './byte-reader.ts';
import { embeddedCover } from './embedded-cover.ts';
import { imageExtension } from './id3-cover.ts';
import { MusicLibrary } from './music-library.ts';
import { type Track } from './track.ts';

export type CoverError = { readonly code: 'tooLarge' } | { readonly code: 'unreadable'; readonly file: string };

export type CoverResult = { readonly ok: true } | { readonly ok: false; readonly error: CoverError };

const MAX_IMAGE_BYTES = 10_000_000;

const fileSafe = (id: string): string => id.replace(/[^\w-]/g, '_');

/**
 * Each track's cover: one the user chose, kept in the app's documents, or else the art embedded
 * in the file, read once and kept in the cache. A track with neither has none, and is drawn
 * with a placeholder.
 */
@Service()
export class Covers {
  private readonly store = inject(Storage);
  private readonly files = inject(FileSystem);
  private readonly picker = inject(DocumentPicker);
  private readonly library = inject(MusicLibrary);

  /** Track id to the image file the user chose for it. */
  private readonly custom = this.store.signal<Record<string, string>>('covers.custom', {});
  /** Track id to its embedded art's cached file, or null for a file with none. */
  private readonly embedded = signal<ReadonlyMap<string, string | null>>(new Map());
  private readonly reading = new Set<string>();

  /** The image to draw for a track, or null for the placeholder. */
  uriOf(trackId: string): string | null {
    return this.custom()[trackId] ?? this.embedded().get(trackId) ?? null;
  }

  hasCustom(trackId: string): boolean {
    return trackId in this.custom();
  }

  /** Looks for the track's embedded art, once; `uriOf` follows when it is found. */
  async load(track: Track): Promise<void> {
    if (this.embedded().has(track.id) || this.reading.has(track.id)) return;
    this.reading.add(track.id);
    let uri: string | null = null;
    try {
      uri = this.cachedEmbedded(track.id) ?? (await this.extract(track));
    } catch {
      // An unreadable file has no cover to show, which the placeholder already says.
    }
    this.reading.delete(track.id);
    this.embedded.update((known) => new Map(known).set(track.id, uri));
  }

  /** Lets the user pick an image for the track. Null when the picker is canceled. */
  async choose(track: Track): Promise<CoverResult | null> {
    const [picked] = await this.picker.pick({ type: 'image/*', copyToCacheDirectory: true });
    if (!picked) return null;
    if (picked.size !== undefined && picked.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: { code: 'tooLarge' } };
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.files.file(picked.uri).bytes();
    } catch {
      return { ok: false, error: { code: 'unreadable', file: picked.name } };
    }
    // A new name each time, so an image already drawn from the old file is not shown again.
    const ext = imageExtension(picked.mimeType, picked.name);
    const target = this.files.document(`covers/${fileSafe(track.id)}-${Date.now().toString(36)}.${ext}`);
    const previous = this.custom()[track.id];
    this.files.write(target, bytes);
    if (previous !== target.uri) this.deleteFile(previous);
    this.custom.update((all) => ({ ...all, [track.id]: target.uri }));
    return { ok: true };
  }

  /** Drops the cover the user chose, which brings back the file's own art, if any. */
  removeCustom(track: Track): void {
    this.deleteFile(this.custom()[track.id]);
    this.custom.update(({ [track.id]: _, ...rest }) => rest);
  }

  private deleteFile(uri: string | undefined): void {
    if (!uri) return;
    try {
      this.files.file(uri).delete();
    } catch {
      // Already gone: nothing to clean up.
    }
  }

  private cachedEmbedded(trackId: string): string | null {
    for (const ext of ['jpg', 'png', 'webp', 'gif']) {
      const file = this.files.cache(`covers/embedded-${fileSafe(trackId)}.${ext}`);
      if (file.exists) return file.uri;
    }
    return null;
  }

  private async extract(track: Track): Promise<string | null> {
    const picture = await readFile(this.files, await this.library.uriOf(track), embeddedCover);
    if (!picture) return null;
    const file = this.files.cache(`covers/embedded-${fileSafe(track.id)}.${imageExtension(picture.mime)}`);
    this.files.write(file, picture.data);
    return file.uri;
  }
}
