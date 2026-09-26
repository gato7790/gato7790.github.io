var SHEET_NAME = 'Listados';
// Índices (0-based): 0 ID, 1 Fecha, 2 CartaNombre, 3 SetNombre, 4 SetCode, 5 Coleccionista,
// 6 ImagenURL, 7 PrecioUsdRef, 8 PrecioSugeridoUsd, 9 PrecioSugeridoPen, 10 Condicion,
// 11 PrecioVendedorPen, 12 WhatsApp, 13 Activo, 14 Cantidad, 15 Vendedor, 16 EsFoil
var HEADERS = ['ID', 'Fecha', 'CartaNombre', 'SetNombre', 'SetCode', 'Coleccionista', 'ImagenURL',
  'PrecioUsdRef', 'PrecioSugeridoUsd', 'PrecioSugeridoPen', 'Condicion', 'PrecioVendedorPen',
  'WhatsApp', 'Activo', 'Cantidad', 'Vendedor', 'EsFoil'];

var USUARIOS_SHEET_NAME = 'Usuarios';
var USUARIOS_HEADERS = ['ID', 'Nick', 'NickNorm', 'PasswordHash', 'Salt', 'Urbanizacion', 'Distrito', 'GrupoKey', 'Fecha'];

var SESIONES_SHEET_NAME = 'Sesiones';
var SESIONES_HEADERS = ['Token', 'NickNorm', 'Fecha'];

var MENSAJES_SHEET_NAME = 'Mensajes';
var MENSAJES_HEADERS = ['ID', 'GrupoKey', 'Nick', 'Texto', 'Fecha'];

var MULTIPLICADOR = 3; // referencia: precio Scryfall (USD) x este factor
var FX_CACHE_KEY = 'fx_usd_pen';
var FX_CACHE_SECONDS = 6 * 60 * 60; // 6 horas

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Mercado MTG')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

var SPREADSHEET_ID = '1qUBPiAmY-dm7pS42q22gLcgYUVsZqa_okU1me-fJGPE';

function getSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getUsuariosSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(USUARIOS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(USUARIOS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(USUARIOS_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSesionesSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SESIONES_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SESIONES_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SESIONES_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getMensajesSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(MENSAJES_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(MENSAJES_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(MENSAJES_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function normalizarTexto_(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function getTipoCambio_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(FX_CACHE_KEY);
  if (cached) return parseFloat(cached);

  var rate = 3.75; // respaldo fijo si la API externa falla
  try {
    var res = UrlFetchApp.fetch('https://open.er-api.com/v6/latest/USD', { muteHttpExceptions: true });
    var json = JSON.parse(res.getContentText());
    if (json && json.result === 'success' && json.rates && json.rates.PEN) {
      rate = json.rates.PEN;
    }
  } catch (e) {
    // usa el valor de respaldo
  }
  cache.put(FX_CACHE_KEY, String(rate), FX_CACHE_SECONDS);
  return rate;
}

var SCRYFALL_HEADERS = {
  'User-Agent': 'MercadoMTG-AppsScript/1.0',
  'Accept': 'application/json'
};

function buscarSugerencias(query) {
  query = (query || '').toString().trim();
  if (query.length < 2) return [];
  try {
    var res = UrlFetchApp.fetch('https://api.scryfall.com/cards/autocomplete?q=' + encodeURIComponent(query),
      { muteHttpExceptions: true, headers: SCRYFALL_HEADERS });
    if (res.getResponseCode() !== 200) return [];
    var json = JSON.parse(res.getContentText());
    return (json.data || []).slice(0, 8);
  } catch (e) {
    return [];
  }
}

// Trae TODAS las ediciones/impresiones (arte, set, foil) de una carta, cada una con su propio precio.
function obtenerImpresiones(nombreExacto) {
  nombreExacto = (nombreExacto || '').toString().trim();
  if (!nombreExacto) throw new Error('Escribe el nombre de una carta.');

  var q = '!"' + nombreExacto + '" game:paper';
  var url = 'https://api.scryfall.com/cards/search?order=released&dir=desc&unique=prints&q=' + encodeURIComponent(q);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: SCRYFALL_HEADERS });
  if (res.getResponseCode() !== 200) throw new Error('No se encontró esa carta en Scryfall.');
  var json = JSON.parse(res.getContentText());
  var fx = getTipoCambio_();

  var impresiones = (json.data || []).map(function (card) {
    var imageUrl = '';
    if (card.image_uris && card.image_uris.normal) {
      imageUrl = card.image_uris.normal;
    } else if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
      imageUrl = card.card_faces[0].image_uris.normal;
    }
    var usd = card.prices && card.prices.usd ? parseFloat(card.prices.usd) : null;
    var usdFoil = card.prices && card.prices.usd_foil ? parseFloat(card.prices.usd_foil) : null;
    return {
      nombre: card.name,
      setNombre: card.set_name,
      setCode: (card.set || '').toUpperCase(),
      coleccionista: card.collector_number,
      lanzamiento: card.released_at,
      imagenUrl: imageUrl,
      usd: usd,
      usdFoil: usdFoil,
      tieneNoFoil: !!card.nonfoil,
      tieneFoil: !!card.foil
    };
  });

  if (!impresiones.length) throw new Error('No se encontró esa carta en Scryfall.');
  return { impresiones: impresiones, multiplicador: MULTIPLICADOR, tipoCambio: fx };
}

// ---------- cuentas / sesiones ----------

function hashPassword_(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + '::' + salt);
  return raw.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function crearSesion_(nickNorm, nick, urbanizacion, distrito, grupoKey) {
  var token = Utilities.getUuid() + Utilities.getUuid();
  var sesiones = getSesionesSheet_();
  sesiones.appendRow([token, nickNorm, new Date()]);
  return { token: token, nick: nick, urbanizacion: urbanizacion || '', distrito: distrito || '', grupoKey: grupoKey || '' };
}

function registrarUsuario(nick, password, urbanizacion, distrito) {
  nick = (nick || '').toString().trim();
  password = (password || '').toString();
  if (nick.length < 3 || nick.length > 24) throw new Error('El nick debe tener entre 3 y 24 caracteres.');
  if (!/^[A-Za-z0-9_\-]+$/.test(nick)) throw new Error('El nick solo puede tener letras, números, guion y guion bajo.');
  if (password.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');

  var nickNorm = nick.toLowerCase();
  var sheet = getUsuariosSheet_();
  var last = sheet.getLastRow();
  if (last >= 2) {
    var nicks = sheet.getRange(2, 3, last - 1, 1).getValues();
    for (var i = 0; i < nicks.length; i++) {
      if (nicks[i][0] === nickNorm) throw new Error('Ese nick ya está en uso.');
    }
  }

  var salt = Utilities.getUuid();
  var hash = hashPassword_(password, salt);
  var urb = (urbanizacion || '').toString().trim();
  var dist = (distrito || '').toString().trim();
  var grupoKey = (urb && dist) ? normalizarTexto_(urb + '|' + dist) : '';

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    sheet.appendRow([Utilities.getUuid(), nick, nickNorm, hash, salt, urb, dist, grupoKey, new Date()]);
  } finally {
    lock.releaseLock();
  }
  return crearSesion_(nickNorm, nick, urb, dist, grupoKey);
}

function iniciarSesion(nick, password) {
  nick = (nick || '').toString().trim();
  password = (password || '').toString();
  var nickNorm = nick.toLowerCase();
  var sheet = getUsuariosSheet_();
  var last = sheet.getLastRow();
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, USUARIOS_HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      if (row[2] === nickNorm) {
        var hash = hashPassword_(password, row[4]);
        if (hash !== row[3]) throw new Error('Nick o contraseña incorrectos.');
        return crearSesion_(nickNorm, row[1], row[5], row[6], row[7]);
      }
    }
  }
  throw new Error('Nick o contraseña incorrectos.');
}

function obtenerUsuarioPorToken_(token) {
  token = (token || '').toString();
  if (!token) return null;
  var sesiones = getSesionesSheet_();
  var last = sesiones.getLastRow();
  if (last < 2) return null;
  var values = sesiones.getRange(2, 1, last - 1, SESIONES_HEADERS.length).getValues();
  var nickNorm = null;
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === token) { nickNorm = values[i][1]; break; }
  }
  if (!nickNorm) return null;

  var usuarios = getUsuariosSheet_();
  var ulast = usuarios.getLastRow();
  if (ulast < 2) return null;
  var uvalues = usuarios.getRange(2, 1, ulast - 1, USUARIOS_HEADERS.length).getValues();
  for (var j = 0; j < uvalues.length; j++) {
    if (uvalues[j][2] === nickNorm) {
      return { nick: uvalues[j][1], nickNorm: nickNorm, urbanizacion: uvalues[j][5], distrito: uvalues[j][6], grupoKey: uvalues[j][7] };
    }
  }
  return null;
}

