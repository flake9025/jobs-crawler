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
import {
  loadAlerts,
  getAlert,
  createAlert,
  deleteAlert,
  acknowledgeAlert,
  addPushSubscription,
} from "./alerts.js";
import { isPushEnabled, getPublicKey, getPushStatus, sanitizePushSubscription } from "./push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const publicDir = path.join(__dirname, "..", "..", "public");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(publicDir));

const isCrawled = (c) => Boolean((c.site || c.careerSite) && c.crawl !== false);
const statusFallback = (c) => (c.crawl === false ? "link-only" : c.site || c.careerSite ? "pending" : "no-site");

app.get("/api/version", (_req, res) => {
  res.json({
    version: config.version,
    build: config.buildSha,
    builtAt: config.buildDate,
  });
});

// --- API : capacités du serveur (canaux d'alerte disponibles) ---
app.get("/api/config", (_req, res) => {
  res.json({
    version: config.version,
    emailEnabled: config.smtp.enabled,
    pushEnabled: isPushEnabled(),
    vapidPublicKey: getPublicKey() || null,
    alertsCheckMinutes: config.alertsCheckMinutes,
  });
});

// --- API : recherche d'emploi (mots-clés et/ou entreprise) ---
app.get("/api/search", async (req, res) => {
  const query = (req.query.q || "").toString().trim().slice(0, 200);
  const company = (req.query.company || "").toString().trim().slice(0, 150);
  if (!query && !company) {
    return res.status(400).json({ error: "Paramètre 'q' (intitulé de poste) ou 'company' requis." });
  }

  const result = await performSearch(query, { company });
  res.json(result);
});

// --- API : entreprises vedettes (grands employeurs, startups, ESN…) pour l'onglet "Entreprises" ---
app.get("/api/featured-companies", (_req, res) => {
  const counts = new Map();
  for (const j of getCacheJobs()) counts.set(j.company, (counts.get(j.company) || 0) + 1);
  const statsByName = new Map(getCompanyStats().map((s) => [s.name, s]));

  res.json({
    categories: FEATURED_CATEGORIES.map((cat) => ({
      id: cat.id,
      label: cat.label,
      description: cat.description,
      companies: cat.companies.map((c) => {
        const stat = statsByName.get(c.name);
        return {
          name: c.name,
          tagline: c.tagline || null,
          site: c.site || null,
          careerUrl: c.careerUrl || c.careerSite || c.site || null,
          applyUrl: c.applyUrl || null,
          city: c.city || null,
          crawled: isCrawled(c),
          status: stat?.status || statusFallback(c),
          jobs: counts.get(c.name) || 0,
          truncated: Boolean(stat?.truncated),
          checkedAt: stat?.checkedAt || null,
        };
      }),
    })),
  });
});

// --- API : alertes "nouvelles offres" (recherche sauvegardée + notifications) ---
// Pas de route de listing : l'identifiant (aléatoire) d'une alerte sert de clé d'accès.
app.post("/api/alerts", async (req, res) => {
  const query = (req.body?.query || "").toString().trim().slice(0, 200);
  const company = (req.body?.company || "").toString().trim().slice(0, 150);
  const email = (req.body?.email || "").toString().trim().slice(0, 254);
  if (!query && !company) return res.status(400).json({ error: "Le champ 'query' ou 'company' est requis." });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Adresse email invalide." });
  }
  try {
    res.json(await createAlert({ query, company, email }));
  } catch (err) {
    res.status(429).json({ error: err.message });
  }
});

app.get("/api/alerts/:id", (req, res) => {
  const alert = getAlert(req.params.id);
  if (!alert) return res.status(404).json({ error: "Alerte introuvable." });
  res.json(alert);
});

app.post("/api/alerts/:id/ack", async (req, res) => {
  const ok = await acknowledgeAlert(req.params.id);
  if (!ok) return res.status(404).json({ error: "Alerte introuvable." });
  res.json({ acknowledged: true });
});

