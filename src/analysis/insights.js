// @ts-check
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
//   decouplingTrend(summaries)             → [{day, decoupling, duration, name, id}] long steady rides, and .rolling
//   durabilityTrend(summaries, today, opt) → [{week, watts, fresh, pct, from, freshFrom}] per week
//   readinessPairs(summaries, wellness, x) → {points: [{day, x, y, name}], r, n}
//   polarised(summaries, today, weeks)     → [{week, easy, middle, hard, seconds}] shares 0–1
//

import { bestPowers, DURATIONS, DECOUPLING_MIN, STEADY_VI, DURABILITY_KJ } from '../training/summary.js';
import { plannedTss, planStatus } from '../training/plan.js';
import { dailyTss, pmc } from '../training/load.js';
import { isCycling } from '../training/merge.js';

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
    const list = efforts(analysis, ftp);
    list.forEach((iv, i) => {
        if(iv.end - iv.start < RECOVERY_MIN) return;
        // the minute after must be recovery: the next effort starts after it
        const next = list[i + 1];
        if(next && next.start < iv.end + RECOVERY) return;
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
        if(chunk[chunk.length - 1].t - chunk[0].t !== window - 1) continue;     // straddles a pause
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
    (s.duration ?? 0) >= STEADY_MIN && num(s.if) && s.if <= STEADY_IF &&
    !(num(s.avgPower) && s.avgPower > 0 && s.np / s.avgPower > 1.10);

function efficiency(summaries = [], rollDays = 28) {
    const list = summaries.filter(steady)
        .map(s => ({day: s.day, ef: round(s.np / s.avgHr, 2), name: s.name, id: s.id}))
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    // a sliding window over the sorted rides (rides on the same day all count)
    const rolling = [];
    let lo = 0, sum = 0, hi = 0;
    list.forEach((p, i) => {
        while(hi < list.length && list[hi].day <= p.day) { sum += list[hi].ef; hi++; }
        const from = addDays(p.day, -(rollDays - 1));
        while(list[lo].day < from) { sum -= list[lo].ef; lo++; }
        rolling[i] = round(sum / (hi - lo), 2);
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
// 'sleep' (hours); y: the ride's efficiency against the median of comparable
// rides in the 42 days before it (%). Comparable: steady rides of IF 0.60–0.80
// only, so an easy spin and a tempo ride (whose NP ÷ HR differ by nature)
// don't make a link of their own. r from 12 rides.
const BAND = [0.60, 0.80];

// the HRV normal range on a day, as hrvRangeOn, from days sorted once:
// Garmin's baseline for that night, else mean ± SD of the 60 days before
function rangeFinder(wellness) {
    const days = [...wellness].filter(d => d?.day).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const byDay = new Map(days.map(d => [d.day, d]));
    const withHrv = days.filter(d => num(d.hrv) && d.hrv > 0);
    return day => {
        const b = byDay.get(day)?.hrvBaseline;
        if(num(b?.low) && b.low > 0 && num(b?.high) && b.high > 0) return {low: b.low, high: b.high};
        const from = addDays(day, -60);
        const values = [];
        for(const d of withHrv) { if(d.day >= day) break; if(d.day >= from) values.push(d.hrv); }
        if(values.length < 14) return null;
        const m = mean(values);
        const sd = Math.sqrt(values.reduce((a, x) => a + (x - m) ** 2, 0) / values.length);
        return {low: Math.round(m - sd), high: Math.round(m + sd)};
    };
}

function readinessPairs(summaries = [], wellness = [], x = 'hrv', {minRides = 12, baseDays = 42} = {}) {
    const rides = efficiency(summaries.filter(s => num(s.if) && s.if >= BAND[0] && s.if <= BAND[1]));
    const byDay = new Map(wellness.map(d => [d.day, d]));
    const rangeOn = rangeFinder(wellness);
    const points = [];
    let lo = 0;
    rides.forEach((r, i) => {
        const from = addDays(r.day, -baseDays);
        while(lo < i && rides[lo].day < from) lo++;
        // the rides before this one's day (never itself or the same day)
        const before = [];
        for(let k = lo; k < i && rides[k].day < r.day; k++) before.push(rides[k].ef);
        if(before.length < 3) return;
        const base = median(before);
        const night = byDay.get(r.day);
        let xv = null;
        if(x === 'sleep') xv = num(night?.sleepSeconds) && night.sleepSeconds > 0 ? round(night.sleepSeconds / 3600, 1) : null;
        else if(num(night?.hrv) && night.hrv > 0) {
            const range = rangeOn(r.day);
            const mid = range ? (range.low + range.high) / 2 : 0;
            if(mid > 0) xv = round((night.hrv / mid - 1) * 100, 1);
        }
        if(xv === null) return;
        points.push({day: r.day, x: xv, y: round((r.ef / base - 1) * 100, 1), name: r.name, id: r.id});
    });
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

// aerobic decoupling (%) of long steady cycling rides (≥ 45 min, VI ≤ 1.10)
// with a 28-day rolling mean; falling = better aerobic endurance
function decouplingTrend(summaries = [], rollDays = 28) {
    const list = summaries
        .filter(s => s?.day && (s.sport ?? 'cycling') === 'cycling' && num(s.decoupling) &&
            (s.duration ?? 0) >= DECOUPLING_MIN &&
            !(num(s.np) && num(s.avgPower) && s.avgPower > 0 && s.np / s.avgPower > STEADY_VI))
        .map(s => ({day: s.day, decoupling: round(s.decoupling, 1), duration: s.duration ?? null, name: s.name, id: s.id}))
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const rolling = [];
    let lo = 0, sum = 0, hi = 0;
    list.forEach((p, i) => {
        while(hi < list.length && list[hi].day <= p.day) { sum += list[hi].decoupling; hi++; }
        const from = addDays(p.day, -(rollDays - 1));
        while(list[lo].day < from) { sum -= list[lo].decoupling; lo++; }
        rolling[i] = round(sum / (hi - lo), 1);
    });
    return Object.assign(list, {rolling});
}

// weekly durability: best `duration` (300 or 1200 s) power after `kj`
// (1000 / 2000 / 3000 kJ) of work, against the rider's fresh best at that
// duration over the preceding `freshDays` (90 days)
function durabilityTrend(summaries = [], today, {kj = 1000, duration = 300, weeks = 52, freshDays = 90} = {}) {
    if(!today) return [];
    const cycling = summaries.filter(s => s?.day && (s.sport ?? 'cycling') === 'cycling');
    const first = addDays(weekOf(today), -7 * (weeks - 1));
    const out = [];
    for(let w = first; w <= today; w = addDays(w, 7)) {
        const end = addDays(w, 6) < today ? addDays(w, 6) : today;
        const freshFromDay = addDays(end, -(freshDays - 1));
        let best = null, fresh = null;
        for(const s of cycling) {
            if(s.day >= w && s.day <= end) {
                const pw = s.durability?.[kj]?.[duration];
                if(num(pw) && pw > 0 && (!best || pw > best.watts || (pw === best.watts && s.day < best.day))) {
                    best = {watts: Math.round(pw), id: s.id, day: s.day, name: s.name ?? null};
                }
            }
            if(s.day >= freshFromDay && s.day <= end) {
                const fw = s.best?.[duration];
                if(num(fw) && fw > 0 && (!fresh || fw > fresh.watts || (fw === fresh.watts && s.day < fresh.day))) {
                    fresh = {watts: Math.round(fw), id: s.id, day: s.day, name: s.name ?? null};
                }
            }
        }
        const pct = best && fresh ? round(Math.min(100, (best.watts / fresh.watts) * 100), 1) : null;
        out.push({
            week: w,
            watts: best?.watts ?? null,
            fresh: fresh?.watts ?? null,
            pct,
            from: best ? {id: best.id, day: best.day, name: best.name} : null,
            freshFrom: fresh ? {id: fresh.id, day: fresh.day, name: fresh.name} : null,
        });
    }
    return out;
}

// classify the recent training block's 3-zone intensity split in plain language:
// Polarised, Pyramidal, Threshold-heavy, or Base / Endurance
function classifyIntensity(summaries = [], today, {weeks = 4} = {}) {
    if(!today) {
        return {enough: false, pattern: null, label: null, easy: 0, middle: 0, hard: 0, seconds: 0, weeks: [], summary: null,
                note: 'Ride with power over a few weeks to classify your intensity split.'};
    }
    const rows = polarised(summaries.filter(isCycling), today, weeks);
    let easySec = 0, midSec = 0, hardSec = 0;
    for(const r of rows) {
        easySec += r.easy * r.seconds;
        midSec += r.middle * r.seconds;
        hardSec += r.hard * r.seconds;
    }
    const total = Math.round(easySec + midSec + hardSec);
    if(total < 1800) {
        return {enough: false, pattern: null, label: null, easy: 0, middle: 0, hard: 0, seconds: total, weeks: rows, summary: null,
                note: 'Ride with power over a few weeks to classify your intensity split.'};
    }
    const easy = easySec / total, middle = midSec / total, hard = hardSec / total;
    let pattern, label, note;
    if(middle >= 0.30 || middle > easy) {
        pattern = 'threshold';
        label = 'Threshold-heavy';
        note = 'A large share in Z3–Z5 (tempo to threshold); steady load, so watch recovery.';
    } else if(hard >= 0.05 && hard >= middle && easy >= 0.60) {
        pattern = 'polarised';
        label = 'Polarised';
        note = 'Mostly easy riding with dedicated top-end work and little in the middle.';
    } else if(easy >= 0.85 && hard < 0.05) {
        pattern = 'base';
        label = 'Base / Endurance';
        note = 'Almost all easy aerobic riding in Z1–Z2, building endurance with minimal intensity.';
    } else if(easy > middle && middle > hard) {
        pattern = 'pyramidal';
        label = 'Pyramidal';
        note = 'A broad easy base, a smaller middle layer, and a touch of high intensity.';
    } else if(hard >= middle && hard >= 0.05) {
        pattern = 'polarised';
        label = 'Polarised';
        note = 'Heavy high-intensity work paired with easy recovery.';
    } else {
        pattern = 'threshold';
        label = 'Threshold-heavy';
        note = 'Concentrated in the middle zones; balance with easy endurance rides.';
    }
    const p = x => Math.round(x * 100);
    const summary = `${label} (${p(easy)} % easy · ${p(middle)} % middle · ${p(hard)} % hard)`;
    return {
        enough: true, pattern, label,
        easy: round(easy, 3), middle: round(middle, 3), hard: round(hard, 3),
        seconds: total, weeks: rows, summary, note,
    };
}

function plannedDuration(workout) {
    let sec = 0;
    for(const iv of workout?.intervals ?? []) {
        if(iv.steps?.length) {
            for(const s of iv.steps) sec += num(s.duration) ? s.duration : (num(iv.duration) ? iv.duration : 0);
        } else if(num(iv.duration)) {
            sec += iv.duration;
        }
    }
    return sec;
}

function summarizeComplianceRows(rows) {
    let done = 0, missed = 0, upcoming = 0, plannedLoad = 0, actualLoad = 0, plannedSeconds = 0, actualSeconds = 0;
    for(const r of rows) {
        done += r.done;
        missed += r.missed;
        upcoming += r.upcoming;
        plannedLoad += r.plannedTss;
        actualLoad += r.actualTss;
        plannedSeconds += r.plannedSeconds;
        actualSeconds += r.actualSeconds;
    }
    const due = done + missed;
    return {
        done, missed, upcoming, due,
        completionPct: due > 0 ? round((done / due) * 100, 0) : null,
        plannedTss: round(plannedLoad, 1) ?? 0,
        actualTss: round(actualLoad, 1) ?? 0,
        loadPct: plannedLoad > 0 ? round((actualLoad / plannedLoad) * 100, 0) : null,
        plannedSeconds: Math.round(plannedSeconds),
        actualSeconds: Math.round(actualSeconds),
        durationPct: plannedSeconds > 0 ? round((actualSeconds / plannedSeconds) * 100, 0) : null,
    };
}

// weekly plan compliance: completed vs missed workouts, and planned vs actual load & duration adherence
function planCompliance(plan = [], summaries = [], today, {weeks = 12, blockWeeks = 4, ftp = 250} = {}) {
    if(!today || !(weeks > 0)) {
        return {weeks: [], block: summarizeComplianceRows([])};
    }
    const byId = new Map(summaries.filter(s => s?.id).map(s => [s.id, s]));
    const active = plan.filter(e => e && !e.deleted && typeof e.day === 'string');
    const first = addDays(weekOf(today), -7 * (weeks - 1));
    const rows = [];
    for(let w = first; w <= today; w = addDays(w, 7)) {
        const end = addDays(w, 6);
        const entries = active.filter(e => e.day >= w && e.day <= end);
        let done = 0, missed = 0, upcoming = 0, pTss = 0, aTss = 0, pSec = 0, aSec = 0;
        for(const e of entries) {
            const st = planStatus(e, today);
            if(st === 'planned') { upcoming++; continue; }
            if(st === 'done') done++;
            else missed++;
            if(e.workout) {
                const pt = plannedTss(e.workout, ftp);
                const ps = plannedDuration(e.workout);
                pTss += pt;
                pSec += ps;
                if(st === 'done' && e.rideId) {
                    const r = byId.get(e.rideId);
                    if(r) {
                        aTss += num(r.tss) ? r.tss : 0;
                        aSec += num(r.duration) ? r.duration : 0;
                    }
                }
            }
        }
        const due = done + missed;
        rows.push({
            week: w,
            done, missed, upcoming, due,
            completionPct: due > 0 ? round((done / due) * 100, 0) : null,
            plannedTss: round(pTss, 1) ?? 0,
            actualTss: round(aTss, 1) ?? 0,
            loadPct: pTss > 0 ? round((aTss / pTss) * 100, 0) : null,
            plannedSeconds: Math.round(pSec),
            actualSeconds: Math.round(aSec),
            durationPct: pSec > 0 ? round((aSec / pSec) * 100, 0) : null,
        });
    }
    return {weeks: rows, block: summarizeComplianceRows(rows.slice(-Math.max(1, blockWeeks)))};
}

const STANDOUT_DURATIONS = [
    {seconds: 1200, label: '20 min'},
    {seconds: 300,  label: '5 min'},
    {seconds: 3600, label: '60 min'},
    {seconds: 60,   label: '1 min'},
    {seconds: 5,    label: '5 s'},
];

function windowTotals(summaries, from, to) {
    let rides = 0, seconds = 0, tss = 0, kj = 0;
    for(const s of summaries) {
        if(!s?.day || s.day < from || s.day > to) continue;
        rides++;
        seconds += num(s.duration) ? s.duration : 0;
        tss += num(s.tss) ? s.tss : 0;
        kj += num(s.kj) ? s.kj : 0;
    }
    return {rides, seconds, hours: seconds / 3600, tss, kj};
}

function standoutEffort(summaries, from, to, period) {
    const cycling = summaries.filter(s => s?.day && isCycling(s));
    const inRange = cycling.filter(s => s.day >= from && s.day <= to);
    if(!inRange.length) return null;
    const before = cycling.filter(s => s.day < from);
    const from90 = addDays(to, -89);
    const before90 = before.filter(s => s.day >= from90);
    let pick = null;
    for(const {seconds, label} of STANDOUT_DURATIONS) {
        let cur = null;
        for(const s of inRange) {
            const w = s.best?.[seconds];
            if(num(w) && w > 0 && (!cur || w > cur.watts || (w === cur.watts && s.day < cur.day))) {
                cur = {watts: Math.round(w), day: s.day, name: s.name ?? null, id: s.id};
            }
        }
        if(!cur) continue;
        let maxAll = 0, max90 = 0;
        for(const s of before) { const w = s.best?.[seconds]; if(num(w) && w > maxAll) maxAll = w; }
        for(const s of before90) { const w = s.best?.[seconds]; if(num(w) && w > max90) max90 = w; }
        let tier = 0, kind = 'best';
        if(maxAll > 0 && cur.watts > maxAll) { tier = 3; kind = 'all-time'; }
        else if(max90 > 0 && cur.watts >= max90) { tier = 2; kind = '90-day'; }
        else if(max90 > 0 && cur.watts >= max90 * 0.92) { tier = 1; kind = 'strong'; }
        else if(max90 > 0) continue;   // routine sub-maximal effort: don't call it a standout
        const pctOf90d = max90 > 0 ? Math.round((cur.watts / max90) * 100) : null;
        const score = max90 > 0 ? cur.watts / max90 : 1;
        if(!pick || tier > pick.tier || (tier === pick.tier && score > pick.score)) {
            pick = {tier, score, seconds, label, watts: cur.watts, day: cur.day, name: cur.name, id: cur.id, kind, period, pctOf90d};
        }
    }
    if(!pick) return null;
    const {tier, score, ...out} = pick;
    return out;
}

// concise weekly summary of what changed vs prior week & 4-week norm:
// volume, load, CTL, plan compliance, and standout best effort
function weeklySummary({summaries = [], plan = [], today, ftp = 250}) {
    if(!today) {
        return {thisWeek: windowTotals([], '', ''), priorSameDays: windowTotals([], '', ''), priorWeek: windowTotals([], '', ''),
                norm4w: windowTotals([], '', ''), normPace: windowTotals([], '', ''),
                ctl: {now: 0, weekAgo: 0, delta: 0}, compliance: planCompliance([], [], ''), standout: null, items: []};
    }
    const monday = weekOf(today);
    const upTo = Math.max(0, Math.min(6, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / 86400000)));
    const lastMonday = addDays(monday, -7);
    const thisWeek = windowTotals(summaries, monday, today);
    const priorSameDays = windowTotals(summaries, lastMonday, addDays(lastMonday, upTo));
    const priorWeek = windowTotals(summaries, lastMonday, addDays(lastMonday, 6));

    const avg4 = fn => {
        const list = [1, 2, 3, 4].map(k => fn(addDays(monday, -7 * k)));
        const meanOf = key => list.reduce((a, x) => a + x[key], 0) / 4;
        return {rides: round(meanOf('rides'), 1), seconds: Math.round(meanOf('seconds')), hours: meanOf('hours'), tss: round(meanOf('tss'), 1), kj: round(meanOf('kj'), 0)};
    };
    const norm4w = avg4(w => windowTotals(summaries, w, addDays(w, 6)));
    const normPace = avg4(w => windowTotals(summaries, w, addDays(w, upTo)));

    let ctl = {now: 0, weekAgo: 0, delta: 0};
    const dated = summaries.filter(s => s?.day && s.day <= today);
    if(dated.length) {
        const weekAgoDay = addDays(today, -7);
        const first = dated.reduce((a, s) => (s.day < a ? s.day : a), weekAgoDay);
        const rows = pmc(dailyTss(dated), first, today);
        const nowVal = rows.at(-1)?.ctl ?? 0;
        const agoVal = rows.find(r => r.day === weekAgoDay)?.ctl ?? 0;
        ctl = {now: round(nowVal, 1) ?? 0, weekAgo: round(agoVal, 1) ?? 0, delta: round(nowVal - agoVal, 1) ?? 0};
    }

    const compliance = planCompliance(plan, summaries, today, {weeks: 4, blockWeeks: 4, ftp});
    const curPlan = compliance.weeks.at(-1);
    const blockPlan = compliance.block;

    const focusFrom = thisWeek.rides > 0 ? monday : lastMonday;
    const focusTo = thisWeek.rides > 0 ? today : addDays(lastMonday, 6);
    const standout = standoutEffort(summaries, focusFrom, focusTo, thisWeek.rides > 0 ? 'this-week' : 'last-week');

    const items = [];
    const fmtH = h => `${(Math.round(h * 10) / 10).toFixed(1).replace(/\.0$/, '')} h`;
    if(thisWeek.rides > 0 && (normPace.tss >= 10 || normPace.hours >= 0.25)) {
        const pctDiff = normPace.tss >= 10 ? Math.round(((thisWeek.tss - normPace.tss) / normPace.tss) * 100) :
                        Math.round(((thisWeek.hours - normPace.hours) / normPace.hours) * 100);
        const dir = Math.abs(pctDiff) < 5 ? 'on your 4-week pace' : `${pctDiff > 0 ? '+' : '−'}${Math.abs(pctDiff)} % vs your 4-week pace`;
        items.push(`So far: ${ dir } (usual by today: ${fmtH(normPace.hours)}, ${Math.round(normPace.tss)} TSS).`);
    } else if(thisWeek.rides === 0 && priorWeek.rides > 0) {
        const normNote = norm4w.tss >= 10 ? (() => {
            const p = Math.round(((priorWeek.tss - norm4w.tss) / norm4w.tss) * 100);
            return Math.abs(p) < 5 ? ', right on your 4-week average' : ` (${p > 0 ? '+' : '−'}${Math.abs(p)} % vs 4-week avg)`;
        })() : '';
        items.push(`Last week: ${fmtH(priorWeek.hours)} · ${Math.round(priorWeek.tss)} TSS${normNote}.`);
    }

    if(ctl.now >= 1 || ctl.weekAgo >= 1) {
        const move = Math.abs(ctl.delta) < 0.5 ? 'steady vs last week' : `${ctl.delta > 0 ? '+' : '−'}${Math.abs(ctl.delta).toFixed(1)} vs last week`;
        items.push(`Fitness (CTL): ${Math.round(ctl.now)} (${move}).`);
    }

    if(curPlan && (curPlan.due + curPlan.upcoming > 0)) {
        const totalPlanned = curPlan.due + curPlan.upcoming;
        const missedNote = curPlan.missed > 0 ? `, ${curPlan.missed} missed` : '';
        const loadNote = blockPlan.loadPct !== null ? ` · 4-wk load ${blockPlan.loadPct} %` : '';
        items.push(`Plan: ${curPlan.done} of ${totalPlanned} done this week${missedNote}${loadNote}.`);
    } else if(blockPlan.due > 0) {
        const loadNote = blockPlan.loadPct !== null ? ` · ${blockPlan.loadPct} % of planned load` : '';
        items.push(`Plan (4 weeks): ${blockPlan.done} of ${blockPlan.due} completed (${blockPlan.completionPct} %)${loadNote}.`);
    }

    if(standout) {
        const prefix = standout.period === 'last-week' ? 'Last week\'s standout' : 'Standout';
        const where = standout.name ? ` (${standout.name})` : '';
        if(standout.kind === 'all-time') items.push(`${prefix}: new all-time ${standout.label} best at ${standout.watts} W${where}.`);
        else if(standout.kind === '90-day') items.push(`${prefix}: 90-day ${standout.label} best at ${standout.watts} W${where}.`);
        else if(standout.kind === 'strong') items.push(`${prefix}: ${standout.label} at ${standout.watts} W (${standout.pctOf90d} % of 90-day best)${where}.`);
        else items.push(`${prefix}: ${standout.label} at ${standout.watts} W${where}.`);
    }

    return {thisWeek, priorSameDays, priorWeek, norm4w, normPace, ctl, compliance, standout, items};
}

export {
    efforts, reps, hrRecovery, rideCurve, powerHr,
    efficiency, decouplingTrend, durabilityTrend, readinessPairs, polarised,
    classifyIntensity, planCompliance, plannedDuration, weeklySummary,
    pearson, weekOf, DURABILITY_KJ,
};
