import { Component, input, output } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';

/**
 * A setting that is on or off: its name, what it does, and a switch drawn from the skin's tokens
 * rather than the platform's, so it matches the rest of the app.
 */
@Component({
  selector: 'app-setting-switch',
  imports: [Pressable, Text, View],
  template: `
    <pressable class="row" role="switch" [accessibilityLabel]="label()" [accessibilityState]="{ checked: checked() }" (press)="toggle.emit()">
      <view class="body">
        <text class="label" [numberOfLines]="2">{{ label() }}</text>
        @if (hint()) {
          <text class="hint">{{ hint() }}</text>
        }
      </view>
      <view class="toggle" [class.on]="checked()">
        <view class="knob" />
      </view>
    </pressable>
  `,
  styles: `
    .row {
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-bottom-width: var(--sk-border-width);
      border-color: var(--sk-border);
    }
    .row:active {
      background-color: var(--sk-surface-alt);
    }
    .body {
      flex: 1;
      gap: 2px;
    }
    .label {
      color: var(--sk-text);
      font-family: var(--sk-font);
      font-size: var(--sk-font-md);
      font-weight: var(--sk-weight);
    }
    .hint {
      color: var(--sk-text-muted);
      font-family: var(--sk-font);
      font-size: var(--sk-font-xs);
      font-weight: var(--sk-weight);
    }
    .toggle {
      width: 44px;
      height: 26px;
      padding: 3px;
      border-radius: 13px;
      border-width: var(--sk-border-width);
      border-color: var(--sk-border);
      background-color: var(--sk-surface-alt);
      transition-property: background-color;
      transition-duration: var(--sk-duration-fast);
      transition-timing-function: var(--sk-easing);
    }
    .toggle.on {
      align-items: flex-end;
      background-color: var(--sk-accent);
    }
    .knob {
      width: 18px;
      height: 18px;
      border-radius: 9px;
      background-color: var(--sk-text);
    }
    .on .knob {
      background-color: var(--sk-background);
    }
  `,
})
export class SettingSwitch {
  readonly label = input.required<string>();
  readonly hint = input('');
  readonly checked = input(false);
  readonly toggle = output<void>();
}
