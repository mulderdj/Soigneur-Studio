//
// Service worker: the app works without a connection.
//
// - install: caches every file of this build (Parcel's manifest) under a
//   cache named after the build's version
// - the page (navigations): network first, the cached page when the server
//   doesn't answer within NAV_TIMEOUT (so online you always get the newest
//   build; offline the last one this device saw)
// - the build's files: cache first (their names change with every build)
// - Google Fonts: cache first, kept after the first visit
// - the account server (/api/) and the root certificate: never cached; the
//   app keeps its data in IndexedDB and syncs when the connection returns
// - activate: earlier builds' caches are removed
//
// Registered by index.js in production builds only, never on the dev server.
//

import { manifest, version } from '@parcel/service-worker';

const PREFIX = 'soigneur-';
const CACHE = `${PREFIX}${version}`;
const FONTS = `${PREFIX}fonts`;
const NAV_TIMEOUT = 3000;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const isMap = url => url.endsWith('.map');
const essential = url => /\.(html|js|css|webmanifest)$/.test(url) || url === '/';

self.addEventListener('install', e => {
    const files = [...new Set(['/', ...manifest])].filter(url => !isMap(url));
    e.waitUntil(caches.open(CACHE).then(async cache => {
        // the page, scripts and styles must all be there; an image that fails is fetched later
        await cache.addAll(files.filter(essential));
        await Promise.all(files.filter(url => !essential(url)).map(url => cache.add(url).catch(() => {})));
    }));
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        for(const key of await caches.keys()) {
            if(key !== CACHE && key !== FONTS) await caches.delete(key);
        }
        await self.clients.claim();
    })());
});

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(r => { clearTimeout(t); resolve(r); }, err => { clearTimeout(t); reject(err); });
    });
}

async function page(request) {
    const cache = await caches.open(CACHE);
    const network = fetch(request);
    try {
        const res = await withTimeout(network, NAV_TIMEOUT);
        if(res.ok) cache.put('/', res.clone());
        return res;
    } catch(e) {
        const cached = await cache.match('/') ?? await cache.match('/index.html');
        if(cached) {
            // a slow answer that arrives later still refreshes the cached page
            network.then(res => { if(res.ok) cache.put('/', res.clone()); }).catch(() => {});
            return cached;
        }
        return network;
    }
}

async function cacheFirst(request, name) {
    const cache = await caches.open(name);
    const cached = await cache.match(request);
    if(cached) return cached;
    const res = await fetch(request);
    if(res.ok || res.type === 'opaque') cache.put(request, res.clone());
    return res;
}

self.addEventListener('fetch', e => {
    const request = e.request;
    if(request.method !== 'GET') return;
    const url = new URL(request.url);

    if(FONT_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(request, FONTS)); return; }
    if(url.origin !== self.location.origin) return;
    if(url.pathname.startsWith('/api/') || url.pathname === '/soigneur-root.crt') return;

    if(request.mode === 'navigate') { e.respondWith(page(request)); return; }
    e.respondWith(cacheFirst(request, CACHE));
});
