import { generateHistory } from '../../src/dev/history-seed.js';
import { planStatus } from '../../src/training/plan.js';

const today = '2026-11-23';

describe('generated training history', () => {
    const a = generateHistory({today, seed: 1});

    test('same seed, same history', () => {
        const b = generateHistory({today, seed: 1});
        expect(b.summaries.map(s => [s.id, s.tss])).toEqual(a.summaries.map(s => [s.id, s.tss]));
        expect(generateHistory({today, seed: 2}).summaries.map(s => s.tss)).not.toEqual(a.summaries.map(s => s.tss));
    });

    test('120 days of realistic riding', () => {
        expect(a.summaries.length).toBeGreaterThanOrEqual(60);
        expect(a.summaries.length).toBeLessThanOrEqual(90);
        for(const s of a.summaries) {
            expect(s.version).toBe(1);
            expect(s.day <= today).toBe(true);
            expect(s.duration).toBeGreaterThan(0);
            expect(s.tss).toBeGreaterThan(0);
            expect(s.zoneSeconds).toHaveLength(7);
            expect(s.best).toHaveProperty('1200');
        }
    });

    test('a plan ahead, and some done and missed days behind', () => {
        const statuses = a.plan.map(e => planStatus(e, today));
        expect(a.plan.some(e => e.day > today)).toBe(true);
        expect(statuses).toContain('done');
        expect(statuses).toContain('missed');
        for(const e of a.plan.filter(e => e.workout)) expect(e.workout.intervals.length).toBeGreaterThan(0);
    });

    test('runs from intervals.icu, and intervals.icu plan entries (one unreadable)', () => {
        expect(a.external.length).toBeGreaterThanOrEqual(3);
        for(const r of a.external) {
            expect(r.source).toBe('intervals');
            expect(r.sport).toBe('run');
            expect(r.id).toMatch(/^icu-/);
            expect(r.day <= today).toBe(true);
            expect(r.tss).toBeGreaterThan(0);
        }
        const icu = a.plan.filter(e => e.origin === 'intervals');
        expect(icu.some(e => e.workout?.intervals.length > 0 && e.day > today)).toBe(true);
        expect(icu.some(e => e.workout === null && e.name)).toBe(true);
    });
});
