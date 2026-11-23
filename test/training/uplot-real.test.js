/**
 * @jest-environment jsdom
 */
// the chart base against real uPlot (canvas drawing stubbed out): zoom,
// clicks after a drag, scrolling over a chart on a phone, the shared cursor
import './browser-stubs.js';
import uPlot from 'uplot';
import { UPlotCard } from '../../src/views/training/uplot-chart.js';

process.env.TZ = 'Europe/Paris';
const DAY = 86400;
const xs = Array.from({length: 200}, (_, i) => Date.UTC(2026, 4, 1) / 1000 + i * DAY);
const today = xs[171];

beforeAll(() => {
    const ctx = new Proxy({}, {get: (t, k) => k in t ? t[k] : (k === 'measureText' ? () => ({width: 10}) : () => {}), set: (t, k, v) => { t[k] = v; return true; }});
    HTMLCanvasElement.prototype.getContext = () => ctx;
    global.Path2D = class { constructor() { return new Proxy(this, {get: (t, k) => k in t ? t[k] : () => {}}); } };
    UPlotCard.uPlot = uPlot;
    class ZoomCard extends UPlotCard {
        head() { return '<h2>Zoom</h2>'; }
        chart() {
            return {
                model: {x: xs, series: [{label: 'A', color: '#fff', values: xs.map((_, i) => i)}],
                        ranges: [['3m', '3 months'], ['all', 'All']], defaultRange: '3m', today, zoom: true, sync: 'test'},
                readout: (i) => ({title: `t${i}`, rows: [], more: [], day: '2026-05-01'}),
            };
        }
    }
    customElements.define('zoom-card', ZoomCard);
});

const flush = () => new Promise(r => setTimeout(r, 0));
async function card() {
    document.body.innerHTML = '<zoom-card></zoom-card>';
    const el = document.querySelector('zoom-card');
    el.data = {};
    await flush();
    return el;
}

describe('zoom', () => {
    test('opens on the range window, a zoom sticks, a double-click goes back to the window', async () => {
        const el = await card();
        const u = el.plot;
        expect(u.scales.x.min).toBe(today - 90 * DAY);
        u.setScale('x', {min: xs[150], max: xs[160]});
        await flush();
        expect([u.scales.x.min, u.scales.x.max]).toEqual([xs[150], xs[160]]);
        u.over.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, button: 0}));
        await flush();
        expect(u.scales.x.min).toBe(today - 90 * DAY);
    });

    test('a drag does not open the day; a click does', async () => {
        const el = await card();
        const opened = [];
        el.addEventListener('day-open', e => opened.push(e.detail.day));
        const over = el.plot.over;
        const mouse = (type, x, target = over) => target.dispatchEvent(new MouseEvent(type, {bubbles: true, clientX: x, clientY: 20, button: 0}));
        // a drag: uPlot swallows the click that ends it
        mouse('mousemove', 10); mouse('mousedown', 10); mouse('mousemove', 120, document); mouse('mouseup', 120, document); mouse('click', 120);
        expect(opened).toEqual([]);
        // a click
        mouse('mousemove', 50); mouse('mousedown', 50); mouse('mouseup', 50, document);
        el.plot.cursor.idx = 5;
        mouse('click', 50);
        await new Promise(r => setTimeout(r, 400));
        expect(opened).toEqual(['2026-05-01']);
    });

    test('a double-click (to zoom out) does not open the day', async () => {
        const el = await card();
        const opened = [];
        el.addEventListener('day-open', e => opened.push(e.detail.day));
        const over = el.plot.over;
        const mouse = (type, x, target = over) => target.dispatchEvent(new MouseEvent(type, {bubbles: true, clientX: x, clientY: 20, button: 0}));
        mouse('mousemove', 50);
        el.plot.cursor.idx = 5;
        for(const n of [1, 2]) { mouse('mousedown', 50); mouse('mouseup', 50, document); mouse('click', 50); }
        mouse('dblclick', 50);
        await new Promise(r => setTimeout(r, 400));
        expect(opened).toEqual([]);
    });
});

describe('axis days in the rider\'s timezone', () => {
    test('ticks fall on UTC days, the days the chart models use', async () => {
        const el = await card();
        const splits = el.plot.axes[0]._splits ?? [];
        expect(splits.length).toBeGreaterThan(2);
        expect(splits.filter(t => t % DAY !== 0)).toEqual([]);
    });
});

describe('a finger on a chart', () => {
    const touchEvent = (type, x, y) => {
        const e = new Event(type, {bubbles: true, cancelable: true});
        Object.defineProperty(e, 'touches', {value: [{clientX: x, clientY: y}]});
        return e;
    };
    test('a vertical swipe scrolls the page; a sideways slide moves the read-out', async () => {
        const over = (await card()).plot.over;
        over.dispatchEvent(touchEvent('touchstart', 100, 100));
        const down = touchEvent('touchmove', 103, 140);
        over.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(false);
        over.dispatchEvent(touchEvent('touchstart', 100, 100));
        const side = touchEvent('touchmove', 140, 104);
        over.dispatchEvent(side);
        expect(side.defaultPrevented).toBe(true);
    });
});

describe('the shared cursor', () => {
    test('a day past the chart\'s right edge hides the read-out', async () => {
        const el = await card();
        const u = {cursor: {idx: 199, left: 900}, over: {clientWidth: 600, offsetLeft: 0}};
        el.showTip(u);
        expect(el.$tip.hidden).toBe(true);
    });
});
