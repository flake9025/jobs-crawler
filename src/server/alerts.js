import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { performSearch } from "./search.js";
import { sendAlertEmail } from "./mailer.js";
import { sendPushNotification, isPushEnabled, sanitizePushSubscription } from "./push.js";

/**
 * Alertes "nouvelles offres" sur une recherche sauvegardée (mots-clés et/ou entreprise).
 * Persistées sur disque (comme le cache entreprises) pour survivre aux redémarrages.
 *
 * Il n'y a pas de comptes : l'identifiant aléatoire d'une alerte sert de clé d'accès.
 * Le navigateur qui l'a créée le conserve (localStorage) ; aucune route ne liste les
 * alertes, pour ne jamais exposer les adresses email des autres utilisateurs.
 *
 * Structure d'une alerte :
 * {
 *   id, query, company (optionnel), email (optionnel),
 *   pushSubscriptions: [webpush subscription, ...],
 *   seenUrls: [url, ...]   offres déjà connues (plafonné),
 *   pending: [offre, ...]  nouvelles offres pas encore consultées dans l'application,
 *   createdAt, lastCheckedAt, lastNotifiedAt
 * }
 */

const MAX_SEEN_URLS = 500;
const MAX_PENDING = 50;
const MAX_ALERTS = 1000;
// Appareils abonnés par alerte (les plus anciens cèdent la place) : les envois sont
// séquentiels, une liste sans borne pouvait allonger indéfiniment chaque vérification.
const MAX_PUSH_SUBSCRIPTIONS = 10;
// Au-delà, une vérification est considérée comme bloquée et n'empêche plus les suivantes.
const MAX_CHECK_MS = 30 * 60 * 1000;

let alerts = [];
let loaded = false;
let currentCheck = null;

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
    alerts = JSON.parse(raw).map((a) => ({
      company: null,
      email: null,
      seenUrls: [],
      pending: [],
      ...a,
      // Abonnements enregistrés avant la validation stricte : on ne garde que les valides.
      pushSubscriptions: (a.pushSubscriptions || [])
        .map(sanitizePushSubscription)
        .filter(Boolean)
        .slice(-MAX_PUSH_SUBSCRIPTIONS),
    }));
    console.log(`[alerts] ${alerts.length} alerte(s) chargée(s).`);
  } catch {
    alerts = [];
  }
}

