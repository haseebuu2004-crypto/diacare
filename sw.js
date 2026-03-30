/* =============================================
   DiaCare Service Worker  (sw.js)
   Caches static assets for offline use.
   Strategy: Cache-first for assets, Network-first for Firebase.
   ============================================= */

const CACHE_NAME  = 'diacare-v3';
const FONT_CACHE  = 'diacare-fonts-v1';

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

// ── Install: pre-cache static shell ──────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
  // Activate immediately without waiting for old SW to be released
  self.skipWaiting();
});

// ── Activate: delete old caches ──────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== FONT_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: routing strategy ───────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Firebase / Google APIs → always network (never cache auth/db)
  if (
    url.hostname.includes('firebaseio.com')          ||
    url.hostname.includes('firebase.googleapis.com')  ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com')
  ) {
    return;
  }

  // 2. Google Fonts → cache-first with long TTL
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  // 3. Our own static assets (HTML, CSS, JS, manifest) → Network-First
  // This ensures the user gets the latest code, but works offline if network fails.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // If response ok, update cache and return
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            return response;
          }
          return response;
        })
        .catch(() => {
          // If fetch fails (offline), return from cache
          return caches.match(event.request);
        })
    );
    return;
  }

  // 4. CDNs / External SDKs → stale-while-revalidate
  if (
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'www.gstatic.com'
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        const networkFetch = fetch(event.request).then(response => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(() => null);
        return cached || networkFetch;
      })
    );
  }
});
