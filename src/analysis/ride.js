//
// One ride, analysed: per interval, planned against actual, and the whole
// ride (W′bal and matches, zones, best efforts, decoupling, efficiency,
// durability). Pure; samples as readRide gives them (1 s, null = missing).
// Pauses are left out of every total. W′bal, matches, NP, power zones and
// best efforts come from the live ride's SessionStats, so the ride page and
// the Ride page agree.
//

import { SessionStats, ZONES, BEST_WINDOWS } from '../analytics.js';
import { pickIntervals } from './intervals.js';

const SHORT = 20;                         // s: below this, averages only
const DECOUPLING_MIN = 45 * 60;           // s of riding
const DECOUPLING_SKIP = 10 * 60;          // s of warm-up left out
const DURABILITY_KJ = [1000, 2000, 3000];
const RECENT_DAYS = 42;
const ON_TARGET = 0.05, ON_TARGET_MIN_W = 5;
// heart-rate zones from LTHR (upper bounds of Z1–Z4, as a fraction)
const HR_ZONES = [
    {short: 'Z1', name: 'Recovery', hi: 0.81},
    {short: 'Z2', name: 'Endurance', hi: 0.90},
    {short: 'Z3', name: 'Tempo', hi: 0.94},
    {short: 'Z4', name: 'Threshold', hi: 1.00},
    {short: 'Z5', name: 'Above threshold', hi: Infinity},
];

