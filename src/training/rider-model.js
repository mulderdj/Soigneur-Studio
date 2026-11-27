// @ts-check
//
// The rider model (cycling): best power over the last 90 days, critical
// power (CP) and W′ fitted from it, which CP and W′ W′bal uses, and the
// power profile.
//
//   meanMaximal(summaries, today, days)  → {seconds: {watts, id, day, name} | null}
//   fitCp(meanMax)                       → {ok, cp, wprime, r2, points} | {ok: false, missing}
//   effective({fit, settings, ftp, typedWprime}) → {cp, wprime, source: 'model' | 'settings'}
//   offer({fit, current})                → {cp, wprime} | null
//   powerProfile({meanMax, ftp, weight, table}) → {rows, sentence} | {needsWeight: true}
//

import { DURATIONS } from './summary.js';
import { isCycling } from './merge.js';

const DAY_MS = 86400000;
const FIT_FROM = 120, FIT_TO = 1200;                 // 2–20 min
const SHORT_MAX = 300, LONG_MIN = 720;
const WPRIME_MIN = 5000, WPRIME_MAX = 60000;
const OFFER_WPRIME = 1000, OFFER_CP = 0.03;

const addDays = (day, n) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);
const weekOf = day => {
    const d = new Date(`${day}T00:00:00Z`);
    return addDays(day, -((d.getUTCDay() + 6) % 7));
};
const has = x => Number.isFinite(x) && x > 0;

function meanMaximal(summaries = [], today, days = 90) {
    const from = addDays(today, -(days - 1));
    const out = Object.fromEntries(DURATIONS.map(d => [d, null]));
    for(const s of summaries) {
        if(!s?.day || s.day < from || s.day > today || !isCycling(s)) continue;
        for(const d of DURATIONS) {
            const w = s.best?.[d];
            if(!has(w)) continue;
            const cur = out[d];
            // an equal best keeps the earlier ride
            if(!cur || w > cur.watts || (w === cur.watts && s.day < cur.day)) out[d] = {watts: w, id: s.id, day: s.day, name: s.name ?? null};
        }
    }
    return out;
}

