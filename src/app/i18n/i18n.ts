import { Service, computed, inject } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { Locale } from '@ng-native/expo/locale';
import { type Messages, en, es } from './messages.ts';

export type Language = 'en' | 'es';
/** What the user picked: a language, or whatever the device is set to. */
export type LanguageChoice = Language | 'system';

const MESSAGES: Record<Language, Messages> = { en, es };

/**
 * The language the app speaks, and its strings. It follows the device's preferred languages,
 * taking the first one the app has, unless the user picks one in the app.
 */
@Service()
export class I18n {
  private readonly locale = inject(Locale);
  private readonly store = inject(Storage);

  readonly choice = this.store.signal<LanguageChoice>('app.language', 'system');
  readonly device = computed<Language>(() => {
    for (const { languageCode, languageTag } of this.locale.locales()) {
      const code = (languageCode ?? languageTag.split('-')[0] ?? '').toLowerCase();
      if (code in MESSAGES) return code as Language;
    }
    return 'en';
  });
  readonly language = computed<Language>(() => {
    const choice = this.choice();
    return choice === 'system' ? this.device() : choice;
  });
  readonly messages = computed(() => MESSAGES[this.language()]);

  choose(choice: LanguageChoice): void {
    this.choice.set(choice);
  }
}
