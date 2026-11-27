/**
 * @jest-environment jsdom
 */

import { workouts } from '../../src/workouts/workouts.js';
import { zwo } from '../../src/workouts/zwo.js';

describe('Soigneur Studio built-in workout library', () => {
    test('contains 8-10 structured cycling workouts authored by Soigneur Studio', () => {
        expect(workouts.length).toBeGreaterThanOrEqual(8);
        expect(workouts.length).toBeLessThanOrEqual(10);

        const parsedList = workouts.map(xml => zwo.readToInterval(xml));
        const names = new Set();

        for (const workout of parsedList) {
            expect(workout.meta.author).toBe('Soigneur Studio');
            expect(workout.meta.sportType).toBe('bike');
            expect(workout.meta.name.length).toBeGreaterThan(2);
            expect(workout.meta.description.length).toBeGreaterThan(20);
            expect(workout.meta.duration).toBeGreaterThanOrEqual(1800);
            expect(workout.intervals.length).toBeGreaterThan(0);
            names.add(workout.meta.name);
        }

        expect(names.size).toBe(workouts.length);
    });

    test('covers Recovery, Endurance, Sweet Spot, Threshold, Over-Unders, VO2max, and Anaerobic categories', () => {
        const categories = new Set(workouts.map(xml => zwo.readToInterval(xml).meta.category));
        expect(categories).toEqual(new Set([
            'Recovery',
            'Endurance',
            'Sweet Spot',
            'Threshold',
            'Over-Unders',
            'VO2max',
            'Anaerobic',
        ]));
    });
});
