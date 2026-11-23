/**
 * @jest-environment jsdom
 */
import { WorkoutGraph } from '../../src/views/workout-graph.js';

describe('WorkoutGraph.render', () => {
    test('a resize before any workout is loaded does not throw', () => {
        const el = document.createElement('div');
        const self = Object.assign(el, {type: 'workout', workout: {}, ftp: 250, viewPort: {width: 360, height: 120}, dom: {}});
        expect(() => WorkoutGraph.prototype.render.call(self)).not.toThrow();
    });
});
