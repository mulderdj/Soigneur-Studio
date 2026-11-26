import { hrvRange, hrvState, latestNight, restingTrend } from '../../src/training/wellness.js';

const day = (i) => new Date(Date.UTC(2026, 10, 23) - i * 86400000).toISOString().slice(0, 10);
const series = (n, f) => Array.from({length: n}, (_, i) => ({day: day(n - 1 - i), ...f(i)}));

describe('HRV normal range', () => {
    test('Garmin\'s baseline when the latest night has one', () => {
        const days = series(20, i => ({hrv: 60, hrvBaseline: i === 19 ? {low: 52, high: 66} : {low: 40, high: 50}}));
        expect(hrvRange(days)).toEqual({low: 52, high: 66, source: 'garmin'});
    });

    test('else the rider\'s own 60 days: mean ± 1 SD, from 14 nights', () => {
        const days = series(20, i => ({hrv: i % 2 ? 50 : 60})); // mean 55, SD 5
        expect(hrvRange(days)).toEqual({low: 50, high: 60, source: 'own'});
        expect(hrvRange(series(13, () => ({hrv: 55})))).toBeNull();
        // only the last 60 days count
        const long = [...series(100, () => ({hrv: 100})).slice(0, 40), ...series(60, i => ({hrv: i % 2 ? 50 : 60}))];
        expect(hrvRange(long).low).toBe(50);
    });

    test('state of a night', () => {
        const r = {low: 50, high: 60};
        expect(hrvState(45, r)).toBe('below');
        expect(hrvState(50, r)).toBe('in');
        expect(hrvState(61, r)).toBe('above');
        expect(hrvState(55, null)).toBeNull();
        expect(hrvState(null, r)).toBeNull();
        expect(hrvState(0, r)).toBeNull();
        expect(latestNight([{day: '2026-11-21', hrv: 50}, {day: '2026-11-22', hrv: 0, restingHr: 0, sleepSeconds: 0, bodyBattery: 0}]).day).toBe('2026-11-21');
    });
});

describe('the latest night and resting heart rate', () => {
    test('the latest day with any value', () => {
        expect(latestNight([{day: '2026-11-21', hrv: 50}, {day: '2026-11-22', restingHr: 48}, {day: '2026-11-23'}]).day).toBe('2026-11-22');
        expect(latestNight([])).toBeNull();
    });

    test('resting heart rate against the 30 days before', () => {
        const days = [...series(31, () => ({restingHr: 48})).slice(0, 30), {day: day(0), restingHr: 54}];
        expect(restingTrend(days)).toEqual({value: 54, average: 48, day: day(0)});
        expect(restingTrend([{day: day(0), restingHr: 50}])).toEqual({value: 50, average: null, day: day(0)});
        expect(restingTrend([])).toBeNull();
    });
});

describe('the HRV range of each night (charts over months)', () => {
    const { hrvRangeOn } = require('../../src/training/wellness.js');
    test('Garmin\'s baseline stored with that night', () => {
        const days = [{day: '2026-05-01', hrv: 50, hrvBaseline: {low: 44, high: 58}}, {day: '2026-11-20', hrv: 40, hrvBaseline: {low: 38, high: 52}}];
        expect(hrvRangeOn('2026-05-01', days)).toEqual({low: 44, high: 58, source: 'garmin'});
    });
    test('else the 60 days before that night (not after), from 14 nights', () => {
        const before = series(20, i => ({hrv: i % 2 ? 50 : 60}));                         // ends at day(0) = 2026-11-23
        const after = [{day: '2026-11-25', hrv: 90}, {day: '2026-11-26', hrv: 90}];
        const target = {day: '2026-11-24', hrv: 45};
        expect(hrvRangeOn('2026-11-24', [...before, target, ...after])).toEqual({low: 50, high: 60, source: 'own'});
        expect(hrvRangeOn('2026-11-24', [...before.slice(-13), target])).toBeNull();
    });
});
