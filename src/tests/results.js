//
// The results of the built-in tests, pure. The log is what the wiring kept
// while the test ran: one entry per second the watch ran, {i, s, power}
// (interval and step index, 1 s power; power missing or 0 = no data).
//
//   testResult(test, log, workout, {weight}) → {ok, values, reason}
//   reachedEffort(test, log, workout)        → true once the first scored effort (or the ramp) began
//   rampEnded(powers, targets)               → true when the last 10 s were all below half the target
//

const COVER = 0.9;
const has = p => Number.isFinite(p) && p > 0;
const avg = xs => xs.reduce((a, x) => a + x, 0) / xs.length;
const kj = j => `${(j / 1000).toFixed(1)} kJ`;

// the scored steps, in order: [{i, s, effort, duration}]
function efforts(workout) {
    const out = [];
    (workout?.intervals ?? []).forEach((interval, i) => interval.steps.forEach((step, s) => {
        if(step.effort) out.push({i, s, effort: step.effort, duration: step.duration});
    }));
    return out;
}

const rampIndex = workout => (workout?.intervals ?? []).findIndex(x => x.ramp);
const LABEL = {p3: 'the 3 min effort', p12: 'the 12 min effort', p20: 'the 20 min effort',
               p8a: 'the first 8 min effort', p8b: 'the second 8 min effort', sprint: 'the first sprint'};

// one effort's samples → {avg, samples} or {reason}
function measure(e, log) {
    const entries = log.filter(x => x.i === e.i && x.s === e.s);
    if(!entries.length) return {reason: `The test was stopped before ${LABEL[e.effort]}.`, missing: true};
    const powers = entries.map(x => x.power).filter(has);
    const last = log[log.length - 1];
    const stoppedIn = last.i === e.i && last.s === e.s && entries.length < e.duration * COVER;
    if(stoppedIn) return {reason: `The test was stopped during ${LABEL[e.effort]}.`};
    if(powers.length < e.duration * COVER) return {reason: 'Not enough power data in the effort.'};
    return {avg: avg(powers), samples: powers};
}

function bestAverage(powers, window) {
    if(powers.length < window) return null;
    let sum = 0, best = 0;
    for(let k = 0; k < powers.length; k++) {
        sum += powers[k];
        if(k >= window) sum -= powers[k - window];
        if(k >= window - 1) best = Math.max(best, sum / window);
    }
    return best;
}

function cpTest(log, workout) {
    const [e3, e12] = ['p3', 'p12'].map(name => efforts(workout).find(e => e.effort === name));
    const m3 = measure(e3, log);
    if(m3.reason) return {ok: false, reason: m3.reason};
    const m12 = measure(e12, log);
    if(m12.reason) return {ok: false, reason: m12.reason};
    const p3 = Math.round(m3.avg), p12 = Math.round(m12.avg);
    if(p3 <= p12) return {ok: false, values: {p3, p12}, reason: 'The 12 min was as hard as the 3 min: the 3 min wasn’t all-out. Next time start the 3 min hard and hold on.'};
    const cp = (m12.avg * 720 - m3.avg * 180) / 540;
    const wprime = (m3.avg - cp) * 180;
    const values = {p3, p12, cp: Math.round(cp), wprime: Math.round(wprime / 10) * 10};
    if(wprime < 5000) return {ok: false, values, reason: `W′ came out at ${kj(wprime)}: the 3 min wasn’t hard enough, or the 12 min started too hard. Next time go harder in the 3 min and start the 12 min a little easier.`};
    if(wprime > 60000) return {ok: false, values, reason: `W′ came out at ${kj(wprime)}: the 12 min was paced too easily. Next time ride the 12 min closer to your limit.`};
    return {ok: true, values};
}

function rampTest(log, workout) {
    const r = rampIndex(workout);
    const entries = log.filter(x => x.i === r);
    if(!entries.length) return {ok: false, reason: 'The test was stopped before the ramp.'};
    if(entries.filter(x => has(x.power)).length < entries.length * COVER) return {ok: false, reason: 'Not enough power data in the effort.'};
    const best = bestAverage(entries.map(x => has(x.power) ? x.power : 0), 60);
    if(best === null) return {ok: false, reason: 'The ramp lasted less than a minute: not enough for a result.'};
    return {ok: true, values: {best60: Math.round(best), ftp: Math.round(best * 0.75)}};
}

function ftpTest(names, factor, log, workout) {
    const all = efforts(workout);
    const values = {};
    for(const name of names) {
        const m = measure(all.find(e => e.effort === name), log);
        if(m.reason) return {ok: false, reason: m.reason};
        values[name] = Math.round(m.avg);
    }
    const mean = avg(names.map(n => values[n]));
    return {ok: true, values: {...values, ftp: Math.round(mean * factor)}};
}

function sprintTest(log, workout, weight) {
    const done = efforts(workout).map(e => ({e, m: measure(e, log)})).filter(x => !x.m.missing);
    if(!done.length) return {ok: false, reason: 'The test was stopped before the first sprint.'};
    const usable = done.filter(x => !x.m.reason);
    if(!usable.length) return {ok: false, reason: done[0].m.reason};
    const peak = Math.round(Math.max(...usable.flatMap(x => x.m.samples)));
    const best5 = Math.round(Math.max(...usable.map(x => bestAverage(x.m.samples, 5) ?? 0)));
    const values = {peak, best5, sprints: usable.length};
    if(weight > 0) { values.peakWkg = Math.round(peak / weight * 10) / 10; values.best5Wkg = Math.round(best5 / weight * 10) / 10; }
    return {ok: true, values};
}

function testResult(test, log = [], workout, {weight} = {}) {
    if(!log.length) return {ok: false, reason: 'The test was stopped before it began.'};
    switch(test) {
    case '3-12':   return cpTest(log, workout);
    case 'ramp':   return rampTest(log, workout);
    case '20min':  return ftpTest(['p20'], 0.95, log, workout);
    case '2x8':    return ftpTest(['p8a', 'p8b'], 0.90, log, workout);
    case 'sprint': return sprintTest(log, workout, weight);
    default:       return {ok: false, reason: 'Not a test.'};
    }
}

function reachedEffort(test, log = [], workout) {
    if(test === 'ramp') { const r = rampIndex(workout); return log.some(x => x.i === r); }
    const first = efforts(workout)[0];
    return !!first && log.some(x => x.i > first.i || (x.i === first.i && x.s >= first.s));
}

function rampEnded(powers = [], targets = []) {
    if(powers.length < 10 || targets.length < 10) return false;
    const p = powers.slice(-10), t = targets.slice(-10);
    return p.every((x, k) => t[k] > 0 && !(x >= t[k] / 2));
}

export { testResult, reachedEffort, rampEnded, efforts };
