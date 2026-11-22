import { layoutFor } from '../src/views/layout.js';

describe('layoutFor', () => {
    test.each([
        [390, 844, 'phone'], [360, 740, 'phone'], [844, 390, 'phone-landscape'],
        [599, 900, 'phone'], [600, 900, 'tablet'], [820, 1180, 'tablet'],
        [1199, 800, 'tablet'], [1200, 680, 'desktop'], [1600, 900, 'desktop'],
        [2200, 1100, 'tv'], [2200, 1000, 'desktop'],
    ])('%i x %i is %s', (w, h, expected) => expect(layoutFor(w, h)).toBe(expected));
});

import { chartRangeFor } from '../src/views/layout.js';

describe('chartRangeFor', () => {
    test('phones always show the last 5 minutes', () => {
        expect(chartRangeFor('phone', 'all')).toBe('5');
        expect(chartRangeFor('phone-landscape', '20')).toBe('5');
    });
    test('wider screens keep the rider\'s choice', () => {
        expect(chartRangeFor('tablet', 'all')).toBe('all');
        expect(chartRangeFor('desktop', '20')).toBe('20');
        expect(chartRangeFor('tv', '5')).toBe('5');
    });
});
