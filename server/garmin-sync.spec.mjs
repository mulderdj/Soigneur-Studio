// Garmin sync against a fake Garmin Personal API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('./app.js');

const KEY = 'gpk_test_0123456789abcdef';
const DAY = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const today = () => isoDay(Date.now());
const daysAgo = (n) => isoDay(Date.now() - n * DAY);

function jwt(expSeconds) {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b({alg: 'none'})}.${b({exp: expSeconds, sub: 'u'})}.sig`;
}

function fakeGarmin() {
    const log = [];
    const state = {
        tokenTtl: 86400, tokens: new Set(), revoked: false, rateLimitNext: 0, sleep404: false,
        keys: new Set([KEY]), tokenKey: new Map(), forbidden: null, delayMs: 0,
        hrv: [], daily: [], sleep: [], bodyBattery: [], stress: [], weight: [], vo2: [], zones: [], activities: [],
    };
    const inRange = (day, a, b) => day >= a && day <= b;
    const server = http.createServer(async (req, res) => {
        for await (const _ of req) { /* drain */ }
        const url = new URL(req.url, 'http://x');
        const q = Object.fromEntries(url.searchParams);
        log.push({method: req.method, path: url.pathname, query: q, auth: req.headers.authorization});
        const json = (status, obj, headers = {}) => { res.writeHead(status, {'Content-Type': 'application/json', ...headers}); res.end(JSON.stringify(obj)); };

        if(url.pathname === '/personalapitoken-service/personal-api/personal-api-key/token' && req.method === 'POST') {
            const key = (req.headers.authorization ?? '').replace(/^ApiKey /, '');
            if(state.revoked || !state.keys.has(key)) return json(401, {error: 'invalid key'});
            const t = jwt(Math.floor(Date.now() / 1000) + state.tokenTtl) + '.' + state.tokens.size; // unique
            state.tokens.add(t);
            state.tokenKey.set(t, key);
            res.writeHead(200, {'Content-Type': 'text/plain'});
            return res.end(t);
        }
        const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        if(state.delayMs) await new Promise(r => setTimeout(r, state.delayMs)); // a slow answer, before the check
        if(state.revoked || !state.tokens.has(bearer) || !state.keys.has(state.tokenKey.get(bearer))) return json(401, {error: 'unauthorized'});
        if(state.forbidden && url.pathname.startsWith(state.forbidden)) return json(403, {error: 'forbidden'});
        if(state.rateLimitNext > 0) { state.rateLimitNext--; return json(429, {}, {'Retry-After': '0'}); }

        let m;
        if((m = /^\/hrv-service\/hrv\/daily\/([\d-]+)\/([\d-]+)$/.exec(url.pathname)))
            return json(200, {hrvSummaries: state.hrv.filter(h => inRange(h.calendarDate, m[1], m[2]))});
        if(url.pathname === '/usersummary-service/v2/dailysummaries')
            return json(200, {data: state.daily.filter(d => inRange(d.calendarDate, q.startDate, q.endDate))});
        if(url.pathname === '/sleep-service/sleep/dailySleepSummariesByDate') {
            if(state.sleep404) return json(404, {});
            return json(200, state.sleep.filter(d => inRange(d.calendarDate, q.startDate, q.endDate)));
        }
        if(url.pathname === '/wellness-service/wellness/bodyBattery/reports/daily')
            return json(200, state.bodyBattery.filter(d => inRange(d.date, q.startDate, q.endDate)));
        if((m = /^\/usersummary-service\/stats\/stress\/daily\/([\d-]+)\/([\d-]+)$/.exec(url.pathname)))
            return json(200, state.stress.filter(d => inRange(d.calendarDate, m[1], m[2])));
        if((m = /^\/weight-service\/weight\/range\/([\d-]+)\/([\d-]+)$/.exec(url.pathname)))
            return json(200, {dailyWeightSummaries: state.weight.filter(d => inRange(d.summaryDate, m[1], m[2]))});
        if((m = /^\/metrics-service\/metrics\/maxmet\/daily\/([\d-]+)\/([\d-]+)$/.exec(url.pathname)))
            return json(200, state.vo2.filter(d => inRange(d.generic.calendarDate, m[1], m[2])));
        if(url.pathname === '/biometric-service/heartRateZones/v2') return json(200, state.zones);
        if(url.pathname === '/activitylist-service/activities/search/activities') {
            const list = state.activities
                  .filter(a => inRange(a.startTimeLocal.slice(0, 10), q.startDate, q.endDate))
                  .sort((a, b) => (a.startTimeLocal < b.startTimeLocal ? 1 : -1));
            const start = Number(q.start ?? 0), limit = Number(q.limit ?? 20);
            return json(200, list.slice(start, start + limit));
        }
        json(404, {});
    });
    return {server, log, state};
}

async function setup() {
    const fake = fakeGarmin();
    await new Promise(r => fake.server.listen(0, r));
    const base = `http://127.0.0.1:${fake.server.address().port}`;
    const app = createApp({garmin: {base, pauseMs: 0, maxWaitMs: 5}});
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

