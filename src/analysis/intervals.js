//
// A ride's intervals, from (in this order) the workout it followed, the
// file's laps, or the power itself.
//
//   interval = {start, end, kind: 'work'|'rest'|'lap', target?, planned?, rep?, lap?, paused?}
//   start/end: seconds on the ride's time line (samples[t]); end exclusive.
//   A planned rep the ride never reached has start = end = null.
//

const WORK = 0.88;      // a step at or above 88 % FTP is work (tempo and up); detection uses the same
const SMOOTH = 30;      // s, rolling average for detection
const MIN_EFFORT = 30;  // s
const MERGE_GAP = 20;   // s

const inPause = (t, pauses) => pauses.some(p => t >= p.start && t < p.end);

// the workout's steps on the ride's time line: workout time stands still
// while the ride is paused (the app's workout clock does too)
const LAP_FIT = 0.25;    // laps match the workout when their lengths are within 25 % (median) of the intervals'

// which lap holds the workout's first interval (0: the workout started with the
// clock; 1–2: a free ride before it), or null when the laps aren't the workout's
function lapOffset(workout, laps, pauses) {
    const planned = (workout?.intervals ?? []).map(iv => iv.duration ?? 0);
    if(laps.length < 2 || planned.length < 2) return null;
    const pausedIn = (a, b) => pauses.reduce((n, p) => n + Math.max(0, Math.min(b, p.end) - Math.max(a, p.start)), 0);
    let best = null;
    for(let k = 0; k <= 2; k++) {
        const n = Math.min(laps.length - k, planned.length) - 1;      // the last lap may be cut short
        if(n < 2) continue;
        const diffs = [];
        for(let i = 0; i < n; i++) {
            const lap = laps[k + i], ridden = lap.end - lap.start - pausedIn(lap.start, lap.end);
            diffs.push(Math.abs(ridden - planned[i]) / Math.max(1, planned[i]));
        }
        diffs.sort((a, b) => a - b);
        const score = diffs[Math.floor(diffs.length / 2)];
        if(!best || score < best.score) best = {k, score};
    }
    return best && best.score <= LAP_FIT ? best.k : null;
}

function intervalsFromSteps(workout, samples, {ftp, pauses = [], laps = []} = {}) {
    const offset = lapOffset(workout, laps, pauses);
    if(offset !== null) return stepsOnLaps(workout, samples, {ftp, pauses, laps: laps.slice(offset)});
    const n = samples.length;
    const target = new Array(n).fill(null);
    const intervals = [];
    let t = 0, rep = 0;
    const advance = () => { while(t < n && inPause(t, pauses)) t++; };
    for(const iv of workout?.intervals ?? []) {
        const duration = Math.max(0, Math.round(iv.duration ?? 0));
        const steps = (iv.steps?.length ? iv.steps : [{duration, power: iv.power}]);
        const avg = steps.reduce((a, s) => a + (s.power ?? 0) * (s.duration ?? 0), 0) / Math.max(1, steps.reduce((a, s) => a + (s.duration ?? 0), 0));
        const kind = avg >= WORK ? 'work' : 'rest';
        const watts = Math.round(avg * ftp);
        advance();
        if(t >= n) {
            intervals.push({start: null, end: null, kind, target: watts, planned: duration, ...(kind === 'work' ? {rep: ++rep} : {})});
            continue;
        }
        const start = t;
        let done = 0, paused = 0;
        let stepIndex = 0, stepLeft = steps[0]?.duration ?? duration;
        while(done < duration && t < n) {
            if(inPause(t, pauses)) { t++; paused++; continue; }
            while(stepLeft <= 0 && stepIndex < steps.length - 1) stepLeft = steps[++stepIndex].duration ?? 0;
            const p = steps[stepIndex]?.power;
            target[t] = Number.isFinite(p) ? Math.round(p * ftp) : null;
            t++; done++; stepLeft--;
        }
        intervals.push({start, end: t, kind, target: watts, planned: duration, ...(paused ? {paused} : {}), ...(kind === 'work' ? {rep: ++rep} : {})});
    }
    return {intervals, target};
}

