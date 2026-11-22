// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('./app.js');

async function start(opts = {}) {
    const app = createApp(opts);
    await new Promise(r => app.server.listen(0, r));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const call = async (method, path, {token, body, raw} = {}) => {
        const res = await fetch(base + path, {
            method,
            headers: {
                ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if(raw) return {status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers};
        const text = await res.text();
        return {status: res.status, json: text ? JSON.parse(text) : null};
    };
    return {app, call, stop: () => app.close()};
}

// minimal valid-looking .fit: 14 byte header with ".FIT" at 8..11
const FIT = Buffer.concat([Buffer.from([14, 0x20, 0, 0, 0, 0, 0, 0]), Buffer.from('.FIT'), Buffer.alloc(10)]);

test('first sign-up becomes admin, then sign-up closes', async () => {
    const {call, stop} = await start();
    assert.deepEqual((await call('GET', '/api/setup')).json, {needsSetup: true, signup: true});

    const r = await call('POST', '/api/auth/register', {body: {username: 'DJ', password: 'correct horse', displayName: 'DJ'}});
    assert.equal(r.status, 201);
    assert.equal(r.json.user.role, 'admin');
    assert.equal(r.json.user.username, 'dj');

    const again = await call('POST', '/api/auth/register', {body: {username: 'ane', password: 'password123'}});
    assert.equal(again.status, 403);
    assert.deepEqual((await call('GET', '/api/setup')).json, {needsSetup: false, signup: false});
    stop();
});

test('open sign-up creates riders, not admins', async () => {
    const {call, stop} = await start({allowSignup: true});
    await call('POST', '/api/auth/register', {body: {username: 'admin', password: 'password123'}});
    const r = await call('POST', '/api/auth/register', {body: {username: 'rider', password: 'password123', role: 'admin'}});
    assert.equal(r.json.user.role, 'rider');
    stop();
});

test('login, wrong password, rate limit, logout', async () => {
    const {call, stop} = await start();
    await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}});

    assert.equal((await call('POST', '/api/auth/login', {body: {username: 'dj', password: 'nope'}})).status, 401);
    const ok = await call('POST', '/api/auth/login', {body: {username: 'DJ', password: 'password123'}});
    assert.equal(ok.status, 200);
    const token = ok.json.token;
    assert.equal((await call('GET', '/api/me', {token})).json.user.username, 'dj');

    for(let i = 0; i < 10; i++) await call('POST', '/api/auth/login', {body: {username: 'dj', password: 'bad'}});
    assert.equal((await call('POST', '/api/auth/login', {body: {username: 'dj', password: 'password123'}})).status, 429);

    assert.equal((await call('POST', '/api/auth/logout', {token, body: {}})).status, 200);
    assert.equal((await call('GET', '/api/me', {token})).status, 401);
    stop();
});

test('input validation', async () => {
    const {call, stop} = await start();
    assert.equal((await call('POST', '/api/auth/register', {body: {username: 'x', password: 'password123'}})).status, 400);
    assert.equal((await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'short'}})).status, 400);
    assert.equal((await call('POST', '/api/auth/register', {body: {username: '../etc', password: 'password123'}})).status, 400);
    assert.equal((await call('GET', '/api/me/profile')).status, 401);
    assert.equal((await call('GET', '/api/me', {token: 'not-a-real-token-but-long-enough'})).status, 401);
    stop();
});

