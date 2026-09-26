# Mercado MTG

Mercado de cartas de Magic: The Gathering hecho con Google Apps Script.

- `Código.js`: backend (Apps Script). Guarda usuarios, listados y mensajes en una hoja de Google Sheets.
- `Index.html`: la interfaz web.
- `appsscript.json`: configuración del proyecto.

La app funciona desde el despliegue de Apps Script, no desde GitHub Pages.
Para sincronizar cambios se usa [clasp](https://github.com/google/clasp): `clasp pull` / `clasp push`.
