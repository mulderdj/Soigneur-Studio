// @ts-check
//
// Auuki's own ride summaries together with rides from outside (Garmin,
// imported .fit files, intervals.icu), without counting a ride twice. An
// outside ride is left out when it is one of Auuki's own uploads
// (auukiRideId), or when it and a ride already kept overlap for at least
// 80 % of the shorter one's duration (the same ride recorded by a head unit
// that started earlier or stopped later). Auuki's own rides are kept first,
// then outside ones by source: Garmin, imported .fit, intervals.icu.
//

const OVERLAP = 0.8;

function span(s) {
    const start = Number(s.start) || 0;
    return [start, start + Math.max(0, Number(s.duration) || 0) * 1000];
}

const sportKey = s => s?.sport || 'cycling';

function sameRide(a, b) {
    if(sportKey(a) !== sportKey(b)) return false;
    const [a0, a1] = span(a);
    const [b0, b1] = span(b);
    const shorter = Math.min(a1 - a0, b1 - b0);
    if(shorter <= 0) return false;
    return Math.min(a1, b1) - Math.max(a0, b0) >= OVERLAP * shorter;
}

// when one ride comes from several outside sources, the most complete wins
const PRIORITY = {garmin: 0, fit: 1, intervals: 2};
const rank = (s) => PRIORITY[s.source] ?? 3;
const bucket = (s) => Math.floor((Number(s.start) || 0) / 86400000);

function mergeRides(own = [], external = []) {
    const ids = new Set(own.map(s => s.id));
    // kept rides by day bucket: a duplicate starts within a day of the other
    const byDay = new Map();
    const keep = (s) => {
        const b = bucket(s);
        if(!byDay.has(b)) byDay.set(b, []);
        byDay.get(b).push(s);
    };
    const duplicateOf = (x) => {
        const b = bucket(x);
        for(const k of [b - 1, b, b + 1]) for(const s of byDay.get(k) ?? []) if(sameRide(s, x)) return s;
        return null;
    };
    // the kept copy without a load or power curve takes the dropped copy's
    // (e.g. Garmin's list without TSS/power curve, intervals.icu's with them)
    const lend = (kept, x) => {
        if(!kept || !x) return;
        if(!Number.isFinite(kept.tss) && Number.isFinite(x.tss)) {
            kept.tss = x.tss;
            if(!Number.isFinite(kept.np) && Number.isFinite(x.np)) kept.np = x.np;
            if(!Number.isFinite(kept.if) && Number.isFinite(x.if)) kept.if = x.if;
        }
        if(!Number.isFinite(kept.kj) && Number.isFinite(x.kj)) kept.kj = x.kj;
        if(!Number.isFinite(kept.avgHr) && Number.isFinite(x.avgHr)) kept.avgHr = x.avgHr;
        if(!Number.isFinite(kept.maxHr) && Number.isFinite(x.maxHr)) kept.maxHr = x.maxHr;
        if((!kept.zoneSeconds || !kept.zoneSeconds.some(v => v > 0)) && x.zoneSeconds?.some(v => v > 0)) {
            kept.zoneSeconds = x.zoneSeconds;
        }
        if(x.best && typeof x.best === 'object') {
            const mergedBest = {...(kept.best ?? {})};
            let changed = false;
            for(const [k, v] of Object.entries(x.best)) {
                if(!Number.isFinite(mergedBest[k]) && Number.isFinite(v) && v > 0) { mergedBest[k] = v; changed = true; }
            }
            if(changed) kept.best = mergedBest;
        }
    };
    const mine = own.map(s => ({...s}));   // copies: the inputs stay as they are
    const byId = new Map(mine.map(s => [s.id, s]));
    mine.forEach(keep);
    const kept = [];
    for(const x of [...external].sort((a, b) => rank(a) - rank(b))) {
        if(x.auukiRideId && ids.has(x.auukiRideId)) { lend(byId.get(x.auukiRideId), x); continue; }
        const dup = duplicateOf(x);
        if(dup) { lend(dup, x); continue; }
        const copy = {...x};
        keep(copy);
        kept.push(copy);
    }
    return [...mine, ...kept].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

// rides recorded in Auuki have no sport: they are cycling
function isCycling(summary) {
    return !summary?.sport || summary.sport === 'cycling';
}

// rides that count for form and progress: all but the ones the rider hid
function countable(summaries = []) {
    return summaries.filter(s => !s.hidden);
}

export { mergeRides, isCycling, sameRide, countable };
