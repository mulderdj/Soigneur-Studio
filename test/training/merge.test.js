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

describe('isCycling', () => {
    test('Auuki rides and cycling count, other sports not', () => {
        expect(isCycling({})).toBe(true);
        expect(isCycling({sport: 'cycling'})).toBe(true);
        expect(isCycling({sport: 'run'})).toBe(false);
    });
});
