/**
 * @jest-environment jsdom
 */
import { activeIndex } from '../src/views/panel-pager.js';

describe('activeIndex', () => {
    test('nearest page', () => {
        expect(activeIndex(0, 360, 5)).toBe(0);
        expect(activeIndex(170, 360, 5)).toBe(0);
        expect(activeIndex(190, 360, 5)).toBe(1);
        expect(activeIndex(1440, 360, 5)).toBe(4);
    });

    test('clamped and safe', () => {
        expect(activeIndex(99999, 360, 5)).toBe(4);
        expect(activeIndex(-50, 360, 5)).toBe(0);
        expect(activeIndex(100, 0, 5)).toBe(0);
    });
});
