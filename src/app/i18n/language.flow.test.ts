import { type Provider } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { render, screen, userEvent, waitFor, within } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from '../app.ts';
import {
  engineProvider,
  fakeDialogs,
  fakeEngine,
  fakeLocale,
  fakeMediaLibrary,
  memoryStorage,
} from '../testing/fakes.ts';

const songs = (): [string, string, number][] => [
  ['1', 'Daft Punk - Digital Love.mp3', 301],
  ['2', 'Interlude.mp3', 75],
];

function phone(languages: string[], storage = new Map<string, string>()) {
  const dialogs = fakeDialogs();
  const providers: Provider[] = [
    memoryStorage(storage),
    engineProvider(fakeEngine()),
    fakeMediaLibrary(songs()),
    fakeLocale(languages),
    dialogs.provider,
  ];
  return { dialogs, providers };
}

test('speaks Spanish on a phone set to Spanish, plurals included', async () => {
  await render(App, { providers: phone(['es-MX', 'en-US']).providers });

  expect(await screen.findByText('2 canciones')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Biblioteca' })).toBeTruthy();
  expect(screen.getByPlaceholderText('Buscar canciones, artistas o álbumes')).toBeTruthy();
  const interlude = screen.getByRole('button', { name: 'Interlude' });
  expect(within(interlude).getByText('Artista desconocido  ·  1:15')).toBeTruthy();
  expect(screen.getByText('Nada en reproducción')).toBeTruthy();

  await userEvent.setup().press(screen.getByRole('tab', { name: 'Listas' }));
  expect(screen.getByText('0 listas')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Nueva lista' })).toBeTruthy();
});

test('takes the first of the phone\'s languages that the app has, and English when it has none', async () => {
  const first = await render(App, { providers: phone(['fr-FR', 'es-ES']).providers });
  expect(await screen.findByText('2 canciones')).toBeTruthy();
  first.unmount();

  await render(App, { providers: phone(['de-DE']).providers });
  expect(await screen.findByText('2 songs')).toBeTruthy();
});

test('switches language from the header, and keeps the choice after a restart', async () => {
  const storage = new Map<string, string>();
  const view = await render(App, { providers: phone(['en-US'], storage).providers });
  const user = userEvent.setup();
  expect(await screen.findByText('2 songs')).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Language' }));
  expect(await screen.findByRole('heading', { name: 'Language' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Device language' }).props['accessibilityState']).toMatchObject({ checked: true });
  await user.press(screen.getByRole('radio', { name: 'Español' }));

  expect(await screen.findByText('2 canciones')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Biblioteca' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Idioma' })).toBeNull();
  await view.componentRef.injector.get(Storage).flush();
  view.unmount();

  const restarted = await render(App, { providers: phone(['en-US'], storage).providers });
  expect(await screen.findByText('2 canciones')).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Idioma' }));
  await user.press(await screen.findByRole('radio', { name: 'Idioma del dispositivo' }));
  expect(await screen.findByText('2 songs')).toBeTruthy();
  restarted.unmount();
});

test('asks in Spanish before deleting a playlist, with Spanish buttons', async () => {
  const { dialogs, providers } = phone(['es']);
  await render(App, { providers });
  const user = userEvent.setup();

  await user.press(await screen.findByRole('tab', { name: 'Listas' }));
  await user.press(screen.getByRole('button', { name: 'Nueva lista' }));
  await user.type(screen.getByPlaceholderText('Nombre de la lista'), 'Gimnasio');
  await user.press(screen.getByRole('button', { name: 'Crear' }));
  await user.press(await screen.findByRole('button', { name: 'Eliminar lista' }));

  await waitFor(() => expect(dialogs.open?.title).toBe('¿Eliminar "Gimnasio"?'));
  expect(dialogs.open?.buttons).toEqual(['Cancelar', 'Aceptar']);
  await dialogs.answer('Aceptar');
  expect(await screen.findByText('0 listas')).toBeTruthy();
});