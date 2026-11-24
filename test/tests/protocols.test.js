import { protocols, protocol, TEST_IDS } from '../../src/tests/protocols.js';

const steps = w => w.intervals.flatMap(i => i.steps);
const shape = w => steps(w).map(s => s.slope === 1 ? `!${s.duration}` : `${s.duration}@${s.power}`);

describe('built-in tests', () => {
    test('five tests, category Test, stable ids', () => {
        const all = protocols();
        expect(all.map(w => w.meta.test)).toEqual(['3-12', 'ramp', '20min', '2x8', 'sprint']);
        all.forEach(w => {
            expect(w.meta.category).toBe('Test');
            expect(w.id).toBe(TEST_IDS[w.meta.test]);
        });
    });

    test('each interval lasts as long as its steps, meta.duration is the total', () => {
        protocols().forEach(w => {
            w.intervals.forEach(i => expect(i.duration).toBe(i.steps.reduce((a, s) => a + s.duration, 0)));
            expect(w.meta.duration).toBe(steps(w).reduce((a, s) => a + s.duration, 0));
        });
    });

    test('all-out steps are sim at 1 % with no power; the others are ERG', () => {
        protocols().forEach(w => steps(w).forEach(s => {
            if(s.slope !== undefined) { expect(s.slope).toBe(1); expect(s.power).toBeUndefined(); }
            else expect(s.power).toBeGreaterThan(0);
        }));
    });

    test('3 + 12 min', () => {
        const w = protocol('3-12');
        expect(shape(w)).toEqual(['600@0.55', '!10', '170@0.5', '!10', '170@0.5', '180@0.6', '!180', '1800@0.5', '!720', '600@0.45']);
        expect(steps(w).filter(s => s.effort).map(s => s.effort)).toEqual(['p3', 'p12']);
        expect(w.meta.duration).toBe(4440);
    });

    test('Ramp: 26 one-minute steps from 0.52 to 2.02 in one ramp interval, then the cool-down', () => {
        const w = protocol('ramp');
        expect(w.intervals).toHaveLength(3);
        const r = w.intervals[1];
        expect(r.ramp).toBe(true);
        expect(r.steps).toHaveLength(26);
        expect(r.steps.every(s => s.duration === 60)).toBe(true);
        expect(r.steps[0].power).toBe(0.52);
        expect(r.steps[25].power).toBe(2.02);
        expect(shape({intervals: [w.intervals[0], w.intervals[2]]})).toEqual(['300@0.46', '600@0.4']);
    });

    test('20 min', () => {
        const w = protocol('20min');
        expect(shape(w)).toEqual(['600@0.55', '60@1', '60@0.5', '60@1', '60@0.5', '60@1', '60@0.5', '300@0.5', '!300', '600@0.5', '!1200', '600@0.45']);
        expect(steps(w).filter(s => s.effort).map(s => s.effort)).toEqual(['p20']);
    });

    test('2 × 8 min', () => {
        const w = protocol('2x8');
        expect(shape(w)).toEqual(['600@0.55', '60@1', '60@0.5', '60@1', '60@0.5', '60@1', '60@0.5', '300@0.5', '!480', '600@0.5', '!480', '600@0.45']);
        expect(steps(w).filter(s => s.effort).map(s => s.effort)).toEqual(['p8a', 'p8b']);
    });

    test('Sprint', () => {
        const w = protocol('sprint');
        expect(shape(w)).toEqual(['600@0.55', '!10', '180@0.45', '!10', '180@0.45', '!10', '180@0.45', '300@0.45']);
        expect(steps(w).filter(s => s.effort).map(s => s.effort)).toEqual(['sprint', 'sprint', 'sprint']);
    });

    test('messages at the start and, for longer steps, 10 s before the end', () => {
        protocols().forEach(w => steps(w).forEach(s => {
            expect(s.messages[0].offset).toBe(0);
            s.messages.forEach(m => { expect(m.offset).toBeLessThan(s.duration); expect(m.message).toBeTruthy(); });
        }));
        const p12 = steps(protocol('3-12')).find(s => s.effort === 'p12');
        expect(p12.messages.map(m => m.offset)).toEqual([0, 710]);
    });

    test('fresh copies each time', () => {
        const a = protocol('ramp'); a.intervals.length = 0;
        expect(protocol('ramp').intervals).toHaveLength(3);
        expect(protocol('nope')).toBeNull();
    });
});
