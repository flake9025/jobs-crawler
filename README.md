# Sophia Jobs Crawler

Moteur de recherche d'emploi agrégé sur la zone de **Sophia Antipolis**, packagé en PWA
avec un backend Node.js. Il combine les grandes sources nationales et le crawl direct
des sites d'entreprises de la technopole — y compris celles qui **ne publient jamais**
sur LinkedIn, l'APEC ou France Travail.

## Fonctionnalités

- **Recherche agrégée** : API France Travail + agrégateurs (Welcome to the Jungle, HelloWork, APEC)
  + offres détectées directement sur les sites des entreprises locales.
- **Annuaire de ~7 300 entreprises** de la technopole, dont ~1 950 sites crawlés en continu.
- **Onglet « Entreprises »** : sélection éditoriale des employeurs emblématiques de la technopole
  (grands employeurs, startups, grandes ESN, ESN montantes). Chaque fiche affiche le nombre
  d'offres détectées sur le site carrières, un bouton **« Voir les offres »** (recherche en
  mode entreprise : `/?company=Amadeus`, filtrable par mot-clé) et **« Candidature spontanée »**.
  Ces entreprises sont crawlées en priorité et intégrées au moteur de recherche : leurs offres
  remontent dans les recherches classiques, rattachées à la fiche via leurs alias.
- **Accueil** : les entreprises vedettes qui publient le plus d'offres, en un clic.
- **Alertes nouvelles offres** : suivez une recherche ou une entreprise ; les nouveautés sont
  signalées par une pastille sur la cloche, par notification navigateur et/ou par email.
- **Suivi des offres** : les offres ouvertes apparaissent comme « vues », et chacune peut être
  marquée candidatée ou ignorée (stockage local navigateur, aucun compte requis) ; elles restent
  grisées lors des prochaines visites, et les ignorées peuvent être masquées.
- **Filtres** : niveau d'expérience (débutant / confirmé / expert), type de contrat
  (CDI, CDD, Alternance, Stage, Freelance, Intérim).
- **Tris** : pertinence, fraîcheur (offres les plus récentes), entreprise.
- **Page de statut** (`/status.html`) : progression du crawl en temps réel, couverture
  du catalogue, entreprises qui recrutent le plus, annuaire complet consultable.
- **Export Excel** des résultats filtrés (avec le statut de chaque offre).
- **PWA** installable, avec service worker (interface disponible hors ligne, notifications).
- **Erreurs lisibles** : si l'API est injoignable (coupure réseau, proxy d'entreprise), l'interface
  affiche « Erreur technique : API injoignable » plutôt qu'une erreur JSON.

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
| `ALERTS_FILE` | `/app/data/alerts.json` | Fichier de persistance des alertes (recherches sauvegardées) |
| `ALERTS_CHECK_MINUTES` | `30` | Intervalle entre deux vérifications des alertes (en plus de la vérification après chaque crawl) |
| `PUBLIC_URL` | — | Adresse publique de l'application (ex. `https://jobs.mondomaine.fr`) : liens « Ouvrir dans Sophia Jobs » et « Se désabonner » des emails |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | Serveur SMTP pour les alertes email (désactivées si absent) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CONTACT_EMAIL` | — | Clés pour les notifications push (générées par `npm run vapid:generate`) |

## Alertes "nouvelles offres"

