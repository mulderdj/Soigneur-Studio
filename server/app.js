//
// Soigneur Studio account server
//
// Accounts, roles and sync for profiles, workouts and rides. No dependencies:
// node:http + node:sqlite (Node 22.13+) + node:crypto.
//
// All routes live under /api and are served from the same origin as the app
// (Caddy or the Parcel dev server proxies /api here), so no CORS is needed.
//

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createConnections } = require('./connections.js');
const { createIntervalsSync } = require('./intervals-sync.js');
const { createGarminSync } = require('./garmin-sync.js');

const SESSION_DAYS = 90;
const MAX_JSON_BYTES = 1 * 1024 * 1024;       // profile, workouts, user edits
const MAX_RIDE_BYTES = 25 * 1024 * 1024;      // a ride upload (base64 .fit + summary)
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i;
// letters, digits, - and _; or a hex id in curly braces, as older apps made
// on pages that weren't secure
const ID_RE = /^(?:[A-Za-z0-9_-]{1,64}|\{[0-9A-Fa-f-]{1,62}\})$/;

// --- helpers ---------------------------------------------------------------

function now() { return Date.now(); }

function newId() { return crypto.randomUUID(); }

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64, {N: 16384, r: 8, p: 1});
    return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
    try {
        const [kind, N, r, p, saltB64, hashB64] = String(stored).split('$');
        if(kind !== 'scrypt') return false;
        const expected = Buffer.from(hashB64, 'base64');
        const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length,
                                         {N: +N, r: +r, p: +p});
        return crypto.timingSafeEqual(expected, actual);
    } catch(e) {
        return false;
    }
}

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function fail(status, message) { throw new HttpError(status, message); }

function validPassword(pw) {
    if(typeof pw !== 'string' || pw.length < 8) fail(400, 'Password must be at least 8 characters.');
    if(pw.length > 200) fail(400, 'Password is too long.');
    return pw;
}

function validUsername(name) {
    if(typeof name !== 'string' || !USERNAME_RE.test(name)) {
        fail(400, 'Username: 2 to 32 letters, digits, dots, dashes or underscores.');
    }
    return name.toLowerCase();
}

function validDisplayName(name, fallback) {
    if(name === undefined || name === null || name === '') return fallback;
    if(typeof name !== 'string' || name.length > 64) fail(400, 'Display name: at most 64 characters.');
    return name.trim() || fallback;
}

function validId(id) {
    if(typeof id !== 'string' || !ID_RE.test(id)) fail(400, 'Invalid id.');
    return id;
}

function publicUser(u) {
    return {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        role: u.role,
        disabled: !!u.disabled,
        createdAt: u.created_at,
    };
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        let size = 0;
        let tooLarge = false;
        const chunks = [];
        req.on('data', chunk => {
            size += chunk.length;
            if(size > limit) {
                // keep draining so the client gets a clean 413, not a reset
                tooLarge = true;
                chunks.length = 0;
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if(tooLarge) return reject(new HttpError(413, 'Request too large.'));
            if(size === 0) return resolve({});
            try {
                const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if(value === null || typeof value !== 'object' || Array.isArray(value)) {
                    return reject(new HttpError(400, 'Expected a JSON object.'));
                }
                resolve(value);
            } catch(e) {
                reject(new HttpError(400, 'Invalid JSON.'));
            }
        });
        req.on('error', reject);
    });
}

function send(res, status, body, headers = {}) {
    const isBuffer = Buffer.isBuffer(body);
    const payload = isBuffer ? body : (body === undefined ? '' : JSON.stringify(body));
    res.writeHead(status, {
        'Content-Type': isBuffer ? 'application/octet-stream' : 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
    });
    res.end(payload);
}

// --- database --------------------------------------------------------------

