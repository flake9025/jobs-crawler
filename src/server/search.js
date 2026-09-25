import { config } from "./config.js";
import { searchFranceTravail } from "./sources/franceTravail.js";
import { searchAggregators, searchLinks } from "./sources/aggregators.js";
import { searchCompanyCache, companySearchLinks } from "./sources/companies.js";
import { rankJobs } from "./ranking.js";
import { getCacheJobs, getCacheStatus } from "./cache.js";

/**
 * Recherche agrégée complète (France Travail + agrégateurs + cache entreprises),
 * factorisée pour être appelée à la fois par la route `/api/search` et par le
 * vérificateur d'alertes en tâche de fond (mêmes règles de pertinence).
 */
export async function performSearch(query) {
  const started = Date.now();

  const [ft, agg] = await Promise.allSettled([
    searchFranceTravail(query),
    searchAggregators(query),
  ]);

  const companyMatches = searchCompanyCache(getCacheJobs(), query);

  const raw = [
    ...(ft.status === "fulfilled" ? ft.value : []),
    ...(agg.status === "fulfilled" ? agg.value : []),
    ...companyMatches,
  ];

  const jobs = rankJobs(raw, query);

  const companiesWithMatches = new Set(
    companyMatches
      .map((j) => (j.source || "").replace(/^Entreprise:\s*/, ""))
      .filter(Boolean)
  );

  return {
    query,
    count: jobs.length,
    tookMs: Date.now() - started,
    franceTravailEnabled: config.franceTravail.enabled,
    scrapersEnabled: config.enableScrapers,
    cache: getCacheStatus(),
    jobs,
    searchLinks: searchLinks(query),
    companyLinks: companySearchLinks(query, companiesWithMatches),
  };
}
