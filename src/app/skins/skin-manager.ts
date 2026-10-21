import { Service, computed, effect, inject } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { DocumentPicker } from '@ng-native/expo/document-picker';
import { FileSystem } from '@ng-native/expo/file-system';
import { Fonts } from '@ng-native/expo/fonts';
import { BUILTIN_SKINS, CLASSIC_SKIN } from './builtin-skins.ts';
import {
  type ModalTransition,
  type Skin,
  type SkinError,
  parseSkin,
  skinCssVars,
  skinFontSources,
  slugify,
} from './skin.ts';

export type ImportError = SkinError | { readonly code: 'tooLarge' } | { readonly code: 'unreadable'; readonly file: string };

export type ImportResult =
  | { readonly ok: true; readonly skin: Skin; readonly invalid: readonly string[]; readonly replaced: boolean }
  | { readonly ok: false; readonly error: ImportError };

const MAX_SKIN_FILE_BYTES = 4_000_000;
const BUILTIN_BY_ID: ReadonlyMap<string, Skin> = new Map(BUILTIN_SKINS.map((skin) => [skin.id, skin]));

/**
 * The installed skins and the one in use. Imported skins are kept as the documents they were
 * loaded from and re-read on start, so a skin keeps following the built-in it extends.
 */
@Service()
export class SkinManager {
  private readonly store = inject(Storage);
  private readonly picker = inject(DocumentPicker);
  private readonly files = inject(FileSystem);
  private readonly fonts = inject(Fonts);
  /** Font names already handed to the platform, loaded or failed: either way not asked for again. */
  private readonly requestedFonts = new Set<string>();

  private readonly documents = this.store.signal<Record<string, unknown>[]>('skins.installed', []);
  private readonly activeId = this.store.signal<string>('skins.active', CLASSIC_SKIN.id);

  readonly installed = computed<readonly Skin[]>(() =>
    this.documents().flatMap((doc) => {
      const result = parseSkin(doc, BUILTIN_BY_ID, CLASSIC_SKIN);
      return result.ok ? [result.skin] : [];
    }),
  );
  readonly all = computed<readonly Skin[]>(() => [...BUILTIN_SKINS, ...this.installed()]);
  readonly active = computed(() => this.all().find((skin) => skin.id === this.activeId()) ?? CLASSIC_SKIN);
  readonly cssVars = computed(() => skinCssVars(this.active()));
  /** The root's class for the active skin's curve, which `app.ts` declares the token for. */
  readonly easingClass = computed(() => `easing-${this.active().motion.easing}`);
  readonly sheetTransition = computed(() => this.transition(this.active().motion.sheetTransition));
  readonly playerTransition = computed(() => this.transition(this.active().motion.playerTransition));

  constructor() {
    // Text naming a face that is still loading draws in the fallback face, then again once it lands.
    effect(() => {
      const pending = Object.entries(skinFontSources(this.active())).filter(([name]) => !this.requestedFonts.has(name));
      if (!pending.length) return;
      for (const [name] of pending) this.requestedFonts.add(name);
      this.fonts.load(Object.fromEntries(pending)).catch((error: unknown) => {
        console.warn(`Skin "${this.active().name}": a font did not load, so its text uses the fallback face.`, error);
      });
    });
  }

  isBuiltin(id: string): boolean {
    return BUILTIN_BY_ID.has(id);
  }

  apply(id: string): void {
    if (this.all().some((skin) => skin.id === id)) this.activeId.set(id);
  }

  /** Validates and installs a skin document, replacing an installed one with the same id. */
  install(source: unknown): ImportResult {
    const result = parseSkin(source, BUILTIN_BY_ID, CLASSIC_SKIN);
    if (!result.ok) return result;
    const doc = (typeof source === 'string' ? JSON.parse(source) : source) as Record<string, unknown>;
    const id = this.isBuiltin(result.skin.id) ? `user-${result.skin.id}` : result.skin.id;
    const skin: Skin = { ...result.skin, id };
    const replaced = this.documents().some((stored) => this.idOf(stored) === id);
    this.documents.update((docs) => [...docs.filter((stored) => this.idOf(stored) !== id), { ...doc, id }]);
    return { ok: true, skin, invalid: result.invalid, replaced };
  }

  /** Opens the system file picker for a skin file. Null when the picker is canceled. */
  async importFromFile(): Promise<ImportResult | null> {
    const [file] = await this.picker.pick({ type: '*/*', copyToCacheDirectory: true });
    if (!file) return null;
    if (file.size !== undefined && file.size > MAX_SKIN_FILE_BYTES) {
      return { ok: false, error: { code: 'tooLarge' } };
    }
    let text: string;
    try {
      text = await this.files.file(file.uri).text();
    } catch {
      return { ok: false, error: { code: 'unreadable', file: file.name } };
    }
    return this.install(text);
  }

  remove(id: string): void {
    if (this.isBuiltin(id)) return;
    this.documents.update((docs) => docs.filter((doc) => this.idOf(doc) !== id));
    if (this.activeId() === id) this.activeId.set(CLASSIC_SKIN.id);
  }

  private transition(transition: ModalTransition): ModalTransition {
    return this.active().motion.speed > 0 ? transition : 'none';
  }

  private idOf(doc: Record<string, unknown>): string {
    return typeof doc['id'] === 'string' ? slugify(doc['id']) : '';
  }
}
