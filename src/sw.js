//
// Service worker: the app works without a connection.
//
// - install: caches every file of this build (Parcel's manifest) under a
//   cache named after the build's version
// - the page (navigations): network first, the cached page when the server
//   doesn't answer within NAV_TIMEOUT (so online you always get the newest
//   build; offline the last one this device saw)
// - the build's files: cache first (their names change with every build)
// - the web app manifest: network first too (its name never changes, and an
//   old copy points to icons of an old build, which breaks installing)
// - a new build takes over at once (skipWaiting), not only after every tab
//   of the app has been closed
// - Google Fonts: cache first, kept after the first visit
// - the account server (/api/) and the root certificate: never cached; the
//   app keeps its data in IndexedDB and syncs when the connection returns
// - activate: earlier builds' caches are removed
//
// Registered by index.js in production builds only, never on the dev server.
//

// Injected at build time by vite.config.mjs (soigneurPwaPlugin)
const manifest = __SOIGNEUR_MANIFEST__;
const version = __SOIGNEUR_VERSION__;

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
    }).then(() => self.skipWaiting()));
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

// network first, the cached copy when the server doesn't answer in time;
// `key` is where it is kept ('/' for the page)
async function page(request, key = '/', waitUntil = () => {}) {
    const cache = await caches.open(CACHE);
    const network = fetch(request);
    try {
        const res = await withTimeout(network, NAV_TIMEOUT);
        if(res.ok) waitUntil(cache.put(key, res.clone()).catch(() => {}));
        return res;
    } catch(e) {
        const cached = key === '/' ? (await cache.match('/') ?? await cache.match('/index.html')) : await cache.match(key);
        if(cached) {
            // a slow answer that arrives later still refreshes the cached page
            waitUntil(network.then(res => (res.ok ? cache.put(key, res.clone()) : null)).catch(() => {}));
            return cached;
        }
        return network;
    }
}

async function cacheFirst(request, name, waitUntil = () => {}) {
    const cache = await caches.open(name);
    const cached = await cache.match(request);
    if(cached) return cached;
    const res = await fetch(request);
    const ct = res.headers?.get('content-type') ?? '';
    const expectsHtml = request.mode === 'navigate' || /\.html?$/i.test(new URL(request.url).pathname);
    // never poison static asset cache with an SPA HTML fallback response
    if((res.ok && (expectsHtml || !ct.includes('text/html'))) || res.type === 'opaque') {
        waitUntil(cache.put(request, res.clone()).catch(() => {}));
    }
    return res;
}

self.addEventListener('fetch', e => {
    const request = e.request;
    if(request.method !== 'GET') return;
    const url = new URL(request.url);
    const keep = p => e.waitUntil(p);

    if(FONT_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(request, FONTS, keep)); return; }
    if(url.origin !== self.location.origin) return;
    if(url.pathname.startsWith('/api/') || url.pathname === '/soigneur-root.crt') return;

    if(request.mode === 'navigate') { e.respondWith(page(request, '/', keep)); return; }
    if(url.pathname === '/manifest.webmanifest') { e.respondWith(page(request, '/manifest.webmanifest', keep)); return; }
    e.respondWith(cacheFirst(request, CACHE, keep));
});
