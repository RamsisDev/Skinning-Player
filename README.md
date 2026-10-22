<p align="center">
  <img src="assets/icon.png" alt="Skinning Player icon" width="200">
</p>

# Skinning Player

Skinnable Android music player built with [Angular Native](https://ng-native.com) (Angular 22 on
Expo SDK 57). It lists the audio files on the device (MP3, WAV, FLAC, M4A/AAC, Ogg, Opus and the
other formats Android decodes), plays them with background playback and
lock-screen controls, keeps playlists, and loads Winamp-style skins at runtime: the menu, every
button and the widgets (mini player, LCD display, visualizer, seek bar) are drawn from the active
skin.

## Run it

Requirements: Node 24, JDK 17, the Android SDK (`ANDROID_HOME`) and an emulator or a device.

```sh
npm install
npm run android   # builds the development app and installs it (first build takes a while)
npm start         # Metro, for the installed development app
npm test          # unit and component tests, in Node, no device needed
npm run typecheck
```

The media library needs a development build (`npm run android`), not Expo Go. To try it on an
emulator without music, push a few files and rescan:

```sh
adb push "Artist - Title.mp3" /sdcard/Music/
adb shell content call --method scan_volume --uri content://media --arg external_primary
```

## Layout

Each domain keeps its service, its screens and sheets, and its tests (`*.flow.test.ts` drive
whole screens) together. How the domains depend on each other, and where new code goes: [docs/architecture.md](docs/architecture.md).

| Path | What lives there |
|---|---|
| `src/app/library/` | Tracks, the device music library and its settings, filters, sorting, covers, track rows and the library tab. |
| `src/app/metadata/` | Reading tags, covers and audio details out of the file bytes (ID3, FLAC, MP4, Ogg, WAV). |
| `src/app/catalog/` | Albums, artists and genres: their lists and pages. |
| `src/app/player/` | The play queue, the full-screen player, the queue sheet, the mini player and its widgets, and the Android Auto browse tree. |
| `src/app/audio/` | The audio engine (Skinning Audio or `expo-audio`), platform features and ReplayGain. |
| `src/app/playlists/` | Playlists, their tab and the sheets that add to them. |
| `src/app/search/` | The search and its screen. |
| `src/app/songs/` | The song menu, its properties and cover sheets. |
| `src/app/settings/` | Playback and interface settings and their screen. |
| `src/app/skins/` | The skin format, its validator, the built-in skins, `SkinManager`, the skinned buttons and icons, and the skins tab. |
| `src/app/shared/` | Building blocks no domain owns: sheets, the menu sheet, the tab menu and navigation. |
| `src/app/i18n/` | The app's strings in English and Spanish, the `I18n` service that picks one, and the language sheet. |
| `src/app/testing/` | Fakes of the native side for the tests. |
| `skins/` | Example skin files to copy to a phone and load. |

## Language

The app speaks English and Spanish. It follows the phone's preferred languages, taking the first
one it has and English otherwise; the language button in the header (`EN`/`ES`) picks one for the
app instead, or goes back to the phone's. Every string lives in `src/app/i18n/messages.ts`, where
English defines the shape: a Spanish string missing, or taking different arguments, fails the
typecheck. The phone's language is read through `expo-localization`, so a development build made
before it was added needs rebuilding (`npm run android`); until then the app starts in English.

## Song details, search and filters

