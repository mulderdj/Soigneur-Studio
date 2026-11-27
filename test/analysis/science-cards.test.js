/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { UPlotCard } from '../../src/views/training/uplot-chart.js';
import '../../src/views/training/insight-cards.js';

function fakePlot() {
    const calls = [];
    class Fake {
        constructor(opts, data, el) {
            this.opts = opts;
            this.data = data;
            this.el = el;
            this.over = document.createElement('div');
            el.append(this.over);
            calls.push(this);
        }
        setScale() {}
        setSize() {}
        destroy() { this.destroyed = true; }
    }
    return {Fake, calls};
}

let orig;
beforeEach(() => {
    orig = UPlotCard.uPlot;
    document.body.innerHTML = '';
});
afterEach(() => {
    UPlotCard.uPlot = orig;
});

describe('<decoupling-card>', () => {
    test('empty state when no steady long rides exist', () => {
        const {Fake, calls} = fakePlot();
        UPlotCard.uPlot = Fake;
        const el = document.createElement('decoupling-card');
        document.body.append(el);
        el.data = {today: '2026-11-26', summaries: []};
        expect(calls).toHaveLength(0);
        expect(el.textContent).toContain('Aerobic decoupling');
        expect(el.textContent).toContain('45 minutes or more');
        expect(el.textContent).toContain('Under 5 %');
    });

    test('renders decoupling series and rolling mean for long steady rides', () => {
        const {Fake, calls} = fakePlot();
        UPlotCard.uPlot = Fake;
        const el = document.createElement('decoupling-card');
        document.body.append(el);
        el.data = {
            today: '2026-11-26',
            summaries: [
                {id: '1', day: '2026-11-10', sport: 'cycling', name: 'Endurance', duration: 5400, np: 200, avgPower: 195, decoupling: 5.5},
                {id: '2', day: '2026-11-20', sport: 'cycling', name: 'Long ride', duration: 7200, np: 200, avgPower: 196, decoupling: 3.1},
            ],
        };
        expect(calls).toHaveLength(1);
        expect(calls[0].data[0]).toHaveLength(2);
        expect(calls[0].data[1]).toEqual([5, 5]);
        expect(calls[0].data[2]).toEqual([5.5, 3.1]);
        expect(calls[0].data[3]).toEqual([5.5, 4.3]);
    });
});

describe('<durability-card>', () => {
    const summaries = [
        {id: 'f', day: '2026-11-02', sport: 'cycling', name: 'VO2', best: {300: 320, 1200: 280}, durability: null},
        {id: 'l', day: '2026-11-24', sport: 'cycling', name: 'Long ride', best: {300: 300, 1200: 260},
         durability: {1000: {300: 288, 1200: 252}, 2000: {300: 256, 1200: null}}},
    ];

    test('empty state when no ride reached 1,000 kJ', () => {
        const {Fake, calls} = fakePlot();
        UPlotCard.uPlot = Fake;
        const el = document.createElement('durability-card');
        document.body.append(el);
        el.data = {today: '2026-11-26', summaries: [summaries[0]]};
        expect(calls).toHaveLength(0);
        expect(el.textContent).toContain('Durability');
        expect(el.textContent).toContain('1,000 kJ');
    });

    test('renders 5 min by default with legend and switches to 20 min on toggle', () => {
        const {Fake, calls} = fakePlot();
        UPlotCard.uPlot = Fake;
        const el = document.createElement('durability-card');
        document.body.append(el);
        el.data = {today: '2026-11-26', summaries};
        expect(calls).toHaveLength(1);
        // 5 min has both 1,000 kJ and 2,000 kJ series
        expect(calls[0].data).toHaveLength(3);
        expect(el.querySelector('.pc-legend').textContent).toContain('1,000 kJ');
        expect(el.querySelector('.pc-legend').textContent).toContain('2,000 kJ');

        el.querySelector('[data-opt="1200"]').click();
        expect(calls).toHaveLength(2);
        // 20 min only has 1,000 kJ
        expect(calls[1].data).toHaveLength(2);
        expect(el.querySelector('.pc-legend').textContent).toContain('1,000 kJ');
        expect(el.querySelector('.pc-legend').textContent).not.toContain('2,000 kJ');
    });
});
