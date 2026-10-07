# Pars-tu ? 🚗 — covoiturage d'événement (concept type Caroster)

Mini-site covoiturage **sans login**, mobile-first, **100 % gratuit et jetable**.
Organisé autour de **l'événement** : les conducteurs publient des trajets **vers
l'événement**, les passagers les **rejoignent** ou s'inscrivent à la **liste
d'attente**. Inspiré de [caroster.io](https://caroster.io) (concept, pas le code).

Backend = une **Google Sheet** + **Google Apps Script**. Front = fichiers statiques.
Carte **Leaflet + OpenStreetMap**, géocodage **Photon (OSM, sans clé)** via proxy Apps Script.

## Architecture
```
Navigateur (Vercel statique)
   │  fetch JSON (GET list/geocode/joins/delete, POST trajet/join/attente)
   ▼
Apps Script Web App  ──►  Google Sheet : trajets · joins · attente · geocache
   └─ proxy Photon (User-Agent + biais Québec + cache)
```
Aucune clé API, aucun serveur à toi.

## 1. Backend (Google) — ~10 min
1. Crée une Google Sheet vide → **Extensions > Apps Script**.
2. Colle le contenu de [`apps-script/Code.gs`](apps-script/Code.gs), **enregistre**.
3. (Optionnel) remplace l'email dans le `User-Agent` de `geocode_` par le tien.
4. **Deploy > New deployment > Web app** :
   - *Execute as* : **Me** — *Who has access* : **Anyone**
5. Copie l'**URL `/exec`** dans `CONFIG.APPS_SCRIPT_URL` (front).

> Les onglets `trajets`, `joins`, `attente` et `geocache` sont créés
> automatiquement à la première requête. Modération : passer une ligne en
> `visible=false` la masque sans la supprimer.
>
> ⚠️ Après **chaque** modification de `Code.gs` : **Deploy > Manage deployments >
> Edit > Version : New version > Deploy** (sinon l'ancienne version reste servie).

## 2. Front — config
Dans [`app.js`](app.js), édite `CONFIG` :
```js
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/XXXX/exec',
EVENT: {
  name: 'Nom de l\u2019événement',
  lieu: 'Adresse du lieu',
  lat: 45.5056, lng: -73.5716, zoom: 11,
  date: '2026-11-01', heure: '09:00',
  description: 'Quelques mots sur l\u2019événement…',
},
```
L'événement est la **destination implicite** de tous les trajets.

## 3. Déployer sur Vercel — ~2 min
Importer le repo `f4t/parstu` sur vercel.com (Framework : **Other**, build : vide),
ou `vercel --prod`. Supprimer le projet Vercel = le site meurt.

## Utilisation (3 rôles, zéro compte)
- **Conducteur** : onglet *Trajets* ou *Infos* → « Publier un trajet » (nom,
  téléphone, départ géocodé, date/heure, places, commentaire).
- **Passager** : « Rejoindre » un trajet (nom + contact + places) — si c'est
  complet, la demande passe en **liste d'attente** du trajet ; ou onglet
  *Attente* → « Je cherche un trajet » (liste globale, contacts visibles des
  conducteurs).
- **Auteur** : chaque fiche publiée depuis un navigateur peut être masquée
  (token en `localStorage`).

## Modèle de données
- `trajets` : `id · nom · contact · depart_txt · depart_lat · depart_lng · date ·
  heure · places · commentaire · ts · visible · token`
- `joins` : `id · trip_id · nom · contact · places · message · ts` — les N
  premiers (ordre d'arrivée, cumul places) = « confirmés », la suite = « attente »
  (**indicatif**, pas de réservation atomique : le conducteur garde la main).
- `attente` : `id · nom · contact · depart_txt · lat · lng · message · ts ·
  visible · token` — liste globale des passagers en recherche.
- `geocache` : cache géocodage Photon (colonne `cc` = code pays).

## Anti-abus (léger, sans login)
- Honeypot caché (`website`) + contact obligatoire.
- Modération a posteriori via colonne `visible`.
- Suppression d'une fiche par token conservé en `localStorage` par l'auteur.

## Limites assumées (esprit "une après-midi")
- Contact affiché **en clair** (données publiques, volontaires, éphémères).
- Pas de réservation atomique (Sheets oblige) : statuts indicatifs.
- Pas de compte, pas de messagerie, pas de temps réel (refresh = rechargement).
- Aller simple uniquement : un aller-retour = deux trajets publiés.
