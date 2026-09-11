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
 *   updatedAt: <ISO string | null>,
 *   refreshing: false,
 *   jobs: [ { title, company, location, url, source, ... }, ... ]
 * }
 */

let state = {
  updatedAt: null,
  refreshing: false,
  jobs: [],
};

/** Charge le cache depuis le disque au démarrage (si présent). */
export async function loadCache() {
  try {
    const raw = await fs.readFile(config.cache.file, "utf-8");
    const parsed = JSON.parse(raw);
    state.updatedAt = parsed.updatedAt || null;
    state.jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    console.log(`[cache] chargé : ${state.jobs.length} offres (maj ${state.updatedAt || "jamais"})`);
  } catch {
    console.log("[cache] aucun cache existant, démarrage à vide.");
  }
}

/** Persiste le cache sur disque. */
async function persist() {
  try {
    await fs.mkdir(path.dirname(config.cache.file), { recursive: true });
    await fs.writeFile(
      config.cache.file,
      JSON.stringify({ updatedAt: state.updatedAt, jobs: state.jobs }, null, 0),
      "utf-8"
    );
  } catch (err) {
    console.error("[cache] échec persistance :", err.message);
  }
}

/** Remplace le contenu du cache avec de nouvelles offres. */
export async function setCacheJobs(jobs) {
  state.jobs = jobs;
  state.updatedAt = new Date().toISOString();
  await persist();
}

export function getCacheJobs() {
  return state.jobs;
}

export function getCacheStatus() {
  return {
    updatedAt: state.updatedAt,
    refreshing: state.refreshing,
    count: state.jobs.length,
  };
}

export function setRefreshing(v) {
  state.refreshing = v;
}

/** Le cache est-il périmé (ou vide) ? */
export function isStale() {
  if (!state.updatedAt) return true;
  const ageMin = (Date.now() - new Date(state.updatedAt).getTime()) / 60000;
  return ageMin >= config.cache.staleMinutes;
}
