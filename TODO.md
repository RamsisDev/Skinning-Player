# TODO

## Cambiar portada

- [x] Cuando la portada ya se cambió, cerrar el popup (`src/app/songs/cover-sheet.ts`) y mostrar
      un mensaje de que se cambió con éxito.

## Recarga de la biblioteca

- [ ] Que la biblioteca no se recargue todo el rato: la recarga solo debe hacerse desde un
      apartado de Ajustes. Revisar qué la dispara (`src/app/library/music-library.ts`; el ajuste
      `library.autoReload` ya viene desactivado por defecto, así que la causa puede estar en otro
      sitio, por ejemplo al cambiar una portada).

## Audios de WhatsApp

- [x] No indexar los audios de WhatsApp (notas de voz y audios recibidos).
- [x] Android: se excluyen por carpeta (`src/app/library/library-content.ts`), con el ajuste
      «Excluir lo que no es música», que viene activado.
- [x] iOS: no hace falta. La biblioteca de medios de iOS no ve los audios de WhatsApp, que se
      quedan en el almacenamiento propio de la app.
