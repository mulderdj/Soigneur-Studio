// node --test server/intervals-sync.spec.mjs
// intervals.icu is replaced by a local fake with activities, power curves and events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('./app.js');

const KEY = 'abcdef1234567890';
const FIT = Buffer.concat([Buffer.from([14, 0x20, 0, 0, 0, 0, 0, 0]), Buffer.from('.FIT'), Buffer.from('ride-bytes')]);
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);

function fakeIntervals() {
    const log = [];
    const state = {
        activities: [],               // returned by the list call (filtered by oldest/newest)
        curves: {},                   // activity id -> power curve
        events: new Map(),            // event id -> event
        nextEventId: 900,
        rateLimitNext: 0,             // answer 429 this many times
        revoked: false,
        failAfterCreate: 0,           // create the event, then answer 500 this many times
    };
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const isJson = (req.headers['content-type'] ?? '').includes('json');
        const body = chunks.length && isJson ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null;
        const url = new URL(req.url, 'http://x');
        const json = (status, obj, headers = {}) => { res.writeHead(status, {'Content-Type': 'application/json', ...headers}); res.end(JSON.stringify(obj)); };
        log.push({method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body});
        const authed = req.headers.authorization === 'Basic ' + Buffer.from(`API_KEY:${KEY}`).toString('base64');
        if(url.pathname === '/api/v1/athlete/0' && req.method === 'GET') return authed ? json(200, {id: 'i1', name: 'DJ'}) : json(403, {});
        if(state.revoked || !authed) return json(401, {error: 'nope'});
        if(state.rateLimitNext > 0) { state.rateLimitNext--; return json(429, {error: 'slow down'}, {'Retry-After': '0'}); }

        if(url.pathname === '/api/v1/athlete/0/activities' && req.method === 'GET') {
            const oldest = url.searchParams.get('oldest'), newest = url.searchParams.get('newest') ?? '9999';
            return json(200, state.activities.filter(a => !a.start_date_local || (a.start_date_local.slice(0, 10) >= oldest && a.start_date_local.slice(0, 10) <= newest)));
        }
        if(url.pathname === '/api/v1/athlete/0/activities' && req.method === 'POST') return json(201, [{id: 'i555'}]);
        const pc = /^\/api\/v1\/activity\/([^/]+)\/power-curve$/.exec(url.pathname);
        if(pc) return json(200, state.curves[pc[1]] ?? {secs: [], watts: []});
        if(url.pathname === '/api/v1/athlete/0/events' && req.method === 'GET') {
            const oldest = url.searchParams.get('oldest'), newest = url.searchParams.get('newest');
            return json(200, [...state.events.values()].filter(e => e.start_date_local.slice(0, 10) >= oldest && e.start_date_local.slice(0, 10) <= newest));
        }
        if(url.pathname === '/api/v1/athlete/0/events' && req.method === 'POST') {
            const existing = [...state.events.values()].find(e => e.uid && e.uid === body.uid);
            const id = existing?.id ?? state.nextEventId++;
            const ev = {...existing, ...body, id, updated: new Date().toISOString()};
            state.events.set(id, ev);
            if(state.failAfterCreate > 0) { state.failAfterCreate--; return json(500, {error: 'boom'}); }
            return json(200, ev);
        }
        const ev = /^\/api\/v1\/athlete\/0\/events\/(\d+)$/.exec(url.pathname);
        if(ev && req.method === 'PUT') {
            const e = state.events.get(Number(ev[1]));
            if(!e) return json(404, {});
            const next = {...e, ...body, updated: new Date().toISOString()};
            state.events.set(e.id, next);
            return json(200, next);
        }
        if(ev && req.method === 'DELETE') { state.events.delete(Number(ev[1])); return json(200, {}); }
        json(404, {});
    });
    return {server, log, state};
}

async function setup() {
    const fake = fakeIntervals();
    await new Promise(r => fake.server.listen(0, r));
    const base = `http://127.0.0.1:${fake.server.address().port}`;
    const app = createApp({
        connections: {fetch: globalThis.fetch, intervalsBase: base, retryDelaysMs: [20, 20]},
        intervals: {base, pauseMs: 0, maxWaitMs: 5},
    });
    await new Promise(r => app.server.listen(0, r));
    const api = `http://127.0.0.1:${app.server.address().port}`;
    const call = async (method, path, {token, body} = {}) => {
        const res = await fetch(api + path, {
            method,
            headers: {...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: `Bearer ${token}`} : {})},
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        return {status: res.status, json: text ? JSON.parse(text) : null};
    };
    const {token} = (await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}})).json;
    const userId = (await call('GET', '/api/me', {token})).json.user.id;
    const stop = () => { app.close(); fake.server.closeAllConnections(); fake.server.close(); };
    return {app, call, token, userId, fake, stop};
}

