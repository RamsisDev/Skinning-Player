import { Component, DestroyRef, computed, inject } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { Dialogs, HardwareBack } from '@ng-native/device';
import { CatalogService } from '../core/catalog.ts';
import { type FolderMode, LibrarySettings } from '../core/library-settings.ts';
import { locate } from '../core/library-content.ts';
import { MediaAccess } from '../core/media-access.ts';
import { MusicLibrary } from '../core/music-library.ts';
import { SEPARATORS, type Separator, formatTime } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { Navigation } from '../ui/navigation.ts';
import { SettingSwitch } from '../ui/setting-switch.ts';
import { SkinButton } from '../ui/skin-button.ts';

/**
 * How the library is read, as Auxio's "Music" and "Content" settings: rescanning, which files are
 * read, how tags are split and names sorted, folder covers; and what the library holds.
 */
@Component({
  selector: 'app-settings-screen',
  imports: [ScrollView, SettingSwitch, SkinButton, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <view class="toolbar">
      <app-skin-button [label]="t().settings.close" icon="back" variant="ghost" [iconOnly]="true" (press)="navigation.closeSettings()" />
      <text class="heading" role="heading" [numberOfLines]="1">{{ t().settings.title }}</text>
    </view>
    <scroll-view class="list" [contentContainerStyle]="{ paddingBottom: 24 }">
      <text class="section" role="header">{{ t().settings.library }}</text>
      <view class="buttons">
        <app-skin-button [label]="t().settings.rescan" icon="refresh" size="small" [disabled]="library.refreshing()" (press)="library.scan()" />
        <app-skin-button [label]="t().settings.fullRescan" icon="refresh" size="small" [disabled]="library.refreshing()" (press)="library.scan({ full: true })" />
      </view>
      <text class="hint">{{ t().settings.fullRescanHint }}</text>
      <app-setting-switch
        [label]="t().settings.autoReload"
        [hint]="t().settings.autoReloadHint"
        [checked]="settings.autoReload()"
        (toggle)="settings.autoReload.set(!settings.autoReload())"
      />

      <text class="section" role="header">{{ t().settings.content }}</text>
      <app-setting-switch
        [label]="t().settings.excludeNonMusic"
        [hint]="t().settings.excludeNonMusicHint"
        [checked]="settings.excludeNonMusic()"
        (toggle)="settings.excludeNonMusic.set(!settings.excludeNonMusic())"
      />
      <app-setting-switch
        [label]="t().settings.includeHidden"
        [hint]="t().settings.includeHiddenHint"
        [checked]="settings.includeHidden()"
        (toggle)="settings.includeHidden.set(!settings.includeHidden())"
      />

      <text class="section" role="header">{{ t().settings.folders }}</text>
      <view class="buttons">
        @for (mode of folderModes; track mode) {
          <app-skin-button
            [label]="t().settings.folderModes[mode]"
            size="small"
            [variant]="settings.folderMode() === mode ? 'primary' : 'normal'"
            [active]="settings.folderMode() === mode"
            (press)="settings.folderMode.set(mode)"
          />
        }
      </view>
      <text class="hint">{{ t().settings.folderHint[settings.folderMode()] }}</text>
      @for (folder of folders(); track folder.path) {
        <app-setting-switch [label]="folder.inside" [hint]="folder.meta" [checked]="folder.picked" (toggle)="settings.toggleFolder(folder.path)" />
      } @empty {
        <text class="hint">{{ t().settings.noFolders }}</text>
      }

      <text class="section" role="header">{{ t().settings.tags }}</text>
      <text class="label">{{ t().settings.separators }}</text>
      <text class="hint">{{ t().settings.separatorsHint }}</text>
      @for (separator of separators; track separator) {
        <app-setting-switch
          [label]="t().settings.separatorNames[separator]"
          [checked]="hasSeparator(separator)"
          (toggle)="settings.toggleSeparator(separator)"
        />
      }
      <app-setting-switch
        [label]="t().settings.smartSort"
        [hint]="t().settings.smartSortHint"
        [checked]="settings.smartSort()"
        (toggle)="settings.smartSort.set(!settings.smartSort())"
      />

      <text class="section" role="header">{{ t().settings.covers }}</text>
      <app-setting-switch
        [label]="t().settings.folderCovers"
        [hint]="t().settings.folderCoversHint"
        [checked]="settings.folderCovers()"
        (toggle)="toggleFolderCovers()"
      />

      <text class="section" role="header">{{ t().settings.statistics }}</text>
      @for (stat of stats(); track stat.label) {
        <view class="stat">
          <text class="label stat-label">{{ stat.label }}</text>
          <text class="value">{{ stat.value }}</text>
        </view>
      }
    </scroll-view>
  `,
  styles: `
    .toolbar {
      flex-direction: row;
      align-items: center;
      gap: 4px;
      min-height: 52px;
      padding: 4px 8px;
    }
    .heading {
      flex: 1;
      color: var(--sk-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-lg);
      font-weight: var(--sk-weight-bold);
    }
    .list {
      flex: 1;
    }
    .section {
      padding: 18px 16px 6px;
      color: var(--sk-accent);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-display-weight);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .buttons {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 8px;
      padding: 4px 16px;
    }
    .label {
      padding: 4px 16px 0;
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
    .hint {
      padding: 4px 16px;
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
    }
    .stat {
      flex-direction: row;
      align-items: center;
      padding: 12px 16px 12px 0;
      border-bottom-width: var(--sk-border-width);
      border-color: var(--sk-border);
    }
    .stat-label {
      flex: 1;
      padding-top: 0;
    }
    .value {
      color: var(--sk-text);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-display-weight);
    }
  `,
})
export class SettingsScreen {
  protected readonly settings = inject(LibrarySettings);
  protected readonly library = inject(MusicLibrary);
  protected readonly navigation = inject(Navigation);
  private readonly catalog = inject(CatalogService).catalog;
  private readonly access = inject(MediaAccess);
  private readonly dialogs = inject(Dialogs);
  protected readonly t = inject(I18n).messages;

  protected readonly separators = SEPARATORS;
  protected readonly folderModes: readonly FolderMode[] = ['exclude', 'include'];

  /** Each folder with audio: where it is, how many songs it holds, and whether it is picked. */
  protected readonly folders = computed(() => {
    const t = this.t().settings;
    const picked = this.settings.folders();
    return this.library.folders().map(({ path, count }) => {
      const { volume, inside } = locate(path);
      const where = volume?.kind === 'internal' ? t.internal : volume ? t.external(volume.name) : '';
      return { path, inside, meta: where ? t.folderMeta(where, count) : this.t().common.songs(count), picked: picked.includes(path) };
    });
  });

  protected readonly stats = computed(() => {
    const t = this.t().settings;
    const tracks = this.library.tracks();
    const { albums, artists, genres } = this.catalog();
    return [
      { label: t.stats.songs, value: String(tracks.length) },
      { label: t.stats.albums, value: String(albums.length) },
      { label: t.stats.artists, value: String(artists.length) },
      { label: t.stats.genres, value: String(genres.length) },
      { label: t.stats.duration, value: formatTime(tracks.reduce((sum, track) => sum + track.duration, 0)) },
      { label: t.stats.size, value: t.size(tracks.reduce((sum, track) => sum + track.size, 0)) },
    ];
  });

  constructor() {
    const release = inject(HardwareBack).handle(() => {
      this.navigation.closeSettings();
      return true;
    });
    inject(DestroyRef).onDestroy(release);
  }

  protected hasSeparator(separator: Separator): boolean {
    return this.settings.separators().includes(separator);
  }

  /** Turns folder covers on once the app may read the images on the device, which they are. */
  protected async toggleFolderCovers(): Promise<void> {
    if (this.settings.folderCovers()) {
      this.settings.folderCovers.set(false);
      return;
    }
    if ((await this.access.ensure('photo')) === 'granted') this.settings.folderCovers.set(true);
    else this.dialogs.notify(this.t().settings.folderCoversDenied);
  }
}
