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
        const icu = a.external.filter(r => r.id.startsWith('icu-'));
        expect(icu.length).toBeGreaterThanOrEqual(3);
        for(const r of icu) {
            expect(r.source).toBe('intervals');
            expect(r.sport).toBe('run');
            expect(r.id).toMatch(/^icu-/);
            expect(r.day <= today).toBe(true);
            expect(r.tss).toBeGreaterThan(0);
        }
        const planned = a.plan.filter(e => e.origin === 'intervals');
        expect(planned.some(e => e.workout?.intervals.length > 0 && e.day > today)).toBe(true);
        expect(planned.some(e => e.workout === null && e.name)).toBe(true);
    });

    test('90 days of health data, a Garmin gym session and a run with heart rate only', () => {
        expect(a.wellness).toHaveLength(90);
        expect(a.wellness.at(-1).day).toBe(today);
        for(const d of a.wellness) {
            expect(d.id).toBe(d.day);
            expect(d.hrv).toBeGreaterThan(30);
            expect(d.hrv).toBeLessThan(100);
            expect(d.restingHr).toBeGreaterThan(38);
            expect(d.sleepSeconds).toBeGreaterThan(4 * 3600);
            expect(d.hrvBaseline.low).toBeLessThan(d.hrvBaseline.high);
        }
        const gym = a.external.filter(r => r.source === 'garmin' && r.sport === 'weighttraining');
        expect(gym.length).toBeGreaterThan(0);
        expect(gym.every(r => r.tss === null && r.avgHr === null)).toBe(true);
        const hrRuns = a.external.filter(r => r.source === 'garmin' && r.sport === 'run');
        expect(hrRuns.length).toBeGreaterThan(0);
        expect(hrRuns.every(r => r.tss === null && r.avgHr > 100)).toBe(true);
        expect(a.thresholds).toEqual({cycling: 165, running: 172});
    });
});
