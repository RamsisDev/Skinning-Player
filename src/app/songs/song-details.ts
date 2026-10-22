import { InjectionToken, Service, inject } from '@angular/core';
import { FileSystem } from '@ng-native/expo/file-system';
import { type AudioInfo, audioInfo } from '../metadata/audio-info.ts';
import { readFile } from '../metadata/byte-reader.ts';
import { type Tags, embeddedTags } from '../metadata/embedded-tags.ts';
import { MusicLibrary } from '../library/music-library.ts';
import { type Track } from '../library/track.ts';

/** What a song's file is, beyond its tags: its properties. */
export interface SongDetails {
  /** Where the file is, as a path when it is a file. */
  readonly path: string;
  readonly size: number;
  readonly audio: AudioInfo | null;
  readonly replayGain: Tags['replayGain'] | null;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
};

/** The type a share sheet offers a file as, by its extension; any audio when it is not one of these. */
export function mimeTypeOf(filename: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? '';
  return MIME_TYPES[extension] ?? 'audio/*';
}

/** The system's share sheet for a file. A token, so a test can stand in for it. */
export interface FileSharing {
  /** Offers the file at `uri` to the apps that take it. Resolves to false when sharing is not available. */
  share(uri: string, options: { readonly title: string; readonly mimeType: string }): Promise<boolean>;
}

export const FILE_SHARING = new InjectionToken<FileSharing>('FileSharing', {
  providedIn: 'root',
  factory: () => ({
    // React Native's Share sends text only; `expo-sharing` hands over the file itself.
    async share(uri, { title, mimeType }) {
      const sharing = await import('expo-sharing');
      if (!(await sharing.isAvailableAsync())) return false;
      await sharing.shareAsync(uri, { dialogTitle: title, mimeType });
      return true;
    },
  }),
});

/** Reads a song's file for its properties, and shares it. */
@Service()
export class SongFiles {
  private readonly library = inject(MusicLibrary);
  private readonly files = inject(FileSystem);
  private readonly sharing = inject(FILE_SHARING);

  /** Its properties, read again from the file: only its headers and tags, never the audio. */
  async details(track: Track): Promise<SongDetails> {
    const uri = await this.library.uriOf(track);
    const fromFile = await readFile(this.files, uri, (file) => ({
      size: file.size,
      audio: safely(() => audioInfo(file, track.duration)),
      replayGain: safely(() => embeddedTags(file).replayGain ?? null),
    })).catch(() => null);
    return {
      path: track.path || uri,
      size: fromFile?.size || track.size,
      audio: fromFile?.audio ?? null,
      replayGain: fromFile?.replayGain ?? null,
    };
  }

  async share(track: Track): Promise<boolean> {
    const uri = await this.library.uriOf(track);
    return this.sharing.share(uri, { title: track.title, mimeType: mimeTypeOf(track.filename) });
  }
}

/** A damaged file reads as having nothing to tell rather than failing the whole sheet. */
function safely<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}
