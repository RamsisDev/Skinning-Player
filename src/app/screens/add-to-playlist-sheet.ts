import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { Pressable, ScrollView, Text, TextInput, View } from '@ng-native/components';
import { Dialogs } from '@ng-native/device';
import { Playlists } from '../core/playlists.ts';
import { type Track } from '../core/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { Sheet } from '../ui/sheet.ts';
import { SkinButton } from '../ui/skin-button.ts';
import { SkinIcon } from '../ui/skin-icon.ts';

/** Puts one track into an existing playlist, or into a new one named on the spot. */
@Component({
  selector: 'app-add-to-playlist-sheet',
  imports: [Pressable, ScrollView, Sheet, SkinButton, SkinIcon, Text, TextInput, View],
  template: `
    <app-sheet [open]="!!track()" [title]="heading()" placement="top" (close)="close.emit()">
      <view class="create">
        <text-input
          class="input"
          [placeholder]="t().addSheet.placeholder"
          [placeholderTextColor]="colors().textMuted"
          [cursorColor]="colors().accent"
          returnKeyType="done"
          [(value)]="name"
          (submitEditing)="createWithTrack()"
        />
        <app-skin-button [label]="t().common.create" icon="add" variant="primary" [disabled]="!name().trim()" (press)="createWithTrack()" />
      </view>
      <scroll-view class="list" keyboardShouldPersistTaps="handled">
        @for (playlist of playlists.all(); track playlist.id) {
          <pressable class="row" accessibilityRole="button" [accessibilityLabel]="t().playlists.addTo(playlist.name)" (press)="addTo(playlist.id, playlist.name)">
            <app-skin-icon slot="playlists" [size]="20" color="var(--sk-accent)" />
            <text class="name" [numberOfLines]="1">{{ playlist.name }}</text>
            <text class="count">{{ playlist.trackIds.length }}</text>
          </pressable>
        } @empty {
          <text class="empty">{{ t().addSheet.none }}</text>
        }
      </scroll-view>
    </app-sheet>
  `,
  styles: `
    .create {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .input {
      flex: 1;
      height: 44px;
      padding: 0 12px;
      border-radius: var(--sk-button-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: var(--sk-background);
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
    .list {
      max-height: 320px;
    }
    .row {
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 12px 8px;
      border-bottom-width: var(--sk-border-width);
      border-color: var(--sk-border);
    }
    .row:active {
      background-color: var(--sk-surface-alt);
    }
    .name {
      flex: 1;
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
    .count {
      color: var(--sk-text-muted);
      font-family: var(--sk-display-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-display-weight);
    }
    .empty {
      padding: 12px 0;
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight);
    }
  `,
})
export class AddToPlaylistSheet {
  protected readonly playlists = inject(Playlists);
  private readonly dialogs = inject(Dialogs);
  private readonly skins = inject(SkinManager);
  protected readonly t = inject(I18n).messages;

  /** The track to add; the sheet is open while there is one. */
  readonly track = input<Track | null>(null);
  readonly close = output<void>();

  protected readonly name = linkedSignal({ source: () => this.track(), computation: () => '' });
  protected readonly colors = computed(() => this.skins.active().colors);
  protected readonly heading = computed(() => this.t().addSheet.heading(this.track()?.title ?? ''));

  protected addTo(playlistId: string, playlistName: string): void {
    const track = this.track();
    if (!track) return;
    const added = this.playlists.addTracks(playlistId, [track.id]);
    const t = this.t().addSheet;
    this.dialogs.notify(added ? t.addedTo(playlistName) : t.alreadyIn(playlistName));
    this.close.emit();
  }

  protected createWithTrack(): void {
    const track = this.track();
    const name = this.name().trim();
    if (!track || !name) return;
    this.playlists.create(name, [track.id]);
    this.dialogs.notify(this.t().addSheet.created(name));
    this.close.emit();
  }
}
