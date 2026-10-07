# Pars-tu ? 🚗 — covoiturage d'événement (Québec)

Mini-site covoiturage **sans login**, mobile-first, **100 % gratuit et jetable**.
Backend = une **Google Sheet** + **Google Apps Script**. Front = fichiers statiques.
Carte **Leaflet + OpenStreetMap**, géocodage **Photon (OSM, sans clé)** via proxy Apps Script.
Le tout gratuit → on supprime le projet Vercel + la Sheet une fois l'événement passé.

## Architecture
```
Navigateur (Vercel statique)
   │  fetch JSON (GET list/geocode/delete/joins, POST create/join)
   ▼
Apps Script Web App  ──►  Google Sheet "trajets" + "joins"
   └─ proxy Photon (User-Agent + biais Québec + cache geocache)
```
Aucune clé API, aucun serveur à toi, aucune donnée sur un LAN exposé.

## 1. Backend (Google) — ~10 min
1. Crée une Google Sheet vide → **Extensions > Apps Script**.
2. Colle le contenu de [`apps-script/Code.gs`](apps-script/Code.gs), **enregistre**.
3. (Optionnel) remplace l'email dans le `User-Agent` de `geocode_` par le tien
   (bon usage Photon). Le biais Québec est réglable via `GEO_BIAS_LAT/LON`.
4. **Deploy > New deployment > Web app** :
   - *Execute as* : **Me**
   - *Who has access* : **Anyone**
5. Copie l'**URL `/exec`**.

> La sheet crée automatiquement les onglets `trajets` (données), `geocache`
> (cache géocodage) et `joins` (demandes « rejoindre ») à la première requête.
> Les orgas peuvent passer une ligne en `visible=false` pour la masquer sans la supprimer.
>
> ⚠️ Après chaque modification de `Code.gs` : **Deploy > Manage deployments >
> Edit > Version : New version > Deploy** (sinon l'ancienne version reste servie).

## 2. Front — config
Dans [`app.js`](app.js), édite `CONFIG` :
```js
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/XXXX/exec',
EVENT: { name: 'Nom Événement', lat: 47.0, lng: 2.0, zoom: 12 }, // ou null
```
`EVENT` sert juste à centrer la carte ; sinon trajets ville-à-ville libres.

## 3. Déployer sur Vercel — ~2 min
```bash
vercel --prod        # projet "Other" / statique, pas de build
```
Ou importer le repo `f4t/parstu` sur vercel.com (Framework : **Other**, build : vide).
Supprimer le projet Vercel = le site meurt.

## Modèle de données (onglet `trajets`)
`id · type · nom · contact · depart_txt · depart_lat · depart_lng · arrivee_txt ·
arrivee_lat · arrivee_lng · date · heure · places · commentaire · ts · visible · token`

- `token` : secret de suppression par l'auteur (jamais renvoyé au front).
- `visible` : modération manuelle par les orgas.

## Modèle de données (onglet `joins`)
`id · ride_id · nom · contact · places · message · ts`

- Une ligne = une demande de place sur une offre (`ride_id`).
- Liste **publique** ; les N premiers (ordre d'arrivée, cumul `places`) sont
  affichés « confirmés », les suivants « attente » — **indicatif**, pas de
  réservation atomique (Sheets oblige) : le conducteur garde la main.

## Matching offre ↔ demande (côté client)
Calculé dans le navigateur sur les lat/lng géocodées : **même date**,
départ ≤ `MATCH_RADIUS_KM` (25 km), arrivée ≤ 25 km, heures ±
`MATCH_HOURS_TOLERANCE` (2 h) si renseignées des deux côtés.

## Anti-abus (léger, sans login)
- Honeypot caché (`website`) + contact obligatoire.
- Modération a posteriori via colonne `visible`.
- Suppression d'une fiche par lien/token conservé en `localStorage` par l'auteur.

## Limites assumées (esprit "une après-midi")
- Contact affiché **en clair** (RGPD : données publiques, volontaires, éphémères).
- Photon public = throttled ; le cache Sheet limite les appels.
- Pas de compte, pas de messagerie, pas de temps réel (refresh = rechargement).
