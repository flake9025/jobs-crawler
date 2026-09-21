import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { searchFranceTravail } from "./sources/franceTravail.js";
import { searchAggregators, searchLinks } from "./sources/aggregators.js";
import { searchCompanyCache, companySearchLinks } from "./sources/companies.js";
import { rankJobs } from "./ranking.js";
import { normalizeText } from "./util.js";
import { SOPHIA_COMPANIES, CRAWLABLE_COMPANIES } from "../data/companies.js";
import { loadCache, getCacheJobs, getCacheStatus, getCompanyStats } from "./cache.js";
import { startWorker, refreshCompanyCache } from "./worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const publicDir = path.join(__dirname, "..", "..", "public");
app.use(express.static(publicDir));

// --- API : recherche d'emploi (rapide) ---
app.get("/api/search", async (req, res) => {
  const query = (req.query.q || "").toString().trim();
  if (!query) {
    return res.status(400).json({ error: "Paramètre 'q' (intitulé de poste) requis." });
  }

  const started = Date.now();

  // Sources "live" rapides : API France Travail + agrégateurs.
  const [ft, agg] = await Promise.allSettled([
    searchFranceTravail(query),
    searchAggregators(query),
  ]);

  // Entreprises de Sophia : lecture INSTANTANÉE du cache (alimenté par le worker).
  const companyMatches = searchCompanyCache(getCacheJobs(), query);

  const raw = [
    ...(ft.status === "fulfilled" ? ft.value : []),
    ...(agg.status === "fulfilled" ? agg.value : []),
    ...companyMatches,
  ];

  const jobs = rankJobs(raw, query);

  // Panneau "entreprises" : seulement celles qui ont une offre correspondante en cache.
  const companiesWithMatches = new Set(
    companyMatches
      .map((j) => (j.source || "").replace(/^Entreprise:\s*/, ""))
      .filter(Boolean)
  );

  res.json({
    query,
    count: jobs.length,
    tookMs: Date.now() - started,
    franceTravailEnabled: config.franceTravail.enabled,
    scrapersEnabled: config.enableScrapers,
    cache: getCacheStatus(),
    jobs,
    searchLinks: searchLinks(query),
    companyLinks: companySearchLinks(query, companiesWithMatches),
  });
});

// --- API : entreprises suivies (catalogue paginé et filtrable) ---
app.get("/api/companies", (req, res) => {
  const search = normalizeText((req.query.search || "").toString());
  const status = (req.query.status || "").toString();
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize || "100", 10)));

  // Statut du dernier crawl, par entreprise.
  const statsByName = new Map(getCompanyStats().map((s) => [s.name, s]));

  let list = SOPHIA_COMPANIES.map((c) => {
    const stat = statsByName.get(c.name);
    return {
      name: c.name,
      site: c.site || null,
      sectors: c.sectors || [],
      sources: c.sources || [],
      status: stat?.status || (c.site ? "pending" : "no-site"),
      jobs: stat?.jobs || 0,
      careerUrl: stat?.careerUrls?.[0] || null,
      error: stat?.error || null,
      checkedAt: stat?.checkedAt || null,
    };
  });

  if (search) list = list.filter((c) => normalizeText(c.name).includes(search));
  if (status) list = list.filter((c) => c.status === status);

  // Les entreprises qui publient des offres remontent en tête du catalogue.
  list.sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name, "fr"));

  const start = (page - 1) * pageSize;
  res.json({
    total: list.length,
    page,
    pageSize,
    companies: list.slice(start, start + pageSize),
  });
});

// --- API : statut global (progression du crawl + couverture du catalogue) ---
app.get("/api/status", (_req, res) => {
  const stats = getCompanyStats();
  const byStatus = stats.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  const jobs = getCacheJobs();
  const topCompanies = [...stats]
    .filter((s) => s.jobs > 0)
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 20)
    .map((s) => ({ name: s.name, jobs: s.jobs, site: s.site }));

  res.json({
    cache: getCacheStatus(),
    directory: {
      total: SOPHIA_COMPANIES.length,
      crawlable: CRAWLABLE_COMPANIES.length,
      withoutSite: SOPHIA_COMPANIES.length - CRAWLABLE_COMPANIES.length,
    },
    crawl: { byStatus, analysed: stats.filter((s) => s.status !== "no-site").length },
    offers: {
      total: jobs.length,
      withContract: jobs.filter((j) => j.contractType).length,
      withExperience: jobs.filter((j) => j.experienceLevel).length,
      byLevel: jobs.reduce((acc, j) => {
        const k = j.experienceLevel || "inconnu";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    },
    topCompanies,
    sources: {
      franceTravail: config.franceTravail.enabled,
      scrapers: config.enableScrapers,
      aggregators: ["Welcome to the Jungle", "HelloWork", "APEC"],
    },
  });
});

// --- API : statut du cache entreprises ---
app.get("/api/cache", (_req, res) => res.json(getCacheStatus()));

// --- API : forcer un rafraîchissement du cache (non bloquant) ---
app.post("/api/cache/refresh", (_req, res) => {
  refreshCompanyCache("API");
  res.json({ started: true, status: getCacheStatus() });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// --- Démarrage ---
async function start() {
  await loadCache();
  app.listen(config.port, () => {
    console.log(`Sophia Jobs Crawler démarré sur http://localhost:${config.port}`);
    console.log(`  France Travail API : ${config.franceTravail.enabled ? "activée" : "désactivée (pas de clés)"}`);
    console.log(`  Scrapers           : ${config.enableScrapers ? "activés" : "désactivés"}`);
    console.log(`  Entreprises suivies : ${SOPHIA_COMPANIES.length} (dont ${CRAWLABLE_COMPANIES.length} crawlables)`);
    // Lance le worker de fond (cache entreprises).
    startWorker();
  });
}

start();
