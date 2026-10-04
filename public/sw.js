/* WatchTogether static shell cache. Room/session data always stays network-only. */
const CACHE_PREFIX = "watchtogether-static-";
const CACHE_NAME = `${CACHE_PREFIX}2`;
const OFFLINE_SHELL = "/offline.html";
const PRECACHE = [
  OFFLINE_SHELL,
  "/manifest.webmanifest",
  "/icons/watchtogether.svg",
  "/icons/watchtogether-192.png",
  "/icons/watchtogether-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

function isSafeStaticAsset(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || url.hash) return false;
  const path = url.pathname;
  return path.startsWith("/_next/static/") ||
    path.startsWith("/icons/") ||
    path.startsWith("/fonts/") ||
    path.startsWith("/assets/") ||
    path === "/manifest.webmanifest" ||
    path === "/favicon.ico";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(OFFLINE_SHELL)) || new Response("Нет соединения с сервером", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }));
    return;
  }

  if (!isSafeStaticAsset(request, url)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  }));
});
