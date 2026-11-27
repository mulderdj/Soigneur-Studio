// node --test server/connections.spec.mjs
// Strava and intervals.icu are replaced by a local fake that checks requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('./app.js');

const FIT = Buffer.concat([Buffer.from([14, 0x20, 0, 0, 0, 0, 0, 0]), Buffer.from('.FIT'), Buffer.from('ride-bytes')]);
const GOOD_KEY = 'abcdef1234567890';

function fakeServices() {
    const log = [];
    const state = {intervalsStatus: 201, tokenCalls: 0};
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        const url = new URL(req.url, 'http://x');
        const json = (status, obj) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(obj)); };
        const form = async () => new Response(body, {headers: {'content-type': req.headers['content-type']}}).formData();
        const entry = {method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization};
        log.push(entry);

        if(url.pathname === '/oauth/token') {
            state.tokenCalls++;
            const p = JSON.parse(body.toString());
            entry.grant = p.grant_type;
            if(p.client_secret !== 'secret') return json(401, {message: 'bad client'});
            if(p.grant_type === 'authorization_code' && p.code === 'good') {
                return json(200, {access_token: 'at1', refresh_token: 'rt1', expires_at: Math.floor(Date.now() / 1000) + 21600,
                                  athlete: {id: 42, firstname: 'D', lastname: 'J'}});
            }
            if(p.grant_type === 'refresh_token' && p.refresh_token === 'rt1') {
                return json(200, {access_token: 'at2', refresh_token: 'rt2', expires_at: Math.floor(Date.now() / 1000) + 21600});
            }
            return json(400, {message: 'bad code'});
        }
        if(url.pathname === '/oauth/deauthorize') return json(200, {});
        if(url.pathname === '/api/v3/uploads' && req.method === 'POST') {
            const f = await form();
            entry.fields = {data_type: f.get('data_type'), external_id: f.get('external_id'), trainer: f.get('trainer'), name: f.get('name')};
            entry.file = Buffer.from(await f.get('file').arrayBuffer());
            return json(201, {id: 7, id_str: '7', status: 'Your activity is still being processed.', activity_id: null, error: null});
        }
        if(url.pathname === '/api/v3/uploads/7') return json(200, {id: 7, activity_id: 999, error: null, status: 'Your activity is ready.'});
        if(url.pathname === '/api/v1/athlete/0' && req.method === 'GET') {
            const ok = req.headers.authorization === 'Basic ' + Buffer.from(`API_KEY:${GOOD_KEY}`).toString('base64');
            return ok ? json(200, {id: 'i123', name: 'DJ'}) : json(403, {error: 'Access denied'});
        }
        if(url.pathname === '/api/v1/athlete/0/activities' && req.method === 'POST') {
            const f = await form();
            entry.file = Buffer.from(await f.get('file').arrayBuffer());
            if(state.intervalsStatus !== 201) return json(state.intervalsStatus, {error: 'nope'});
            return json(201, [{icu_athlete_id: 'i123', id: 'i555'}]);
        }
        json(404, {});
    });
    return {server, log, state};
}

async function setup({stravaConfigured = true} = {}) {
    const fake = fakeServices();
    await new Promise(r => fake.server.listen(0, r));
    const base = `http://127.0.0.1:${fake.server.address().port}`;
    const app = createApp({connections: {
        fetch: globalThis.fetch, stravaBase: base, intervalsBase: base,
        publicUrl: stravaConfigured ? 'https://soigneur.lan:8443' : '',
        strava: stravaConfigured ? {clientId: '123', clientSecret: 'secret'} : {},
        pollDelayMs: 5, retryDelaysMs: [20, 20],
    }});
    await new Promise(r => app.server.listen(0, r));
    const api = `http://127.0.0.1:${app.server.address().port}`;
    const call = async (method, path, {token, body} = {}) => {
        const res = await fetch(api + path, {
            method, redirect: 'manual',
            headers: {...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: `Bearer ${token}`} : {})},
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let json = null; try { json = JSON.parse(text); } catch(e) {}
        return {status: res.status, json, location: res.headers.get('location')};
    };
    const {token} = (await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}})).json;
    const stop = () => { app.close(); fake.server.close(); };
    return {app, call, token, fake, stop};
}

