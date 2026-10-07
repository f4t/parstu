/* Pars-tu ? - covoiturage d'evenement (concept type Caroster)
 * Frontend statique : Leaflet + Tailwind CDN, zero build.
 * L'evenement est defini dans CONFIG.EVENT ; les conducteurs publient des
 * trajets vers l'evenement, les passagers les rejoignent ou s'inscrivent
 * a la liste d'attente. */

const CONFIG = {
  // >>> Coler ici l'URL /exec de ton Apps Script Web App <<<
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbw-SNNQK5JhzQ0NDz051gcPNQH6eeg_EZ_-NSgrwQKx92ljH9mRhk3EhAeWCZ_2KrP9/exec',

  // L'evenement au centre de l'app (destination implicite de tous les trajets).
  EVENT: {
    name: 'Mon événement',
    lieu: 'Maison symphonique, Montréal',
    lat: 45.5056,
    lng: -73.5716,
    date: '2026-11-01',
    heure: '09:00',
    zoom: 11,
    description: 'Covoiturage pour se rendre à l\u2019événement. Les conducteurs publient leurs trajets, les passagers les rejoignent ou s\u2019inscrivent à la liste d\u2019attente.',
  },
};

const state = {
  map: null,
  cluster: null,
  trips: [],
  attente: [],
  tab: 'trajets',
  expanded: new Set(),
  joinsCache: {},
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Cellules Sheets : ISO "2026-12-31T16:00:00.000Z", "2026-12-31", ou dechet.
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
function whenStr(t) {
  return [fmtDate(t.date), fmtTime(t.heure)].filter(Boolean).join(' à ');
}

function contactLink(c) {
  const v = String(c).trim();
  if (/@/.test(v)) return `<a class="text-teal-700 underline" href="mailto:${esc(v)}">${esc(v)}</a>`;
  const tel = v.replace(/[^\d+()\s-]/g, '');
  return `<a class="text-teal-700 underline" href="tel:${esc(tel)}">${esc(v)}</a>`;
}

// ------------------------------------------------------------------
// localStorage (tokens de suppression, mes rejoins)
// ------------------------------------------------------------------
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const tripTokens = () => lsGet('covo_tokens');
const attenteTokens = () => lsGet('covo_attente_tokens');
const myJoins = () => lsGet('covo_joins');
function lsPut(store, id, val) { const m = lsGet(store); m[id] = val; lsSet(store, m); }

async function deleteRow(id, kind) {
  const store = kind === 'attente' ? 'covo_attente_tokens' : 'covo_tokens';
  const token = lsGet(store)[id];
  if (!token) return;
  if (!confirm('Supprimer cette fiche ?')) return;
  await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=delete&id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&kind=${encodeURIComponent(kind || 'trip')}`);
  await loadData();
}

// ------------------------------------------------------------------
// Data
// ------------------------------------------------------------------
async function loadData() {
  try {
    const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=list`);
    const data = await res.json();
    state.trips = (data.ok && data.trips) || [];
    state.attente = (data.ok && data.attente) || [];
  } catch (e) {
    state.trips = [];
    state.attente = [];
    console.error(e);
  }
  render();
}

function render() {
  renderTrips();
  renderAttente();
  renderMap();
}

