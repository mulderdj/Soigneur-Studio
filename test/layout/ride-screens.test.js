/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { xf } from '../../src/functions.js';
import { layouts } from '../../src/layout/store.js';
import { defaultLayouts } from '../../src/layout/tiles.js';
import '../../src/views/ride-screens.js';

const IDS = ['power', 'target', 'interval-time', 'elapsed-time', 'heart-rate', 'cadence', 'speed', 'distance', 'slope',
             'power-avg', 'smo2', 'thb', 'core-body-temperature', 'skin-temperature', 'stats'];
const elId = id => ({chart: 'dash-chart', workout: 'graph-workout'})[id] ?? `data-tile--${id}`;

function size(w, h) {
    Object.defineProperty(window, 'innerWidth', {value: w, configurable: true});
    Object.defineProperty(window, 'innerHeight', {value: h, configurable: true});
}

function page() {
    document.body.innerHTML = `
        <header><button data-ride-layout></button></header>
        <ride-screens></ride-screens>
        <div class="ride__pool" hidden>
            ${IDS.map(id => `<div class="tile" id="${elId(id)}"><h2 class="tile__label">${id}</h2><span class="v">--</span></div>`).join('')}
            <live-chart id="dash-chart"></live-chart>
            <div id="graph-workout"></div>
        </div>`;
    return document.querySelector('ride-screens');
}

const ids = $screen => [...$screen.querySelectorAll('.rs-slot')].map(s => s.dataset.tile);
const screenEl = (el, i) => el.querySelector(`[data-screen="${i}"]`);
const riding = (state) => xf.dispatch(`db:${Object.keys(state)[0]}`, state);

beforeEach(() => {
    localStorage.clear();
    layouts.save(defaultLayouts());
    size(1440, 900);                                   // desktop: the large layout
    globalThis.requestAnimationFrame = cb => cb();
});

describe('the Ride screens', () => {
    test('the screen in view holds the page\'s own tile elements, in the layout\'s order', () => {
        const before = document.getElementById;
        const el = page();
        const power = document.getElementById('data-tile--power');
        const expected = defaultLayouts().ride.large.screens[0].tiles.map(t => t.id);
        expect(ids(screenEl(el, 0))).toEqual(expected);
        expect(screenEl(el, 0).querySelector('[data-tile="power"]').firstElementChild).toBe(power);
        expect(screenEl(el, 0).querySelector('[data-tile="chart"] #dash-chart')).not.toBeNull();
    });

    test('a tile on two screens is live on the one in view, a placeholder on the other', () => {
        const el = page();
        const power = document.getElementById('data-tile--power');
        expect(screenEl(el, 1).querySelector('[data-tile="power"] .rs-placeholder')).not.toBeNull();
        el.screen = 1;
        el.place();
        expect(screenEl(el, 1).querySelector('[data-tile="power"]').firstElementChild).toBe(power);
        expect(screenEl(el, 0).querySelector('[data-tile="power"] .rs-placeholder')).not.toBeNull();
    });

    test('a tile on no screen stays in the pool', () => {
        const el = page();
        expect(document.getElementById('data-tile--smo2').parentElement.classList.contains('ride__pool')).toBe(true);
    });

    test('the layout button is off while riding, with a reason', () => {
        page();
        const b = document.querySelector('[data-ride-layout]');
        expect(b.disabled).toBe(false);
        riding({watchStatus: 'started'});
        expect(b.disabled).toBe(true);
        expect(b.title).toMatch(/stop the ride/i);
        riding({watchStatus: 'stopped'});
        riding({workoutStatus: 'started'});
        expect(b.disabled).toBe(true);
        riding({workoutStatus: 'stopped'});
    });
});

