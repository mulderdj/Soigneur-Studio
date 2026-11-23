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
        for(const e of a.plan) expect(e.workout.intervals.length).toBeGreaterThan(0);
    });
});