app.delete("/api/alerts/:id", async (req, res) => {
  const ok = await deleteAlert(req.params.id);
  if (!ok) return res.status(404).json({ error: "Alerte introuvable." });
  res.json({ deleted: true });
});

app.post("/api/alerts/:id/subscribe", async (req, res) => {
  const subscription = sanitizePushSubscription(req.body?.subscription);
  if (!subscription) return res.status(400).json({ error: "Abonnement push invalide." });
  const ok = await addPushSubscription(req.params.id, subscription);
  if (!ok) return res.status(404).json({ error: "Alerte introuvable." });
  res.json({ subscribed: true });
});

// Désinscription depuis l'email : GET affiche une confirmation (les antivirus et
// messageries qui pré-chargent les liens ne doivent pas supprimer l'alerte), POST supprime.
const htmlPage = (title, body) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Sophia Jobs</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f5f7fb;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border-radius:18px;box-shadow:0 10px 30px rgba(15,23,42,.08);padding:32px;max-width:440px;text-align:center}
h1{font-size:1.3rem}button,a.btn{display:inline-block;border:0;border-radius:999px;padding:11px 20px;font:inherit;font-weight:600;cursor:pointer;background:#2563eb;color:#fff;text-decoration:none}
p{color:#475569;line-height:1.5}</style></head><body><main>${body}</main></body></html>`;

app.get("/api/alerts/:id/unsubscribe", (req, res) => {
  const alert = getAlert(req.params.id);
  if (!alert) {
    return res.send(htmlPage("Alerte introuvable", `<h1>Alerte introuvable</h1><p>Cette alerte a déjà été supprimée.</p><a class="btn" href="/">Ouvrir Sophia Jobs</a>`));
  }
  res.send(
    htmlPage(
      "Se désabonner",
      `<h1>Se désabonner de cette alerte ?</h1><p>Vous ne recevrez plus d'email ni de notification pour cette recherche.</p>
       <form method="post"><button type="submit">Confirmer la désinscription</button></form>`
    )
  );
});

app.post("/api/alerts/:id/unsubscribe", async (req, res) => {
  await deleteAlert(req.params.id);
  res.send(htmlPage("Désabonné", `<h1>C'est fait</h1><p>L'alerte a été supprimée.</p><a class="btn" href="/">Ouvrir Sophia Jobs</a>`));
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
      featured: c.featured || null,
      status: stat?.status || statusFallback(c),
      jobs: stat?.jobs || 0,
      truncated: Boolean(stat?.truncated),
      careerUrl: c.careerUrl || stat?.careerUrls?.[0] || c.careerSite || null,
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
    .map((s) => ({ name: s.name, jobs: s.jobs, site: s.site, truncated: Boolean(s.truncated) }));

  const withSite = SOPHIA_COMPANIES.filter((c) => c.site || c.careerSite).length;
  res.json({
    cache: getCacheStatus(),
    directory: {
      total: SOPHIA_COMPANIES.length,
      crawlable: CRAWLABLE_COMPANIES.length,
      withoutSite: SOPHIA_COMPANIES.length - withSite,
      linkOnly: withSite - CRAWLABLE_COMPANIES.length,
    },
    crawl: {
      byStatus,
      analysed: stats.filter((s) => s.status !== "no-site" && s.status !== "link-only").length,
    },
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

app.all("/api/*", (_req, res) => res.status(404).json({ error: "Route API inconnue." }));

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
    const push = getPushStatus();
    console.log(
      `  Alertes push       : ${
        push.enabled
          ? "activées (VAPID configuré, HTTPS requis côté navigateur)"
          : push.error
            ? `désactivées (clés VAPID invalides : ${push.error})`
            : "désactivées (VAPID absent, npm run vapid:generate)"
      }`
    );
    if (!config.publicUrl) console.log("  PUBLIC_URL         : non défini (emails sans lien vers l'application)");
    // Lance le worker de fond (cache entreprises).
    startWorker();
  });
}

start();
