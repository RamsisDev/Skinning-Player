# Qué falta en el código para personalizar la pantalla de Álbumes

Análisis de lo que le falta a cada componente de la pantalla Biblioteca › Álbumes para que dos
mockups hechos con IA se puedan construir como skins: uno gótico (estilo Hollow Knight) y otro neón
(cian y rosa). La comparación visual está en el canvas «Álbumes: OG vs mockup» (privado: el link
solo funciona si se comparte desde la página):
https://claude.ai/artifact/U3oWhzhh9pptWbSSFUdaZE

Fecha: 22 de octubre de 2026, sobre `main@90b42b0`.

## 0. Qué permite dibujar el motor hoy

Revisado en `@ng-native/fabric` 0.16 y react-native 0.86.

| Efecto | ¿Se puede? | Notas |
|---|---|---|
| `box-shadow` (brillo en cajas) | ✅ | El compilador lo traduce a `boxShadow` y acepta `var()` |
| `text-shadow` (brillo en el logo) | ✅ | |
| Gradientes | ✅ | Solo con `background: var(--token)` cuando el token se define en tiempo de ejecución, que es justo lo que hace `SkinManager` |
| SVG de varios colores en `SkinIcon` | ✅ ya funciona | `ng-icon` solo cambia `currentColor` y respeta los rellenos y gradientes propios del SVG |
| SVG en `ng-icon`: formas, `clipPath`, `mask`, gradientes, `use`, texto | ✅ | No dibuja `<image>`, `<filter>` ni `<pattern>` dentro del SVG |
| `<image>` con `resizeMode` `stretch` y `repeat` | ✅ | Sirve para estirar o repetir piezas de un marco y para texturas |
| `border-image` / marcos que se estiran (9-slice) | ❌ | No hay equivalente. `capInsets` de `<image>` solo existe en iOS. Se resuelve con `<image>` (sección 1.1) |
| `clip-path` (esquinas cortadas) | ❌ | Se resuelve con un SVG calculado (sección 1.1) |
| `background: url()` | ❌ | Se resuelve con un `<image>` absoluto detrás del contenido |

Lo que falta en CSS se puede construir con imágenes, SVG y capas posicionadas, sin código nativo.

## 1. La base: el formato de skin

Casi todo lo que falta es común a todos los componentes. Hoy
[`skin.ts`](../src/app/skins/skin.ts) solo tiene `colors`, `shape`, `typography`, `fonts`, `icons`,
`images.background`, `widgets` y `motion`. Faltan estos bloques:

