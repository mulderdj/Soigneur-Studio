/**
 * @jest-environment jsdom
 */
import './browser-stubs.js';
import { rangeWindow, tipLeft, UPlotCard } from '../../src/views/training/uplot-chart.js';

const DAY = 86400;
const days = (n, end = 1795000000) => Array.from({length: n}, (_, i) => end - (n - 1 - i) * DAY);

describe('the range a chart opens on', () => {
    const xs = days(400);
    const today = xs[372]; // 28 forecast days after today
    test('months and years count back from today and keep the forecast', () => {
        expect(rangeWindow(xs, '3m', today)).toEqual([today - 90 * DAY, xs.at(-1)]);
        expect(rangeWindow(xs, '1m', today)).toEqual([today - 30 * DAY, xs.at(-1)]);
        expect(rangeWindow(xs, '1y', today)).toEqual([today - 365 * DAY, xs.at(-1)]);
        expect(rangeWindow(xs, 'all', today)).toEqual([xs[0], xs.at(-1)]);
    });
    test('weeks count entries from the end', () => {
        const weeks = days(120, 1795000000).filter((_, i) => i % 7 === 0); // 18 weeks
        expect(rangeWindow(weeks, '12w', today)).toEqual([weeks.at(-12), weeks.at(-1)]);
        expect(rangeWindow(weeks.slice(0, 5), '52w', today)).toEqual([weeks[0], weeks[4]]);
    });
    test('one point still gives a range a day wide; nothing gives none', () => {
        const [a, b] = rangeWindow([1795000000], 'all', 1795000000);
        expect(b - a).toBeGreaterThanOrEqual(DAY);
        expect(rangeWindow([], '3m', 0)).toBeNull();
    });
});

describe('where the read-out goes', () => {
    test('right of the cursor, flipped near the right edge, never outside the card', () => {
        expect(tipLeft(100, 200, 600)).toBe(114);
        expect(tipLeft(500, 200, 600)).toBe(286);
        expect(tipLeft(150, 200, 300)).toBe(8);     // fits nowhere: kept at the left margin
        expect(tipLeft(-50, 200, 600)).toBe(8);
    });
});

describe('the chart base', () => {
    test('a rebuild destroys the previous uPlot', () => {
        let made = 0, destroyed = 0;
        UPlotCard.uPlot = class {
            constructor(opts, data, el) { made++; this.over = document.createElement('div'); this.root = document.createElement('div'); el.append(this.root); this.cursor = {}; this.select = {width: 0}; this.series = opts.series; }
            destroy() { destroyed++; this.root.remove(); }
            setSize() {}
            setScale() {}
        };
        UPlotCard.uPlot.paths = {bars: () => () => null};
        class TestCard extends UPlotCard {
            head() { return '<h2 class="card__title">Test</h2>'; }
            chart() {
                return {
                    model: {x: [1795000000, 1795086400], series: [{label: 'A', color: '#fff', values: [1, 2]}]},
                    readout: (i) => ({title: `t${i}`, rows: [], more: []}),
                };
            }
        }
        customElements.define('test-uplot-card', TestCard);
        document.body.innerHTML = '<test-uplot-card></test-uplot-card>';
        const el = document.querySelector('test-uplot-card');
        el.data = {today: '2026-11-23'};
        el.data = {today: '2026-11-23'};
        el.rebuild();
        expect(made).toBe(3);
        expect(destroyed).toBe(2);
        expect(el.querySelectorAll('.uc-plot > div')).toHaveLength(1);
    });
});
