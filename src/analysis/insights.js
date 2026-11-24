//
// The numbers behind the extra charts, pure.
//
// Per ride (samples as readRide gives them: 1 s, {t, power, heartRate, …}):
//   efforts(analysis, ftp)                 → the efforts: work intervals, or laps at ≥ 88 % FTP
//   reps(analysis, ftp)                    → [{n, start, end, power, target, hr, maxHr}]
//   hrRecovery(samples, analysis, ftp, pauses) → [{n, end, hrEnd, hr60, drop}]
//   rideCurve(samples)                     → {seconds: watts} at the rider-model durations
//   powerHr(samples, pauses)               → [{t, power, hr, half: 1|2}] 30 s averages
//
// Over time (ride summaries, wellness days):
//   efficiency(summaries)                  → [{day, ef, name, id}] steady rides, and .rolling
//   readinessPairs(summaries, wellness, x) → {points: [{day, x, y, name}], r, n}
//   polarised(summaries, today, weeks)     → [{week, easy, middle, hard, seconds}] shares 0–1
//

import { bestPowers, DURATIONS } from '../training/summary.js';
import { hrvRangeOn } from '../training/wellness.js';

const num = x => Number.isFinite(x);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 0) => (num(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const WORK = 0.88;
const RECOVERY = 60, RECOVERY_MIN = 30;
const STEADY_IF = 0.85, STEADY_MIN = 30 * 60;

function addDays(day, n) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

const inPause = (t, pauses = []) => pauses.some(p => t >= p.start && t < p.end);
const slice = (samples, start, end) => samples.filter(s => s.t >= start && s.t < end);

// --- per ride ---------------------------------------------------------------

function efforts(analysis, ftp) {
    const ivs = (analysis?.intervals ?? []).filter(iv => num(iv.start) && num(iv.end) && iv.end > iv.start);
    const work = ivs.filter(iv => iv.kind === 'work');
    if(work.length) return work;
    return ivs.filter(iv => iv.kind === 'lap' && num(iv.stats?.avgPower) && ftp > 0 && iv.stats.avgPower >= WORK * ftp);
}

function reps(analysis, ftp) {
    return efforts(analysis, ftp).map((iv, i) => ({
        n: i + 1, start: iv.start, end: iv.end,
        power: iv.stats?.avgPower ?? null,
        target: num(iv.stats?.avgTarget) && iv.stats.avgTarget > 0 ? iv.stats.avgTarget : (num(iv.target) && iv.target > 0 ? iv.target : null),
        hr: iv.stats?.avgHr ?? null,
        maxHr: iv.stats?.maxHr ?? null,
    }));
}

function hrRecovery(samples = [], analysis, ftp, pauses = []) {
    const byT = new Map(samples.map(s => [s.t, s]));
    const hrAt = t => { const h = byT.get(t)?.heartRate; return num(h) && h > 0 ? h : null; };
    const out = [];
    efforts(analysis, ftp).forEach((iv, i) => {
        if(iv.end - iv.start < RECOVERY_MIN) return;
        const last = [];
        for(let t = iv.end - 5; t < iv.end; t++) { const h = hrAt(t); if(h) last.push(h); }
        if(!last.length) return;
        const hrEnd = Math.max(...last);
        const at = iv.end + RECOVERY;
        // the next minute must be ridden (not paused) and have a heart rate at its end
        for(let t = iv.end; t <= at; t++) if(inPause(t, pauses)) return;
        let hr60 = null;
        for(let t = at; t >= at - 2 && hr60 === null; t--) hr60 = hrAt(t);
        if(hr60 === null) return;
        out.push({n: i + 1, end: iv.end, hrEnd, hr60, drop: hrEnd - hr60});
    });
    return out.length >= 2 ? out : [];
}

function rideCurve(samples = []) {
    const all = bestPowers(samples.map(s => s.power));
    return Object.fromEntries(DURATIONS.map(d => [d, all[d] ?? null]));
}

function powerHr(samples = [], pauses = [], window = 30) {
    const ridden = samples.filter(s => !inPause(s.t, pauses));
    if(ridden.length < 20 * 60) return [];
    const points = [];
    for(let i = 0; i + window <= ridden.length; i += window) {
        const chunk = ridden.slice(i, i + window);
        const p = chunk.map(s => s.power).filter(x => num(x) && x > 0);
        const h = chunk.map(s => s.heartRate).filter(x => num(x) && x > 0);
        if(p.length < window * 0.8 || h.length < window * 0.8) continue;
        points.push({t: chunk[0].t, power: Math.round(mean(p)), hr: Math.round(mean(h))});
    }
    const mid = ridden[Math.floor(ridden.length / 2)].t;
    return points.length >= 10 ? points.map(pt => ({...pt, half: pt.t < mid ? 1 : 2})) : [];
}

// --- over time --------------------------------------------------------------

const steady = s => (s.sport ?? 'cycling') === 'cycling' && num(s.np) && s.np > 0 && num(s.avgHr) && s.avgHr > 0 &&
    (s.duration ?? 0) >= STEADY_MIN && num(s.if) && s.if <= STEADY_IF;

function efficiency(summaries = [], rollDays = 28) {
    const list = summaries.filter(steady)
        .map(s => ({day: s.day, ef: round(s.np / s.avgHr, 2), name: s.name, id: s.id}))
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const rolling = list.map(p => {
        const from = addDays(p.day, -(rollDays - 1));
        return round(mean(list.filter(q => q.day >= from && q.day <= p.day).map(q => q.ef)), 2);
    });
    return Object.assign(list, {rolling});
}

function median(xs) {
    if(!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pearson(points) {
    const n = points.length;
    if(n < 3) return null;
    const mx = mean(points.map(p => p.x)), my = mean(points.map(p => p.y));
    let sxy = 0, sxx = 0, syy = 0;
    for(const p of points) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
    return sxx > 0 && syy > 0 ? round(sxy / Math.sqrt(sxx * syy), 2) : null;
}

// x: 'hrv' (that morning's HRV against the middle of its normal range, %) or
// 'sleep' (hours); y: the ride's efficiency against the median of the
// steady rides in the 42 days before it (%)
function readinessPairs(summaries = [], wellness = [], x = 'hrv', {minRides = 8, baseDays = 42} = {}) {
    const rides = efficiency(summaries);
    const byDay = new Map(wellness.map(d => [d.day, d]));
    const points = [];
    for(const r of rides) {
        const before = rides.filter(q => q.day < r.day && q.day >= addDays(r.day, -baseDays)).map(q => q.ef);
        if(before.length < 3) continue;
        const base = median(before);
        const night = byDay.get(r.day);
        let xv = null;
        if(x === 'sleep') xv = num(night?.sleepSeconds) && night.sleepSeconds > 0 ? round(night.sleepSeconds / 3600, 1) : null;
        else if(num(night?.hrv)) {
            const range = hrvRangeOn(r.day, wellness);
            if(range) xv = round((night.hrv / ((range.low + range.high) / 2) - 1) * 100, 1);
        }
        if(xv === null) continue;
        points.push({day: r.day, x: xv, y: round((r.ef / base - 1) * 100, 1), name: r.name, id: r.id});
    }
    const enough = points.length >= minRides;
    return {points, n: points.length, r: enough ? pearson(points) : null, enough};
}

// Monday of the week (UTC days)
function weekOf(day) {
    const d = new Date(`${day}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7;
    return addDays(day, -dow);
}

// the share of easy (Z1–Z2), middle (Z3–Z5) and hard (Z6–Z7) riding per week
function polarised(summaries = [], today, weeks = 52) {
    const first = addDays(weekOf(today), -7 * (weeks - 1));
    const out = new Map();
    for(let w = first; w <= today; w = addDays(w, 7)) out.set(w, [0, 0, 0]);
    for(const s of summaries) {
        const z = s.zoneSeconds;
        if(!Array.isArray(z) || !s.day) continue;
        const bucket = out.get(weekOf(s.day));
        if(!bucket) continue;
        bucket[0] += (z[0] ?? 0) + (z[1] ?? 0);
        bucket[1] += (z[2] ?? 0) + (z[3] ?? 0) + (z[4] ?? 0);
        bucket[2] += (z[5] ?? 0) + (z[6] ?? 0);
    }
    return [...out.entries()].map(([week, [e, m, h]]) => {
        const total = e + m + h;
        return {week, seconds: total, easy: total ? e / total : 0, middle: total ? m / total : 0, hard: total ? h / total : 0};
    });
}

export { efforts, reps, hrRecovery, rideCurve, powerHr, efficiency, readinessPairs, polarised, pearson, weekOf };
