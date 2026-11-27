import { efforts, reps, hrRecovery, rideCurve, powerHr, efficiency, decouplingTrend, durabilityTrend, readinessPairs, polarised, pearson, weekOf } from '../../src/analysis/insights.js';

// a ride of `seconds` with power and heart rate from functions of t
const ride = (seconds, power, hr) => Array.from({length: seconds}, (_, t) => ({t, power: power(t), heartRate: hr(t)}));
const iv = (start, end, kind, stats = {}, extra = {}) => ({start, end, kind, stats, ...extra});

describe('efforts and reps', () => {
    test('work intervals; for laps, those at ≥ 88 % FTP', () => {
        const a = {intervals: [iv(0, 600, 'rest'), iv(600, 840, 'work', {avgPower: 300, avgTarget: 300, avgHr: 170, maxHr: 180}, {target: 300}), iv(840, 960, 'rest')]};
        expect(reps(a, 250)).toEqual([{n: 1, start: 600, end: 840, power: 300, target: 300, hr: 170, maxHr: 180}]);
        const laps = {intervals: [iv(0, 600, 'lap', {avgPower: 150}), iv(600, 840, 'lap', {avgPower: 230}), iv(840, 960, 'lap', {avgPower: 210})]};
        expect(efforts(laps, 250).map(e => e.start)).toEqual([600]);       // 230 ≥ 220, 210 < 220
        expect(reps(laps, 250)[0].target).toBeNull();
    });
    test('skipped intervals (no start) are left out', () => {
        expect(efforts({intervals: [iv(null, null, 'work')]}, 250)).toEqual([]);
    });
});

describe('heart-rate recovery', () => {
    // two 3-min efforts with HR rising to 180, dropping 1 bpm/s afterwards to 140
    const hr = t => (t >= 300 && t < 480) || (t >= 600 && t < 780) ? 180 : Math.max(140, 180 - (t >= 780 ? t - 780 : t >= 480 ? t - 480 : 99));
    const samples = ride(1000, () => 200, hr);
    const a = {intervals: [iv(300, 480, 'work'), iv(480, 600, 'rest'), iv(600, 780, 'work'), iv(780, 1000, 'rest')]};
    test('the drop in the 60 s after each effort', () => {
        expect(hrRecovery(samples, a, 250)).toEqual([
            {n: 1, end: 480, hrEnd: 180, hr60: 140, drop: 40},
            {n: 2, end: 780, hrEnd: 180, hr60: 140, drop: 40},
        ]);
    });
    test('a pause in the minute after, no heart rate, or a single effort: left out', () => {
        expect(hrRecovery(samples, a, 250, [{start: 500, end: 520}])).toEqual([]);   // one left: under 2
        const noHr = samples.map(s => ({...s, heartRate: null}));
        expect(hrRecovery(noHr, a, 250)).toEqual([]);
    });
    test('efforts under 30 s are left out', () => {
        const short = {intervals: [iv(300, 320, 'work'), iv(600, 620, 'work')]};
        expect(hrRecovery(samples, short, 250)).toEqual([]);
    });
});

describe('this ride\'s curve', () => {
    test('best power at the durations; null when the ride is shorter', () => {
        const c = rideCurve(ride(600, t => (t < 60 ? 400 : 200), () => 140));
        expect(c[60]).toBe(400);
        expect(c[600]).toBe(220);
        expect(c[1200]).toBeNull();
    });
});

describe('power against heart rate', () => {
    test('30 s averages in two halves; short rides and pauses', () => {
        const pts = powerHr(ride(40 * 60, () => 200, t => 130 + Math.floor(t / 600)));
        expect(pts).toHaveLength(80);
        expect(pts[0]).toEqual({t: 0, power: 200, hr: 130, half: 1});
        expect(pts[79].half).toBe(2);
        expect(powerHr(ride(10 * 60, () => 200, () => 130))).toEqual([]);
        // paused seconds are left out of the averages and the halves
        const paused = powerHr(ride(40 * 60, () => 200, () => 130), [{start: 0, end: 600}]);
        expect(paused).toHaveLength(60);
    });
});

const S = (day, np, avgHr, extra = {}) => ({id: day, day, name: `Ride ${day}`, sport: 'cycling', np, avgHr, duration: 3600, if: 0.7, ...extra});

