/**
 * @jest-environment jsdom
 */
import { barMode } from '../src/views/app-bar.js';

describe('app bar mode', () => {
    test('riding while started or paused', () => {
        expect(barMode('started')).toBe('riding');
        expect(barMode('paused')).toBe('riding');
    });

    test('idle otherwise', () => {
        for(const s of ['stopped', 'done', undefined, '']) expect(barMode(s)).toBe('idle');
    });
});