function openDatabase(path) {
    const db = new DatabaseSync(path);
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT PRIMARY KEY,
            username      TEXT NOT NULL UNIQUE,
            display_name  TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL CHECK (role IN ('admin', 'rider')),
            disabled      INTEGER NOT NULL DEFAULT 0,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash   TEXT PRIMARY KEY,
            user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at   INTEGER NOT NULL,
            expires_at   INTEGER NOT NULL,
            user_agent   TEXT
        );
        CREATE TABLE IF NOT EXISTS profiles (
            user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            data       TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workouts (
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id         TEXT NOT NULL,
            data       TEXT NOT NULL,
            deleted    INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS ride_ratings (
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            ride_id    TEXT NOT NULL,
            rpe        INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, ride_id)
        );
        CREATE TABLE IF NOT EXISTS hidden_rides (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            ride_id TEXT NOT NULL,
            PRIMARY KEY (user_id, ride_id)
        );
        CREATE TABLE IF NOT EXISTS plan (
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id         TEXT NOT NULL,
            data       TEXT NOT NULL,
            deleted    INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS activities (
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id         TEXT NOT NULL,
            summary    TEXT NOT NULL,
            fit        BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        );
    `);
    return db;
}

// --- app -------------------------------------------------------------------

function createApp(options = {}) {
    const db = openDatabase(options.dbPath ?? ':memory:');
    const allowSignup = !!options.allowSignup;
    const loginFails = new Map(); // key -> {count, since}
    const connections = createConnections({db, fail, options: options.connections});
    const intervalsSync = createIntervalsSync({db, options: options.intervals});
    connections.setIntervalsStatus(userId => intervalsSync.status(userId));
    const garminSync = createGarminSync({db, options: options.garmin});
    connections.setGarminStatus(userId => garminSync.status(userId));

    const q = {
        userCount:     db.prepare('SELECT COUNT(*) AS n FROM users'),
        adminCount:    db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0"),
        userByName:    db.prepare('SELECT * FROM users WHERE username = ?'),
        userById:      db.prepare('SELECT * FROM users WHERE id = ?'),
        users:         db.prepare('SELECT * FROM users ORDER BY username'),
        insertUser:    db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at, updated_at)
                                   VALUES (?, ?, ?, ?, ?, 0, ?, ?)`),
        deleteUser:    db.prepare('DELETE FROM users WHERE id = ?'),
        insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'),
        session:       db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
        deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
        deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
        deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
        purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
        profile:       db.prepare('SELECT data, updated_at FROM profiles WHERE user_id = ?'),
        upsertProfile: db.prepare(`INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?)
                                   ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
        workouts:      db.prepare('SELECT id, data, deleted, updated_at FROM workouts WHERE user_id = ? AND updated_at > ? ORDER BY updated_at'),
        upsertWorkout: db.prepare(`INSERT INTO workouts (user_id, id, data, deleted, updated_at) VALUES (?, ?, ?, 0, ?)
                                   ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, deleted = 0, updated_at = excluded.updated_at`),
        deleteWorkout: db.prepare(`UPDATE workouts SET deleted = 1, data = '{}', updated_at = ? WHERE user_id = ? AND id = ?`),
        activities:    db.prepare('SELECT id, summary, created_at, length(fit) AS bytes FROM activities WHERE user_id = ? ORDER BY created_at DESC'),
        activity:      db.prepare('SELECT summary, fit FROM activities WHERE user_id = ? AND id = ?'),
        activitySummary: db.prepare('SELECT summary FROM activities WHERE user_id = ? AND id = ?'),
        updateActivitySummary: db.prepare('UPDATE activities SET summary = ? WHERE user_id = ? AND id = ?'),
        plan:          db.prepare('SELECT id, data, deleted, updated_at FROM plan WHERE user_id = ? AND updated_at > ? ORDER BY updated_at'),
        upsertPlan:    db.prepare(`INSERT INTO plan (user_id, id, data, deleted, updated_at) VALUES (?, ?, ?, 0, ?)
                                   ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data, deleted = 0, updated_at = excluded.updated_at`),
        // a deleted entry keeps its intervals.icu link until the sync has deleted the event
        deletePlan:    db.prepare(`UPDATE plan SET deleted = 1, updated_at = ?,
                                   data = CASE WHEN json_extract(data, '$.intervalsEventId') IS NULL THEN '{}'
                                          ELSE json_object('day', json_extract(data, '$.day'),
                                                           'intervalsEventId', json_extract(data, '$.intervalsEventId'),
                                                           'intervalsUpdated', json_extract(data, '$.intervalsUpdated')) END
                                   WHERE user_id = ? AND id = ?`),
        planData:      db.prepare('SELECT data, deleted FROM plan WHERE user_id = ? AND id = ?'),
        hiddenRides:   db.prepare('SELECT ride_id FROM hidden_rides WHERE user_id = ? ORDER BY ride_id'),
        ratings:       db.prepare('SELECT ride_id, rpe FROM ride_ratings WHERE user_id = ? ORDER BY ride_id'),
        rate:          db.prepare(`INSERT INTO ride_ratings (user_id, ride_id, rpe, updated_at) VALUES (?, ?, ?, ?)
                                   ON CONFLICT (user_id, ride_id) DO UPDATE SET rpe = excluded.rpe, updated_at = excluded.updated_at`),
        unrate:        db.prepare('DELETE FROM ride_ratings WHERE user_id = ? AND ride_id = ?'),
        hideRide:      db.prepare('INSERT OR IGNORE INTO hidden_rides (user_id, ride_id) VALUES (?, ?)'),
        showRide:      db.prepare('DELETE FROM hidden_rides WHERE user_id = ? AND ride_id = ?'),
        insertActivity: db.prepare(`INSERT INTO activities (user_id, id, summary, fit, created_at) VALUES (?, ?, ?, ?, ?)
                                    ON CONFLICT(user_id, id) DO NOTHING`),
        deleteActivity: db.prepare('DELETE FROM activities WHERE user_id = ? AND id = ?'),
    };

    function setupNeeded() {
        return q.userCount.get().n === 0;
    }

    function createUser({username, password, displayName, role}) {
        const name = validUsername(username);
        validPassword(password);
        if(q.userByName.get(name)) fail(409, 'That username is taken.');
        const t = now();
        const id = newId();
        q.insertUser.run(id, name, validDisplayName(displayName, name), hashPassword(password),
                         role === 'admin' ? 'admin' : 'rider', t, t);
        return q.userById.get(id);
    }

    function issueSession(user, req) {
        const token = crypto.randomBytes(32).toString('base64url');
        const t = now();
        q.insertSession.run(sha256(token), user.id, t, t + SESSION_DAYS * 864e5,
                            String(req.headers['user-agent'] ?? '').slice(0, 200));
        return token;
    }

    function authenticate(req) {
        const header = String(req.headers.authorization ?? '');
        const m = header.match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
        if(!m) fail(401, 'Sign in required.');
        const s = q.session.get(sha256(m[1]));
        if(!s || s.expires_at < now()) fail(401, 'Your session has ended. Sign in again.');
        const user = q.userById.get(s.user_id);
        if(!user || user.disabled) fail(401, 'This account is disabled.');
        return {user, tokenHash: s.token_hash};
    }

    function requireAdmin(user) {
        if(user.role !== 'admin') fail(403, 'Only an admin can do that.');
    }

    function clientKey(req, username) {
        const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
        return `${ip}|${String(username).toLowerCase()}`;
    }

    function checkLoginRate(key) {
        const entry = loginFails.get(key);
        if(!entry) return;
        if(now() - entry.since > LOGIN_WINDOW_MS) { loginFails.delete(key); return; }
        if(entry.count >= LOGIN_MAX_FAILS) fail(429, 'Too many failed sign-ins. Wait 10 minutes and try again.');
    }

    function noteLoginFail(key) {
        const entry = loginFails.get(key);
        if(!entry || now() - entry.since > LOGIN_WINDOW_MS) loginFails.set(key, {count: 1, since: now()});
        else entry.count += 1;
    }

    // keeps at least one enabled admin
    function guardLastAdmin(target, change) {
        if(target.role !== 'admin' || target.disabled) return;
        const losesAdmin = change.delete || change.disabled === true || (change.role && change.role !== 'admin');
        if(losesAdmin && q.adminCount.get().n <= 1) fail(409, 'Keep at least one admin.');
    }

    // routes: [method, regex, handler(ctx)]
    const routes = [];
    const route = (method, path, handler, opts = {}) => {
        const re = new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
        routes.push({method, re, handler, opts});
    };

    route('GET', '/api/health', () => ({ok: true}));

    route('GET', '/api/setup', () => ({needsSetup: setupNeeded(), signup: allowSignup || setupNeeded()}));

    // first user becomes admin; later self sign-up only when ALLOW_SIGNUP is on
    route('POST', '/api/auth/register', ({body, req}) => {
        const first = setupNeeded();
        if(!first && !allowSignup) fail(403, 'Sign-up is closed. Ask an admin to create your account.');
        const user = createUser({...body, role: first ? 'admin' : 'rider'});
        return {status: 201, body: {token: issueSession(user, req), user: publicUser(user)}};
    });

    route('POST', '/api/auth/login', ({body, req}) => {
        const key = clientKey(req, body.username);
        checkLoginRate(key);
        const user = typeof body.username === 'string' ? q.userByName.get(body.username.toLowerCase()) : undefined;
        const ok = user && verifyPassword(String(body.password ?? ''), user.password_hash);
        if(!ok) {
            noteLoginFail(key);
            fail(401, 'Wrong username or password.');
        }
        if(user.disabled) fail(403, 'This account is disabled.');
        loginFails.delete(key);
        q.purgeSessions.run(now());
        return {token: issueSession(user, req), user: publicUser(user)};
    });

    route('POST', '/api/auth/logout', ({auth}) => {
        q.deleteSession.run(auth.tokenHash);
        return {ok: true};
    }, {auth: true});

    route('GET', '/api/me', ({auth}) => ({user: publicUser(auth.user)}), {auth: true});

    route('PATCH', '/api/me', ({auth, body}) => {
        const u = auth.user;
        const displayName = validDisplayName(body.displayName, u.display_name);
        let hash = u.password_hash;
        if(body.newPassword !== undefined) {
            if(!verifyPassword(String(body.currentPassword ?? ''), u.password_hash)) fail(403, 'Current password is wrong.');
            hash = hashPassword(validPassword(body.newPassword));
            q.deleteOtherSessions.run(u.id, auth.tokenHash);
        }
        db.prepare('UPDATE users SET display_name = ?, password_hash = ?, updated_at = ? WHERE id = ?')
          .run(displayName, hash, now(), u.id);
        return {user: publicUser(q.userById.get(u.id))};
    }, {auth: true});

    // profile: FTP, weight, W', settings. Last write wins.
    route('GET', '/api/me/profile', ({auth}) => {
        const row = q.profile.get(auth.user.id);
        return row ? {data: JSON.parse(row.data), updatedAt: row.updated_at} : {data: null, updatedAt: 0};
    }, {auth: true});

    route('PUT', '/api/me/profile', ({auth, body}) => {
        if(typeof body.data !== 'object' || body.data === null || Array.isArray(body.data)) fail(400, 'Expected {data: {...}}.');
        const t = now();
        q.upsertProfile.run(auth.user.id, JSON.stringify(body.data), t);
        return {updatedAt: t};
    }, {auth: true});

    // workouts: incremental sync with ?since=<updatedAt>
    route('GET', '/api/me/workouts', ({auth, url}) => {
        const since = Number(url.searchParams.get('since') ?? 0) || 0;
        const rows = q.workouts.all(auth.user.id, since);
        return {
            workouts: rows.map(r => ({id: r.id, deleted: !!r.deleted, updatedAt: r.updated_at,
                                      data: r.deleted ? null : JSON.parse(r.data)})),
            now: now(),
        };
    }, {auth: true});

    route('PUT', '/api/me/workouts/:id', ({auth, body, params}) => {
        const id = validId(params.id);
        if(typeof body.data !== 'object' || body.data === null) fail(400, 'Expected {data: {...}}.');
        const t = now();
        q.upsertWorkout.run(auth.user.id, id, JSON.stringify(body.data), t);
        return {updatedAt: t};
    }, {auth: true});

    route('DELETE', '/api/me/workouts/:id', ({auth, params}) => {
        q.deleteWorkout.run(now(), auth.user.id, validId(params.id));
        return {ok: true};
    }, {auth: true});

    // training plan: incremental sync with ?since=<updatedAt>, like workouts
    route('GET', '/api/me/plan', ({auth, url}) => {
        const since = Number(url.searchParams.get('since') ?? 0) || 0;
        const rows = q.plan.all(auth.user.id, since);
        return {
            entries: rows.map(r => ({id: r.id, deleted: !!r.deleted, updatedAt: r.updated_at,
                                     data: r.deleted ? null : JSON.parse(r.data)})),
            now: now(),
        };
    }, {auth: true});

    route('PUT', '/api/me/plan/:id', ({auth, body, params}) => {
        const id = validId(params.id);
        if(typeof body.data !== 'object' || body.data === null) fail(400, 'Expected {data: {...}}.');
        // keep the intervals.icu link when the app sends the entry without it
        const data = {...body.data};
        const prev = q.planData.get(auth.user.id, id);
        if(prev && !prev.deleted) {
            const old = JSON.parse(prev.data);
            for(const k of ['intervalsEventId', 'intervalsUpdated', 'intervalsSyncedAt', 'origin']) {
                if(!(k in data) && k in old) data[k] = old[k];
            }
        }
        const t = now();
        q.upsertPlan.run(auth.user.id, id, JSON.stringify(data), t);
        return {updatedAt: t};
    }, {auth: true});

    route('DELETE', '/api/me/plan/:id', ({auth, params}) => {
        q.deletePlan.run(now(), auth.user.id, validId(params.id));
        return {ok: true};
    }, {auth: true});

    // how hard a workout felt (1–10): its load when it has no power or heart rate
    route('GET', '/api/me/ride-ratings', ({auth}) =>
        ({ratings: Object.fromEntries(q.ratings.all(auth.user.id).map(r => [r.ride_id, r.rpe]))}), {auth: true});

    route('PUT', '/api/me/ride-ratings/:id', ({auth, body, params}) => {
        const id = validId(params.id);
        if(!Number.isInteger(body?.rpe) || body.rpe < 1 || body.rpe > 10) fail(400, 'Expected {rpe: 1 to 10}.');
        q.rate.run(auth.user.id, id, body.rpe, now());
        return {ok: true};
    }, {auth: true});

    route('DELETE', '/api/me/ride-ratings/:id', ({auth, params}) => {
        q.unrate.run(auth.user.id, validId(params.id));
        return {ok: true};
    }, {auth: true});

    // rides the rider hid on the Training page (duplicates the matching missed)
    route('GET', '/api/me/hidden-rides', ({auth}) =>
        ({ids: q.hiddenRides.all(auth.user.id).map(r => r.ride_id)}), {auth: true});

    route('PUT', '/api/me/hidden-rides/:id', ({auth, params}) => {
        q.hideRide.run(auth.user.id, validId(params.id));
        return {ok: true};
    }, {auth: true});

    route('DELETE', '/api/me/hidden-rides/:id', ({auth, params}) => {
        q.showRide.run(auth.user.id, validId(params.id));
        return {ok: true};
    }, {auth: true});

    // a ride summary for the Training page, added to a ride saved earlier
    route('PATCH', '/api/me/activities/:id/summary', ({auth, body, params}) => {
        const id = validId(params.id);
        if(typeof body.training !== 'object' || body.training === null || Array.isArray(body.training)) {
            fail(400, 'Expected {training: {...}}.');
        }
        const row = q.activitySummary.get(auth.user.id, id);
        if(!row) fail(404, 'Ride not found.');
        const summary = {...JSON.parse(row.summary), training: body.training};
        q.updateActivitySummary.run(JSON.stringify(summary), auth.user.id, id);
        return {ok: true};
    }, {auth: true});

    // rides: .fit file + summary, kept forever (not limited to 7)
    route('GET', '/api/me/activities', ({auth}) => ({
        activities: q.activities.all(auth.user.id).map(r => ({
            ...JSON.parse(r.summary), id: r.id, createdAt: r.created_at, bytes: r.bytes,
            uploads: connections.uploadsFor(auth.user.id, r.id),
        })),
    }), {auth: true});

    route('POST', '/api/me/activities', ({auth, body}) => {
        const id = validId(String(body.id ?? ''));
        if(typeof body.fit !== 'string' || body.fit.length === 0) fail(400, 'Missing .fit data.');
        const fit = Buffer.from(body.fit, 'base64');
        if(fit.length < 14 || fit.toString('ascii', 8, 12) !== '.FIT') fail(400, 'That is not a .fit file.');
        const summary = typeof body.summary === 'object' && body.summary !== null ? body.summary : {};
        const keep = {
            name: String(summary.name ?? 'Ride').slice(0, 200),
            timestamp: Number(summary.timestamp) || now(),
            duration: Number(summary.duration) || 0,
            stats: typeof summary.stats === 'object' && summary.stats !== null ? summary.stats : undefined,
        };
        const inserted = q.insertActivity.run(auth.user.id, id, JSON.stringify(keep), fit, now());
        if(inserted.changes > 0) connections.onRideSaved(auth.user.id, id);
        return {status: 201, body: {id}};
    }, {auth: true, limit: MAX_RIDE_BYTES});

    route('GET', '/api/me/activities/:id/fit', ({auth, params}) => {
        const row = q.activity.get(auth.user.id, validId(params.id));
        if(!row) fail(404, 'Ride not found.');
        const s = JSON.parse(row.summary);
        const day = new Date(s.timestamp).toISOString().slice(0, 10);
        return {raw: Buffer.from(row.fit), headers: {
            'Content-Disposition': `attachment; filename="ride-${day}.fit"`,
        }};
    }, {auth: true});

    route('DELETE', '/api/me/activities/:id', ({auth, params}) => {
        q.deleteActivity.run(auth.user.id, validId(params.id));
        return {ok: true};
    }, {auth: true});

    garminSync.routes(route, {fail, validId}); // before the generic /api/me/connections/:service routes
    connections.routes(route, {validId});
    intervalsSync.routes(route, {fail, validId});

    // --- user management (admin) ---

    route('GET', '/api/users', ({auth}) => {
        requireAdmin(auth.user);
        return {users: q.users.all().map(publicUser), signup: allowSignup};
    }, {auth: true});

    route('POST', '/api/users', ({auth, body}) => {
        requireAdmin(auth.user);
        const user = createUser({...body, role: body.role === 'admin' ? 'admin' : 'rider'});
        return {status: 201, body: {user: publicUser(user)}};
    }, {auth: true});

    route('PATCH', '/api/users/:id', ({auth, body, params}) => {
        requireAdmin(auth.user);
        const target = q.userById.get(params.id);
        if(!target) fail(404, 'User not found.');
        const change = {
            role: body.role === undefined ? undefined : (body.role === 'admin' ? 'admin' : 'rider'),
            disabled: body.disabled === undefined ? undefined : !!body.disabled,
        };
        guardLastAdmin(target, change);
        const role = change.role ?? target.role;
        const disabled = change.disabled === undefined ? target.disabled : (change.disabled ? 1 : 0);
        const displayName = validDisplayName(body.displayName, target.display_name);
        let hash = target.password_hash;
        if(body.password !== undefined) {
            hash = hashPassword(validPassword(body.password));
        }
        db.prepare('UPDATE users SET role = ?, disabled = ?, display_name = ?, password_hash = ?, updated_at = ? WHERE id = ?')
          .run(role, disabled, displayName, hash, now(), target.id);
        if(body.password !== undefined || disabled) q.deleteUserSessions.run(target.id);
        return {user: publicUser(q.userById.get(target.id))};
    }, {auth: true});

    route('DELETE', '/api/users/:id', ({auth, params}) => {
        requireAdmin(auth.user);
        const target = q.userById.get(params.id);
        if(!target) fail(404, 'User not found.');
        if(target.id === auth.user.id) fail(409, 'You cannot delete your own account here.');
        guardLastAdmin(target, {delete: true});
        q.deleteUser.run(target.id);
        return {ok: true};
    }, {auth: true});

    async function handle(req, res) {
        try {
            const url = new URL(req.url, 'http://localhost');
            const matches = routes.filter(r => r.re.test(url.pathname));
            if(matches.length === 0) fail(404, 'Not found.');
            const r = matches.find(r => r.method === req.method);
            if(!r) fail(405, 'Method not allowed.');
            const params = url.pathname.match(r.re).groups ?? {};
            for(const k in params) params[k] = decodeURIComponent(params[k]);

            const hasBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
            if(hasBody && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
                fail(415, 'Send JSON.');
            }
            const body = hasBody ? await readBody(req, r.opts.limit ?? MAX_JSON_BYTES) : {};
            const auth = r.opts.auth ? authenticate(req) : undefined;

            const out = await r.handler({req, url, params, body, auth});
            if(out && out.raw) return send(res, 200, out.raw, out.headers);
            if(out && out.redirect) {
                res.writeHead(302, {Location: out.redirect, 'Cache-Control': 'no-store'});
                return res.end();
            }
            if(out && out.status) return send(res, out.status, out.body);
            return send(res, 200, out);
        } catch(e) {
            if(e instanceof HttpError) return send(res, e.status, {error: e.message});
            console.error(e);
            return send(res, 500, {error: 'Server error.'});
        }
    }

    const server = http.createServer(handle);

    return {
        server, db, connections, intervalsSync, garminSync,
        close: () => { connections.close(); intervalsSync.close(); garminSync.close(); server.closeAllConnections(); server.close(); db.close(); },
    };
}

module.exports = { createApp, hashPassword, verifyPassword };
