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
var JOIN_SHEET_NAME = 'joins';
var JOIN_HEADERS = ['id', 'ride_id', 'nom', 'contact', 'places', 'message', 'ts'];
// Biais geocodage vers le Quebec (ameliore le classement Photon). Ajuste au besoin.
var GEO_BIAS_LAT = 46.8;
var GEO_BIAS_LON = -71.2;
// Code pays a privilegier parmi les resultats Photon (evenement au Canada). '' = aucun.
var GEO_PREFER_COUNTRY = 'CA';
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
    sh.appendRow(['q', 'display', 'lat', 'lng', 'cc', 'ts']);
  }
  return sh;
}

function getJoinSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(JOIN_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(JOIN_SHEET_NAME);
    sh.appendRow(JOIN_HEADERS);
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
    if (action === 'joins') return json_(listJoins_(e.parameter.ride_id));
    return json_({ ok: false, error: 'action inconnue' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function listRides_() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var counts = joinCounts_();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = rowToObject_(values[i]);
    if (r.visible === false || r.visible === 'false' || r.visible === '') continue;
    delete r.token; // jamais expose
    var c = counts[String(r.id)];
    r.join_count = c ? c.count : 0;
    r.join_seats = c ? c.seats : 0;
    out.push(r);
  }
  return out;
}

// Nombre de demandes + sieges demandes par offre (une seule passe sur la feuille joins).
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

// Liste publique des demandes d'une offre, triees par arrivee (1ers = confirmes, suite = attente).
function listJoins_(rideId) {
  if (!rideId) return { ok: false, error: 'ride_id requis' };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(JOIN_SHEET_NAME);
  if (!sh) return { ok: true, joins: [] };
  var data = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(rideId)) continue;
    out.push({
      id: data[i][0], nom: data[i][2], contact: data[i][3],
      places: data[i][4], message: data[i][5], ts: data[i][6]
    });
  }
  out.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
  return { ok: true, joins: out };
}

function rowToObject_(row) {
  var o = {};
  for (var i = 0; i < HEADERS.length; i++) o[HEADERS[i]] = row[i];
  return o;
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
    if (b.action === 'join') return json_(joinRide_(b));
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

// ------------------------------------------------------------------
// POST action=join : demande d'une place sur une offre
// ------------------------------------------------------------------
function joinRide_(b) {
  if (!b.ride_id || !b.nom || !b.contact) return { ok: false, error: 'champs requis manquants' };
  var sh = getSheet_();
  var data = sh.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(b.ride_id)) continue;
    var visible = data[i][HEADERS.indexOf('visible')];
    if (visible === false || visible === 'false' || visible === '') break;
    if (String(data[i][1]) !== 'offre') return { ok: false, error: 'reserve aux offres' };
    found = true;
    break;
  }
  if (!found) return { ok: false, error: 'offre introuvable' };
  var places = parseInt(b.places, 10);
  places = isNaN(places) ? 1 : Math.max(1, Math.min(9, places));
  var id = Utilities.getUuid().slice(0, 8);
  getJoinSheet_().appendRow([
    id, String(b.ride_id), String(b.nom).slice(0, 60), String(b.contact).slice(0, 80),
    places, String(b.message || '').slice(0, 200), new Date()
  ]);
  return { ok: true, id: id };
}
