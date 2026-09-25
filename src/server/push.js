import webpush from "web-push";
import { config } from "./config.js";

let configured = false;

function ensureConfigured() {
  if (!config.vapid.enabled) return false;
  if (!configured) {
    webpush.setVapidDetails(
      `mailto:${config.vapid.contact}`,
      config.vapid.publicKey,
      config.vapid.privateKey
    );
    configured = true;
  }
  return true;
}

export function isPushEnabled() {
  return config.vapid.enabled;
}

export function getPublicKey() {
  return config.vapid.publicKey;
}

/**
 * Envoie une notification push. Retourne false (sans lever d'exception) si
 * l'abonnement n'est plus valide (410/404) : l'appelant doit alors le retirer.
 */
export async function sendPushNotification(subscription, payload) {
  if (!ensureConfigured()) return { ok: false, gone: false };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true, gone: false };
  } catch (err) {
    const gone = err.statusCode === 404 || err.statusCode === 410;
    if (!gone) console.error("[push] échec envoi :", err.message);
    return { ok: false, gone };
  }
}
