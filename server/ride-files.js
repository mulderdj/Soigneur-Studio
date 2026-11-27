//
// A ride's .fit, for ride analysis in the browser:
//
//   GET /api/me/rides/:id/file
//
// The id says where the ride came from: `garmin-<n>` (Garmin Personal API,
// a ZIP with the .fit), `icu-<n>` (intervals.icu's .fit), anything else a
// ride in this account (`activities`). A file fetched from outside is kept
// (`ride_files`), so it is fetched once; at most capBytes per rider, the
// oldest fetch goes first. Disconnecting a source forgets its files.
//
// Errors answer {error, reason}: not-connected, strava, refused, unreadable,
// not-found. API keys never leave the server.
//

const { firstFitInZip, isFit } = require('./zip.js');

const CAP_BYTES = 500 * 1024 * 1024;
const MESSAGES = {
    'not-connected': 'That service is not connected.',
    'strava': 'intervals.icu doesn\'t hand out rides that came from Strava.',
    'refused': 'The service refused to send this ride.',
    'unreadable': 'The ride\'s file could not be read.',
    'not-found': 'Ride not found.',
};
const STATUS = {'not-connected': 409, 'strava': 404, 'refused': 502, 'unreadable': 502, 'not-found': 404};

let fitToolsPromise = null;
function loadFitTools() {
    fitToolsPromise ??= Promise.all([
        import('../src/training/fit-records.js'),
        import('../src/training/summary.js'),
        import('../src/analytics.js'),
    ]).then(([rec, sum, an]) => ({
        fitToSamples: rec.fitToSamples,
        decouplingOf: sum.decouplingOf,
        durabilityPowers: sum.durabilityPowers,
        DECOUPLING_MIN: sum.DECOUPLING_MIN,
        STEADY_VI: sum.STEADY_VI,
        SessionStats: an.SessionStats,
    }));
    return fitToolsPromise;
}

// aerobic decoupling and durability from a .fit buffer, using the same
// per-second statistics as src/training/summary.js; null when unreadable
async function fitMetrics(fit) {
    if(!fit || fit.length < 14) return null;
    const {fitToSamples, decouplingOf, durabilityPowers, DECOUPLING_MIN, STEADY_VI, SessionStats} = await loadFitTools();
    const view = new DataView(fit.buffer, fit.byteOffset, fit.byteLength);
    const read = fitToSamples(view);
    if(!read.samples.length) return null;
    let hasPower = false, hrN = 0;
    const powers = new Array(read.samples.length);
    for(let i = 0; i < read.samples.length; i++) {
        const s = read.samples[i];
        powers[i] = s.power;
        if(s.power > 0) hasPower = true;
        if(s.heartRate > 0) hrN++;
    }
    if(!hasPower) return {decoupling: null, durability: null};
    const durability = durabilityPowers(powers);
    let decoupling = null;
    if(hrN > 0 && read.samples.length >= DECOUPLING_MIN) {
        const stats = new SessionStats({ftp: read.ftp || 250});
        for(const s of read.samples) stats.push({power: s.power, heartRate: s.heartRate, cadence: s.cadence});
        const {vi} = stats.summary();
        if(vi > 0 && vi <= STEADY_VI) decoupling = decouplingOf(read.samples);
    }
    return {decoupling, durability};
}

class RideFileError extends Error {
    constructor(reason, detail = '') {
        super(detail || MESSAGES[reason]);
        this.reason = reason;
    }
}

