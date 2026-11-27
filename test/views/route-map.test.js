/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { xf } from '../../src/functions.js';
import { RouteMap, projectPoint, fitBounds, tileRange, tileUrl } from '../../src/views/charts/route-map.js';
import { RideMap } from '../../src/views/ride-map.js';
import { RidePage } from '../../src/views/analysis/ride-page.js';
import { RideChart } from '../../src/views/analysis/ride-chart.js';
import { UPlotCard } from '../../src/views/training/uplot-chart.js';
import { RIDE_TILES } from '../../src/layout/tiles.js';

const { workout, rideOf } = require('../analysis/fixtures.js');

// Lightweight 2D canvas context mock for jsdom
function makeCtx() {
    const calls = [];
    const rec = name => (...args) => calls.push([name, ...args]);
    return {
        calls,
        save: rec('save'),
        restore: rec('restore'),
        scale: rec('scale'),
        fillRect: rec('fillRect'),
        beginPath: rec('beginPath'),
        moveTo: rec('moveTo'),
        lineTo: rec('lineTo'),
        stroke: rec('stroke'),
        fill: rec('fill'),
        arc: rec('arc'),
        setLineDash: rec('setLineDash'),
        drawImage: rec('drawImage'),
        fillText: rec('fillText'),
        measureText: () => ({width: 72}),
    };
}

let lastCtx = null;
const origGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = function() {
        if(!this._mockCtx) this._mockCtx = makeCtx();
        lastCtx = this._mockCtx;
        return this._mockCtx;
    };
});
afterAll(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
});

// uPlot stub for Ride Analysis tests
const made = [];
RideChart.uPlot = class {
    constructor(opts, data, el) {
        this.el = el; this.opts = opts; this.data = data;
        this.over = document.createElement('div');
        this.root = document.createElement('div');
        el.append(this.root);
        this.scales = {x: {}};
        made.push(this);
    }
    destroy() { this.root.remove(); }
    setSize() {}
    setSeries() {}
    setScale(k, s) { this.scales[k] = s; }
};
UPlotCard.uPlot = RideChart.uPlot;

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    document.body.innerHTML = '';
    made.length = 0;
    lastCtx = null;
    globalThis.requestAnimationFrame = cb => { cb(0); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    Object.defineProperty(navigator, 'onLine', {value: false, configurable: true});
});

describe('Web Mercator helpers', () => {
    test('projectPoint maps equator/prime meridian to (0.5, 0.5) and clamps polar latitudes', () => {
        const origin = projectPoint(0, 0);
        expect(origin.x).toBeCloseTo(0.5, 6);
        expect(origin.y).toBeCloseTo(0.5, 6);

        const amsterdam = projectPoint(52.3676, 4.9041);
        expect(amsterdam.x).toBeGreaterThan(0.5);
        expect(amsterdam.y).toBeLessThan(0.5);

        const pole = projectPoint(90, 0);
        expect(Number.isFinite(pole.y)).toBe(true);
        expect(pole.y).toBeGreaterThanOrEqual(0);
    });

    test('fitBounds fits all points inside the padded canvas and tileRange returns valid tiles', () => {
        const pts = [
            {lat: 52.35, lon: 4.85},
            {lat: 52.37, lon: 4.90},
            {lat: 52.39, lon: 4.95},
        ];
        const view = fitBounds(pts, 400, 300, 24);
        expect(view.zoom).toBeGreaterThan(8);
        expect(view.zoom).toBeLessThan(18);
        for(const p of pts) {
            const c = view.toCanvas(p.lat, p.lon);
            expect(c.x).toBeGreaterThanOrEqual(20);
            expect(c.x).toBeLessThanOrEqual(380);
            expect(c.y).toBeGreaterThanOrEqual(20);
            expect(c.y).toBeLessThanOrEqual(280);
        }

        const tiles = tileRange(view);
        expect(tiles.length).toBeGreaterThan(0);
        for(const t of tiles) {
            expect(t.z).toBe(view.tileZoom);
            expect(t.x).toBeGreaterThanOrEqual(0);
            expect(t.y).toBeGreaterThanOrEqual(0);
            expect(t.size).toBeGreaterThan(0);
        }
    });

    test('tileUrl and tileRange support terrain tiles with max zoom 17', () => {
        expect(tileUrl(12, 2099, 1461, false, 'standard')).toContain('basemaps.cartocdn.com/dark_all/');
        expect(tileUrl(12, 2099, 1461, true, 'standard')).toContain('basemaps.cartocdn.com/rastertiles/voyager/');
        expect(tileUrl(12, 2099, 1461, false, 'terrain')).toBe('https://a.tile.opentopomap.org/12/2099/1461.png');

        const closeView = fitBounds([{lat: 52.3676, lon: 4.9041}, {lat: 52.3677, lon: 4.9042}], 400, 300, 24);
        const terrainTiles = tileRange(closeView, 17);
        expect(terrainTiles.length).toBeGreaterThan(0);
        for(const t of terrainTiles) {
            expect(t.z).toBeLessThanOrEqual(17);
        }
    });
});

