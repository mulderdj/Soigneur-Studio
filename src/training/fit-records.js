//
// Reads a .fit activity back into per-second samples.
//
//   fitToSamples(view): what the ride summaries use (0 for a missing value)
//   readRide(view):     for ride analysis — 1 s samples from the start, with
//                       null for a missing value, laps, pauses, the sport
//
// Neither throws: a file that can't be read gives no samples.
//

import { FITjs } from '../fit/fitjs.js';

const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z

function toMs(timestamp) {
    if(!Number.isFinite(timestamp)) return null;
    // FIT stores seconds since its own epoch; the app's encoder may hand back ms
    return timestamp < 1e10 ? (timestamp + FIT_EPOCH_S) * 1000 : timestamp;
}

function valid(x, max) {
    return Number.isFinite(x) && x >= 0 && x < max ? x : null;
}

function fitToSamples(view) {
    let records;
    try {
        records = FITjs.decode(view);
    } catch(e) {
        records = [];
    }
    const data = (records ?? []).filter(r => r?.type === 'data' && r?.name === 'record' && r.fields);
    if(data.length === 0) return {start: null, distance: null, samples: []};

    const samples = data.map(r => ({
        power:     valid(r.fields.power, 4000) ?? 0,
        heartRate: valid(r.fields.heart_rate, 255) ?? 0,
        cadence:   valid(r.fields.cadence, 255) ?? 0,
        speed:     valid(r.fields.speed, 100),
        distance:  valid(r.fields.distance, 1e7),
    }));
    const lastDistance = [...samples].reverse().find(s => s.distance !== null)?.distance ?? null;

    return {start: toMs(data[0].fields.timestamp), distance: lastDistance, samples};
}

// --- ride analysis ---------------------------------------------------------

const HOLD_S = 15;      // a value is held this long (smart recording writes every few seconds); a longer gap is a pause

const FIELDS = {
    power:     f => valid(f.power, 4000),
    heartRate: f => valid(f.heart_rate, 255),
    cadence:   f => valid(f.cadence, 255),
    speed:     f => valid(f.speed, 100) ?? valid(f.enhanced_speed, 100),
    distance:  f => valid(f.distance, 1e7),
    altitude:  f => altitude(f.altitude) ?? altitude(f.enhanced_altitude),
};
const KEYS = Object.keys(FIELDS);

function altitude(x) {
    return Number.isFinite(x) && x > -500 && x < 9000 ? x : null;
}

// records ({timestamp, power, heart_rate, …}) → 1 s samples {t, power, heartRate, cadence,
// speed, distance, altitude}; laps ({start_time, timestamp}) → [{start, end}] in seconds
function samplesFromRecords(records = [], lapRecords = []) {
    const rows = records
        .map(f => ({ms: toMs(f?.timestamp), f}))
        .filter(r => Number.isFinite(r.ms))
        .sort((a, b) => a.ms - b.ms);
    if(rows.length === 0) return {start: null, samples: [], laps: [], pauses: [], recorded: 0};

    const start = rows[0].ms;
    const sec = ms => Math.round((ms - start) / 1000);
    const last = {}, seen = {};
    const samples = [];
    const pauses = [];
    const sample = t => {
        const s = {t};
        for(const k of KEYS) s[k] = seen[k] !== undefined && t - seen[k] <= HOLD_S ? last[k] : null;
        return s;
    };
    let prev = -1;
    for(const {ms, f} of rows) {
        const t = sec(ms);
        if(t < prev) continue;
        if(t === prev) {                                  // two records in one second: merge
            for(const k of KEYS) { const v = FIELDS[k](f); if(v !== null) { last[k] = v; seen[k] = t; } }
            samples[t] = sample(t);
            continue;
        }
        const pause = prev >= 0 && t - prev > HOLD_S;
        if(pause) pauses.push({start: prev + 1, end: t});
        for(let g = prev + 1; g < t; g++) samples[g] = pause ? {t: g, ...Object.fromEntries(KEYS.map(k => [k, null]))} : sample(g);
        for(const k of KEYS) { const v = FIELDS[k](f); if(v !== null) { last[k] = v; seen[k] = t; } }
        samples[t] = sample(t);
        prev = t;
    }
    const laps = (lapRecords ?? [])
        .map(l => ({start: toMs(l?.start_time), end: toMs(l?.timestamp)}))
        .filter(l => Number.isFinite(l.start) && Number.isFinite(l.end) && l.end > l.start)
        .map(l => ({start: Math.max(0, sec(l.start)), end: sec(l.end)}));
    return {start, samples, laps, pauses, recorded: rows.length};
}

function readRide(view) {
    let decoded;
    try {
        decoded = FITjs.decode(view) ?? [];
    } catch(e) {
        decoded = [];
    }
    const data = decoded.filter(r => r?.type === 'data' && r.fields);
    const of = name => data.filter(r => r.name === name).map(r => r.fields);
    const out = samplesFromRecords(of('record'), of('lap'));
    const sport = of('session')[0]?.sport ?? of('sport')[0]?.sport ?? null;
    return {...out, sport: typeof sport === 'string' ? sport : null};
}

export { fitToSamples, readRide, samplesFromRecords, HOLD_S };
