import { analyseRide, intervalStats, plannedVsActual } from '../../src/analysis/ride.js';
import { intervalsFromSteps } from '../../src/analysis/intervals.js';
const { FTP, workout, rideOf, steady } = require('./fixtures.js');

const base = {ftp: FTP, wprime: 20000, lthr: 170, summaries: []};

describe('one interval', () => {
    test('averages, NP, % FTP, time on target, fade, HR drift', () => {
        const w = workout(), {samples, pauses} = rideOf(w, {fade: 0.1});
        const {intervals} = intervalsFromSteps(w, samples, {ftp: FTP, pauses});
        const rep = intervals.find(i => i.kind === 'work');
        const s = intervalStats(samples, rep, FTP);
        expect(s.duration).toBe(240);
        expect(s.avgPower).toBeGreaterThan(255);
        expect(s.avgPower).toBeLessThan(275);
        expect(s.pctFtp).toBeCloseTo(s.avgPower / FTP * 100, 0);
        expect(s.avgHr).toBe(166);
        expect(s.fade).toBeLessThan(-0.03);                      // second half weaker
        expect(s.onTarget).toBeGreaterThan(0);
        expect(s.onTarget).toBeLessThan(1);
    });
    test('a short one: averages only; no power: power fields null', () => {
        const {samples} = rideOf(workout());
        expect(intervalStats(samples, {start: 300, end: 310, kind: 'work'}, FTP)).toMatchObject({duration: 10, np: null, fade: null});
        const s = intervalStats(samples.map(x => ({...x, power: null})), {start: 300, end: 540, kind: 'work'}, FTP);
        expect(s).toMatchObject({avgPower: null, np: null, pctFtp: null, fade: null});
        expect(s.avgHr).toBe(166);
    });
});

describe('planned against actual', () => {
    test('each rep: target, done, difference; cut short and skipped', () => {
        const w = workout(), {samples, pauses} = rideOf(w, {stopAt: 1560 + 90});
        const {intervals} = intervalsFromSteps(w, samples, {ftp: FTP, pauses});
        const reps = plannedVsActual(intervals, samples);
        expect(reps.map(r => r.status)).toEqual(['done', 'done', 'done', 'cut-short', 'skipped']);
        expect(reps[0]).toMatchObject({rep: 1, target: 275});
        expect(Math.abs(reps[0].diffW)).toBeLessThanOrEqual(2);
        expect(reps[4]).toMatchObject({done: null, diffW: null});
    });
});

describe('the whole ride', () => {
    test('a workout: intervals from its steps, W′bal and matches, zones, bests', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        const a = analyseRide({...base, samples, pauses, workout: w});
        expect(a.hasPower).toBe(true);
        expect(a.intervalSource).toBe('workout');
        expect(a.reps).toHaveLength(5);
        expect(a.wbal.series).toHaveLength(samples.length);
        expect(a.wbal.min).toBeLessThan(20000);
        expect(a.wbal.matches.length).toBeGreaterThanOrEqual(1);
        expect(a.powerZones.reduce((x, z) => x + z.seconds, 0)).toBe(samples.length);
        expect(a.bests.find(b => b.seconds === 60).watts).toBeGreaterThan(270);     // a minute of a rep at 275 W
    });
    test('a steady 2 h ride: decoupling about the HR drift, EF, durability', () => {
        const samples = steady({drift: 0.1});                     // HR 140 → 154: halves ~4.5 % apart
        const a = analyseRide({...base, samples, pauses: []});
        expect(a.decoupling).toBeGreaterThan(3.5);
        expect(a.decoupling).toBeLessThan(5.5);
        expect(a.ef).toBeCloseTo(200 / 147, 1);
        expect(a.durability.map(d => d.kj)).toEqual([1000]);     // 1,440 kJ: only the first threshold
        expect(a.durability[0].best5).toBe(200);
        expect(a.hrZones.reduce((x, z) => x + z.seconds, 0)).toBe(7200);
    });
    test('under 45 minutes: no decoupling', () => {
        expect(analyseRide({...base, samples: steady({seconds: 2400}), pauses: []}).decoupling).toBeNull();
    });
    test('no power: no power analysis, the heart-rate side still there, no NaN anywhere', () => {
        const a = analyseRide({...base, samples: steady({withPower: false}), pauses: []});
        expect(a).toMatchObject({hasPower: false, hasHr: true, wbal: null, powerZones: null, durability: [], decoupling: null, ef: null});
        expect(a.hrZones.length).toBe(5);
        expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
    });
    test('a pause is left out of W′bal, zones and averages', () => {
        const w = workout(), {samples, pauses} = rideOf(w, {pauses: [{at: 800, seconds: 600}]});
        const a = analyseRide({...base, samples, pauses, workout: w});
        expect(a.powerZones.reduce((x, z) => x + z.seconds, 0)).toBe(samples.length - 600);
        expect(a.wbal.series[1000]).toBeNull();
    });
    test('a best effort that beats the rider\'s other rides is marked', () => {
        const samples = steady();
        const day = '2026-11-20';
        const summaries = [{id: 'old', day: '2026-11-01', best: {5: 900, 60: 400, 300: 190, 1200: 180, 3600: 170}},
                           {id: 'older', day: '2025-01-01', best: {5: 1000, 60: 450, 300: 195, 1200: 210, 3600: 205}}];
        const a = analyseRide({...base, samples, pauses: [], summaries, day, id: 'this'});
        expect(a.bests.find(b => b.seconds === 300).record).toBe('all');
        expect(a.bests.find(b => b.seconds === 1200).record).toBe('recent');
        expect(a.bests.find(b => b.seconds === 5).record).toBeNull();
    });

    test('decoupling only for steady riding: an interval workout has none', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        const long = {...w, intervals: [...w.intervals, ...w.intervals]};            // over 45 min
        const r = rideOf(long);
        expect(analyseRide({...base, samples: r.samples, pauses: r.pauses, workout: long}).decoupling).toBeNull();
    });
});
