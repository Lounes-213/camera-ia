/* eslint-disable no-undef */
/**
 * WebAR Spatial Anchor — service worker.
 *
 * Strategy
 *  - App shell (HTML/JS/CSS/icons/fonts/marker): cache-first with a background
 *    revalidate, so the app opens instantly and works offline.
 *  - Models, MediaPipe runtime and wasm: runtime cache, cache-first — they are
 *    immutable and large, so re-downloading them would be wasteful.
 *  - Cross-origin requests (model CDNs, PeerJS signalling) are never cached.
 *
 * The camera itself obviously still needs a secure origin; offline mode only
 * guarantees the *shell* loads, tracking keeps working from the last target.
 */

const VERSION = 'v2';
const SHELL_CACHE = `webar-shell-${VERSION}`;
const RUNTIME_CACHE = `webar-runtime-${VERSION}`;

/** Files required for the app to boot offline. */
const SHELL_ASSETS = ['./', './index.html', './manifest.webmanifest', './marker.png', './icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually so one 404 cannot fail the whole install.
      await Promise.all(
        SHELL_ASSETS.map((asset) => cache.add(asset).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('webar-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache the signalling/API traffic or anything cross-origin.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  const isRuntimeAsset =
    /\.(glb|gltf|task|wasm)$/i.test(url.pathname) || url.pathname.includes('/mediapipe/');

  if (isRuntimeAsset) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Navigations fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', response.clone());
          return response;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match('./index.html')) ??
            (await cache.match('./')) ??
            new Response('Offline', { status: 503, statusText: 'Offline' })
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

/** Cache-first: serve from cache, otherwise fetch and store. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch (error) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/** Serve the cached copy immediately and refresh it in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? network;
}

/** Lets the page trigger an immediate update after a new deploy. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