// upper-envelope + power-space (P = CP + W′/t) fit over the 2–20 min bests.
// Using the upper convex hull in work-time space prevents non-maximal
// durations (e.g. 15–20 min polluted by cooldown after a 3 + 12 min test)
// from dragging CP down, and fitting in Power vs 1/t avoids 100× leverage
// bias at long durations.
function fitCp(meanMax = {}) {
    const points = DURATIONS.filter(d => d >= FIT_FROM && d <= FIT_TO && meanMax[d])
        .map(d => ({seconds: d, ...meanMax[d]}));
    if(!points.length) return {ok: false, missing: 'No power data between 2 and 20 minutes in the last 90 days.'};
    if(!points.some(p => p.seconds <= SHORT_MAX)) return {ok: false, missing: 'A hard effort of 2–5 minutes in the last 90 days.', points};
    if(!points.some(p => p.seconds >= LONG_MIN)) return {ok: false, missing: 'A hard effort of 12–20 minutes in the last 90 days.', points};
    if(points.length < 3) return {ok: false, missing: 'More efforts between 2 and 20 minutes (three durations at least).', points};

    // upper convex hull of (t, W = P·t)
    const hull = [];
    for(const p of points) {
        const w = p.watts * p.seconds;
        while(hull.length >= 2) {
            const a = hull[hull.length - 2], b = hull[hull.length - 1];
            const cross = (b.seconds - a.seconds) * (w - a.work) - (b.work - a.work) * (p.seconds - a.seconds);
            if(cross >= 0) hull.pop(); else break;
        }
        hull.push({...p, work: w});
    }

    // pick the best physiological hull edge spanning short → long (or widest valid edge)
    let env = null;
    for(let i = 0; i < hull.length - 1; i++) {
        const a = hull[i], b = hull[i + 1];
        const cp = (b.work - a.work) / (b.seconds - a.seconds);
        const wprime = a.work - cp * a.seconds;
        if(!(cp > 0) || wprime < WPRIME_MIN || wprime > WPRIME_MAX) continue;
        const spans = a.seconds <= SHORT_MAX && b.seconds >= LONG_MIN;
        const span = b.seconds - a.seconds;
        if(!env || (spans && !env.spans) || (spans === env.spans && span > env.span)) {
            env = {cp, wprime, spans, span};
        }
    }

    // keep points within 5 % of the upper envelope; fall back to all points when no valid edge exists
    const used = env ? points.filter(p => {
        const pred = env.cp + env.wprime / p.seconds;
        return pred > 0 && p.watts >= pred * 0.95;
    }) : points;
    const fitPts = used.length >= 2 ? used : points;

    // Power-space OLS: P = CP + W′ · (1 / t)
    const xs = fitPts.map(p => 1 / p.seconds), ys = fitPts.map(p => p.watts);
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for(let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    const wprime = sxx > 0 ? sxy / sxx : 0;
    const cp = my - wprime * mx;
    const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
    if(!(cp > 0) || wprime < WPRIME_MIN || wprime > WPRIME_MAX) {
        return {ok: false, points, missing: `The efforts don't fit the model yet (W′ would be ${(wprime / 1000).toFixed(1)} kJ): ride all-out efforts of about 3 and 12 minutes.`};
    }
    return {ok: true, cp: Math.round(cp), wprime: Math.round(wprime), r2: Math.round(r2 * 1000) / 1000, points: fitPts};
}

function effective({fit, settings = /** @type {{mode?: string, use?: {cp: number, wprime: number} | null}} */ ({}), ftp, typedWprime}) {
    const own = {cp: ftp, wprime: typedWprime, source: 'settings'};
    if(settings.mode === 'auto') return fit?.ok ? {cp: fit.cp, wprime: fit.wprime, source: 'model'} : own;
    const use = settings.use;
    return use && has(use.cp) && has(use.wprime) ? {cp: use.cp, wprime: use.wprime, source: 'model'} : own;
}

function offer({fit, current}) {
    if(!fit?.ok || !current) return null;
    const differs = Math.abs(fit.wprime - current.wprime) > OFFER_WPRIME || Math.abs(fit.cp - current.cp) / current.cp > OFFER_CP;
    return differs ? {cp: fit.cp, wprime: fit.wprime} : null;
}

// --- power profile -------------------------------------------------------------
// lower bounds of each category, W/kg: the CTS classification chart, based on
// Allen & Coggan's power profile
const CATEGORIES = ['Untrained', 'Fair', 'Moderate', 'Good', 'Very good', 'Excellent', 'Exceptional', 'World class'];
const TABLES = {
    men: {
        5:    [0, 11, 12.5, 14.5, 16.5, 18.3, 20.5, 22],
        60:   [0, 5.3, 6, 7, 8.1, 9, 10, 10.9],
        300:  [0, 3, 3.5, 4.1, 4.7, 5.4, 6.3, 7.1],
        ftp:  [0, 2.5, 3, 3.5, 4, 4.5, 5.3, 6],
    },
    women: {
        5:    [0, 8.6, 10.1, 11.7, 13.1, 14.9, 16.6, 18.5],
        60:   [0, 4, 4.6, 5.4, 6.1, 6.9, 7.9, 8.8],
        300:  [0, 2.5, 2.9, 3.4, 3.9, 4.5, 5.1, 5.7],
        ftp:  [0, 2.3, 2.6, 3.1, 3.5, 3.9, 4.7, 5.3],
    },
};
const PROFILE = [{key: 5, label: '5 s'}, {key: 60, label: '1 min'}, {key: 300, label: '5 min'}, {key: 'ftp', label: 'FTP'}];

// where a value sits: the category's index plus how far into it (0–1)
function place(wkg, bounds) {
    let i = bounds.length - 1;
    while(i > 0 && wkg < bounds[i]) i--;
    const next = bounds[i + 1];
    const frac = next ? (wkg - bounds[i]) / (next - bounds[i]) : 0.5;
    return {index: i, score: i + Math.max(0, Math.min(1, frac))};
}

function powerProfile({meanMax = {}, ftp, weight, table = 'men'}) {
    if(!has(weight)) return {needsWeight: true};
    const t = TABLES[table] ?? TABLES.men;
    const rows = PROFILE.map(p => {
        const watts = p.key === 'ftp' ? (has(ftp) ? ftp : null) : meanMax[p.key]?.watts ?? null;
        if(!has(watts)) return {label: p.label, watts: null, wkg: null, category: null, score: null};
        const wkg = watts / weight;
        const at = place(wkg, t[p.key]);
        return {label: p.label, watts: Math.round(watts), wkg: Math.round(wkg * 100) / 100, category: CATEGORIES[at.index], score: at.score};
    });
    const scored = rows.filter(r => r.score !== null);
    let sentence = '';
    if(scored.length >= 2) {
        const top = scored.reduce((a, b) => (b.score > a.score ? b : a));
        const low = scored.reduce((a, b) => (b.score < a.score ? b : a));
        sentence = top.score - low.score < 0.5 ?
            `An even profile: around ${top.category.toLowerCase()} at every duration.` :
            `Strongest at ${top.label} (${top.category.toLowerCase()}); ${low.label} is relatively your limiter (${low.category.toLowerCase()}).`;
    }
    return {rows, sentence, table};
}

// rolling 90-day fitted CP and W′ per week (oldest first, ending this week)
function cpTrend(summaries = [], today, weeks = 24, days = 90) {
    if(!today || !(weeks > 0)) return [];
    const cycling = summaries.filter(s => s?.day && s.day <= today && isCycling(s));
    const current = weekOf(today);
    const out = [];
    for(let i = weeks - 1; i >= 0; i--) {
        const week = addDays(current, -7 * i);
        const sun = addDays(week, 6);
        const end = sun < today ? sun : today;
        const fit = fitCp(meanMaximal(cycling, end, days));
        out.push({
            week,
            end,
            cp: fit.ok ? fit.cp : null,
            wprime: fit.ok ? fit.wprime : null,
            r2: fit.ok ? fit.r2 : null,
        });
    }
    return out;
}

// everything the app needs at once
function currentModel({summaries, today, ftp, typedWprime, settings}) {
    const meanMax = meanMaximal(summaries, today);
    const fit = fitCp(meanMax);
    const eff = effective({fit, settings, ftp, typedWprime});
    const trend = today ? cpTrend(summaries, today) : [];
    return {meanMax, fit, effective: eff, offer: settings?.mode === 'auto' ? null : offer({fit, current: eff}), trend, settings};
}

export { meanMaximal, fitCp, cpTrend, effective, offer, powerProfile, currentModel, CATEGORIES, TABLES };
