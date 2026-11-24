/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { xf } from '../../src/functions.js';
import { RidePage, openRide } from '../../src/views/analysis/ride-page.js';
import { RideChart } from '../../src/views/analysis/ride-chart.js';
const { workout, rideOf, steady } = require('./fixtures.js');

// uPlot stub: records what it was given
const made = [];
RideChart.uPlot = class {
    constructor(opts, data, el) { this.opts = opts; this.data = data; this.over = document.createElement('div'); this.root = document.createElement('div'); el.append(this.root); this.scales = {x: {}}; made.push(this); }
    destroy() { this.root.remove(); } setSize() {} setSeries() {} setScale(k, s) { this.scales[k] = s; }
};

const SUMMARIES = {
    'r1': {id: 'r1', name: 'VO2 max 5x4', day: '2026-11-20', start: Date.UTC(2026, 10, 20, 7), duration: 3540, tss: 80, np: 230, if: 0.92, avgHr: 140},
    'garmin-7': {id: 'garmin-7', name: 'La Buisse', day: '2026-11-18', start: Date.UTC(2026, 10, 18, 9), duration: 7200, source: 'garmin', sport: 'cycling', distance: 52000, avgHr: 135},
    'icu-i3': {id: 'icu-i3', name: 'From Strava', day: '2026-11-17', start: Date.UTC(2026, 10, 17, 9), duration: 3600, source: 'intervals'},
};
let release;
function source({rides = {}, reasons = {}, hold = false} = {}) {
    return {
        summary: async id => SUMMARIES[id] ?? null,
        ride: id => new Promise(resolve => {
            const answer = () => resolve(reasons[id] ? {reason: reasons[id], message: 'x'} : {ride: rides[id]});
            if(hold) release = answer; else answer();
        }),
        context: async () => ({ftp: 250, weight: 75, wprime: 20000, lthr: 170, workout: workout(), summaries: Object.values(SUMMARIES)}),
    };
}
const flush = () => new Promise(r => setTimeout(r, 0));
const pageSets = [];
xf.sub('ui:page-set', p => pageSets.push(p));

function page(src) {
    RidePage.source = src;
    document.body.innerHTML = '<ride-page></ride-page>';
    return document.querySelector('ride-page');
}

beforeEach(() => { made.length = 0; pageSets.length = 0; history.replaceState(null, '', '/'); });

describe('opening a ride', () => {
    test('openRide sets the link and shows the ride page', () => {
        openRide('r1', 'training');
        expect(location.hash).toBe('#ride=r1');
        expect(pageSets.at(-1)).toBe('analysis');
    });

    test('the summary shows at once, the chart when the file is read', async () => {
        const w = workout();
        const el = page(source({rides: {r1: {...rideOf(w), laps: []}}, hold: true}));
        const opening = el.open('r1');
        await flush();
        expect(el.querySelector('.rp-title').textContent).toBe('VO2 max 5x4');
        expect(el.textContent).toMatch(/Reading the ride/);
        release(); await opening;
        expect(el.querySelector('ride-chart')).not.toBeNull();
        expect(made.at(-1).opts.series.map(s => s.label)).toEqual(expect.arrayContaining(['Power', 'Target', 'Heart rate', 'W′bal']));
        expect(el.textContent).not.toMatch(/NaN|undefined/);
    });

    test('a ride without power: heart rate, speed and elevation, no power series', async () => {
        const el = page(source({rides: {'garmin-7': {samples: steady({withPower: false}), pauses: [], laps: []}}}));
        await el.open('garmin-7'); await flush(); await flush();
        const labels = made.at(-1).opts.series.map(s => s.label);
        expect(labels).toEqual(expect.arrayContaining(['Heart rate', 'Speed', 'Elevation']));
        expect(labels).not.toContain('Power');
        expect(labels).not.toContain('W′bal');
        expect(el.textContent).not.toMatch(/NaN|undefined/);
    });

    test('a file that can\'t be had: the reason in plain words, the summary still there', async () => {
        const el = page(source({reasons: {'icu-i3': 'strava'}}));
        await el.open('icu-i3'); await flush(); await flush();
        expect(el.querySelector('.rp-title').textContent).toBe('From Strava');
        expect(el.querySelector('.rp-problem').textContent).toMatch(/Strava/);
        expect(el.querySelector('ride-chart')).toBeNull();
    });

    test('a ride that doesn\'t exist: not found, and a way back', async () => {
        const el = page(source());
        el.from = 'workouts';
        await el.open('nope'); await flush();
        expect(el.textContent).toMatch(/not found/i);
        el.querySelector('[data-rp-back]').click();
        expect(pageSets.at(-1)).toBe('workouts');
        expect(location.hash).toBe('');
    });

    test('the link opens the ride (a bookmark, or the app opened with it)', async () => {
        const el = page(source({rides: {r1: {...rideOf(workout()), laps: []}}}));
        location.hash = '#ride=r1';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        await flush(); await flush();
        expect(el.querySelector('.rp-title').textContent).toBe('VO2 max 5x4');
        expect(pageSets.at(-1)).toBe('analysis');
    });

    test('the app reopening on the ride page without a ride goes to Training', async () => {
        page(source());
        xf.dispatch('db:page', {page: 'analysis'});
        await flush();
        expect(pageSets.at(-1)).toBe('training');
    });

    test('the intervals table: a row zooms the chart to that interval', async () => {
        const el = page(source({rides: {r1: {...rideOf(workout()), laps: []}}}));
        await el.open('r1'); await flush(); await flush();
        expect(el.querySelectorAll('interval-table .it-row.is-work')).toHaveLength(5);
        el.querySelector('.it-row.is-work [data-zoom]').click();
        const x = made.at(-1).scales.x;
        expect(x.min).toBeLessThanOrEqual(300);
        expect(x.max).toBeGreaterThanOrEqual(540);
        expect(x.max - x.min).toBeLessThan(400);
    });

    test('the analysis uses the FTP the ride was ridden with, not today\'s', async () => {
        SUMMARIES.r2 = {...SUMMARIES.r1, id: 'r2', ftp: 300};
        const el = page(source({rides: {r2: {...rideOf(workout(), {ftp: 300}), laps: []}}}));
        await el.open('r2'); await flush(); await flush();
        expect(el.analysis.intervals.find(i => i.kind === 'work').target).toBe(330);
    });

    test('something failing while the ride is read: a problem on the page, not "Reading…" forever', async () => {
        const src = source({rides: {r1: {...rideOf(workout()), laps: []}}});
        src.context = async () => { throw new Error('boom'); };
        const el = page(src);
        await el.open('r1'); await flush();
        expect(el.querySelector('.rp-problem')).not.toBeNull();
        expect(el.textContent).not.toMatch(/Reading the ride/);
    });

    test('the browser\'s or phone\'s Back from a ride returns to where it was opened from', async () => {
        const el = page(source({rides: {r1: {...rideOf(workout()), laps: []}}}));
        openRide('r1', 'workouts'); await flush(); await flush();
        history.replaceState(null, '', '/');                  // what Back leaves
        window.dispatchEvent(new PopStateEvent('popstate'));
        await flush();
        expect(pageSets.at(-1)).toBe('workouts');
    });

    test('leaving the ride page by a tab clears the ride from the link', async () => {
        page(source({rides: {r1: {...rideOf(workout()), laps: []}}}));
        openRide('r1', 'training'); await flush();
        xf.dispatch('db:page', {page: 'settings'});
        await flush();
        expect(location.hash).toBe('');
    });
});
