import { type FolderMode } from './library-settings.ts';
import { type Track, folderOf } from './track.ts';

/** Which files the library reads: the user's choices in the settings. */
export interface ContentRules {
  readonly excludeNonMusic: boolean;
  readonly includeHidden: boolean;
  readonly folderMode: FolderMode;
  readonly folders: readonly string[];
}

/**
 * The folders that hold audio that is not music: Android's standard directories for podcasts,
 * audiobooks, ringtones, notifications, alarms and recordings, and the ones recorders and
 * messaging apps keep voice notes in. Android's media store says which files are music, but the
 * module the app reads it through does not, so the folder a file is in has to say it.
 */
const NON_MUSIC = new Set([
  'podcasts',
  'audiobooks',
  'ringtones',
  'notifications',
  'alarms',
  'recordings',
  'recorder',
  'voice recorder',
  'sound recorder',
  'soundrecorder',
  'sound_recorder',
  'call recordings',
  'callrecordings',
  'call_rec',
  'voice notes',
  'whatsapp voice notes',
]);

const segments = (path: string): string[] => path.split('/').filter(Boolean);

/** Whether a file is in a hidden folder, or is hidden itself: a name that starts with a dot. */
export function isHidden(path: string): boolean {
  return segments(path).some((segment) => segment.startsWith('.'));
}

/** Whether a file is in a folder that holds podcasts, ringtones, recordings or the like. */
export function isNonMusic(path: string): boolean {
  return segments(path)
    .slice(0, -1)
    .some((segment) => NON_MUSIC.has(segment.toLowerCase()));
}

/** Whether `path` is `folder` or inside it. */
export function isWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

/** Whether the library reads this track, by the user's rules. A track whose path is not known is read. */
export function isIncluded(track: Track, rules: ContentRules): boolean {
  const { path } = track;
  if (!path) return true;
  if (!rules.includeHidden && isHidden(path)) return false;
  if (rules.excludeNonMusic && isNonMusic(path)) return false;
  if (!rules.folders.length) return true;
  const picked = rules.folders.some((folder) => isWithin(path, folder));
  return rules.folderMode === 'include' ? picked : !picked;
}

/** A folder that holds audio, with how many files are in it and in the folders inside it. */
export interface MusicFolder {
  readonly path: string;
  readonly count: number;
}

/**
 * The folders the tracks are in and the folders those are in, up to their volume, each once, by
 * path: "/Music" as well as "/Music/Queen/Greatest Hits", so a whole tree can be left out at once.
 */
export function foldersOf(tracks: readonly Track[]): MusicFolder[] {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const folder = folderOf(track);
    if (!folder) continue;
    const { inside } = locate(folder);
    const root = folder.slice(0, folder.length - inside.length);
    const parts = inside.split('/').filter(Boolean);
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = `${root}/${parts.slice(0, depth).join('/')}`;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true }));
}

/** Where a folder is: the device's own storage, an SD card or USB drive by its volume name, or neither. */
export type Volume = { readonly kind: 'internal' } | { readonly kind: 'external'; readonly name: string } | null;

const INTERNAL = /^\/storage\/emulated\/\d+(?=\/|$)|^\/sdcard(?=\/|$)/;
const EXTERNAL = /^\/storage\/([^/]+)(?=\/|$)/;

/** The folder's volume, and its path inside that volume, as a folder is shown. */
export function locate(path: string): { readonly volume: Volume; readonly inside: string } {
  const internal = INTERNAL.exec(path);
  if (internal) return { volume: { kind: 'internal' }, inside: path.slice(internal[0].length) || '/' };
  const external = EXTERNAL.exec(path);
  if (external && external[1] !== 'self') {
    return { volume: { kind: 'external', name: external[1]! }, inside: path.slice(external[0].length) || '/' };
  }
  return { volume: null, inside: path };
}

/** The file's path from the uri the media store gives for it: a `file://` uri's path, decoded. */
export function pathOf(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  const path = uri.slice('file://'.length);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
