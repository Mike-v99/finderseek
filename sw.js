// sw.js — FinderSeek Service Worker
// v4: scope caching to same-origin only; don’t intercept Supabase/Stripe/etc.
// v4: return real network errors on failure instead of `undefined`, which
//     causes respondWith to reject with “Load failed” in Safari.
const CACHE_NAME = ‘finderseek-v7’;
const PRECACHE = [
‘/’,
‘/index.html’,
‘/quest.html’,
‘/review.html’,
‘/how-it-works.html’,
‘/profile.html’,
‘/gold.html’,
‘/newquest.html’,
‘/privacy.html’,
‘/auth-callback.html’,
‘/manifest.json’,
‘/favicon.ico’,
‘/og-image.jpg’,
‘/icon-192.png’,
‘/icon-512.png’
];

// Install — cache core pages
self.addEventListener(‘install’, event => {
event.waitUntil(
caches.open(CACHE_NAME)
.then(cache => cache.addAll(PRECACHE))
.then(() => self.skipWaiting())
);
});

// Activate — clean old caches (v1, v2, v3 get wiped)
self.addEventListener(‘activate’, event => {
event.waitUntil(
caches.keys().then(keys => Promise.all(
keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
)).then(() => self.clients.claim())
);
});

// Fetch strategy:
//   - Cross-origin (Supabase, Stripe, Google Maps, CDNs) -> DO NOT intercept.
//     The browser handles them normally. Intercepting these is what caused
//     “Load failed” errors in the PWA: a cached bad response, or a
//     cache-miss returning undefined, would be served forever.
//   - Same-origin GET -> network-first with cache fallback.
//   - Everything else (POST, etc.) -> pass through untouched.
self.addEventListener(‘fetch’, event => {
const req = event.request;

// Only handle same-origin GET requests
const sameOrigin = new URL(req.url).origin === self.location.origin;
if (!sameOrigin || req.method !== ‘GET’) return;

// Skip our own /api/ endpoints — they’re dynamic, never cache
if (req.url.includes(’/api/’)) return;

event.respondWith(
fetch(req)
.then(response => {
// Only cache successful responses
if (response && response.ok) {
const clone = response.clone();
caches.open(CACHE_NAME)
.then(cache => cache.put(req, clone))
.catch(() => {}); // ignore cache write errors
}
return response;
})
.catch(async () => {
// Network failed — try cache. If cache also misses, return a
// proper Response (not undefined) so the page gets a real error
// instead of Safari’s mysterious “Load failed”.
const cached = await caches.match(req);
if (cached) return cached;
return new Response(‘Offline’, {
status: 503,
statusText: ‘Service Unavailable’,
headers: { ‘Content-Type’: ‘text/plain’ }
});
})
);
});