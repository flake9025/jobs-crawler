import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { performSearch } from "./search.js";
import { sendAlertEmail } from "./mailer.js";
import { sendPushNotification, isPushEnabled } from "./push.js";

/**
 * Alertes "nouvelles offres" sur une recherche sauvegardée.
 * Persistées sur disque (comme le cache entreprises) pour survivre aux redémarrages.
 *
 * Structure d'une alerte :
 * {
 *   id, query, email (optionnel), pushSubscriptions: [webpush subscription, ...],
 *   seenUrls: [url, ...] (offres déjà notifiées, plafonné),
 *   createdAt, lastCheckedAt, lastNotifiedAt
 * }
 */

const MAX_SEEN_URLS = 500;

let alerts = [];
let loaded = false;

async function persist() {
  try {
    await fs.mkdir(path.dirname(config.alertsFile), { recursive: true });
    await fs.writeFile(config.alertsFile, JSON.stringify(alerts, null, 0), "utf-8");
  } catch (err) {
    console.error("[alerts] échec persistance :", err.message);
  }
}

export async function loadAlerts() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(config.alertsFile, "utf-8");
    alerts = JSON.parse(raw);
    console.log(`[alerts] ${alerts.length} alerte(s) chargée(s).`);
  } catch {
    alerts = [];
  }
}

export function listAlerts() {
  // Ne jamais exposer les abonnements push bruts au client.
  return alerts.map(({ id, query, email, createdAt, lastNotifiedAt, pushSubscriptions }) => ({
    id,
    query,
    email: email || null,
    hasPush: (pushSubscriptions || []).length > 0,
    createdAt,
    lastNotifiedAt: lastNotifiedAt || null,
  }));
}

export async function createAlert({ query, email }) {
  const alert = {
    id: crypto.randomUUID(),
    query: (query || "").trim(),
    email: (email || "").trim() || null,
    pushSubscriptions: [],
    // Une alerte part du principe que les offres déjà présentes ne sont pas "nouvelles" :
    // on marque tout ce qui existe déjà comme vu, pour ne notifier que les vraies nouveautés.
    seenUrls: [],
    createdAt: new Date().toISOString(),
    lastCheckedAt: null,
    lastNotifiedAt: null,
  };
  alerts.push(alert);

  // Amorce seenUrls avec les résultats actuels : sinon le premier check enverrait
  // un email/push massif avec toutes les offres existantes.
  try {
    const { jobs } = await performSearch(alert.query);
    alert.seenUrls = jobs.map((j) => j.url).slice(0, MAX_SEEN_URLS);
  } catch {
    /* ignore, la première vérification planifiée rattrapera */
  }

  await persist();
  return alert;
}

export async function deleteAlert(id) {
  const before = alerts.length;
  alerts = alerts.filter((a) => a.id !== id);
  if (alerts.length !== before) await persist();
  return alerts.length !== before;
}

export async function addPushSubscription(id, subscription) {
  const alert = alerts.find((a) => a.id === id);
  if (!alert) return false;
  const endpoint = subscription?.endpoint;
  if (!endpoint) return false;
  if (!alert.pushSubscriptions.some((s) => s.endpoint === endpoint)) {
    alert.pushSubscriptions.push(subscription);
    await persist();
  }
  return true;
}

/**
 * Parcourt toutes les alertes, relance la recherche associée, et notifie
 * (email + push) les nouvelles offres détectées depuis la dernière vérification.
 * Appelé périodiquement par le worker après chaque refresh du cache entreprises.
 */
export async function checkAlerts() {
  if (!alerts.length) return;

  for (const alert of alerts) {
    try {
      const { jobs } = await performSearch(alert.query);
      const seen = new Set(alert.seenUrls);
      const newJobs = jobs.filter((j) => j.url && !seen.has(j.url));

      alert.lastCheckedAt = new Date().toISOString();

      if (newJobs.length) {
        console.log(`[alerts] ${newJobs.length} nouvelle(s) offre(s) pour « ${alert.query} »`);

        if (alert.email) {
          await sendAlertEmail({ to: alert.email, query: alert.query, jobs: newJobs });
        }

        if (isPushEnabled() && alert.pushSubscriptions.length) {
          const payload = {
            title: `${newJobs.length} nouvelle(s) offre(s) — ${alert.query}`,
            body: newJobs
              .slice(0, 3)
              .map((j) => `${j.title}${j.company ? " · " + j.company : ""}`)
              .join("\n"),
            url: `/?q=${encodeURIComponent(alert.query)}`,
          };
          const stillValid = [];
          for (const sub of alert.pushSubscriptions) {
            const res = await sendPushNotification(sub, payload);
            if (!res.gone) stillValid.push(sub);
          }
          alert.pushSubscriptions = stillValid;
        }

        alert.lastNotifiedAt = new Date().toISOString();
        alert.seenUrls = [...seen, ...newJobs.map((j) => j.url)].slice(-MAX_SEEN_URLS);
      }
    } catch (err) {
      console.error(`[alerts] échec vérification « ${alert.query} » :`, err.message);
    }
  }

  await persist();
}
