import { intervalsFromSteps, intervalsFromLaps, detectIntervals, pickIntervals } from '../../src/analysis/intervals.js';
const { FTP, workout, rideOf } = require('./fixtures.js');

const work = list => list.filter(i => i.kind === 'work');

describe('intervals from the workout\'s steps', () => {
    test('every step on the ride\'s time line, work reps at their target', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        const {intervals, target} = intervalsFromSteps(w, samples, {ftp: FTP, pauses});
        expect(intervals).toHaveLength(12);
        expect(work(intervals).map(i => [i.start, i.end])).toEqual([[300, 540], [720, 960], [1140, 1380], [1560, 1800], [1980, 2220]]);
        expect(work(intervals)[0]).toMatchObject({target: 275, planned: 240, rep: 1});
        expect(target[400]).toBe(275);
        expect(target[100]).toBe(150);
    });
    test('a pause in a rep moves the rest of the workout on by the pause', () => {
        const w = workout(), {samples, pauses} = rideOf(w, {pauses: [{at: 800, seconds: 90}]});   // in rep 2
        const {intervals, target} = intervalsFromSteps(w, samples, {ftp: FTP, pauses});
        const reps = work(intervals);
        expect([reps[1].start, reps[1].end]).toEqual([720, 1050]);      // the pause inside it
        expect(reps[1].paused).toBe(90);
        expect([reps[2].start, reps[2].end]).toEqual([1230, 1470]);
        expect(target[850]).toBeNull();                                  // no target while paused
    });
    test('the ride ends early: the rep in progress is cut short, the rest are not there', () => {
        const w = workout(), {samples, pauses} = rideOf(w, {stopAt: 1560 + 90});    // 90 s into rep 4
        const {intervals} = intervalsFromSteps(w, samples, {ftp: FTP, pauses});
        const reps = work(intervals);
        expect(reps).toHaveLength(5);
        expect(reps[3]).toMatchObject({start: 1560, end: 1650, planned: 240});
        expect(reps[4]).toMatchObject({start: null, end: null, planned: 240});
    });
});

describe('workout steps on the laps the app wrote', () => {
    // the app writes a lap per workout interval; a free ride before the workout is a lap of its own
    const lapsOf = (w, offset = 0, lengths = null) => {
        const laps = offset ? [{start: 0, end: offset}] : [];
        let t = offset;
        w.intervals.forEach((iv, i) => { const d = lengths?.[i] ?? iv.duration; laps.push({start: t, end: t + d}); t += d; });
        return laps;
    };
    const ridden = (w, offset, lengths) => {
        const total = offset + w.intervals.reduce((a, iv, i) => a + (lengths?.[i] ?? iv.duration), 0);
        return Array.from({length: total}, (_, t) => ({t, power: 200, heartRate: 130, cadence: 85, speed: 8, distance: t, altitude: 0}));
    };
    test('the workout started 5 min after the clock: the steps start at the workout\'s lap', () => {
        const w = workout();
        const samples = ridden(w, 300), laps = lapsOf(w, 300);
        const {intervals} = intervalsFromSteps(w, samples, {ftp: FTP, pauses: [], laps});
        expect(intervals[0]).toMatchObject({start: 300, end: 600});
        expect(intervals.find(i => i.rep === 1)).toMatchObject({start: 600, end: 840});
    });
    test('a step skipped with the lap button: that rep is cut short, the next starts where its lap starts', () => {
        const w = workout();
        const lengths = w.intervals.map((iv, i) => (i === 3 ? 60 : iv.duration));      // rep 2 (index 3) skipped after 60 s
        const samples = ridden(w, 0, lengths), laps = lapsOf(w, 0, lengths);
        const {intervals} = intervalsFromSteps(w, samples, {ftp: FTP, pauses: [], laps});
        const reps = intervals.filter(i => i.kind === 'work');
        expect(reps[1]).toMatchObject({start: 720, end: 780, planned: 240});
        expect(reps[2].start).toBe(780 + 180);
    });
    test('laps that don\'t fit the workout (a Garmin auto-lap every 5 km) are not used for it', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        const laps = Array.from({length: 4}, (_, i) => ({start: i * 600, end: (i + 1) * 600}));
        const {intervals} = intervalsFromSteps(w, samples, {ftp: FTP, pauses, laps});
        expect(intervals.find(i => i.rep === 1)).toMatchObject({start: 300, end: 540});
    });
});

describe('laps and detection', () => {
    test('laps become intervals; one lap is no intervals', () => {
        expect(intervalsFromLaps([{start: 0, end: 300}, {start: 300, end: 600}])).toEqual([{start: 0, end: 300, kind: 'lap', lap: 1}, {start: 300, end: 600, kind: 'lap', lap: 2}]);
        expect(intervalsFromLaps([{start: 0, end: 600}])).toEqual([]);
    });
    test('efforts found from power: the five reps of the workout', () => {
        const {samples} = rideOf(workout());
        const found = detectIntervals(samples, FTP);
        expect(found).toHaveLength(5);
        for(const [i, f] of found.entries()) {
            expect(Math.abs(f.start - (300 + i * 420))).toBeLessThanOrEqual(30);
            expect(f.end - f.start).toBeGreaterThan(200);
        }
    });
    test('no power: nothing detected', () => {
        const {samples} = rideOf(workout());
        expect(detectIntervals(samples.map(s => ({...s, power: null})), FTP)).toEqual([]);
    });
    test('the order: steps, then laps, then detection', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        expect(pickIntervals({workout: w, laps: [], samples, pauses, ftp: FTP}).source).toBe('workout');
        expect(pickIntervals({laps: [{start: 0, end: 900}, {start: 900, end: 2400}], samples, pauses, ftp: FTP}).source).toBe('laps');
        expect(pickIntervals({laps: [], samples, pauses, ftp: FTP}).source).toBe('detected');
        expect(pickIntervals({laps: [], samples: samples.map(s => ({...s, power: null})), pauses, ftp: FTP}).source).toBe('none');
    });
});