const connect = (call, token, extra = {}) => call('PUT', '/api/me/connections/garmin', {token, body: {apiKey: KEY, ...extra}});

function activity(id, daysBack, extra = {}) {
    const t = Date.now() - daysBack * DAY;
    const local = new Date(t).toISOString().slice(0, 19).replace('T', ' ');
    return {activityId: id, activityName: `Ride ${id}`, activityType: {typeKey: 'road_biking'},
            startTimeLocal: local, startTimeGMT: local, duration: 3600, averageHR: 140,
            avgPower: 200, normPower: 215, trainingStressScore: 65, ...extra};
}

function windows(log, path) {
    return log.filter(l => l.path.startsWith(path)).map(l => {
        const m = /\/([\d-]{10})\/([\d-]{10})$/.exec(l.path);
        return m ? [m[1], m[2]] : [l.query.startDate, l.query.endDate];
    });
}

test('connect: a good key is checked with a token; a bad one is refused', async () => {
    const {call, token, fake, stop} = await setup();
    try {
        const bad = await call('PUT', '/api/me/connections/garmin', {token, body: {apiKey: 'wrong-key-0123456789'}});
        assert.equal(bad.status, 400);
        assert.match(bad.json.error, /Garmin didn't accept this key/);
        assert.equal((await call('PUT', '/api/me/connections/garmin', {token, body: {apiKey: 'x'}})).status, 400);
        const ok = await connect(call, token, {expiresOn: '2027-02-21'});
        assert.equal(ok.status, 200);
        assert.ok(fake.log.some(l => l.method === 'POST' && l.auth === `ApiKey ${KEY}`));
        const g = (await call('GET', '/api/me/connections', {token})).json.garmin;
        assert.equal(g.connected, true);
        assert.equal(g.expiresOn, '2027-02-21');
        // the key never comes back
        assert.ok(!JSON.stringify(g).includes(KEY));
    } finally { stop(); }
});

test('first run: 90 days of health in 28-day windows, 2 years of activities, paged', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        fake.state.hrv = [{calendarDate: daysAgo(1), lastNightAvg: 61, weeklyAvg: 58, baseline: {balancedLow: 50, balancedUpper: 66}}];
        fake.state.daily = [{calendarDate: daysAgo(1), restingHeartRate: 47}];
        fake.state.sleep = [{calendarDate: daysAgo(1), sleepTimeSeconds: 26000, sleepScores: {overall: {value: 80}}}];
        fake.state.zones = [{sport: 'CYCLING', lactateThresholdHeartRateUsed: 165}, {sport: 'DEFAULT', lactateThresholdHeartRateUsed: 170}];
        fake.state.activities = Array.from({length: 130}, (_, i) => activity(1000 + i, 2 + i * 5)); // 130 rides over ~650 days
        fake.state.activities.push(activity(9999, 800)); // older than 2 years: not fetched
        await connect(call, token);
        const out = await app.garminSync.run(userId);
        assert.equal(out.error, null);

        // health: from today − 90 days to today, consecutive 28-day windows, no gaps or overlap
        // connecting starts a sync of its own: look at that first run only
        const all = windows(fake.log, '/hrv-service/hrv/daily/');
        const w = all.slice(0, all.findIndex(x => x[1] === today()) + 1);
        assert.equal(w[0][0], daysAgo(90));
        assert.equal(w.at(-1)[1], today());
        for(let i = 1; i < w.length; i++) assert.equal(w[i][0], isoDay(Date.parse(w[i - 1][1]) + DAY));
        for(const [a, b] of w) assert.ok((Date.parse(b) - Date.parse(a)) / DAY <= 27);

        // activities: paged by 100 from today − 730 days
        const allPages = fake.log.filter(l => l.path === '/activitylist-service/activities/search/activities');
        const pages = allPages.slice(0, allPages.findIndex((p, i) => i > 0 && p.query.start === '0'));
        assert.equal(pages[0].query.startDate, daysAgo(730));
        assert.deepEqual(pages.map(p => p.query.start), ['0', '100']);
        assert.ok(pages.every(p => p.query.limit === '100'));

        const rides = (await call('GET', '/api/me/external-rides', {token})).json.rides;
        assert.equal(rides.length, 130);
        assert.ok(rides.every(r => r.source === 'garmin' && r.id.startsWith('garmin-')));
        const days = (await call('GET', '/api/me/wellness', {token})).json.days;
        assert.deepEqual(days, [{day: daysAgo(1), hrv: 61, hrvWeekly: 58, hrvBaseline: {low: 50, high: 66},
                                 restingHr: 47, sleepSeconds: 26000, sleepScore: 80}]);
        const g = (await call('GET', '/api/me/connections', {token})).json.garmin;
        assert.deepEqual(g.thresholds, {cycling: 165, running: 170});
        assert.equal(g.sync.activities, 130);
        assert.equal(g.sync.days, 1);
        assert.ok(g.sync.lastRun > 0);
    } finally { stop(); }
});