describe('aerobic efficiency', () => {
    test('steady rides only, with a rolling mean', () => {
        const list = efficiency([
            S('2026-11-01', 200, 140), S('2026-11-10', 210, 140),
            S('2026-11-05', 260, 160, {if: 0.95}),          // hard: out
            S('2026-11-06', 200, 140, {duration: 1200}),     // short: out
            S('2026-11-07', 200, null),                      // no HR: out
            S('2026-11-08', 200, 140, {sport: 'run'}),       // not cycling: out
        ]);
        expect(list.map(p => [p.day, p.ef])).toEqual([['2026-11-01', 1.43], ['2026-11-10', 1.5]]);
        expect(list.rolling).toEqual([1.43, 1.47]);
    });
});

describe('readiness and performance', () => {
    const wellness = [];
    for(let i = 0; i < 40; i++) {
        const day = `2026-10-${String(i + 1).padStart(2, '0')}`.replace('2026-10-32', '2026-11-01');
        if(i < 31) wellness.push({day, hrv: 60, sleepSeconds: 7 * 3600});
    }
    test('HRV against its range and efficiency against the rides before; r and n', () => {
        // efficiency follows HRV: high-HRV mornings give better rides
        const days = Array.from({length: 20}, (_, i) => `2026-10-${String(i + 10).padStart(2, '0')}`);
        const wl = wellness.map(d => ({...d}));
        const rides = days.map((day, i) => {
            const up = i % 2 === 0;
            const w = wl.find(d => d.day === day); w.hrv = up ? 70 : 52;
            return S(day, up ? 215 : 195, 140);
        });
        const out = readinessPairs(rides, wl, 'hrv');
        expect(out.n).toBeGreaterThanOrEqual(8);
        expect(out.enough).toBe(true);
        expect(out.r).toBeGreaterThan(0.8);
        const sleep = readinessPairs(rides, wl, 'sleep');
        expect(sleep.points[0].x).toBe(7);
    });
    test('too few rides: no r', () => {
        const out = readinessPairs([S('2026-10-20', 200, 140)], wellness, 'hrv');
        expect(out).toEqual({points: [], n: 0, r: null, enough: false});
    });
    test('pearson', () => {
        expect(pearson([{x: 1, y: 2}, {x: 2, y: 4}, {x: 3, y: 6}])).toBe(1);
        expect(pearson([{x: 1, y: 1}, {x: 2, y: 1}, {x: 3, y: 1}])).toBeNull();
    });
});

describe('intensity distribution', () => {
    test('shares per week: Z1–Z2, Z3–Z5, Z6–Z7', () => {
        const weeks = polarised([
            {day: '2026-11-17', zoneSeconds: [600, 2400, 300, 300, 300, 100, 0]},   // week of Mon 16 Nov
            {day: '2026-11-24', zoneSeconds: [0, 0, 0, 0, 0, 0, 0]},
        ], '2026-11-25', 2);
        expect(weeks.map(w => w.week)).toEqual(['2026-11-16', '2026-11-23']);
        expect(weeks[0].seconds).toBe(4000);
        expect(weeks[0].easy).toBeCloseTo(0.75);
        expect(weeks[0].middle).toBeCloseTo(0.225);
        expect(weeks[0].hard).toBeCloseTo(0.025);
        expect(weeks[1]).toMatchObject({seconds: 0, easy: 0});
        expect(weekOf('2026-11-22')).toBe('2026-11-16');   // a Sunday
    });
});

