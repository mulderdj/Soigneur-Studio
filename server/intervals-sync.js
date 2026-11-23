'use strict';

//
// intervals.icu sync, per account with intervals.icu connected:
//   activities → external_rides (ride summaries for the Training page)
//   planned workouts ↔ the plan table (both ways; added in plan sync below)
//
// Runs on a timer (start()), on request, and never twice at once for the
// same account. Requests are paced and wait on rate limits; a revoked API
// key removes the connection, the way uploads do.
//

const { isStub, toSummary, sportOf } = require('./intervals.js');

const DAY_MS = 86400000;
const FIRST_DAYS = 730;
const OVERLAP_DAYS = 7;
const MAX_RATE_LIMITS = 3;

class SyncError extends Error {
    constructor(message, {revoked = false} = {}) {
        super(message);
        this.revoked = revoked;
    }
}

function isoDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

function createIntervalsSync({db, options = {}}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const base = (options.base ?? 'https://intervals.icu').replace(/\/+$/, '');
    const pauseMs = options.pauseMs ?? 200;
    const maxWaitMs = options.maxWaitMs ?? 5 * 60 * 1000;
    const syncEveryMs = options.syncEveryMs ?? 15 * 60 * 1000;
    const now = options.now ?? (() => Date.now());

    db.exec(`
        CREATE TABLE IF NOT EXISTS external_rides (
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id         TEXT NOT NULL,
            summary    TEXT NOT NULL,
            day        TEXT NOT NULL,
            fingerprint TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS intervals_skipped (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id      TEXT NOT NULL,
            source  TEXT NOT NULL,
            PRIMARY KEY (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS intervals_sync (
            user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            last_run   INTEGER,
            last_error TEXT
        );
    `);

    const q = {
        key:        db.prepare("SELECT data FROM connections WHERE user_id = ? AND service = 'intervals'"),
        connected:  db.prepare("SELECT user_id FROM connections WHERE service = 'intervals'"),
        revoke:     db.prepare("DELETE FROM connections WHERE user_id = ? AND service = 'intervals'"),
        upload:     db.prepare("SELECT activity_id FROM uploads WHERE user_id = ? AND service = 'intervals' AND remote_id = ?"),
        ride:       db.prepare('SELECT summary, fingerprint FROM external_rides WHERE user_id = ? AND id = ?'),
        newestDay:  db.prepare("SELECT MAX(day) AS day FROM external_rides WHERE user_id = ? AND id LIKE 'icu-%'"),
        upsertRide: db.prepare(`INSERT INTO external_rides (user_id, id, summary, day, fingerprint, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                                ON CONFLICT (user_id, id) DO UPDATE SET summary = excluded.summary, day = excluded.day,
                                fingerprint = excluded.fingerprint, updated_at = excluded.updated_at`),
        rides:      db.prepare('SELECT summary FROM external_rides WHERE user_id = ? AND updated_at > ? ORDER BY updated_at'),
        countRides: db.prepare("SELECT COUNT(*) AS n FROM external_rides WHERE user_id = ? AND id LIKE 'icu-%'"),
        skip:       db.prepare('INSERT OR IGNORE INTO intervals_skipped (user_id, id, source) VALUES (?, ?, ?)'),
        skipped:    db.prepare('SELECT source, COUNT(*) AS n FROM intervals_skipped WHERE user_id = ? GROUP BY source'),
        status:     db.prepare('SELECT * FROM intervals_sync WHERE user_id = ?'),
        setStatus:  db.prepare(`INSERT INTO intervals_sync (user_id, last_run, last_error) VALUES (?, ?, ?)
                                ON CONFLICT (user_id) DO UPDATE SET last_run = excluded.last_run, last_error = excluded.last_error`),
    };

    const running = new Map(); // userId -> Promise
    let timer = null;

    function wait(ms) {
        return new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); });
    }

    function apiKey(userId) {
        const row = q.key.get(userId);
        return row ? JSON.parse(row.data).apiKey : null;
    }

    // one paced request; waits on 429; a revoked key throws SyncError(revoked)
    function client(key) {
        const auth = 'Basic ' + Buffer.from(`API_KEY:${key}`).toString('base64');
        let limited = 0;
        let last = 0;
        return async function request(method, path, body) {
            for(;;) {
                const gap = last + pauseMs - Date.now();
                if(gap > 0) await wait(gap);
                last = Date.now();
                const res = await fetchImpl(base + path, {
                    method,
                    headers: {Authorization: auth, Accept: 'application/json',
                              ...(body !== undefined ? {'Content-Type': 'application/json'} : {})},
                    body: body !== undefined ? JSON.stringify(body) : undefined,
                });
                if(res.status === 401 || res.status === 403) {
                    throw new SyncError('intervals.icu no longer accepts the API key. Enter it again.', {revoked: true});
                }
                if(res.status === 429) {
                    limited++;
                    if(limited >= MAX_RATE_LIMITS) throw new SyncError('intervals.icu rate limit reached; the sync continues later.');
                    const retry = Number(res.headers.get('retry-after'));
                    await wait(Math.min(Number.isFinite(retry) ? retry * 1000 : 60000, maxWaitMs));
                    continue;
                }
                limited = 0;
                const data = await res.json().catch(() => null);
                if(!res.ok) {
                    const err = new SyncError(`intervals.icu answered ${res.status}.`);
                    err.status = res.status;
                    throw err;
                }
                return data;
            }
        };
    }

    function fingerprint(a) {
        return [a.start_date_local, a.moving_time, a.elapsed_time, a.icu_training_load,
                a.icu_weighted_avg_watts, a.name, a.type].join('|');
    }

    async function syncActivities(userId, request) {
        const newest = q.newestDay.get(userId)?.day;
        const oldest = newest ?
              isoDay(Date.parse(newest) - OVERLAP_DAYS * DAY_MS) :
              isoDay(now() - FIRST_DAYS * DAY_MS);
        const list = await request('GET', `/api/v1/athlete/0/activities?oldest=${oldest}&newest=${isoDay(now() + DAY_MS)}`);

        for(const a of Array.isArray(list) ? list : []) {
            if(!a?.id) continue;
            if(isStub(a)) {
                q.skip.run(userId, String(a.id), String(a.source ?? 'UNKNOWN'));
                continue;
            }
            const id = `icu-${a.id}`;
            const fp = fingerprint(a);
            const stored = q.ride.get(userId, id);
            if(stored && stored.fingerprint === fp) continue;

            let powerCurve = null;
            const hasPower = Number(a.icu_weighted_avg_watts) > 0 || Number(a.icu_average_watts) > 0 || a.device_watts === true;
            if(sportOf(a.type) === 'cycling' && hasPower) {
                try {
                    powerCurve = await request('GET', `/api/v1/activity/${encodeURIComponent(a.id)}/power-curve`);
                } catch(e) {
                    if(e.revoked || /rate limit/.test(e.message)) throw e;
                    powerCurve = null; // keep the ride without best efforts
                }
            }
            const auukiRideId = q.upload.get(userId, String(a.id))?.activity_id ?? null;
            const summary = toSummary(a, {powerCurve, auukiRideId});
            q.upsertRide.run(userId, id, JSON.stringify(summary), summary.day, fp, now());
        }
    }

    async function runOnce(userId) {
        const key = apiKey(userId);
        if(!key) return {error: 'intervals.icu is not connected.'};
        const request = client(key);
        let error = null;
        try {
            await syncActivities(userId, request);
            if(typeof syncPlan === 'function') await syncPlan(userId, request);
        } catch(e) {
            error = String(e.message ?? e).slice(0, 300);
            if(e.revoked) q.revoke.run(userId);
        }
        q.setStatus.run(userId, now(), error);
        return {...status(userId), error};
    }

    function run(userId) {
        const prev = running.get(userId) ?? Promise.resolve();
        const next = prev.then(() => runOnce(userId), () => runOnce(userId));
        running.set(userId, next);
        next.finally(() => { if(running.get(userId) === next) running.delete(userId); });
        return next;
    }

    function status(userId) {
        const row = q.status.get(userId);
        const skipped = Object.fromEntries(q.skipped.all(userId).map(r => [r.source, r.n]));
        return {
            lastRun: row?.last_run ?? null,
            error: row?.last_error ?? null,
            stored: q.countRides.get(userId).n,
            skipped,
        };
    }

    function start() {
        if(timer) return;
        timer = setInterval(() => {
            for(const {user_id} of q.connected.all()) run(user_id).catch(() => {});
        }, syncEveryMs);
        timer.unref?.();
    }

    function close() {
        if(timer) clearInterval(timer);
        timer = null;
    }

    function routes(route, {fail}) {
        route('GET', '/api/me/external-rides', ({auth, url}) => {
            const since = Number(url.searchParams.get('since') ?? 0) || 0;
            const t = now();
            return {rides: q.rides.all(auth.user.id, since).map(r => JSON.parse(r.summary)), now: t};
        }, {auth: true});

        route('POST', '/api/me/intervals/sync', ({auth}) => {
            if(!apiKey(auth.user.id)) fail(409, 'intervals.icu is not connected.');
            run(auth.user.id).catch(() => {});
            return {status: 202, body: {queued: true}};
        }, {auth: true});
    }

    // the plan sync is added by the plan part of this module
    let syncPlan = null;
    function setPlanSync(fn) { syncPlan = fn; }

    return {run, status, start, close, routes, setPlanSync, apiKey, q, db, now, isoDay};
}

module.exports = { createIntervalsSync, SyncError };
