/* Covoiturage evenement - frontend statique, zero dependance hors Leaflet/Tailwind */

const CONFIG = {
  // >>> Coler ici l'URL /exec de ton Apps Script Web App <<<
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbw-SNNQK5JhzQ0NDz051gcPNQH6eeg_EZ_-NSgrwQKx92ljH9mRhk3EhAeWCZ_2KrP9/exec',

  // Optionnel : lieu de l'evenement pour centrer la carte. Mettre null sinon.
  EVENT: null, // ex: { name: 'Festival Guy Roux', lat: 47.0, lng: 2.0, zoom: 12 }

  // Repli si pas d'EVENT (centrage par defaut : Montreal)
  DEFAULT_CENTER: [45.5017, -73.5673],
  DEFAULT_ZOOM: 6,

  // Matching offre <-> demande
  MATCH_RADIUS_KM: 25,
  MATCH_HOURS_TOLERANCE: 2,
};

const state = {
  rides: [],
  tab: 'offres',
  filters: { origin: '', dest: '', date: '' },
  map: null,
  overlay: null,
  expanded: new Set(),
  joinsCache: {},
  joined: {},
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Cellules Sheets : ISO "2026-12-31T16:00:00.000Z", "2026-12-31", ou dechet "111223-01-02".
function fmtDate(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (!isNaN(d) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  return s;
}
function fmtTime(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const hm = s.match(/(\d{2}):(\d{2})/);
  return hm ? `${hm[1]}:${hm[2]}` : s;
}

// ------------------------------------------------------------------
// Data
// ------------------------------------------------------------------
async function loadRides() {
  try {
    const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=list`);
    const data = await res.json();
    state.rides = data.ok ? data.rides : [];
  } catch (e) {
    state.rides = [];
    console.error(e);
  }
  render();
}

function myTokens() {
  try { return JSON.parse(localStorage.getItem('covo_tokens') || '{}'); }
  catch { return {}; }
}
function saveToken(id, token) {
  const t = myTokens(); t[id] = token;
  localStorage.setItem('covo_tokens', JSON.stringify(t));
}

function myJoins() {
  try { return JSON.parse(localStorage.getItem('covo_joins') || '{}'); }
  catch { return {}; }
}
function saveJoin(rideId, id) {
  const j = myJoins(); j[rideId] = id;
  localStorage.setItem('covo_joins', JSON.stringify(j));
}

async function deleteRide(id) {
  const token = myTokens()[id];
  if (!token) return;
  if (!confirm('Supprimer cette fiche ?')) return;
  await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=delete&id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`);
  await loadRides();
}

// ------------------------------------------------------------------
// Filtres + rendu liste
// ------------------------------------------------------------------
function filtered() {
  const { origin, dest, date } = state.filters;
  const type = state.tab === 'offres' ? 'offre' : state.tab === 'demandes' ? 'demande' : state.tab;
  return state.rides.filter((r) => {
    if (r.type !== type) return false;
    if (origin && !String(r.depart_txt).toLowerCase().includes(origin.toLowerCase())) return false;
    if (dest && !String(r.arrivee_txt).toLowerCase().includes(dest.toLowerCase())) return false;
    if (date && String(r.date) !== date) return false;
    return true;
  });
}

function contactLink(c) {
  const v = String(c).trim();
  if (/@/.test(v)) return `<a class="text-teal-700 underline" href="mailto:${esc(v)}">${esc(v)}</a>`;
  const tel = v.replace(/[^\d+]/g, '');
  return `<a class="text-teal-700 underline" href="tel:${esc(tel)}">${esc(v)}</a>`;
}

// ------------------------------------------------------------------
// Matching offre <-> demande (geodistance + date + heure)
// ------------------------------------------------------------------
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
function dateKey(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const d = new Date(s);
  if (!isNaN(d) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return '';
}
function hourMin(v) {
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function isMatch(a, b) {
  const geo = (r) => r.depart_lat && r.depart_lng && r.arrivee_lat && r.arrivee_lng;
  if (!geo(a) || !geo(b)) return false;
  const da = dateKey(a.date);
  if (!da || da !== dateKey(b.date)) return false;
  if (haversine(+a.depart_lat, +a.depart_lng, +b.depart_lat, +b.depart_lng) > CONFIG.MATCH_RADIUS_KM) return false;
  if (haversine(+a.arrivee_lat, +a.arrivee_lng, +b.arrivee_lat, +b.arrivee_lng) > CONFIG.MATCH_RADIUS_KM) return false;
  const ha = hourMin(a.heure), hb = hourMin(b.heure);
  if (ha !== null && hb !== null && Math.abs(ha - hb) > CONFIG.MATCH_HOURS_TOLERANCE * 60) return false;
  return true;
}
function matchesFor(r) {
  const opp = r.type === 'offre' ? 'demande' : 'offre';
  return state.rides.filter((o) => o.type === opp && isMatch(r, o));
}

function miniCard(m) {
  const when = [fmtDate(m.date), fmtTime(m.heure)].filter(Boolean).join(' à ');
  const places = m.type === 'offre' && m.places ? ` · ${esc(m.places)} pl.` : '';
  return `<div class="bg-slate-50 rounded-lg p-2 text-xs">
    <div class="font-medium">${esc(m.depart_txt)} <span class="text-slate-400">→</span> ${esc(m.arrivee_txt)}</div>
    <div class="text-slate-500">${esc(when)}${places} · ${esc(m.nom)} · ${contactLink(m.contact)}</div>
  </div>`;
}

function matchSection(r) {
  const ms = matchesFor(r);
  if (!ms.length) return '';
  const key = 'match:' + r.id;
  const label = r.type === 'offre'
    ? `${ms.length} demande(s) correspondante(s)`
    : `${ms.length} offre(s) correspondante(s)`;
  const body = state.expanded.has(key)
    ? `<div class="mt-2 space-y-2 border-t border-slate-100 pt-2">${ms.map(miniCard).join('')}</div>`
    : '';
  return `<button data-match="${esc(r.id)}" class="text-xs text-teal-700 underline">${label}</button>${body}`;
}

// ------------------------------------------------------------------
// Rejoindre une offre (demandes de places, liste d'attente indicative)
// ------------------------------------------------------------------
async function loadJoins(rideId) {
  if (state.joinsCache[rideId]) return;
  try {
    const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=joins&ride_id=${encodeURIComponent(rideId)}`);
    const data = await res.json();
    state.joinsCache[rideId] = data.ok ? data.joins : [];
  } catch {
    state.joinsCache[rideId] = [];
  }
}

function joinSection(r) {
  const n = Number(r.join_count) || 0;
  let out = '<div class="flex flex-wrap items-center gap-3 mt-2">';
  out += state.joined[r.id]
    ? '<span class="text-xs text-teal-700 font-medium">✓ demande envoyée</span>'
    : `<button data-join="${esc(r.id)}" class="text-xs bg-teal-700 text-white px-3 py-1.5 rounded-lg font-medium">Rejoindre</button>`;
  if (n) out += `<button data-joins="${esc(r.id)}" class="text-xs text-teal-700 underline">${n} demande(s)</button>`;
  out += '</div>';
  if (state.expanded.has('joinform:' + r.id)) out += joinFormHtml(r);
  if (state.expanded.has('joins:' + r.id)) out += joinListHtml(r);
  return out;
}

function joinFormHtml(r) {
  return `<form data-joinform="${esc(r.id)}" class="mt-2 space-y-2 bg-slate-50 rounded-lg p-3 text-sm">
    <input name="nom" required maxlength="60" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Ton prénom" />
    <input name="contact" required maxlength="80" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Téléphone ou email" />
    <input name="places" type="number" min="1" max="9" value="1" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Places demandées" />
    <input name="message" maxlength="200" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Message (optionnel)" />
    <button type="submit" class="w-full bg-teal-700 text-white font-semibold py-2 rounded-lg">Envoyer ma demande</button>
    <p class="joinmsg text-center text-xs text-slate-500"></p>
  </form>`;
}

function joinListHtml(r) {
  const joins = state.joinsCache[r.id];
  if (!joins) return '<p class="text-xs text-slate-400 mt-2">Chargement…</p>';
  if (!joins.length) return '<p class="text-xs text-slate-400 mt-2">Aucune demande pour l\u2019instant.</p>';
  const places = Math.max(1, Number(r.places) || 1);
  let used = 0;
  const rows = joins.map((j) => {
    const seats = Math.max(1, Number(j.places) || 1);
    const ok = used + seats <= places;
    used += seats;
    return `<div class="text-xs bg-slate-50 rounded-lg p-2">
      <div class="flex items-center justify-between gap-2">
        <span>${esc(j.nom)} · ${contactLink(j.contact)} · ${seats} pl.</span>
        <span class="shrink-0 px-2 py-0.5 rounded-full ${ok ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'}">${ok ? 'confirmé' : 'attente'}</span>
      </div>
      ${j.message ? `<p class="text-slate-500 mt-1">${esc(j.message)}</p>` : ''}
    </div>`;
  }).join('');
  return `<div class="mt-2 space-y-2 border-t border-slate-100 pt-2">
    <p class="text-xs text-slate-400">${places} place(s) · statuts indicatifs, le conducteur garde la main</p>
    ${rows}
  </div>`;
}

async function submitJoin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const rideId = form.dataset.joinform;
  const msg = $('.joinmsg', form);
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.action = 'join';
  payload.ride_id = rideId;
  msg.textContent = 'Envoi…';
  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      saveJoin(rideId, data.id);
      state.joined = myJoins();
      state.expanded.delete('joinform:' + rideId);
      delete state.joinsCache[rideId];
      await loadRides();
    } else {
      msg.textContent = data.error || 'Erreur';
    }
  } catch {
    msg.textContent = 'Erreur réseau';
  }
}

function card(r) {
  const tokens = myTokens();
  const del = tokens[r.id]
    ? `<button data-del="${esc(r.id)}" class="text-xs text-red-500 mt-2">supprimer ma fiche</button>` : '';
  const places = r.type === 'offre' && r.places ? `<span class="text-slate-500">· ${esc(r.places)} place(s)</span>` : '';
  const when = [fmtDate(r.date), fmtTime(r.heure)].filter(Boolean).join(' à ');
  return `
    <article class="bg-white rounded-xl shadow p-4">
      <div class="flex items-start justify-between gap-2">
        <div class="font-semibold">${esc(r.depart_txt)} <span class="text-slate-400">→</span> ${esc(r.arrivee_txt)}</div>
        <span class="shrink-0 text-xs px-2 py-0.5 rounded-full ${r.type === 'offre' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'}">${r.type === 'offre' ? 'Offre' : 'Demande'}</span>
      </div>
      <div class="text-sm text-slate-600 mt-1">${when ? esc(when) + ' ' : ''}${places}</div>
      ${r.commentaire ? `<p class="text-sm text-slate-500 mt-1">${esc(r.commentaire)}</p>` : ''}
      <div class="text-sm mt-2">${esc(r.nom)} · ${contactLink(r.contact)}</div>
      ${r.type === 'offre' ? joinSection(r) : ''}
      ${matchSection(r)}
      ${del}
    </article>`;
}

function render() {
  const list = $('#list');
  const rows = filtered();
  if (state.tab === 'publier') return;
  list.innerHTML = rows.length
    ? rows.map(card).join('')
    : `<p class="text-center text-slate-400 py-8">Aucun trajet pour l'instant.</p>`;
  $$('[data-del]', list).forEach((b) => b.addEventListener('click', () => deleteRide(b.dataset.del)));
  $$('[data-match]', list).forEach((b) =>
    b.addEventListener('click', () => toggleExpand('match:' + b.dataset.match)));
  $$('[data-join]', list).forEach((b) =>
    b.addEventListener('click', () => toggleExpand('joinform:' + b.dataset.join)));
  $$('[data-joins]', list).forEach((b) =>
    b.addEventListener('click', async () => {
      await loadJoins(b.dataset.joins);
      toggleExpand('joins:' + b.dataset.joins);
    }));
  $$('[data-joinform]', list).forEach((f) => f.addEventListener('submit', submitJoin));
  renderMap(rows);
}

function toggleExpand(key) {
  if (state.expanded.has(key)) state.expanded.delete(key);
  else state.expanded.add(key);
  render();
}

// ------------------------------------------------------------------
// Carte
// ------------------------------------------------------------------
function initMap() {
  const c = CONFIG.EVENT ? [CONFIG.EVENT.lat, CONFIG.EVENT.lng] : CONFIG.DEFAULT_CENTER;
  const z = CONFIG.EVENT ? (CONFIG.EVENT.zoom || 11) : CONFIG.DEFAULT_ZOOM;
  state.map = L.map('map').setView(c, z);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(state.map);
  state.overlay = L.layerGroup().addTo(state.map);
}

const icon = (color) => L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,.5)"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
});

function renderMap(rows) {
  if (!state.map || !state.overlay) return;
  state.overlay.clearLayers();
  const bounds = [];
  rows.forEach((r) => {
    const hasD = r.depart_lat && r.depart_lng;
    const hasA = r.arrivee_lat && r.arrivee_lng;
    const lineColor = r.type === 'offre' ? '#0f766e' : '#d97706';
    if (hasD && hasA) {
      L.polyline([[+r.depart_lat, +r.depart_lng], [+r.arrivee_lat, +r.arrivee_lng]],
        { color: lineColor, weight: 3, opacity: 0.7 }).addTo(state.overlay);
    }
    if (hasD) {
      L.marker([+r.depart_lat, +r.depart_lng], { icon: icon('#0f766e') })
        .bindPopup(`<b>Départ</b> ${esc(r.depart_txt)}<br>${esc(r.nom)} · ${esc(fmtDate(r.date))} ${esc(fmtTime(r.heure))}`)
        .addTo(state.overlay);
      bounds.push([+r.depart_lat, +r.depart_lng]);
    }
    if (hasA) {
      L.marker([+r.arrivee_lat, +r.arrivee_lng], { icon: icon('#d97706') })
        .bindPopup(`<b>Arrivée</b> ${esc(r.arrivee_txt)}<br>${esc(r.nom)}`)
        .addTo(state.overlay);
      bounds.push([+r.arrivee_lat, +r.arrivee_lng]);
    }
  });
  if (bounds.length > 1) state.map.fitBounds(bounds, { padding: [30, 30] });
}

// ------------------------------------------------------------------
// Geocodage (autocompletion via proxy Apps Script)
// ------------------------------------------------------------------
function setupGeo(box) {
  const input = $('input[name$="_txt"]', box);
  const latEl = $('input[name$="_lat"]', box);
  const lngEl = $('input[name$="_lng"]', box);
  const sug = $('.geo-suggest', box);
  let timer;
  input.addEventListener('input', () => {
    latEl.value = ''; lngEl.value = '';
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { sug.classList.add('hidden'); return; }
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=geocode&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const items = (data.results || []).filter((x) => x.display);
        if (!items.length) { sug.classList.add('hidden'); return; }
        sug.innerHTML = items.map((x, i) =>
          `<li data-i="${i}" class="px-3 py-2 hover:bg-slate-100 cursor-pointer text-sm">${esc(x.display)}</li>`).join('');
        sug.classList.remove('hidden');
        $$('li', sug).forEach((li) => li.addEventListener('click', () => {
          const x = items[+li.dataset.i];
          input.value = x.display; latEl.value = x.lat; lngEl.value = x.lng;
          sug.classList.add('hidden');
        }));
      } catch { sug.classList.add('hidden'); }
    }, 400);
  });
  document.addEventListener('click', (e) => { if (!box.contains(e.target)) sug.classList.add('hidden'); });
}

