/**
 * @jest-environment jsdom
 */
import '../../src/views/activity-list.js';

function render(data) {
    const list = document.createElement('activity-list');
    return list.template(0, data);
}

const ride = {id: 'abc', name: 'Sweet <Spot>', timestamp: Date.UTC(2026, 10, 1), duration: 3600,
              status: {strava: 'none', intervals: 'none'}};

describe('activity list row', () => {
    test('offers download and delete only', () => {
        const html = render(ride);
        expect(html).toContain('action=":download"');
        expect(html).toContain('action=":remove"');
        expect(html).not.toMatch(/:upload/);
        expect(html).not.toMatch(/strava|intervals|trainingPeaks/);
    });

    test('shows name, duration and escapes the name', () => {
        const html = render(ride);
        expect(html).toContain('Sweet &lt;Spot&gt;');
        expect(html).toContain('60 min');
    });

    test('buttons are labelled for screen readers', () => {
        const html = render(ride);
        expect(html).toMatch(/aria-label="Download Sweet &lt;Spot&gt;/);
        expect(html).toMatch(/aria-label="Delete Sweet &lt;Spot&gt;/);
    });
});