const connect = (call, token) => call('PUT', '/api/me/connections/intervals', {token, body: {apiKey: KEY}});

function activity(id, daysAgo, extra = {}) {
    const t = Date.now() - daysAgo * DAY;
    return {id, start_date_local: iso(t), start_date: iso(t) + 'Z', type: 'Ride', name: `Ride ${id}`, moving_time: 3600,
            icu_training_load: 60, icu_weighted_avg_watts: 220, icu_ftp: 250, source: 'GARMIN_CONNECT', ...extra};
}

test('first sync: two years, power curves for cycling, stubs counted not stored', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        fake.state.activities = [
            activity('a1', 3),
            activity('a2', 400, {type: 'Run', icu_weighted_avg_watts: undefined, source: 'GARMIN_CONNECT'}),
            activity('a3', 20, {type: 'VirtualRide', source: 'ZWIFT'}),
            {id: 's1', source: 'STRAVA'}, {id: 's2', source: 'STRAVA'},
        ];
        fake.state.curves.a1 = {secs: [5, 60, 300, 1200, 3600], watts: [800, 420, 300, 260, 240]};
        const out = await app.intervalsSync.run(userId);
        assert.equal(out.stored, 3);
        assert.deepEqual(out.skipped, {STRAVA: 2});

        const list = fake.log.find(l => l.path === '/api/v1/athlete/0/activities' && l.method === 'GET');
        const twoYearsAgo = new Date(Date.now() - 730 * DAY).toISOString().slice(0, 10);
        assert.equal(list.query.oldest, twoYearsAgo);
        const curves = fake.log.filter(l => l.path.endsWith('/power-curve')).map(l => l.path);
        assert.deepEqual(curves.sort(), ['/api/v1/activity/a1/power-curve', '/api/v1/activity/a3/power-curve']);

        const rides = (await call('GET', '/api/me/external-rides', {token})).json.rides;
        assert.deepEqual(rides.map(r => r.id).sort(), ['icu-a1', 'icu-a2', 'icu-a3']);
        assert.equal(rides.find(r => r.id === 'icu-a1').best[1200], 260);
        assert.equal(rides.find(r => r.id === 'icu-a2').sport, 'run');

        const status = (await call('GET', '/api/me/connections', {token})).json.intervals.sync;
        assert.equal(status.stored, 3);
        assert.deepEqual(status.skipped, {STRAVA: 2});
        assert.ok(status.lastRun > 0);
        assert.equal(status.error, null);
    } finally { stop(); }
});

test('later syncs fetch from a week before the newest ride and pick up edits', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        fake.state.activities = [activity('a1', 3), activity('a0', 30)];
        await app.intervalsSync.run(userId);
        const since = (await call('GET', '/api/me/external-rides', {token})).json.now;
        fake.log.length = 0;
        fake.state.activities = [activity('a1', 3, {icu_training_load: 99, name: 'Renamed'}), activity('a0', 30)];
        await app.intervalsSync.run(userId);
        const list = fake.log.find(l => l.path === '/api/v1/athlete/0/activities');
        const newestDay = new Date(Date.parse(fake.state.activities[0].start_date)).toISOString().slice(0, 10);
        const expected = new Date(Date.parse(newestDay) - 7 * DAY).toISOString().slice(0, 10);
        assert.equal(list.query.oldest, expected);
        const changed = (await call('GET', `/api/me/external-rides?since=${since}`, {token})).json.rides;
        assert.deepEqual(changed.map(r => [r.id, r.tss, r.name]), [['icu-a1', 99, 'Renamed']]);
    } finally { stop(); }
});