// ------------------------------------------------------------------
// Formulaire
// ------------------------------------------------------------------
function setupForm() {
  const form = $('#rideForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#formMsg');
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    msg.textContent = 'Envoi…'; msg.className = 'text-center text-sm text-slate-500';
    try {
      const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evite le preflight CORS
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        saveToken(data.id, data.delete_token);
        form.reset();
        msg.textContent = 'Publié ! Merci.'; msg.className = 'text-center text-sm text-teal-700';
        await loadRides();
        setTimeout(() => switchTab(state.tab === 'publier' ? 'offres' : state.tab), 800);
      } else {
        msg.textContent = 'Erreur : ' + (data.error || 'inconnue'); msg.className = 'text-center text-sm text-red-600';
      }
    } catch (err) {
      msg.textContent = 'Erreur réseau'; msg.className = 'text-center text-sm text-red-600';
    }
  });
}

// ------------------------------------------------------------------
// Tabs + filtres
// ------------------------------------------------------------------
function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('bg-teal-600', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('border-teal-600', active);
    b.classList.toggle('bg-white', !active);
    b.classList.toggle('border-slate-200', !active);
  });
  const isForm = tab === 'publier';
  $('#formWrap').classList.toggle('hidden', !isForm);
  $('#list').classList.toggle('hidden', isForm);
  $('#filters').classList.toggle('hidden', isForm);
  if (!isForm) render();
}

