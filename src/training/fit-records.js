// @ts-check
//
// Reads a .fit activity back into per-second samples via @garmin/fitsdk.
//
//   fitToSamples(view): what the ride summaries use (0 for a missing value)
//   readRide(view):     for ride analysis — 1 s samples from the start, with
//                       null for a missing value, laps, pauses, the sport
//
// Neither throws: a file that can't be read gives no samples.
//

import { decodeFit } from '../fit/decoder.js';

const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z

/**
 * @param {any} timestamp
 * @returns {number | null}
 */
function toMs(timestamp) {
    if(timestamp instanceof Date) return Number.isFinite(timestamp.getTime()) ? timestamp.getTime() : null;
    if(typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
    // FIT stores seconds since its own epoch; the decoder / app hands back Unix ms
    return timestamp < 1e10 ? (timestamp + FIT_EPOCH_S) * 1000 : timestamp;
}

/**
 * @param {any} x
 * @param {number} max
 * @returns {number | null}
 */
function valid(x, max) {
    return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < max ? x : null;
}

/**
 * Extract cadence (preserving fractional running/cycling cadence when present).
 * @param {Record<string, any>} f
 * @returns {number | null}
 */
function readCadence(f) {
    const base = valid(f.cadence, 255);
    if(base === null) return null;
    const frac = valid(f.fractional_cadence, 1);
    return frac !== null ? base + frac : base;
}

// the FTP the ride was ridden with: the session's threshold power (the app
// writes it; Garmin's files often have it too), or null
/**
 * @param {Array<{ type?: string, name?: string, fields?: Record<string, any> }>} [decoded]
 * @returns {number | null}
 */
function ftpOf(decoded) {
    for(const r of decoded ?? []) {
        if(r?.type !== 'data' || r.name !== 'session') continue;
        const w = r.fields?.threshold_power;
        if(typeof w === 'number' && Number.isFinite(w) && w >= 30 && w <= 1000) return w;
    }
    return null;
}

/**
 * @param {ArrayBuffer | ArrayBufferView} view
 */
function fitToSamples(view) {
    let records;
    try {
        records = decodeFit(view);
    } catch {
        records = [];
    }
    const data = (records ?? []).filter(r => r?.type === 'data' && r?.name === 'record' && r.fields);
    if(data.length === 0) return {start: null, distance: null, ftp: ftpOf(records), samples: []};

    const samples = data.map(r => ({
        power:     valid(r.fields.power, 4000) ?? 0,
        heartRate: valid(r.fields.heart_rate, 255) ?? 0,
        cadence:   readCadence(r.fields) ?? 0,
        speed:     valid(r.fields.speed, 100) ?? valid(r.fields.enhanced_speed, 100),
        distance:  valid(r.fields.distance, 1e7),
    }));
    const lastDistance = [...samples].reverse().find(s => s.distance !== null)?.distance ?? null;

    return {start: toMs(data[0].fields.timestamp), distance: lastDistance, ftp: ftpOf(records), samples};
}

// --- ride analysis ---------------------------------------------------------

const HOLD_S = 15;      // a value is held this long (smart recording writes every few seconds); a longer gap is a pause

const SEMICIRCLE_TO_DEG = 180 / 2147483648;
const SINT32_INVALID = 0x7fffffff;

/**
 * @param {any} x
 * @param {number} limit
 * @returns {number | null}
 */
function toDeg(x, limit) {
    if(typeof x !== 'number' || !Number.isFinite(x) || x === SINT32_INVALID || x === -2147483648) return null;
    const deg = Math.abs(x) <= 180 ? x : x * SEMICIRCLE_TO_DEG;
    return Math.abs(deg) <= limit ? deg : null;
}

/**
 * @param {Record<string, any> | undefined} f
 */
function gpsPair(f) {
    const lat = toDeg(f?.position_lat, 90);
    const lon = toDeg(f?.position_long, 180);
    if(lat === null || lon === null) return null;
    if(lat === 0 && lon === 0) return null;
    return {lat, lon};
}

/**
 * @param {any} x
 * @returns {number | null}
 */
function altitude(x) {
    return typeof x === 'number' && Number.isFinite(x) && x > -500 && x < 9000 ? x : null;
}

/**
 * @param {any} x
 * @param {number} min
 * @param {number} max
 * @returns {number | null}
 */
function rangeValid(x, min, max) {
    return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null;
}

/** @type {Record<string, (f: Record<string, any>) => number | null>} */
const BASE_FIELDS = {
    power:     f => valid(f.power, 4000),
    heartRate: f => valid(f.heart_rate, 255),
    cadence:   f => readCadence(f),
    speed:     f => valid(f.speed, 100) ?? valid(f.enhanced_speed, 100),
    distance:  f => valid(f.distance, 1e7),
    altitude:  f => altitude(f.altitude) ?? altitude(f.enhanced_altitude),
    lat:       f => gpsPair(f)?.lat ?? null,
    lon:       f => gpsPair(f)?.lon ?? null,
};
const BASE_KEYS = Object.keys(BASE_FIELDS);

// Optional running, cycling dynamics, and physiological fields preserved when present in the file
/** @type {Record<string, (f: Record<string, any>) => number | null>} */
const EXTRA_FIELDS = {
    stanceTime:          f => rangeValid(f.stance_time, 1, 2000),
    verticalOscillation: f => rangeValid(f.vertical_oscillation, 1, 500),
    stepLength:          f => rangeValid(f.step_length, 10, 5000),
    verticalRatio:       f => rangeValid(f.vertical_ratio, 0.1, 100),
    stanceTimeBalance:   f => rangeValid(f.stance_time_balance, 1, 99),
    leftRightBalance:    f => valid(f.left_right_balance, 255),
    smo2:                f => rangeValid(f.saturated_hemoglobin_percent, 0, 100),
    thb:                 f => rangeValid(f.total_hemoglobin_conc, 0.1, 40),
    coreTemperature:     f => rangeValid(f.core_temperature, 30, 45),
    temperature:         f => rangeValid(f.temperature, -60, 70),
    respirationRate:     f => rangeValid(f.respiration_rate ?? f.enhanced_respiration_rate, 1, 120),
};
const EXTRA_KEYS = Object.keys(EXTRA_FIELDS);

/** @type {Record<string, (f: Record<string, any>) => number | null>} */
const ALL_FIELDS = {...BASE_FIELDS, ...EXTRA_FIELDS};

// records ({timestamp, power, heart_rate, …}) → 1 s samples {t, power, heartRate, cadence,
// speed, distance, altitude, lat, lon, ...optionalDynamics}; laps ({start_time, timestamp}) → [{start, end}] in seconds
const STOP = new Set([1, 4, 8, 9, 'stop', 'stop_all', 'stop_disable', 'stop_disable_all', 'stopAll', 'stopDisable', 'stopDisableAll']);
const START = new Set([0, 'start']);
/** @param {Record<string, any> | undefined} e */
const isTimer = e => e?.event === 0 || e?.event === 'timer' || e?.event === undefined;

// [{start, end}] in ms from the file's timer stop/start events (the app's
// pause and auto-pause, a head unit's auto-pause)
/**
 * @param {Array<Record<string, any>>} [events]
 */
function timerPauses(events = []) {
    /** @type {Array<{ start: number, end: number }>} */
    const out = [];
    /** @type {number | null} */
    let stopped = null;
    const timerEvents = [...events]
        .filter(isTimer)
        .sort((a, b) => (toMs(a.timestamp) ?? 0) - (toMs(b.timestamp) ?? 0));
    for(const e of timerEvents) {
        const ms = toMs(e.timestamp);
        if(ms === null || !Number.isFinite(ms)) continue;
        if(STOP.has(e.event_type)) {
            if(stopped === null) stopped = ms;
        } else if(START.has(e.event_type) && stopped !== null) {
            if(ms > stopped) out.push({start: stopped, end: ms});
            stopped = null;
        }
    }
    return out;
}

/**
 * @param {Array<Record<string, any>>} [records]
 * @param {Array<Record<string, any>>} [lapRecords]
 * @param {Array<Record<string, any>>} [eventRecords]
 */
function samplesFromRecords(records = [], lapRecords = [], eventRecords = []) {
    const rows = /** @type {Array<{ ms: number, f: Record<string, any> }>} */ (
        records
            .map(f => ({ms: toMs(f?.timestamp), f}))
            .filter(r => r.ms !== null && Number.isFinite(r.ms))
    ).sort((a, b) => a.ms - b.ms);
    if(rows.length === 0) return {start: null, samples: [], laps: [], pauses: [], recorded: 0};

    const presentExtras = EXTRA_KEYS.filter(k => rows.some(({f}) => EXTRA_FIELDS[k](f) !== null));
    const keys = presentExtras.length > 0 ? [...BASE_KEYS, ...presentExtras] : BASE_KEYS;

    const start = rows[0].ms;
    /** @param {number} ms */
    const sec = ms => Math.round((ms - start) / 1000);
    /** @type {Record<string, number>} */
    const last = {};
    /** @type {Record<string, number>} */
    const seen = {};
    /** @type {Array<Record<string, any>>} */
    const samples = [];
    /** @type {Array<{ start: number, end: number }>} */
    const pauses = [];
    /** @param {number} t */
    const sample = t => {
        /** @type {Record<string, any>} */
        const s = {t};
        for(const k of keys) s[k] = seen[k] !== undefined && t - seen[k] <= HOLD_S ? last[k] : null;
        return s;
    };
    /** @param {number} t */
    const emptySample = t => {
        /** @type {Record<string, any>} */
        const s = {t};
        for(const k of keys) s[k] = null;
        return s;
    };

    let prev = -1;
    for(const {ms, f} of rows) {
        const t = sec(ms);
        if(t < prev) continue;
        if(t === prev) {                                  // two records in one second: merge
            for(const k of keys) { const v = ALL_FIELDS[k](f); if(v !== null) { last[k] = v; seen[k] = t; } }
            samples[t] = sample(t);
            continue;
        }
        const pause = prev >= 0 && t - prev > HOLD_S;
        if(pause) pauses.push({start: prev + 1, end: t});
        for(let g = prev + 1; g < t; g++) samples[g] = pause ? emptySample(g) : sample(g);
        for(const k of keys) { const v = ALL_FIELDS[k](f); if(v !== null) { last[k] = v; seen[k] = t; } }
        samples[t] = sample(t);
        prev = t;
    }
    // pauses the file marks with timer events, however short
    for(const p of timerPauses(eventRecords)) {
        const a = Math.max(0, sec(p.start)), b = Math.min(samples.length, sec(p.end));
        if(b <= a) continue;
        for(let t = a; t < b; t++) samples[t] = emptySample(t);
        pauses.push({start: a, end: b});
    }
    pauses.sort((x, y) => x.start - y.start);
    /** @type {Array<{ start: number, end: number }>} */
    const merged = [];
    for(const p of pauses) {
        const tail = merged.at(-1);
        if(tail && p.start <= tail.end) tail.end = Math.max(tail.end, p.end);
        else merged.push({...p});
    }
    pauses.length = 0;
    pauses.push(...merged);
    const laps = (lapRecords ?? [])
        .map(l => {
            const lapStart = toMs(l?.start_time);
            const elapsed = lapStart !== null && Number.isFinite(l?.total_elapsed_time)
                ? lapStart + l.total_elapsed_time * 1000
                : null;
            // Garmin's lap timestamp can read as the ride's start: start + elapsed time first
            return {start: lapStart, end: elapsed ?? toMs(l?.timestamp)};
        })
        .filter(l => l.start !== null && l.end !== null && Number.isFinite(l.start) && Number.isFinite(l.end) && l.end > l.start)
        .map(l => ({start: Math.max(0, sec(/** @type {number} */ (l.start))), end: sec(/** @type {number} */ (l.end))}));
    return {start, samples, laps, pauses, recorded: rows.length};
}

/**
 * @param {ArrayBuffer | ArrayBufferView} view
 */
function readRide(view) {
    let decoded;
    try {
        decoded = decodeFit(view) ?? [];
    } catch {
        decoded = [];
    }
    const data = decoded.filter(r => r?.type === 'data' && r.fields);
    /** @param {string} name */
    const of = name => data.filter(r => r.name === name).map(r => r.fields);
    const out = samplesFromRecords(of('record'), of('lap'), of('event'));
    const sport = of('session')[0]?.sport ?? of('sport')[0]?.sport ?? null;
    return {...out, sport: typeof sport === 'string' ? sport : null, ftp: ftpOf(decoded)};
}

export { fitToSamples, readRide, samplesFromRecords, HOLD_S };
