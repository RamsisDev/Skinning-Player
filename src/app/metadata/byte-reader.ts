import type { FileSystem, NativeFile } from '@ng-native/expo/file-system';

/** Random access to a file, so the audio between the pieces that matter is never loaded. */
export interface ByteReader {
  readonly size: number;
  /** Up to `length` bytes from `offset`, fewer past the end of the file. */
  read(offset: number, length: number): Uint8Array;
}

export function bytesReader(bytes: Uint8Array): ByteReader {
  return { size: bytes.length, read: (offset, length) => bytes.subarray(offset, offset + length) };
}

/** The `size` bytes of `file` from `start`, read as a file of their own. */
export function subReader(file: ByteReader, start: number, size: number): ByteReader {
  const end = Math.min(start + size, file.size);
  return {
    size: Math.max(0, end - start),
    read: (offset, length) => file.read(start + offset, Math.max(0, Math.min(length, end - start - offset))),
  };
}

/**
 * Expo's file handle, which reads a file a piece at a time. Not in `NativeFile`'s slice of it.
 * `'r'` is Expo's `FileMode.ReadOnly`, spelled out so a test in Node need not load the module.
 */
interface ReadableFile extends NativeFile {
  open?(mode: 'r'): { readBytes(length: number): Uint8Array; close(): void; offset: number | null; size: number | null };
}

/**
 * Hands the file at `uri` to `use` a piece at a time, without loading the audio, and closes it
 * after. A file system that cannot open a handle hands over the whole file instead.
 */
export async function readFile<T>(files: FileSystem, uri: string, use: (file: ByteReader) => T): Promise<T> {
  const file = files.file(uri) as ReadableFile;
  if (!file.open) return use(bytesReader(await file.bytes()));
  // Read-only: Expo opens a file:// uri for writing too by default, which Android refuses for
  // music the app does not own.
  const handle = file.open('r');
  try {
    const size = handle.size ?? 0;
    return use({
      size,
      read(offset, length) {
        const available = Math.min(length, size - offset);
        if (available <= 0) return new Uint8Array(0);
        handle.offset = offset;
        return handle.readBytes(available);
      },
    });
  } finally {
    handle.close();
  }
}
