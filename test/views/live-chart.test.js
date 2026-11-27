/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import uPlot from 'uplot';
import { xf } from '../../src/functions.js';
import { SessionStats } from '../../src/analytics.js';
import {
    MAX_LIVE_POINTS, fmtTime, powerMax, powerSplits, hrBounds, hrTicks, buildLiveData,
} from '../../src/views/charts/live-chart-data.js';
import { session, LiveChart } from '../../src/views/training-dashboard.js';

beforeAll(() => {
    const ctx = new Proxy({}, {
        get: (t, k) => k in t ? t[k] : (k === 'measureText' ? () => ({width: 10}) : () => {}),
        set: (t, k, v) => { t[k] = v; return true; },
    });
    HTMLCanvasElement.prototype.getContext = () => ctx;
    global.Path2D = class {
        constructor() { return new Proxy(this, {get: (t, k) => k in t ? t[k] : () => {}}); }
    };
    LiveChart.uPlot = uPlot;
});

afterAll(() => {
    LiveChart.uPlot = null;
});

describe('live-chart data helpers', () => {
    test('fmtTime formats mm:ss and h:mm:ss', () => {
        expect(fmtTime(0)).toBe('0:00');
        expect(fmtTime(65)).toBe('1:05');
        expect(fmtTime(3661)).toBe('1:01:01');
    });

    test('powerMax rounds up to 50 W steps with 1.3x FTP floor', () => {
        expect(powerMax(250, 200)).toBe(350);
        expect(powerMax(250, 410)).toBe(450);
    });

    test('powerSplits returns FTP fractions within scaleMax', () => {
        expect(powerSplits(200, 300)).toEqual([100, 150, 200, 250]);
        expect(powerSplits(200, 220)).toEqual([100, 150, 200]);
    });

    test('hrBounds pads by 10 bpm and enforces minimum span of 40', () => {
        expect(hrBounds(NaN, NaN)).toEqual([80, 190]);
        expect(hrBounds(142, 158)).toEqual([130, 170]);
        expect(hrBounds(45, 50)).toEqual([40, 80]);
    });

    test('hrTicks shows 3 ticks on tall plots and 2 on short plots', () => {
        expect(hrTicks(100, 180, 200)).toEqual([100, 140, 180]);
        expect(hrTicks(100, 180, 100)).toEqual([100, 180]);
    });

    test('buildLiveData returns empty columnar arrays before a ride starts', () => {
        const s = new SessionStats({ftp: 250});
        const res = buildLiveData(s, '5');
        expect(res.data).toEqual([[], [], [], [], [], []]);
        expect(res.xMin).toBe(0);
        expect(res.xMax).toBe(300);
        expect(res.hasHr).toBe(false);
    });

    test('buildLiveData slices to the 5 min window and turns zeros into nulls', () => {
        const s = new SessionStats({ftp: 250});
        for(let i = 0; i < 400; i++) {
            s.push({
                power: i % 10 === 0 ? 0 : 220,
                heartRate: i < 350 ? 0 : 150,
                cadence: i % 2 === 0 ? 90 : 0,
                target: 200,
                interval: 0,
            });
        }
        const res = buildLiveData(s, '5');
        expect(res.start).toBe(100);
        expect(res.end).toBe(400);
        expect(res.data[0]).toHaveLength(300);
        expect(res.data[0][0]).toBe(100);
        expect(res.data[1][0]).toBeNull();        // i=100 had power 0
        expect(res.data[1][1]).toBe(220);
        expect(res.data[4][1]).toBeNull();        // i=101 had cadence 0
        expect(res.data[5][0]).toBeNull();        // i=100 had hr 0
        expect(res.data[5][250]).toBe(150);       // i=350 had hr 150
        expect(res.hasHr).toBe(true);
    });

    test('buildLiveData decimates long rides to stay under MAX_LIVE_POINTS', () => {
        const s = new SessionStats({ftp: 250});
        for(let i = 0; i < 3600; i++) {
            s.push({power: 200 + (i % 50), heartRate: 145, cadence: 88, target: 220, interval: 0});
        }
        const res = buildLiveData(s, 'all');
        expect(res.data[0].length).toBeLessThanOrEqual(MAX_LIVE_POINTS);
        expect(res.data[0].length).toBeGreaterThan(MAX_LIVE_POINTS * 0.9);
        expect(res.step).toBeCloseTo(3600 / MAX_LIVE_POINTS, 5);
        expect(res.hasHr).toBe(true);
    });
});