async function until(fn, ms = 3000) {
    const t0 = Date.now();
    while(Date.now() - t0 < ms) { const v = await fn(); if(v) return v; await new Promise(r => setTimeout(r, 25)); }
    throw new Error('timed out');
}

async function connectStrava(call, token) {
    const start = await call('POST', '/api/me/connections/strava/start', {token, body: {}});
    assert.equal(start.status, 200);
    const u = new URL(start.json.url);
    assert.equal(u.searchParams.get('redirect_uri'), 'https://soigneur.lan:8443/api/connect/strava/callback');
    assert.equal(u.searchParams.get('scope'), 'read,activity:write');
    const state = u.searchParams.get('state');
    const cb = await call('GET', `/api/connect/strava/callback?state=${state}&code=good&scope=read,activity:write`);
    return {cb, state};
}

test('Strava: connect, auto-upload, status, disconnect', async () => {
    const {call, token, fake, stop} = await setup();
    const before = (await call('GET', '/api/me/connections', {token})).json;
    assert.deepEqual([before.strava.available, before.strava.connected, before.garmin.available], [true, false, false]);

    const {cb, state} = await connectStrava(call, token);
    assert.equal(cb.status, 302);
    assert.equal(cb.location, 'https://soigneur.lan:8443/?connect=strava&result=connected');
    // a state works once
    const again = await call('GET', `/api/connect/strava/callback?state=${state}&code=good&scope=read,activity:write`);
    assert.match(again.location, /result=error/);

    const c = (await call('GET', '/api/me/connections', {token})).json;
    assert.deepEqual([c.strava.connected, c.strava.athlete, c.strava.autoUpload], [true, 'D J', true]);
    // tokens never reach the browser
    assert.ok(!JSON.stringify(c).includes('at1'));

    await call('POST', '/api/me/activities', {token, body: {id: 'r1', fit: FIT.toString('base64'), summary: {name: 'Sweet spot', timestamp: Date.now(), duration: 3600}}});
    const ride = await until(async () => {
        const a = (await call('GET', '/api/me/activities', {token})).json.activities[0];
        return a.uploads.strava?.status === 'done' ? a : null;
    });
    assert.equal(ride.uploads.strava.url, 'https://www.strava.com/activities/999');
    const up = fake.log.find(e => e.path === '/api/v3/uploads');
    assert.deepEqual(up.fields, {data_type: 'fit', external_id: 'soigneur-r1.fit', trainer: '1', name: 'Sweet spot'});
    assert.ok(up.file.equals(FIT));
    assert.equal(up.auth, 'Bearer at1');

    const off = (await call('DELETE', '/api/me/connections/strava', {token})).json;
    assert.equal(off.strava.connected, false);
    assert.ok(fake.log.some(e => e.path === '/oauth/deauthorize'));
    stop();
});

test('Strava: expired token is refreshed before upload', async () => {
    const {app, call, token, fake, stop} = await setup();
    await connectStrava(call, token);
    const row = app.db.prepare("SELECT data FROM connections WHERE service = 'strava'").get();
    const data = {...JSON.parse(row.data), expiresAt: 1};
    app.db.prepare("UPDATE connections SET data = ? WHERE service = 'strava'").run(JSON.stringify(data));

    await call('POST', '/api/me/activities', {token, body: {id: 'r2', fit: FIT.toString('base64'), summary: {name: 'VO2'}}});
    await until(async () => (await call('GET', '/api/me/activities', {token})).json.activities[0].uploads.strava?.status === 'done');
    assert.ok(fake.log.some(e => e.grant === 'refresh_token'));
    assert.equal(fake.log.filter(e => e.path === '/api/v3/uploads').at(-1).auth, 'Bearer at2');
    stop();
});

test('Strava: refused scope, cancelled, and not configured', async () => {
    const {call, token, stop} = await setup();
    const start = await call('POST', '/api/me/connections/strava/start', {token, body: {}});
    const state = new URL(start.json.url).searchParams.get('state');
    const cb = await call('GET', `/api/connect/strava/callback?state=${state}&code=good&scope=read`);
    assert.match(cb.location, /result=error/);
    assert.match(decodeURIComponent(cb.location), /Upload your activities/);
    stop();

    const s2 = await setup({stravaConfigured: false});
    assert.equal((await s2.call('GET', '/api/me/connections', {token: s2.token})).json.strava.available, false);
    assert.equal((await s2.call('POST', '/api/me/connections/strava/start', {token: s2.token, body: {}})).status, 409);
    s2.stop();
});

