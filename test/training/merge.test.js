import { mergeRides, isCycling } from '../../src/training/merge.js';

const T = new Date(2026, 10, 20, 18, 0).getTime();
const MIN = 60000;
const own = (id, start, minutes) => ({id, start, duration: minutes * 60, day: '2026-11-20'});
const ext = (id, start, minutes, extra = {}) => ({id, start, duration: minutes * 60, day: '2026-11-20', source: 'intervals', ...extra});

describe('mergeRides', () => {
    test('drops an external ride that is one of Auuki\'s own uploads', () => {
        const out = mergeRides([own('r1', T, 60)], [ext('icu-1', T + 6 * 3600000, 30, {auukiRideId: 'r1'})]);
        expect(out.map(s => s.id)).toEqual(['r1']);
    });

    test('drops the same ride uploaded without the link (90 s later, 3 % longer)', () => {
        const out = mergeRides([own('r1', T, 60)], [ext('icu-1', T + 90000, 61.8)]);
        expect(out.map(s => s.id)).toEqual(['r1']);
    });

    test('drops a head unit recording that started 5 min earlier and stopped 2 min later', () => {
        const out = mergeRides([own('r1', T, 60)], [ext('icu-1', T - 5 * MIN, 67)]);
        expect(out.map(s => s.id)).toEqual(['r1']);
    });

    test('keeps a 20-min ride that overlaps a 2-h ride for only its last 5 min', () => {
        const out = mergeRides([own('r1', T, 120)], [ext('icu-1', T - 15 * MIN, 20)]);
        expect(out.map(s => s.id)).toEqual(['icu-1', 'r1']);
    });

    test('keeps two different rides on the same day, sorted by start', () => {
        const out = mergeRides([own('r1', T, 60)], [ext('icu-1', T - 5 * 3600000, 90)]);
        expect(out.map(s => s.id)).toEqual(['icu-1', 'r1']);
    });

    test('keeps everything when there are no external rides', () => {
        expect(mergeRides([own('b', T + 1, 10), own('a', T, 10)], []).map(s => s.id)).toEqual(['a', 'b']);
    });
});

describe('several outside sources', () => {
    const g = (id, start, minutes) => ext(id, start, minutes, {source: 'garmin'});
    const f = (id, start, minutes) => ext(id, start, minutes, {source: 'fit'});

    test('a ride on Garmin and on intervals.icu: the Garmin copy is kept', () => {
        const out = mergeRides([], [ext('icu-1', T + 30000, 60), g('garmin-1', T, 61)]);
        expect(out.map(s => s.id)).toEqual(['garmin-1']);
    });

    test('Garmin, intervals.icu and an Auuki recording: only Auuki\'s', () => {
        const out = mergeRides([own('r1', T, 60)], [ext('icu-1', T + 30000, 60), g('garmin-1', T - 60000, 62)]);
        expect(out.map(s => s.id)).toEqual(['r1']);
    });

    test('an imported .fit and intervals.icu: the .fit', () => {
        const out = mergeRides([], [ext('icu-1', T, 60), f('fit-1', T, 60)]);
        expect(out.map(s => s.id)).toEqual(['fit-1']);
    });

    test('two different rides from Garmin and intervals.icu on one day: both', () => {
        const out = mergeRides([], [ext('icu-1', T - 5 * 3600000, 45), g('garmin-1', T, 60)]);
        expect(out.map(s => s.id)).toEqual(['icu-1', 'garmin-1']);
    });

    test('rides around midnight are still compared', () => {
        const late = new Date(2026, 10, 20, 23, 30).getTime();
        const out = mergeRides([], [{...ext('icu-1', late, 60), day: '2026-11-20'}, {...g('garmin-1', late + 60000, 60), day: '2026-11-21'}]);
        expect(out.map(s => s.id)).toEqual(['garmin-1']);
    });
});

describe('isCycling', () => {
    test('Auuki rides and cycling count, other sports not', () => {
        expect(isCycling({})).toBe(true);
        expect(isCycling({sport: 'cycling'})).toBe(true);
        expect(isCycling({sport: 'run'})).toBe(false);
    });
});