/** « jean.dupont@gmail.com » → « je•••@gmail.com » : l'id seul ne doit pas révéler l'adresse. */
function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}•••@${domain}`;
}

/** Vue publique d'une alerte (jamais les abonnements push bruts ni l'email complet). */
function publicView(alert) {
  return {
    id: alert.id,
    query: alert.query,
    company: alert.company || null,
    email: maskEmail(alert.email),
    hasPush: alert.pushSubscriptions.length > 0,
    createdAt: alert.createdAt,
    lastCheckedAt: alert.lastCheckedAt || null,
    lastNotifiedAt: alert.lastNotifiedAt || null,
    pending: alert.pending,
  };
}

const findAlert = (id) => alerts.find((a) => a.id === id) || null;

export function getAlert(id) {
  const alert = findAlert(id);
  return alert ? publicView(alert) : null;
}

export function countAlerts() {
  return alerts.length;
}

export async function createAlert({ query, company, email }) {
  if (alerts.length >= MAX_ALERTS) throw new Error("Nombre maximal d'alertes atteint sur ce serveur.");
  const alert = {
    id: crypto.randomUUID(),
    query: (query || "").trim(),
    company: (company || "").trim() || null,
    email: (email || "").trim() || null,
    pushSubscriptions: [],
    seenUrls: [],
    pending: [],
    createdAt: new Date().toISOString(),
    lastCheckedAt: null,
    lastNotifiedAt: null,
  };

  // Les offres déjà présentes ne sont pas "nouvelles" : sans cet amorçage, la première
  // vérification enverrait un email/push massif avec toutes les offres existantes.
  try {
    const { jobs } = await performSearch(alert.query, { company: alert.company });
    alert.seenUrls = jobs.map((j) => j.url).slice(0, MAX_SEEN_URLS);
  } catch {
    /* ignore, la première vérification planifiée rattrapera */
  }

  alerts.push(alert);
  await persist();
  return publicView(alert);
}

export async function deleteAlert(id) {
  const before = alerts.length;
  alerts = alerts.filter((a) => a.id !== id);
  if (alerts.length !== before) await persist();
  return alerts.length !== before;
}

/** Les nouvelles offres ont été consultées dans l'application. */
export async function acknowledgeAlert(id) {
  const alert = findAlert(id);
  if (!alert) return false;
  if (alert.pending.length) {
    alert.pending = [];
    await persist();
  }
  return true;
}

export async function addPushSubscription(id, subscription) {
  const alert = findAlert(id);
  if (!alert) return false;
  const endpoint = subscription?.endpoint;
  if (!endpoint) return false;
  if (!alert.pushSubscriptions.some((s) => s.endpoint === endpoint)) {
    alert.pushSubscriptions = [...alert.pushSubscriptions, subscription].slice(-MAX_PUSH_SUBSCRIPTIONS);
    await persist();
  }
  return true;
}

/** Lien de l'application ouvrant les résultats d'une alerte. */
export function alertAppPath(alert) {
  return `/?alert=${encodeURIComponent(alert.id)}`;
}

/** Libellé lisible d'une alerte : « java chez Amadeus », « Amadeus », « java ». */
export function alertLabel(alert) {
  if (alert.company && alert.query) return `« ${alert.query} » chez ${alert.company}`;
  if (alert.company) return alert.company;
  return `« ${alert.query} »`;
}

const pendingView = (j, foundAt) => ({
  title: j.title,
  company: j.company,
  location: j.location,
  url: j.url,
  source: j.source,
  date: j.date || null,
  foundAt,
});

/**
 * Parcourt toutes les alertes, relance la recherche associée, et notifie (application,
 * email, push) les nouvelles offres détectées depuis la dernière vérification.
 * Appelé périodiquement par le worker.
 */
export async function checkAlerts() {
  if (!alerts.length) return;
  if (currentCheck) {
    if (Date.now() - currentCheck.startedAt < MAX_CHECK_MS) return;
    console.warn("[alerts] vérification précédente bloquée depuis plus de 30 min : relance.");
  }
  const thisCheck = { startedAt: Date.now() };
  currentCheck = thisCheck;
  // Plusieurs alertes peuvent porter sur la même recherche : une seule requête par tour.
  const searches = new Map();
  const run = (alert) => {
    const key = `${alert.company || ""}\u0000${alert.query}`;
    if (!searches.has(key)) searches.set(key, performSearch(alert.query, { company: alert.company }));
    return searches.get(key);
  };

  try {
    for (const alert of [...alerts]) {
      try {
        const { jobs } = await run(alert);
        const seen = new Set(alert.seenUrls);
        const newJobs = jobs.filter((j) => j.url && !seen.has(j.url));
        const now = new Date().toISOString();
        alert.lastCheckedAt = now;
        if (!newJobs.length) continue;

        console.log(`[alerts] ${newJobs.length} nouvelle(s) offre(s) pour ${alertLabel(alert)}`);
        const known = new Set(alert.pending.map((p) => p.url));
        alert.pending = [
          ...newJobs.filter((j) => !known.has(j.url)).map((j) => pendingView(j, now)),
          ...alert.pending,
        ].slice(0, MAX_PENDING);

        if (alert.email) {
          await sendAlertEmail({ alert, label: alertLabel(alert), jobs: newJobs });
        }

        if (isPushEnabled() && alert.pushSubscriptions.length) {
          const payload = {
            title: `${newJobs.length} nouvelle(s) offre(s) — ${alertLabel(alert)}`,
            body: newJobs
              .slice(0, 3)
              .map((j) => `${j.title}${j.company ? " · " + j.company : ""}`)
              .join("\n"),
            url: alertAppPath(alert),
            tag: `alert-${alert.id}`,
          };
          const stillValid = [];
          for (const sub of alert.pushSubscriptions) {
            const res = await sendPushNotification(sub, payload);
            if (!res.gone) stillValid.push(sub);
          }
          alert.pushSubscriptions = stillValid;
        }

        alert.lastNotifiedAt = now;
        alert.seenUrls = [...seen, ...newJobs.map((j) => j.url)].slice(-MAX_SEEN_URLS);
      } catch (err) {
        console.error(`[alerts] échec vérification ${alertLabel(alert)} :`, err.message);
      }
    }
    await persist();
  } finally {
    // Une vérification bloquée qui finit par aboutir ne libère pas celle qui l'a relayée.
    if (currentCheck === thisCheck) currentCheck = null;
  }
}