Après une recherche (ou depuis la fiche d'une entreprise), le bouton **« Créer une alerte »**
enregistre la recherche. Les alertes sont vérifiées après chaque crawl et toutes les
`ALERTS_CHECK_MINUTES` minutes, sur les mêmes sources que la recherche. Les offres déjà
présentes à la création ne sont pas signalées : seules les nouveautés le sont.

Trois canaux, cumulables :

| Canal | Prérequis | Comportement |
|---|---|---|
| **Dans l'application** | aucun | Pastille sur la cloche, liste « Mes alertes » ; les nouveautés sont mises en avant (badge « Nouveau ») à l'ouverture de l'alerte. |
| **Notification navigateur** | clés VAPID **et** site servi en **HTTPS** | Notification système, même onglet fermé ; un clic ouvre l'alerte. |
| **Email** | SMTP configuré (+ `PUBLIC_URL` recommandé) | Récapitulatif des nouvelles offres, avec lien de désinscription. |

> **Pourquoi le navigateur ne propose pas les notifications ?** Les navigateurs n'autorisent
> les notifications push que sur un **site sécurisé** (HTTPS, ou `localhost`). Servie en HTTP
> (`http://NAS:8082`), l'application ne peut pas les proposer : le panneau d'alerte l'indique
> et seuls les canaux application et email restent disponibles. Il faut aussi des clés VAPID
> côté serveur. Sur iPhone/iPad, l'application doit être ajoutée à l'écran d'accueil (iOS 16.4+).

Activer les notifications sur le NAS Synology :

1. Générer les clés : `npm run vapid:generate`, puis copier `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`,
   ainsi que `VAPID_CONTACT_EMAIL` (votre adresse), dans `/volume1/docker/apps/sophia-jobs/.env`.
   Pas dans les secrets GitHub : l'image publiée sur GHCR reste générique et ne contient aucune clé.
2. Exposer l'application en HTTPS : *Panneau de configuration → Portail de connexion → Avancé →
   Proxy inversé* (source `https://jobs.mondomaine.fr:443` → destination `http://localhost:8082`),
   avec un certificat Let's Encrypt (*Sécurité → Certificat*).
3. Renseigner `PUBLIC_URL=https://jobs.mondomaine.fr`, puis recréer le conteneur en relançant le
   déploiement : un simple redémarrage ne relit pas le `.env` (`docker run --env-file`). Au démarrage,
   le journal indique « Alertes push : activées », ou pourquoi les clés ont été refusées.

Pour l'email, ajouter `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` dans le même
`.env`. Le lien de désinscription affiche une page de confirmation (les antivirus et
prévisualisations de messagerie qui « cliquent » sur les liens ne suppriment donc pas l'alerte).

Côté vie privée : les alertes ne sont pas listables, l'identifiant aléatoire de chaque alerte
sert de clé d'accès, et l'adresse email n'est jamais renvoyée en clair par l'API. Les
notifications ne partent que vers les services push des navigateurs (Google, Mozilla, Microsoft,
Apple) : tout autre abonnement est refusé.

## Suivi des offres (vues / candidatées / ignorées)

Une offre ouverte est marquée « Vue » ; chaque offre peut aussi être marquée « Candidaté » ou
« Ignorer » depuis sa carte. Ces statuts sont mémorisés dans le `localStorage` du navigateur
(sans compte ni serveur) et synchronisés entre onglets. Les offres traitées apparaissent
grisées lors des prochaines visites, l'interrupteur « Masquer les offres ignorées » les retire
de la liste, et « Rétablir » efface le statut. Les simples « vues » sont oubliées après 6 mois.

## Architecture

```
src/
  data/
    companies-seed.js     liste curatée (sites vérifiés à la main)
    companies.json        annuaire généré (commité, ~7 300 entreprises)
    companies.js          fusion vedettes + seed + annuaire, dédoublonnage par nom et alias
    featured-companies.js sélection éditoriale (grands employeurs, startups, ESN) : pages d'offres vérifiées
  server/
    index.js              serveur Express et API HTTP
    config.js             configuration par variables d'environnement
    search.js             recherche agrégée factorisée (utilisée par l'API et les alertes)
    cache.js              cache mémoire + persistance disque, progression du crawl
    worker.js             job de fond : crawl périodique, vérification des alertes
    alerts.js             alertes "nouvelles offres" (recherches sauvegardées, notifications)
    mailer.js             envoi des emails d'alerte (nodemailer / SMTP)
    push.js               notifications push navigateur (web-push / VAPID)
    ranking.js            scoring de pertinence, déduplication, tri
    util.js               normalisation des offres (contrat, expérience, niveau, dates, noms d'employeur)
    geo.js                localisation des offres (Alpes-Maritimes, Sophia Antipolis et communes voisines)
    sources/
      franceTravail.js    API officielle France Travail
      aggregators.js      WTTJ, HelloWork, APEC + liens de recherche directs
      companies.js        crawl des pages carrières des entreprises locales
      ats.js              connecteurs API des ATS (Workday, Phenom, Greenhouse, Lever, Recruitee…)
public/                   PWA : recherche + entreprises (index.html, app.js), statut (status.html),
                          composants partagés (ui.js), service worker (sw.js)
scripts/fetch-companies.mjs  génération de l'annuaire
scripts/generate-vapid-keys.mjs  génération des clés de notifications push
```

### Principe du crawl

Les recherches utilisateur ne scrapent **jamais** les sites d'entreprises : un worker de
fond parcourt l'annuaire toutes les 6 h, extrait les offres des pages carrières et
alimente un cache mémoire persisté sur disque. Les recherches lisent ce cache
instantanément, et n'interrogent en direct que France Travail et les agrégateurs.

Pour chaque entreprise, le crawler charge la page d'accueil, y découvre les liens
« carrières / recrutement / nous rejoindre », complète avec des chemins usuels
(`/careers`, `/recrutement`…), puis extrait les liens d'offres en s'appuyant sur des
marqueurs (`H/F`, `CDI`, `Alternance`…) et sur la forme des URLs. Les liens de navigation
(« Voir les 15 offres », filtres, versions traduites d'une même offre) sont écartés, et une
entreprise est plafonnée à 40 offres (affiché « 40+ ») pour ne pas noyer les résultats.

Quand la page d'offres est un **ATS connu** (Workday, Phenom, Greenhouse, Lever, Recruitee,
SmartRecruiters, SuccessFactors), le crawler interroge directement son API publique : les offres
sont alors complètes et localisées, même si la page est rendue en JavaScript.

Les fiches de `src/data/featured-companies.js` (et certaines de `companies-seed.js`) précisent
le crawl :

| Champ | Rôle |
|---|---|
| `careerSite` | Page (ou ATS) crawlée à la place du site corporate |
| `careerUrl` | Page carrières destinée à l'humain (bouton « Site carrières ») |
| `applyUrl` | Page de candidature spontanée (à défaut : `careerUrl`, puis `site`) |
| `aliases` | Autres raisons sociales : rattachent doublons de l'annuaire et offres des job boards |
| `localOnly` | Ne garde que les offres situées dans les Alpes-Maritimes (listes nationales) |
| `offerUrlFilter` | Ne garde que les offres dont l'URL contient ce segment (site partagé par un groupe, ex. `/emploi/06/balitrand/` sur le site Ciffréo Bona) |
| `crawl: false` | Site inexploitable (anti-robot, application JavaScript) : fiche « à consulter sur leur site », sans « 0 offre » trompeur |

Le format du cache est versionné (`CACHE_FORMAT` dans `src/server/cache.js`) : quand
l'extraction change, un cache produit par l'ancienne version est recalculé automatiquement
au démarrage suivant. Les offres se reconstituent alors au fil du crawl (entreprises vedettes
en premier, instantané toutes les 200 entreprises).

## API

| Route | Description |
|---|---|
| `GET /api/search?q=...&company=...` | Recherche agrégée (`q` et/ou `company`), offres classées par pertinence ; `company` restreint à un employeur et renvoie sa fiche |
| `GET /api/featured-companies` | Sélection éditoriale par catégorie, avec nombre d'offres et statut de crawl |
| `GET /api/companies?page=&pageSize=&search=&status=` | Annuaire paginé avec statut de crawl |
| `GET /api/config` | Version et canaux d'alerte disponibles (email, push, clé VAPID publique) |
| `POST /api/alerts` | Crée une alerte `{ query?, company?, email? }` |
| `GET /api/alerts/:id` | État d'une alerte (nouveautés en attente, canaux) |
| `POST /api/alerts/:id/ack` | Marque les nouveautés comme vues |
| `POST /api/alerts/:id/subscribe` | Abonne un navigateur aux notifications push de l'alerte |
| `DELETE /api/alerts/:id` | Supprime une alerte |
| `GET` / `POST /api/alerts/:id/unsubscribe` | Page de désinscription (lien des emails) / confirmation |
| `GET /api/status` | Progression du crawl, couverture, statistiques d'offres |
| `GET /api/cache` | Statut brut du cache |
| `POST /api/cache/refresh` | Relance un crawl complet (non bloquant) |
| `GET /api/version` | Version, build et date de livraison (pied de page) |
| `GET /api/health` | Sonde de santé |

Statuts possibles d'une entreprise : `ok` (offres détectées), `no-offer` (site analysé,
aucune offre publiée), `unreachable` (site injoignable), `error` (erreur d'analyse),
`pending` (pas encore analysée), `link-only` (site non analysable automatiquement, à
consulter directement), `no-site` (aucun site web connu).

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
- Les sites d'entreprises en rendu JavaScript intégral ne sont pas explorés (seul le HTML
  servi est analysé), sauf quand ils reposent sur un ATS connu interrogé par API. Les fiches
  vedettes concernées (SAP Labs, IBM, Capgemini, Alten, CGI…) sont marquées « à consulter
  sur leur site » ; leurs offres relayées par France Travail et les agrégateurs restent
  rattachées à la fiche.
- Le niveau d'expérience et le type de contrat sont déduits du texte de l'offre quand la
  source ne les fournit pas ; ils peuvent être absents (filtre « Non précisé »).

## Licence

MIT
