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
const PLAN_BACK_DAYS = 14;
const PLAN_AHEAD_DAYS = 90;

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
    const readOnly = options.readOnly === true; // pull only: never write to intervals.icu

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
            last_error TEXT,
            plan_skipped INTEGER NOT NULL DEFAULT 0
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
        setStatus:  db.prepare(`INSERT INTO intervals_sync (user_id, last_run, last_error, plan_skipped) VALUES (?, ?, ?, ?)
                                ON CONFLICT (user_id) DO UPDATE SET last_run = excluded.last_run, last_error = excluded.last_error,
                                plan_skipped = excluded.plan_skipped`),
        planRows:   db.prepare('SELECT id, data, deleted, updated_at FROM plan WHERE user_id = ?'),
        planSave:   db.prepare(`INSERT INTO plan (user_id, id, data, deleted, updated_at) VALUES (?, ?, ?, 0, ?)
                                ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data, deleted = 0, updated_at = excluded.updated_at`),
        planGone:   db.prepare(`UPDATE plan SET deleted = 1, data = '{}', updated_at = ? WHERE user_id = ? AND id = ?`),
        planUnlink: db.prepare(`UPDATE plan SET data = '{}' WHERE user_id = ? AND id = ? AND deleted = 1`),
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

    // what decides "unchanged"; MAPPING changes when toSummary maps more,
    // so rides stored before are mapped again on the next sync
    const MAPPING = 'm2'; // m2: heart rate (live check, 2026-11-23)
    function fingerprint(a) {
        return [MAPPING, a.start_date_local, a.moving_time, a.elapsed_time, a.icu_training_load,
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

    //
    // Plan, both ways, for 14 days back to 90 days ahead. Each linked entry
    // remembers the event's `updated` (intervalsUpdated) and when it was last
    // in step (intervalsSyncedAt): the event changed when its `updated`
    // differs, the entry changed when its row is newer than intervalsSyncedAt.
    // When both changed, the newer change wins.
    //
    function eventBody(id, d) {
        const name = d.workout?.meta?.name || 'Workout';
        const file = name.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 60) || 'workout';
        return {uid: `auuki-${id}`, category: 'WORKOUT', type: 'Ride', name,
                start_date_local: `${d.day}T00:00:00`, filename: `${file}.zwo`, file_contents: d.zwo};
    }

    function fromEvent(ev, d = {}) {
        const zwo = ev.workout_file_base64 ? Buffer.from(ev.workout_file_base64, 'base64').toString('utf8') : null;
        const workout = d.workout ?? {id: `icu-ev-${ev.id}`, intervals: []};
        return {
            rideId: null, origin: 'intervals', ...d,
            day: String(ev.start_date_local).slice(0, 10),
            workout: {...workout, meta: {...workout.meta, name: ev.name ?? workout.meta?.name ?? 'Workout'}},
            zwo: zwo ?? d.zwo ?? null,
            intervalsEventId: ev.id,
            intervalsUpdated: ev.updated ?? null,
        };
    }

    async function syncPlan(userId, request) {
        const from = isoDay(now() - PLAN_BACK_DAYS * DAY_MS);
        const to = isoDay(now() + PLAN_AHEAD_DAYS * DAY_MS);
        const inWindow = day => typeof day === 'string' && day >= from && day <= to;
        const events = await request('GET', `/api/v1/athlete/0/events?oldest=${from}&newest=${to}&category=WORKOUT&ext=zwo`);

        const rows = q.planRows.all(userId).map(r => ({id: r.id, deleted: !!r.deleted, updatedAt: r.updated_at, data: JSON.parse(r.data)}));
        const byId = new Map(rows.map(r => [r.id, r]));
        const byEvent = new Map(rows.filter(r => r.data.intervalsEventId != null).map(r => [String(r.data.intervalsEventId), r]));
        const seen = new Set();
        let error = null;
        let skipped = 0;

        const save = (row, data) => {
            const t = now();
            data.intervalsSyncedAt = t;
            q.planSave.run(userId, row.id, JSON.stringify(data), t);
            Object.assign(row, {data, deleted: false, updatedAt: t});
        };
        // one write to intervals.icu; an error is kept for the status and the run goes on
        const write = async (fn) => {
            if(readOnly) return;
            try { await fn(); } catch(e) {
                if(e.revoked || /rate limit/.test(e.message)) throw e;
                error ??= String(e.message ?? e).slice(0, 300);
            }
        };

        for(const ev of Array.isArray(events) ? events : []) {
            if(ev?.id == null || !ev.start_date_local) continue;
            const key = String(ev.id);
            seen.add(key);
            let row = byEvent.get(key);
            if(!row && typeof ev.uid === 'string' && ev.uid.startsWith('auuki-')) {
                // created by an earlier run that failed before it stored the id
                const own = byId.get(ev.uid.slice('auuki-'.length));
                if(own && !own.deleted && own.data.intervalsEventId == null) {
                    save(own, {...own.data, intervalsEventId: ev.id, intervalsUpdated: ev.updated ?? null});
                    byEvent.set(key, own);
                    continue;
                }
            }
            if(!row) {
                const id = `icu-ev-${key}`;
                if(byId.has(id)) continue; // an entry for this event exists already (deleted and unlinked)
                const fresh = {id, deleted: false, updatedAt: 0, data: {}};
                save(fresh, fromEvent(ev));
                byId.set(id, fresh);
                byEvent.set(key, fresh);
                continue;
            }
            const d = row.data;
            const eventChanged = (ev.updated ?? null) !== (d.intervalsUpdated ?? null);
            const eventNewer = Date.parse(ev.updated) > row.updatedAt;
            if(row.deleted) {
                if(eventChanged && eventNewer) { save(row, fromEvent(ev, {origin: 'intervals'})); continue; }
                await write(async () => {
                    await request('DELETE', `/api/v1/athlete/0/events/${encodeURIComponent(ev.id)}`);
                    q.planUnlink.run(userId, row.id);
                });
                continue;
            }
            const rowChanged = row.updatedAt > (d.intervalsSyncedAt ?? 0);
            if(eventChanged && (!rowChanged || eventNewer)) {
                save(row, fromEvent(ev, d));
            } else if(rowChanged && d.zwo) {
                await write(async () => {
                    const out = await request('PUT', `/api/v1/athlete/0/events/${encodeURIComponent(ev.id)}`, eventBody(row.id, d));
                    save(row, {...d, intervalsUpdated: out?.updated ?? d.intervalsUpdated ?? null});
                });
            }
        }

        for(const row of rows) {
            const d = row.data;
            if(d.intervalsEventId != null) {
                if(seen.has(String(d.intervalsEventId)) || !inWindow(d.day)) continue;
                // the event is gone from intervals.icu
                if(row.deleted) q.planUnlink.run(userId, row.id);
                else q.planGone.run(now(), userId, row.id);
                continue;
            }
            if(row.deleted || d.origin === 'intervals' || !inWindow(d.day)) continue;
            if(!d.zwo) { skipped++; continue; }
            await write(async () => {
                const out = await request('POST', '/api/v1/athlete/0/events?upsertOnUid=true', eventBody(row.id, d));
                if(out?.id == null) throw new SyncError('intervals.icu did not return the new workout.');
                save(row, {...d, origin: d.origin ?? 'auuki', intervalsEventId: out.id, intervalsUpdated: out.updated ?? null});
            });
        }
        return {error, skipped};
    }

    async function runOnce(userId) {
        const key = apiKey(userId);
        if(!key) return {error: 'intervals.icu is not connected.'};
        const request = client(key);
        let error = null;
        let planSkipped = q.status.get(userId)?.plan_skipped ?? 0;
        try {
            await syncActivities(userId, request);
            const plan = await syncPlan(userId, request);
            planSkipped = plan.skipped;
            error = plan.error;
        } catch(e) {
            error = String(e.message ?? e).slice(0, 300);
            if(e.revoked) q.revoke.run(userId);
        }
        q.setStatus.run(userId, now(), error, planSkipped);
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
            planSkipped: row?.plan_skipped ?? 0,
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

    function routes(route, {fail, validId}) {
        route('GET', '/api/me/external-rides', ({auth, url}) => {
            const since = Number(url.searchParams.get('since') ?? 0) || 0;
            const t = now();
            return {rides: q.rides.all(auth.user.id, since).map(r => JSON.parse(r.summary)), now: t};
        }, {auth: true});

        // a ride imported from a .fit file on one device, for the rider's others
        route('PUT', '/api/me/external-rides/:id', ({auth, body, params}) => {
            const id = validId(params.id);
            if(!id.startsWith('fit-')) fail(400, 'Only imported rides (fit-…) can be stored here.');
            const s = body?.summary;
            if(typeof s !== 'object' || s === null || s.source !== 'fit' || typeof s.day !== 'string' ||
               !/^\d{4}-\d{2}-\d{2}$/.test(s.day)) fail(400, 'Expected {summary: {source: "fit", day, ...}}.');
            const summary = {...s, id};
            q.upsertRide.run(auth.user.id, id, JSON.stringify(summary), summary.day, null, now());
            return {ok: true};
        }, {auth: true});

        route('POST', '/api/me/intervals/sync', ({auth}) => {
            if(!apiKey(auth.user.id)) fail(409, 'intervals.icu is not connected.');
            run(auth.user.id).catch(() => {});
            return {status: 202, body: {queued: true}};
        }, {auth: true});
    }

    return {run, status, start, close, routes};
}

module.exports = { createIntervalsSync, SyncError };
