// Service worker minimal : cache "app shell" pour usage offline de l'interface.
// Les résultats de recherche (API) ne sont pas mis en cache car dynamiques.
const CACHE = "sophia-jobs-v3";
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
