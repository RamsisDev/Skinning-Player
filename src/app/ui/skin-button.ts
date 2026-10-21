import { Component, computed, input, output } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { type IconSlot } from '../skins/skin.ts';
import { SkinIcon } from './skin-icon.ts';

export type ButtonVariant = 'normal' | 'primary' | 'ghost';
export type ButtonSize = 'small' | 'medium' | 'large';

const ICON_SIZES: Record<ButtonSize, number> = { small: 18, medium: 22, large: 32 };

/**
 * Every button in the app. Its whole look comes from the skin's `--sk-button-*` and
 * `--sk-primary-*` tokens; `label` is always the accessibility label, and is drawn unless the
 * button is icon-only.
 */
@Component({
  selector: 'app-skin-button',
  imports: [Pressable, SkinIcon, Text],
  template: `
    <pressable
      class="button"
      [class.primary]="variant() === 'primary'"
      [class.ghost]="variant() === 'ghost'"
      [class.small]="size() === 'small'"
      [class.large]="size() === 'large'"
      [class.icon-only]="iconOnly()"
      [class.active]="active()"
      [class.disabled]="disabled()"
      [disabled]="disabled()"
      accessibilityRole="button"
      [accessibilityLabel]="label()"
      [accessibilityState]="{ disabled: disabled(), selected: active() }"
      (press)="press.emit()"
    >
      @if (icon(); as slot) {
        <app-skin-icon [slot]="slot" [size]="iconSize()" [color]="iconColor()" />
      }
      @if (!iconOnly()) {
        <text class="label" [class.primary-label]="variant() === 'primary'" [numberOfLines]="1">{{ label() }}</text>
      }
    </pressable>
  `,
  styles: `
    .button {
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 44px;
      padding: 8px 16px;
      border-radius: var(--sk-button-radius);
      border-width: var(--sk-border-width);
      border-color: var(--sk-button-border);
      background-color: var(--sk-button-background);
      transition-property: opacity, transform;
      transition-duration: var(--sk-duration-fast);
      transition-timing-function: var(--sk-easing);
    }
    .button:active {
      opacity: var(--sk-press-opacity);
      transform: scale(var(--sk-press-scale));
    }
    .primary {
      border-color: var(--sk-primary-background);
      background-color: var(--sk-primary-background);
    }
    .ghost {
      border-color: transparent;
      background-color: transparent;
    }
    .active {
      border-color: var(--sk-accent);
    }
    .disabled {
      opacity: 0.4;
    }
    .small {
      min-height: 34px;
      padding: 4px 10px;
    }
    .large {
      min-height: 68px;
      padding: 12px 20px;
    }
    .icon-only {
      width: 44px;
      padding: 0;
    }
    .icon-only.small {
      width: 34px;
    }
    .icon-only.large {
      width: 68px;
    }
    .label {
      color: var(--sk-button-text);
      font-family: var(--sk-font-medium);
      font-size: var(--sk-font-sm);
      font-weight: var(--sk-weight-medium);
    }
    .primary-label {
      color: var(--sk-primary-text);
    }
  `,
})
export class SkinButton {
  readonly label = input.required<string>();
  readonly icon = input<IconSlot | null>(null);
  readonly variant = input<ButtonVariant>('normal');
  readonly size = input<ButtonSize>('medium');
  /** Draws only the icon; the label is still read out. */
  readonly iconOnly = input(false);
  /** A toggle that is on, such as shuffle. */
  readonly active = input(false);
  readonly disabled = input(false);
  readonly press = output<void>();

  protected readonly iconSize = computed(() => ICON_SIZES[this.size()]);
  protected readonly iconColor = computed(() =>
    this.variant() === 'primary'
      ? 'var(--sk-primary-text)'
      : this.active()
        ? 'var(--sk-accent)'
        : 'var(--sk-button-text)',
  );
}