describe('review fixes', () => {
    test('recovery: an effort followed by another within 60 s is left out (30/30)', () => {
        const ivs = [];
        for(let k = 0; k < 6; k++) ivs.push(iv(300 + k * 60, 330 + k * 60, 'work'));
        const samples = ride(1200, () => 300, () => 170);
        expect(hrRecovery(samples, {intervals: ivs}, 250)).toEqual([]);
    });
    test('readiness: only comparable rides (IF 0.60–0.80), at least 12 for r', () => {
        const wl = Array.from({length: 60}, (_, i) => ({day: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), hrv: 60}));
        const rides = wl.slice(20, 40).map((d, i) => S(d.day, 200, 140, {if: i % 2 ? 0.55 : 0.7}));
        const out = readinessPairs(rides, wl, 'hrv');
        expect(out.points.every(p => rides.find(r => r.day === p.day).if === 0.7)).toBe(true);
        expect(out.enough).toBe(false);            // 10 comparable rides, fewer than 12
    });
    test('readiness and efficiency stay fast with years of data', () => {
        const days = Array.from({length: 1800}, (_, i) => new Date(Date.UTC(2021, 0, 1 + i)).toISOString().slice(0, 10));
        const wl = days.map(day => ({day, hrv: 55 + (day.charCodeAt(9) % 10), sleepSeconds: 25000}));
        const rides = days.filter((_, i) => i % 2 === 0).map((day, i) => S(day, 190 + (i % 20), 140, {if: 0.7}));
        const t0 = Date.now();
        const out = readinessPairs(rides, wl, 'hrv');
        efficiency(rides);
        expect(out.n).toBeGreaterThan(800);
        expect(Date.now() - t0).toBeLessThan(250);
    });
    test('power and heart rate: no 30 s point across a pause', () => {
        const samples = ride(40 * 60, () => 200, () => 130);
        const pts = powerHr(samples, [{start: 615, end: 630}]);
        expect(pts.every(p => p.t < 615 - 29 || p.t >= 630)).toBe(true);
    });
});

describe('aerobic decoupling trend', () => {
    test('long steady cycling rides only, sorted, with a 28-day rolling mean', () => {
        const list = decouplingTrend([
            S('2026-11-10', 200, 140, {duration: 5400, decoupling: 3.2}),
            S('2026-11-01', 200, 140, {duration: 5400, decoupling: 6.4}),
            S('2026-11-05', 200, 140, {duration: 2400, decoupling: 4.0}),              // under 45 min: out
            S('2026-11-06', 240, 150, {duration: 5400, avgPower: 200, decoupling: 4}), // VI 1.20 > 1.10: out
            S('2026-11-07', 200, 140, {duration: 5400, decoupling: null}),             // missing: out
            S('2026-11-08', 200, 140, {duration: 5400, sport: 'run', decoupling: 4}),  // not cycling: out
        ]);
        expect(list.map(p => [p.day, p.decoupling])).toEqual([['2026-11-01', 6.4], ['2026-11-10', 3.2]]);
        expect(list.rolling).toEqual([6.4, 4.8]);
    });
});

describe('durability trend', () => {
    test('weekly best after kJ threshold as % of 90-day fresh best', () => {
        const rides = [
            {id: 'fresh', day: '2026-11-02', sport: 'cycling', name: 'VO2', best: {300: 320, 1200: 280}, durability: null},
            {id: 'long1', day: '2026-11-18', sport: 'cycling', name: 'Long 1', best: {300: 290, 1200: 250},
             durability: {1000: {300: 272, 1200: 238}}},
            {id: 'long2', day: '2026-11-25', sport: 'cycling', name: 'Long 2', best: {300: 300, 1200: 260},
             durability: {1000: {300: 288, 1200: 252}, 2000: {300: 256, 1200: null}}},
            {id: 'run1', day: '2026-11-25', sport: 'run', name: 'Run', best: {300: 400}, durability: {1000: {300: 350}}},
        ];
        const w5 = durabilityTrend(rides, '2026-11-26', {kj: 1000, duration: 300, weeks: 3});
        expect(w5.map(w => w.week)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
        expect(w5[0]).toMatchObject({watts: null, fresh: 320, pct: null});
        expect(w5[1]).toMatchObject({watts: 272, fresh: 320, pct: 85});
        expect(w5[2]).toMatchObject({watts: 288, fresh: 320, pct: 90});

        const w2k = durabilityTrend(rides, '2026-11-26', {kj: 2000, duration: 300, weeks: 3});
        expect(w2k[1].pct).toBeNull();
        expect(w2k[2]).toMatchObject({watts: 256, fresh: 320, pct: 80});
    });

    test('gracefully skips rides without durability fields (Garmin / intervals.icu / older summaries)', () => {
        const rides = [
            {id: 'garmin-1', day: '2026-11-20', sport: 'cycling', best: {300: 300}},
            {id: 'icu-1', day: '2026-11-22', sport: 'cycling', best: {300: 310}, durability: null},
        ];
        const rows = durabilityTrend(rides, '2026-11-25', {kj: 1000, duration: 300, weeks: 4});
        expect(rows.every(r => r.pct === null)).toBe(true);
    });
});