test('the token is reused while it has more than an hour left', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        await connect(call, token);
        await app.garminSync.run(userId);
        const tokens = () => fake.log.filter(l => l.method === 'POST').length;
        const before = tokens();
        await app.garminSync.run(userId);
        assert.equal(tokens(), before);
        fake.state.tokenTtl = 1800;  // the next token lives only half an hour
        fake.state.tokens.clear();   // and the current one stops working
        await app.garminSync.run(userId);
        const after = tokens();
        assert.equal(after, before + 1);
        await app.garminSync.run(userId); // less than an hour left: renewed again
        assert.equal(tokens(), after + 1);
    } finally { stop(); }
});

test('later runs: health from newest − 3 days, activities from newest − 7; unchanged rides untouched', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        fake.state.hrv = [{calendarDate: daysAgo(10), lastNightAvg: 60}];
        fake.state.activities = [activity(1, 20), activity(2, 12)];
        await connect(call, token);
        await app.garminSync.run(userId);
        const since = (await call('GET', '/api/me/external-rides', {token})).json.now;
        const n = fake.log.length;
        await new Promise(r => setTimeout(r, 5));
        fake.state.activities.push(activity(3, 1));
        await app.garminSync.run(userId);
        const later = fake.log.slice(n);
        assert.equal(windows(later, '/hrv-service/hrv/daily/')[0][0], daysAgo(13));
        assert.equal(later.find(l => l.path === '/activitylist-service/activities/search/activities').query.startDate, daysAgo(19));
        const changed = (await call('GET', `/api/me/external-rides?since=${since}`, {token})).json.rides;
        assert.deepEqual(changed.map(r => r.id), ['garmin-3']);
    } finally { stop(); }
});

test('one endpoint failing does not stop the others (Review Focus 2)', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        fake.state.sleep404 = true;
        fake.state.hrv = [{calendarDate: daysAgo(2), lastNightAvg: 55}];
        await connect(call, token);
        const out = await app.garminSync.run(userId);
        assert.equal(out.error, null);
        assert.deepEqual((await call('GET', '/api/me/wellness', {token})).json.days, [{day: daysAgo(2), hrv: 55}]);
    } finally { stop(); }
});

test('a revoked key removes the connection and keeps the data', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        fake.state.hrv = [{calendarDate: daysAgo(2), lastNightAvg: 55}];
        fake.state.activities = [activity(1, 3)];
        await connect(call, token);
        await app.garminSync.run(userId);
        fake.state.revoked = true;
        const out = await app.garminSync.run(userId);
        assert.match(out.error, /Garmin no longer accepts the API key/);
        const g = (await call('GET', '/api/me/connections', {token})).json.garmin;
        assert.equal(g.connected, false);
        assert.match(g.sync.error, /Garmin no longer accepts the API key/);
        assert.equal((await call('GET', '/api/me/external-rides', {token})).json.rides.length, 1);
        assert.equal((await call('GET', '/api/me/wellness', {token})).json.days.length, 1);
    } finally { stop(); }
});

test('rate limits: one is waited out, three give up', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        fake.state.activities = [activity(1, 3)];
        await connect(call, token);
        fake.state.rateLimitNext = 1;
        assert.equal((await app.garminSync.run(userId)).error, null);
        fake.state.rateLimitNext = 3;
        assert.match((await app.garminSync.run(userId)).error, /rate limit/i);
    } finally { stop(); }
});

