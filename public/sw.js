// Service worker : interface utilisable hors ligne + notifications d'alertes.
//
// Stratégie « réseau d'abord » pour l'interface : une nouvelle version déployée est
// visible dès le chargement suivant, le cache ne sert qu'en cas de coupure réseau.
// Les appels API ne sont jamais mis en cache (résultats dynamiques).
const CACHE = "sophia-jobs-v5";
const SHELL = [
  "/",
  "/index.html",
  "/status.html",
  "/styles.css",
  "/app.js",
  "/ui.js",
  "/status.js",
  "/version.js",
  "/vendor/xlsx.full.min.js",
  "/manifest.webmanifest",
  "/icons/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const OFFLINE_API = JSON.stringify({ error: "Erreur technique : API injoignable (hors ligne)." });

self.addEventListener("install", (e) => {
  // Une ressource manquante ne doit pas bloquer la mise à jour du service worker.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((url) => c.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(request).catch(
        () => new Response(OFFLINE_API, { status: 503, headers: { "Content-Type": "application/json" } })
      )
    );
    return;
  }
  e.respondWith(networkFirst(request, url));
});

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    // Seules les ressources de l'interface sont conservées (clé sans paramètres).
    if (res.ok && SHELL.includes(url.pathname)) cache.put(url.pathname, res.clone());
    return res;
  } catch (err) {
    const cached =
      (await cache.match(url.pathname)) || (request.mode === "navigate" ? await cache.match("/index.html") : null);
    if (cached) return cached;
    throw err;
  }
}

// --- Notifications push (alertes « nouvelles offres ») ---
self.addEventListener("push", (e) => {
  let data = { title: "Sophia Jobs", body: "Nouvelles offres détectées.", url: "/" };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch {
    /* charge utile non JSON : message par défaut */
  }
  const options = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/" },
  };
  // Une alerte = une notification, remplacée (et signalée à nouveau) à chaque envoi.
  if (data.tag) Object.assign(options, { tag: data.tag, renotify: true });
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, options),
      self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(() => {}) : null,
    ])
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const sameOrigin = windows.filter((c) => new URL(c.url).origin === self.location.origin);
      // Application déjà ouverte : on la met au premier plan et elle affiche l'alerte.
      const app = sameOrigin.find((c) => ["/", "/index.html"].includes(new URL(c.url).pathname));
      if (app) {
        await app.focus();
        app.postMessage({ type: "navigate", url: target });
        return;
      }
      const other = sameOrigin[0];
      if (other) {
        await other.focus();
        try {
          await other.navigate(target);
        } catch {
          /* page non contrôlée par ce service worker */
        }
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
});
