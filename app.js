/* Covoiturage evenement - frontend statique, zero dependance hors Leaflet/Tailwind */

const CONFIG = {
  // >>> Coler ici l'URL /exec de ton Apps Script Web App <<<
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbw-SNNQK5JhzQ0NDz051gcPNQH6eeg_EZ_-NSgrwQKx92ljH9mRhk3EhAeWCZ_2KrP9/exec',

  // Optionnel : lieu de l'evenement pour centrer la carte. Mettre null sinon.
  EVENT: null, // ex: { name: 'Festival Guy Roux', lat: 47.0, lng: 2.0, zoom: 12 }

  // Repli si pas d'EVENT
  DEFAULT_CENTER: [46.6, 2.4],
  DEFAULT_ZOOM: 6,
};

const state = {
  rides: [],
  tab: 'offres',
  filters: { origin: '', dest: '', date: '' },
  map: null,
  markers: [],
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
  if (/@/.test(v)) return `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
  const tel = v.replace(/[^\d+]/g, '');
  return `<a href="tel:${esc(tel)}">${esc(v)}</a>`;
}

function card(r) {
  const tokens = myTokens();
  const del = tokens[r.id]
    ? `<button data-del="${esc(r.id)}" class="wa-del text-sm mt-2 block">[ supprimer ma fiche ]</button>` : '';
  const places = r.type === 'offre' && r.places ? `<span class="wa-meta">· ${esc(r.places)} place(s)</span>` : '';
  const when = [fmtDate(r.date), fmtTime(r.heure)].filter(Boolean).join(' à ');
  const badge = r.type === 'offre' ? 'wa-badge--offre' : 'wa-badge--demande';
  return `
    <article class="wa-card p-4">
      <div class="flex items-start justify-between gap-2">
        <div class="wa-route text-xl leading-tight">${esc(r.depart_txt)} <span class="wa-arrow">→</span> ${esc(r.arrivee_txt)}</div>
        <span class="wa-badge shrink-0 ${badge}">${r.type === 'offre' ? 'Offre' : 'Demande'}</span>
      </div>
      <div class="wa-meta text-base mt-1">${when ? esc(when) + ' ' : ''}${places}</div>
      ${r.commentaire ? `<p class="wa-meta text-base mt-1">${esc(r.commentaire)}</p>` : ''}
      <div class="wa-contact text-base mt-2">${esc(r.nom)} · ${contactLink(r.contact)}</div>
      ${del}
    </article>`;
}

function render() {
  const list = $('#list');
  const rows = filtered();
  updateCounter();
  if (state.tab === 'publier') return;
  list.innerHTML = rows.length
    ? rows.map(card).join('')
    : `<p class="wa-meta text-center py-8 text-lg">// aucun trajet pour l'instant</p>`;
  $$('[data-del]', list).forEach((b) => b.addEventListener('click', () => deleteRide(b.dataset.del)));
  renderMap(rows);
}

function updateCounter() {
  const el = $('#counter');
  if (!el) return;
  const n = String(state.rides.length).padStart(3, '0');
  el.textContent = 'TRAJETS · ' + n;
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
}

const icon = (color) => L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,.5)"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
});

function renderMap(rows) {
  if (!state.map) return;
  state.markers.forEach((m) => state.map.removeLayer(m));
  state.markers = [];
  const bounds = [];
  rows.forEach((r) => {
    if (r.depart_lat && r.depart_lng) {
      const m = L.marker([+r.depart_lat, +r.depart_lng], { icon: icon('#ffd93b') })
        .bindPopup(`<b>Départ</b> ${esc(r.depart_txt)}<br>${esc(r.nom)} · ${esc(r.date || '')} ${esc(r.heure || '')}`)
        .addTo(state.map);
      state.markers.push(m); bounds.push([+r.depart_lat, +r.depart_lng]);
    }
    if (r.arrivee_lat && r.arrivee_lng) {
      const m = L.marker([+r.arrivee_lat, +r.arrivee_lng], { icon: icon('#f5a623') })
        .bindPopup(`<b>Arrivée</b> ${esc(r.arrivee_txt)}<br>${esc(r.nom)}`)
        .addTo(state.map);
      state.markers.push(m); bounds.push([+r.arrivee_lat, +r.arrivee_lng]);
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
          `<li data-i="${i}" class="px-3 py-2 cursor-pointer text-base">${esc(x.display)}</li>`).join('');
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
    msg.textContent = 'Envoi…'; msg.style.color = 'var(--cream-dim)';
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
        msg.textContent = 'Publié ! Merci.'; msg.style.color = 'var(--emmental)';
        await loadRides();
        setTimeout(() => switchTab(state.tab === 'publier' ? 'offres' : state.tab), 800);
      } else {
        msg.textContent = 'Erreur : ' + (data.error || 'inconnue'); msg.style.color = 'var(--brick)';
      }
    } catch (err) {
      msg.textContent = 'Erreur réseau'; msg.style.color = 'var(--brick)';
    }
  });
}

// ------------------------------------------------------------------
// Tabs + filtres
// ------------------------------------------------------------------
function switchTab(tab) {
  state.tab = tab;
  $$('.wa-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  const isForm = tab === 'publier';
  $('#formWrap').classList.toggle('hidden', !isForm);
  $('#list').classList.toggle('hidden', isForm);
  $('#filters').classList.toggle('hidden', isForm);
  if (!isForm) render();
}

function setupTabs() {
  $$('.wa-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
}

function setupFilters() {
  $('#fOrigin').addEventListener('input', (e) => { state.filters.origin = e.target.value; render(); });
  $('#fDest').addEventListener('input', (e) => { state.filters.dest = e.target.value; render(); });
  $('#fDate').addEventListener('input', (e) => { state.filters.date = e.target.value; render(); });
}

function setupMapToggle() {
  const btn = $('#toggleMap');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const wrap = $('#mapWrap');
    wrap.classList.toggle('hidden');
    if (!state.map && !wrap.classList.contains('hidden')) initMap();
    if (state.map) setTimeout(() => state.map.invalidateSize(), 50);
  });
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
function init() {
  if (CONFIG.EVENT) $('#siteTitle').textContent = 'Pars-tu ? · ' + CONFIG.EVENT.name;
  setupTabs();
  setupFilters();
  setupMapToggle();
  setupForm();
  $$('.geo').forEach(setupGeo);
  loadRides();
}
document.addEventListener('DOMContentLoaded', init);