| Bloque nuevo | Gótico | Neón | Qué hay que hacer en el código |
|---|---|---|---|
| **`effects`**: brillo de cajas y de texto | ✓ | ✓ | Validar en `parseSkin` y emitir `--sk-glow-color`, `--sk-glow-radius` y `--sk-text-glow` en `skinCssVars`. Es lo más barato. |
| **Colores nuevos**: `accentAlt` (el rosa), `logo`, `tab*`, `rowCurrent*`, `cornerAccent` | ✓ | ✓ | Añadirlos a `COLOR_KEYS`. En `CLASSIC_SKIN` cada uno se define como alias de uno existente, para que las skins actuales no cambien. |
| **`shape.corner: 'round' \| 'chamfer'`** y `chamferSize` | | ✓ | Componente nuevo **`SkinFrame`** en modo `chamfer`: un SVG calculado con el tamaño real del componente (sección 1.1). |
| **`frames`**: marco de imagen por pieza (`button`, `buttonPrimary`, `headerButton`, `tab`, `tabActive`, `widget`, `cover`, `rowCurrent`, `statusBar`) | ✓ | | El mismo `SkinFrame` en modo imagen: un `<image>` del tamaño exacto, o un 3-slice de tres `<image>` cuando el ancho varía (sección 1.1). |
| **`textures`**: relleno con imagen (pergamino, piedra) | ✓ | | Un `<image resizeMode="repeat">` absoluto dentro de `SkinFrame`, detrás del contenido. |
| **`ornaments`**: lista de `{anchor, src, width, height, offset}` | ✓ | ✓ | Componente nuevo **`SkinOrnament`** (`<app-skin-ornament anchor="count.after" />`): un `<image>` absoluto con `pointerEvents="none"`, colocado en cada plantilla. Anclas que hacen falta: `statusBar`, `header.top`, `logo.below`, `tabs.activeBelow`, `tabs.below`, `count.after`, `actions.before`, `list.overlay`, `tabMenu.top`. |
| **Iconos raster** (PNG) | ✓ | | Hoy `isSvg` solo acepta SVG de hasta 20 KB (`MAX_SVG`, [`skin.ts:195`](../src/app/skins/skin.ts#L195)). `SkinIcon` tendría que pintar un `<image>` cuando el hueco es `data:image/png`. |
| **Tamaño de icono por hueco** (`iconSizes`) | ✓ | ✓ | Hoy los tamaños están fijos en cada componente. |
| **Tipografía del logo**: `logoFontFamily`, `logoLetterSpacing` | ✓ | | Tokens `--sk-logo-font` y `--sk-logo-letter-spacing`. |
| **`components`**: variantes por componente (detalle abajo) | ✓ | ✓ | Un bloque de enums que `SkinManager` expone como `computed`. |

### 1.1 Cómo se dibuja lo estético sin código nativo

En esta pantalla todos los elementos con marco tienen **alto fijo**: pestañas, botones, filas de
64px, el mini player y el menú inferior. Solo varía el ancho. Por eso no hace falta un 9-slice:

- **Tamaño fijo** (botones del header de 40px, Play de 44px, carátula de 52px, iconos del menú): un
  solo `<image>` del tamaño exacto encima o detrás del componente. Puede sobresalir con márgenes
  negativos, como las espinas del gótico.
- **Ancho variable** (pestañas, Aleatorio, mini player, fila activa, marco de la barra de estado):
  **3-slice horizontal**. Tres `<image>` en una fila absoluta detrás del contenido: tapa izquierda
  de ancho fijo, centro con `resizeMode="stretch"` o `"repeat"` y `flex: 1`, tapa derecha de ancho
  fijo. La skin declara cada marco como `{left, middle, right, capWidth}`.
- **Alto y ancho variables** (no hay ninguno en Álbumes; aparecerá en `Sheet`, cuya altura depende
  del contenido): el mismo patrón con 9 `<image>`, una cuadrícula de 3×3.

`SkinFrame` tiene entonces tres modos:

| Modo | Para | Cómo |
|---|---|---|
| `image` | Marcos y texturas del gótico | `<image>` único o 3-slice, más la textura en `repeat` debajo |
| `chamfer` | Bisel y corchetes del neón | Un SVG **calculado**: el componente mide su ancho y alto con `(layout)`, un `computed()` arma la ruta del contorno biselado y de los corchetes con esas medidas, y se pinta con `ng-icon` `[svg]`. Así las esquinas no se deforman, como pasaría al estirar un SVG fijo. |
| `none` | Las skins actuales | Sin marco: radio y borde de los tokens, como hoy |

El resto de efectos:

| Efecto del mockup | Cómo |
|---|---|
| Recortar la carátula con bisel | `ng-icon` no dibuja `<image>` dentro de un SVG, así que el marco tapa las esquinas con triángulos del color del marco por encima de la imagen |
| Brillo neón | `box-shadow` y `text-shadow` con los tokens de `effects`. Para un brillo exacto, un PNG con el halo ya difuminado detrás del elemento |
| Ornamentos | `SkinOrnament`: `<image>` absoluto en un ancla |
| Capa sobre la lista (enredaderas, notas) | Un `<image>` encima de la lista con `pointerEvents="none"`, como `SkinBackdrop` pero por arriba |
| Marco HUD de la barra de estado | Un `<image>` absoluto en la vista raíz, con la altura del margen superior del área segura |
| Iconos ilustrados | `<image>` dentro de `SkinIcon` cuando el hueco es un PNG |
| Iconos de dos colores | Ya funcionan como SVG |
| Onda del mini player, ecualizador por fila | Vistas animadas, como hace `Visualizer` |

**Límite de tamaño.** `MAX_SKIN_FILE_BYTES` es de 4 MB
([`skin-manager.ts:23`](../src/app/skins/skin-manager.ts#L23)) y cada imagen puede pesar hasta 3 MB.
El gótico necesita unas 10–15 imágenes (marcos en 3-slice, texturas, ornamentos, iconos), así que
no cabe en un JSON con base64. Hace falta un formato de paquete (un zip con `skin.json` y las imágenes con rutas
relativas), o al menos subir mucho el límite.

**Refactor previo** para que cada personalización se haga en un solo sitio:

- Los botones del header son pressables propios: `.language` en
  [`app.ts:58`](../src/app/app.ts#L58), [`app.ts:68`](../src/app/app.ts#L68) y
  [`app.ts:77`](../src/app/app.ts#L77).
- Las pestañas de vista están metidas dentro de
  [`library-screen.ts:71`](../src/app/library/library-screen.ts#L71).
- `.actions` y `.count` están duplicados en
  [`library-screen.ts:114`](../src/app/library/library-screen.ts#L114) y
  [`catalog-list.ts:43`](../src/app/catalog/catalog-list.ts#L43).
- La fila de catálogo y `TrackRow` repiten estilos, entre ellos la miniatura
  `[size]="44" [radius]="6"` en 3 sitios:
  [`catalog-list.ts:60`](../src/app/catalog/catalog-list.ts#L60),
  [`track-row.ts:34`](../src/app/library/track-row.ts#L34) y
  [`catalog-detail.ts:136`](../src/app/catalog/catalog-detail.ts#L136).

## 2. Por componente

### AppHeader ([`app.ts`](../src/app/app.ts))

- **Valores fijos hoy:** botones de 28px, `letter-spacing: 3px`
  ([`app.ts:157`](../src/app/app.ts#L157)), logo en `sk-accent` y nombre de la skin siempre visible.
- **Falta:**
  - Pasar los 3 botones a `SkinButton` con un input nuevo `role="header"`, para que una skin les dé
    tamaño y forma propios. El gótico usa cuadrados de 40px con marco de piedra (un `<image>` del
    tamaño exacto); el neón deja Buscar sin fondo, pone Ajustes biselado (SVG calculado) e Idioma
    relleno.
  - `components.header.buttons: { search, settings, language }`: la variante de cada botón.
  - Color y fuente del logo propios (`--sk-logo-*`), más `text-shadow` para el brillo del neón.
  - `components.header.showSkinName`: el gótico lo oculta.
  - Anclas `header.top` y `logo.below` para la filigrana y las máscaras.
  - **Marco de la barra de estado (neón):** hoy `safe-area-view` usa `edges: top`
    ([`app.ts:52`](../src/app/app.ts#L52)) y ese margen se pinta con el fondo. Hace falta una capa
    absoluta en `.root`, como `SkinBackdrop`, con altura igual al margen superior, donde dibujar el
    marco `statusBar` en 3-slice.

### LibraryViewTabs ([`library-screen.ts:71`](../src/app/library/library-screen.ts#L71))

- **Valores fijos hoy:** sin fondo, subrayado de 2px en `sk-accent`
  ([`library-screen.ts:168`](../src/app/library/library-screen.ts#L168)).
- **Falta:**
  - Extraerlo a su propio componente.
  - `components.viewTabs.style: 'underline' | 'filled'`.
  - Tokens de fondo y texto para el estado normal y el activo; el grosor del subrayado como token.
  - `SkinFrame` con las piezas `tab` y `tabActive`: pergamino en 3-slice con textura en el gótico;
    bisel calculado con corchetes rosa y brillo en el neón.
  - Ancla `tabs.activeBelow`: se renderiza dentro de la pestaña activa, en posición absoluta abajo,
    así no hay que medir.
  - Ancla `tabs.below` para la línea de circuito del neón.

### ListActions ([`catalog-list.ts:43`](../src/app/catalog/catalog-list.ts#L43))

- **Falta:**
  - Extraer el componente (hoy está duplicado).
  - Anclas `count.after` (la aguja del gótico, los galones del neón) y `actions.before` (la onda del
    neón).
  - Los botones heredan lo que se añada a `SkinButton`.

### SkinButton ([`skin-button.ts`](../src/app/skins/skin-button.ts))

- **Valores fijos hoy:** `ICON_SIZES` ([`skin-button.ts:9`](../src/app/skins/skin-button.ts#L9)) y
  alturas 34/44/68.
- **Falta:**
  - Un input `role` (`header`, `sort`, `shuffle`, `play`, `more`…) para que la skin pueda tratar
    distinto cada botón.
  - Envolverlo en `SkinFrame`: en el gótico, un `<image>` del tamaño exacto si el botón es solo
    icono, o un 3-slice con textura si lleva etiqueta; en el neón, bisel calculado con corchetes.
  - Brillo con `box-shadow: var(--sk-glow)`.
  - Variante nueva `outline` / `ring` para Play: aro sin relleno.
  - Tamaños de icono y alturas desde tokens.

### CatalogRow + TrackRow ([`catalog-list.ts:102`](../src/app/catalog/catalog-list.ts#L102), [`track-row.ts`](../src/app/library/track-row.ts))

- **Valores fijos hoy:**
  - La fila que suena es solo fondo `sk-surface` más título en acento
    ([`catalog-list.ts:115`](../src/app/catalog/catalog-list.ts#L115)).
  - El separador depende de `--sk-border-width`, el borde global de toda la skin.
  - La altura de 64px está fija en el `itemHeight` de la lista virtual.
- **Falta:**
  - Tokens `rowCurrent*` y `SkinFrame` con la pieza `rowCurrent`: panel translúcido con corchetes
    (bisel calculado) en el neón.
  - `components.row.separator` independiente del borde global.
  - Un hueco al final de la fila para un **indicador de ecualizador**: un componente nuevo que reusa
    la lógica de `Visualizer` con 3–5 barras, con
    `components.row.indicator: 'none' | 'playing' | 'always'`.
  - La altura de fila desde la skin: el marco de espinas del gótico sobresale de los 44px de la
    miniatura.

### CoverArt ([`cover-art.ts`](../src/app/library/cover-art.ts))

- **Falta:**
  - El radio de la miniatura como token (hoy los que la llaman pasan `6` a mano).
  - Marco por encima de la imagen con las piezas `coverThumb` y `cover`: un `<image>` de espinas del
    tamaño exacto en el gótico; corchetes de neón en SVG en el neón, que también tapan las esquinas
    para simular el bisel.
  - Brillo.
  - Un modo sin caja para el mini player del neón, que muestra solo el icono.

### MiniPlayer ([`mini-player.ts`](../src/app/player/mini-player.ts)) + Display + Visualizer

- **Valores fijos hoy:** `widgets.miniDisplay` es un booleano
  ([`mini-player.ts:28`](../src/app/player/mini-player.ts#L28)), la barra de progreso está siempre
  visible y todos los botones son `small`.
- **Falta:**
  - `SkinFrame` con la pieza `widget`: metal con espinas en 3-slice en el gótico; bisel calculado
    cian con detalles en `accentAlt` en el neón.
  - Cambiar `miniDisplay` por `components.mini.readout: 'display' | 'visualizer' | 'none'`. Para eso
    `Visualizer` necesita un modo compacto: hoy tiene `height: 64px` fijo y su propio panel
    ([`visualizer.ts:22`](../src/app/player/visualizer.ts#L22)).
  - `components.mini.play: 'primary' | 'ring'` y su tamaño (44px en ambos mockups).
  - `components.mini.progress` (visible u oculto) y `components.mini.cover: 'box' | 'icon'`.
  - Un token de color para los botones Anterior y Siguiente: plata en el gótico, cian en el neón.
  - `Display`: solo le falta el brillo de texto opcional.

### TabMenu ([`tab-menu.ts`](../src/app/shared/tab-menu.ts))

- **Valores fijos hoy:** icono de 22px ([`tab-menu.ts:32`](../src/app/shared/tab-menu.ts#L32)) y la
  pestaña activa siempre es una píldora ([`tab-menu.ts:62`](../src/app/shared/tab-menu.ts#L62)).
- **Falta:**
  - `components.tabMenu.active: 'pill' | 'glow' | 'none'`; el halo es un `box-shadow` del color de
    brillo.
  - Tamaño de icono desde la skin (~40px en ambos mockups).
  - Iconos raster para el gótico, vía `SkinIcon`. Los de dos colores del neón ya funcionan si se
    entregan como SVG.
  - Un borde superior con brillo, o el ancla `tabMenu.top`.

### SkinBackdrop / SkinIcon

- `SkinBackdrop` ([`skin-backdrop.ts`](../src/app/skins/skin-backdrop.ts)) ya cubre la ilustración
  de fondo de los dos mockups. Le falta una capa *por encima* de la lista, para las enredaderas y las
  notas musicales: el ancla `list.overlay`, con `pointerEvents="none"`.
- `SkinIcon` ([`skin-icon.ts`](../src/app/skins/skin-icon.ts)) necesita aceptar raster y un tamaño
  por hueco.

## 3. Orden recomendado

1. **`effects` y colores nuevos.** Es barato, y solo con esto el neón ya se acerca bastante.
2. **El refactor**: header, pestañas, acciones y filas como componentes.
3. **Enums `components.*`**, `Visualizer` compacto e indicador de fila.
4. **`SkinOrnament`** y la capa sobre la lista.
5. **`SkinFrame` en modo `chamfer`** (SVG calculado). Con esto el neón queda completo.
6. **`SkinFrame` en modo `image`** (imagen única y 3-slice), texturas e iconos raster. Todo con
   `<image>`, sin código nativo.
7. **Formato de paquete** (zip con `skin.json` e imágenes). Con esto el gótico queda completo: es lo
   que más pesa del plan, porque toca la importación y el almacenamiento de skins.