function setupTabs() {
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
}

function setupFilters() {
  $('#fOrigin').addEventListener('input', (e) => { state.filters.origin = e.target.value; render(); });
  $('#fDest').addEventListener('input', (e) => { state.filters.dest = e.target.value; render(); });
  $('#fDate').addEventListener('input', (e) => { state.filters.date = e.target.value; render(); });
}

function setupMapToggle() {
  $('#toggleMap').addEventListener('click', () => {
    const wrap = $('#mapWrap');
    wrap.classList.toggle('hidden');
    if (!state.map && !wrap.classList.contains('hidden')) initMap();
    if (state.map) setTimeout(() => state.map.invalidateSize(), 50);
  });
}

// ------------------------------------------------------------------
// Pickers date/heure natifs (clic sur tout le champ = calendrier)
// ------------------------------------------------------------------
function setupPickers() {
  const today = new Date().toISOString().slice(0, 10);
  const formDate = $('#rideForm input[name="date"]');
  if (formDate) formDate.min = today; // pas de trajet dans le passe
  $$('input[type="date"], input[type="time"]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => { try { el.showPicker(); } catch (e) {} });
  });
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
function init() {
  state.joined = myJoins();
  if (CONFIG.EVENT) $('#siteTitle').textContent = 'Pars-tu ? · ' + CONFIG.EVENT.name;
  initMap();
  setupTabs();
  setupFilters();
  setupMapToggle();
  setupForm();
  setupPickers();
  $$('.geo').forEach(setupGeo);
  loadRides().then(() => setTimeout(() => state.map && state.map.invalidateSize(), 50));
}
document.addEventListener('DOMContentLoaded', init);
