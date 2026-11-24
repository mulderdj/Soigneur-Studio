// A ride's .fit from wherever the ride came from, kept after the first fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('./app.js');

const fit = (tag, n = 200) => { const b = Buffer.alloc(n, tag); b[0] = 14; b.write('.FIT', 8, 'ascii'); return b; };
function zipOne(name, data) {
    const body = zlib.deflateRawSync(data), n = Buffer.from(name), crc = zlib.crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
    const cd = Buffer.concat([central, n]);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + n.length + body.length, 16);
    return Buffer.concat([local, n, body, cd, end]);
}
const jwt = exp => { const b = o => Buffer.from(JSON.stringify(o)).toString('base64url'); return `${b({alg: 'none'})}.${b({exp})}.sig`; };

function fakes() {
    const log = [];
    const state = {garmin: {'111': zipOne('111_ACTIVITY.fit', fit(1))}, icu: {'i222': fit(2)}, strava: new Set(['i333']), forbidden: new Set()};
    const server = http.createServer(async (req, res) => {
        for await (const _ of req) { /* drain */ }
        const url = new URL(req.url, 'http://x');
        log.push(url.pathname);
        const send = (status, body, type = 'application/octet-stream') => { res.writeHead(status, {'Content-Type': type}); res.end(body); };
        let m;
        if(url.pathname === '/personalapitoken-service/personal-api/personal-api-key/token') return send(200, jwt(Math.floor(Date.now() / 1000) + 86400), 'text/plain');
        if((m = /^\/download-service\/files\/activity\/(\d+)$/.exec(url.pathname))) {
            if(state.forbidden.has(m[1])) return send(403, '{}', 'application/json');
            return state.garmin[m[1]] ? send(200, state.garmin[m[1]], 'application/x-zip-compressed') : send(404, '{}', 'application/json');
        }
        if((m = /^\/api\/v1\/activity\/(i\d+)\/fit-file$/.exec(url.pathname))) {
            if(state.strava.has(m[1])) return send(state.stravaStatus ?? 422, JSON.stringify({error: 'Strava activities not supported'}), 'application/json');
            return state.icu[m[1]] ? send(200, state.icu[m[1]]) : send(404, '{}', 'application/json');
        }
        if((m = /^\/api\/v1\/activity\/(i\d+)$/.exec(url.pathname))) {
            return send(200, JSON.stringify(state.strava.has(m[1]) ? {id: m[1], source: 'STRAVA', _note: 'stub'} : {id: m[1], source: 'GARMIN_CONNECT'}), 'application/json');
        }
        send(404, '{}', 'application/json');
    });
    return {server, log, state};
}

async function setup(appOptions = {}) {
    const fake = fakes();
    await new Promise(r => fake.server.listen(0, r));
    const base = `http://127.0.0.1:${fake.server.address().port}`;
    const app = createApp({garmin: {base, pauseMs: 0, maxWaitMs: 5}, intervals: {base, pauseMs: 0, maxWaitMs: 5}, connections: {intervalsBase: base}, ...appOptions});
    await new Promise(r => app.server.listen(0, r));
    const api = `http://127.0.0.1:${app.server.address().port}`;
    const call = async (method, path, {token, body} = {}) => {
        const res = await fetch(api + path, {method, headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: `Bearer ${token}`} : {})},
                                             body: body ? JSON.stringify(body) : undefined});
        const buf = Buffer.from(await res.arrayBuffer());
        return {status: res.status, type: res.headers.get('content-type'), buf, json: (() => { try { return JSON.parse(buf.toString()); } catch(e) { return null; } })()};
    };
    const {token} = (await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}})).json;
    const userId = (await call('GET', '/api/me', {token})).json.user.id;
    const connect = (service, data) => app.db.prepare('INSERT OR REPLACE INTO connections (user_id, service, data, auto_upload, updated_at) VALUES (?, ?, ?, 0, ?)')
        .run(userId, service, JSON.stringify(data), Date.now());
    const stop = () => { app.close(); fake.server.closeAllConnections(); fake.server.close(); };
    return {app, call, token, userId, connect, fake, stop};
}

test('a Soigneur ride: its stored .fit', async () => {
    const t = await setup();
    try {
        await t.call('POST', '/api/me/activities', {token: t.token, body: {id: 'ride-1', fit: fit(9).toString('base64'), summary: {name: 'Mine'}}});
        const r = await t.call('GET', '/api/me/rides/ride-1/file', {token: t.token});
        assert.equal(r.status, 200);
        assert.equal(r.type, 'application/vnd.ant.fit');
        assert.deepEqual(r.buf, fit(9));
    } finally { t.stop(); }
});

