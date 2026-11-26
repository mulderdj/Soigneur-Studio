/**
 * @jest-environment jsdom
 */
// the MCP server's .zwo reader (no DOM) against the app's (DOMParser)
import { zwo } from '../../src/workouts/zwo.js';
import { workouts } from '../../src/workouts/workouts.js';
import { readWorkout, writeWorkout } from '../../server/mcp/zwo.js';
import { buildWorkout } from '../../server/mcp/plan.js';

const shape = w => w.intervals.map(iv => [iv.duration, iv.steps.map(s => [s.duration, s.power, s.cadence ?? null])]);

describe('the MCP .zwo reader reads what the app reads', () => {
    test.each(workouts.map(x => [x.match(/<name>([^<]*)<\/name>/)?.[1] ?? '?', x]))('%s', (name, xml) => {
        const app = zwo.readToInterval(xml);
        const mine = readWorkout(xml);
        expect(mine.meta.name).toBe(app.meta.name);
        expect(mine.meta.duration).toBe(app.meta.duration);
        expect(shape(mine)).toEqual(shape(app));
    });

    test('the steps the app writes for a plan entry come back the same', () => {
        const w = {meta: {name: 'Mine'}, intervals: [
            {duration: 600, steps: [{duration: 600, power: 0.55}]},
            {duration: 240, steps: [{duration: 240, power: 1.1, cadence: 95}]},
            {duration: 120, steps: [{duration: 120, power: 0.5}]},
        ]};
        const xml = zwo.write(zwo.fromInterval(w));
        expect(shape(readWorkout(xml))).toEqual(shape(zwo.readToInterval(xml)));
    });

    test('a workout an AI describes: the app reads its .zwo back as the same steps', () => {
        const w = buildWorkout({name: 'Over-unders & more', steps: [
            {duration_s: 600, power_pct_from: 50, power_pct_to: 75},
            {repeat: 3, steps: [{duration_s: 120, power_pct: 95, cadence_rpm: 90}, {duration_s: 60, power_pct: 105}]},
            {duration_s: 300, power_pct: 55},
            {duration_s: 120, free_ride: true},
            {duration_s: 300, power_pct_from: 60, power_pct_to: 40},
        ]});
        expect(w.intervals).toHaveLength(10);
        const xml = writeWorkout(w);
        const app = zwo.readToInterval(xml);
        expect(app.meta.name).toBe('Over-unders & more');
        expect(shape(app)).toEqual(shape(w));
        expect(shape(readWorkout(xml))).toEqual(shape(w));
    });
});