describe('<route-map> component', () => {
    test('setTrack, appendPoint, and setCursor draw cleanly without throwing', () => {
        const map = new RouteMap();
        document.body.append(map);
        map.setTrack({
            points: [
                {lat: 52.360, lon: 4.880, power: 150},
                {lat: 52.365, lon: 4.890, power: 260},
                {lat: 52.370, lon: 4.900, power: 340},
            ],
            ftp: 250,
        });
        expect(map._points).toHaveLength(3);
        expect(lastCtx.calls.some(c => c[0] === 'stroke')).toBe(true);
        expect(lastCtx.calls.some(c => c[0] === 'arc')).toBe(true);

        map.appendPoint({lat: 52.375, lon: 4.910, power: 200});
        expect(map._points).toHaveLength(4);

        // Null Island is ignored
        map.appendPoint({lat: 0, lon: 0});
        expect(map._points).toHaveLength(4);

        const arcsBefore = lastCtx.calls.filter(c => c[0] === 'arc').length;
        map.setCursor({lat: 52.365, lon: 4.890});
        expect(map._cursor).toEqual({lat: 52.365, lon: 4.890});
        expect(lastCtx.calls.filter(c => c[0] === 'arc').length).toBeGreaterThan(arcsBefore);

        map.setCursor(null);
        expect(map._cursor).toBeNull();
    });
});

describe('<ride-map> tile', () => {
    test('shows empty state initially, updates on gps:fix, and resets on next ride after watch:stopped', () => {
        expect(RIDE_TILES.some(t => t.id === 'map')).toBe(true);

        const tile = new RideMap();
        document.body.append(tile);
        const empty = tile.querySelector('[data-rm-empty]');
        expect(empty.hidden).toBe(false);
        expect(empty.textContent).toMatch(/Turn on GPS/i);

        xf.dispatch('gps:fix', {lat: 52.3676, lon: 4.9041, accuracy: 6});
        expect(empty.hidden).toBe(true);
        expect(tile.$map._points).toHaveLength(1);
        expect(tile.querySelector('[data-rm-meta]').textContent).toContain('±6 m');

        xf.dispatch('gps:fix', {lat: 52.3700, lon: 4.9100, accuracy: 5});
        expect(tile.$map._points).toHaveLength(2);
        expect(tile.querySelector('[data-rm-meta]').textContent).toMatch(/m · ±5 m/);

        xf.dispatch('watch:stopped');
        // Trail stays visible after stopping until the next ride's fix arrives
        expect(tile.$map._points).toHaveLength(2);

        xf.dispatch('gps:fix', {lat: 52.3800, lon: 4.9200, accuracy: 4});
        expect(tile.$map._points).toHaveLength(1);
    });

    test('draws a .fit course track when db:workout carries GPS points', () => {
        const semi = deg => Math.round(deg * 2147483648 / 180);
        const tile = new RideMap();
        document.body.append(tile);

        xf.dispatch('db:workout', {
            workout: {
                points: [
                    {position_lat: semi(52.36), position_long: semi(4.88)},
                    {position_lat: semi(52.37), position_long: semi(4.90)},
                ],
            },
        });
        expect(tile.$map._course).toHaveLength(2);
        expect(tile.querySelector('[data-rm-empty]').hidden).toBe(true);
    });
});

describe('Ride Analysis route map integration', () => {
    const summary = {
        id: 'gps-1', name: 'Outdoor Loop', day: '2026-11-20',
        start: Date.UTC(2026, 10, 20, 8), duration: 600, tss: 40, np: 220, if: 0.88, avgHr: 145,
    };

    function openPageWithRide(ride) {
        RidePage.source = {
            summary: async () => summary,
            ride: async () => ({ride}),
            context: async () => ({ftp: 250, weight: 75, wprime: 20000, lthr: 170, workout: null, summaries: [summary]}),
        };
        document.body.innerHTML = '<ride-page></ride-page>';
        return document.querySelector('ride-page');
    }

    test('renders <route-map> for GPS rides and updates cursor on ride-chart:cursor', async () => {
        const base = rideOf(workout());
        base.samples.forEach((s, i) => {
            s.lat = 52.36 + i * 0.0001;
            s.lon = 4.88 + i * 0.0001;
        });
        const page = openPageWithRide({...base, laps: []});
        await page.open('gps-1');
        await flush();

        const map = page.querySelector('route-map.rp-map');
        expect(map).not.toBeNull();
        expect(map._points.length).toBeGreaterThan(2);

        const chart = page.querySelector('ride-chart');
        chart.dispatchEvent(new CustomEvent('ride-chart:cursor', {detail: {index: 10}, bubbles: true}));
        expect(map._cursor).toEqual({lat: base.samples[10].lat, lon: base.samples[10].lon});

        chart.dispatchEvent(new CustomEvent('ride-chart:cursor', {detail: {index: null}, bubbles: true}));
        expect(map._cursor).toBeNull();
    });

    test('hides <route-map> for indoor rides without GPS coordinates', async () => {
        const base = rideOf(workout());
        const page = openPageWithRide({...base, laps: []});
        await page.open('gps-1');
        await flush();

        expect(page.querySelector('route-map')).toBeNull();
    });
});
