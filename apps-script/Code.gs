/**
 * Backend covoiturage evenement - Google Apps Script Web App (concept type Caroster)
 * ------------------------------------------------------------------
 * L'evenement (nom/lieu/date) est defini cote front (CONFIG.EVENT) :
 * tous les trajets vont du point de depart VERS l'evenement.
 *
 * Feuille "trajets" : conducteurs (places offertes)
 * Feuille "joins"   : passagers ajoutes a un trajet (au-dela des places = attente)
 * Feuille "attente" : passagers qui cherchent un trajet
 * Feuille "geocache": cache geocodage Photon
 *
 * Deploy : Deploy > Manage deployments > Edit > Version: New version > Deploy
 *   - Execute as : Me
 *   - Who has access : Anyone
 * Copier l'URL /exec dans CONFIG.APPS_SCRIPT_URL cote front.
 */

var SHEET_NAME = 'trajets';
var JOIN_SHEET_NAME = 'joins';
var ATTENTE_SHEET_NAME = 'attente';
var CACHE_SHEET_NAME = 'geocache';
// Biais geocodage vers le Quebec (ameliore le classement Photon). Ajuste au besoin.
var GEO_BIAS_LAT = 46.8;
var GEO_BIAS_LON = -71.2;
// Code pays a privilegier parmi les resultats Photon (evenement au Canada). '' = aucun.
var GEO_PREFER_COUNTRY = 'CA';

var HEADERS = [
  'id', 'nom', 'contact',
  'depart_txt', 'depart_lat', 'depart_lng',
  'date', 'heure', 'places', 'commentaire',
  'ts', 'visible', 'token'
];
var JOIN_HEADERS = ['id', 'trip_id', 'nom', 'contact', 'places', 'message', 'ts'];
var ATTENTE_HEADERS = ['id', 'nom', 'contact', 'depart_txt', 'lat', 'lng', 'message', 'ts', 'visible', 'token'];

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
  }
  return sh;
}
function getSheet_() { return sheet_(SHEET_NAME, HEADERS); }
function getJoinSheet_() { return sheet_(JOIN_SHEET_NAME, JOIN_HEADERS); }
function getAttenteSheet_() { return sheet_(ATTENTE_SHEET_NAME, ATTENTE_HEADERS); }
function getCacheSheet_() { return sheet_(CACHE_SHEET_NAME, ['q', 'display', 'lat', 'lng', 'cc', 'ts']); }

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isVisible_(v) {
  return !(v === false || v === 'false' || v === '');
}

// ------------------------------------------------------------------
// GET : action=list | geocode | joins | delete
// ------------------------------------------------------------------
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'list';
  try {
    if (action === 'list') return json_({ ok: true, trips: listTrips_(), attente: listAttente_() });
    if (action === 'geocode') return json_(geocode_(e.parameter.q || ''));
    if (action === 'joins') return json_(listJoins_(e.parameter.trip_id));
    if (action === 'delete') return json_(deleteRow_(e.parameter.id, e.parameter.token, e.parameter.kind));
    return json_({ ok: false, error: 'action inconnue' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function rowToObject_(row, headers) {
  var o = {};
  for (var i = 0; i < headers.length; i++) o[headers[i]] = row[i];
  return o;
}

function listTrips_() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var counts = joinCounts_();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = rowToObject_(values[i], HEADERS);
    if (!isVisible_(r.visible)) continue;
    delete r.token; // jamais expose
    var c = counts[String(r.id)];
    r.join_count = c ? c.count : 0;
    r.join_seats = c ? c.seats : 0;
    out.push(r);
  }
  return out;
}

function listAttente_() {
  var sh = getAttenteSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = rowToObject_(values[i], ATTENTE_HEADERS);
    if (!isVisible_(r.visible)) continue;
    delete r.token;
    out.push(r);
  }
  return out;
}

// Nombre de demandes + sieges demandes par trajet (une seule passe sur la feuille joins).
function joinCounts_() {
  var counts = {};
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(JOIN_SHEET_NAME);
  if (!sh) return counts;
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var rid = String(data[i][1]);
    if (!counts[rid]) counts[rid] = { count: 0, seats: 0 };
    counts[rid].count++;
    counts[rid].seats += Number(data[i][4] || 1);
  }
  return counts;
}

// Liste publique des passagers d'un trajet, triees par arrivee (1ers = confirmes, suite = attente).
function listJoins_(tripId) {
  if (!tripId) return { ok: false, error: 'trip_id requis' };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(JOIN_SHEET_NAME);
  if (!sh) return { ok: true, joins: [] };
  var data = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(tripId)) continue;
    out.push({
      id: data[i][0], nom: data[i][2], contact: data[i][3],
      places: data[i][4], message: data[i][5], ts: data[i][6]
    });
  }
  out.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
  return { ok: true, joins: out };
}

// Suppression douce par token (kind = 'trip' defaut | 'attente').
function deleteRow_(id, token, kind) {
  if (!id || !token) return { ok: false, error: 'id/token requis' };
  var isAttente = kind === 'attente';
  var sh = isAttente ? getAttenteSheet_() : getSheet_();
  var headers = isAttente ? ATTENTE_HEADERS : HEADERS;
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id) && String(data[i][headers.indexOf('token')]) === String(token)) {
      sh.getRange(i + 1, headers.indexOf('visible') + 1).setValue(false);
      return { ok: true };
    }
  }
  return { ok: false, error: 'introuvable' };
}