// each workout interval on its own lap (the app writes one per interval): a
// late start or a skipped step don't shift the rest
function stepsOnLaps(workout, samples, {ftp, pauses, laps}) {
    const n = samples.length;
    const target = new Array(n).fill(null);
    const intervals = [];
    let rep = 0;
    workout.intervals.forEach((iv, i) => {
        const duration = Math.max(0, Math.round(iv.duration ?? 0));
        const steps = (iv.steps?.length ? iv.steps : [{duration, power: iv.power}]);
        const avg = steps.reduce((a, s) => a + (s.power ?? 0) * (s.duration ?? 0), 0) / Math.max(1, steps.reduce((a, s) => a + (s.duration ?? 0), 0));
        const kind = avg >= WORK ? 'work' : 'rest';
        const extra = kind === 'work' ? {rep: ++rep} : {};
        const lap = laps[i];
        if(!lap || lap.start >= n) { intervals.push({start: null, end: null, kind, target: Math.round(avg * ftp), planned: duration, ...extra}); return; }
        const start = lap.start, end = Math.min(lap.end, n);
        let paused = 0, stepIndex = 0, stepLeft = steps[0]?.duration ?? duration;
        for(let t = start; t < end; t++) {
            if(inPause(t, pauses)) { paused++; continue; }
            while(stepLeft <= 0 && stepIndex < steps.length - 1) stepLeft = steps[++stepIndex].duration ?? 0;
            const p = steps[stepIndex]?.power;
            target[t] = Number.isFinite(p) ? Math.round(p * ftp) : null;
            stepLeft--;
        }
        intervals.push({start, end, kind, target: Math.round(avg * ftp), planned: duration, ...(paused ? {paused} : {}), ...extra});
    });
    return {intervals, target};
}

function intervalsFromLaps(laps = []) {
    if(laps.length < 2) return [];
    return laps.map((l, i) => ({start: l.start, end: l.end, kind: 'lap', lap: i + 1}));
}

// efforts from power: a 30 s average at or above 88 % FTP for 30 s or more,
// efforts less than 20 s apart merged
function detectIntervals(samples, ftp) {
    if(!(ftp > 0) || !samples.some(s => s.power > 0)) return [];
    const n = samples.length;
    const on = new Array(n).fill(false);
    let sum = 0, count = 0;
    const q = [];
    for(let t = 0; t < n; t++) {
        const p = samples[t].power;
        q.push(p);
        if(Number.isFinite(p)) { sum += p; count++; }
        if(q.length > SMOOTH) { const old = q.shift(); if(Number.isFinite(old)) { sum -= old; count--; } }
        // the smoothed value belongs to the middle of the window
        const mid = t - Math.floor(SMOOTH / 2);
        if(mid >= 0 && count > 0) on[mid] = sum / count >= WORK * ftp;
    }
    const efforts = [];
    let s = null;
    for(let t = 0; t <= n; t++) {
        if(t < n && on[t]) { if(s === null) s = t; }
        else if(s !== null) { efforts.push({start: s, end: t}); s = null; }
    }
    const merged = [];
    for(const e of efforts) {
        const last = merged.at(-1);
        if(last && e.start - last.end < MERGE_GAP) last.end = e.end;
        else merged.push({...e});
    }
    return merged.filter(e => e.end - e.start >= MIN_EFFORT).map((e, i) => ({...e, kind: 'work', rep: i + 1}));
}

function pickIntervals({workout = null, laps = [], samples = [], pauses = [], ftp} = {}) {
    if(workout?.intervals?.length) {
        const {intervals, target} = intervalsFromSteps(workout, samples, {ftp, pauses, laps});
        return {source: 'workout', intervals, target};
    }
    const fromLaps = intervalsFromLaps(laps);
    if(fromLaps.length) return {source: 'laps', intervals: fromLaps, target: null};
    const found = detectIntervals(samples, ftp);
    if(found.length) return {source: 'detected', intervals: found, target: null};
    return {source: 'none', intervals: [], target: null};
}

export { intervalsFromSteps, intervalsFromLaps, detectIntervals, pickIntervals, WORK };
