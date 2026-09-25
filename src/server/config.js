import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT || "8080", 10),
  version: process.env.APP_VERSION || "1.0.0",
  buildSha: process.env.BUILD_SHA || "dev",
  buildDate: process.env.BUILD_DATE || null,
  franceTravail: {
    clientId: process.env.FRANCE_TRAVAIL_CLIENT_ID || "",
    clientSecret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET || "",
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },
  enableScrapers: (process.env.ENABLE_SCRAPERS || "true") === "true",
  maxPerSource: parseInt(process.env.MAX_PER_SOURCE || "25", 10),
  fetchTimeoutMs: parseInt(process.env.FETCH_TIMEOUT_MS || "12000", 10),
  // Cache des offres d'entreprises (job de fond)
  cache: {
    // chemin du fichier de persistance (monté en volume sur le NAS pour survivre aux redéploiements)
    file: process.env.CACHE_FILE || "/app/data/companies-cache.json",
    // intervalle de rafraîchissement en minutes
    refreshMinutes: parseInt(process.env.CACHE_REFRESH_MINUTES || "360", 10),
    // rafraîchir au démarrage si le cache est plus vieux que ça (minutes)
    staleMinutes: parseInt(process.env.CACHE_STALE_MINUTES || "360", 10),
    // nombre d'entreprises crawlées en parallèle (l'annuaire compte plusieurs milliers de sites)
    concurrency: parseInt(process.env.CRAWL_CONCURRENCY || "12", 10),
  },
  // Fichier de persistance des alertes (recherches sauvegardées + abonnements).
  alertsFile: process.env.ALERTS_FILE || "/app/data/alerts.json",
  // Intervalle entre deux vérifications des alertes (minutes)
  alertsCheckMinutes: parseInt(process.env.ALERTS_CHECK_MINUTES || "30", 10),
  // ---- Email (alertes) ----
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: (process.env.SMTP_SECURE || "false") === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "Sophia Jobs <no-reply@sophia-jobs.local>",
    get enabled() {
      return Boolean(this.host && this.user && this.pass);
    },
  },
  // ---- Notifications push navigateur (alertes) ----
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    contact: process.env.VAPID_CONTACT_EMAIL || "contact@sophia-jobs.local",
    get enabled() {
      return Boolean(this.publicKey && this.privateKey);
    },
  },
};