test('an activity that is one of Auuki\'s own uploads is linked to the ride', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        await call('POST', '/api/me/activities', {token, body: {id: 'ride-1', fit: FIT.toString('base64'),
            summary: {name: 'Indoor', timestamp: Date.now(), duration: 3600}}});
        // auto-upload to intervals.icu gives the activity id i555
        for(let i = 0; i < 100 && !fake.log.some(l => l.method === 'POST' && l.path === '/api/v1/athlete/0/activities'); i++) {
            await new Promise(r => setTimeout(r, 20));
        }
        await new Promise(r => setTimeout(r, 50));
        fake.state.activities = [activity('i555', 0)];
        await app.intervalsSync.run(userId);
        const ride = (await call('GET', '/api/me/external-rides', {token})).json.rides[0];
        assert.equal(ride.auukiRideId, 'ride-1');
    } finally { stop(); }
});

test('rate limits: waits and goes on; gives up after three in a row', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        fake.state.activities = [activity('a1', 3)];
        fake.state.rateLimitNext = 1;
        assert.equal((await app.intervalsSync.run(userId)).stored, 1);
        fake.state.rateLimitNext = 3;
        const out = await app.intervalsSync.run(userId);
        assert.match(out.error, /rate limit/i);
        const rides = (await call('GET', '/api/me/external-rides', {token})).json.rides;
        assert.equal(rides.length, 1); // nothing lost
    } finally { stop(); }
});

test('a revoked key stops the sync, asks for the key again, keeps the rides', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        fake.state.activities = [activity('a1', 3)];
        await app.intervalsSync.run(userId);
        fake.state.revoked = true;
        const out = await app.intervalsSync.run(userId);
        assert.match(out.error, /no longer accepts the API key/);
        const conn = (await call('GET', '/api/me/connections', {token})).json.intervals;
        assert.equal(conn.connected, false);
        assert.equal((await call('GET', '/api/me/external-rides', {token})).json.rides.length, 1);
    } finally { stop(); }
});

test('routes: per user, and sync needs a connection', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        assert.equal((await call('POST', '/api/me/intervals/sync', {token, body: {}})).status, 409);
        await connect(call, token);
        fake.state.activities = [activity('a1', 3)];
        assert.equal((await call('POST', '/api/me/intervals/sync', {token, body: {}})).status, 202);
        for(let i = 0; i < 100 && (await call('GET', '/api/me/external-rides', {token})).json.rides.length === 0; i++) {
            await new Promise(r => setTimeout(r, 20));
        }
        assert.equal((await call('GET', '/api/me/external-rides', {token})).json.rides.length, 1);
        await call('POST', '/api/users', {token, body: {username: 'ane', password: 'password123', role: 'rider'}});
        const other = (await call('POST', '/api/auth/login', {body: {username: 'ane', password: 'password123'}})).json.token;
        assert.deepEqual((await call('GET', '/api/me/external-rides', {token: other})).json.rides, []);
    } finally { stop(); }
});

// ---- plan, both ways ----

const ZWO = '<workout_file><name>Sweet spot</name><workout><SteadyState Duration="600" Power="0.9"/></workout></workout_file>';
const dayFrom = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const planRows = async (call, token) => (await call('GET', '/api/me/plan', {token})).json.entries;
const putEntry = (call, token, id, data) => call('PUT', `/api/me/plan/${id}`, {token, body: {data}});
const auukiEntry = (day, extra = {}) => ({day, workout: {id: 'w1', meta: {name: 'Sweet spot'}, intervals: []}, rideId: null, zwo: ZWO, ...extra});

function addEvent(fake, {day, name = 'Threshold', zwo = ZWO, uid = null}) {
    const id = fake.state.nextEventId++;
    fake.state.events.set(id, {id, uid, category: 'WORKOUT', type: 'Ride', name, start_date_local: `${day}T00:00:00`,
                               workout_file_base64: Buffer.from(zwo).toString('base64'), updated: new Date().toISOString()});
    return id;
}

test('plan: an intervals.icu workout becomes a plan entry', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        const evId = addEvent(fake, {day: dayFrom(2), name: 'Threshold'});
        await app.intervalsSync.run(userId);
        const list = fake.log.find(l => l.path === '/api/v1/athlete/0/events' && l.method === 'GET');
        assert.equal(list.query.oldest, dayFrom(-14));
        assert.equal(list.query.newest, dayFrom(90));
        assert.equal(list.query.category, 'WORKOUT');
        assert.equal(list.query.ext, 'zwo');
        const rows = await planRows(call, token);
        assert.equal(rows.length, 1);
        const d = rows[0].data;
        assert.equal(d.origin, 'intervals');
        assert.equal(d.intervalsEventId, evId);
        assert.equal(d.zwo, ZWO);
        assert.equal(d.day, dayFrom(2));
        assert.equal(d.workout.meta.name, 'Threshold');
        // a second run makes no second entry
        await app.intervalsSync.run(userId);
        assert.equal((await planRows(call, token)).length, 1);
    } finally { stop(); }
});

