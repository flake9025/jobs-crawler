import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { searchFranceTravail } from "./sources/franceTravail.js";
import { searchAggregators, searchLinks } from "./sources/aggregators.js";
import { searchCompanyCache, companySearchLinks } from "./sources/companies.js";
import { rankJobs } from "./ranking.js";
import { SOPHIA_COMPANIES } from "../data/companies.js";
import { loadCache, getCacheJobs, getCacheStatus } from "./cache.js";
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

// --- API : entreprises suivies ---
app.get("/api/companies", (_req, res) => {
  res.json({ count: SOPHIA_COMPANIES.length, companies: SOPHIA_COMPANIES });
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
    console.log(`  Entreprises suivies : ${SOPHIA_COMPANIES.length}`);
    // Lance le worker de fond (cache entreprises).
    startWorker();
  });
}

start();