test('intervals.icu: key check, upload, manual re-upload, revoked key', async () => {
    const {call, token, fake, stop} = await setup();
    assert.equal((await call('PUT', '/api/me/connections/intervals', {token, body: {apiKey: 'wrongwrongwrong'}})).status, 400);
    assert.equal((await call('PUT', '/api/me/connections/intervals', {token, body: {apiKey: 'x'}})).status, 400);
    const ok = await call('PUT', '/api/me/connections/intervals', {token, body: {apiKey: GOOD_KEY}});
    assert.deepEqual([ok.json.intervals.connected, ok.json.intervals.athlete], [true, 'DJ']);
    assert.ok(!JSON.stringify(ok.json).includes(GOOD_KEY));

    await call('POST', '/api/me/activities', {token, body: {id: 'r3', fit: FIT.toString('base64'), summary: {name: 'Z2'}}});
    const ride = await until(async () => {
        const a = (await call('GET', '/api/me/activities', {token})).json.activities[0];
        return a.uploads.intervals?.status === 'done' ? a : null;
    });
    assert.equal(ride.uploads.intervals.url, 'https://intervals.icu/activities/i555');
    const up = fake.log.find(e => e.path === '/api/v1/athlete/0/activities');
    assert.equal(up.query.name, 'Z2');
    assert.ok(up.file.equals(FIT));

    // auto-upload off: new rides are not sent; manual upload still works
    await call('PATCH', '/api/me/connections/intervals', {token, body: {autoUpload: false}});
    await call('POST', '/api/me/activities', {token, body: {id: 'r4', fit: FIT.toString('base64'), summary: {name: 'Z2 b'}}});
    await new Promise(r => setTimeout(r, 100));
    const r4 = (await call('GET', '/api/me/activities', {token})).json.activities.find(a => a.id === 'r4');
    assert.deepEqual(r4.uploads, {});

    // the key is revoked: upload fails permanently and the connection is removed
    fake.state.intervalsStatus = 403;
    assert.equal((await call('POST', '/api/me/activities/r4/upload/intervals', {token, body: {}})).status, 202);
    const failed = await until(async () => {
        const a = (await call('GET', '/api/me/activities', {token})).json.activities.find(x => x.id === 'r4');
        return a.uploads.intervals?.status === 'failed' ? a : null;
    });
    assert.match(failed.uploads.intervals.error, /API key/);
    assert.equal((await call('GET', '/api/me/connections', {token})).json.intervals.connected, false);
    stop();
});

test('intervals.icu: server errors are retried, then succeed', async () => {
    const {call, token, fake, stop} = await setup();
    await call('PUT', '/api/me/connections/intervals', {token, body: {apiKey: GOOD_KEY}});
    fake.state.intervalsStatus = 503;
    await call('POST', '/api/me/activities', {token, body: {id: 'r5', fit: FIT.toString('base64'), summary: {name: 'Retry'}}});
    await until(async () => (await call('GET', '/api/me/activities', {token})).json.activities[0].uploads.intervals?.status === 'retrying');
    fake.state.intervalsStatus = 201;
    await until(async () => (await call('GET', '/api/me/activities', {token})).json.activities[0].uploads.intervals?.status === 'done');
    stop();
});

test('uploads need a connection; other riders cannot upload my rides', async () => {
    const {call, token, stop} = await setup();
    await call('POST', '/api/me/activities', {token, body: {id: 'r6', fit: FIT.toString('base64'), summary: {}}});
    assert.equal((await call('POST', '/api/me/activities/r6/upload/strava', {token, body: {}})).status, 409);
    assert.equal((await call('POST', '/api/me/activities/r6/upload/garmin', {token, body: {}})).status, 404);
    const other = (await call('POST', '/api/users', {token, body: {username: 'ane', password: 'password123'}}));
    const ane = (await call('POST', '/api/auth/login', {body: {username: 'ane', password: 'password123'}})).json.token;
    assert.equal(other.status, 201);
    assert.equal((await call('POST', '/api/me/activities/r6/upload/intervals', {token: ane, body: {}})).status, 404);
    stop();
});
