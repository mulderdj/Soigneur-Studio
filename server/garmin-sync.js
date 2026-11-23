'use strict';

//
// Garmin Personal API sync, per account with a Garmin key:
//   health data (HRV, resting HR, sleep, Body Battery, stress, weight,
//   VO2max) → wellness, one row per day
//   activities → external_rides (ride summaries, like intervals.icu's)
//
// The key stays on the server. It is swapped for a bearer token (a JWT,
// at most 24 h) that is reused until it has less than an hour left. The
// API is read-only and pull-only. Runs every 15 minutes, on request and
// after connecting; never twice at once for one account.
//
// This module is the only place that talks to Garmin, so Garmin's
// business programme (OAuth, push) can replace the personal key later.
//

const { toSummary, wellnessFrom, thresholdsFrom, WINDOW_DAYS } = require('./garmin.js');

const DAY_MS = 86400000;
const HEALTH_FIRST_DAYS = 90;
const HEALTH_OVERLAP_DAYS = 3;
const ACTIVITY_FIRST_DAYS = 730;
const ACTIVITY_OVERLAP_DAYS = 7;
const PAGE = 100;
const MAX_RATE_LIMITS = 3;
const RENEW_BEFORE_S = 3600;
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const REVOKED = 'Garmin no longer accepts the API key (expired or deleted). Create a new one on Garmin Connect and paste it here.';

