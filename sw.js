/* Service Worker – Pusteblume Laden
   Bei jeder neuen App-Version wird VERSION erhöht. Das Handy erkennt die
   neue Version, und die App zeigt «Neue Version verfügbar». */
const VERSION = "pb-2026-11-22-6";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./qrcode.js",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./logo-pusteblume.png",
  "./logo-so.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
];
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirst(req, fallbackUrl){
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(fallbackUrl || req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(fallbackUrl || req)) || (await cache.match("./index.html")) || Response.error();
  }
}
async function cacheFirst(req){
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Firebase-Programmbibliothek: einmal laden, dann aus dem Speicher (auch offline)
  if (req.url.startsWith(FIREBASE_SDK)) { event.respondWith(cacheFirst(req)); return; }

  // Alles andere von fremden Servern (Datenbank, Anmeldung, Schriften) nicht anfassen
  if (url.origin !== self.location.origin) {
    if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") event.respondWith(cacheFirst(req));
    return;
  }

  // Seite selbst und Zugangsdaten: zuerst aus dem Netz, offline aus dem Speicher
  if (req.mode === "navigate") { event.respondWith(networkFirst(req, "./index.html")); return; }
  if (url.pathname.endsWith("/firebase-config.js")) { event.respondWith(networkFirst(req)); return; }

  // Übrige App-Dateien: aus dem Speicher der aktuellen Version
  event.respondWith(cacheFirst(req));
});
