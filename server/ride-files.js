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
    `);
    const q = {
        get:    db.prepare('SELECT fit FROM ride_files WHERE user_id = ? AND id = ?'),
        put:    db.prepare('INSERT OR REPLACE INTO ride_files (user_id, id, fit, bytes, fetched_at) VALUES (?, ?, ?, ?, ?)'),
        all:    db.prepare('SELECT id, bytes FROM ride_files WHERE user_id = ? ORDER BY fetched_at DESC, rowid DESC'),
        drop:   db.prepare('DELETE FROM ride_files WHERE user_id = ? AND id = ?'),
        forget: db.prepare('DELETE FROM ride_files WHERE user_id = ? AND id LIKE ?'),
    };

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

    async function get(userId, id) {
        const own = ownFit(userId, id);
        if(own) return Buffer.from(own);
        const kept = q.get.get(userId, id);
        if(kept) return Buffer.from(kept.fit);
        const fit = await fetchOutside(userId, id);
        if(!fit) throw new RideFileError('not-found');
        keep(userId, id, fit);
        return fit;
    }

    function forget(userId, service) {
        const prefix = service === 'garmin' ? 'garmin-' : service === 'intervals' ? 'icu-' : null;
        if(prefix) q.forget.run(userId, `${prefix}%`);
    }

    function routes(route, {validId}) {
        route('GET', '/api/me/rides/:id/file', async ({auth, params}) => {
            const id = validId(params.id);
            try {
                const fit = await get(auth.user.id, id);
                return {raw: fit, headers: {'Content-Type': 'application/vnd.ant.fit', 'Cache-Control': 'private, max-age=86400'}};
            } catch(e) {
                const reason = e.reason ?? 'refused';
                return {status: STATUS[reason] ?? 502, body: {error: e.message || MESSAGES[reason], reason}};
            }
        }, {auth: true});
    }

    return {get, forget, routes};
}

module.exports = { createRideFiles, RideFileError, MESSAGES };
