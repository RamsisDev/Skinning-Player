import { type Provider } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { type PickedDocument } from '@ng-native/expo/document-picker';
import { render, screen, userEvent, waitFor, within } from '@ng-native/testing';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { App } from '../app.ts';
import {
  engineProvider,
  fakeDialogs,
  fakeDocumentPicker,
  fakeEngine,
  memoryFiles,
  memoryStorage,
} from '../testing/fakes.ts';

const skinsFolder = new URL('../../../skins/', import.meta.url);
const amberTerminal = readFileSync(new URL('amber-terminal.json', skinsFolder), 'utf8');
const paperBlueprint = readFileSync(new URL('paper-blueprint.json', skinsFolder), 'utf8');

interface SkinFile {
  readonly name: string;
  /** What the file holds; a file without text is not on the disk. */
  readonly text?: string;
  /** What the picker reports, when it differs from the text's length. */
  readonly size?: number;
}

function phone(files: SkinFile[], storage = new Map<string, string>()) {
  const dialogs = fakeDialogs();
  const disk = new Map<string, Uint8Array>();
  const picks: PickedDocument[] = files.map((file) => {
    const uri = `file:///cache/DocumentPicker/${file.name}`;
    const bytes = file.text === undefined ? undefined : new TextEncoder().encode(file.text);
    if (bytes) disk.set(uri, bytes);
    return { uri, name: file.name, mimeType: 'application/json', size: file.size ?? bytes?.length ?? 0, lastModified: 0 };
  });
  const providers: Provider[] = [
    memoryStorage(storage),
    engineProvider(fakeEngine()),
    memoryFiles(disk),
    fakeDocumentPicker(picks),
    dialogs.provider,
  ];
  return { dialogs, providers };
}

const json = (doc: object) => JSON.stringify(doc);
const card = (name: string) => screen.getByRole('button', { name: `Use skin ${name}` });
const loadButton = () => screen.getByRole('button', { name: 'Load skin file' });
const inUse = (name: string) => card(name).props['accessibilityState'];

async function openSkinsTab() {
  const user = userEvent.setup();
  await user.press(screen.getByRole('tab', { name: 'Skins' }));
  return user;
}

test('installs a skin file picked from the phone and puts it in use', async () => {
  const { dialogs, providers } = phone([{ name: 'amber-terminal.json', text: amberTerminal }]);
  await render(App, { providers });
  const user = await openSkinsTab();

  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('"Amber Terminal" installed'));
  expect(dialogs.open).toEqual({ title: '"Amber Terminal" installed', message: 'The skin is now in use.', buttons: ['OK'] });
  await dialogs.answer('OK');

  expect(inUse('Amber Terminal')).toMatchObject({ selected: true });
  expect(inUse('Llama Classic')).toMatchObject({ selected: false });
  expect(within(card('Amber Terminal')).getByText('In use')).toBeTruthy();
  expect(screen.getByText('A 1982 amber CRT: square everything, monospace everywhere. · by Skinning Player')).toBeTruthy();

  await user.press(screen.getByRole('tab', { name: 'Library' }));
  expect(screen.getByText('Amber Terminal')).toBeTruthy();
  expect(screen.queryByText('Llama Classic')).toBeNull();
});

test('updates a skin loaded again after editing it, keeping a single card for it', async () => {
  const edited = json({ ...JSON.parse(amberTerminal), description: 'Now in green phosphor.' });
  const { dialogs, providers } = phone([
    { name: 'amber-terminal.json', text: amberTerminal },
    { name: 'amber-terminal (1).json', text: edited },
  ]);
  await render(App, { providers });
  const user = await openSkinsTab();

  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('"Amber Terminal" installed'));
  await dialogs.answer('OK');
  await user.press(card('Paper'));
  await user.press(loadButton());

  await waitFor(() => expect(dialogs.open?.title).toBe('"Amber Terminal" updated'));
  expect(dialogs.open?.message).toBe('The skin is now in use.');
  await dialogs.answer('OK');
  expect(screen.getAllByRole('button', { name: 'Use skin Amber Terminal' })).toHaveLength(1);
  expect(screen.getByText('Now in green phosphor. · by Skinning Player')).toBeTruthy();
  expect(inUse('Amber Terminal')).toMatchObject({ selected: true });
});

