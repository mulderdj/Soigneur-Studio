//
// Reads a .fit activity back into per-second samples, so rides saved
// before ride summaries existed can get one. Never throws: a file that
// can't be read gives no samples.
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

export { fitToSamples };
