// sw.js v2.1.21
const VERSION = '2.1.21';
const CACHE_NAME = 'panopticon-v2.1.21';
const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-192-Android.png',
  'icon-512.png',
  'icon-512-Android.png',
  'icon-1920.png',
  'css/style.css',
  'js/main.js',
  'js/sphere.js',
  'js/store.js',
  'js/github.js',
  'js/auth.js',
  'js/audio.js',
  'audio/ambience_1.mp3',
  'audio/ambience_2.mp3',
  'audio/pulse_effect.mp3',
  'audio/sound_click.wav',
  'audio/sound_select.wav',
  'audio/sound_window_open.wav',
  'audio/sound_app_open.wav',
  'audio/power_on.mp3',
  'audio/refresh.wav'
];

// Pre-cache static assets during install with network bypass
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Force reload to bypass and refresh any browser HTTP cache
      return Promise.all(
        ASSETS.map((asset) => {
          const request = new Request(asset, { cache: 'reload' });
          return fetch(request)
            .then((response) => {
              if (response.ok) {
                return cache.put(asset, response);
              }
              throw new Error(`Failed to fetch ${asset}`);
            })
            .catch((err) => {
              console.error(`Pre-caching failed for ${asset}:`, err);
            });
        })
      );
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Clean up old caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Network-First Strategy: Try the network, fall back to cache
self.addEventListener('fetch', (event) => {
  // Only handle GET requests for caching to prevent TypeError on POST/PUT requests
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If network succeeds, clone and update cache
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // If network fails, serve from cache
        return caches.match(event.request);
      })
  );
});
