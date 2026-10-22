# Arquitectura de `src/app`

`src/app` se organiza por **dominio**, no por tipo de archivo. Cada carpeta junta su lógica (servicios
`@Service()` y funciones puras), sus pantallas y hojas, y sus tests. Para entender o cambiar una
funcionalidad basta con abrir una carpeta.

`src/main.ts` monta `App` (`src/app/app.ts`), que es el shell: cabecera, pestañas, mini player y el
reproductor a pantalla completa.

## Dominios

| Carpeta | Qué hace | Archivos principales |
|---|---|---|
| `library/` | Tracks, la biblioteca de música del dispositivo y sus ajustes, filtros, orden, carátulas y la pestaña Biblioteca. | `track.ts`, `music-library.ts`, `library-settings.ts`, `library-content.ts`, `library-filter.ts`, `sorting.ts`, `release-type.ts`, `covers.ts`, `media-access.ts`, `library-screen.ts`, `filter-sheet.ts`, `sort-sheet.ts`, `library-status.ts`, `track-row.ts`, `cover-art.ts` |
| `metadata/` | Lee tags, carátulas y datos de audio desde los bytes del archivo (ID3, FLAC, MP4, Ogg, WAV). Es código puro: no importa nada de la app. | `byte-reader.ts`, `embedded-tags.ts`, `embedded-cover.ts`, `id3-cover.ts`, `audio-info.ts` |
| `catalog/` | Álbumes, artistas y géneros: sus listas y sus páginas. | `catalog.ts`, `catalog-list.ts`, `catalog-detail.ts` |
| `player/` | La cola de reproducción, el reproductor a pantalla completa, la hoja de la cola, el mini player y sus widgets, y el árbol de navegación de Android Auto. | `player.ts`, `player-view.ts`, `now-playing.ts`, `queue-sheet.ts`, `mini-player.ts`, `display.ts`, `seek-bar.ts`, `visualizer.ts`, `auto-browse.ts` |
| `audio/` | El motor de audio (Skinning Audio en Android o `expo-audio`), las features que cambian según la plataforma, y ReplayGain. | `audio-engine.ts`, `features.ts`, `replay-gain.ts` |
| `playlists/` | Playlists, su pestaña, y las hojas para crearlas y añadir canciones. | `playlists.ts`, `playlists-screen.ts`, `add-to-playlist-sheet.ts`, `name-prompt.ts`, `track-picker.ts` |
| `search/` | La búsqueda y su pantalla. | `search.ts`, `search-screen.ts` |
| `songs/` | El menú de una canción, la hoja de propiedades y la de carátula. | `song-menu.ts`, `song-details.ts`, `song-properties-sheet.ts`, `cover-sheet.ts` |
| `settings/` | Ajustes de reproducción e interfaz y su pantalla. | `behavior-settings.ts`, `settings-screen.ts`, `setting-switch.ts` |
| `skins/` | El formato de skin y su validador, las skins incluidas, `SkinManager`, los botones e iconos con skin, y la pestaña Skins. | `skin.ts`, `builtin-skins.ts`, `skin-manager.ts`, `skin-button.ts`, `skin-icon.ts`, `skin-backdrop.ts`, `skins-screen.ts` |
| `shared/` | Piezas de interfaz que no son de ningún dominio. | `sheet.ts`, `menu-sheet.ts`, `tab-menu.ts`, `navigation.ts` |
| `i18n/` | Los textos en inglés y español, el servicio `I18n`, y la hoja para elegir idioma. | `messages.ts`, `i18n.ts`, `language-sheet.ts` |
| `testing/` | Fakes de la parte nativa para los tests. | `fakes.ts` |

El módulo nativo de Android está fuera de `src`, en `modules/skinning-audio/`. Solo lo carga
`audio/audio-engine.ts`.

## Dependencias entre dominios

Las capas de abajo no dependen de las de arriba:

```
metadata            código puro: bytes -> tags, carátulas, info de audio
   ↑
audio               motor de audio, features, ReplayGain
   ↑
library ⇄ catalog ⇄ player ⇄ playlists ⇄ songs ⇄ search ⇄ settings
   ↑
skins, i18n, shared  usados por todas las pantallas
```

- `metadata` no importa nada. `audio` solo importa `metadata`. `skins` solo importa `i18n`.
- Los dominios de funcionalidad (`library`, `catalog`, `player`, `playlists`, `songs`, `search`,
  `settings`) sí se importan entre ellos. Casi siempre es una pantalla que abre la hoja de otro
  dominio (por ejemplo, `library-screen.ts` abre `catalog-detail.ts` y `song-menu.ts`), o que
  reproduce con `Player`. Los servicios importan pocos dominios: sobre todo `library/track.ts`.
- `shared/navigation.ts` importa `settings/behavior-settings.ts` y `library/library-filter.ts`,
  así que `shared` no es del todo independiente.
- `i18n/messages.ts` importa los tipos de los ajustes que traduce (`sorting`, `release-type`,
  `behavior-settings`, `replay-gain`).

## Convenciones

- **Los tests van junto al código.** `x.test.ts` prueba `x.ts`. Los `*.flow.test.ts` renderizan
  pantallas enteras con `@ng-native/testing` y prueban un flujo de punta a punta (por ejemplo,
  `player/player.flow.test.ts`, `library/library.flow.test.ts`).
- **Los imports son relativos y llevan la extensión `.ts`**, por ejemplo
  `import { Player } from '../player/player.ts';`.
- **Un archivo nuevo va a la carpeta de su dominio**, sea servicio, pantalla, hoja o test. Va a
  `shared/` solo si no es de ningún dominio y lo usan varios.
- **Los componentes con skin** (botones, iconos, fondos) van en `skins/`, porque dependen de
  `SkinManager`.

## Historia

Hasta octubre de 2026 el código estaba organizado por tipo: `core/` (toda la lógica), `screens/`,
`ui/`, `widgets/` y `flows/` (tests de integración). Se reorganizó por dominio moviendo archivos y
reescribiendo los imports, sin cambiar lógica. Los tests de `flows/x.test.ts` pasaron a
`<dominio>/x.flow.test.ts`.
