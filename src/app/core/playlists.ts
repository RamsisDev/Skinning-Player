import { Service, inject } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { type Track } from './track.ts';

export interface Playlist {
  readonly id: string;
  readonly name: string;
  /** Media store asset ids, in play order. */
  readonly trackIds: readonly string[];
  readonly createdAt: number;
}

const MAX_NAME = 60;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The user's playlists, persisted on the device. */
@Service()
export class Playlists {
  private readonly store = inject(Storage);
  private readonly list = this.store.signal<Playlist[]>('playlists', []);
  readonly all = this.list.asReadonly();

  get(id: string): Playlist | undefined {
    return this.list().find((playlist) => playlist.id === id);
  }

  /** Creates a playlist and answers its id, or null for a blank name. */
  create(name: string, trackIds: readonly string[] = []): string | null {
    const clean = name.trim().slice(0, MAX_NAME);
    if (!clean) return null;
    const playlist: Playlist = { id: newId(), name: clean, trackIds: [...new Set(trackIds)], createdAt: Date.now() };
    this.list.update((all) => [...all, playlist]);
    return playlist.id;
  }

  rename(id: string, name: string): void {
    const clean = name.trim().slice(0, MAX_NAME);
    if (clean) this.patch(id, () => ({ name: clean }));
  }

  remove(id: string): void {
    this.list.update((all) => all.filter((playlist) => playlist.id !== id));
  }

  /** Appends tracks, skipping the ones already in the playlist. Answers how many were added. */
  addTracks(id: string, trackIds: readonly string[]): number {
    const playlist = this.get(id);
    if (!playlist) return 0;
    const existing = new Set(playlist.trackIds);
    const added = [...new Set(trackIds)].filter((trackId) => !existing.has(trackId));
    if (added.length) this.patch(id, (p) => ({ trackIds: [...p.trackIds, ...added] }));
    return added.length;
  }

  removeTrack(id: string, trackId: string): void {
    this.patch(id, (p) => ({ trackIds: p.trackIds.filter((t) => t !== trackId) }));
  }

  /** Moves a track one place up (-1) or down (+1). */
  moveTrack(id: string, trackId: string, by: -1 | 1): void {
    this.patch(id, (p) => {
      const from = p.trackIds.indexOf(trackId);
      const to = from + by;
      if (from < 0 || to < 0 || to >= p.trackIds.length) return {};
      const ids = [...p.trackIds];
      [ids[from], ids[to]] = [ids[to], ids[from]];
      return { trackIds: ids };
    });
  }

  /** The playlist's tracks that are still on the device, in order. */
  tracksOf(playlist: Playlist, library: ReadonlyMap<string, Track>): Track[] {
    return playlist.trackIds.flatMap((trackId) => {
      const track = library.get(trackId);
      return track ? [track] : [];
    });
  }

  private patch(id: string, change: (playlist: Playlist) => Partial<Playlist>): void {
    this.list.update((all) => all.map((playlist) => (playlist.id === id ? { ...playlist, ...change(playlist) } : playlist)));
  }
}