test('plan: an Auuki entry is created on intervals.icu once, with its uid', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        await putEntry(call, token, 'p1', auukiEntry(dayFrom(1)));
        await putEntry(call, token, 'p2', auukiEntry(dayFrom(1), {zwo: null})); // no .zwo: skipped
        await app.intervalsSync.run(userId);
        const posts = fake.log.filter(l => l.method === 'POST' && l.path === '/api/v1/athlete/0/events');
        assert.equal(posts.length, 1);
        assert.equal(posts[0].query.upsertOnUid, 'true');
        const b = posts[0].body;
        assert.equal(b.uid, 'auuki-p1');
        assert.equal(b.category, 'WORKOUT');
        assert.equal(b.type, 'Ride');
        assert.equal(b.name, 'Sweet spot');
        assert.equal(b.start_date_local, `${dayFrom(1)}T00:00:00`);
        assert.equal(b.file_contents, ZWO);
        assert.match(b.filename, /\.zwo$/);
        const p1 = (await planRows(call, token)).find(r => r.id === 'p1').data;
        assert.equal(p1.intervalsEventId, posts[0].body && [...fake.state.events.values()][0].id);
        assert.equal(p1.origin, 'auuki');
        assert.equal(app.intervalsSync.status(userId).planSkipped, 1);
        await app.intervalsSync.run(userId);
        assert.equal(fake.state.events.size, 1);
    } finally { stop(); }
});

test('plan: a failed create is retried with the same uid and makes one event', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        await putEntry(call, token, 'p1', auukiEntry(dayFrom(1)));
        fake.state.failAfterCreate = 1;
        const first = await app.intervalsSync.run(userId);
        assert.ok(first.error);
        await app.intervalsSync.run(userId);
        const posts = fake.log.filter(l => l.method === 'POST' && l.path === '/api/v1/athlete/0/events');
        assert.ok(posts.every(p => p.body.uid === 'auuki-p1'));
        assert.equal(fake.state.events.size, 1);
        const p1 = (await planRows(call, token)).find(r => r.id === 'p1').data;
        assert.equal(p1.intervalsEventId, [...fake.state.events.keys()][0]);
    } finally { stop(); }
});

test('plan: moves go both ways', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        await putEntry(call, token, 'p1', auukiEntry(dayFrom(1)));
        await app.intervalsSync.run(userId);
        const evId = (await planRows(call, token))[0].data.intervalsEventId;

        // moved in Auuki (the app sends the entry back with the fields it got)
        await new Promise(r => setTimeout(r, 5));
        const data = (await planRows(call, token))[0].data;
        await putEntry(call, token, 'p1', {...data, day: dayFrom(3)});
        await app.intervalsSync.run(userId);
        const put = fake.log.filter(l => l.method === 'PUT' && l.path === `/api/v1/athlete/0/events/${evId}`).at(-1);
        assert.equal(put.body.start_date_local, `${dayFrom(3)}T00:00:00`);

        // moved on intervals.icu
        await new Promise(r => setTimeout(r, 5));
        const ev = fake.state.events.get(evId);
        fake.state.events.set(evId, {...ev, start_date_local: `${dayFrom(5)}T00:00:00`, name: 'Moved', updated: new Date().toISOString()});
        await app.intervalsSync.run(userId);
        const row = (await planRows(call, token))[0].data;
        assert.equal(row.day, dayFrom(5));
        assert.equal(row.workout.meta.name, 'Moved');
    } finally { stop(); }
});

test('plan: the app keeps the intervals.icu link when it saves an entry without it', async () => {
    const {app, call, token, userId, stop} = await setup();
    try {
        await connect(call, token);
        await putEntry(call, token, 'p1', auukiEntry(dayFrom(1)));
        await app.intervalsSync.run(userId);
        const evId = (await planRows(call, token))[0].data.intervalsEventId;
        await putEntry(call, token, 'p1', auukiEntry(dayFrom(2))); // an older app that drops unknown fields
        assert.equal((await planRows(call, token))[0].data.intervalsEventId, evId);
    } finally { stop(); }
});

