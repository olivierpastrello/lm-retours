const CACHE  = 'lm-retours-v35';
const ASSETS = ['/', '/index.html', '/manifest.json'];

// ── Variable globale : fiche en attente d'ouverture ──────────────────────────
let _pendingFicheId = null;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
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

// ── PUSH ─────────────────────────────────────────────────────────────────────
self.addEventListener('push', function(e) {
  let data = {};
  try {
    const raw = e.data ? e.data.text() : '{}';
    console.log('[SW] Push reçu, raw:', raw.slice(0, 200));
    data = JSON.parse(raw);
  } catch(err) {
    console.error('[SW] Parse push data error:', err);
  }

  const ficheId = data.fiche_id || null;
  console.log('[SW] fiche_id dans le push:', ficheId);

  const scope = self.registration.scope;
  const options = {
    body:    data.body  || 'Nouveau retour produit',
    icon:    scope + 'icon-192.png',
    badge:   scope + 'icon-192.png',
    vibrate: [200, 100, 200],
    tag:     'lm-retour',
    renotify: true,
    data:    { fiche_id: ficheId, url: scope + (ficheId ? '?fiche=' + ficheId : '') }
  };
  e.waitUntil(self.registration.showNotification(data.title || 'La Martinière — Retours', options));
});

// ── CLIC SUR NOTIFICATION ────────────────────────────────────────────────────
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  const notifData = e.notification.data || {};
  const ficheId   = notifData.fiche_id;
  const scope     = self.registration.scope;

  console.log('[SW] Notification cliquée, fiche_id:', ficheId);

  // Mémoriser la fiche pour l'app (filet de sécurité si URL param perdu)
  _pendingFicheId = ficheId;

  const targetUrl = scope + (ficheId ? '?fiche=' + ficheId : '');

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cs) {
      console.log('[SW] Clients ouverts:', cs.length);
      for(const c of cs) {
        if(c.url.startsWith(scope) && 'focus' in c) {
          console.log('[SW] App déjà ouverte, postMessage OPEN_FICHE');
          c.focus();
          if(ficheId) c.postMessage({ type: 'OPEN_FICHE', id: ficheId });
          return;
        }
      }
      console.log('[SW] App fermée, ouverture:', targetUrl);
      if(clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── MESSAGES DEPUIS L'APP ─────────────────────────────────────────────────────
self.addEventListener('message', function(e) {
  if(!e.data) return;

  // App demande s'il y a une fiche en attente
  if(e.data === 'GET_PENDING_FICHE') {
    console.log('[SW] GET_PENDING_FICHE, en attente:', _pendingFicheId);
    if(e.source) e.source.postMessage({ type: 'PENDING_FICHE', id: _pendingFicheId });
    _pendingFicheId = null; // consommé une seule fois
    return;
  }
  if(e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