test('routes: per user; sync needs a connection; disconnect keeps the data', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        assert.equal((await call('POST', '/api/me/garmin/sync', {token, body: {}})).status, 409);
        fake.state.activities = [activity(1, 3)];
        fake.state.hrv = [{calendarDate: daysAgo(2), lastNightAvg: 55}];
        await connect(call, token);
        assert.equal((await call('POST', '/api/me/garmin/sync', {token, body: {}})).status, 202);
        await app.garminSync.run(userId);
        await call('POST', '/api/users', {token, body: {username: 'ane', password: 'password123', role: 'rider'}});
        const other = (await call('POST', '/api/auth/login', {body: {username: 'ane', password: 'password123'}})).json.token;
        assert.deepEqual((await call('GET', '/api/me/external-rides', {token: other})).json.rides, []);
        assert.deepEqual((await call('GET', '/api/me/wellness', {token: other})).json.days, []);
        assert.equal((await call('GET', '/api/me/connections', {token: other})).json.garmin.connected, false);
        assert.equal((await call('DELETE', '/api/me/connections/garmin', {token})).status, 200);
        assert.equal((await call('GET', '/api/me/connections', {token})).json.garmin.connected, false);
        assert.equal((await call('GET', '/api/me/wellness', {token})).json.days.length, 1);
        assert.equal((await call('GET', '/api/me/wellness')).status, 401);
    } finally { stop(); }
});

test('one endpoint refused for this key keeps the connection; only a refused key disconnects (review)', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        fake.state.forbidden = '/weight-service/';
        fake.state.hrv = [{calendarDate: daysAgo(2), lastNightAvg: 55}];
        fake.state.activities = [activity(1, 3)];
        await connect(call, token);
        const out = await app.garminSync.run(userId);
        assert.equal(out.error, null);
        assert.equal((await call('GET', '/api/me/connections', {token})).json.garmin.connected, true);
        assert.equal((await call('GET', '/api/me/wellness', {token})).json.days.length, 1);
        assert.equal((await call('GET', '/api/me/external-rides', {token})).json.rides.length, 1);
    } finally { stop(); }
});

test('a run with an old key never removes a newly pasted key (review)', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        const NEW = 'gpk_test_new_key_0123456789';
        await connect(call, token);
        await app.garminSync.run(userId);
        fake.state.keys = new Set([NEW]);   // the old key is deleted on Garmin Connect
        fake.state.delayMs = 40;
        const running = app.garminSync.run(userId);   // still uses the old key
        await new Promise(r => setTimeout(r, 10));
        fake.state.delayMs = 0;
        assert.equal((await call('PUT', '/api/me/connections/garmin', {token, body: {apiKey: NEW}})).status, 200);
        const out = await running;
        assert.match(out.error ?? '', /no longer accepts/);
        assert.equal((await call('GET', '/api/me/connections', {token})).json.garmin.connected, true);
        assert.equal((await app.garminSync.run(userId)).error, null);  // the new key works
    } finally { stop(); }
});

test('rides stored by an older mapping are listed again, back to the oldest of them (review)', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        fake.state.activities = [activity(1, 40), activity(2, 2)];
        await connect(call, token);
        await app.garminSync.run(userId);
        // as stored before this mapping: no marker
        app.db.prepare("UPDATE external_rides SET fingerprint = NULL WHERE user_id = ? AND id = 'garmin-1'").run(userId);
        const n = fake.log.length;
        await app.garminSync.run(userId);
        const later = fake.log.slice(n);
        assert.equal(later.find(l => l.path === '/activitylist-service/activities/search/activities').query.startDate, daysAgo(40));
        const m = fake.log.length;
        await app.garminSync.run(userId);
        assert.equal(fake.log.slice(m).find(l => l.path === '/activitylist-service/activities/search/activities').query.startDate, daysAgo(9));
    } finally { stop(); }
});

test('a stale ride Garmin no longer lists does not keep every run reaching back (review)', async () => {
    const {app, call, token, userId, fake, stop} = await setup();
    try {
        fake.state.activities = [activity(1, 40), activity(2, 2)];
        await connect(call, token);
        await app.garminSync.run(userId);
        app.db.prepare("UPDATE external_rides SET fingerprint = NULL WHERE user_id = ? AND id = 'garmin-1'").run(userId);
        fake.state.activities = [activity(2, 2)];
        await app.garminSync.run(userId);
        const m = fake.log.length;
        await app.garminSync.run(userId);
        assert.equal(fake.log.slice(m).find(l => l.path === '/activitylist-service/activities/search/activities').query.startDate, daysAgo(9));
    } finally { stop(); }
});