test('a Garmin ride: the .fit out of the ZIP, fetched once, then kept', async () => {
    const t = await setup();
    try {
        t.connect('garmin', {apiKey: 'gpk_x', expiresOn: '2027-01-01'});
        const r = await t.call('GET', '/api/me/rides/garmin-111/file', {token: t.token});
        assert.equal(r.status, 200);
        assert.deepEqual(r.buf, fit(1));
        const again = await t.call('GET', '/api/me/rides/garmin-111/file', {token: t.token});
        assert.deepEqual(again.buf, fit(1));
        assert.equal(t.fake.log.filter(p => p.startsWith('/download-service')).length, 1);
    } finally { t.stop(); }
});

test('an intervals.icu ride: its .fit; one from Strava says so', async () => {
    const t = await setup();
    try {
        t.connect('intervals', {apiKey: 'icu_x'});
        const r = await t.call('GET', '/api/me/rides/icu-i222/file', {token: t.token});
        assert.equal(r.status, 200);
        assert.deepEqual(r.buf, fit(2));
        const s = await t.call('GET', '/api/me/rides/icu-i333/file', {token: t.token});
        assert.equal(s.status, 404);
        assert.equal(s.json.reason, 'strava');
    } finally { t.stop(); }
});

test('a Strava ride is recognised whatever intervals.icu answers to the download (404, 403, 422)', async () => {
    for(const status of [404, 403, 422]) {
        const t = await setup();
        try {
            t.connect('intervals', {apiKey: 'icu_x'});
            t.fake.state.stravaStatus = status;
            const s = await t.call('GET', '/api/me/rides/icu-i333/file', {token: t.token});
            assert.equal(s.json.reason, 'strava', `status ${status}`);
            assert.ok(t.app.db.prepare("SELECT 1 FROM connections WHERE service = 'intervals'").get(), 'the connection stays');
        } finally { t.stop(); }
    }
});

test('reasons: not connected, refused, not found, unreadable', async () => {
    const t = await setup();
    try {
        assert.equal((await t.call('GET', '/api/me/rides/garmin-111/file', {token: t.token})).json.reason, 'not-connected');
        assert.equal((await t.call('GET', '/api/me/rides/icu-i222/file', {token: t.token})).json.reason, 'not-connected');
        t.connect('garmin', {apiKey: 'gpk_x'});
        t.fake.state.forbidden.add('111');
        const refused = await t.call('GET', '/api/me/rides/garmin-111/file', {token: t.token});
        assert.equal(refused.json.reason, 'refused');
        assert.equal(refused.status, 502);
        assert.equal((await t.call('GET', '/api/me/rides/garmin-999/file', {token: t.token})).json.reason, 'not-found');
        assert.equal((await t.call('GET', '/api/me/rides/no-such-ride/file', {token: t.token})).json.reason, 'not-found');
        t.fake.state.garmin['444'] = Buffer.from('not a zip');
        assert.equal((await t.call('GET', '/api/me/rides/garmin-444/file', {token: t.token})).json.reason, 'unreadable');
        assert.equal((await t.call('GET', '/api/me/rides/garmin-111/file')).status, 401);
    } finally { t.stop(); }
});

test('kept files: the oldest go past the cap; disconnecting a source forgets its files', async () => {
    const t = await setup({rideFiles: {capBytes: 450}});
    try {
        t.connect('garmin', {apiKey: 'gpk_x'});
        t.connect('intervals', {apiKey: 'icu_x'});
        t.fake.state.garmin['112'] = zipOne('112_ACTIVITY.fit', fit(3));
        t.fake.state.garmin['113'] = zipOne('113_ACTIVITY.fit', fit(4));
        for(const id of ['garmin-111', 'garmin-112', 'garmin-113']) await t.call('GET', `/api/me/rides/${id}/file`, {token: t.token});
        const kept = () => t.app.db.prepare('SELECT id FROM ride_files ORDER BY id').all().map(r => r.id);
        assert.deepEqual(kept(), ['garmin-112', 'garmin-113']);       // 3 × 200 bytes > 450: the oldest went
        await t.call('GET', '/api/me/rides/icu-i222/file', {token: t.token});
        await t.call('DELETE', '/api/me/connections/garmin', {token: t.token});
        assert.deepEqual(kept(), ['icu-i222']);
        await t.call('DELETE', '/api/me/connections/intervals', {token: t.token});
        assert.deepEqual(kept(), []);
    } finally { t.stop(); }
});
