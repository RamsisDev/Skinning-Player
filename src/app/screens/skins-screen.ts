import { Component, computed, inject, signal } from '@angular/core';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { Dialogs } from '@ng-native/device';
import { I18n } from '../i18n/i18n.ts';
import { type Skin, skinCssVars } from '../skins/skin.ts';
import { type ImportError, SkinManager } from '../skins/skin-manager.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SkinIcon } from '../ui/skin-icon.ts';

/**
 * The installed skins. Each card sets its own skin's tokens, so it previews that skin with the
 * same stylesheets the app uses, whatever skin is active.
 */
@Component({
  selector: 'app-skins-screen',
  imports: [Pressable, ScrollView, SkinButton, SkinIcon, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <scroll-view class="fill" [contentContainerStyle]="{ padding: 12, gap: 12 }">
      <view class="intro">
        <text class="intro-title">{{ t().skins.title }}</text>
        <text class="intro-body">{{ t().skins.intro }}</text>
        <app-skin-button [label]="t().skins.load" icon="import" variant="primary" [disabled]="importing()" (press)="importSkin()" />
      </view>

      @for (preview of previews(); track preview.skin.id) {
        <pressable
          class="card"
          [style]="preview.vars"
          accessibilityRole="button"
          [accessibilityLabel]="t().skins.use(preview.skin.name)"
          [accessibilityState]="{ selected: preview.skin.id === active().id }"
          (press)="skins.apply(preview.skin.id)"
        >
          <view class="card-top">
            <view class="lcd">
              <text class="lcd-time">01:23</text>
              <text class="lcd-text" [numberOfLines]="1">{{ preview.skin.name }}</text>
            </view>
            <view class="swatches">
              <view class="swatch" [style.background-color]="preview.skin.colors.accent"></view>
              <view class="swatch" [style.background-color]="preview.skin.colors.primaryBackground"></view>
              <view class="swatch" [style.background-color]="preview.skin.colors.surface"></view>
              <view class="swatch" [style.background-color]="preview.skin.colors.menuBackground"></view>
            </view>
          </view>
          <view class="card-body">
            <text class="name">{{ preview.skin.name }}</text>
            <text class="meta" [numberOfLines]="2">{{ describe(preview.skin) }}</text>
          </view>
          <view class="card-actions">
            <view class="sample">
              <app-skin-icon slot="previous" [size]="18" [skin]="preview.skin" />
            </view>
            <view class="sample primary">
              <app-skin-icon slot="play" [size]="18" color="var(--sk-primary-text)" [skin]="preview.skin" />
            </view>
            <view class="sample">
              <app-skin-icon slot="next" [size]="18" [skin]="preview.skin" />
            </view>
            <view class="spacer"></view>
            @if (preview.skin.id === active().id) {
              <view class="badge">
                <app-skin-icon slot="check" [size]="16" color="var(--sk-accent-text)" />
                <text class="badge-text">{{ t().skins.inUse }}</text>
              </view>
            }
            @if (!skins.isBuiltin(preview.skin.id)) {
              <app-skin-button
                [label]="t().skins.remove(preview.skin.name)"
                icon="remove"
                variant="ghost"
                size="small"
                [iconOnly]="true"
                (press)="remove(preview.skin)"
              />
            }
          </view>
        </pressable>
      }
    </scroll-view>
  `,
  styles: `
    .fill {
      flex: 1;
    }
    .intro {
      gap: 8px;
      padding: 14px;
      border-radius: var(--sk-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: var(--sk-surface);
    }
    .intro-title {
      color: var(--sk-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-lg);
      font-weight: var(--sk-weight-bold);
    }
    .intro-body {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight);
    }
    .card {
      gap: 10px;
      padding: 12px;
      border-radius: var(--sk-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: var(--sk-background);
      transition-property: opacity, transform;
      transition-duration: var(--sk-duration-fast);
      transition-timing-function: var(--sk-easing);
    }
    .card:active {
      opacity: var(--sk-press-opacity);
      transform: scale(var(--sk-press-scale));
    }
    .card-top {
      flex-direction: row;
      align-items: stretch;
      gap: 10px;
    }
    .lcd {
      flex: 1;
      padding: 8px 10px;
      border-radius: var(--sk-widget-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-widget-border);
      background-color: var(--sk-display-background);
    }
    .lcd-time {
      color: var(--sk-display-text);
      font-family: var(--sk-display-font-bold);
      font-size: var(--sk-font-xl);
      font-weight: var(--sk-display-weight-bold);
    }
    .lcd-text {
      color: var(--sk-display-text);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-display-weight);
    }
    .swatches {
      width: 52px;
      flex-wrap: wrap;
      flex-direction: row;
      gap: 4px;
      align-content: center;
    }
    .swatch {
      width: 24px;
      height: 24px;
      border-radius: 12px;
      border-width: 1px;
      border-color: var(--sk-border);
    }
    .card-body {
      gap: 2px;
    }
    .name {
      color: var(--sk-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight-bold);
    }
    .meta {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
    }
    .card-actions {
      flex-direction: row;
      align-items: center;
      gap: 6px;
    }
    .sample {
      width: 36px;
      height: 36px;
      align-items: center;
      justify-content: center;
      border-radius: var(--sk-button-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-button-border);
      background-color: var(--sk-button-background);
    }
    .sample.primary {
      border-color: var(--sk-primary-background);
      background-color: var(--sk-primary-background);
    }
    .spacer {
      flex: 1;
    }
    .badge {
      flex-direction: row;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 12px;
      background-color: var(--sk-accent);
    }
    .badge-text {
      color: var(--sk-accent-text);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight-bold);
    }
  `,
})
export class SkinsScreen {
  protected readonly skins = inject(SkinManager);
  private readonly dialogs = inject(Dialogs);
  protected readonly t = inject(I18n).messages;

  protected readonly importing = signal(false);
  protected readonly active = this.skins.active;
  protected readonly previews = computed(() =>
    this.skins.all().map((skin) => ({ skin, vars: skinCssVars(skin) })),
  );

  protected describe(skin: Skin): string {
    const t = this.t().skins;
    const description = (this.skins.isBuiltin(skin.id) && t.descriptions[skin.id]) || skin.description;
    const by = skin.author ? t.by(skin.author) : '';
    return [description, by].filter(Boolean).join(' · ') || t.custom;
  }

  protected async importSkin(): Promise<void> {
    this.importing.set(true);
    try {
      const result = await this.skins.importFromFile();
      if (!result) return;
      const t = this.t();
      if (!result.ok) {
        await this.dialogs.tell(t.skins.loadFailed, this.explain(result.error), t.common.ok);
        return;
      }
      this.skins.apply(result.skin.id);
      const notes = result.invalid.length
        ? `\n\n${t.skins.invalid(result.invalid.length)}\n${result.invalid.slice(0, 6).map(t.skins.ignored).join('\n')}`
        : '';
      await this.dialogs.tell(
        t.skins.installed(result.skin.name, result.replaced),
        `${t.skins.nowInUse}${notes}`,
        t.common.ok,
      );
    } finally {
      this.importing.set(false);
    }
  }

  protected async remove(skin: Skin): Promise<void> {
    const t = this.t();
    const confirmed = await this.dialogs.confirm(t.skins.confirmRemove(skin.name), {
      destructive: true,
      confirm: t.common.ok,
      cancel: t.common.cancel,
    });
    if (confirmed) this.skins.remove(skin.id);
  }

  private explain(error: ImportError): string {
    const t = this.t();
    switch (error.code) {
      case 'invalidJson':
        return t.skins.invalidJson;
      case 'notObject':
        return t.skins.notObject;
      case 'unsupportedFormat':
        return t.skins.unsupportedFormat(error.found, error.expected);
      case 'noName':
        return t.skins.noName;
      case 'tooLarge':
        return t.skins.tooLarge;
      case 'unreadable':
        return t.common.couldNotRead(error.file);
    }
  }
}
