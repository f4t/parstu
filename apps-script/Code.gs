/**
 * Backend covoiturage evenement - Google Apps Script Web App
 * ------------------------------------------------------------------
 * Colonne "token" JAMAIS renvoyee au front (suppression par lien secret).
 * Deploy : Deploy > New deployment > Web app
 *   - Execute as : Me
 *   - Who has access : Anyone
 * Copier l'URL /exec dans CONFIG.SHEET_APP_URL cote front.
 *
 * Le front ne parle qu'a cette URL, aucune cle API, aucun serveur.
 */

var SHEET_NAME = 'trajets';
var CACHE_SHEET_NAME = 'geocache';
var HEADERS = [
  'id', 'type', 'nom', 'contact',
  'depart_txt', 'depart_lat', 'depart_lng',
  'arrivee_txt', 'arrivee_lat', 'arrivee_lng',
  'date', 'heure', 'places', 'commentaire',
  'ts', 'visible', 'token'
];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
  }
  return sh;
}

function getCacheSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CACHE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CACHE_SHEET_NAME);
    sh.appendRow(['q', 'display', 'lat', 'lng', 'ts']);
  }
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------
// GET : action=list | geocode | delete
// ------------------------------------------------------------------
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'list';
  try {
    if (action === 'list') return json_({ ok: true, rides: listRides_() });
    if (action === 'geocode') return json_(geocode_(e.parameter.q || ''));
    if (action === 'delete') return json_(deleteRide_(e.parameter.id, e.parameter.token));
    return json_({ ok: false, error: 'action inconnue' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function listRides_() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = rowToObject_(values[i]);
    if (r.visible === false || r.visible === 'false' || r.visible === '') continue;
    delete r.token; // jamais expose
    out.push(r);
  }
  return out;
}

function rowToObject_(row) {
  var o = {};
  for (var i = 0; i < HEADERS.length; i++) o[HEADERS[i]] = row[i];
  return o;
}

// Geocodage proxy (Nominatim) + cache, pour respecter la limite 1 req/s
// et parce que le navigateur ne peut pas poser un User-Agent custom.
function geocode_(q) {
  q = String(q).trim();
  if (q.length < 3) return { ok: true, results: [] };
  var cache = getCacheSheet_();
  var data = cache.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === q.toLowerCase()) {
      return { ok: true, results: [{ display: data[i][1], lat: data[i][2], lng: data[i][3] }] };
    }
  }
  var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&q='
    + encodeURIComponent(q);
  var resp = UrlFetchApp.fetch(url, {
    headers: { 'User-Agent': 'covoiturage-evenement/1.0 (contact: rema@exemple.org)' },
    timeout: 8000
  });
  var arr = JSON.parse(resp.getContentText());
  if (!arr.length) return { ok: true, results: [] };
  var top = arr[0];
  var display = top.display_name;
  var lat = parseFloat(top.lat), lng = parseFloat(top.lon);
  cache.appendRow([q, display, lat, lng, new Date()]);
  return { ok: true, results: [{ display: display, lat: lat, lng: lng }] };
}

// Suppression douce par token (l'auteur garde son lien secret).
function deleteRide_(id, token) {
  if (!id || !token) return { ok: false, error: 'id/token requis' };
  var sh = getSheet_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id) && String(data[i][HEADERS.indexOf('token')]) === String(token)) {
      sh.getRange(i + 1, HEADERS.indexOf('visible') + 1).setValue(false);
      return { ok: true };
    }
  }
  return { ok: false, error: 'introuvable' };
}

// ------------------------------------------------------------------
// POST : creer une offre / demande
// ------------------------------------------------------------------
function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents);
    // honeypot : le champ cache "website" doit etre vide
    if (b.website) return json_({ ok: false, error: 'spam' });
    if (!b.type || !b.nom || !b.contact || !b.depart_txt || !b.arrivee_txt) {
      return json_({ ok: false, error: 'champs requis manquants' });
    }
    var id = Utilities.getUuid().slice(0, 8);
    var token = Utilities.getUuid();
    var row = [
      id, b.type, String(b.nom).slice(0, 60), String(b.contact).slice(0, 80),
      String(b.depart_txt).slice(0, 120), b.depart_lat || '', b.depart_lng || '',
      String(b.arrivee_txt).slice(0, 120), b.arrivee_lat || '', b.arrivee_lng || '',
      b.date || '', b.heure || '', b.places || '', String(b.commentaire || '').slice(0, 280),
      new Date(), true, token
    ];
    getSheet_().appendRow(row);
    // lien de suppression a conserver par l'auteur
    return json_({ ok: true, id: id, delete_token: token });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
