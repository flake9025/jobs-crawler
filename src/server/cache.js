import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

/**
 * Cache persistant des offres d'entreprises.
 * - En mémoire pour un accès instantané lors des recherches.
 * - Sur disque (JSON) pour survivre aux redémarrages / redéploiements du conteneur.
 *
 * Structure du fichier :
 * {
 *   format: <CACHE_FORMAT>,
 *   updatedAt: <ISO string | null>,
 *   partial: false,
 *   jobs: [ { title, company, location, url, source, ... }, ... ],
 *   companies: [ { name, status, jobs, truncated, careerUrls, ... }, ... ]
 * }
 */

// À incrémenter quand l'extraction des offres change sensiblement : un cache produit
// par un crawler antérieur est alors considéré comme périmé et recalculé au démarrage.
const CACHE_FORMAT = 3;

let state = {
  format: CACHE_FORMAT,
  updatedAt: null,
  refreshing: false,
  // true quand le cache est un instantané pris au milieu d'un crawl interrompu.
  partial: false,
  jobs: [],
  // Statistiques par entreprise (catalogue de sources).
  companies: [],
  // Progression du crawl en cours.
  progress: { done: 0, total: 0, current: [], startedAt: null, finishedAt: null },
};

/** Charge le cache depuis le disque au démarrage (si présent). */
export async function loadCache() {
  try {
    const raw = await fs.readFile(config.cache.file, "utf-8");
    const parsed = JSON.parse(raw);
    state.format = parsed.format || 1;
    state.updatedAt = parsed.updatedAt || null;
    state.partial = Boolean(parsed.partial);
    state.jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    state.companies = Array.isArray(parsed.companies) ? parsed.companies : [];
    console.log(
      `[cache] chargé : ${state.jobs.length} offres (maj ${state.updatedAt || "jamais"}${
        state.partial ? ", crawl interrompu" : ""
      })`
    );
  } catch {
    console.log("[cache] aucun cache existant, démarrage à vide.");
  }
}

/**
 * Persiste le cache sur disque.
 * `partial` marque un instantané pris pendant un crawl : au redémarrage, le cache
 * sera considéré comme périmé afin que le crawl reprenne au lieu de rester figé.
 */
async function persist() {
  try {
    await fs.mkdir(path.dirname(config.cache.file), { recursive: true });
    await fs.writeFile(
      config.cache.file,
      JSON.stringify(
        {
          format: state.format,
          updatedAt: state.updatedAt,
          partial: state.partial,
          jobs: state.jobs,
          companies: state.companies,
        },
        null,
        0
      ),
      "utf-8"
    );
  } catch (err) {
    console.error("[cache] échec persistance :", err.message);
  }
}

/** Remplace le contenu du cache avec de nouvelles offres. */
export async function setCacheJobs(jobs, companies = null) {
  state.jobs = jobs;
  if (Array.isArray(companies)) state.companies = companies;
  state.format = CACHE_FORMAT;
  state.updatedAt = new Date().toISOString();
  state.partial = false;
  await persist();
}

/**
 * Instantané intermédiaire pendant un crawl : les offres déjà trouvées deviennent
 * immédiatement consultables et survivent à un redémarrage du conteneur.
 */
export async function saveCheckpoint(jobs, companies) {
  state.jobs = [...jobs];
  state.companies = [...companies];
  state.format = CACHE_FORMAT;
  state.updatedAt = new Date().toISOString();
  state.partial = true;
  await persist();
}

export function getCacheJobs() {
  return state.jobs;
}

/** Statistiques de couverture par entreprise (catalogue). */
export function getCompanyStats() {
  return state.companies;
}

export function getProgress() {
  return state.progress;
}

export function setProgress(patch) {
  state.progress = { ...state.progress, ...patch };
}

export function getCacheStatus() {
  return {
    updatedAt: state.updatedAt,
    refreshing: state.refreshing,
    partial: state.partial,
    count: state.jobs.length,
    progress: state.progress,
  };
}

export function setRefreshing(v) {
  state.refreshing = v;
}

/**
 * Le cache est-il périmé (ou vide) ?
 * On force également un refresh quand le cache provient d'une version antérieure
 * (pas de statistiques par entreprise) : sans ça, un vieux cache « frais » empêchait
 * tout crawl au démarrage et la page de statut restait figée.
 */
export function isStale() {
  if (!state.updatedAt) return true;
  if (!state.companies.length) return true;
  // Cache produit par une version antérieure du crawler.
  if (state.format !== CACHE_FORMAT) return true;
  // Crawl interrompu (redémarrage du conteneur) : on reprend sans attendre.
  if (state.partial) return true;
  const ageMin = (Date.now() - new Date(state.updatedAt).getTime()) / 60000;
  return ageMin >= config.cache.staleMinutes;
}
