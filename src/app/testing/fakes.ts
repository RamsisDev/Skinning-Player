import { type Provider, signal } from '@angular/core';
import {
  type DeepLinkSource,
  DeepLinks,
  Dialogs,
  HardwareBack,
  type HardwareBackSource,
  type NativeDialogs,
} from '@ng-native/device';
import { Storage } from '@ng-native/expo/async-storage';
import { DocumentPicker, type PickedDocument } from '@ng-native/expo/document-picker';
import { FileSystem, type NativeFile } from '@ng-native/expo/file-system';
import { Locale, type NativeLocale } from '@ng-native/expo/locale';
import { MediaLibrary } from '@ng-native/expo/media-library';
import { type PlayerState } from '@ng-native/expo/player';
import { Store } from '@ng-native/expo/store';
import { settle } from '@ng-native/testing';
import { AUDIO_ENGINE, type AudioEngine } from '../core/audio-engine.ts';
import { type Track, trackFromFile } from '../core/track.ts';

/** A key-value store over a map, holding JSON text as the device would. */
export function memoryStorage(disk = new Map<string, string>()): Provider {
  const store = new Store({
    get: async (key) => disk.get(key) ?? null,
    set: async (key, value) => void disk.set(key, value),
    remove: async (key) => void disk.delete(key),
  });
  return { provide: Storage, useValue: store };
}

/**
 * Files on a map of uri to bytes. The cache is `file:///cache/`, the documents
 * `file:///documents/`, and any uri can be read back with `fileAt`.
 */
export function memoryFiles(disk = new Map<string, Uint8Array>()): Provider {
  const fileAt = (uri: string): NativeFile => {
    const read = (): Uint8Array => {
      const bytes = disk.get(uri);
      if (!bytes) throw new Error(`No file at ${uri}`);
      return bytes;
    };
    return {
      uri,
      get exists() {
        return disk.has(uri);
      },
      get size() {
        return disk.get(uri)?.length ?? 0;
      },
      create: () => void (disk.has(uri) || disk.set(uri, new Uint8Array())),
      write: (content) => void disk.set(uri, typeof content === 'string' ? new TextEncoder().encode(content) : content),
      text: async () => new TextDecoder().decode(read()),
      textSync: () => new TextDecoder().decode(read()),
      bytes: async () => read(),
      delete: () => void disk.delete(uri),
    };
  };
  const source = {
    cacheDirectory: { root: 'file:///cache/' },
    documentDirectory: { root: 'file:///documents/' },
    file: (directory: object, name: string) => fileAt(`${(directory as { root: string }).root}${name}`),
    fileAt,
  };
  return { provide: FileSystem.SOURCE, useValue: source };
}

/** A device whose preferred languages are `tags`, most preferred first, such as `['es-MX']`. */
export function fakeLocale(tags: readonly string[]): Provider {
  const source: NativeLocale = {
    locales: () =>
      tags.map((languageTag) => ({
        languageTag,
        languageCode: languageTag.split('-')[0] ?? null,
        regionCode: languageTag.split('-')[1] ?? null,
        textDirection: 'ltr',
        measurementSystem: 'metric',
      })),
    calendars: () => [],
    onChange: () => () => {},
  };
  return { provide: Locale.SOURCE, useValue: source };
}

/** A document picker that answers each pick with the next of `picks`, or cancels when none are left. */
export function fakeDocumentPicker(picks: PickedDocument[]): Provider {
  return {
    provide: DocumentPicker.SOURCE,
    useValue: {
      getDocumentAsync: async () => {
        const next = picks.shift();
        return next ? { canceled: false, assets: [next] } : { canceled: true, assets: null };
      },
    },
  };
}

export interface FakeEngine extends AudioEngine {
  readonly loaded: string[];
  /** Plays the current source to its end. */
  finish(): void;
  /** Reports that the current source cannot be decoded, as native does for a damaged file. */
  fail(): void;
}

/** A player that reports what native would, without playing anything. */
export function fakeEngine(): FakeEngine {
  const state = signal<PlayerState>({
    playing: false,
    status: 'idle',
    currentTime: 0,
    duration: 0,
    muted: false,
    volume: 1,
    ended: false,
  });
  const loaded: string[] = [];
  return {
    state: state.asReadonly(),
    loaded,
    load(uri) {
      loaded.push(uri);
      state.set({ ...state(), status: 'readyToPlay', playing: true, ended: false, currentTime: 0, duration: 200 });
    },
    play: () => state.set({ ...state(), playing: true, ended: false }),
    pause: () => state.set({ ...state(), playing: false }),
    seekTo: (seconds) => state.set({ ...state(), currentTime: seconds }),
    finish: () => state.set({ ...state(), playing: false, ended: true, currentTime: state().duration }),
    fail: () => state.set({ ...state(), status: 'error', playing: false, currentTime: 0, duration: 0 }),
  };
}

export function engineProvider(engine: FakeEngine): Provider {
  return { provide: AUDIO_ENGINE, useValue: engine };
}

/** What the user answers to the system's music permission dialog. */
export type AccessAnswer = 'grant' | 'deny' | 'block';

export interface FakeMediaLibraryOptions {
  /** One answer per permission request, in order; requests past the end are granted. */
  readonly answers?: AccessAnswer[];
  /** One error message per scan, in order; scans past the end succeed. */
  readonly scanErrors?: string[];
  /** Ids whose file cannot be resolved to a playable uri. */
  readonly unplayable?: readonly string[];
  /** Awaited before a query answers, given the offset it reads from, to hold a scan mid-way. */
  readonly beforePage?: (offset: number) => Promise<void> | void;
}