class GarminError extends Error {
    constructor(message, {revoked = false, status = 0} = {}) {
        super(message);
        this.revoked = revoked;
        this.status = status;
    }
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function jwtExp(token) {
    try {
        const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
        return Number.isFinite(payload.exp) ? payload.exp : null;
    } catch(e) {
        return null;
    }
}

function createGarminSync({db, options = {}}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const base = (options.base ?? 'https://personal.connectapi.garmin.com').replace(/\/+$/, '');
    const pauseMs = options.pauseMs ?? 200;
    const maxWaitMs = options.maxWaitMs ?? 5 * 60 * 1000;
    const syncEveryMs = options.syncEveryMs ?? 15 * 60 * 1000;
    const now = () => Date.now();

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
        CREATE TABLE IF NOT EXISTS wellness (
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day        TEXT NOT NULL,
            data       TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, day)
        );
        CREATE TABLE IF NOT EXISTS garmin_sync (
            user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            token      TEXT,
            token_exp  INTEGER,
            thresholds TEXT,
            last_run   INTEGER,
            last_error TEXT
        );
    `);

    const q = {
        conn:       db.prepare("SELECT data FROM connections WHERE user_id = ? AND service = 'garmin'"),
        connected:  db.prepare("SELECT user_id FROM connections WHERE service = 'garmin'"),
        saveConn:   db.prepare(`INSERT INTO connections (user_id, service, data, auto_upload, updated_at) VALUES (?, 'garmin', ?, 0, ?)
                                ON CONFLICT (user_id, service) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
        removeConn: db.prepare("DELETE FROM connections WHERE user_id = ? AND service = 'garmin'"),
        state:      db.prepare('SELECT * FROM garmin_sync WHERE user_id = ?'),
        ensure:     db.prepare('INSERT OR IGNORE INTO garmin_sync (user_id) VALUES (?)'),
        setToken:   db.prepare('UPDATE garmin_sync SET token = ?, token_exp = ? WHERE user_id = ?'),
        setThresh:  db.prepare('UPDATE garmin_sync SET thresholds = ? WHERE user_id = ?'),
        setRun:     db.prepare('UPDATE garmin_sync SET last_run = ?, last_error = ? WHERE user_id = ?'),
        ride:       db.prepare('SELECT summary FROM external_rides WHERE user_id = ? AND id = ?'),
        upsertRide: db.prepare(`INSERT INTO external_rides (user_id, id, summary, day, fingerprint, updated_at) VALUES (?, ?, ?, ?, NULL, ?)
                                ON CONFLICT (user_id, id) DO UPDATE SET summary = excluded.summary, day = excluded.day, updated_at = excluded.updated_at`),
        newestRide: db.prepare("SELECT MAX(day) AS day FROM external_rides WHERE user_id = ? AND id LIKE 'garmin-%'"),
        countRides: db.prepare("SELECT COUNT(*) AS n FROM external_rides WHERE user_id = ? AND id LIKE 'garmin-%'"),
        day:        db.prepare('SELECT data FROM wellness WHERE user_id = ? AND day = ?'),
        upsertDay:  db.prepare(`INSERT INTO wellness (user_id, day, data, updated_at) VALUES (?, ?, ?, ?)
                                ON CONFLICT (user_id, day) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
        newestDay:  db.prepare('SELECT MAX(day) AS day FROM wellness WHERE user_id = ?'),
        countDays:  db.prepare('SELECT COUNT(*) AS n FROM wellness WHERE user_id = ?'),
        days:       db.prepare('SELECT data FROM wellness WHERE user_id = ? AND updated_at > ? ORDER BY day'),
    };

    const running = new Map();
    let timer = null;

    const wait = (ms) => new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); });

    function connection(userId) {
        const row = q.conn.get(userId);
        return row ? JSON.parse(row.data) : null;
    }

    // the key → a bearer token (JWT); refused → GarminError(revoked)
    async function newToken(apiKey) {
        const res = await fetchImpl(base + TOKEN_PATH, {method: 'POST', headers: {Accept: '*/*', Authorization: `ApiKey ${apiKey}`}});
        const text = (await res.text().catch(() => '')).trim();
        if(res.status === 401 || res.status === 403) throw new GarminError(REVOKED, {revoked: true, status: res.status});
        if(!res.ok || !text) throw new GarminError(`Garmin answered ${res.status} to the key.`, {status: res.status});
        const exp = jwtExp(text) ?? Math.floor(now() / 1000) + 3600;
        return {token: text, exp};
    }

    // one client per run: paced requests, token reuse and renewal, 429 waits
    function client(userId, apiKey) {
        q.ensure.run(userId);
        let limited = 0;
        let last = 0;
        let renewed = false;
        let fresh = null; // a token issued during this run is used for the rest of it

        async function token(force = false) {
            if(!force && fresh && fresh.exp > now() / 1000) return fresh.token;
            const s = q.state.get(userId);
            if(!force && s?.token && s.token_exp - now() / 1000 > RENEW_BEFORE_S) return s.token;
            fresh = await newToken(apiKey);
            q.setToken.run(fresh.token, fresh.exp, userId);
            return fresh.token;
        }

        return async function get(path, {raw = false} = {}) {
            for(;;) {
                const gap = last + pauseMs - Date.now();
                if(gap > 0) await wait(gap);
                last = Date.now();
                const res = await fetchImpl(base + path, {headers: {Accept: 'application/json', Authorization: `Bearer ${await token()}`}});
                if(res.status === 401 || res.status === 403) {
                    // a token can stop working before it expires: renew once, then the key itself is refused
                    if(renewed) throw new GarminError(REVOKED, {revoked: true, status: res.status});
                    renewed = true;
                    await token(true);
                    continue;
                }
                if(res.status === 429) {
                    limited++;
                    if(limited >= MAX_RATE_LIMITS) throw new GarminError('Garmin rate limit reached; the sync continues later.', {status: 429});
                    const retry = Number(res.headers.get('retry-after'));
                    await wait(Math.min(Number.isFinite(retry) ? retry * 1000 : 60000, maxWaitMs));
                    continue;
                }
                limited = 0;
                if(!res.ok) throw new GarminError(`Garmin answered ${res.status}.`, {status: res.status});
                if(raw) return res;
                const text = await res.text();
                return text ? JSON.parse(text) : null;
            }
        };
    }

    // an endpoint that fails for another reason than the key or the rate
    // limit leaves its part of the day empty, the rest goes on
    async function optional(get, path) {
        try {
            return await get(path);
        } catch(e) {
            if(e.revoked || e.status === 429) throw e;
            return null;
        }
    }

    function windows(from, to) {
        const out = [];
        for(let a = Date.parse(from); a <= Date.parse(to); a += WINDOW_DAYS * DAY_MS) {
            const b = Math.min(a + (WINDOW_DAYS - 1) * DAY_MS, Date.parse(to));
            out.push([isoDay(a), isoDay(b)]);
        }
        return out;
    }

    async function syncHealth(userId, get) {
        const newest = q.newestDay.get(userId)?.day;
        const from = newest ? isoDay(Date.parse(newest) - HEALTH_OVERLAP_DAYS * DAY_MS) : isoDay(now() - HEALTH_FIRST_DAYS * DAY_MS);
        const to = isoDay(now());
        for(const [a, b] of windows(from, to)) {
            const range = `startDate=${a}&endDate=${b}`;
            const days = wellnessFrom({
                hrv:         await optional(get, `/hrv-service/hrv/daily/${a}/${b}`),
                daily:       await optional(get, `/usersummary-service/v2/dailysummaries?${range}`),
                sleep:       await optional(get, `/sleep-service/sleep/dailySleepSummariesByDate?${range}`),
                bodyBattery: await optional(get, `/wellness-service/wellness/bodyBattery/reports/daily?${range}`),
                stress:      await optional(get, `/usersummary-service/stats/stress/daily/${a}/${b}`),
                weight:      await optional(get, `/weight-service/weight/range/${a}/${b}?includeAll=true`),
                vo2:         await optional(get, `/metrics-service/metrics/maxmet/daily/${a}/${b}`),
            });
            for(const [day, data] of days) {
                const old = q.day.get(userId, day);
                const merged = {...(old ? JSON.parse(old.data) : {}), ...data};
                const json = JSON.stringify(merged);
                if(old?.data !== json) q.upsertDay.run(userId, day, json, now());
            }
        }
    }

    async function syncActivities(userId, get) {
        const newest = q.newestRide.get(userId)?.day;
        const from = newest ? isoDay(Date.parse(newest) - ACTIVITY_OVERLAP_DAYS * DAY_MS) : isoDay(now() - ACTIVITY_FIRST_DAYS * DAY_MS);
        const to = isoDay(now() + DAY_MS);
        for(let start = 0; ; start += PAGE) {
            const page = await get(`/activitylist-service/activities/search/activities?start=${start}&limit=${PAGE}&startDate=${from}&endDate=${to}`);
            const list = Array.isArray(page) ? page : (Array.isArray(page?.activityList) ? page.activityList : []);
            for(const a of list) {
                const s = toSummary(a);
                if(!s) continue;
                const json = JSON.stringify(s);
                if(q.ride.get(userId, s.id)?.summary === json) continue; // unchanged
                q.upsertRide.run(userId, s.id, json, s.day, now());
            }
            if(list.length < PAGE) break;
        }
    }

    async function runOnce(userId) {
        const conn = connection(userId);
        if(!conn?.apiKey) return {...status(userId), error: 'Garmin is not connected.'};
        const get = client(userId, conn.apiKey);
        let error = null;
        try {
            const zones = await optional(get, '/biometric-service/heartRateZones/v2');
            if(zones) q.setThresh.run(JSON.stringify(thresholdsFrom(zones)), userId);
            await syncHealth(userId, get);
            await syncActivities(userId, get);
        } catch(e) {
            error = String(e.message ?? e).slice(0, 300);
            if(e.revoked) {
                q.removeConn.run(userId);
                q.setToken.run(null, null, userId);
            }
        }
        q.ensure.run(userId);
        q.setRun.run(now(), error, userId);
        return {...status(userId), error};
    }

    function run(userId) {
        const prev = running.get(userId) ?? Promise.resolve();
        const next = prev.then(() => runOnce(userId), () => runOnce(userId));
        running.set(userId, next);
        next.finally(() => { if(running.get(userId) === next) running.delete(userId); }).catch(() => {});
        return next;
    }

    // what the rider sees on the Garmin card (never the key)
    function status(userId) {
        const conn = connection(userId);
        const s = q.state.get(userId);
        let thresholds = {cycling: null, running: null};
        try { if(s?.thresholds) thresholds = JSON.parse(s.thresholds); } catch(e) {}
        return {
            connected: !!conn,
            expiresOn: conn?.expiresOn ?? null,
            thresholds,
            sync: {
                lastRun: s?.last_run ?? null,
                error: s?.last_error ?? null,
                activities: q.countRides.get(userId).n,
                days: q.countDays.get(userId).n,
            },
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
        route('PUT', '/api/me/connections/garmin', async ({auth, body}) => {
            const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
            if(!/^[\x21-\x7e]{16,512}$/.test(apiKey)) {
                fail(400, 'Paste the Personal API key from Garmin Connect (web): Settings, Personal API Key.');
            }
            const expiresOn = typeof body.expiresOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.expiresOn) ? body.expiresOn : null;
            let t;
            try {
                t = await newToken(apiKey);
            } catch(e) {
                if(e.revoked) fail(400, "Garmin didn't accept this key. Check that you copied all of it, or create a new one.");
                fail(502, 'Garmin could not be reached to check the key. Try again in a moment.');
            }
            q.saveConn.run(auth.user.id, JSON.stringify({apiKey, expiresOn}), now());
            q.ensure.run(auth.user.id);
            q.setToken.run(t.token, t.exp, auth.user.id);
            q.setRun.run(null, null, auth.user.id);
            run(auth.user.id).catch(() => {});
            return {ok: true, garmin: status(auth.user.id)};
        }, {auth: true});

        route('DELETE', '/api/me/connections/garmin', ({auth}) => {
            q.removeConn.run(auth.user.id);
            q.ensure.run(auth.user.id);
            q.setToken.run(null, null, auth.user.id);
            return {ok: true, garmin: status(auth.user.id)};
        }, {auth: true});

        route('POST', '/api/me/garmin/sync', ({auth}) => {
            if(!connection(auth.user.id)) fail(409, 'Garmin is not connected.');
            run(auth.user.id).catch(() => {});
            return {status: 202, body: {queued: true}};
        }, {auth: true});

        route('GET', '/api/me/wellness', ({auth, url}) => {
            const since = Number(url.searchParams.get('since') ?? 0) || 0;
            const t = now();
            return {days: q.days.all(auth.user.id, since).map(r => JSON.parse(r.data)), now: t};
        }, {auth: true});
    }

    return {run, status, start, close, routes};
}

module.exports = { createGarminSync, GarminError, jwtExp };
