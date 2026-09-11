import { config } from "./config.js";
import { crawlAllCompanies } from "./sources/companies.js";
import {
  setCacheJobs,
  setRefreshing,
  getCacheStatus,
  isStale,
} from "./cache.js";

/**
 * Worker de fond : rafraîchit périodiquement le cache des offres d'entreprises.
 * Le scraping des ~100 sites peut prendre du temps, mais il ne bloque JAMAIS
 * les recherches utilisateur (qui lisent le cache en mémoire).
 */

let running = false;

export async function refreshCompanyCache(reason = "manuel") {
  if (running) {
    console.log("[worker] refresh déjà en cours, ignoré.");
    return;
  }
  if (!config.enableScrapers) {
    console.log("[worker] scrapers désactivés, refresh ignoré.");
    return;
  }

  running = true;
  setRefreshing(true);
  const started = Date.now();
  console.log(`[worker] début du refresh cache entreprises (${reason})…`);

  try {
    const jobs = await crawlAllCompanies({
      onProgress: (done, total) => {
        if (done % 30 === 0 || done === total) {
          console.log(`[worker]   ${done}/${total} entreprises analysées`);
        }
      },
    });
    await setCacheJobs(jobs);
    console.log(
      `[worker] refresh terminé : ${jobs.length} offres en ${((Date.now() - started) / 1000).toFixed(0)}s`
    );
  } catch (err) {
    console.error("[worker] erreur refresh :", err.message);
  } finally {
    running = false;
    setRefreshing(false);
  }
}

/**
 * Démarre la planification :
 *  - refresh immédiat si le cache est périmé/vide (en tâche de fond, non bloquant)
 *  - puis refresh à intervalle régulier
 */
export function startWorker() {
  if (isStale()) {
    // Non bloquant : on ne "await" pas.
    refreshCompanyCache("démarrage (cache périmé)");
  } else {
    console.log(`[worker] cache encore frais (${getCacheStatus().count} offres), pas de refresh au démarrage.`);
  }

  const intervalMs = config.cache.refreshMinutes * 60 * 1000;
  setInterval(() => refreshCompanyCache("planifié"), intervalMs);
  console.log(`[worker] refresh planifié toutes les ${config.cache.refreshMinutes} min.`);
}
