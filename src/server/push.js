import crypto from "node:crypto";
import webpush from "web-push";
import { config } from "./config.js";

/**
 * Sujet VAPID (contact transmis aux services push) à partir de VAPID_CONTACT_EMAIL :
 * accepte « nom@domaine », « mailto:nom@domaine », « mailto: <nom@domaine> » (format de
 * certains générateurs de clés) ou une URL https.
 */
export function vapidSubject(contact) {
  const value = String(contact || "").trim();
  if (/^https:\/\//i.test(value)) return value;
  const email = value.replace(/^mailto:/i, "").trim().replace(/^<(.*)>$/, "$1").trim();
  return `mailto:${email || "contact@sophia-jobs.local"}`;
}

let status = null;

/** Configure web-push une seule fois ; des clés invalides désactivent le push (sans exception). */
function setup() {
  if (status) return status;
  const { publicKey, privateKey, contact } = config.vapid;
  if (!publicKey || !privateKey) return (status = { enabled: false, error: null });
  try {
    webpush.setVapidDetails(vapidSubject(contact), publicKey, privateKey);
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (ecdh.getPublicKey().toString("base64url") !== publicKey) {
      throw new Error("la clé publique ne correspond pas à la clé privée");
    }
    status = { enabled: true, error: null };
  } catch (err) {
    status = { enabled: false, error: err.message };
    console.error(`[push] clés VAPID invalides, notifications désactivées : ${err.message}`);
  }
  return status;
}

/** { enabled, error } : error explique pourquoi des clés fournies ont été refusées. */
export function getPushStatus() {
  return { ...setup() };
}

export function isPushEnabled() {
  return setup().enabled;
}

export function getPublicKey() {
  return isPushEnabled() ? config.vapid.publicKey : "";
}

// Un envoi ne doit jamais bloquer la vérification des alertes : sans délai, un service
// push (ou un faux abonnement pointant vers un serveur muet) la suspendait indéfiniment.
const PUSH_TIMEOUT_MS = 10000;
// Notification non délivrée (appareil éteint) abandonnée au bout de 24 h.
const PUSH_TTL_SECONDS = 24 * 3600;

// Services push des navigateurs : FCM (Chrome, Opera, Samsung…), Mozilla (Firefox),
// WNS (Edge sous Windows), Apple (Safari). Le serveur n'envoie de requêtes qu'à ces
// hôtes, jamais à une adresse arbitraire (réseau interne, serveur piège).
const PUSH_HOSTS = [
  /(^|\.)googleapis\.com$/,
  /(^|\.)mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

/**
 * Valide un abonnement reçu d'un navigateur et n'en garde que les champs utiles.
 * Retourne null s'il est invalide.
 */
export function sanitizePushSubscription(subscription) {
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (typeof endpoint !== "string" || endpoint.length > 2048) return null;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!p256dh || p256dh.length > 200 || !auth || auth.length > 100) return null;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  return { endpoint, expirationTime: null, keys: { p256dh, auth } };
}

/**
 * Envoie une notification push. Retourne false (sans lever d'exception) si
 * l'abonnement n'est plus valide (410/404) : l'appelant doit alors le retirer.
 */
export async function sendPushNotification(subscription, payload) {
  if (!isPushEnabled()) return { ok: false, gone: false };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      timeout: PUSH_TIMEOUT_MS,
      TTL: PUSH_TTL_SECONDS,
    });
    return { ok: true, gone: false };
  } catch (err) {
    const gone = err.statusCode === 404 || err.statusCode === 410;
    if (!gone) console.error("[push] échec envoi :", err.message);
    return { ok: false, gone };
  }
}
