// Bassani Health · Service Worker
// Strategy:
//   - Navigation requests (HTML)  → network-first so deploys are always picked up immediately
//   - Hashed JS/CSS/image assets  → cache-first (filenames change on every build, safe to cache)
//   - API / WebSocket calls       → bypass cache entirely

// Bump this whenever the cache structure changes to evict all old caches on activate.
const CACHE_NAME = 'bassani-v4';

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  // Pre-cache only icons and manifest — never index.html (stale HTML causes
  // the exact deploy-visibility bug this rewrite is fixing).
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        '/manifest.json',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ])
    )
  );
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API / WebSocket — always network, never cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
    return;
  }

  // Navigation (page loads) — network-first so a new deploy is seen immediately.
  // Only fall back to cache when truly offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Hashed static assets (JS/CSS bundles, images) — cache-first.
  // CRA content-hashes all bundle filenames, so a new deploy produces new
  // filenames; stale cached files are never served for new code.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'Bassani Health', body: 'New notification' };
  try { data = event.data.json(); } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      data:    { url: data.url || '/' },
      actions: [
        { action: 'open',    title: 'Open App' },
        { action: 'dismiss', title: 'Dismiss'  },
      ],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
