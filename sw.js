const CACHE = 'lm-retours-v32';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if(e.request.url.includes('supabase.co') || e.request.url.includes('fonts.google')) return;
  if(e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => { if(res && res.status===200) caches.open(CACHE).then(c=>c.put(e.request,res.clone())); return res; })
      .catch(() => caches.match(e.request))
  );
});

// ── PUSH : afficher la notification ──────────────────────────────────────────
self.addEventListener('push', function(e) {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}

  const title   = data.title || 'La Martinière — Retours';
  const body    = data.body  || 'Nouveau retour produit';
  const iconUrl = self.registration.scope + 'icon-192.png';

  const options = {
    body,
    icon:    data.icon || iconUrl,
    badge:   iconUrl,
    vibrate: [200, 100, 200],
    tag:     'lm-retour-' + (data.fiche_id || Date.now()),
    renotify: true,
    requireInteraction: false,
    // Stocker fiche_id et url dans les données de la notification
    data: {
      fiche_id: data.fiche_id || null,
      url: data.url || self.registration.scope
    }
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── CLIC sur notification : ouvrir l'app sur la bonne fiche ──────────────────
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  const notifData = e.notification.data || {};
  const ficheId   = notifData.fiche_id;
  const baseUrl   = self.registration.scope;
  const targetUrl = ficheId ? baseUrl + '?fiche=' + ficheId : baseUrl;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cs) {
      // App déjà ouverte → envoyer un message pour naviguer vers la fiche
      for(const c of cs) {
        if(c.url.startsWith(baseUrl) && 'focus' in c) {
          c.focus();
          if(ficheId) c.postMessage({ type: 'OPEN_FICHE', id: ficheId });
          return;
        }
      }
      // App fermée → ouvrir avec le paramètre fiche
      if(clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── SKIP WAITING ─────────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
