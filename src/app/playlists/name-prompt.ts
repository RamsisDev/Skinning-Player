import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { TextInput, View } from '@ng-native/components';
import { I18n } from '../i18n/i18n.ts';
import { SkinManager } from '../skins/skin-manager.ts';
import { Sheet } from '../shared/sheet.ts';
import { SkinButton } from '../skins/skin-button.ts';

/** Asks for a name. Android has no system text prompt, so this is the app's own. */
@Component({
  selector: 'app-name-prompt',
  imports: [Sheet, SkinButton, TextInput, View],
  template: `
    <app-sheet [open]="open()" [title]="title()" placement="top" (close)="close.emit()">
      <text-input
        class="input"
        [placeholder]="placeholder() ?? t().namePrompt.placeholder"
        [placeholderTextColor]="colors().textMuted"
        [cursorColor]="colors().accent"
        [autoFocus]="true"
        [maxLength]="60"
        returnKeyType="done"
        [(value)]="name"
        (submitEditing)="confirm()"
      />
      <view class="actions">
        <app-skin-button [label]="t().common.cancel" variant="ghost" (press)="close.emit()" />
        <app-skin-button [label]="confirmLabel() ?? t().namePrompt.save" variant="primary" [disabled]="!name().trim()" (press)="confirm()" />
      </view>
    </app-sheet>
  `,
  styles: `
    .input {
      height: 48px;
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
    .actions {
      flex-direction: row;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class NamePrompt {
  private readonly skins = inject(SkinManager);
  protected readonly t = inject(I18n).messages;

  readonly open = input(false);
  readonly title = input.required<string>();
  readonly initial = input('');
  readonly placeholder = input<string>();
  readonly confirmLabel = input<string>();
  readonly submit = output<string>();
  readonly close = output<void>();

  protected readonly name = linkedSignal({
    source: () => [this.open(), this.initial()] as const,
    computation: ([, initial]) => initial,
  });
  protected readonly colors = computed(() => this.skins.active().colors);

  protected confirm(): void {
    const name = this.name().trim();
    if (name) this.submit.emit(name);
  }
}