function validarSesion(token) {
  var u = obtenerUsuarioPorToken_(token);
  if (!u) throw new Error('Sesión inválida.');
  u.token = token;
  return u;
}

function cerrarSesion(token) {
  token = (token || '').toString();
  var sesiones = getSesionesSheet_();
  var last = sesiones.getLastRow();
  if (last < 2) return true;
  var values = sesiones.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === token) { sesiones.deleteRow(i + 2); break; }
  }
  return true;
}

function actualizarUbicacion(token, urbanizacion, distrito) {
  var user = obtenerUsuarioPorToken_(token);
  if (!user) throw new Error('Debes iniciar sesión.');
  var urb = (urbanizacion || '').toString().trim();
  var dist = (distrito || '').toString().trim();
  var grupoKey = (urb && dist) ? normalizarTexto_(urb + '|' + dist) : '';

  var usuarios = getUsuariosSheet_();
  var last = usuarios.getLastRow();
  var values = usuarios.getRange(2, 1, last - 1, USUARIOS_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][2] === user.nickNorm) {
      usuarios.getRange(i + 2, 6, 1, 3).setValues([[urb, dist, grupoKey]]);
      break;
    }
  }
  return { nick: user.nick, urbanizacion: urb, distrito: dist, grupoKey: grupoKey };
}

// ---------- publicar / listar cartas ----------

function publicarListado(token, data) {
  var user = obtenerUsuarioPorToken_(token);
  if (!user) throw new Error('Debes iniciar sesión para publicar.');

  data = data || {};
  var cartaNombre = (data.cartaNombre || '').toString().trim();
  var setNombre = (data.setNombre || '').toString().trim();
  var setCode = (data.setCode || '').toString().trim();
  var coleccionista = (data.coleccionista || '').toString().trim();
  var imagenUrl = (data.imagenUrl || '').toString().trim();
  var precioUsdRef = data.precioUsdRef != null ? Number(data.precioUsdRef) : null;
  var precioSugeridoUsd = data.precioSugeridoUsd != null ? Number(data.precioSugeridoUsd) : null;
  var precioSugeridoPen = data.precioSugeridoPen != null ? Number(data.precioSugeridoPen) : null;
  var condicion = (data.condicion || '').toString().trim();
  var precioVendedorPen = Number(data.precioVendedorPen);
  var whatsapp = (data.whatsapp || '').toString().replace(/[^0-9]/g, '');
  var esFoil = !!data.esFoil;

  if (!cartaNombre) throw new Error('Falta el nombre de la carta.');
  if (!condicion) throw new Error('Selecciona la condición de la carta.');
  if (!precioVendedorPen || precioVendedorPen <= 0) throw new Error('Ingresa un precio válido en soles.');
  if (precioVendedorPen > 50000) throw new Error('Ese precio parece incorrecto.');
  if (!whatsapp || whatsapp.length < 9) throw new Error('Ingresa un número de WhatsApp válido (con código de país).');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var id = Utilities.getUuid();
    sheet.appendRow([
      id, new Date(), cartaNombre, setNombre, setCode, coleccionista, imagenUrl, precioUsdRef,
      precioSugeridoUsd, precioSugeridoPen, condicion, precioVendedorPen, whatsapp, true, 1, user.nick, esFoil
    ]);
  } finally {
    lock.releaseLock();
  }
  return listarListados('');
}