Each song is named by its file's tags: title, artists, album, album artists, genres, track and
disc numbers, release and original dates, release type (MusicBrainz's "album", "EP", "single",
"compilation", "soundtrack", "live"... and iTunes' compilation flag) and sort names, from an ID3v2
or ID3v1.1 tag (MP3, and a WAV's `id3 ` chunk, including Picard's `TXXX` frames), a WAV's LIST
INFO chunk, a FLAC or Ogg (Vorbis, Opus) stream's comments, or an M4A's iTunes atoms (freeform
`----` atoms too). Android's media store answers only file names, so the scan reads the tags from
each file, only their headers and text; a file without tags is named from its file name
("03 - Artist - Title.mp3"). Tags are kept in the cache with each file's modification time, so a
rescan reads only the files that are new or changed.

## Albums, artists and genres

The library tab has four lists: **Songs**, **Albums**, **Artists** and **Genres**, each
sorted the way the user picks with the sort button (name, artist, album, date, duration, song
count, date added; either way), and kept.

- **An album** is its name and its album artists, so two "Greatest Hits" by different artists are
  two albums; an album with no album artist is told apart by its folder. It opens with its songs
  in disc and track order, under a heading per disc, with its release type, date and length; its
  artist opens their page.
- **An artist** opens with their albums under their release types (Albums, EPs, Singles,
  Compilations...), the albums by others they **appear on**, and all their songs, newest first.
- **A genre** opens with its artists and its songs.

The search opens an album, artist or genre on that same page, and back returns to the search.

Sorting is **intelligent** by default: "The Beatles" sorts under B and "Los
Prisioneros" under P, numbers sort by their value ("2" before "10"), and a file's sort tags
(`TSOP`, `ARTISTSORT`, `soar`...) win over the name.

## Queue and song menu

The queue button in the full player lists the queue in the order it plays, the song playing
marked: a tap plays a song, and each moves up or down a place or comes out of the queue. The
queue, the song playing and how far into it are kept, and come back paused on the next launch.

Every song's menu (in the songs tab, an album, artist or genre, and the search) plays it next,
adds it to the queue, goes to its artist or album, files it in a playlist, changes its cover,
shows its **properties** and **shares** its file. The properties are read from the file's
headers: path, format, size, length, bitrate, sample rate and the ReplayGain a tagger wrote.
Sharing hands the file itself to another app through `expo-sharing`, so a development build made
before it was added needs rebuilding (`npm run android`).

## Settings

The gear in the header opens the settings:

- **When a song is tapped, play from** the list it is in, all songs, or its album, artist or
  genre. **Remember shuffle**, **Rewind before skipping back**, **Pause on repeat** (repeat one
  stops at the end of the song) and **Remember pause** (skipping while paused stays paused) are
  the playback settings.
- **Library tabs** shows, hides and orders the library's lists; **Mini player button** picks
  next, repeat mode or shuffle as the button after play.
- **Rescan** reads the new and changed files; **Full rescan** forgets every tag read and reads
  every file again. **Automatic reloading** rescans by itself, quietly, when the device's music
  changes and whenever the app comes back to the front: Android's media library reports changes
  to photos and videos, never to audio, so on Android the return is what finds new music.
- **Exclude non-music** (on by default) leaves out podcasts, audiobooks, ringtones,
  notifications, alarms and recordings, by the folders Android keeps them in. **Include hidden
  files** reads the files in folders whose name starts with a dot.
- **Music folders** lists every folder with audio, on the internal storage or an SD card, to
  **exclude**, or to **include only**; a folder counts with the folders in it.
- **Multi-value separators** choose what splits an artist, album artist or genre tag that holds
  several values: `,` and `;` by default, and `/`, `+` and `&` on demand. A backslash keeps a
  separator in a name (`AC/DC`). "feat." always separates a song's artists.
- **Folder covers** shows a song's folder's `cover.jpg`, `folder.jpg`, `front.jpg`... (or
  `.png`) when the song has no cover of its own. Turning it on asks for access to images, which
  Android needs to read them; a development build made before it was added needs rebuilding
  (`npm run android`).
- **Statistics**: how many songs, albums, artists and genres the library has, how long it plays
  and how much space it takes.

The search matches every word typed against the title, artist, album, genre, year and file name,
ignoring case and accents ("musica" finds "Música"). Under it, a filter for each detail the
library has values for (a library without genres offers no genre filter) lists the values left
among the songs on show, with how many songs have each; filters combine with each other and the
search. A song by "Mon Laferte, Juanes" counts for both artists; "&" and "/" are left alone, so
"Simon & Garfunkel" and "AC/DC" stay whole.

## Covers

A tap on a song plays it and opens the full player, with the song's cover as large as fits. The
cover is, in order: an image you chose for the song, the art embedded in the file (an MP3's ID3v2
tag, a FLAC's PICTURE block, a WAV's `id3 ` chunk or an M4A's `covr` atom), or a placeholder in
the skin's display colors. Set or change a song's image with the cover button in
the full player, or from the song's menu (the "more" button) in the library. Chosen images are
copied into the app's storage, so the original can be deleted; embedded art is read once and kept
in the cache.

## Skins

A skin is a JSON file. Load it from the **Skins** tab with **Load skin file**. It is validated
before it is installed: an invalid value is ignored with a warning and the base skin fills the gap,
so a skin only has to list what it changes (like a Winamp skin missing a bitmap).

```json
{
  "format": 1,
  "id": "my-skin",
  "name": "My Skin",
  "author": "Me",
  "description": "Optional, shown on the skin card.",
  "extends": "classic",
  "statusBar": "light",
  "colors": { "accent": "#ff5500", "displayText": "#ff5500" },
  "shape": { "radius": 12, "buttonRadius": 24, "widgetRadius": 12, "borderWidth": 1 },
  "fonts": [
    { "family": "Inter", "weight": 400, "src": "https://example.com/Inter-Regular.ttf" },
    { "family": "Inter", "weight": 700, "src": "https://example.com/Inter-Bold.ttf" }
  ],
  "typography": {
    "fontFamily": "Inter",
    "displayFontFamily": "monospace",
    "scale": 1,
    "weights": { "regular": 400, "medium": 600, "bold": 700 }
  },
  "images": { "background": "https://example.com/bg.jpg", "backgroundOpacity": 0.4, "backgroundResize": "cover" },
  "icons": { "play": "<svg viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M8 5v14l11-7z\"/></svg>" },
  "widgets": { "visualizer": true, "visualizerBars": 20, "miniDisplay": true },
  "motion": {
    "speed": 1,
    "easing": "ease-out",
    "pressScale": 0.96,
    "pressOpacity": 0.7,
    "sheetTransition": "fade",
    "playerTransition": "slide",
    "displayEffect": "none"
  }
}
```

- **`extends`**: `classic`, `neon`, `paper` or `ocean`. Everything not listed comes from it.
- **`colors`**: `background`, `surface`, `surfaceAlt`, `border`, `text`, `textMuted`, `accent`,
  `accentText`, `danger`, `menuBackground`, `menuText`, `menuActiveBackground`, `menuActiveText`,
  `buttonBackground`, `buttonText`, `buttonBorder`, `primaryBackground`, `primaryText`,
  `widgetBackground`, `widgetBorder`, `widgetText`, `displayBackground`, `displayText`,
  `progressTrack`, `progressFill`. Hex, `rgb()`, `rgba()`, `hsl()`, `hsla()` or a color name.
- **`shape`**: corner radii from 0 to 40 and a border width from 0 to 6, in points.
- **`fonts`**: up to 8 `.ttf` or `.otf` files the skin ships, each a `family`, a `weight` (100 to
  900, 400 by default) and a `src` (`https://`, `file://` or `data:font/ttf;base64,`). They are
  downloaded and registered when the skin is applied. A skin's faces are laid over the ones it
  inherits; `null` drops them all.
- **`typography`**: the body and display families, each one from `fonts` or a family the system
  has (`sans-serif`, `serif`, `monospace`, `sans-serif-condensed`, `sans-serif-light`...), a size
  scale from 0.8 to 1.4, and the weight of `regular` text, `medium` labels and `bold` titles. With
  a shipped family, each weight draws the nearest face, as CSS picks one.
- **`images.background`**: an `https://`, `file://` or `data:image/...;base64,` URI.
- **`icons`**: SVG markup per button, drawn in the button's color through `currentColor`. Slots:
  `play`, `pause`, `previous`, `next`, `shuffle`, `repeat`, `repeatOne`, `library`, `playlists`,
  `skins`, `add`, `addToPlaylist`, `more`, `close`, `back`, `remove`, `rename`, `search`,
  `import`, `check`, `refresh`, `cover`, `warning`, `settings`, `sort`, `queue`, `moveUp`,
  `moveDown`, `drag`, `share`, `info`. `null` restores the default icon.
- **`widgets`**: show or hide the visualizer (4 to 32 bars) and the mini player's display.
- **`motion`**: `speed` from 0 to 4 (0 turns motion off), an `easing` (`linear`, `ease`,
  `ease-in`, `ease-out`, `ease-in-out`, `smooth`, `snappy`, `bouncy`), how a pressed button
  shrinks (`pressScale`, 0.8 to 1) and fades (`pressOpacity`, 0.2 to 1), how sheets and the full
  player come in (`slide`, `fade` or `none`), and a looping `displayEffect` on the LCD (`none`,
  `pulse`, `flicker`, or `blink`, which blinks the time while paused).

Under the hood each value becomes a CSS custom property (`--sk-accent`, `--sk-button-radius`,
`--sk-font-md`...) set on the root view; every component stylesheet reads those, so a new skin
restyles the whole app without a rebuild. `skins/` has two complete examples.
