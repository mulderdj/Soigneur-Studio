/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { RideChart } from '../../src/views/analysis/ride-chart.js';

const sizes = [];
RideChart.uPlot = class {
    constructor(opts, data, el) { this.root = document.createElement('div'); el.append(this.root); this.scales = {x: {}}; this.over = document.createElement('div'); }
    destroy() { this.root.remove(); } setSize(s) { sizes.push(s); } setSeries() {} setScale() {}
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
