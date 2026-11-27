/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { UPlotCard } from '../../src/views/training/uplot-chart.js';
import '../../src/views/training/insight-cards.js';
import '../../src/views/training/progress-cards.js';
import '../../src/views/training/week-card.js';

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

describe('<compliance-card>', () => {
    const w = (power = 0.8, duration = 3600) => ({intervals: [{duration, steps: [{duration, power}]}]});
    const plan = [
        {id: 'p1', day: '2026-11-23', workout: w(0.8, 3600), rideId: 'r1', deleted: false},
        {id: 'p2', day: '2026-11-24', workout: w(0.8, 3600), rideId: null, deleted: false},
    ];
    const summaries = [{id: 'r1', day: '2026-11-23', duration: 3600, tss: 64}];

    test('empty state when no due workouts exist', () => {
        const {Fake, calls} = fakePlot();
        UPlotCard.uPlot = Fake;
        const el = document.createElement('compliance-card');
        document.body.append(el);
        el.data = {today: '2026-11-25', plan: [], summaries: [], ftp: 250};
        expect(calls).toHaveLength(0);
        expect(el.textContent).toContain('Plan compliance');
        expect(el.textContent).toContain('Plan workouts on the calendar');
    });

    test('renders 4-week stats and switches between Workouts and Load %', () => {
        const {Fake, calls} = fakePlot();
        UPlotCard.uPlot = Fake;
        const el = document.createElement('compliance-card');
        document.body.append(el);
        el.data = {today: '2026-11-25', plan, summaries, ftp: 250};
        expect(calls).toHaveLength(1);
        expect(el.querySelector('[data-k="done"]').textContent).toContain('1/2');
        expect(el.querySelector('[data-k="load"]').textContent).toBe('50 %');
        expect(el.querySelector('[data-k="duration"]').textContent).toBe('50 %');
        expect(el.querySelector('.pc-legend').textContent).toContain('Completed');

        el.querySelector('[data-opt="load"]').click();
        expect(calls).toHaveLength(2);
        expect(el.querySelector('.pc-legend').textContent).toContain('Load %');
    });
});

describe('<zones-card> intensity classification', () => {
    const summaries = [
        {id: '1', day: '2026-11-24', sport: 'cycling', zoneSeconds: [1800, 1800, 300, 0, 0, 600, 0]},
    ];

    test('shows intensity note in default view and badge in 3-zones view', () => {
        const {Fake, calls} = fakePlot();
        UPlotCard.uPlot = Fake;
        const el = document.createElement('zones-card');
        document.body.append(el);
        el.data = {today: '2026-11-25', summaries};
        expect(calls).toHaveLength(1);
        expect(el.querySelector('[data-k="intensity-pattern"]').textContent).toContain('Polarised');

        el.querySelector('[data-opt="polar"]').click();
        expect(calls).toHaveLength(2);
        expect(el.querySelector('.zc-badge').textContent).toBe('Polarised');
        expect(el.querySelector('.zc-pattern').dataset.pattern).toBe('polarised');
    });
});

describe('<curve-card> comparison toggle', () => {
    const summaries = [
        {id: 'old', day: '2025-07-01', sport: 'cycling', best: {5: 800, 60: 400, 300: 290, 1200: 260, 3600: 240}, weight: 75},
        {id: 'rec', day: '2026-11-20', sport: 'cycling', best: {5: 900, 60: 430, 300: 310, 1200: 280, 3600: 255}, weight: 75},
    ];

    test('switches between All time, 90 days, and Prior season', () => {
        const {Fake, calls} = fakePlot();
        UPlotCard.uPlot = Fake;
        const el = document.createElement('curve-card');
        document.body.append(el);
        el.data = {today: '2026-11-25', summaries, weight: 75};
        expect(calls).toHaveLength(1);
        expect(el.querySelector('.pc-legend').textContent).toContain('Last 6 weeks');
        expect(el.querySelector('.pc-legend').textContent).toContain('All time');

        el.querySelector('[data-compare="prior"]').click();
        expect(calls).toHaveLength(2);
        expect(el.querySelector('[data-compare="prior"]').getAttribute('aria-pressed')).toBe('true');
        expect(el.querySelector('.pc-legend').textContent).toContain('Prior season');
    });
});

describe('<week-card> weekly summary', () => {
    test('renders concise summary bullets alongside this week metrics', () => {
        const el = document.createElement('week-card');
        document.body.append(el);
        el.data = {
            today: '2026-11-25',
            ftp: 250,
            summaries: [
                {id: 'w1', day: '2026-11-02', sport: 'cycling', duration: 3600, tss: 60, kj: 600, best: {1200: 250}},
                {id: 'w2', day: '2026-11-09', sport: 'cycling', duration: 3600, tss: 60, kj: 600, best: {1200: 255}},
                {id: 'w3', day: '2026-11-16', sport: 'cycling', duration: 3600, tss: 60, kj: 600, best: {1200: 260}},
                {id: 'cur', day: '2026-11-24', sport: 'cycling', name: 'Threshold', duration: 5400, tss: 95, kj: 900, best: {1200: 285}},
            ],
            plan: [
                {id: 'p1', day: '2026-11-24', rideId: 'cur', deleted: false, workout: {intervals: [{duration: 3600, steps: [{duration: 3600, power: 0.85}]}]}},
            ],
        };
        const items = [...el.querySelectorAll('.wc-summary li')].map(li => li.textContent);
        expect(items.length).toBeGreaterThanOrEqual(3);
        expect(items.some(t => /4-week pace/.test(t))).toBe(true);
        expect(items.some(t => /Fitness \(CTL\)/.test(t))).toBe(true);
        expect(items.some(t => /Plan: 1 of 1 done/.test(t))).toBe(true);
        expect(items.some(t => /new all-time 20 min best at 285 W/.test(t))).toBe(true);
    });
});
