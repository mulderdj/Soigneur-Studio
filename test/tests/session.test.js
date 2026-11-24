import { protocol } from '../../src/tests/protocols.js';
import { TestSession } from '../../src/tests/session.js';

function feed(run, workout, powerAt, {until} = {}) {
    const out = [];
    for(let i = 0; i < workout.intervals.length; i++) {
        const steps = workout.intervals[i].steps;
        for(let s = 0; s < steps.length; s++) {
            for(let t = 0; t < steps[s].duration; t++) {
                if(until?.({i, s, t})) return out;
                const r = run.tick({i, s, power: powerAt(steps[s], t, i), ftp: 250});
                if(r) { out.push({r, i, s, t}); if(r === 'lap') { i++; s = -1; break; } }
            }
            if(i >= workout.intervals.length) break;
        }
    }
    return out;
}

describe('TestSession', () => {
    test('not a test: no log, no result', () => {
        const run = new TestSession({meta: {}, intervals: []});
        expect(run.tick({i: 0, s: 0, power: 100, ftp: 250})).toBeNull();
        expect(run.finish()).toBeNull();
    });

    test('Ramp: one lap when power stays under half the target for 10 s', () => {
        const w = protocol('ramp');
        const run = new TestSession(w);
        // holds up to 1.30 FTP (325 W), then 100 W
        const laps = feed(run, w, (step, t, i) => i === 1 ? (step.power <= 1.3 ? step.power * 250 : 100) : 150);
        expect(laps).toHaveLength(1);
        expect(laps[0]).toMatchObject({r: 'lap', i: 1});
        // 14 steps held (0.52 … 1.30), the 15th: 10 s under half its target
        expect(laps[0].s).toBe(14);
        expect(laps[0].t).toBe(9);
        const r = run.finish();
        expect(r).toEqual({ok: true, values: {best60: 325, ftp: 244}});
    });

    test('Ramp end never fires in the warm-up or cool-down, nor for another test', () => {
        const ramp = protocol('ramp');
        const run = new TestSession(ramp);
        for(let t = 0; t < 30; t++) expect(run.tick({i: 0, s: 0, power: 0, ftp: 250})).toBeNull();
        for(let t = 0; t < 30; t++) expect(run.tick({i: 2, s: 0, power: 0, ftp: 250})).toBeNull();
        const other = new TestSession(protocol('20min'));
        for(let t = 0; t < 30; t++) expect(other.tick({i: 9, s: 0, power: 0, ftp: 250})).toBeNull();
    });

    test('stopped before the first effort: nothing shown; after it: the result, once', () => {
        const w = protocol('3-12');
        const early = new TestSession(w);
        feed(early, w, () => 150, {until: ({i}) => i === 6});   // stopped before the 3 min
        expect(early.finish({stopped: true})).toBeNull();

        const late = new TestSession(w);
        feed(late, w, () => 300, {until: ({i}) => i === 7});    // after the 3 min, before the 30 min ends
        const r = late.finish({stopped: true});
        expect(r).toEqual({ok: false, reason: 'The test was stopped before the 12 min effort.'});
        expect(late.finish({stopped: true})).toBeNull();
    });

    test('Back to redo an effort: only the new pass counts', () => {
        const w = protocol('20min');
        const run = new TestSession(w);
        const e = w.intervals.findIndex(x => x.steps[0].effort === 'p20');
        for(let t = 0; t < 300; t++) run.tick({i: e, s: 0, power: 200, ftp: 250});   // a bad start
        for(let t = 0; t < 1200; t++) run.tick({i: e, s: 0, power: 200, ftp: 250});  // still the same pass
        expect(run.log).toHaveLength(1500);
        run.tick({i: e - 1, s: 0, power: 150, ftp: 250});                              // Back
        expect(run.log.some(x => x.i === e)).toBe(false);
        for(let t = 0; t < 1200; t++) run.tick({i: e, s: 0, power: 300, ftp: 250});
        expect(run.finish()).toEqual({ok: true, values: {p20: 300, ftp: 285}});
    });

    test('done: the result with the weight', () => {
        const w = protocol('sprint');
        const run = new TestSession(w);
        feed(run, w, step => step.effort ? 900 : 150);
        expect(run.finish({weight: 75}).values).toMatchObject({peak: 900, best5: 900, peakWkg: 12});
    });
});
