/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { RideChart, smoothWindow, smoothSeries } from '../../src/views/analysis/ride-chart.js';

const sizes = [];
const dataUpdates = [];
RideChart.uPlot = class {
    constructor(opts, data, el) { this.opts = opts; this.data = data; this.root = document.createElement('div'); el.append(this.root); this.scales = {x: {}}; this.over = document.createElement('div'); }
    destroy() { this.root.remove(); } setSize(s) { sizes.push(s); } setSeries() {} setScale(k, v) { this.scales[k] = v; } setData(d) { this.data = d; dataUpdates.push(d); }
};
global.ResizeObserver ??= class { observe() {} disconnect() {} };

function mount() {
    document.body.innerHTML = '<ride-chart></ride-chart>';
    const el = document.querySelector('ride-chart');
    const samples = Array.from({length: 120}, (_, t) => ({t, power: 200, heartRate: 140}));
    el.data = {samples, analysis: {hasPower: true, target: null, wbal: null, intervals: []}, ftp: 250};
    return el;
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe('the ride chart in full screen', () => {
    afterEach(() => { delete HTMLElement.prototype.requestFullscreen; delete screen.orientation; });

    test('the button asks for full screen and landscape; Close returns', async () => {
        const asked = [];
        HTMLElement.prototype.requestFullscreen = function() { asked.push('fullscreen'); Object.defineProperty(document, 'fullscreenElement', {value: this, configurable: true}); return Promise.resolve(); };
        Object.defineProperty(screen, 'orientation', {value: {lock: async o => asked.push(o), unlock: () => asked.push('unlock')}, configurable: true});
        document.exitFullscreen = () => { Object.defineProperty(document, 'fullscreenElement', {value: null, configurable: true}); return Promise.resolve(); };
        const el = mount();
        el.querySelector('.rc-full').click();
        await flush();
        expect(el.classList.contains('is-full')).toBe(true);
        expect(asked).toEqual(['fullscreen', 'landscape']);
        expect(el.querySelector('.rc-full').getAttribute('aria-label')).toBe('Close full screen');
        el.querySelector('.rc-full').click();
        expect(el.classList.contains('is-full')).toBe(false);
        expect(asked).toContain('unlock');
        expect(el.querySelector('.rc-full').getAttribute('aria-label')).toBe('Full screen');
    });

    test('no full screen in this browser: the chart fills the window; Back closes it', async () => {
        Object.defineProperty(document, 'fullscreenElement', {value: null, configurable: true});
        const el = mount();
        el.querySelector('.rc-full').click();
        await flush();
        expect(el.classList.contains('is-full')).toBe(true);
        expect(el.size().height).toBeGreaterThan(160);
        window.dispatchEvent(new PopStateEvent('popstate'));
        expect(el.classList.contains('is-full')).toBe(false);
    });

    test('Escape closes it', async () => {
        const el = mount();
        el.querySelector('.rc-full').click();
        await flush();
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
        expect(el.classList.contains('is-full')).toBe(false);
    });
});

describe('the ride chart off the page', () => {
    test('its page-wide listeners go with it', async () => {
        const el = mount();
        el.querySelector('.rc-full').click();
        await flush();
        el.remove();                                  // the ride page re-renders
        expect(el.classList.contains('is-full')).toBe(false);
        el.full = true;                               // even if something set it again…
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
        expect(el.full).toBe(true);                   // …the removed chart no longer listens
    });
    test('Close while full screen is still being granted: ends as closed', async () => {
        let grant;
        HTMLElement.prototype.requestFullscreen = function() { return new Promise(r => { grant = () => { Object.defineProperty(document, 'fullscreenElement', {value: this, configurable: true}); r(); }; }); };
        let exited = 0;
        document.exitFullscreen = () => { exited++; Object.defineProperty(document, 'fullscreenElement', {value: null, configurable: true}); return Promise.resolve(); };
        const pushes = jest.spyOn(history, 'pushState');
        const el = mount();
        el.querySelector('.rc-full').click();
        el.querySelector('.rc-full').click();          // Close at once
        grant();
        await flush();
        expect(el.classList.contains('is-full')).toBe(false);
        expect(exited).toBe(1);
        expect(pushes).not.toHaveBeenCalled();
        pushes.mockRestore();
    });
});

describe('split panes and zoom-aware smoothing', () => {
    test('smoothWindow scales with visible span and drops to raw 1 s when zoomed in', () => {
        expect(smoothWindow(3600)).toBe(15);
        expect(smoothWindow(1800)).toBe(10);
        expect(smoothWindow(600)).toBe(5);
        expect(smoothWindow(240)).toBe(3);
        expect(smoothWindow(60)).toBe(1);
    });

    test('smoothSeries averages over window and preserves null pause gaps', () => {
        expect(smoothSeries([100, 200, 300, null, 400], 3)).toEqual([100, 150, 200, null, 350]);
    });

    test('splits Power and Heart rate into two synced panes and sharpens to 1 s when zoomed in', () => {
        dataUpdates.length = 0;
        document.body.innerHTML = '<ride-chart></ride-chart>';
        const el = document.querySelector('ride-chart');
        const samples = Array.from({length: 3600}, (_, t) => ({t, power: t % 2 === 0 ? 150 : 250, heartRate: 150}));
        el.data = {samples, analysis: {hasPower: true, target: null, wbal: null, intervals: []}, ftp: 250};

        // Two stacked panes: Power on top, HR on bottom, smoothed to 15 s for 60 min overview
        expect(el.plots).toHaveLength(2);
        expect(el.plots[0].series.map(s => s.key)).toEqual(['power']);
        expect(el.plots[1].series.map(s => s.key)).toEqual(['hr']);
        expect(el._smoothWin).toBe(15);
        expect(el.plots[0].plot.data[1][100]).toBeCloseTo((8 * 150 + 7 * 250) / 15, 2);

        // Zooming into a 40 s interval syncs both panes and switches Power to raw 1 s detail
        el.zoomTo(600, 640);
        expect(el._smoothWin).toBe(1);
        expect(el.plots[0].plot.scales.x).toEqual(el.plots[1].plot.scales.x);
        expect(el.plots[0].plot.data[1][601]).toBe(250);
        expect(el.plots[0].plot.data[1][602]).toBe(150);

        // Resetting zoom returns both panes to full range and 15 s overview smoothing
        el.resetZoom();
        expect(el._smoothWin).toBe(15);
        expect(el.plots[0].plot.scales.x).toEqual({min: 0, max: 3599});

        // Toggling split merges into a single combined overlay pane
        el.querySelector('.rc-split').click();
        expect(el.plots).toHaveLength(1);
        expect(el.plots[0].series.map(s => s.key)).toEqual(['power', 'hr']);
    });
});