/**
 * A media store holding the given audio files, whose permission is not granted until asked for.
 * `files` are `[id, filename, seconds]`, read again on every scan, so a test can change the array
 * between scans to stand for songs added to or removed from the device.
 */
export function fakeMediaLibrary(
  files: readonly (readonly [string, string | null, number | null])[],
  options: FakeMediaLibraryOptions = {},
): Provider {
  const answers = [...(options.answers ?? [])];
  const scanErrors = [...(options.scanErrors ?? [])];
  const unplayable = new Set(options.unplayable ?? []);
  let state: 'undetermined' | 'granted' | 'denied' | 'blocked' = 'undetermined';
  const answer = () => ({
    status: state === 'blocked' ? 'denied' : state,
    granted: state === 'granted',
    canAskAgain: state !== 'blocked',
    expires: 'never',
  });
  class Query {
    private from = 0;
    private count = Infinity;
    eq(): Query {
      return this;
    }
    limit(count: number): Query {
      this.count = count;
      return this;
    }
    offset(from: number): Query {
      this.from = from;
      return this;
    }
    async exeForMetadata() {
      if (this.from === 0) {
        const error = scanErrors.shift();
        if (error) throw new Error(error);
      }
      await options.beforePage?.(this.from);
      return files.slice(this.from, this.from + this.count).map(([id, filename, seconds]) => ({
        id,
        filename,
        duration: seconds === null ? null : seconds * 1000,
        mediaType: 'audio',
      }));
    }
  }
  class Asset {
    constructor(readonly id: string) {}
    async getUri(): Promise<string> {
      if (unplayable.has(this.id)) throw new Error(`No file for ${this.id}`);
      return `file:///music/${this.id}.mp3`;
    }
  }
  const source = {
    getPermissionsAsync: async () => answer(),
    requestPermissionsAsync: async () => {
      const next = answers.shift() ?? 'grant';
      state = next === 'grant' ? 'granted' : next === 'deny' ? 'denied' : 'blocked';
      return answer();
    },
    presentPermissionsPicker: async () => {},
    addListener: () => ({ remove() {} }),
    Asset,
    Album: {},
    Query,
  };
  return { provide: MediaLibrary.SOURCE, useValue: source as never };
}

export interface ShownDialog {
  readonly title: string;
  readonly message: string | undefined;
  /** The button labels, in the order the platform was given them. */
  readonly buttons: readonly string[];
}

export interface FakeDialogs {
  readonly provider: Provider;
  /** Every dialog put up, oldest first, answered or not. */
  readonly shown: ShownDialog[];
  /** Every toast shown, oldest first. */
  readonly toasts: string[];
  /** The dialog waiting for an answer, if there is one. */
  readonly open: ShownDialog | null;
  /** Presses the button with this label on the open dialog, and waits for the app to react to it. */
  answer(label: string): Promise<void>;
}

/**
 * Android's dialogs and toasts, held open until the test answers them. `choose` arrives as an
 * alert with one button per choice, as it does on Android.
 */
export function fakeDialogs(): FakeDialogs {
  type Button = { text: string; onPress?: () => void };
  const shown: ShownDialog[] = [];
  const toasts: string[] = [];
  const pending: { dialog: ShownDialog; buttons: readonly Button[] }[] = [];
  const source: NativeDialogs = {
    platform: 'android',
    alert: (title, message, buttons) => {
      const dialog = { title, message, buttons: buttons.map((button) => button.text) };
      shown.push(dialog);
      pending.push({ dialog, buttons });
    },
    toast: (message) => void toasts.push(message),
  };
  return {
    provider: { provide: Dialogs.SOURCE, useValue: source },
    shown,
    toasts,
    get open() {
      return pending.at(-1)?.dialog ?? null;
    },
    async answer(label) {
      const top = pending.at(-1);
      if (!top) throw new Error(`No dialog is open to press "${label}" on.`);
      const button = top.buttons.find((candidate) => candidate.text === label);
      if (!button) throw new Error(`The dialog "${top.dialog.title}" has no "${label}" button: ${top.dialog.buttons.join(', ')}.`);
      pending.pop();
      button.onPress?.();
      // One pass resumes the code awaiting the dialog; the next renders what it changed.
      await settle();
      await settle();
    },
  };
}

export interface FakeDeepLinks {
  readonly provider: Provider;
  /** How many times the app's page in the system settings was opened. */
  readonly settingsOpened: number;
}

export function fakeDeepLinks(): FakeDeepLinks {
  let settingsOpened = 0;
  const source: DeepLinkSource = {
    launchUrl: async () => null,
    subscribe: () => () => {},
    open: () => {},
    openSettings: () => void settingsOpened++,
  };
  return {
    provider: { provide: DeepLinks.SOURCE, useValue: source },
    get settingsOpened() {
      return settingsOpened;
    },
  };
}

export interface FakeHardwareBack {
  readonly provider: Provider;
  /** Presses Android's back button. Answers whether the app handled it rather than leaving. */
  press(): Promise<boolean>;
}

export function fakeHardwareBack(): FakeHardwareBack {
  const listeners: (() => boolean)[] = [];
  const source: HardwareBackSource = {
    subscribe: (listener) => {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  return {
    provider: { provide: HardwareBack.SOURCE, useValue: source },
    async press() {
      const handled = [...listeners].reverse().some((listener) => listener());
      await settle();
      return handled;
    },
  };
}

export const TRACKS: readonly Track[] = [
  trackFromFile('a', 'Artist A - Alpha.mp3', 180),
  trackFromFile('b', 'Artist B - Bravo.mp3', 200),
  trackFromFile('c', 'Charlie.mp3', 220),
];
