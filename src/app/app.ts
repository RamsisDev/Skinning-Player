import { Component, effect, inject, signal } from '@angular/core';
import { Pressable, SafeAreaProvider, SafeAreaView, Text, View } from '@ng-native/components';
import { HardwareBack, StatusBar } from '@ng-native/device';
import { I18n } from './i18n/i18n.ts';
import { LanguageSheet } from './screens/language-sheet.ts';
import { LibraryScreen } from './screens/library-screen.ts';
import { NowPlaying } from './screens/now-playing.ts';
import { PlaylistsScreen } from './screens/playlists-screen.ts';
import { SearchScreen } from './screens/search-screen.ts';
import { SkinsScreen } from './screens/skins-screen.ts';
import { SkinManager } from './skins/skin-manager.ts';
import { PlayerView } from './ui/player-view.ts';
import { Navigation } from './ui/navigation.ts';
import { SkinBackdrop } from './ui/skin-backdrop.ts';
import { SkinIcon } from './ui/skin-icon.ts';
import { TabMenu } from './ui/tab-menu.ts';
import { MiniPlayer } from './widgets/mini-player.ts';

/**
 * The shell. The active skin's tokens are set on the root view and cascade into every component
 * and modal under it, which is the whole skinning mechanism: no stylesheet names a color.
 */
@Component({
  imports: [
    LanguageSheet,
    LibraryScreen,
    MiniPlayer,
    NowPlaying,
    PlaylistsScreen,
    Pressable,
    SafeAreaProvider,
    SafeAreaView,
    SearchScreen,
    SkinBackdrop,
    SkinIcon,
    SkinsScreen,
    TabMenu,
    Text,
    View,
  ],
  selector: 'app-root',
  template: `
    <safe-area-provider>
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
            @if (navigation.searching()) {
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
    </safe-area-provider>
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
