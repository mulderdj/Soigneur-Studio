/**
 * @jest-environment jsdom
 */
import { WorkoutGraph } from '../../src/views/workout-graph.js';

describe('WorkoutGraph.progress', () => {
    test('does nothing while the graph has no interval bars (hidden graph)', () => {
        const parent = document.createElement('div');
        const self = {workoutStatus: 'started', workout: {intervals: [{duration: 60}]}};
        const dom = {intervals: [], active: document.createElement('div'), progress: document.createElement('div')};
        expect(() => WorkoutGraph.prototype.progress.call(self, {index: 0, dom, parent})).not.toThrow();
    });
});
