const CACHE = 'lm-retours-v31';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stratégie Network-first
self.addEventListener('fetch', e => {
  if(e.request.url.includes('supabase.co') || e.request.url.includes('fonts.google')) return;
  if(e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if(response && response.status === 200) {
          caches.open(CACHE).then(c => c.put(e.request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
self.addEventListener('push', function(e) {
  console.log('[SW] Push event reçu');

  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch(err) {
    console.error('[SW] Erreur parsing push data:', err);
  }

  const title   = data.title   || 'La Martinière — Retours';
  const body    = data.body    || 'Nouveau retour produit enregistré';
  const iconUrl = self.registration.scope + 'icon-192.png';

  const options = {
    body,
    icon:    data.icon  || iconUrl,
    badge:   iconUrl,
    vibrate: [200, 100, 200],
    tag:     'lm-retour',          // remplace la notif précédente si non lue
    renotify: true,
    requireInteraction: false,
    data:    data.data  || { url: self.registration.scope }
  };

  console.log('[SW] Affichage notification:', title, body);
  e.waitUntil(self.registration.showNotification(title, options));
});

// ── CLIC SUR NOTIFICATION ───────────────────────────────────────────────────
self.addEventListener('notificationclick', function(e) {
  console.log('[SW] Notification cliquée');
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(function(cs) {
      for(const c of cs) {
        if(c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
      }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── SKIP WAITING ─────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