test('applies a skin with invalid values, saying how many fell back to the base skin', async () => {
  const sloppy = json({
    name: 'Sloppy',
    colors: { accent: 'not a color!', background: 42, glow: '#fff' },
    shape: { radius: 'round', corners: 4 },
    motion: { easing: 'wobbly', speed: 'fast' },
    statusBar: 'purple',
    extends: 'winamp',
  });
  const { dialogs, providers } = phone([{ name: 'sloppy.json', text: sloppy }]);
  await render(App, { providers });
  const user = await openSkinsTab();

  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('"Sloppy" installed'));
  const lines = dialogs.open!.message!.split('\n');
  expect(lines.slice(0, 3)).toEqual([
    'The skin is now in use.',
    '',
    '9 value(s) were invalid and fell back to the base skin:',
  ]);
  expect(lines.slice(3)).toEqual([
    'Ignored invalid value at "extends".',
    'Ignored invalid value at "colors.accent".',
    'Ignored invalid value at "colors.background".',
    'Ignored invalid value at "colors.glow".',
    'Ignored invalid value at "shape.radius".',
    'Ignored invalid value at "shape.corners".',
  ]);
  await dialogs.answer('OK');

  expect(inUse('Sloppy')).toMatchObject({ selected: true });
  expect(within(card('Sloppy')).getByText('Custom skin')).toBeTruthy();
});

test.each([
  ['a file that is not JSON', '{ "name": "Half a skin", ', 'The file is not valid JSON.'],
  ['a skin without a name', json({ colors: { accent: '#ff0000' } }), 'A skin needs a "name".'],
  ['a JSON list instead of a skin', json([{ name: 'Listed' }]), 'A skin must be a JSON object.'],
  ['a skin of a newer format', json({ format: 2, name: 'Future' }), 'Unsupported skin format 2; expected 1.'],
])('refuses %s and keeps the skin in use', async (_, text, error) => {
  const { dialogs, providers } = phone([{ name: 'broken.json', text }]);
  await render(App, { providers });
  const user = await openSkinsTab();
  await user.press(card('Neon Nights'));

  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('Could not load skin'));
  expect(dialogs.open).toEqual({ title: 'Could not load skin', message: error, buttons: ['OK'] });
  await dialogs.answer('OK');

  expect(inUse('Neon Nights')).toMatchObject({ selected: true });
  expect(screen.getAllByRole('button', { name: /^Use skin / })).toHaveLength(4);
  expect(screen.queryByRole('button', { name: /^Remove skin / })).toBeNull();
});

test('refuses a file larger than 4 MB without installing it', async () => {
  const { dialogs, providers } = phone([{ name: 'huge.json', text: json({ name: 'Huge' }), size: 4_000_001 }]);
  await render(App, { providers });
  const user = await openSkinsTab();

  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('Could not load skin'));
  expect(dialogs.open?.message).toBe('The file is too large to be a skin (4 MB at most).');
  await dialogs.answer('OK');

  expect(screen.queryByRole('button', { name: 'Use skin Huge' })).toBeNull();
  expect(inUse('Llama Classic')).toMatchObject({ selected: true });
});

test('tells the user when the picked file cannot be read', async () => {
  const { dialogs, providers } = phone([{ name: 'gone.json' }]);
  await render(App, { providers });
  const user = await openSkinsTab();

  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('Could not load skin'));
  expect(dialogs.open?.message).toBe('Could not read "gone.json".');
  await dialogs.answer('OK');

  expect(inUse('Llama Classic')).toMatchObject({ selected: true });
});

test('does nothing when the user cancels the file picker', async () => {
  const { dialogs, providers } = phone([]);
  await render(App, { providers });
  const user = await openSkinsTab();

  await user.press(loadButton());

  expect(dialogs.shown).toEqual([]);
  expect(screen.getAllByRole('button', { name: /^Use skin / })).toHaveLength(4);
  expect(inUse('Llama Classic')).toMatchObject({ selected: true });
  expect(loadButton().props['accessibilityState']).toMatchObject({ disabled: false });
});

test('installs a skin with the id of a built-in one next to it, not over it', async () => {
  const { dialogs, providers } = phone([{ name: 'paper.json', text: json({ id: 'paper', name: 'My Paper', extends: 'paper' }) }]);
  await render(App, { providers });
  const user = await openSkinsTab();

  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('"My Paper" installed'));
  await dialogs.answer('OK');

  expect(inUse('My Paper')).toMatchObject({ selected: true });
  expect(inUse('Paper')).toMatchObject({ selected: false });
  expect(screen.getByText('Warm paper, ink-black buttons and serif type. · by Skinning Player')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove skin My Paper' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Remove skin Paper' })).toBeNull();

  await user.press(card('Paper'));
  expect(inUse('Paper')).toMatchObject({ selected: true });
  expect(inUse('My Paper')).toMatchObject({ selected: false });
});

