// sw.js — FinderSeek Service Worker
const CACHE_NAME = 'finderseek-v3';
const PRECACHE = [
  '/',
  '/index.html',
  '/quest.html',
  '/review.html',
  '/how-it-works.html',
  '/pricing.html',
  '/profile.html',
  '/gold.html',
  '/newquest.html',
  '/manifest.json',
  '/favicon.ico',
  '/og-image.jpg',
  '/icon-192.png',
  '/icon-512.png'
];

// Install — cache core pages
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Fetch — network first, fall back to cache
self.addEventListener('fetch', event => {
  // Skip non-GET and API requests
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
