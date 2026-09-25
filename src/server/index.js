import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { performSearch } from "./search.js";
import { normalizeText } from "./util.js";
import { SOPHIA_COMPANIES, CRAWLABLE_COMPANIES } from "../data/companies.js";
import { FEATURED_CATEGORIES } from "../data/featured-companies.js";
import { loadCache, getCacheJobs, getCacheStatus, getCompanyStats } from "./cache.js";
import { startWorker, refreshCompanyCache } from "./worker.js";
import { loadAlerts, listAlerts, createAlert, deleteAlert, addPushSubscription } from "./alerts.js";
import { isPushEnabled, getPublicKey } from "./push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const publicDir = path.join(__dirname, "..", "..", "public");
app.use(express.json());
app.use(express.static(publicDir));

app.get("/api/version", (_req, res) => {
  res.json({
    version: config.version,
    build: config.buildSha,
    builtAt: config.buildDate,
  });
});

// --- API : recherche d'emploi (rapide) ---
app.get("/api/search", async (req, res) => {
  const query = (req.query.q || "").toString().trim();
  if (!query) {
    return res.status(400).json({ error: "Paramètre 'q' (intitulé de poste) requis." });
  }

  const result = await performSearch(query);
  res.json(result);
});

// --- API : entreprises vedettes (Top 15, startups, ESN…) pour l'onglet "Entreprises" ---
app.get("/api/featured-companies", (_req, res) => {
  const jobs = getCacheJobs();
  const countFor = (name) => {
    const n = normalizeText(name);
    return jobs.filter((j) => normalizeText(j.company) === n).length;
  };

  res.json({
    categories: FEATURED_CATEGORIES.map((cat) => ({
      id: cat.id,
      label: cat.label,
      description: cat.description,
      companies: cat.companies.map((c) => ({ ...c, cachedJobs: countFor(c.name) })),
    })),
  });
});

// --- API : offres en cache pour une entreprise donnée (bouton "Voir les offres") ---
app.get("/api/company-jobs", (req, res) => {
  const name = normalizeText((req.query.name || "").toString());
  if (!name) return res.status(400).json({ error: "Paramètre 'name' requis." });
  const jobs = getCacheJobs().filter((j) => normalizeText(j.company) === name);
  res.json({ jobs });
});

// --- API : alertes "nouvelles offres" (recherche sauvegardée + notifications) ---
app.get("/api/alerts", (_req, res) => {
  res.json({
    alerts: listAlerts(),
    pushEnabled: isPushEnabled(),
    emailEnabled: config.smtp.enabled,
    vapidPublicKey: getPublicKey(),
  });
});

app.post("/api/alerts", async (req, res) => {
  const query = (req.body?.query || "").toString().trim();
  const email = (req.body?.email || "").toString().trim();
  if (!query) return res.status(400).json({ error: "Le champ 'query' est requis." });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Adresse email invalide." });
  }
  const alert = await createAlert({ query, email });
  res.json({ id: alert.id });
});

app.delete("/api/alerts/:id", async (req, res) => {
  const ok = await deleteAlert(req.params.id);
  if (!ok) return res.status(404).json({ error: "Alerte introuvable." });
  res.json({ deleted: true });
});

app.post("/api/alerts/:id/subscribe", async (req, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint) return res.status(400).json({ error: "Abonnement push invalide." });
  const ok = await addPushSubscription(req.params.id, subscription);
  if (!ok) return res.status(404).json({ error: "Alerte introuvable." });
  res.json({ subscribed: true });
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

// --- Garde-fous ---
// Le crawl touche des milliers de sites tiers : une erreur asynchrone isolée ne
// doit jamais faire tomber le conteneur (et perdre le crawl en cours).
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] promesse rejetée non gérée :", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] exception non interceptée :", err?.message || err);
});

// --- Démarrage ---
async function start() {
  await loadCache();
  await loadAlerts();
  app.listen(config.port, () => {
    console.log(`Sophia Jobs Crawler démarré sur http://localhost:${config.port}`);
    console.log(`  France Travail API : ${config.franceTravail.enabled ? "activée" : "désactivée (pas de clés)"}`);
    console.log(`  Scrapers           : ${config.enableScrapers ? "activés" : "désactivés"}`);
    console.log(`  Entreprises suivies : ${SOPHIA_COMPANIES.length} (dont ${CRAWLABLE_COMPANIES.length} crawlables)`);
    console.log(`  Alertes email      : ${config.smtp.enabled ? "activées (SMTP configuré)" : "désactivées (SMTP absent)"}`);
    console.log(`  Alertes push       : ${isPushEnabled() ? "activées (VAPID configuré)" : "désactivées (VAPID absent, npm run vapid:generate)"}`);
    // Lance le worker de fond (cache entreprises).
    startWorker();
  });
}

start();
