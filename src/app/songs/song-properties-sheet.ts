import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { type SongDetails, SongFiles } from './song-details.ts';
import { type Track, formatTime } from '../library/track.ts';
import { I18n } from '../i18n/i18n.ts';
import { Sheet } from '../shared/sheet.ts';

/** A song's file: where it is, its format, size, length, bitrate, sample rate and ReplayGain. */
@Component({
  selector: 'app-song-properties-sheet',
  imports: [ScrollView, Sheet, Text, View],
  template: `
    <app-sheet [open]="!!track()" [title]="t().properties.title" (close)="close.emit()">
      <scroll-view class="list">
        <text class="song" [numberOfLines]="2">{{ track()?.title }}</text>
        @for (row of rows(); track row.label) {
          <view class="row">
            <text class="label">{{ row.label }}</text>
            <text class="value" [selectable]="true">{{ row.value }}</text>
          </view>
        }
      </scroll-view>
    </app-sheet>
  `,
  styles: `
    .list {
      flex-grow: 0;
    }
    .song {
      padding-bottom: 8px;
      color: var(--sk-accent);
      font-family: var(--sk-font-bold);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight-bold);
    }
    .row {
      gap: 2px;
      padding: 8px 0;
      border-bottom-width: var(--sk-border-width);
      border-color: var(--sk-border);
    }
    .label {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
      text-transform: uppercase;
    }
    .value {
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
  `,
})
export class SongPropertiesSheet {
  private readonly songFiles = inject(SongFiles);
  protected readonly t = inject(I18n).messages;

  /** The song to describe; null keeps the sheet closed. */
  readonly track = input<Track | null>(null);
  readonly close = output<void>();

  /** What the file says, once read; null while it is read. */
  private readonly details = signal<SongDetails | null>(null);

  protected readonly rows = computed(() => {
    const track = this.track();
    if (!track) return [];
    const t = this.t().properties;
    const details = this.details();
    const audio = details?.audio;
    const reading = t.reading;
    const extension = /\.([a-z0-9]+)$/i.exec(track.filename)?.[1]?.toUpperCase() ?? t.unknown;
    const rows = [
      { label: t.path, value: details?.path ?? (track.path || reading) },
      { label: t.format, value: audio ? this.formatOf(audio.format, audio.bitDepth) : details ? extension : reading },
      { label: t.size, value: details ? (details.size ? this.t().settings.size(details.size) : t.unknown) : reading },
      { label: t.duration, value: formatTime(audio?.duration || track.duration) },
      { label: t.bitrate, value: audio?.bitrate ? t.kbps(audio.bitrate) : details ? t.unknown : reading },
      { label: t.sampleRate, value: audio?.sampleRate ? t.hz(audio.sampleRate) : details ? t.unknown : reading },
    ];
    const gain = details?.replayGain;
    if (gain?.track !== undefined) rows.push({ label: t.replayGainTrack, value: t.db(gain.track) });
    if (gain?.album !== undefined) rows.push({ label: t.replayGainAlbum, value: t.db(gain.album) });
    return rows;
  });

  constructor() {
    effect(() => {
      const track = this.track();
      this.details.set(null);
      if (!track) return;
      void this.songFiles.details(track).then(
        (details) => this.track() === track && this.details.set(details),
        () => this.track() === track && this.details.set({ path: track.path, size: track.size, audio: null, replayGain: null }),
      );
    });
  }

  private formatOf(format: string, bitDepth: number | undefined): string {
    return bitDepth ? this.t().properties.formatDepth(format, bitDepth) : format;
  }
}