// Geocodage proxy (Photon / OSM, sans cle) + cache.
// Photon est passe par le serveur Apps Script car le navigateur ne peut pas
// poser de User-Agent, et le biais Quebec corrige le classement des villes.
function geocode_(q) {
  q = String(q).trim();
  if (q.length < 3) return { ok: true, results: [] };
  var cache = getCacheSheet_();
  var data = cache.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() !== q.toLowerCase()) continue;
    var cachedCc = String(data[i][4] || '').toUpperCase();
    // Entree obsolete (ancien schema sans pays) ou pays non desire -> on ignore le cache.
    if (GEO_PREFER_COUNTRY && cachedCc !== GEO_PREFER_COUNTRY) break;
    return { ok: true, results: [{ display: data[i][1], lat: data[i][2], lng: data[i][3] }] };
  }
  var url = 'https://photon.komoot.io/api/?limit=10'
    + '&lat=' + GEO_BIAS_LAT + '&lon=' + GEO_BIAS_LON
    + '&q=' + encodeURIComponent(q);
  var resp = UrlFetchApp.fetch(url, {
    headers: { 'User-Agent': 'parstu-covoiturage/1.0 (contact: rema@exemple.org)' },
    timeout: 8000
  });
  var geo = JSON.parse(resp.getContentText());
  var feats = geo.features || [];
  if (!feats.length) return { ok: true, results: [] };
  var f = feats[0];
  if (GEO_PREFER_COUNTRY) {
    for (var j = 0; j < feats.length; j++) {
      if (String((feats[j].properties || {}).countrycode || '').toUpperCase() === GEO_PREFER_COUNTRY) { f = feats[j]; break; }
    }
  }
  var p = f.properties || {};
  var cc = String(p.countrycode || '').toUpperCase();
  var coords = f.geometry.coordinates; // [lng, lat]
  var lng = coords[0], lat = coords[1];
  var display = [p.name, p.city || p.county, p.state, p.country]
    .filter(function (x, i, a) { return x && a.indexOf(x) === i; })
    .join(', ');
  cache.appendRow([q, display, lat, lng, cc, new Date()]);
  return { ok: true, results: [{ display: display, lat: lat, lng: lng }] };
}

// ------------------------------------------------------------------
// POST : creer un trajet | action=join | action=attente
// ------------------------------------------------------------------
function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents);
    // honeypot : le champ cache "website" doit etre vide
    if (b.website) return json_({ ok: false, error: 'spam' });
    if (b.action === 'join') return json_(joinTrip_(b));
    if (b.action === 'attente') return json_(addAttente_(b));
    if (!b.nom || !b.contact || !b.depart_txt) {
      return json_({ ok: false, error: 'champs requis manquants' });
    }
    var id = Utilities.getUuid().slice(0, 8);
    var token = Utilities.getUuid();
    var places = parseInt(b.places, 10);
    places = isNaN(places) ? 1 : Math.max(1, Math.min(9, places));
    var row = [
      id, String(b.nom).slice(0, 60), String(b.contact).slice(0, 80),
      String(b.depart_txt).slice(0, 120), b.depart_lat || '', b.depart_lng || '',
      b.date || '', b.heure || '', places, String(b.commentaire || '').slice(0, 280),
      new Date(), true, token
    ];
    getSheet_().appendRow(row);
    // lien de suppression a conserver par l'auteur
    return json_({ ok: true, id: id, delete_token: token });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// Demande d'ajout a un trajet (le conducteur garde la main, statuts indicatifs).
function joinTrip_(b) {
  if (!b.trip_id || !b.nom || !b.contact) return { ok: false, error: 'champs requis manquants' };
  var sh = getSheet_();
  var data = sh.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(b.trip_id)) continue;
    if (!isVisible_(data[i][HEADERS.indexOf('visible')])) break;
    found = true;
    break;
  }
  if (!found) return { ok: false, error: 'trajet introuvable' };
  var places = parseInt(b.places, 10);
  places = isNaN(places) ? 1 : Math.max(1, Math.min(9, places));
  var id = Utilities.getUuid().slice(0, 8);
  getJoinSheet_().appendRow([
    id, String(b.trip_id), String(b.nom).slice(0, 60), String(b.contact).slice(0, 80),
    places, String(b.message || '').slice(0, 200), new Date()
  ]);
  return { ok: true, id: id };
}

// Inscription a la liste d'attente globale (passager qui cherche un trajet).
function addAttente_(b) {
  if (!b.nom || !b.contact) return { ok: false, error: 'champs requis manquants' };
  var id = Utilities.getUuid().slice(0, 8);
  var token = Utilities.getUuid();
  getAttenteSheet_().appendRow([
    id, String(b.nom).slice(0, 60), String(b.contact).slice(0, 80),
    String(b.depart_txt || '').slice(0, 120), b.lat || '', b.lng || '',
    String(b.message || '').slice(0, 200), new Date(), true, token
  ]);
  return { ok: true, id: id, delete_token: token };
}
