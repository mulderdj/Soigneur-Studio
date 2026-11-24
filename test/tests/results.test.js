import { protocol } from '../../src/tests/protocols.js';
import { testResult, reachedEffort, rampEnded } from '../../src/tests/results.js';

// a log as the wiring keeps it: every second of every step, with power from
// powerAt(step, second) (default: the ERG target × 250 W, 0 on all-out steps)
function ride(workout, powerAt = () => 0, {upTo} = {}) {
    const log = [];
    workout.intervals.forEach((interval, i) => interval.steps.forEach((step, s) => {
        for(let t = 0; t < step.duration; t++) {
            if(upTo && upTo({i, s, step, t})) return;
            { const p = powerAt(step, t); log.push({i, s, power: p === undefined ? (step.power ? step.power * 250 : 0) : p}); }
        }
    }));
    return log;
}
const cut = (log, pred) => { const k = log.findIndex(pred); return k < 0 ? log : log.slice(0, k); };
const effortPower = map => (step) => step.effort ? map[step.effort] : (step.power ? step.power * 250 : 0);

describe('3 + 12 min', () => {
    const w = protocol('3-12');
    // CP 250 W, W′ 20 kJ: P3 = 250 + 20000/180, P12 = 250 + 20000/720
    const good = effortPower({p3: 250 + 20000 / 180, p12: 250 + 20000 / 720});

    test('recovers CP and W′', () => {
        const r = testResult('3-12', ride(w, good), w);
        expect(r.ok).toBe(true);
        expect(r.values.cp).toBe(250);
        expect(r.values.wprime).toBe(20000);
        expect(r.values.p3).toBe(361);
        expect(r.values.p12).toBe(278);
    });
    test('12 min as hard as the 3 min', () => {
        const r = testResult('3-12', ride(w, effortPower({p3: 300, p12: 300})), w);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/3 min wasn’t all-out/);
    });
    test('W′ out of range', () => {
        const big = testResult('3-12', ride(w, effortPower({p3: 700, p12: 280})), w);
        expect(big.ok).toBe(false);
        expect(big.reason).toMatch(/^W′ came out at \d+\.\d kJ/);
        const small = testResult('3-12', ride(w, effortPower({p3: 290, p12: 280})), w);
        expect(small.ok).toBe(false);
        expect(small.reason).toMatch(/W′ came out at 2\.4 kJ/);
    });
    test('missing power in an effort', () => {
        const r = testResult('3-12', ride(w, (step, t) => step.effort === 'p12' && t % 5 === 0 ? null : good(step)), w);
        expect(r).toEqual({ok: false, reason: 'Not enough power data in the effort.'});
    });
    test('stopped before or during an effort', () => {
        const all = ride(w, good);
        const before = cut(all, x => w.intervals[x.i].steps[x.s].effort === 'p12');
        expect(testResult('3-12', before, w).reason).toBe('The test was stopped before the 12 min effort.');
        const during = before.concat(all.filter(x => w.intervals[x.i].steps[x.s].effort === 'p12').slice(0, 100));
        expect(testResult('3-12', during, w).reason).toBe('The test was stopped during the 12 min effort.');
        expect(testResult('3-12', [], w).reason).toMatch(/stopped before it began/);
    });
    test('reached the first effort only once the 3 min began (openers do not count)', () => {
        const all = ride(w, good);
        const k = all.findIndex(x => w.intervals[x.i].steps[x.s].effort === 'p3');
        expect(reachedEffort('3-12', all.slice(0, k), w)).toBe(false);
        expect(reachedEffort('3-12', all.slice(0, k + 1), w)).toBe(true);
    });
});