function createRideFiles({db, ownFit, garmin, intervals, now = () => Date.now(), capBytes = CAP_BYTES}) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ride_files (
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id         TEXT NOT NULL,
            fit        BLOB NOT NULL,
            bytes      INTEGER NOT NULL,
            fetched_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS ride_file_checked (
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id         TEXT NOT NULL,
            PRIMARY KEY (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS external_rides (
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id         TEXT NOT NULL,
            summary    TEXT NOT NULL,
            day        TEXT NOT NULL,
            fingerprint TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        );
    `);
    const q = {
        get:           db.prepare('SELECT fit FROM ride_files WHERE user_id = ? AND id = ?'),
        put:           db.prepare('INSERT OR REPLACE INTO ride_files (user_id, id, fit, bytes, fetched_at) VALUES (?, ?, ?, ?, ?)'),
        all:           db.prepare('SELECT id, bytes FROM ride_files WHERE user_id = ? ORDER BY fetched_at DESC, rowid DESC'),
        drop:          db.prepare('DELETE FROM ride_files WHERE user_id = ? AND id = ?'),
        forget:        db.prepare('DELETE FROM ride_files WHERE user_id = ? AND id LIKE ?'),
        checked:       db.prepare('SELECT 1 FROM ride_file_checked WHERE user_id = ? AND id = ?'),
        markChecked:   db.prepare('INSERT OR IGNORE INTO ride_file_checked (user_id, id) VALUES (?, ?)'),
        forgetChecked: db.prepare('DELETE FROM ride_file_checked WHERE user_id = ? AND id LIKE ?'),
        extGet:        db.prepare('SELECT summary FROM external_rides WHERE user_id = ? AND id = ?'),
        extSet:        db.prepare('UPDATE external_rides SET summary = ?, updated_at = ? WHERE user_id = ? AND id = ?'),
    };
    const metricsCache = new Map();

    async function metricsFor(userId, id, fit) {
        const key = `${userId}|${id}`;
        if(metricsCache.has(key)) return metricsCache.get(key);
        const m = await fitMetrics(fit).catch(() => null);
        if(metricsCache.size >= 500) metricsCache.delete(metricsCache.keys().next().value);
        metricsCache.set(key, m);
        return m;
    }

    function mergeMetrics(summary, metrics) {
        if(!metrics || (summary?.sport ?? 'cycling') !== 'cycling') return summary;
        return {
            ...summary,
            decoupling: metrics.decoupling ?? summary.decoupling ?? null,
            durability: metrics.durability ?? summary.durability ?? null,
        };
    }

    function applyToExternal(userId, id, metrics) {
        if(!metrics) return;
        const row = q.extGet.get(userId, id);
        if(!row) return;
        let summary;
        try { summary = JSON.parse(row.summary); } catch(e) { return; }
        const next = mergeMetrics(summary, metrics);
        const json = JSON.stringify(next);
        if(json !== row.summary) q.extSet.run(json, now(), userId, id);
    }

    function keep(userId, id, fit) {
        q.put.run(userId, id, fit, fit.length, now());
        let total = 0;
        for(const r of q.all.all(userId)) {         // newest first: the oldest go past the cap
            total += r.bytes;
            if(total > capBytes && r.id !== id) q.drop.run(userId, r.id);
        }
    }

    async function fetchOutside(userId, id) {
        let m;
        if((m = /^garmin-(\d+)$/.exec(id))) {
            const zip = await garmin.download(userId, m[1]);
            const fit = firstFitInZip(zip);
            if(!fit) throw new RideFileError('unreadable', 'Garmin\'s download held no readable .fit.');
            return fit;
        }
        if((m = /^icu-(i?\d+)$/.exec(id))) {
            const fit = await intervals.download(userId, m[1]);
            if(!isFit(fit)) throw new RideFileError('unreadable', 'intervals.icu sent no readable .fit.');
            return fit;
        }
        return null;
    }

    const inFlight = new Map();

    async function get(userId, id) {
        const own = ownFit(userId, id);
        if(own) return Buffer.from(own);
        const kept = q.get.get(userId, id);
        if(kept) {
            const buf = Buffer.from(kept.fit);
            const metrics = await metricsFor(userId, id, buf);
            applyToExternal(userId, id, metrics);
            return buf;
        }
        const key = `${userId}|${id}`;
        let p = inFlight.get(key);
        if(!p) {
            p = (async () => {
                const fit = await fetchOutside(userId, id);
                if(!fit) throw new RideFileError('not-found');
                keep(userId, id, fit);
                q.markChecked.run(userId, id);
                const metrics = await metricsFor(userId, id, fit);
                applyToExternal(userId, id, metrics);
                return fit;
            })().finally(() => inFlight.delete(key));
            inFlight.set(key, p);
        }
        return p;
    }

    // enrich an external cycling summary with decoupling and durability from
    // its .fit (cached in ride_files, or fetched gracefully when allowed)
    async function enrichSummary(userId, summary, {allowDownload = true} = {}) {
        const qualifies = summary?.sport === 'cycling' && !summary.auukiRideId &&
            (summary.avgPower > 0 || summary.np > 0 || summary.kj > 0) &&
            ((summary.duration ?? 0) >= 45 * 60 || (summary.kj ?? 0) >= 1000);
        if(!qualifies) return {summary, downloaded: false};
        const kept = q.get.get(userId, summary.id);
        if(kept) {
            const metrics = await metricsFor(userId, summary.id, Buffer.from(kept.fit));
            return {summary: mergeMetrics(summary, metrics), downloaded: false};
        }
        if(!allowDownload || q.checked.get(userId, summary.id)) return {summary, downloaded: false};
        if(String(summary.remote?.source ?? '').toUpperCase() === 'STRAVA') {
            q.markChecked.run(userId, summary.id);
            return {summary, downloaded: false};
        }
        try {
            const fit = await get(userId, summary.id);
            const metrics = await metricsFor(userId, summary.id, fit);
            return {summary: mergeMetrics(summary, metrics), downloaded: true};
        } catch(e) {
            if(e.reason === 'not-found' || e.reason === 'strava' || e.reason === 'unreadable') {
                q.markChecked.run(userId, summary.id);
            }
            return {summary, downloaded: true};
        }
    }

    function forget(userId, service) {
        const prefix = service === 'garmin' ? 'garmin-' : service === 'intervals' ? 'icu-' : null;
        if(prefix) {
            q.forget.run(userId, `${prefix}%`);
            q.forgetChecked.run(userId, `${prefix}%`);
            for(const k of metricsCache.keys()) {
                if(k.startsWith(`${userId}|${prefix}`)) metricsCache.delete(k);
            }
        }
    }

    function routes(route, {validId}) {
        route('GET', '/api/me/rides/:id/file', async ({auth, params}) => {
            const id = validId(params.id);
            try {
                const fit = await get(auth.user.id, id);
                return {raw: fit, headers: {'Content-Type': 'application/vnd.ant.fit', 'Cache-Control': 'private, max-age=86400', 'Vary': 'Authorization'}};
            } catch(e) {
                const reason = e.reason ?? 'refused';
                return {status: STATUS[reason] ?? 502, body: {error: e.message || MESSAGES[reason], reason}};
            }
        }, {auth: true});
    }

    return {get, forget, enrichSummary, routes};
}

module.exports = { createRideFiles, fitMetrics, RideFileError, MESSAGES };
