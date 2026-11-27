/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { xf } from '../../src/functions.js';
import { db } from '../../src/db.js';
import { RIDE_METRICS } from '../../src/views/ride-metric.js';
import { RIDE_TILES } from '../../src/layout/tiles.js';

describe('<ride-metric> standalone tiles', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('renders Avg HR and Max HR live updates independently', () => {
        const avgEl = document.createElement('ride-metric');
        avgEl.dataset.metric = 'hr-avg';
        const maxEl = document.createElement('ride-metric');
        maxEl.dataset.metric = 'hr-max';
        document.body.append(avgEl, maxEl);

        xf.dispatch('db:heartRateAvg', {heartRateAvg: 148.4});
        xf.dispatch('db:heartRateMax', {heartRateMax: 176});

        expect(avgEl.querySelector('[data-rm-val]').textContent).toBe('148');
        expect(maxEl.querySelector('[data-rm-val]').textContent).toBe('176');
    });

    test('renders analytics-based Normalized Power and TSS', () => {
        const npEl = document.createElement('ride-metric');
        npEl.dataset.metric = 'power-np';
        const tssEl = document.createElement('ride-metric');
        tssEl.dataset.metric = 'tss';
        document.body.append(npEl, tssEl);

        xf.dispatch('analytics:update', {summary: () => ({np: 241.6, tss: 63.2, intensity: 0.86, kj: 512, maxPower: 680})});

        expect(npEl.querySelector('[data-rm-val]').textContent).toBe('242');
        expect(tssEl.querySelector('[data-rm-val]').textContent).toBe('63');
    });

    test('renders Avg Speed in metric and imperial', () => {
        db.measurement = 'metric';
        db.distance = 10000; // 10 km
        db.elapsed = 1000;   // 1000 s => 10 m/s = 36.0 km/h
        const el = document.createElement('ride-metric');
        el.dataset.metric = 'speed-avg';
        document.body.append(el);
        expect(el.querySelector('[data-rm-val]').textContent).toBe('36.0');
        expect(el.querySelector('[data-rm-unit]').textContent).toBe('km/h');
    });

    test('every RIDE_METRICS id is registered in RIDE_TILES with a category', () => {
        const byId = new Map(RIDE_TILES.map(t => [t.id, t]));
        for(const id of Object.keys(RIDE_METRICS)) {
            expect(byId.get(id)).toBeDefined();
            expect(byId.get(id).category).toBeTruthy();
        }
    });
});
