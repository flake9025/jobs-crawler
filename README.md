# Sophia Jobs Crawler

Moteur de recherche d'emploi agrégé sur la zone de **Sophia Antipolis**, packagé en PWA
avec un backend Node.js. Il combine les grandes sources nationales et le crawl direct
des sites d'entreprises de la technopole — y compris celles qui **ne publient jamais**
sur LinkedIn, l'APEC ou France Travail.

## Fonctionnalités

- **Recherche agrégée** : API France Travail + agrégateurs (Welcome to the Jungle, HelloWork, APEC)
  + offres détectées directement sur les sites des entreprises locales.
- **Annuaire de ~7 300 entreprises** de la technopole, dont ~1 900 sites crawlés en continu.
- **Filtres** : niveau d'expérience (débutant / confirmé / expert), type de contrat
  (CDI, CDD, Alternance, Stage, Freelance, Intérim).
- **Tris** : pertinence, fraîcheur (offres les plus récentes), entreprise.
- **Page de statut** (`/status.html`) : progression du crawl en temps réel, couverture
  du catalogue, entreprises qui recrutent le plus, annuaire complet consultable.
- **Export Excel** des résultats filtrés.
- **PWA** installable, avec service worker (app shell hors ligne).

## Démarrage rapide

```bash
npm install
cp .env.example .env     # renseignez vos clés France Travail (optionnel)
npm start                # http://localhost:8080
```

En développement : `npm run dev` (rechargement automatique).

### Docker / NAS

```bash
docker compose up -d --build
```

Le dossier `./data` est monté en volume : le cache des offres survit aux redéploiements.

## Configuration

Toutes les options passent par variables d'environnement (voir `.env.example`).

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8080` | Port d'écoute |
| `FRANCE_TRAVAIL_CLIENT_ID` / `_SECRET` | — | Clés de l'API Offres d'emploi v2 (sans elles, le connecteur est désactivé) |
| `ENABLE_SCRAPERS` | `true` | Active le crawl des agrégateurs et des sites d'entreprises |
| `MAX_PER_SOURCE` | `25` | Nombre max de résultats par source |
| `FETCH_TIMEOUT_MS` | `12000` | Timeout réseau |
| `CRAWL_CONCURRENCY` | `12` | Sites d'entreprises analysés en parallèle (~12 min pour un tour complet) |
| `CACHE_REFRESH_MINUTES` | `360` | Intervalle entre deux crawls complets |
| `CACHE_STALE_MINUTES` | `360` | Âge au-delà duquel un crawl est relancé au démarrage |
| `CACHE_FILE` | `/app/data/companies-cache.json` | Fichier de persistance du cache |

## Architecture

```
src/
  data/
    companies-seed.js     liste curatée (sites vérifiés à la main)
    companies.json        annuaire généré (commité, ~7 300 entreprises)
    companies.js          fusion seed + annuaire, dédoublonnage
  server/
    index.js              serveur Express et API HTTP
    config.js             configuration par variables d'environnement
    cache.js              cache mémoire + persistance disque, progression du crawl
    worker.js             job de fond : crawl périodique, publication de la progression
    ranking.js            scoring de pertinence, déduplication, tri
    util.js               normalisation des offres (contrat, expérience, niveau)
    sources/
      franceTravail.js    API officielle France Travail
      aggregators.js      WTTJ, HelloWork, APEC + liens de recherche directs
      companies.js        crawl des pages carrières des entreprises locales
