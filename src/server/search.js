import { config } from "./config.js";
import { matchesCompanyName } from "./util.js";
import { searchFranceTravail } from "./sources/franceTravail.js";
import { searchAggregators, searchLinks } from "./sources/aggregators.js";
import { searchCompanyCache, companySearchLinks } from "./sources/companies.js";
import { rankJobs } from "./ranking.js";
import { getCacheJobs, getCacheStatus, getCompanyStats } from "./cache.js";
import { findCompany, companyNames, careerSitesOf } from "../data/companies.js";

/** Nom à soumettre aux job boards : « Ampère (Renault Group) » → « Ampère ». */
function boardSearchName(name) {
  return name.replace(/\s*\([^)]*\)\s*/g, " ").trim() || name;
}

/** Fiche publique d'une entreprise (bandeau « Offres chez … » de l'IHM). */
export function companyProfile(name) {
  const entry = findCompany(name);
  const displayName = entry?.name || name;
  const stat = getCompanyStats().find((s) => s.name === displayName);
  return {
    name: displayName,
    tagline: entry?.tagline || null,
    site: entry?.site || null,
    careerUrl: entry?.careerUrl || stat?.careerUrls?.[0] || careerSitesOf(entry)[0] || null,
    applyUrl: entry?.applyUrl || null,
    featured: entry?.featured || null,
    crawled: Boolean(entry && (entry.site || entry.careerSite) && entry.crawl !== false),
    status: stat?.status || null,
    jobs: stat?.jobs || 0,
    truncated: Boolean(stat?.truncated),
    checkedAt: stat?.checkedAt || null,
  };
}

/**
 * Recherche agrégée complète (France Travail + agrégateurs + cache entreprises),
 * factorisée pour être appelée à la fois par la route `/api/search` et par le
 * vérificateur d'alertes en tâche de fond (mêmes règles de pertinence).
 *
 * Mode entreprise (`company`) : offres de cet employeur uniquement (alias compris),
 * issues de son site carrières (cache) et des job boards, éventuellement filtrées
 * par les mots de `query`.
 */
export async function performSearch(query = "", { company = "" } = {}) {
  const started = Date.now();
  const profile = company ? companyProfile(company) : null;
  const liveQuery = profile ? [query, boardSearchName(profile.name)].filter(Boolean).join(" ") : query;

  const [ft, agg] = await Promise.allSettled([
    searchFranceTravail(liveQuery),
    searchAggregators(liveQuery),
  ]);
  const live = [
    ...(ft.status === "fulfilled" ? ft.value : []),
    ...(agg.status === "fulfilled" ? agg.value : []),
  ];

  let raw;
  let companyMatches = [];
  if (profile) {
    const names = companyNames(profile.name);
    const ofCompany = (j) => j.company === profile.name || matchesCompanyName(j.company, names);
    const pool = [...getCacheJobs().filter(ofCompany), ...live.filter(ofCompany)];
    raw = query ? searchCompanyCache(pool, query) : pool;
  } else {
    companyMatches = searchCompanyCache(getCacheJobs(), query);
    raw = [...live, ...companyMatches];
  }

  // En mode entreprise, le filtre est déjà fait : aucun seuil de pertinence.
  const jobs = rankJobs(raw, query, { minScore: profile ? 0 : 15 });

  const companiesWithMatches = new Set(
    companyMatches
      .map((j) => (j.source || "").replace(/^Entreprise:\s*/, ""))
      .filter(Boolean)
  );

  return {
    query,
    company: profile,
    count: jobs.length,
    tookMs: Date.now() - started,
    franceTravailEnabled: config.franceTravail.enabled,
    scrapersEnabled: config.enableScrapers,
    cache: getCacheStatus(),
    jobs,
    searchLinks: searchLinks(liveQuery),
    companyLinks: profile ? [] : companySearchLinks(query, companiesWithMatches),
  };
}
