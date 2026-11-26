//
// A ride summary: the small record the Training page works from. Built
// from per-second samples with the same statistics engine as the live
// dashboard, so the numbers match what the rider saw while riding.
//

import { SessionStats } from '../analytics.js';
import { localDay } from './dates.js';

const SUMMARY_VERSION = 3;   // 2: best power at 21 durations (the rider model); 3: the ride's own FTP, read again
// the durations (s) kept for the rider model: same list as server/durations.js
const DURATIONS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200];
const BEST_SECONDS = DURATIONS;

// the best average power over each duration (rolling sums); null when the
// ride is shorter than the duration
function bestPowers(powers) {
    const out = {};
    const prefix = new Float64Array(powers.length + 1);
    for(let i = 0; i < powers.length; i++) prefix[i + 1] = prefix[i] + (powers[i] > 0 ? powers[i] : 0);
    for(const d of DURATIONS) {
        if(powers.length < d) { out[d] = null; continue; }
        let best = 0;
        for(let i = d; i <= powers.length; i++) { const s = prefix[i] - prefix[i - d]; if(s > best) best = s; }
        out[d] = best > 0 ? Math.round(best / d) : null;
    }
    return out;
}

function round(x, digits = 1) {
    const f = 10 ** digits;
    return Math.round(x * f) / f;
}

function rideSummary(samples, meta = {}) {
    const stats = new SessionStats({ftp: meta.ftp, weight: meta.weight});
    let hasPower = false;
    for(const s of samples) {
        if(s.power > 0) hasPower = true;
        stats.push({power: s.power, heartRate: s.heartRate, cadence: s.cadence});
    }
    const sum = stats.summary();
    const all = bestPowers(samples.map(s => s.power));
    const best = Object.fromEntries(DURATIONS.map(d => [d, hasPower ? all[d] : null]));
    const power = (x, d) => (hasPower ? round(x, d) : null);
    // heart rate, for a load when there is no power (dropouts don't count)
    let hrSum = 0, hrN = 0, hrMax = 0;
    for(const s of samples) {
        if(s.heartRate > 0) { hrSum += s.heartRate; hrN++; if(s.heartRate > hrMax) hrMax = s.heartRate; }
    }

    return {
        version:   SUMMARY_VERSION,
        id:        meta.id,
        start:     meta.start,
        day:       localDay(meta.start),
        name:      meta.name ?? 'Free ride',
        workoutId: meta.workoutId ?? null,
        duration:  samples.length,
        distance:  Number.isFinite(meta.distance) ? meta.distance : null,
        tss:       power(sum.tss, 1),
        if:        power(sum.intensity, 3),
        np:        power(sum.np, 0),
        avgPower:  power(sum.avgPower, 0),
        kj:        power(sum.kj, 0),
        zoneSeconds: sum.zones.map(z => (hasPower ? z.seconds : 0)),
        best,
        avgHr:     hrN ? Math.round(hrSum / hrN) : null,
        maxHr:     hrN ? hrMax : null,
        ftp:       sum.ftp,
        weight:    sum.weight,
    };
}

export { rideSummary, SUMMARY_VERSION, BEST_SECONDS, DURATIONS, bestPowers };