describe('<live-chart> with uPlot', () => {
    let observed = [];
    const OrigRO = globalThis.ResizeObserver;

    beforeEach(() => {
        localStorage.clear();
        session.reset();
        session.setFtp(250);
        Object.defineProperty(window, 'innerWidth', {value: 1440, configurable: true});
        Object.defineProperty(window, 'innerHeight', {value: 900, configurable: true});
        observed = [];
        globalThis.ResizeObserver = class {
            constructor(cb) { this.cb = cb; observed.push(this); }
            observe(el) { this.el = el; }
            disconnect() { this.gone = true; }
        };
    });

    afterEach(() => {
        document.body.innerHTML = '';
        globalThis.ResizeObserver = OrigRO;
    });

    function mount(width = 800, height = 260) {
        document.body.innerHTML = '<live-chart id="dash-chart"></live-chart>';
        const el = document.querySelector('live-chart');
        el.$plot.getBoundingClientRect = () => ({
            left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0,
        });
        el.onResize();
        return el;
    }

    test('shows empty state initially and updates via setData without rebuilding at 1 Hz', () => {
        const el = mount();
        expect(el.plot).toBeTruthy();
        expect(el.$empty.hidden).toBe(false);
        expect(el.dataset.samples).toBe('0');

        const firstPlot = el.plot;
        const setDataSpy = jest.spyOn(firstPlot, 'setData');

        for(let i = 0; i < 5; i++) {
            session.push({power: 240, heartRate: 150, cadence: 90, target: 250, interval: 0});
            xf.dispatch('analytics:update', session);
        }

        expect(el.plot).toBe(firstPlot); // never rebuilt on 1 Hz ticks
        expect(setDataSpy).toHaveBeenCalledTimes(5);
        expect(el.$empty.hidden).toBe(true);
        expect(el.dataset.samples).toBe('5');
        expect(el.plot.data[0]).toEqual([0, 1, 2, 3, 4]);
    });

    test('series toggle updates uPlot visibility without rebuilding and persists prefs', () => {
        const el = mount();
        const plot = el.plot;
        const setSeriesSpy = jest.spyOn(plot, 'setSeries');

        const hrBtn = el.querySelector('[data-series="hr"]');
        expect(hrBtn.getAttribute('aria-pressed')).toBe('true');
        hrBtn.click();

        expect(hrBtn.getAttribute('aria-pressed')).toBe('false');
        expect(el.plot).toBe(plot);
        expect(setSeriesSpy).toHaveBeenCalledWith(5, {show: false});
        expect(JSON.parse(localStorage.getItem('dashboard:chart')).visible.hr).toBe(false);
    });

    const flush = () => new Promise(r => setTimeout(r, 0));

    test('range button updates x-scale window without rebuilding', async () => {
        for(let i = 0; i < 10; i++) {
            session.push({power: 200, heartRate: 140, cadence: 85, target: 200, interval: 0});
        }
        const el = mount();
        await flush();
        const plot = el.plot;
        expect(plot.scales.x.max).toBe(1200); // default 20 min

        el.querySelector('[data-range="5"]').click();
        await flush();
        expect(el.plot).toBe(plot);
        expect(plot.scales.x.max).toBe(300);
        expect(JSON.parse(localStorage.getItem('dashboard:chart')).range).toBe('5');
    });

    test('resize calls setSize without rebuilding the plot', () => {
        const el = mount(800, 260);
        const plot = el.plot;
        const setSizeSpy = jest.spyOn(plot, 'setSize');

        el.$plot.getBoundingClientRect = () => ({
            left: 0, top: 0, right: 640, bottom: 200, width: 640, height: 200, x: 0, y: 0,
        });
        observed.at(-1).cb([]);

        expect(el.plot).toBe(plot);
        expect(setSizeSpy).toHaveBeenCalledWith({width: 640, height: 200});
    });

    test('theme class change on body rebuilds the plot', async () => {
        const el = mount();
        const firstPlot = el.plot;
        document.body.className = 'white-theme';
        await Promise.resolve();
        expect(el.plot).not.toBe(firstPlot);
        expect(el.plot).toBeTruthy();
    });

    test('showTip displays formatted values and hides when cursor leaves', () => {
        session.push({power: 275, heartRate: 162, cadence: 92, target: 260, interval: 0});
        const el = mount();
        el.showTip({
            cursor: {idx: 0, left: 40},
            data: el.plot.data,
            over: {clientWidth: 800, getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 200})},
        });
        expect(el.$tip.hidden).toBe(false);
        expect(el.$tip.innerHTML).toContain('0:01');
        expect(el.$tip.innerHTML).toContain('Power 275 W');
        expect(el.$tip.innerHTML).toContain('Target 260 W');
        expect(el.$tip.innerHTML).toContain('Heart rate 162 bpm');
        expect(el.$tip.innerHTML).toContain('Cadence 92 rpm');
        expect(el.$tip.innerHTML).toContain('W′bal');

        el.showTip({cursor: {idx: null, left: -10}, data: el.plot.data, over: {clientWidth: 800}});
        expect(el.$tip.hidden).toBe(true);
    });

    test('disconnect cleans up and reconnect preserves session samples', () => {
        for(let i = 0; i < 12; i++) {
            session.push({power: 210, heartRate: 140, cadence: 85, target: 200, interval: 0});
        }
        const el = mount();
        const destroySpy = jest.spyOn(el.plot, 'destroy');
        const ro = observed.at(-1);

        el.remove();
        expect(destroySpy).toHaveBeenCalled();
        expect(ro.gone).toBe(true);
        expect(el.plot).toBeNull();

        document.body.appendChild(el);
        expect(el.dataset.samples).toBe('12');
    });
});
