import { readiness, isHard, easier, recoverySpin, nextFreeDay } from '../../src/training/readiness.js';

const today = '2026-11-24';
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const range = {low: 52, high: 65};
// 30 calm nights, then what the test puts on the last ones
function nights(last = {}, {before = {}} = {}) {
    const days = [];
    for(let i = 30; i >= 1; i--) days.push({day: addDays(today, -i), hrv: 58, hrvBaseline: range, restingHr: 48, sleepSeconds: 7.5 * 3600, bodyBattery: 70});
    if(Object.keys(before).length) Object.assign(days.at(-1), before);
    days.push({day: today, hrv: 58, hrvBaseline: range, restingHr: 48, sleepSeconds: 7.5 * 3600, bodyBattery: 70, ...last});
    return days;
}
// steady training: 60 TSS a day for 90 days, and yesterday's load
const load = (yesterday = 60, daily = 60) => Array.from({length: 90}, (_, i) => ({id: `r${i}`, day: addDays(today, -90 + i), tss: i === 89 ? yesterday : daily}));
const base = {today, summaries: load(), plan: [], ftp: 250};

describe('the verdict', () => {
    test('all calm: ready, with the good signs as reasons', () => {
        const r = readiness({...base, days: nights()});
        expect(r.state).toBe('ready');
        expect(r.basis).toBe('health');
        expect(r.reasons[0]).toMatch(/HRV 58 ms in your range \(52–65\)/);      // HRV first, form last
        expect(r.reasons.at(-1)).toMatch(/^Form/);
    });
    test('take care: one signal off', () => {
        expect(readiness({...base, days: nights({hrv: 48})}).state).toBe('take-care');
        expect(readiness({...base, days: nights({restingHr: 51})}).state).toBe('take-care');
        expect(readiness({...base, days: nights({sleepSeconds: 5.5 * 3600})}).state).toBe('take-care');
        expect(readiness({...base, days: nights({bodyBattery: 25})}).state).toBe('take-care');
        expect(readiness({...base, days: nights(), summaries: [...load(60, 40), ...Array.from({length: 7}, (_, i) => ({id: `h${i}`, day: addDays(today, -7 + i), tss: 220}))]}).state).toBe('take-care');
    });
    test('rest: HRV low two nights running, or low HRV with resting HR up 5, or very short sleep after a hard day', () => {
        const two = readiness({...base, days: nights({hrv: 47}, {before: {hrv: 49}})});
        expect(two.state).toBe('rest');
        expect(two.reasons[0]).toMatch(/2nd night/);
        expect(readiness({...base, days: nights({hrv: 48, restingHr: 54})}).state).toBe('rest');
        expect(readiness({...base, days: nights({sleepSeconds: 4.5 * 3600}), summaries: load(120)}).state).toBe('rest');
        expect(readiness({...base, days: nights({sleepSeconds: 4.5 * 3600}), summaries: load(40)}).state).toBe('take-care');
    });
    test('reasons, worst first, in plain words', () => {
        const r = readiness({...base, days: nights({hrv: 48, restingHr: 54, sleepSeconds: 5.5 * 3600})});
        expect(r.reasons[0]).toMatch(/HRV 48 ms, below your range/);
        expect(r.reasons.join(' · ')).toMatch(/resting heart rate \+6/i);
        expect(r.reasons.join(' · ')).toMatch(/slept 5:30/);
    });
    test('no health data from last night (none, or only older): the verdict from form, said plainly', () => {
        const none = readiness({...base, days: []});
        expect(none.basis).toBe('form');
        expect(none.state).toBe('ready');
        expect(none.reasons.join(' ')).toMatch(/No health data from last night/);
        const stale = readiness({...base, days: nights().slice(0, -3)});
        expect(stale.basis).toBe('form');
        const tired = readiness({...base, days: [], summaries: [...load(60, 40), ...Array.from({length: 7}, (_, i) => ({id: `h${i}`, day: addDays(today, -7 + i), tss: 220}))]});
        expect(tired.state).toBe('take-care');
    });
    test('yesterday\'s night (Garmin a day behind) still counts as last night', () => {
        const days = nights({hrv: 48}).slice(0, -1).concat([{day: addDays(today, -1), hrv: 47, hrvBaseline: range}]);
        expect(readiness({...base, days: days.slice(-31)}).basis).toBe('health');
    });
});

describe('hard workouts and easier versions', () => {
    const iv = (duration, power) => ({duration, steps: [{duration, power}]});
    const vo2 = {id: 'w', meta: {name: 'VO2 max 5x4'}, intervals: [iv(600, 0.6), ...Array.from({length: 5}, () => [iv(240, 1.15), iv(240, 0.5)]).flat()]};
    test('hard: 10 min at 88 % FTP or more, or 3 min above 105 %', () => {
        expect(isHard(vo2, 250)).toBe(true);
        expect(isHard({intervals: [iv(3600, 0.7)]}, 250)).toBe(false);
        expect(isHard({intervals: [iv(600, 0.9)]}, 250)).toBe(true);
        expect(isHard({intervals: [iv(180, 1.1)]}, 250)).toBe(true);
        expect(isHard({intervals: [iv(120, 1.1)]}, 250)).toBe(false);
        expect(isHard(null, 250)).toBe(false);
    });
    test('easier: every step above 85 % down to 85 %, units kept, slope steps left alone, name marked', () => {
        const w = easier({...vo2, intervals: [...vo2.intervals, iv(300, 300), {duration: 60, steps: [{duration: 60, slope: 4}]}]}, 250);
        expect(w.meta.name).toBe('VO2 max 5x4 (easier)');
        expect(w.intervals[1].steps[0].power).toBe(0.85);
        expect(w.intervals[0].steps[0].power).toBe(0.6);
        expect(w.intervals.at(-2).steps[0].power).toBe(213);          // 300 W → 85 % of 250
        expect(w.intervals.at(-1).steps[0]).toEqual({duration: 60, slope: 4});
        expect(vo2.intervals[1].steps[0].power).toBe(1.15);            // the original untouched
        expect(isHard(w, 250)).toBe(false);                              // sweet spot is under the 88 % line
    });
    test('a recovery spin: 30 min easy', () => {
        const r = recoverySpin();
        expect(r.meta.name).toBe('Recovery spin');
        expect(r.intervals.reduce((a, x) => a + x.duration, 0)).toBe(1800);
        expect(isHard(r, 250)).toBe(false);
    });
    test('the next free day within a week', () => {
        const plan = [{day: '2026-11-25', deleted: false}, {day: '2026-11-26', deleted: true}, {day: '2026-11-24', deleted: false}];
        expect(nextFreeDay(plan, today)).toBe('2026-11-26');
        const full = Array.from({length: 7}, (_, i) => ({day: addDays(today, i + 1), deleted: false}));
        expect(nextFreeDay(full, today)).toBeNull();
    });
});