test('admin manages users; riders cannot; last admin is protected', async () => {
    const {call, stop} = await start();
    const admin = (await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}})).json;
    const t = admin.token;

    const created = await call('POST', '/api/users', {token: t, body: {username: 'ane', password: 'password123', displayName: 'Ane'}});
    assert.equal(created.status, 201);
    assert.equal(created.json.user.role, 'rider');
    const aneId = created.json.user.id;
    assert.equal((await call('POST', '/api/users', {token: t, body: {username: 'ane', password: 'password123'}})).status, 409);

    const ane = (await call('POST', '/api/auth/login', {body: {username: 'ane', password: 'password123'}})).json.token;
    assert.equal((await call('GET', '/api/users', {token: ane})).status, 403);

    // reset password ends her sessions
    assert.equal((await call('PATCH', `/api/users/${aneId}`, {token: t, body: {password: 'newpassword1'}})).status, 200);
    assert.equal((await call('GET', '/api/me', {token: ane})).status, 401);

    // disable blocks sign-in
    await call('PATCH', `/api/users/${aneId}`, {token: t, body: {disabled: true}});
    assert.equal((await call('POST', '/api/auth/login', {body: {username: 'ane', password: 'newpassword1'}})).status, 403);

    // the only admin cannot demote, disable or delete itself away
    assert.equal((await call('PATCH', `/api/users/${admin.user.id}`, {token: t, body: {role: 'rider'}})).status, 409);
    assert.equal((await call('DELETE', `/api/users/${admin.user.id}`, {token: t})).status, 409);

    // promote ane, then the first admin may be demoted
    await call('PATCH', `/api/users/${aneId}`, {token: t, body: {disabled: false, role: 'admin'}});
    assert.equal((await call('PATCH', `/api/users/${admin.user.id}`, {token: t, body: {role: 'rider'}})).status, 200);

    const list = (await call('GET', '/api/users', {token: (await call('POST', '/api/auth/login', {body: {username: 'ane', password: 'newpassword1'}})).json.token})).json.users;
    assert.deepEqual(list.map(u => [u.username, u.role]), [['ane', 'admin'], ['dj', 'rider']]);
    stop();
});

test('change own password needs the current one', async () => {
    const {call, stop} = await start();
    const {token} = (await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}})).json;
    assert.equal((await call('PATCH', '/api/me', {token, body: {currentPassword: 'wrong', newPassword: 'another123'}})).status, 403);
    assert.equal((await call('PATCH', '/api/me', {token, body: {currentPassword: 'password123', newPassword: 'another123', displayName: 'Dj B'}})).json.user.displayName, 'Dj B');
    assert.equal((await call('POST', '/api/auth/login', {body: {username: 'dj', password: 'another123'}})).status, 200);
    stop();
});

test('profile, workouts and rides sync per user', async () => {
    const {call, stop} = await start({allowSignup: true});
    const a = (await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}})).json.token;
    const b = (await call('POST', '/api/auth/register', {body: {username: 'ane', password: 'password123'}})).json.token;

    await call('PUT', '/api/me/profile', {token: a, body: {data: {ftp: 265, weight: 72, wprime: 22000}}});
    assert.equal((await call('GET', '/api/me/profile', {token: a})).json.data.ftp, 265);
    assert.equal((await call('GET', '/api/me/profile', {token: b})).json.data, null);

    await call('PUT', '/api/me/workouts/w1', {token: a, body: {data: {meta: {name: 'Over-unders'}, intervals: []}}});
    const first = (await call('GET', '/api/me/workouts', {token: a})).json;
    assert.equal(first.workouts.length, 1);
    await call('DELETE', '/api/me/workouts/w1', {token: a});
    const delta = (await call('GET', `/api/me/workouts?since=${first.workouts[0].updatedAt - 1}`, {token: a})).json;
    assert.equal(delta.workouts[0].deleted, true);
    assert.equal((await call('GET', '/api/me/workouts', {token: b})).json.workouts.length, 0);

    const up = await call('POST', '/api/me/activities', {token: a, body: {id: 'r1', fit: FIT.toString('base64'),
        summary: {name: 'Sweet spot', timestamp: Date.UTC(2026, 10, 22), duration: 3600, stats: {tss: 72}}}});
    assert.equal(up.status, 201);
    assert.equal((await call('POST', '/api/me/activities', {token: a, body: {id: 'r2', fit: Buffer.from('nope nope nope').toString('base64')}})).status, 400);

    const rides = (await call('GET', '/api/me/activities', {token: a})).json.activities;
    assert.equal(rides.length, 1);
    assert.equal(rides[0].stats.tss, 72);
    const dl = await call('GET', '/api/me/activities/r1/fit', {token: a, raw: true});
    assert.equal(dl.status, 200);
    assert.ok(dl.buf.equals(FIT));
    assert.match(dl.headers.get('content-disposition'), /ride-2026-11-22\.fit/);
    assert.equal((await call('GET', '/api/me/activities/r1/fit', {token: b, raw: true})).status, 404);
    stop();
});

test('rejects non-JSON bodies and oversized requests', async () => {
    const {app, call, stop} = await start();
    const {token} = (await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}})).json;
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const res = await fetch(base + '/api/me/profile', {method: 'PUT', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain'}, body: 'x'});
    assert.equal(res.status, 415);
    const big = await call('PUT', '/api/me/profile', {token, body: {data: {x: 'a'.repeat(1_100_000)}}});
    assert.equal(big.status, 413);
    stop();
});