describe('editing the layout', () => {
    test('remove a tile, Done: saved for this screen class', () => {
        const el = page();
        document.querySelector('[data-ride-layout]').click();
        expect(el.editing).toBe(true);
        screenEl(el, 0).querySelector('[data-tile="speed"] [data-le-hide]').click();
        expect(ids(screenEl(el, 0))).not.toContain('speed');
        expect(layouts.get().ride.large.screens[0].tiles.map(t => t.id)).toContain('speed');   // not yet
        el.querySelector('[data-rs="done"]').click();
        expect(el.editing).toBe(false);
        expect(layouts.get().ride.large.screens[0].tiles.map(t => t.id)).not.toContain('speed');
        expect(layouts.get().ride.phone.screens[0].tiles.map(t => t.id)).toContain('speed');     // the phone layout untouched
        expect(document.getElementById('data-tile--speed').parentElement.classList.contains('ride__pool')).toBe(true);
    });

    test('Cancel throws the edit away', () => {
        const el = page();
        el.begin();
        screenEl(el, 0).querySelector('[data-tile="speed"] [data-le-hide]').click();
        el.querySelector('[data-rs="cancel"]').click();
        expect(ids(screenEl(el, 0))).toContain('speed');
    });

    test('starting the clock while editing ends the edit and keeps the saved layout', () => {
        const el = page();
        el.begin();
        screenEl(el, 0).querySelector('[data-tile="speed"] [data-le-hide]').click();
        riding({watchStatus: 'started'});
        expect(el.editing).toBe(false);
        expect(ids(screenEl(el, 0))).toContain('speed');
        expect(layouts.get().ride.large.screens[0].tiles.map(t => t.id)).toContain('speed');
        el.begin();
        expect(el.editing).toBe(false);                    // locked while riding
        riding({watchStatus: 'stopped'});
    });

    test('Add tile adds a tile that isn\'t on the screen, live', () => {
        const el = page();
        el.begin();
        HTMLDialogElement.prototype.showModal ??= function() { this.open = true; };
        HTMLDialogElement.prototype.close ??= function() { this.open = false; };
        el.querySelector('[data-rs="add"]').click();
        const offered = [...el.querySelectorAll('[data-add]')].map(b => b.dataset.add);
        expect(offered).toContain('smo2');
        expect(offered).not.toContain('power');
        el.querySelector('[data-add="smo2"]').click();
        expect(ids(screenEl(el, 0)).at(-1)).toBe('smo2');
        expect(screenEl(el, 0).querySelector('[data-tile="smo2"]').firstElementChild.id).toBe('data-tile--smo2');
    });

    test('Reset asks, then restores the built-in screens of this class', () => {
        const el = page();
        el.begin();
        screenEl(el, 0).querySelector('[data-tile="speed"] [data-le-hide]').click();
        window.confirm = () => false;
        el.querySelector('[data-rs="reset"]').click();
        expect(ids(screenEl(el, 0))).not.toContain('speed');
        window.confirm = () => true;
        el.querySelector('[data-rs="reset"]').click();
        expect(ids(screenEl(el, 0))).toContain('speed');
    });

    test('a layout from the account arriving mid-edit waits until Done', () => {
        const el = page();
        el.begin();
        const remote = defaultLayouts(); remote.ride.large.screens[0].tiles = [{id: 'heart-rate', size: 'large'}];
        layouts.applyRemote(remote);
        expect(ids(screenEl(el, 0))).toContain('power');
        el.cancel();
        expect(ids(screenEl(el, 0))).toEqual(['heart-rate']);
    });
});

describe('screen sizes', () => {
    test('turning a phone keeps the screen in view', () => {
        size(390, 844);
        const el = page();
        el.screen = 1;
        el.render();
        size(844, 390);
        window.dispatchEvent(new Event('resize'));
        expect(el.layoutName).toBe('phone-landscape');
        expect(el.screen).toBe(1);
        expect(el.$track.style.getPropertyValue('--cols')).toBe('5');
    });
    test('a phone gets the phone layout', () => {
        size(390, 844);
        const el = page();
        expect(ids(screenEl(el, 0))).toEqual(defaultLayouts().ride.phone.screens[0].tiles.map(t => t.id));
    });
});