function publicarListadoMasivo(token, items, whatsapp) {
  var user = obtenerUsuarioPorToken_(token);
  if (!user) throw new Error('Debes iniciar sesión para publicar.');

  items = items || [];
  whatsapp = (whatsapp || '').toString().replace(/[^0-9]/g, '');
  if (!items.length) throw new Error('No hay cartas para publicar.');
  if (!whatsapp || whatsapp.length < 9) throw new Error('Ingresa un número de WhatsApp válido (con código de país).');

  var rows = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var cartaNombre = (it.cartaNombre || '').toString().trim();
    var condicion = (it.condicion || 'NM').toString().trim();
    var precioVendedorPen = Number(it.precioVendedorPen);
    var cantidad = Number(it.cantidad) || 1;
    if (!cartaNombre || !precioVendedorPen || precioVendedorPen <= 0) continue;
    rows.push([
      Utilities.getUuid(), new Date(), cartaNombre, it.setNombre || '', it.setCode || '', it.coleccionista || '', it.imagenUrl || '',
      it.precioUsdRef != null ? it.precioUsdRef : '',
      it.precioSugeridoUsd != null ? it.precioSugeridoUsd : '',
      it.precioSugeridoPen != null ? it.precioSugeridoPen : '',
      condicion, precioVendedorPen, whatsapp, true, cantidad, user.nick, !!it.esFoil
    ]);
  }
  if (!rows.length) throw new Error('Ninguna carta tenía un precio válido para publicar.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return listarListados('');
}

function listarListados(filtro) {
  filtro = (filtro || '').toString().toLowerCase().trim();
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[0] || row[13] === false) continue;
    var nombre = row[2];
    if (filtro && nombre.toString().toLowerCase().indexOf(filtro) === -1) continue;
    out.push({
      id: row[0],
      ts: row[1] instanceof Date ? row[1].getTime() : new Date(row[1]).getTime(),
      cartaNombre: nombre,
      setNombre: row[3],
      setCode: row[4],
      coleccionista: row[5],
      imagenUrl: row[6],
      precioUsdRef: row[7],
      precioSugeridoUsd: row[8],
      precioSugeridoPen: row[9],
      condicion: row[10],
      precioVendedorPen: row[11],
      whatsapp: row[12],
      cantidad: row[14] || 1,
      vendedor: row[15] || '',
      esFoil: !!row[16]
    });
  }
  out.sort(function (a, b) { return b.ts - a.ts; });
  return out;
}

function listarMisListados(token) {
  var user = obtenerUsuarioPorToken_(token);
  if (!user) throw new Error('Debes iniciar sesión.');
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[0] || row[13] === false) continue;
    if ((row[15] || '') !== user.nick) continue;
    out.push({
      id: row[0],
      ts: row[1] instanceof Date ? row[1].getTime() : new Date(row[1]).getTime(),
      cartaNombre: row[2],
      setNombre: row[3],
      setCode: row[4],
      coleccionista: row[5],
      imagenUrl: row[6],
      condicion: row[10],
      precioVendedorPen: row[11],
      whatsapp: row[12],
      cantidad: row[14] || 1,
      esFoil: !!row[16]
    });
  }
  out.sort(function (a, b) { return b.ts - a.ts; });
  return out;
}

