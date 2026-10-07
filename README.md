# Pars-tu ? 🚗 — covoiturage d'événement (Québec)

Mini-site covoiturage **sans login**, mobile-first, **100 % gratuit et jetable**.
Backend = une **Google Sheet** + **Google Apps Script**. Front = fichiers statiques.
Carte **Leaflet + OpenStreetMap**, géocodage **Nominatim** (proxy via Apps Script).
Le tout gratuit → on supprime le projet Vercel + la Sheet une fois l'événement passé.

## Architecture
```
Navigateur (Vercel statique)
   │  fetch JSON (GET list/geocode/delete, POST create)
   ▼
Apps Script Web App  ──►  Google Sheet "trajets"
   └─ proxy Nominatim (User-Agent + cache geocache)
```
Aucune clé API, aucun serveur à toi, aucune donnée sur un LAN exposé.

## 1. Backend (Google) — ~10 min
1. Crée une Google Sheet vide → **Extensions > Apps Script**.
2. Colle le contenu de [`apps-script/Code.gs`](apps-script/Code.gs), **enregistre**.
3. (Optionnel) remplace l'email dans le `User-Agent` de `geocode_` par le tien
   (politique Nominatim).
4. **Deploy > New deployment > Web app** :
   - *Execute as* : **Me**
   - *Who has access* : **Anyone**
5. Copie l'**URL `/exec`**.

> La sheet crée automatiquement les onglets `trajets` (données) et `geocache`
> (cache géocodage) à la première requête. Les orgas peuvent passer une ligne en
> `visible=false` pour la masquer sans la supprimer.

## 2. Front — config
Dans [`app.js`](app.js), édite `CONFIG` :
```js
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/XXXX/exec',
EVENT: { name: 'Nom Événement', lat: 47.0, lng: 2.0, zoom: 12 }, // ou null
```
`EVENT` sert juste à centrer la carte ; sinon trajets ville-à-ville libres.

## 3. Déployer sur Vercel — ~2 min
```bash
cd projects/covoiturage
vercel --prod        # projet "Other" / statique, pas de build
```
Ou importer le dossier sur vercel.com (Framework : **Other**, build : vide).
Supprimer le projet Vercel = le site meurt.

## Modèle de données (onglet `trajets`)
`id · type · nom · contact · depart_txt · depart_lat · depart_lng · arrivee_txt ·
arrivee_lat · arrivee_lng · date · heure · places · commentaire · ts · visible · token`

- `token` : secret de suppression par l'auteur (jamais renvoyé au front).
- `visible` : modération manuelle par les orgas.

## Anti-abus (léger, sans login)
- Honeypot caché (`website`) + contact obligatoire.
- Modération a posteriori via colonne `visible`.
- Suppression d'une fiche par lien/token conservé en `localStorage` par l'auteur.

## Limites assumées (esprit "une après-midi")
- Contact affiché **en clair** (RGPD : données publiques, volontaires, éphémères).
- Nominatim public = throttled ; le cache Sheet limite les appels.
- Pas de compte, pas de messagerie, pas de temps réel (refresh = rechargement).