describe('Ramp', () => {
    const w = protocol('ramp');
    test('FTP is 75 % of the best minute in the ramp', () => {
        // holds every step up to 1.30 × 250 = 325 W, then the lap jumps to the cool-down
        const ramp = ride(w, s => s.power * 250, {upTo: ({i, step}) => i === 1 && step.power > 1.3});
        const cool = ride({intervals: [w.intervals[0], w.intervals[1], w.intervals[2]]}).filter(x => x.i === 2);
        const r = testResult('ramp', ramp.concat(cool), w);
        expect(r).toEqual({ok: true, values: {best60: 325, ftp: 244}});
    });
    test('stopped before the ramp; under a minute of ramp', () => {
        const all = ride(w, s => s.power * 250);
        expect(testResult('ramp', all.filter(x => x.i === 0), w).reason).toBe('The test was stopped before the ramp.');
        expect(testResult('ramp', all.filter(x => x.i === 0).concat(all.filter(x => x.i === 1).slice(0, 30)), w).ok).toBe(false);
        expect(reachedEffort('ramp', all.filter(x => x.i === 0), w)).toBe(false);
        expect(reachedEffort('ramp', all.slice(0, 301), w)).toBe(true);
    });
    test('missing power in the ramp', () => {
        const r = testResult('ramp', ride(w, (s, t) => t % 3 === 0 ? null : s.power * 250), w);
        expect(r.reason).toBe('Not enough power data in the effort.');
    });
});

describe('20 min and 2 × 8 min', () => {
    test('20 min: 95 %', () => {
        const w = protocol('20min');
        const r = testResult('20min', ride(w, effortPower({p20: 300})), w);
        expect(r).toEqual({ok: true, values: {p20: 300, ftp: 285}});
    });
    test('2 × 8: 90 % of the mean', () => {
        const w = protocol('2x8');
        const r = testResult('2x8', ride(w, effortPower({p8a: 320, p8b: 300})), w);
        expect(r).toEqual({ok: true, values: {p8a: 320, p8b: 300, ftp: 279}});
    });
    test('2 × 8 stopped after the first effort', () => {
        const w = protocol('2x8');
        const log = cut(ride(w, effortPower({p8a: 320, p8b: 300})), x => w.intervals[x.i].steps[x.s].effort === 'p8b');
        expect(testResult('2x8', log, w).reason).toBe('The test was stopped before the second 8 min effort.');
        expect(reachedEffort('2x8', log, w)).toBe(true);
    });
});

describe('Sprint', () => {
    const w = protocol('sprint');
    const sprintPower = (step, t) => step.effort ? [600, 1100, 1050, 950, 900, 850, 800, 700, 650, 600][t] : undefined;
    test('peak and best 5 s, W/kg', () => {
        const r = testResult('sprint', ride(w, sprintPower), w, {weight: 75});
        expect(r).toEqual({ok: true, values: {peak: 1100, best5: 970, sprints: 3, peakWkg: 14.7, best5Wkg: 12.9}});
    });
    test('no weight: no W/kg', () => {
        const r = testResult('sprint', ride(w, sprintPower), w, {});
        expect(r.values.peakWkg).toBeUndefined();
    });
    test('one sprint ridden is enough', () => {
        const all = ride(w, sprintPower);
        const firstRecovery = all.findIndex(x => x.i === 2);
        const r = testResult('sprint', all.slice(0, firstRecovery + 5), w);
        expect(r.ok).toBe(true);
        expect(r.values.sprints).toBe(1);
    });
    test('stopped in the warm-up', () => {
        const all = ride(w, sprintPower);
        expect(testResult('sprint', all.slice(0, 100), w).reason).toBe('The test was stopped before the first sprint.');
    });
});

describe('rampEnded', () => {
    const t = Array(12).fill(300);
    test('10 s in a row below half the target', () => {
        expect(rampEnded([200, 200, ...Array(10).fill(140)], t)).toBe(true);
        expect(rampEnded([...Array(9).fill(140), 150, 140, 140], t)).toBe(false);   // 150 = half: not below
        expect(rampEnded(Array(9).fill(0), t.slice(0, 9))).toBe(false);
    });
    test('missing power counts as below; no target never ends it', () => {
        expect(rampEnded(Array(10).fill(null), Array(10).fill(300))).toBe(true);
        expect(rampEnded(Array(10).fill(0), Array(10).fill(0))).toBe(false);
    });
});