const num = x => Number.isFinite(x);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 0) => (num(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

function npOf(powers) {
    if(powers.length < 30) return null;
    let sum = 0, acc = 0, n = 0;
    for(let i = 0; i < powers.length; i++) {
        sum += powers[i];
        if(i >= 30) sum -= powers[i - 30];
        if(i >= 29) { acc += (sum / 30) ** 4; n++; }
    }
    return n ? acc ** 0.25 / n ** 0.25 : null;
}

// best average power over `seconds` in a list of powers (nulls as gaps of 0)
function bestAvg(powers, seconds) {
    if(powers.length < seconds) return null;
    let sum = 0, best = -Infinity;
    for(let i = 0; i < powers.length; i++) {
        sum += powers[i] ?? 0;
        if(i >= seconds) sum -= powers[i - seconds] ?? 0;
        if(i >= seconds - 1 && sum > best) best = sum;
    }
    return best / seconds;
}

function intervalStats(samples, iv, ftp, target = null) {
    if(iv?.start === null || iv?.start === undefined) return null;
    const part = samples.slice(iv.start, iv.end);
    const isLive = s => [s.power, s.heartRate, s.cadence, s.speed].some(num);
    const live = part.filter(isLive);
    // the target per live second: the workout's where it gives one, else the interval's
    const targets = [];
    part.forEach((s, k) => { if(isLive(s)) targets.push((target ? target[iv.start + k] : iv.target) ?? null); });
    const duration = (iv.end - iv.start) - (iv.paused ?? 0);
    const powers = live.map(s => s.power).filter(num);
    const hrs = live.map(s => s.heartRate).filter(x => num(x) && x > 0);
    const cads = live.map(s => s.cadence).filter(x => num(x) && x > 0);
    const hasPower = powers.some(p => p > 0);
    const avgPower = hasPower ? mean(powers) : null;
    const long = duration >= SHORT;
    const halves = list => {
        const h = Math.floor(list.length / 2);
        return [mean(list.slice(0, h)), mean(list.slice(h))];
    };
    const pairs = live.map((s, k) => [s.power, targets[k]]).filter(([p, t]) => num(p) && num(t) && t > 0);
    const onTarget = hasPower && pairs.length ? pairs.filter(([p, t]) => Math.abs(p - t) <= Math.max(t * ON_TARGET, ON_TARGET_MIN_W)).length / pairs.length : null;
    const [p1, p2] = halves(powers), [h1, h2] = halves(hrs);
    return {
        duration,
        avgPower: round(avgPower),
        np: long && hasPower ? round(npOf(powers)) : null,
        pctFtp: hasPower && ftp > 0 ? round(avgPower / ftp * 100, 1) : null,
        avgHr: round(mean(hrs)),
        maxHr: hrs.length ? Math.max(...hrs) : null,
        avgCadence: round(mean(cads)),
        avgTarget: round(mean(pairs.map(([, t]) => t))),
        onTarget: round(onTarget, 3),
        fade: long && hasPower && p1 > 0 ? round(p2 / p1 - 1, 3) : null,
        hrDrift: long && num(h1) && num(h2) ? round(h2 - h1, 1) : null,
    };
}

// per work rep of a workout: target, done, difference; cut short (< half
// its planned time) or skipped
function plannedVsActual(intervals, samples) {
    return intervals.filter(i => i.kind === 'work' && num(i.planned)).map(iv => {
        if(iv.start === null) return {rep: iv.rep, target: iv.target, planned: iv.planned, done: null, diffW: null, diffPct: null, duration: 0, status: 'skipped'};
        const s = intervalStats(samples, iv, 0);
        const done = s?.avgPower ?? null;
        const ridden = (iv.end - iv.start) - (iv.paused ?? 0);
        return {
            rep: iv.rep, target: iv.target, planned: iv.planned, done, duration: ridden,
            diffW: num(done) ? done - iv.target : null,
            diffPct: num(done) && iv.target > 0 ? round((done - iv.target) / iv.target * 100, 1) : null,
            status: ridden < iv.planned * 0.5 ? 'cut-short' : 'done',
        };
    });
}

function decouplingOf(active) {
    if(active.length < DECOUPLING_MIN) return null;
    const rest = active.slice(DECOUPLING_SKIP);
    const half = Math.floor(rest.length / 2);
    const ef = list => {
        const both = list.filter(s => s.power > 0 && s.heartRate > 0);
        if(both.length < 60) return null;
        return mean(both.map(s => s.power)) / mean(both.map(s => s.heartRate));
    };
    const a = ef(rest.slice(0, half)), b = ef(rest.slice(half));
    return a && b ? round((a - b) / a * 100, 1) : null;
}

function hrZonesOf(active, lthr) {
    if(!(lthr > 0)) return null;
    const zones = HR_ZONES.map(z => ({...z, seconds: 0}));
    for(const s of active) {
        if(!(s.heartRate > 0)) continue;
        zones.find(z => s.heartRate < z.hi * lthr).seconds++;
    }
    return zones;
}

function durabilityOf(active) {
    const powers = active.map(s => s.power ?? 0);
    let kj = 0;
    const out = [];
    let next = 0;
    for(let i = 0; i < powers.length && next < DURABILITY_KJ.length; i++) {
        kj += powers[i] / 1000;
        if(kj >= DURABILITY_KJ[next]) {
            const before = powers.slice(0, i + 1), after = powers.slice(i + 1);
            out.push({
                kj: DURABILITY_KJ[next], at: active[i].t,
                best5: round(bestAvg(after, 300)), best20: round(bestAvg(after, 1200)),
                fresh5: round(bestAvg(before, 300)), fresh20: round(bestAvg(before, 1200)),
            });
            next++;
        }
    }
    return out;
}

function recordOf(seconds, watts, {summaries = [], day = null, id = null}) {
    if(!num(watts)) return null;
    const others = summaries.filter(s => s.id !== id && num(s.best?.[seconds]));
    if(!others.length) return null;
    const all = Math.max(...others.map(s => s.best[seconds]));
    if(watts > all) return 'all';
    if(day) {
        const from = new Date(Date.parse(day) - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
        const recent = others.filter(s => s.day >= from && s.day <= day).map(s => s.best[seconds]);
        if(recent.length && watts > Math.max(...recent)) return 'recent';
    }
    return null;
}

function analyseRide({samples = [], pauses = [], laps = [], workout = null, ftp = 250, weight = 75, wprime = 20000, lthr = null,
                      summaries = [], day = null, id = null} = {}) {
    const paused = t => pauses.some(p => t >= p.start && t < p.end);
    const active = samples.filter(s => !paused(s.t));
    const hasPower = active.some(s => s.power > 0);
    const hasHr = active.some(s => s.heartRate > 0);

    const picked = pickIntervals({workout, laps, samples, pauses, ftp});
    const intervals = picked.intervals.map(iv => ({...iv, stats: intervalStats(samples, iv, ftp, picked.target)}));
    const reps = picked.source === 'workout' ? plannedVsActual(picked.intervals, samples) : [];

    let wbal = null, powerZones = null, bests = [], np = null;
    if(hasPower) {
        const stats = new SessionStats({ftp, weight, wprime});
        const atIndex = [];
        for(const s of active) { stats.push({power: s.power, heartRate: s.heartRate, cadence: s.cadence}); atIndex.push(s.t); }
        const sum = stats.summary();
        np = sum.np;
        const series = new Array(samples.length).fill(null);
        stats.wbalSeries.forEach((w, i) => { series[atIndex[i]] = Math.round(w); });
        wbal = {
            series, min: Math.round(sum.wbalMin), wprime,
            matches: stats.matches.map(m => ({start: atIndex[m.start], end: atIndex[m.stop], cost: Math.round(m.cost)})),
        };
        powerZones = sum.zones.map(z => ({short: z.short, name: z.name, color: z.color, seconds: z.seconds}));
        bests = sum.best.filter(b => b.available && b.watts > 0)
            .map(b => ({seconds: b.seconds, label: b.label, watts: Math.round(b.watts), record: recordOf(b.seconds, Math.round(b.watts), {summaries, day, id})}));
    }
    const hrs = active.map(s => s.heartRate).filter(x => x > 0);
    const avgHr = mean(hrs);
    return {
        hasPower, hasHr,
        intervalSource: picked.source, intervals, reps, target: picked.target,
        wbal, powerZones,
        hrZones: hasHr ? hrZonesOf(active, lthr) : null,
        bests,
        decoupling: hasPower && hasHr ? decouplingOf(active) : null,
        ef: hasPower && hasHr && np > 0 && avgHr > 0 ? round(np / avgHr, 2) : null,
        durability: hasPower ? durabilityOf(active) : [],
        np: round(np),
        avgHr: round(avgHr),
        activeSeconds: active.length,
    };
}

export { analyseRide, intervalStats, plannedVsActual, HR_ZONES, DURABILITY_KJ, BEST_WINDOWS };
