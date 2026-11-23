//
// A ride summary: the small record the Training page works from. Built
// from per-second samples with the same statistics engine as the live
// dashboard, so the numbers match what the rider saw while riding.
//

import { SessionStats } from '../analytics.js';
import { localDay } from './dates.js';

const SUMMARY_VERSION = 1;
const BEST_SECONDS = [5, 60, 300, 1200, 3600];

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
    const best = {};
    for(const seconds of BEST_SECONDS) {
        const b = sum.best.find(x => x.seconds === seconds);
        best[seconds] = hasPower && b?.available && b.watts > 0 ? Math.round(b.watts) : null;
    }
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

export { rideSummary, SUMMARY_VERSION, BEST_SECONDS };