test('offers no way to remove the built-in skins', async () => {
  await render(App, { providers: phone([]).providers });
  await openSkinsTab();

  for (const name of ['Llama Classic', 'Neon Nights', 'Paper', 'Deep Ocean']) {
    expect(card(name)).toBeTruthy();
  }
  expect(screen.queryByRole('button', { name: /^Remove skin / })).toBeNull();
});

test('removes the skin in use after confirming, and goes back to Llama Classic', async () => {
  const { dialogs, providers } = phone([{ name: 'amber-terminal.json', text: amberTerminal }]);
  await render(App, { providers });
  const user = await openSkinsTab();
  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('"Amber Terminal" installed'));
  await dialogs.answer('OK');

  await user.press(screen.getByRole('button', { name: 'Remove skin Amber Terminal' }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Remove the skin "Amber Terminal"?'));
  expect(dialogs.open?.buttons).toEqual(['Cancel', 'OK']);
  await dialogs.answer('Cancel');
  expect(inUse('Amber Terminal')).toMatchObject({ selected: true });

  await user.press(screen.getByRole('button', { name: 'Remove skin Amber Terminal' }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Remove the skin "Amber Terminal"?'));
  await dialogs.answer('OK');

  expect(screen.queryByRole('button', { name: 'Use skin Amber Terminal' })).toBeNull();
  expect(inUse('Llama Classic')).toMatchObject({ selected: true });
  await user.press(screen.getByRole('tab', { name: 'Library' }));
  expect(screen.getByText('Llama Classic')).toBeTruthy();
});

test('removes a skin that is not in use without changing the one in use', async () => {
  const { dialogs, providers } = phone([{ name: 'amber-terminal.json', text: amberTerminal }]);
  await render(App, { providers });
  const user = await openSkinsTab();
  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('"Amber Terminal" installed'));
  await dialogs.answer('OK');
  await user.press(card('Deep Ocean'));

  await user.press(screen.getByRole('button', { name: 'Remove skin Amber Terminal' }));
  await waitFor(() => expect(dialogs.open?.title).toBe('Remove the skin "Amber Terminal"?'));
  await dialogs.answer('OK');

  expect(screen.queryByRole('button', { name: 'Use skin Amber Terminal' })).toBeNull();
  expect(inUse('Deep Ocean')).toMatchObject({ selected: true });
});

test('keeps imported skins and the chosen one after the app restarts', async () => {
  const storage = new Map<string, string>();
  const first = phone(
    [
      { name: 'amber-terminal.json', text: amberTerminal },
      { name: 'paper-blueprint.json', text: paperBlueprint },
    ],
    storage,
  );
  const view = await render(App, { providers: first.providers });
  const user = await openSkinsTab();
  await user.press(loadButton());
  await waitFor(() => expect(first.dialogs.open?.title).toBe('"Amber Terminal" installed'));
  await first.dialogs.answer('OK');
  await user.press(loadButton());
  await waitFor(() => expect(first.dialogs.open?.title).toBe('"Paper Blueprint" installed'));
  await first.dialogs.answer('OK');
  await view.componentRef.injector.get(Storage).flush();
  view.unmount();

  await render(App, { providers: phone([], storage).providers });
  await openSkinsTab();

  expect(inUse('Paper Blueprint')).toMatchObject({ selected: true });
  expect(inUse('Amber Terminal')).toMatchObject({ selected: false });
  expect(screen.getByRole('button', { name: 'Remove skin Amber Terminal' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove skin Paper Blueprint' })).toBeTruthy();
});

test('disables loading another skin file until the result has been read', async () => {
  const { dialogs, providers } = phone([{ name: 'amber-terminal.json', text: amberTerminal }]);
  await render(App, { providers });
  const user = await openSkinsTab();
  expect(loadButton().props['accessibilityState']).toMatchObject({ disabled: false });

  await user.press(loadButton());
  await waitFor(() => expect(dialogs.open?.title).toBe('"Amber Terminal" installed'));
  expect(loadButton().props['accessibilityState']).toMatchObject({ disabled: true });

  await dialogs.answer('OK');
  expect(loadButton().props['accessibilityState']).toMatchObject({ disabled: false });
});
