import { config } from "./config.js";
import { crawlAllCompanies } from "./sources/companies.js";
import { CRAWLABLE_COMPANIES, SOPHIA_COMPANIES } from "../data/companies.js";
import { checkAlerts } from "./alerts.js";
import {
  setCacheJobs,
  saveCheckpoint,
  setRefreshing,
  setProgress,
  getCacheStatus,
  isStale,
} from "./cache.js";

/**
 * Worker de fond : rafraîchit périodiquement le cache des offres d'entreprises.
 * Le crawl de plusieurs milliers de sites prend du temps, mais il ne bloque JAMAIS
 * les recherches utilisateur (qui lisent le cache en mémoire).
 * La progression est publiée dans le cache et exposée par /api/status.
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
  const total = CRAWLABLE_COMPANIES.length;
  setProgress({
    done: 0,
    total,
    current: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    reason,
  });
  console.log(`[worker] début du refresh (${reason}) : ${total} entreprises à analyser…`);

  try {
    const { jobs, stats } = await crawlAllCompanies({
      concurrency: config.cache.concurrency,
      onCheckpoint: (partialJobs, partialStats) => saveCheckpoint(partialJobs, partialStats),
      onProgress: (done, count, current) => {
        setProgress({ done, total: count, current });
        if (done % 100 === 0 || done === count) {
          console.log(`[worker]   ${done}/${count} entreprises analysées`);
        }
      },
    });
    await setCacheJobs(jobs, stats);
    console.log(
      `[worker] refresh terminé : ${jobs.length} offres en ${((Date.now() - started) / 1000).toFixed(0)}s`
    );
    // Les nouvelles offres des sites carrières n'apparaissent qu'à la fin d'un crawl :
    // on prévient tout de suite les alertes concernées.
    checkAlerts().catch((err) => console.error("[alerts] échec vérification post-crawl :", err.message));
  } catch (err) {
    console.error("[worker] erreur refresh :", err.message);
  } finally {
    running = false;
    setRefreshing(false);
    setProgress({ finishedAt: new Date().toISOString(), current: [] });
  }
}

/**
 * Démarre la planification :
 *  - refresh immédiat si le cache est périmé/vide (en tâche de fond, non bloquant)
 *  - puis refresh à intervalle régulier
 */
export function startWorker() {
  console.log(
    `[worker] annuaire : ${SOPHIA_COMPANIES.length} entreprises, dont ${CRAWLABLE_COMPANIES.length} crawlables.`
  );

  if (isStale()) {
    // Non bloquant : on ne "await" pas.
    refreshCompanyCache("démarrage (cache périmé)");
  } else {
    console.log(`[worker] cache encore frais (${getCacheStatus().count} offres), pas de refresh au démarrage.`);
  }

  const intervalMs = config.cache.refreshMinutes * 60 * 1000;
  setInterval(() => refreshCompanyCache("planifié"), intervalMs);
  console.log(`[worker] refresh planifié toutes les ${config.cache.refreshMinutes} min.`);

  // Vérification des alertes : plus fréquente que le crawl complet, car elle ne
  // fait que relancer une recherche légère (France Travail + agrégateurs + cache).
  const alertsIntervalMs = config.alertsCheckMinutes * 60 * 1000;
  setInterval(() => {
    checkAlerts().catch((err) => console.error("[alerts] échec vérification planifiée :", err.message));
  }, alertsIntervalMs);
  console.log(`[worker] vérification des alertes toutes les ${config.alertsCheckMinutes} min.`);
}
