import { Component, inject, input, output, signal } from '@angular/core';
import { Dialogs } from '@ng-native/device';
import { type FacetValue, entriesOf } from '../library/library-filter.ts';
import { Player } from '../player/player.ts';
import { SongFiles } from './song-details.ts';
import { type Track } from '../library/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { type Menu, MenuSheet } from '../shared/menu-sheet.ts';
import { type CatalogRef } from '../shared/navigation.ts';
import { AddToPlaylistSheet } from '../playlists/add-to-playlist-sheet.ts';
import { CoverSheet } from './cover-sheet.ts';
import { SongPropertiesSheet } from './song-properties-sheet.ts';

/**
 * A song's menu: play it next or add it to the queue, go to its artist or album, file
 * it in a playlist, change its cover, see its properties or share its file. Opened with `show`;
 * going to an artist or album is left to the screen, through `open`.
 */
@Component({
  selector: 'app-song-menu',
  imports: [AddToPlaylistSheet, CoverSheet, MenuSheet, SongPropertiesSheet],
  host: { style: 'position: absolute' },
  template: `
    <app-menu-sheet [menu]="menu()" (close)="menu.set(null)" />
    <app-add-to-playlist-sheet [tracks]="adding()" (close)="adding.set(null)" />
    <app-cover-sheet [track]="editingCover()" (close)="editingCover.set(null)" />
    <app-song-properties-sheet [track]="describing()" (close)="describing.set(null)" />
  `,
})
export class SongMenu {
  private readonly player = inject(Player);
  private readonly songFiles = inject(SongFiles);
  private readonly dialogs = inject(Dialogs);
  protected readonly t = inject(I18n).messages;

  /** The album or artist on show, which the menu does not offer to go to. */
  readonly within = input<CatalogRef | null>(null);
  readonly open = output<CatalogRef>();

  protected readonly menu = signal<Menu | null>(null);
  protected readonly adding = signal<readonly Track[] | null>(null);
  protected readonly editingCover = signal<Track | null>(null);
  protected readonly describing = signal<Track | null>(null);

  show(track: Track): void {
    const t = this.t().common;
    const within = this.within();
    const elsewhere = (kind: CatalogRef['kind']) => (entry: FacetValue) => !(within?.kind === kind && within.key === entry.key);
    const artists = entriesOf(track, 'artist').filter(elsewhere('artist'));
    const album = entriesOf(track, 'album').filter(elsewhere('album'))[0];
    this.menu.set({
      title: track.title,
      actions: [
        { label: t.playNext, icon: 'next', run: () => this.playNext(track) },
        { label: t.addToQueue, icon: 'add', run: () => this.addToQueue(track) },
        ...(artists.length ? [{ label: t.goToArtist, icon: 'library' as const, run: () => this.goToArtist(artists) }] : []),
        ...(album ? [{ label: t.goToAlbum, icon: 'library' as const, run: () => this.open.emit({ kind: 'album', key: album.key }) }] : []),
        { label: t.addToPlaylist, icon: 'addToPlaylist', run: () => this.adding.set([track]) },
        { label: t.changeCover, icon: 'cover', run: () => this.editingCover.set(track) },
        { label: t.properties, icon: 'info', run: () => this.describing.set(track) },
        { label: t.share, icon: 'share', run: () => void this.share(track) },
      ],
    });
  }

  private playNext(track: Track): void {
    this.player.playNext([track]);
    this.dialogs.notify(this.t().common.playingNext);
  }

  private addToQueue(track: Track): void {
    this.player.addToQueue([track]);
    this.dialogs.notify(this.t().common.addedToQueue);
  }

  /** The song's artist, or a choice among them when it has several. */
  private goToArtist(artists: readonly FacetValue[]): void {
    if (artists.length === 1) {
      this.open.emit({ kind: 'artist', key: artists[0]!.key });
      return;
    }
    this.menu.set({
      title: this.t().common.goToArtist,
      actions: artists.map((artist) => ({ label: artist.name, icon: 'library', run: () => this.open.emit({ kind: 'artist', key: artist.key }) })),
    });
  }

  private async share(track: Track): Promise<void> {
    const t = this.t().common;
    try {
      if (!(await this.songFiles.share(track))) this.dialogs.notify(t.shareUnavailable);
    } catch {
      this.dialogs.notify(t.shareFailed);
    }
  }
}
