// Service worker minimal : cache "app shell" pour usage offline de l'interface.
// Les résultats de recherche (API) ne sont pas mis en cache car dynamiques.
const CACHE = "sophia-jobs-v4";
const SHELL = [
  "/",
  "/index.html",
  "/status.html",
  "/styles.css",
  "/app.js",
  "/status.js",
  "/vendor/xlsx.full.min.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Ne jamais mettre en cache les appels API.
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ error: "Hors ligne" }), { headers: { "Content-Type": "application/json" }, status: 503 })));
    return;
  }
  // App shell : cache-first.
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

// --- Notifications push (alertes "nouvelles offres") ---
self.addEventListener("push", (e) => {
  let data = { title: "Sophia Jobs", body: "Nouvelle(s) offre(s) détectée(s).", url: "/" };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch {
    /* charge utile non-JSON : on garde le message par défaut */
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