function actualizarPrecioListado(token, id, nuevoPrecio) {
  var user = obtenerUsuarioPorToken_(token);
  if (!user) throw new Error('Debes iniciar sesión.');
  nuevoPrecio = Number(nuevoPrecio);
  if (!nuevoPrecio || nuevoPrecio <= 0) throw new Error('Ingresa un precio válido.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var last = sheet.getLastRow();
    var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      if (values[i][0] === id) {
        if ((values[i][15] || '') !== user.nick) throw new Error('No puedes editar una publicación que no es tuya.');
        sheet.getRange(i + 2, 12).setValue(nuevoPrecio);
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
  return listarMisListados(token);
}

function eliminarListado(token, id) {
  var user = obtenerUsuarioPorToken_(token);
  if (!user) throw new Error('Debes iniciar sesión.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var last = sheet.getLastRow();
    var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      if (values[i][0] === id) {
        if ((values[i][15] || '') !== user.nick) throw new Error('No puedes eliminar una publicación que no es tuya.');
        sheet.getRange(i + 2, 14).setValue(false);
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
  return listarMisListados(token);
}

// ---------- social: ubicación y chat grupal ----------

function obtenerGrupoInfo(token) {
  var user = obtenerUsuarioPorToken_(token);
  if (!user) throw new Error('Debes iniciar sesión.');
  if (!user.grupoKey) return { tieneGrupo: false };

  var usuarios = getUsuariosSheet_();
  var last = usuarios.getLastRow();
  var count = 0;
  if (last >= 2) {
    var values = usuarios.getRange(2, 1, last - 1, USUARIOS_HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      if (values[i][7] === user.grupoKey) count++;
    }
  }
  return { tieneGrupo: true, urbanizacion: user.urbanizacion, distrito: user.distrito, miembros: count };
}

function listarMensajes(token) {
  var user = obtenerUsuarioPorToken_(token);
  if (!user) throw new Error('Debes iniciar sesión.');
  if (!user.grupoKey) return [];

  var sheet = getMensajesSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, MENSAJES_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (row[1] !== user.grupoKey) continue;
    out.push({
      id: row[0],
      nick: row[2],
      texto: row[3],
      ts: row[4] instanceof Date ? row[4].getTime() : new Date(row[4]).getTime()
    });
  }
  out.sort(function (a, b) { return a.ts - b.ts; });
  return out.slice(-150);
}

function enviarMensaje(token, texto) {
  var user = obtenerUsuarioPorToken_(token);
  if (!user) throw new Error('Debes iniciar sesión.');
  if (!user.grupoKey) throw new Error('Registra tu urbanización y distrito para entrar al chat.');
  texto = (texto || '').toString().trim();
  if (!texto) throw new Error('Escribe un mensaje.');
  if (texto.length > 500) throw new Error('El mensaje es demasiado largo.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getMensajesSheet_();
    sheet.appendRow([Utilities.getUuid(), user.grupoKey, user.nick, texto, new Date()]);
  } finally {
    lock.releaseLock();
  }
  return listarMensajes(token);
}

// ---------- importación masiva desde Moxfield ----------

var SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';

function splitCsvLine_(line) {
  var result = [];
  var cur = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parseMoxfieldTexto_(texto) {
  var lines = (texto || '').toString().split(/\r?\n/);
  var firstNonEmpty = '';
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { firstNonEmpty = lines[i]; break; }
  }
  var isCsv = firstNonEmpty.indexOf(',') !== -1 && /name/i.test(firstNonEmpty) && /count/i.test(firstNonEmpty);

  var counts = {};
  function addCard(nombre, cantidad, esFoil, edicionTexto) {
    nombre = (nombre || '').toString().trim();
    if (!nombre) return;
    var qty = parseInt(cantidad, 10);
    if (!qty || qty < 1) qty = 1;
    var key = nombre.toLowerCase() + (esFoil ? '::foil' : '');
    if (!counts[key]) counts[key] = { display: nombre, cantidad: 0, esFoil: !!esFoil, edicionTexto: edicionTexto || '' };
    counts[key].cantidad += qty;
  }

  if (isCsv) {
    var header = splitCsvLine_(lines[0]);
    var nameIdx = -1, countIdx = -1, foilIdx = -1, edicionIdx = -1;
    for (var c = 0; c < header.length; c++) {
      var h = header[c].trim().toLowerCase();
      if (h === 'name') nameIdx = c;
      if (h === 'count') countIdx = c;
      if (h === 'foil') foilIdx = c;
      if (h === 'edition') edicionIdx = c;
    }
    if (nameIdx === -1) {
      for (var c2 = 0; c2 < header.length; c2++) {
        if (header[c2].toLowerCase().indexOf('name') !== -1) { nameIdx = c2; break; }
      }
    }
    if (nameIdx === -1) throw new Error('No se encontró una columna de nombre ("Name") en el CSV pegado.');
    for (var r = 1; r < lines.length; r++) {
      if (!lines[r].trim()) continue;
      var cols = splitCsvLine_(lines[r]);
      var foilVal = foilIdx !== -1 ? (cols[foilIdx] || '').toString().trim().toLowerCase() : '';
      var esFoilCsv = foilVal && foilVal !== 'false' && foilVal !== 'no' && foilVal !== '0' && foilVal !== 'normal';
      var edicion = edicionIdx !== -1 ? (cols[edicionIdx] || '').toString().trim() : '';
      addCard(cols[nameIdx], countIdx !== -1 ? cols[countIdx] : 1, esFoilCsv, edicion);
    }
  } else {
    var re = /^\s*(\d+)\s*x?\s+(.+)$/i;
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j].trim();
      if (!line) continue;
      var m = line.match(re);
      var nombre, qty2;
      if (m) { qty2 = m[1]; nombre = m[2]; } else { qty2 = 1; nombre = line; }
      var esFoilTxt = /\*F\*\s*$/i.test(nombre);
      nombre = nombre.replace(/\s*[\(\[][A-Za-z0-9]{2,6}[\)\]]\s*\S*\s*$/, '').trim();
      nombre = nombre.replace(/\s*\*F\*\s*$/i, '').trim();
      addCard(nombre, qty2, esFoilTxt, '');
    }
  }

  var out = [];
  for (var k in counts) out.push(counts[k]);
  return out;
}

function importarDesdeMoxfield(texto) {
  var items = parseMoxfieldTexto_(texto);
  if (!items.length) throw new Error('No se detectaron cartas en el texto pegado.');
  if (items.length > 300) throw new Error('Demasiadas cartas distintas (' + items.length + '). Máximo 300 por importación.');

  var fx = getTipoCambio_();
  var encontradas = [];
  var noEncontradas = [];

  for (var i = 0; i < items.length; i += 75) {
    var batch = items.slice(i, i + 75);
    var identifiers = batch.map(function (it) { return { name: it.display }; });
    var res = UrlFetchApp.fetch(SCRYFALL_COLLECTION_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ identifiers: identifiers }),
      muteHttpExceptions: true,
      headers: SCRYFALL_HEADERS
    });
    if (res.getResponseCode() !== 200) {
      batch.forEach(function (it) { noEncontradas.push(it.display); });
      continue;
    }
    var json = JSON.parse(res.getContentText());
    var byKey = {};
    batch.forEach(function (it) { byKey[it.display.toLowerCase()] = it; });

    (json.data || []).forEach(function (card) {
      var orig = byKey[card.name.toLowerCase()];
      var imageUrl = '';
      if (card.image_uris && card.image_uris.normal) {
        imageUrl = card.image_uris.normal;
      } else if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
        imageUrl = card.card_faces[0].image_uris.normal;
      }
      var esFoil = !!(orig && orig.esFoil);
      var usdNormal = card.prices && card.prices.usd ? parseFloat(card.prices.usd) : null;
      var usdFoil = card.prices && card.prices.usd_foil ? parseFloat(card.prices.usd_foil) : null;
      var usd = esFoil && usdFoil != null ? usdFoil : usdNormal;
      var precioSugeridoUsd = usd != null ? Math.round(usd * MULTIPLICADOR * 100) / 100 : null;
      var precioSugeridoPen = precioSugeridoUsd != null ? Math.round(precioSugeridoUsd * fx * 100) / 100 : null;
      encontradas.push({
        cartaNombre: card.name,
        setNombre: card.set_name,
        setCode: (card.set || '').toUpperCase(),
        coleccionista: card.collector_number,
        imagenUrl: imageUrl,
        usd: usd,
        esFoil: esFoil,
        edicionTexto: orig ? orig.edicionTexto : '',
        precioSugeridoUsd: precioSugeridoUsd,
        precioSugeridoPen: precioSugeridoPen,
        cantidad: orig ? orig.cantidad : 1
      });
    });
    (json.not_found || []).forEach(function (nf) {
      noEncontradas.push(nf.name || JSON.stringify(nf));
    });
  }

  return { encontradas: encontradas, noEncontradas: noEncontradas, tipoCambio: fx };
}


function testDumpListados(){
  var ss = SpreadsheetApp.openById('1qUBPiAmY-dm7pS42q22gLcgYUVsZqa_okU1me-fJGPE');
  var sheet = ss.getSheetByName('Listados');
  var last = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  Logger.log('lastRow=' + last + ' lastCol=' + lastCol);
  var values = sheet.getRange(1, 1, last, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    Logger.log('Fila ' + (i+1) + ': ' + JSON.stringify(values[i]));
  }
}

function previewMigracion(){
  var ss = SpreadsheetApp.openById('1qUBPiAmY-dm7pS42q22gLcgYUVsZqa_okU1me-fJGPE');
  var sheet = ss.getSheetByName('Listados');
  var last = sheet.getLastRow();
  var oldValues = sheet.getRange(2, 1, last - 1, 14).getValues();
  var newRows = oldValues.map(function(r){
    return [
      r[0], r[1], r[2], r[3], '', '', r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11],
      r[12] || 1, r[13] || '', false
    ];
  });
  Logger.log('Filas a migrar: ' + newRows.length);
  for (var i = 0; i < newRows.length; i++) {
    Logger.log('Nueva fila ' + (i+1) + ': ' + JSON.stringify(newRows[i]));
  }
}
