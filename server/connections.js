'use strict';

//
// Per-account connections to Strava and intervals.icu, and ride uploads.
//
// Strava: OAuth 2 with one Strava API application for the whole server
//   (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET). The client secret and every
//   token stay on the server; the browser only ever sees the authorize URL.
// intervals.icu: each rider pastes their personal API key (basic auth,
//   username "API_KEY").
//
// Uploads run in the background after a ride is saved (auto-upload, per
// service, on by default) or on demand, and are retried with backoff.
// Status per ride and service is kept in the `uploads` table.
//

const crypto = require('node:crypto');

const SERVICES = ['strava', 'intervals'];
const STATE_TTL_MS = 10 * 60 * 1000;
const RETRY_DELAYS_MS = [30e3, 5 * 60e3, 30 * 60e3];

function createConnections({db, fail, options = {}}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const stravaBase = options.stravaBase ?? 'https://www.strava.com';
    const intervalsBase = options.intervalsBase ?? 'https://intervals.icu';
    const publicUrl = (options.publicUrl ?? '').replace(/\/+$/, '');
    const strava = options.strava ?? {};
    const stravaConfigured = !!(strava.clientId && strava.clientSecret && publicUrl);
    const pollDelay = options.pollDelayMs ?? 1500;
    const retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    const intervalsReadOnly = options.intervalsReadOnly === true;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const withTimeout = (opts = {}) => (typeof AbortSignal?.timeout === 'function' ? {...opts, signal: AbortSignal.timeout(timeoutMs)} : opts);

    db.exec(`
        CREATE TABLE IF NOT EXISTS connections (
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            service     TEXT NOT NULL,
            data        TEXT NOT NULL,
            auto_upload INTEGER NOT NULL DEFAULT 1,
            updated_at  INTEGER NOT NULL,
            PRIMARY KEY (user_id, service)
        );
        CREATE TABLE IF NOT EXISTS oauth_states (
            state      TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            service    TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS uploads (
            user_id     TEXT NOT NULL,
            activity_id TEXT NOT NULL,
            service     TEXT NOT NULL,
            status      TEXT NOT NULL,
            remote_id   TEXT,
            remote_url  TEXT,
            error       TEXT,
            attempts    INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL,
            PRIMARY KEY (user_id, activity_id, service),
            FOREIGN KEY (user_id, activity_id) REFERENCES activities(user_id, id) ON DELETE CASCADE
        );
    `);

    const q = {
        get:       db.prepare('SELECT * FROM connections WHERE user_id = ? AND service = ?'),
        all:       db.prepare('SELECT * FROM connections WHERE user_id = ?'),
        upsert:    db.prepare(`INSERT INTO connections (user_id, service, data, auto_upload, updated_at) VALUES (?, ?, ?, ?, ?)
                               ON CONFLICT(user_id, service) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
        setData:   db.prepare('UPDATE connections SET data = ?, updated_at = ? WHERE user_id = ? AND service = ?'),
        setAuto:   db.prepare('UPDATE connections SET auto_upload = ?, updated_at = ? WHERE user_id = ? AND service = ?'),
        remove:    db.prepare('DELETE FROM connections WHERE user_id = ? AND service = ?'),
        addState:  db.prepare('INSERT INTO oauth_states (state, user_id, service, expires_at) VALUES (?, ?, ?, ?)'),
        takeState: db.prepare('SELECT * FROM oauth_states WHERE state = ?'),
        dropState: db.prepare('DELETE FROM oauth_states WHERE state = ? OR expires_at < ?'),
        upload:    db.prepare('SELECT * FROM uploads WHERE user_id = ? AND activity_id = ? AND service = ?'),
        uploadsFor: db.prepare('SELECT * FROM uploads WHERE user_id = ? AND activity_id = ?'),
        setUpload: db.prepare(`INSERT INTO uploads (user_id, activity_id, service, status, remote_id, remote_url, error, attempts, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                               ON CONFLICT(user_id, activity_id, service) DO UPDATE SET status = excluded.status,
                               remote_id = excluded.remote_id, remote_url = excluded.remote_url, error = excluded.error,
                               attempts = excluded.attempts, updated_at = excluded.updated_at`),
        pending:   db.prepare("SELECT * FROM uploads WHERE status IN ('queued', 'retrying', 'uploading')"),
        ride:      db.prepare('SELECT summary, fit FROM activities WHERE user_id = ? AND id = ?'),
    };

    const timers = new Set();
    const running = new Set();
    const refreshing = new Map(); // userId -> in-flight Strava refresh Promise

    function later(fn, ms) {
        const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
        t.unref?.();
        timers.add(t);
    }

    function wait(ms) {
        return new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); });
    }

    // --- service clients ---------------------------------------------------

    class UploadError extends Error {
        constructor(message, {permanent = false, disconnect = false} = {}) {
            super(message);
            this.permanent = permanent;
            this.disconnect = disconnect;
        }
    }

    async function stravaToken(params) {
        const res = await fetchImpl(`${stravaBase}/oauth/token`, withTimeout({
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({client_id: strava.clientId, client_secret: strava.clientSecret, ...params}),
        }));
        const data = await res.json().catch(() => ({}));
        if(!res.ok) {
            throw new UploadError(data.message ?? `Strava refused the sign-in (${res.status}).`,
                                  {permanent: res.status < 500, disconnect: res.status === 400 || res.status === 401});
        }
        return data;
    }

    async function stravaAccess(userId) {
        const row = q.get.get(userId, 'strava');
        if(!row) throw new UploadError('Strava is not connected.', {permanent: true});
        const data = JSON.parse(row.data);
        if(data.expiresAt * 1000 > Date.now() + 60e3) return data.accessToken;
        if(refreshing.has(userId)) return refreshing.get(userId);
        const p = (async () => {
            const t = await stravaToken({grant_type: 'refresh_token', refresh_token: data.refreshToken});
            const next = {...data, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at};
            q.setData.run(JSON.stringify(next), Date.now(), userId, 'strava');
            return next.accessToken;
        })().finally(() => refreshing.delete(userId));
        refreshing.set(userId, p);
        return p;
    }

    async function uploadStrava(userId, rideId, ride) {
        const token = await stravaAccess(userId);
        const summary = JSON.parse(ride.summary);
        const form = new FormData();
        form.append('file', new Blob([ride.fit]), `soigneur-${rideId}.fit`);
        form.append('data_type', 'fit');
        form.append('name', summary.name ?? 'Indoor ride');
        form.append('description', 'Recorded with Soigneur Studio');
        form.append('trainer', '1');
        form.append('external_id', `soigneur-${rideId}.fit`);

        const res = await fetchImpl(`${stravaBase}/api/v3/uploads`, withTimeout({
            method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: form,
        }));
        const data = await res.json().catch(() => ({}));
        if(res.status === 401) throw new UploadError('Strava access was revoked. Connect Strava again.', {permanent: true, disconnect: true});
        if(res.status === 429) throw new UploadError('Strava rate limit reached; will retry.');
        if(!res.ok) throw new UploadError(data.error ?? data.message ?? `Strava upload failed (${res.status}).`, {permanent: res.status < 500});

        // processing is asynchronous: poll until activity_id or error
        let status = data;
        for(let i = 0; i < 10 && !status.activity_id && !status.error; i++) {
            await wait(pollDelay);
            const uploadId = status.id_str ?? status.id;
            if(!uploadId) break;
            const r = await fetchImpl(`${stravaBase}/api/v3/uploads/${encodeURIComponent(uploadId)}`, withTimeout({
                headers: {Authorization: `Bearer ${token}`},
            }));
            if(r.ok) status = await r.json().catch(() => status);
        }
        if(status.error) {
            const dup = /duplicate/i.test(status.error);
            if(dup) {
                const id = (status.error.match(/activities\/(\d+)/) ?? [])[1];
                return {remoteId: id ?? null, remoteUrl: id ? `https://www.strava.com/activities/${id}` : null, note: 'Already on Strava'};
            }
            throw new UploadError(status.error, {permanent: true});
        }
        if(!status.activity_id) throw new UploadError('Strava is still processing the ride; will check again.');
        return {remoteId: String(status.activity_id), remoteUrl: `https://www.strava.com/activities/${status.activity_id}`};
    }

    function intervalsAuth(apiKey) {
        return 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    }

    async function intervalsAthlete(apiKey) {
        const res = await fetchImpl(`${intervalsBase}/api/v1/athlete/0`, withTimeout({headers: {Authorization: intervalsAuth(apiKey)}}));
        if(res.status === 401 || res.status === 403) fail(400, 'intervals.icu did not accept that API key.');
        if(!res.ok) fail(502, `intervals.icu answered ${res.status}. Try again later.`);
        return res.json();
    }

    async function uploadIntervals(userId, rideId, ride) {
        if(intervalsReadOnly) throw new UploadError('intervals.icu is in read-only mode on this server.', {permanent: true});
        const row = q.get.get(userId, 'intervals');
        if(!row) throw new UploadError('intervals.icu is not connected.', {permanent: true});
        const {apiKey} = JSON.parse(row.data);
        const summary = JSON.parse(ride.summary);
        const form = new FormData();
        form.append('file', new Blob([ride.fit]), `soigneur-${rideId}.fit`);
        const qs = new URLSearchParams({name: summary.name ?? 'Indoor ride', description: 'Recorded with Soigneur Studio'});
        const res = await fetchImpl(`${intervalsBase}/api/v1/athlete/0/activities?${qs}`, withTimeout({
            method: 'POST', headers: {Authorization: intervalsAuth(apiKey)}, body: form,
        }));
        if(res.status === 401 || res.status === 403) {
            throw new UploadError('intervals.icu no longer accepts the API key. Enter it again.', {permanent: true, disconnect: true});
        }
        if(res.status === 429) throw new UploadError('intervals.icu rate limit reached; will retry.');
        const data = await res.json().catch(() => null);
        if(!res.ok) throw new UploadError(`intervals.icu upload failed (${res.status}).`, {permanent: res.status < 500});
        const id = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;
        return {
            remoteId: id,
            remoteUrl: id ? `https://intervals.icu/activities/${id}` : null,
            note: res.status === 200 ? 'Already on intervals.icu' : undefined,
        };
    }

    const uploaders = {strava: uploadStrava, intervals: uploadIntervals};

    // --- upload queue ------------------------------------------------------

    function record(userId, rideId, service, fields) {
        const prev = q.upload.get(userId, rideId, service) ?? {};
        q.setUpload.run(userId, rideId, service, fields.status,
                        fields.remoteId ?? prev.remote_id ?? null, fields.remoteUrl ?? prev.remote_url ?? null,
                        fields.error ?? null, fields.attempts ?? prev.attempts ?? 0, Date.now());
    }

    async function runUpload(userId, rideId, service) {
        const key = `${userId}|${rideId}|${service}`;
        if(running.has(key)) return;
        running.add(key);
        const prev = q.upload.get(userId, rideId, service);
        const attempts = (prev?.attempts ?? 0) + 1;
        try {
            const ride = q.ride.get(userId, rideId);
            if(!ride) return;
            record(userId, rideId, service, {status: 'uploading', attempts});
            const out = await uploaders[service](userId, rideId, ride);
            record(userId, rideId, service, {status: 'done', remoteId: out.remoteId, remoteUrl: out.remoteUrl,
                                             error: out.note ?? null, attempts});
        } catch(e) {
            const permanent = e.permanent || attempts > retryDelays.length;
            if(e.disconnect) q.remove.run(userId, service);
            record(userId, rideId, service, {status: permanent ? 'failed' : 'retrying',
                                             error: String(e.message ?? e).slice(0, 300), attempts});
            if(!permanent) later(() => runUpload(userId, rideId, service), retryDelays[attempts - 1]);
        } finally {
            running.delete(key);
        }
    }

    function queue(userId, rideId, service) {
        record(userId, rideId, service, {status: 'queued', attempts: 0});
        setImmediate(() => runUpload(userId, rideId, service));
    }

    // called after a ride is stored
    function onRideSaved(userId, rideId) {
        for(const row of q.all.all(userId)) {
            if(row.service === 'intervals' && intervalsReadOnly) continue;
            if(row.auto_upload && SERVICES.includes(row.service)) queue(userId, rideId, row.service);
        }
    }

    // uploads interrupted by a restart
    function resume() {
        for(const u of q.pending.all()) later(() => runUpload(u.user_id, u.activity_id, u.service), 2000);
    }

    function uploadsFor(userId, rideId) {
        const out = {};
        for(const u of q.uploadsFor.all(userId, rideId)) {
            out[u.service] = {status: u.status, url: u.remote_url, error: u.error, updatedAt: u.updated_at};
        }
        return out;
    }

    // --- routes ------------------------------------------------------------

    let onRemove = () => {};
    function setOnRemove(fn) { onRemove = fn; }
    let intervalsStatus = () => null;
    function setIntervalsStatus(fn) { intervalsStatus = fn; }
    let garminStatus = () => ({connected: false});
    function setGarminStatus(fn) { garminStatus = fn; }

    function describe(userId) {
        const rows = Object.fromEntries(q.all.all(userId).map(r => [r.service, r]));
        const s = rows.strava ? JSON.parse(rows.strava.data) : null;
        const i = rows.intervals ? JSON.parse(rows.intervals.data) : null;
        return {
            strava: {
                available: stravaConfigured,
                connected: !!s,
                athlete: s?.athleteName ?? null,
                autoUpload: rows.strava ? !!rows.strava.auto_upload : true,
            },
            intervals: {
                available: true,
                connected: !!i,
                athlete: i?.athleteName ?? null,
                athleteId: i?.athleteId ?? null,
                autoUpload: rows.intervals ? !!rows.intervals.auto_upload : true,
                sync: intervalsStatus(userId),
            },
            garmin: {
                available: false, // uploads: Garmin allows them for approved businesses only
                importUrl: 'https://connect.garmin.com/modern/import-data',
                ...garminStatus(userId), // the rider's Personal API key: health data and activities
            },
        };
    }

    function routes(route, {validId}) {
        route('GET', '/api/me/connections', ({auth}) => describe(auth.user.id), {auth: true});

        route('POST', '/api/me/connections/strava/start', ({auth}) => {
            if(!stravaConfigured) fail(409, 'Strava is not set up on this server. The admin needs to add STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and PUBLIC_URL.');
            const state = crypto.randomBytes(24).toString('base64url');
            q.dropState.run('', Date.now());
            q.addState.run(state, auth.user.id, 'strava', Date.now() + STATE_TTL_MS);
            const url = `${stravaBase}/oauth/authorize?` + new URLSearchParams({
                client_id: strava.clientId,
                redirect_uri: `${publicUrl}/api/connect/strava/callback`,
                response_type: 'code',
                approval_prompt: 'auto',
                scope: 'read,activity:write',
                state,
            });
            return {url};
        }, {auth: true});

        // Strava sends the browser here; no Authorization header, the state proves who it is
        route('GET', '/api/connect/strava/callback', async ({url}) => {
            const back = (result, message) => ({redirect: `${publicUrl || ''}/?connect=strava&result=${result}` +
                                                         (message ? `&message=${encodeURIComponent(message)}` : '')});
            const state = url.searchParams.get('state') ?? '';
            const row = q.takeState.get(state);
            q.dropState.run(state, Date.now());
            if(!row || row.expires_at < Date.now()) return back('error', 'The Strava sign-in expired. Try again.');
            if(url.searchParams.get('error')) return back('cancelled');
            const scope = url.searchParams.get('scope') ?? '';
            if(!scope.split(',').includes('activity:write')) {
                return back('error', 'Allow "Upload your activities" on Strava so rides can be sent.');
            }
            try {
                const t = await stravaToken({grant_type: 'authorization_code', code: url.searchParams.get('code') ?? ''});
                const name = [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(' ') || null;
                q.upsert.run(row.user_id, 'strava', JSON.stringify({
                    accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at,
                    athleteId: t.athlete?.id ?? null, athleteName: name,
                }), 1, Date.now());
                return back('connected');
            } catch(e) {
                return back('error', e.message);
            }
        });

        route('PUT', '/api/me/connections/intervals', async ({auth, body}) => {
            const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
            if(!/^[A-Za-z0-9]{10,100}$/.test(apiKey)) fail(400, 'Paste the API key from intervals.icu Settings, near the bottom of the page.');
            const athlete = await intervalsAthlete(apiKey);
            q.upsert.run(auth.user.id, 'intervals', JSON.stringify({
                apiKey, athleteId: athlete.id ?? null, athleteName: athlete.name ?? null,
            }), 1, Date.now());
            return describe(auth.user.id);
        }, {auth: true});

        route('PATCH', '/api/me/connections/:service', ({auth, body, params}) => {
            const service = params.service;
            if(!SERVICES.includes(service)) fail(404, 'Unknown service.');
            if(!q.get.get(auth.user.id, service)) fail(404, 'Not connected.');
            q.setAuto.run(body.autoUpload ? 1 : 0, Date.now(), auth.user.id, service);
            return describe(auth.user.id);
        }, {auth: true});

        route('DELETE', '/api/me/connections/:service', async ({auth, params}) => {
            const service = params.service;
            if(!SERVICES.includes(service)) fail(404, 'Unknown service.');
            const row = q.get.get(auth.user.id, service);
            if(row && service === 'strava') {
                try {
                    const token = await stravaAccess(auth.user.id);
                    await fetchImpl(`${stravaBase}/oauth/deauthorize`, {
                        method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                        body: new URLSearchParams({access_token: token}),
                    });
                } catch(e) { /* removing locally is what matters */ }
            }
            q.remove.run(auth.user.id, service);
            onRemove(auth.user.id, service);
            return describe(auth.user.id);
        }, {auth: true});

        route('POST', '/api/me/activities/:id/upload/:service', ({auth, params}) => {
            const rideId = validId(params.id);
            if(!SERVICES.includes(params.service)) fail(404, 'Unknown service.');
            if(params.service === 'intervals' && intervalsReadOnly) fail(409, 'intervals.icu is in read-only mode on this server.');
            if(!q.ride.get(auth.user.id, rideId)) fail(404, 'Ride not found.');
            if(!q.get.get(auth.user.id, params.service)) fail(409, `Connect ${params.service === 'strava' ? 'Strava' : 'intervals.icu'} first.`);
            queue(auth.user.id, rideId, params.service);
            return {status: 202, body: {queued: true}};
        }, {auth: true});
    }

    function close() {
        for(const t of timers) clearTimeout(t);
        timers.clear();
    }

    return {routes, onRideSaved, uploadsFor, resume, close, stravaConfigured, setIntervalsStatus, setGarminStatus, setOnRemove};
}

module.exports = { createConnections };
