const CACHE = 'lm-retours-v30';
const ASSETS = ['/', '/index.html', '/manifest.json'];

// Activation IMMÉDIATE sans attendre la fermeture des onglets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())   // prend le contrôle dès l'installation
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())  // contrôle tous les onglets ouverts
  );
});

// Stratégie Network-first : toujours tenter le réseau, cache en fallback
self.addEventListener('fetch', e => {
  if(e.request.url.includes('supabase.co') || e.request.url.includes('fonts.google')) return;
  if(e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if(response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', function(e) {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'La Martinière — Retours';
  const options = {
    body: data.body || 'Nouveau retour produit',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    data: data.data || { url: '/' },
    vibrate: [200, 100, 200]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs) {
    for(const c of cs){ if(c.url.includes(self.location.origin) && 'focus' in c) return c.focus(); }
    if(clients.openWindow) return clients.openWindow(url);
  }));
});

// Permettre l'activation forcée depuis le client
self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