test('plan: deletions go both ways', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        await putEntry(call, token, 'p1', auukiEntry(dayFrom(1)));
        const ev2 = addEvent(fake, {day: dayFrom(4)});
        await app.intervalsSync.run(userId);
        const ev1 = (await planRows(call, token)).find(r => r.id === 'p1').data.intervalsEventId;

        await call('DELETE', '/api/me/plan/p1', {token});
        fake.state.events.delete(ev2);
        await app.intervalsSync.run(userId);
        assert.ok(fake.log.some(l => l.method === 'DELETE' && l.path === `/api/v1/athlete/0/events/${ev1}`));
        assert.equal(fake.state.events.size, 0);
        const rows = await planRows(call, token);
        assert.ok(rows.every(r => r.deleted));
        // nothing left to do on the next run
        const n = fake.log.length;
        await app.intervalsSync.run(userId);
        assert.ok(fake.log.slice(n).every(l => l.method === 'GET'));
    } finally { stop(); }
});

test('plan: when both sides changed, the newer change wins', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        await putEntry(call, token, 'p1', auukiEntry(dayFrom(1)));
        await putEntry(call, token, 'p2', auukiEntry(dayFrom(1)));
        await app.intervalsSync.run(userId);
        const ids = Object.fromEntries((await planRows(call, token)).map(r => [r.id, r.data.intervalsEventId]));
        const rows = Object.fromEntries((await planRows(call, token)).map(r => [r.id, r.data]));
        await new Promise(r => setTimeout(r, 5));

        // p1: intervals.icu changed first, Auuki later → Auuki wins
        const e1 = fake.state.events.get(ids.p1);
        fake.state.events.set(ids.p1, {...e1, start_date_local: `${dayFrom(6)}T00:00:00`, updated: new Date().toISOString()});
        await new Promise(r => setTimeout(r, 5));
        await putEntry(call, token, 'p1', {...rows.p1, day: dayFrom(7)});

        // p2: Auuki changed first, intervals.icu later → intervals.icu wins
        await putEntry(call, token, 'p2', {...rows.p2, day: dayFrom(8)});
        await new Promise(r => setTimeout(r, 5));
        const e2 = fake.state.events.get(ids.p2);
        fake.state.events.set(ids.p2, {...e2, start_date_local: `${dayFrom(9)}T00:00:00`, updated: new Date(Date.now() + 1000).toISOString()});

        await app.intervalsSync.run(userId);
        const after = Object.fromEntries((await planRows(call, token)).map(r => [r.id, r.data]));
        assert.equal(after.p1.day, dayFrom(7));
        assert.equal(fake.state.events.get(ids.p1).start_date_local, `${dayFrom(7)}T00:00:00`);
        assert.equal(after.p2.day, dayFrom(9));
        assert.equal(fake.state.events.get(ids.p2).start_date_local, `${dayFrom(9)}T00:00:00`);
    } finally { stop(); }
});

test('plan: readOnly pulls but never writes to intervals.icu', async () => {
    const fake = fakeIntervals();
    await new Promise(r => fake.server.listen(0, r));
    const base = `http://127.0.0.1:${fake.server.address().port}`;
    const app = createApp({connections: {fetch: globalThis.fetch, intervalsBase: base}, intervals: {base, pauseMs: 0, maxWaitMs: 5, readOnly: true}});
    try {
        await new Promise(r => app.server.listen(0, r));
        const api = `http://127.0.0.1:${app.server.address().port}`;
        const call = async (method, path, {token, body} = {}) => {
            const res = await fetch(api + path, {method, headers: {...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: `Bearer ${token}`} : {})},
                                                 body: body !== undefined ? JSON.stringify(body) : undefined});
            const text = await res.text();
            return {status: res.status, json: text ? JSON.parse(text) : null};
        };
        const {token} = (await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}})).json;
        const userId = (await call('GET', '/api/me', {token})).json.user.id;
        await connect(call, token);
        await putEntry(call, token, 'p1', auukiEntry(dayFrom(1)));
        addEvent(fake, {day: dayFrom(2)});
        await app.intervalsSync.run(userId);
        assert.ok(fake.log.every(l => l.method === 'GET'));
        assert.equal((await planRows(call, token)).length, 2);
    } finally { app.close(); fake.server.closeAllConnections(); fake.server.close(); }
});
