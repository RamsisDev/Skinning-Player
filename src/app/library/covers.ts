import { Service, inject, signal } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { DocumentPicker } from '@ng-native/expo/document-picker';
import { FileSystem } from '@ng-native/expo/file-system';
import { readFile } from '../metadata/byte-reader.ts';
import { embeddedCover } from '../metadata/embedded-cover.ts';
import { imageExtension } from '../metadata/id3-cover.ts';
import { LibrarySettings } from './library-settings.ts';
import { MusicLibrary } from './music-library.ts';
import { type Track, folderOf } from './track.ts';

export type CoverError = { readonly code: 'tooLarge' } | { readonly code: 'unreadable'; readonly file: string };

export type CoverResult = { readonly ok: true } | { readonly ok: false; readonly error: CoverError };

const MAX_IMAGE_BYTES = 10_000_000;

const fileSafe = (id: string): string => id.replace(/[^\w-]/g, '_');

/** The names a folder's own cover goes by, as most players look for them. */
const FOLDER_COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart'].flatMap((name) => [
  name,
  name[0]!.toUpperCase() + name.slice(1),
]);
const FOLDER_COVER_EXTENSIONS = ['jpg', 'jpeg', 'png'];

/** The file:// uri of a path, each part of it encoded. */
const uriOfPath = (path: string): string => `file://${path.split('/').map(encodeURIComponent).join('/')}`;

/**
 * Each track's cover: one the user chose, kept in the app's documents, or else the art embedded
 * in the file, read once and kept in the cache, or else, once the user turns it on, an image such
 * as cover.jpg in the song's folder. A track with none is drawn with a placeholder.
 */
@Service()
export class Covers {
  private readonly store = inject(Storage);
  private readonly files = inject(FileSystem);
  private readonly picker = inject(DocumentPicker);
  private readonly library = inject(MusicLibrary);
  private readonly settings = inject(LibrarySettings);

  /** Track id to the image file the user chose for it. */
  private readonly custom = this.store.signal<Record<string, string>>('covers.custom', {});
  /** Track id to its embedded art's cached file, or null for a file with none. */
  private readonly embedded = signal<ReadonlyMap<string, string | null>>(new Map());
  private readonly reading = new Set<string>();
  /** Folder path to its cover image's uri, or null for a folder with none. */
  private readonly folderArt = signal<ReadonlyMap<string, string | null>>(new Map());

  /** The image to draw for a track, or null for the placeholder. */
  uriOf(trackId: string): string | null {
    const own = this.custom()[trackId] ?? this.embedded().get(trackId);
    if (own || !this.settings.folderCovers()) return own ?? null;
    const track = this.library.byId().get(trackId);
    return (track && this.folderArt().get(folderOf(track))) ?? null;
  }

  hasCustom(trackId: string): boolean {
    return trackId in this.custom();
  }

  /** Looks for the track's embedded art and its folder's, once; `uriOf` follows when it is found. */
  async load(track: Track): Promise<void> {
    // Read before anything is awaited, so that a caller in an effect loads again once it is turned on.
    if (this.settings.folderCovers()) this.loadFolder(track);
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

  /** Looks for a cover image in the track's folder, once per folder. */
  private loadFolder(track: Track): void {
    const folder = folderOf(track);
    if (!folder || this.folderArt().has(folder)) return;
    let found: string | null = null;
    try {
      search: for (const name of FOLDER_COVER_NAMES) {
        for (const ext of FOLDER_COVER_EXTENSIONS) {
          const file = this.files.file(uriOfPath(`${folder}/${name}.${ext}`));
          if (file.exists) {
            found = file.uri;
            break search;
          }
        }
      }
    } catch {
      // A folder that cannot be looked in has no cover to offer.
    }
    this.folderArt.update((known) => new Map(known).set(folder, found));
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