public/                   PWA : recherche (index.html) et statut (status.html)
scripts/fetch-companies.mjs  génération de l'annuaire
```

### Principe du crawl

Les recherches utilisateur ne scrapent **jamais** les sites d'entreprises : un worker de
fond parcourt l'annuaire toutes les 6 h, extrait les offres des pages carrières et
alimente un cache mémoire persisté sur disque. Les recherches lisent ce cache
instantanément, et n'interrogent en direct que France Travail et les agrégateurs.

Pour chaque entreprise, le crawler charge la page d'accueil, y découvre les liens
« carrières / recrutement / nous rejoindre », complète avec des chemins usuels
(`/careers`, `/recrutement`…), puis extrait les liens d'offres en s'appuyant sur des
marqueurs (`H/F`, `CDI`, `Alternance`…) et sur la forme des URLs.

Les grands employeurs dont les offres sont publiées par un ATS externe peuvent
déclarer un champ `careerSite` dans `src/data/companies-seed.js`. Le site corporate
reste utilisé pour l'annuaire, tandis que le crawler parcourt directement le portail
de recrutement (par exemple Talentsoft pour PRO BTP et Air France).

## API

| Route | Description |
|---|---|
| `GET /api/search?q=...` | Recherche agrégée, offres classées par pertinence |
| `GET /api/companies?page=&pageSize=&search=&status=` | Annuaire paginé avec statut de crawl |
| `GET /api/status` | Progression du crawl, couverture, statistiques d'offres |
| `GET /api/cache` | Statut brut du cache |
| `POST /api/cache/refresh` | Relance un crawl complet (non bloquant) |
| `GET /api/health` | Sonde de santé |

Statuts possibles d'une entreprise : `ok` (offres détectées), `no-offer` (site analysé,
aucune offre publiée), `unreachable` (site injoignable), `pending` (pas encore analysée),
`no-site` (aucun site web connu).

## Régénérer l'annuaire

```bash
npm run fetch:companies
```

Fusionne trois sources publiques et réécrit `src/data/companies.json` :

1. **sophia-antipolis.fr** — API REST du Syndicat Mixte (~5 300 acteurs officiels de la
   technopole : nom, description, filière).
2. **ville-valbonne.fr** — annuaire municipal, qui fournit les **sites web**.
3. **OpenStreetMap** (Overpass) — établissements géolocalisés de la zone avec un site web.

Options :

```bash
npm run fetch:companies -- --resume            # repart du companies.json existant
npm run fetch:companies -- --discover          # recherche les sites manquants (nom -> domaine)
npm run fetch:companies -- --discover --discover-limit=500
npm run fetch:companies -- --resolve           # devine les sites par nom de domaine (peu rentable)
npm run fetch:companies -- --limit=200         # essai à blanc, n'écrit pas le fichier
npm run fetch:companies -- --concurrency=20 --timeout=8000
```

> **`--discover`** interroge une API publique d'autocomplétion d'entreprises (nom →
> domaine), puis valide deux fois : correspondance stricte du nom, **et** ancrage
> géographique (mention de Sophia Antipolis, d'une commune voisine ou d'un code postal
> `06xxx` sur l'accueil ou une page contact / mentions légales). Sans ce second contrôle,
> on rattache des homonymes étrangers (« Hotel Sophia » → un hôtel australien). Rendement
> observé : ~300 sites validés sur 5 700 entreprises sans site.
>
> **`--resolve`** devine des domaines à partir du nom puis vérifie la page. Rendement très
> faible (quelques sites pour des milliers de tentatives) : à réserver à un cas ponctuel.
>
> Les moteurs de recherche généralistes ne sont volontairement pas utilisés : ils bloquent
> les accès automatisés et leur scraping viole leurs conditions d'utilisation.

### Couverture

Environ 5 400 entreprises de l'annuaire n'ont pas de site web connu : elles ne sont pas
crawlées directement, mais restent couvertes par France Travail, les agrégateurs et les
liens de recherche ciblés. La page `/status.html` affiche cette couverture en toute
transparence, la barre étant calculée sur les entreprises **réellement crawlables**.

## Robustesse du crawl

Un crawl complet dure une dizaine de minutes et touche près de 2 000 sites tiers. Trois
protections évitent de tout perdre en cours de route :

- **Checkpoints** : le cache est persisté toutes les 200 entreprises. Les offres déjà
  trouvées sont consultables pendant le crawl, et un redémarrage du conteneur ne fait
  plus repartir de zéro — le cache est alors marqué `partial` et le crawl reprend
  automatiquement au démarrage suivant.
- **Lecture HTML bornée** (1,5 Mo, en streaming) : certaines pages pèsent plusieurs Mo et
  suffisaient, chargées en parallèle, à faire tomber le conteneur sur un NAS.
- **Garde-fous process** : une promesse rejetée ou une exception isolée est journalisée
  sans arrêter le serveur.

Si le conteneur redémarre malgré tout, réduire `CRAWL_CONCURRENCY` (12 → 6) et fixer une
limite mémoire explicite sur le conteneur.

## Limites connues

- Le scraping des agrégateurs est *best effort* : LinkedIn et Indeed bloquent
  agressivement, d'où des liens de recherche directs systématiquement proposés.
- Les sites d'entreprises en rendu JavaScript intégral (ATS embarqués) ne sont pas
  explorés : seul le HTML servi est analysé.
- Le niveau d'expérience et le type de contrat sont déduits du texte de l'offre quand la
  source ne les fournit pas ; ils peuvent être absents (filtre « Non précisé »).

## Licence

MIT
