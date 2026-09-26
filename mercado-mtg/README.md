# Mercado MTG

Mercado de cartas de Magic: The Gathering hecho con Google Apps Script.

Se abre en: https://gato7790.github.io/mercado-mtg/

- `index.html`: página de GitHub Pages que muestra la app de Apps Script a pantalla completa.
- `apps-script/Código.js`: backend (Apps Script). Guarda usuarios, listados y mensajes en una hoja de Google Sheets.
- `apps-script/Index.html`: la interfaz web.
- `apps-script/appsscript.json`: configuración del proyecto.

Para sincronizar cambios con Apps Script se usa [clasp](https://github.com/google/clasp) desde la carpeta `apps-script/`: `clasp pull` / `clasp push`.
