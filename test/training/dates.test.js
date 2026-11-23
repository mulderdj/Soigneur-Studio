import { localDay, addDays, daysBetween, weekStart, monthStart, dayToDate } from '../../src/training/dates.js';

describe('local days', () => {
    test('local day of a late-evening time', () => {
        expect(localDay(new Date(2026, 9, 25, 23, 30).getTime())).toBe('2026-10-25');
    });

    test('days across a DST change are one apart', () => {
        expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
        expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
        expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    test('weeks start on Monday', () => {
        expect(weekStart('2026-11-23')).toBe('2026-11-23'); // Monday
        expect(weekStart('2026-11-29')).toBe('2026-11-23'); // Sunday
        expect(weekStart('2026-10-25')).toBe('2026-10-19'); // DST Sunday
    });

    test('month start and day round trip', () => {
        expect(monthStart('2026-11-23')).toBe('2026-11-01');
        expect(localDay(dayToDate('2026-02-28').getTime())).toBe('2026-02-28');
    });
});
