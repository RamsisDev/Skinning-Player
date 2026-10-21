import { Component, computed, inject } from '@angular/core';
import { ActivityIndicator, Text, View } from '@ng-native/components';
import { DeepLinks } from '@ng-native/device';
import { MusicLibrary } from '../core/music-library.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { SkinButton } from './skin-button.ts';

/** What to show in place of the songs while the library is not readable yet. */
@Component({
  selector: 'app-library-status',
  imports: [ActivityIndicator, SkinButton, Text, View],
  template: `
    <view class="panel">
      @switch (library.status()) {
        @case ('blocked') {
          <text class="title">{{ t().status.blockedTitle }}</text>
          <text class="body">{{ t().status.blockedBody }}</text>
          <app-skin-button [label]="t().status.openSettings" variant="primary" (press)="openSettings()" />
          <app-skin-button [label]="t().status.tryAgain" icon="refresh" variant="ghost" (press)="library.scan()" />
        }
        @case ('denied') {
          <text class="title">{{ t().status.deniedTitle }}</text>
          <text class="body">{{ t().status.deniedBody }}</text>
          <app-skin-button [label]="t().status.allowAccess" variant="primary" (press)="library.scan()" />
        }
        @case ('error') {
          <text class="title">{{ t().status.errorTitle }}</text>
          <text class="body">{{ library.error() }}</text>
          <app-skin-button [label]="t().status.tryAgain" icon="refresh" variant="primary" (press)="library.scan()" />
        }
        @default {
          <view class="loading" role="progressbar" [accessibilityLabel]="heading() + ', ' + progress()">
            <activity-indicator size="large" [color]="accent()" />
            <text class="title">{{ heading() }}</text>
            <text class="count">{{ progress() }}</text>
            <text class="body">{{ t().status.hint }}</text>
          </view>
        }
      }
    </view>
  `,
  styles: `
    .panel {
      flex: 1;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 32px;
    }
    .title {
      color: var(--sk-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-lg);
      font-weight: var(--sk-weight-bold);
      text-align: center;
    }
    .loading {
      align-items: center;
      gap: 14px;
    }
    .count {
      color: var(--sk-accent);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-display-weight);
      text-align: center;
    }
    .body {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight);
      text-align: center;
    }
  `,
})
export class LibraryStatus {
  protected readonly library = inject(MusicLibrary);
  private readonly deepLinks = inject(DeepLinks);
  private readonly skins = inject(SkinManager);
  protected readonly t = inject(I18n).messages;
  protected readonly accent = computed(() => this.skins.active().colors.accent);
  protected readonly heading = computed(() =>
    this.library.step() === 'indexing' ? this.t().status.indexing : this.t().status.reading,
  );
  protected readonly progress = computed(() => {
    const t = this.t().status;
    const found = this.library.found();
    if (this.library.step() === 'indexing') return t.sorting(found);
    return found ? t.found(found) : t.looking;
  });

  protected openSettings(): void {
    this.deepLinks.openSettings();
  }
}