async function loadJoins(tripId) {
  if (state.joinsCache[tripId]) return;
  try {
    const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=joins&trip_id=${encodeURIComponent(tripId)}`);
    const data = await res.json();
    state.joinsCache[tripId] = data.ok ? data.joins : [];
  } catch {
    state.joinsCache[tripId] = [];
  }
}

function toggleExpand(key) {
  if (state.expanded.has(key)) state.expanded.delete(key);
  else state.expanded.add(key);
  render();
}

// ------------------------------------------------------------------
// Onglet Trajets
// ------------------------------------------------------------------
function seatsLeft(t) {
  return Math.max(0, (Number(t.places) || 1) - (Number(t.join_seats) || 0));
}

function tripCard(t) {
  const tokens = tripTokens();
  const joins = myJoins();
  const left = seatsLeft(t);
  const total = Number(t.places) || 1;
  const del = tokens[t.id]
    ? `<button data-del="${esc(t.id)}" data-kind="trip" class="text-xs text-red-500">supprimer</button>` : '';

  let actions = '<div class="flex flex-wrap items-center gap-3 mt-2">';
  actions += joins[t.id]
    ? '<span class="text-xs text-teal-700 font-medium">✓ tu es dans ce trajet</span>'
    : `<button data-join="${esc(t.id)}" class="text-xs bg-teal-700 text-white px-3 py-1.5 rounded-lg font-medium">Rejoindre</button>`;
  if (Number(t.join_count)) actions += `<button data-joins="${esc(t.id)}" class="text-xs text-teal-700 underline">${esc(t.join_count)} passager(s)</button>`;
  actions += '<span class="flex-1"></span>' + del + '</div>';

  let sections = '';
  if (state.expanded.has('joinform:' + t.id)) sections += joinFormHtml(t);
  if (state.expanded.has('joins:' + t.id)) sections += joinListHtml(t);

  return `
    <article id="trip-${esc(t.id)}" class="bg-white rounded-xl shadow p-4 border-l-4 border-teal-600">
      <div class="flex items-start justify-between gap-2">
        <div class="font-semibold">🚗 ${esc(t.nom)}</div>
        <span class="shrink-0 text-xs px-2 py-0.5 rounded-full ${left > 0 ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'}">${left > 0 ? `${left}/${total} place(s)` : 'Complet'}</span>
      </div>
      <div class="text-sm text-slate-600 mt-1">${esc(t.depart_txt)} <span class="text-slate-400">→</span> ${esc(CONFIG.EVENT.name)}</div>
      <div class="text-sm text-slate-600">${esc(whenStr(t))}</div>
      ${t.commentaire ? `<p class="text-sm text-slate-500 mt-1">${esc(t.commentaire)}</p>` : ''}
      <div class="text-sm mt-2">${contactLink(t.contact)}</div>
      ${actions}
      ${sections}
    </article>`;
}

function joinFormHtml(t) {
  return `<form data-joinform="${esc(t.id)}" class="mt-2 space-y-2 bg-slate-50 rounded-lg p-3 text-sm">
    <input name="nom" required maxlength="60" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Ton prénom" />
    <input name="contact" required maxlength="80" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Téléphone ou email" />
    <input name="places" type="number" min="1" max="9" value="1" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Places demandées" />
    <input name="message" maxlength="200" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Message (optionnel)" />
    <button type="submit" class="w-full bg-teal-700 text-white font-semibold py-2 rounded-lg">Envoyer ma demande</button>
    <p class="joinmsg text-center text-xs text-slate-500"></p>
  </form>`;
}

function joinListHtml(t) {
  const joins = state.joinsCache[t.id];
  if (!joins) return '<p class="text-xs text-slate-400 mt-2">Chargement…</p>';
  if (!joins.length) return '<p class="text-xs text-slate-400 mt-2">Aucun passager pour l\u2019instant.</p>';
  const places = Math.max(1, Number(t.places) || 1);
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
  const form = e.target;
  e.preventDefault();
  const tripId = form.dataset.joinform;
  const msg = $('.joinmsg', form);
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.action = 'join';
  payload.trip_id = tripId;
  msg.textContent = 'Envoi…';
  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      lsPut('covo_joins', tripId, data.id);
      state.expanded.delete('joinform:' + tripId);
      delete state.joinsCache[tripId];
      await loadData();
    } else {
      msg.textContent = data.error || 'Erreur';
    }
  } catch {
    msg.textContent = 'Erreur réseau';
  }
}

function renderTrips() {
  const el = $('#tabTrips');
  const trips = [...state.trips].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || String(a.heure).localeCompare(String(b.heure)));
  const list = trips.length
    ? trips.map(tripCard).join('')
    : '<p class="text-center text-slate-400 py-8">Aucun trajet publié pour l\u2019instant.<br>Publie le premier !</p>';
  el.innerHTML = `
    <button data-open-trip class="w-full bg-teal-700 text-white font-semibold py-2.5 rounded-lg shadow">+ Publier un trajet</button>
    ${list}`;
}

// ------------------------------------------------------------------
// Onglet Attente (liste globale des passagers en recherche)
// ------------------------------------------------------------------
function attenteFormHtml() {
  return `<form id="attenteForm" class="bg-white rounded-xl shadow p-4 space-y-2 text-sm">
    <p class="font-semibold">Je cherche un trajet</p>
    <input name="nom" required maxlength="60" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Ton prénom" />
    <input name="contact" required maxlength="80" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Téléphone ou email (affiché)" />
    <div class="geo relative" data-txt="depart_txt" data-lat="lat" data-lng="lng">
      <input name="depart_txt" autocomplete="off" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Départ souhaité (optionnel)" />
      <input type="hidden" name="lat" /><input type="hidden" name="lng" />
      <ul class="geo-suggest hidden absolute bg-white border border-slate-200 rounded-lg shadow w-full mt-1 max-h-48 overflow-auto"></ul>
    </div>
    <input name="message" maxlength="200" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Précisions (optionnel) : nb de places, horaires…" />
    <button type="submit" class="w-full bg-slate-700 text-white font-semibold py-2 rounded-lg">M\u2019inscrire à la liste d\u2019attente</button>
    <p class="attmsg text-center text-xs text-slate-500"></p>
  </form>`;
}

function attenteCard(a) {
  const del = attenteTokens()[a.id]
    ? `<button data-del="${esc(a.id)}" data-kind="attente" class="text-xs text-red-500">supprimer</button>` : '';
  return `
    <article id="att-${esc(a.id)}" class="bg-white rounded-xl shadow p-4 border-l-4 border-slate-500">
      <div class="font-semibold">👤 ${esc(a.nom)}</div>
      ${a.depart_txt ? `<div class="text-sm text-slate-600 mt-0.5">départ souhaité : ${esc(a.depart_txt)}</div>` : ''}
      ${a.message ? `<p class="text-sm text-slate-500 mt-1">${esc(a.message)}</p>` : ''}
      <div class="text-sm mt-2 flex items-center justify-between gap-2">${contactLink(a.contact)}${del}</div>
    </article>`;
}

function renderAttente() {
  const el = $('#tabAttente');
  const mine = attenteTokens();
  const already = state.attente.some((a) => mine[a.id]);
  const cards = state.attente.length
    ? state.attente.map(attenteCard).join('')
    : '<p class="text-center text-slate-400 py-6">Personne en attente pour l\u2019instant.</p>';
  el.innerHTML = `
    ${already ? '<p class="text-xs text-teal-700 font-medium">✓ tu es sur la liste d\u2019attente</p>' : attenteFormHtml()}
    <p class="text-xs text-slate-400">Conducteur ? Parcourir cette liste et contacter directement les passagers pour leur proposer une place.</p>
    ${cards}`;
  const form = $('#attenteForm', el);
  if (form) {
    setupGeo($('.geo', form));
    setupPickers(form);
  }
}

async function submitAttente(e) {
  const form = e.target;
  e.preventDefault();
  const msg = $('.attmsg', form);
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.action = 'attente';
  msg.textContent = 'Envoi…';
  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      lsPut('covo_attente_tokens', data.id, data.delete_token);
      await loadData();
    } else {
      msg.textContent = data.error || 'Erreur';
    }
  } catch {
    msg.textContent = 'Erreur réseau';
  }
}

// ------------------------------------------------------------------
// Onglet Infos + modale "Publier un trajet"
// ------------------------------------------------------------------
function infosHtml() {
  const E = CONFIG.EVENT;
  return `<div class="bg-white rounded-xl shadow p-4 space-y-2 text-sm">
    <p>${esc(E.description)}</p>
    <p class="text-slate-600">📅 ${esc([fmtDate(E.date), fmtTime(E.heure)].filter(Boolean).join(' à '))}</p>
    <p class="text-slate-600">📍 ${esc(E.lieu)}</p>
    <button data-open-trip class="w-full bg-teal-700 text-white font-semibold py-2.5 rounded-lg mt-2">🚗 Publier un trajet</button>
    <p class="text-xs text-slate-400 pt-2">Fonctionnement : les conducteurs publient un trajet vers l\u2019événement, les passagers les rejoignent. Si c\u2019est complet, inscris-toi sur la liste d\u2019attente. Contacts affichés en clair, chacun garde la main sur sa fiche.</p>
  </div>`;
}

function tripFormHtml() {
  const E = CONFIG.EVENT;
  return `<form id="tripForm" class="space-y-3 text-sm">
    <input name="nom" required maxlength="60" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Ton nom (conducteur)" />
    <input name="contact" required maxlength="80" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Téléphone (visible des passagers)" />
    <div class="geo relative" data-txt="depart_txt" data-lat="depart_lat" data-lng="depart_lng">
      <input name="depart_txt" required autocomplete="off" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Lieu de départ" />
      <input type="hidden" name="depart_lat" /><input type="hidden" name="depart_lng" />
      <ul class="geo-suggest hidden absolute bg-white border border-slate-200 rounded-lg shadow w-full mt-1 max-h-48 overflow-auto"></ul>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <input name="date" type="date" value="${esc(E.date || '')}" class="px-3 py-2 rounded-lg border border-slate-300" />
      <input name="heure" type="time" class="px-3 py-2 rounded-lg border border-slate-300" />
    </div>
    <input name="places" type="number" min="1" max="9" value="3" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Places disponibles" />
    <textarea name="commentaire" maxlength="280" rows="2" class="w-full px-3 py-2 rounded-lg border border-slate-300" placeholder="Commentaire (optionnel) : bagages, fumeur, animaux…"></textarea>
    <input name="website" tabindex="-1" autocomplete="off" class="hidden" aria-hidden="true" />
    <button type="submit" class="w-full bg-teal-700 text-white font-semibold py-2.5 rounded-lg">Publier mon trajet</button>
    <p class="formmsg text-center text-sm"></p>
  </form>`;
}

function openModal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
  const form = $('#tripForm');
  if (form) {
    setupGeo($('.geo', form));
    setupPickers(form);
    form.addEventListener('submit', submitTrip);
  }
}
function closeModal() { $('#modal').classList.add('hidden'); }

async function submitTrip(e) {
  const form = e.target;
  e.preventDefault();
  const msg = $('.formmsg', form);
  const payload = Object.fromEntries(new FormData(form).entries());
  msg.textContent = 'Envoi…';
  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      lsPut('covo_tokens', data.id, data.delete_token);
      closeModal();
      await loadData();
      switchTab('trajets');
    } else {
      msg.textContent = 'Erreur : ' + (data.error || 'inconnue');
    }
  } catch {
    msg.textContent = 'Erreur réseau';
  }
}

// ------------------------------------------------------------------
// Carte
// ------------------------------------------------------------------
const pin = (bg, inner, cls = '') => L.divIcon({
  className: '',
  html: `<div class="pin ${cls}" style="background:${bg}"><span>${inner}</span></div>`,
  iconSize: cls === 'pin-event' ? [36, 36] : [30, 30],
  iconAnchor: cls === 'pin-event' ? [18, 18] : [15, 15],
});

function initMap() {
  const E = CONFIG.EVENT;
  state.map = L.map('map', { zoomControl: false }).setView([E.lat, E.lng], E.zoom || 12);
  L.control.zoom({ position: 'topright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(state.map);
  L.marker([E.lat, E.lng], { icon: pin('#dc2626', '⚑', 'pin-event'), zIndexOffset: 1000 })
    .bindPopup(`<b>${esc(E.name)}</b><br>${esc(E.lieu)}<br>${esc([fmtDate(E.date), fmtTime(E.heure)].filter(Boolean).join(' à '))}`)
    .addTo(state.map);
  state.cluster = (L.markerClusterGroup ? L.markerClusterGroup({ showCoverageOnHover: false }) : L.layerGroup())
    .addTo(state.map);
}

function renderMap() {
  if (!state.map || !state.cluster) return;
  state.cluster.clearLayers();
  const E = CONFIG.EVENT;
  const pts = [[E.lat, E.lng]];
  state.trips.forEach((t) => {
    if (!t.depart_lat || !t.depart_lng) return;
    const ll = [+t.depart_lat, +t.depart_lng];
    pts.push(ll);
    const left = seatsLeft(t);
    L.marker(ll, { icon: pin('#0f766e', '🚗') })
      .bindPopup(`<b>🚗 ${esc(t.nom)}</b><br>${esc(t.depart_txt)}<br>${esc(whenStr(t))}<br>${left > 0 ? `${left} place(s) libre(s)` : 'Complet'}<br><a href="#" onclick="focusTrip('${esc(t.id)}');return false;" class="text-teal-700 underline">Voir la fiche</a>`)
      .addTo(state.cluster);
  });
  state.attente.forEach((a) => {
    if (!a.lat || !a.lng) return;
    const ll = [+a.lat, +a.lng];
    pts.push(ll);
    L.marker(ll, { icon: pin('#334155', '👤') })
      .bindPopup(`<b>👤 ${esc(a.nom)}</b>${a.depart_txt ? `<br>départ souhaité : ${esc(a.depart_txt)}` : ''}<br><span class="text-slate-500">en attente d\u2019un trajet</span>`)
      .addTo(state.cluster);
  });
  if (pts.length > 1) state.map.fitBounds(pts, { padding: [40, 160], maxZoom: 13 });
}

// Depuis un popup marker : ouvrir la fiche correspondante dans le sheet.
window.focusTrip = function (id) {
  switchTab('trajets');
  $('#sheet').classList.add('expanded');
  const el = document.getElementById('trip-' + id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-teal-500');
    setTimeout(() => el.classList.remove('ring-2', 'ring-teal-500'), 1500);
  }
};

// ------------------------------------------------------------------
// Geocodage (autocompletion via proxy Apps Script)
// ------------------------------------------------------------------
function setupGeo(box) {
  const names = { txt: 'depart_txt', lat: 'lat', lng: 'lng', ...box.dataset };
  const input = $(`input[name="${names.txt}"]`, box);
  const latEl = $(`input[name="${names.lat}"]`, box);
  const lngEl = $(`input[name="${names.lng}"]`, box);
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
// Tabs + bottom sheet + modale
// ------------------------------------------------------------------
function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('bg-white', active);
    b.classList.toggle('shadow', active);
    b.classList.toggle('text-slate-800', active);
    b.classList.toggle('text-slate-500', !active);
  });
  $('#tabTrips').classList.toggle('hidden', tab !== 'trajets');
  $('#tabAttente').classList.toggle('hidden', tab !== 'attente');
  $('#tabInfos').classList.toggle('hidden', tab !== 'infos');
}

function setupPickers(scope) {
  $$('input[type="date"], input[type="time"]', scope).forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => { try { el.showPicker(); } catch (e) {} });
  });
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
function init() {
  const E = CONFIG.EVENT;
  $('#eventName').textContent = '· ' + E.name;
  $('#sheetTitle').textContent = E.name;
  $('#sheetPlace').textContent = '📍 ' + E.lieu;
  $('#sheetDate').textContent = '📅 ' + [fmtDate(E.date), fmtTime(E.heure)].filter(Boolean).join(' à ');
  $('#tabInfos').innerHTML = infosHtml();

  initMap();
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#sheetToggle').addEventListener('click', () => {
    $('#sheet').classList.toggle('expanded');
    setTimeout(() => state.map && state.map.invalidateSize(), 120);
  });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });

  // Delegations (contenu dynamiquement re-rendu)
  document.addEventListener('click', (e) => {
    let el;
    if ((el = e.target.closest('[data-open-trip]'))) { openModal('Publier un trajet', tripFormHtml()); return; }
    if ((el = e.target.closest('[data-del]'))) { deleteRow(el.dataset.del, el.dataset.kind); return; }
    if ((el = e.target.closest('[data-join]'))) { toggleExpand('joinform:' + el.dataset.join); return; }
    if ((el = e.target.closest('[data-joins]'))) {
      loadJoins(el.dataset.joins).then(() => toggleExpand('joins:' + el.dataset.joins));
      return;
    }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.matches('[data-joinform]')) submitJoin(e);
    if (e.target.matches('#attenteForm')) submitAttente(e);
  });

  switchTab('trajets');
  loadData().then(() => setTimeout(() => state.map && state.map.invalidateSize(), 50));
}
document.addEventListener('DOMContentLoaded', init);
