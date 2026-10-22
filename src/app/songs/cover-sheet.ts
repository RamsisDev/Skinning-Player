import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { Dialogs } from '@ng-native/device';
import { Covers } from '../library/covers.ts';
import { type Track } from '../library/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { CoverArt } from '../library/cover-art.ts';
import { Sheet } from '../shared/sheet.ts';
import { SkinButton } from '../skins/skin-button.ts';

/** Sets a track's cover from an image on the phone, or goes back to the file's own art. */
@Component({
  selector: 'app-cover-sheet',
  imports: [CoverArt, Sheet, SkinButton, Text, View],
  template: `
    <app-sheet [open]="!!track()" [title]="heading()" (close)="close.emit()">
      <view class="body">
        <app-cover-art [track]="track()" [size]="200" />
        <text class="source">{{ source() }}</text>
      </view>
      <view class="actions">
        @if (custom()) {
          <app-skin-button [label]="t().cover.remove" icon="remove" [disabled]="busy()" (press)="remove()" />
        }
        <app-skin-button
          [label]="custom() ? t().cover.change : t().cover.choose"
          icon="cover"
          variant="primary"
          [disabled]="busy()"
          (press)="choose()"
        />
      </view>
    </app-sheet>
  `,
  styles: `
    .body {
      align-items: center;
      gap: 10px;
      padding: 4px 0 8px;
    }
    .source {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight);
      text-align: center;
    }
    .actions {
      flex-direction: row;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class CoverSheet {
  private readonly covers = inject(Covers);
  private readonly dialogs = inject(Dialogs);
  protected readonly t = inject(I18n).messages;

  /** The track whose cover is being set; the sheet is open while there is one. */
  readonly track = input<Track | null>(null);
  readonly close = output<void>();

  protected readonly busy = signal(false);
  protected readonly heading = computed(() => this.t().cover.heading(this.track()?.title ?? ''));
  protected readonly custom = computed(() => {
    const track = this.track();
    return !!track && this.covers.hasCustom(track.id);
  });
  protected readonly source = computed(() => {
    const track = this.track();
    if (!track) return '';
    const t = this.t().cover;
    if (this.custom()) return t.custom;
    return this.covers.uriOf(track.id) ? t.embedded : t.none;
  });

  protected async choose(): Promise<void> {
    const track = this.track();
    if (!track) return;
    this.busy.set(true);
    try {
      const result = await this.covers.choose(track);
      if (result?.ok) {
        this.close.emit();
        this.dialogs.notify(this.t().cover.changed);
      } else if (result) {
        const t = this.t();
        const { error } = result;
        const message = error.code === 'tooLarge' ? t.cover.tooLarge : t.common.couldNotRead(error.file);
        await this.dialogs.tell(t.cover.failed, message, t.common.ok);
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected remove(): void {
    const track = this.track();
    if (track) this.covers.removeCustom(track);
  }
}
