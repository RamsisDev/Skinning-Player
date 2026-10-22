import { Component, Injector, effect, inject, signal } from '@angular/core';
import { Pressable, SafeAreaProvider, SafeAreaView, Text, View } from '@ng-native/components';
import { GestureRoot } from '@ng-native/components/gestures';
import { HardwareBack, StatusBar } from '@ng-native/device';
import { AUDIO_ENGINE } from './audio/audio-engine.ts';
import { AutoBrowse } from './player/auto-browse.ts';
import { I18n } from './i18n/i18n.ts';
import { LanguageSheet } from './i18n/language-sheet.ts';
import { LibraryScreen } from './library/library-screen.ts';
import { NowPlaying } from './player/now-playing.ts';
import { PlaylistsScreen } from './playlists/playlists-screen.ts';
import { SearchScreen } from './search/search-screen.ts';
import { SettingsScreen } from './settings/settings-screen.ts';
import { SkinsScreen } from './skins/skins-screen.ts';
import { SkinManager } from './skins/skin-manager.ts';
import { PlayerView } from './player/player-view.ts';
import { Navigation } from './shared/navigation.ts';
import { SkinBackdrop } from './skins/skin-backdrop.ts';
import { SkinIcon } from './skins/skin-icon.ts';
import { TabMenu } from './shared/tab-menu.ts';
import { MiniPlayer } from './player/mini-player.ts';

/**
 * The shell. The active skin's tokens are set on the root view and cascade into every component
 * and modal under it, which is the whole skinning mechanism: no stylesheet names a color.
 */
@Component({
  imports: [
    GestureRoot,
    LanguageSheet,
    LibraryScreen,
    MiniPlayer,
    NowPlaying,
    PlaylistsScreen,
    Pressable,
    SafeAreaProvider,
    SafeAreaView,
    SearchScreen,
    SettingsScreen,
    SkinBackdrop,
    SkinIcon,
    SkinsScreen,
    TabMenu,
    Text,
    View,
  ],
  selector: 'app-root',
  template: `
    <gesture-root><safe-area-provider>
      <view class="root" [class]="skins.easingClass()" [style]="skins.cssVars()">
        <app-skin-backdrop />
        <safe-area-view class="screen" [edges]="['top', 'bottom']">
          <view class="header">
            <text class="logo">SKINNING PLAYER</text>
            <text class="skin-name" [numberOfLines]="1">{{ skins.active().name }}</text>
            @if (!navigation.searching()) {
              <pressable
                class="language"
                accessibilityRole="button"
                [accessibilityLabel]="i18n.messages().search.open"
                (press)="navigation.openSearch()"
              >
                <app-skin-icon slot="search" [size]="16" color="var(--sk-button-text)" />
              </pressable>
            }
            @if (!navigation.settingsOpen()) {
              <pressable
                class="language"
                accessibilityRole="button"
                [accessibilityLabel]="i18n.messages().settings.open"
                (press)="navigation.openSettings()"
              >
                <app-skin-icon slot="settings" [size]="16" color="var(--sk-button-text)" />
              </pressable>
            }
            <pressable
              class="language"
              accessibilityRole="button"
              [accessibilityLabel]="i18n.messages().language.button"
              (press)="choosingLanguage.set(true)"
            >
              <text class="language-code">{{ i18n.language() }}</text>
            </pressable>
          </view>
          <view class="content">
            @if (navigation.settingsOpen()) {
              <app-settings-screen />
            } @else if (navigation.searching()) {
              <app-search-screen />
            } @else {
              @switch (navigation.tab()) {
                @case ('library') {
                  <app-library-screen />
                }
                @case ('playlists') {
                  <app-playlists-screen />
                }
                @case ('skins') {
                  <app-skins-screen />
                }
              }
            }
          </view>
          <app-mini-player (expand)="playerView.show()" />
          <app-tab-menu [active]="navigation.tab()" (select)="navigation.selectTab($event)" />
        </safe-area-view>
        <app-now-playing />
        <app-language-sheet [open]="choosingLanguage()" (close)="choosingLanguage.set(false)" />
      </view>
    </safe-area-provider></gesture-root>
  `,
  styles: `
    :host {
      flex: 1;
    }
    .root {
      flex: 1;
      background-color: var(--sk-background);
      --sk-easing: ease-out;
    }
    .root.easing-linear {
      --sk-easing: linear;
    }
    .root.easing-ease {
      --sk-easing: ease;
    }
    .root.easing-ease-in {
      --sk-easing: ease-in;
    }
    .root.easing-ease-in-out {
      --sk-easing: ease-in-out;
    }
    .root.easing-smooth {
      --sk-easing: cubic-bezier(0.4, 0, 0.2, 1);
    }
    .root.easing-snappy {
      --sk-easing: cubic-bezier(0.2, 0.9, 0.1, 1);
    }
    .root.easing-bouncy {
      --sk-easing: cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .screen {
      flex: 1;
    }
    .header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 16px 6px;
    }
    .logo {
      color: var(--sk-accent);
      font-family: var(--sk-display-font-bold);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-display-weight-bold);
      letter-spacing: 3px;
    }
    .skin-name {
      flex: 1;
      text-align: right;
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
    }
    .language {
      min-width: 36px;
      height: 28px;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
      border-radius: var(--sk-button-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-button-border);
      background-color: var(--sk-button-background);
    }
    .language:active {
      opacity: var(--sk-press-opacity);
    }
    .language-code {
      color: var(--sk-button-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight-bold);
      text-transform: uppercase;
    }
    .content {
      flex: 1;
    }
  `,
})
export class App {
  protected readonly skins = inject(SkinManager);
  protected readonly navigation = inject(Navigation);
  protected readonly playerView = inject(PlayerView);
  protected readonly i18n = inject(I18n);
  protected readonly choosingLanguage = signal(false);

  constructor() {
    // Android Auto's browse tree follows the library from launch, where the platform has it.
    if (inject(AUDIO_ENGINE).features.browseTree) inject(Injector).get(AutoBrowse);
    const statusBar = inject(StatusBar);
    effect(() => statusBar.set({ style: this.skins.active().statusBar === 'light' ? 'light' : 'dark' }));

    // Back from a search result returns to the search, and from another tab to the library,
    // before it leaves the app.
    inject(HardwareBack).handle(() => {
      if (this.navigation.fromSearch()) {
        this.navigation.returnToSearch();
        return true;
      }
      if (this.navigation.tab() === 'library') return false;
      this.navigation.selectTab('library');
      return true;
    });
  }
}
