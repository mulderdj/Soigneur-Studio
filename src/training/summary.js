// @ts-check
//
// A ride summary: the small record the Training page works from. Built
// from per-second samples with the same statistics engine as the live
// dashboard, so the numbers match what the rider saw while riding.
//

import { SessionStats } from '../analytics.js';
import { localDay } from './dates.js';

const SUMMARY_VERSION = 4;   // 2: best power at 21 durations (the rider model); 3: the ride's own FTP, read again; 4: aerobic decoupling and durability
// the durations (s) kept for the rider model: same list as server/durations.js
const DURATIONS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 420, 600, 720, 900, 1200, 1800, 2700, 3600, 5400, 7200];
const BEST_SECONDS = DURATIONS;
const DECOUPLING_MIN = 45 * 60;           // s of riding
const DECOUPLING_SKIP = 10 * 60;          // s of warm-up left out
const STEADY_VI = 1.10;                   // decoupling only when NP is within 10 % of average power (steady riding)
const DURABILITY_KJ = [1000, 2000, 3000];
const DURABILITY_WINDOWS = [300, 1200];   // 5 and 20 min

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

// best average power over `seconds` in `powers` starting at index `from`
function bestWindowFrom(powers, from, seconds) {
    if(powers.length - from < seconds) return null;
    let sum = 0, best = 0;
    for(let i = from; i < powers.length; i++) {
        sum += powers[i] > 0 ? powers[i] : 0;
        if(i - from >= seconds) sum -= powers[i - seconds] > 0 ? powers[i - seconds] : 0;
        if(i - from >= seconds - 1 && sum > best) best = sum;
    }
    return best > 0 ? Math.round(best / seconds) : null;
}

// aerobic decoupling (Pa:HR, %): (power ÷ HR) second half against first half,
// excluding the first 10 minutes; null under 45 minutes or without enough paired data
function decouplingOf(samples) {
    if(samples.length < DECOUPLING_MIN) return null;
    const rest = samples.slice(DECOUPLING_SKIP);
    const half = Math.floor(rest.length / 2);
    const ef = list => {
        let pSum = 0, hSum = 0, n = 0;
        for(const s of list) {
            if(s.power > 0 && s.heartRate > 0) { pSum += s.power; hSum += s.heartRate; n++; }
        }
        return n >= 60 ? (pSum / n) / (hSum / n) : null;
    };
    const a = ef(rest.slice(0, half)), b = ef(rest.slice(half));
    return a && b ? round((a - b) / a * 100, 1) : null;
}

// best 5 and 20 min power after 1,000 / 2,000 / 3,000 kJ of cumulative work;
// null when the ride never reaches 1,000 kJ with at least 5 min remaining
function durabilityPowers(powers) {
    let kj = 0, next = 0;
    const out = {};
    for(let i = 0; i < powers.length && next < DURABILITY_KJ.length; i++) {
        kj += (powers[i] > 0 ? powers[i] : 0) / 1000;
        while(next < DURABILITY_KJ.length && kj >= DURABILITY_KJ[next]) {
            const threshold = DURABILITY_KJ[next++];
            const b5 = bestWindowFrom(powers, i + 1, DURABILITY_WINDOWS[0]);
            const b20 = bestWindowFrom(powers, i + 1, DURABILITY_WINDOWS[1]);
            if(b5 !== null || b20 !== null) out[threshold] = {300: b5, 1200: b20};
        }
    }
    return Object.keys(out).length ? out : null;
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
    const powers = samples.map(s => s.power);
    const all = bestPowers(powers);
    const best = Object.fromEntries(DURATIONS.map(d => [d, hasPower ? all[d] : null]));
    const power = (x, d) => (hasPower ? round(x, d) : null);
    // heart rate, for a load when there is no power (dropouts don't count)
    let hrSum = 0, hrN = 0, hrMax = 0;
    for(const s of samples) {
        if(s.heartRate > 0) { hrSum += s.heartRate; hrN++; if(s.heartRate > hrMax) hrMax = s.heartRate; }
    }
    const steady = hasPower && sum.vi > 0 && sum.vi <= STEADY_VI;

    return {
        version:    SUMMARY_VERSION,
        id:         meta.id,
        start:      meta.start,
        day:        localDay(meta.start),
        name:       meta.name ?? 'Free ride',
        workoutId:  meta.workoutId ?? null,
        duration:   samples.length,
        distance:   Number.isFinite(meta.distance) ? meta.distance : null,
        tss:        power(sum.tss, 1),
        if:         power(sum.intensity, 3),
        np:         power(sum.np, 0),
        avgPower:   power(sum.avgPower, 0),
        kj:         power(sum.kj, 0),
        zoneSeconds: sum.zones.map(z => (hasPower ? z.seconds : 0)),
        best,
        decoupling: hasPower && hrN > 0 && steady ? decouplingOf(samples) : null,
        durability: hasPower ? durabilityPowers(powers) : null,
        avgHr:      hrN ? Math.round(hrSum / hrN) : null,
        maxHr:      hrN ? hrMax : null,
        ftp:        sum.ftp,
        weight:     sum.weight,
    };
}

export {
    rideSummary, SUMMARY_VERSION, BEST_SECONDS, DURATIONS, bestPowers,
    decouplingOf, durabilityPowers, DECOUPLING_MIN, DECOUPLING_SKIP, STEADY_VI, DURABILITY_KJ,
};
