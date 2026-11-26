// node --test server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('./app.js');

async function start(t) {
    const app = createApp();
    await new Promise(r => app.server.listen(0, r));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const call = async (method, path, {token, body} = {}) => {
        const res = await fetch(base + path, {
            method,
            headers: {
                ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        return {status: res.status, json: text ? JSON.parse(text) : null};
    };
    const {json} = await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}});
    t.after(() => app.close());
    return {app, call, session: json.token, stop: () => {}};
}

test('create, list and revoke; the token is shown once and stored hashed', async t => {
    const {app, call, session, stop} = await start(t);
    const r = await call('POST', '/api/me/tokens', {token: session, body: {name: 'Claude Code on my PC', scope: 'read'}});
    assert.equal(r.status, 201);
    assert.match(r.json.token, /^sst_[A-Za-z0-9_-]{43}$/);
    assert.equal(r.json.access.scope, 'read');
    const stored = app.db.prepare('SELECT token_hash FROM access_tokens').all();
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0].token_hash, r.json.token);

    const list = await call('GET', '/api/me/tokens', {token: session});
    assert.deepEqual(list.json.tokens.map(t => [t.name, t.scope, 'token' in t]), [['Claude Code on my PC', 'read', false]]);

    assert.equal((await call('GET', '/api/me/profile', {token: r.json.token})).status, 200);
    assert.equal((await call('DELETE', `/api/me/tokens/${r.json.access.id}`, {token: session})).status, 200);
    assert.equal((await call('GET', '/api/me/profile', {token: r.json.token})).status, 401);
    stop();
});

test('a read token reads, but cannot write, sign out or manage', async t => {
    const {call, session, stop} = await start(t);
    const {json} = await call('POST', '/api/me/tokens', {token: session, body: {name: 'read', scope: 'read'}});
    const tok = json.token;
    for(const p of ['/api/me', '/api/me/plan', '/api/me/activities', '/api/me/workouts', '/api/me/wellness']) {
        assert.equal((await call('GET', p, {token: tok})).status, 200, p);
    }
    const plan = await call('PUT', '/api/me/plan/p1', {token: tok, body: {data: {day: '2026-12-01'}}});
    assert.equal(plan.status, 403);
    assert.match(plan.json.error, /only read/);
    assert.equal((await call('GET', '/api/me/tokens', {token: tok})).status, 403);
    assert.equal((await call('POST', '/api/me/tokens', {token: tok, body: {name: 'x', scope: 'plan'}})).status, 403);
    assert.equal((await call('PATCH', '/api/me', {token: tok, body: {displayName: 'x'}})).status, 403);
    assert.equal((await call('GET', '/api/me/connections', {token: tok})).status, 403);
    assert.equal((await call('DELETE', '/api/me/activities/a1', {token: tok})).status, 403);
    assert.equal((await call('POST', '/api/auth/logout', {token: tok, body: {}})).status, 403);
    assert.equal((await call('GET', '/api/users', {token: tok})).status, 403);
    stop();
});

test('a plan token also changes the plan, nothing else', async t => {
    const {call, session, stop} = await start(t);
    const {json} = await call('POST', '/api/me/tokens', {token: session, body: {name: 'plan', scope: 'plan'}});
    const tok = json.token;
    assert.equal((await call('PUT', '/api/me/plan/p1', {token: tok, body: {data: {day: '2026-12-01'}}})).status, 200);
    assert.equal((await call('DELETE', '/api/me/plan/p1', {token: tok})).status, 200);
    const w = await call('PUT', '/api/me/workouts/w1', {token: tok, body: {data: {}}});
    assert.equal(w.status, 403);
    assert.match(w.json.error, /only read your training and change your plan/);
    stop();
});

test('names, scopes and the limit are checked; tokens are per rider', async t => {
    const {call, session, stop} = await start(t);
    assert.equal((await call('POST', '/api/me/tokens', {token: session, body: {name: ' ', scope: 'read'}})).status, 400);
    assert.equal((await call('POST', '/api/me/tokens', {token: session, body: {name: 'x', scope: 'admin'}})).status, 400);
    for(let i = 0; i < 20; i++) await call('POST', '/api/me/tokens', {token: session, body: {name: `t${i}`, scope: 'read'}});
    assert.equal((await call('POST', '/api/me/tokens', {token: session, body: {name: 'one more', scope: 'read'}})).status, 409);

    const other = await call('POST', '/api/users', {token: session, body: {username: 'ane', password: 'password123'}});
    const ane = (await call('POST', '/api/auth/login', {body: {username: 'ane', password: 'password123'}})).json.token;
    const mine = (await call('GET', '/api/me/tokens', {token: session})).json.tokens[0];
    await call('DELETE', `/api/me/tokens/${mine.id}`, {token: ane});            // not hers: no effect
    assert.equal((await call('GET', '/api/me/tokens', {token: session})).json.tokens.length, 20);
    assert.equal(other.status, 201);
    stop();
});

test('a disabled rider loses AI access too; last use is recorded', async t => {
    const {app, call, session, stop} = await start(t);
    await call('POST', '/api/users', {token: session, body: {username: 'ane', password: 'password123'}});
    const ane = (await call('POST', '/api/auth/login', {body: {username: 'ane', password: 'password123'}})).json.token;
    const {json} = await call('POST', '/api/me/tokens', {token: ane, body: {name: 'x', scope: 'read'}});
    assert.equal((await call('GET', '/api/me', {token: json.token})).status, 200);
    assert.ok((await call('GET', '/api/me/tokens', {token: ane})).json.tokens[0].lastUsedAt > 0);
    const id = app.db.prepare("SELECT id FROM users WHERE username = 'ane'").get().id;
    await call('PATCH', `/api/users/${id}`, {token: session, body: {disabled: true}});
    assert.equal((await call('GET', '/api/me', {token: json.token})).status, 401);
    stop();
});
