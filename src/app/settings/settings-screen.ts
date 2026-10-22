import { Component, DestroyRef, computed, inject } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { Dialogs, HardwareBack } from '@ng-native/device';
import { AUDIO_ENGINE } from '../audio/audio-engine.ts';
import { BAR_ACTIONS, BehaviorSettings, PLAY_FROM } from './behavior-settings.ts';
import { CatalogService } from '../catalog/catalog.ts';
import { Features } from '../audio/features.ts';
import { type FolderMode, LibrarySettings } from '../library/library-settings.ts';
import { locate } from '../library/library-content.ts';
import { MediaAccess } from '../library/media-access.ts';
import { MusicLibrary } from '../library/music-library.ts';
import { PRE_AMP_LIMIT, REPLAY_GAIN_MODES, stepPreAmp } from '../audio/replay-gain.ts';
import { SEPARATORS, type Separator, formatTime } from '../library/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { Navigation } from '../shared/navigation.ts';
import { SettingSwitch } from './setting-switch.ts';
import { SkinButton } from '../skins/skin-button.ts';

/**
 * How the app plays and looks: what a tap on
 * a song plays, shuffle, repeat, skipping and pausing, leaving recents and connecting headphones,
 * ReplayGain and the equalizer, the library's tabs and the mini player's button. Then how the library is read: rescanning, which files are
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
      <text class="section" role="header">{{ t().settings.playback }}</text>
      <text class="label">{{ t().settings.playFrom }}</text>
      <view class="buttons">
        @for (from of playFrom; track from) {
          <app-skin-button
            [label]="t().settings.playFromModes[from]"
            size="small"
            [variant]="behavior.playFrom() === from ? 'primary' : 'normal'"
            [active]="behavior.playFrom() === from"
            (press)="behavior.playFrom.set(from)"
          />
        }
      </view>
      <text class="hint">{{ t().settings.playFromHint[behavior.playFrom()] }}</text>
      <app-setting-switch
        [label]="t().settings.rememberShuffle"
        [hint]="t().settings.rememberShuffleHint"
        [checked]="behavior.rememberShuffle()"
        (toggle)="behavior.rememberShuffle.set(!behavior.rememberShuffle())"
      />
      <app-setting-switch
        [label]="t().settings.rewindBeforeSkip"
        [hint]="t().settings.rewindBeforeSkipHint"
        [checked]="behavior.rewindBeforeSkip()"
        (toggle)="behavior.rewindBeforeSkip.set(!behavior.rewindBeforeSkip())"
      />
      <app-setting-switch
        [label]="t().settings.pauseOnRepeat"
        [hint]="t().settings.pauseOnRepeatHint"
        [checked]="behavior.pauseOnRepeat()"
        (toggle)="behavior.pauseOnRepeat.set(!behavior.pauseOnRepeat())"
      />
      <app-setting-switch
        [label]="t().settings.rememberPause"
        [hint]="t().settings.rememberPauseHint"
        [checked]="behavior.rememberPause()"
        (toggle)="behavior.rememberPause.set(!behavior.rememberPause())"
      />
      @if (engine.features.stopOnTaskRemoved) {
        <app-setting-switch
          [label]="t().settings.stopOnTaskRemoved"
          [hint]="t().settings.stopOnTaskRemovedHint"
          [checked]="behavior.stopOnTaskRemoved()"
          (toggle)="behavior.stopOnTaskRemoved.set(!behavior.stopOnTaskRemoved())"
        />
      }
      @if (engine.features.autoplayOnHeadset) {
        <app-setting-switch
          [label]="t().settings.autoplayOnHeadset"
          [hint]="t().settings.autoplayOnHeadsetHint"
          [checked]="behavior.autoplayOnHeadset()"
          (toggle)="behavior.autoplayOnHeadset.set(!behavior.autoplayOnHeadset())"
        />
      }
      @if (replayGain) {
        <text class="label">{{ t().settings.replayGain }}</text>
        <view class="buttons">
          @for (mode of replayGainModes; track mode) {
            <app-skin-button
              [label]="t().settings.replayGainModes[mode]"
              size="small"
              [variant]="behavior.replayGain() === mode ? 'primary' : 'normal'"
              [active]="behavior.replayGain() === mode"
              (press)="behavior.replayGain.set(mode)"
            />
          }
        </view>
        <text class="hint">{{ t().settings.replayGainHint[behavior.replayGain()] }}</text>
        @if (behavior.replayGain() !== 'off') {
          @for (preAmp of preAmps(); track preAmp.kind) {
            <view class="tab-row">
              <view class="pre-amp">
                <text class="label">{{ preAmp.label }}</text>
                <text class="hint">{{ preAmp.hint }}</text>
              </view>
              <app-skin-button
                [label]="t().settings.lowerPreAmp(preAmp.label)"
                icon="moveDown"
                variant="ghost"
                size="small"
                [iconOnly]="true"
                [disabled]="preAmp.value <= -preAmpLimit"
                (press)="stepPreAmp(preAmp.kind, -1)"
              />
              <text class="value decibels">{{ t().settings.decibels(preAmp.value) }}</text>
              <app-skin-button
                [label]="t().settings.raisePreAmp(preAmp.label)"
                icon="moveUp"
                variant="ghost"
                size="small"
                [iconOnly]="true"
                [disabled]="preAmp.value >= preAmpLimit"
                (press)="stepPreAmp(preAmp.kind, 1)"
              />
            </view>
          }
        }
      }
      @if (engine.features.equalizer) {
        <view class="buttons">
          <app-skin-button [label]="t().settings.equalizer" size="small" [disabled]="!hasEqualizer" (press)="openEqualizer()" />
        </view>
        <text class="hint">{{ hasEqualizer ? t().settings.equalizerHint : t().settings.noEqualizer }}</text>
      }

      <text class="section" role="header">{{ t().settings.interface }}</text>
      <text class="label">{{ t().settings.libraryTabs }}</text>
      <text class="hint">{{ t().settings.libraryTabsHint }}</text>
      @for (tab of behavior.tabs(); track tab.view; let first = $first, last = $last) {
        <view class="tab-row">
          <app-setting-switch class="tab-switch" [label]="t().library.views[tab.view]" [checked]="tab.shown" (toggle)="behavior.toggleTab(tab.view)" />
          <app-skin-button
            [label]="t().settings.moveTabUp(t().library.views[tab.view])"
            icon="moveUp"
            variant="ghost"
            size="small"
            [iconOnly]="true"
            [disabled]="first"
            (press)="behavior.moveTab(tab.view, -1)"
          />
          <app-skin-button
            [label]="t().settings.moveTabDown(t().library.views[tab.view])"
            icon="moveDown"
            variant="ghost"
            size="small"
            [iconOnly]="true"
            [disabled]="last"
            (press)="behavior.moveTab(tab.view, 1)"
          />
        </view>
      }
      <text class="label">{{ t().settings.barAction }}</text>
      <view class="buttons">
        @for (action of barActions; track action) {
          <app-skin-button
            [label]="t().settings.barActions[action]"
            size="small"
            [variant]="behavior.barAction() === action ? 'primary' : 'normal'"
            [active]="behavior.barAction() === action"
            (press)="behavior.barAction.set(action)"
          />
        }
      </view>
      <text class="hint">{{ t().settings.barActionHint }}</text>

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
    .tab-row {
      flex-direction: row;
      align-items: center;
      padding-right: 8px;
    }
    .tab-switch {
      flex: 1;
    }
    .pre-amp {
      flex: 1;
      padding-bottom: 4px;
    }
    .decibels {
      min-width: 64px;
      text-align: center;
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
  protected readonly behavior = inject(BehaviorSettings);
  protected readonly library = inject(MusicLibrary);
  protected readonly navigation = inject(Navigation);
  protected readonly engine = inject(AUDIO_ENGINE);
  private readonly catalog = inject(CatalogService).catalog;
  private readonly access = inject(MediaAccess);
  private readonly dialogs = inject(Dialogs);
  protected readonly t = inject(I18n).messages;

  protected readonly playFrom = PLAY_FROM;
  protected readonly replayGainModes = REPLAY_GAIN_MODES;
  protected readonly preAmpLimit = PRE_AMP_LIMIT;
  protected readonly replayGain = inject(Features).on('replayGain');
  /** Asked as the screen opens, so an equalizer installed meanwhile shows the next time. */
  protected readonly hasEqualizer = this.engine.features.equalizer && this.engine.hasEqualizer();
  protected readonly barActions = BAR_ACTIONS;

  /** The pre-amp for songs with ReplayGain tags, and for songs without. */
  protected readonly preAmps = computed(() => {
    const t = this.t().settings;
    return [
      { kind: 'tagged', label: t.preAmpTagged, hint: t.preAmpTaggedHint, value: this.behavior.preAmpTagged() },
      { kind: 'untagged', label: t.preAmpUntagged, hint: t.preAmpUntaggedHint, value: this.behavior.preAmpUntagged() },
    ] as const;
  });
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

  protected stepPreAmp(kind: 'tagged' | 'untagged', steps: number): void {
    const preAmp = kind === 'tagged' ? this.behavior.preAmpTagged : this.behavior.preAmpUntagged;
    preAmp.set(stepPreAmp(preAmp(), steps));
  }

  protected openEqualizer(): void {
    if (!this.engine.openEqualizer()) this.dialogs.notify(this.t().settings.noEqualizer);
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
