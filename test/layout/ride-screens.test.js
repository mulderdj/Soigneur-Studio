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
    while(layouts.editing) layouts.endEdit();      // an edit a previous test left open
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
    test('the handlebar fit is measured again when the screens area changes size (the header hides while riding)', () => {
        const observed = [];
        const RO = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observed.push(this); } observe(el) { this.el = el; } disconnect() { this.gone = true; } };
        try {
            size(844, 390);
            const el = page();
            const fits = [];
            el.fit = () => fits.push(1);
            const ro = observed.find(o => o.el === el.$track);
            expect(ro).toBeDefined();
            ro.cb([]);
            expect(fits.length).toBe(1);
            el.remove();
            expect(ro.gone).toBe(true);
        } finally {
            globalThis.ResizeObserver = RO;
        }
    });

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

describe('several screens', () => {
    const dots = el => [...el.querySelectorAll('.rs-dots [data-dot]')];
    test('a dot per screen; a dot switches; the screen in view is the one with the live tiles', () => {
        const el = page();
        expect(dots(el).map(d => d.getAttribute('aria-label'))).toEqual(['Ride', 'Big numbers', 'Chart']);
        expect(dots(el)[0].getAttribute('aria-current')).toBe('true');
        dots(el)[2].click();
        expect(el.screen).toBe(2);
        expect(dots(el)[2].getAttribute('aria-current')).toBe('true');
        expect(screenEl(el, 2).getAttribute('aria-hidden')).toBeNull();
        expect(screenEl(el, 0).getAttribute('aria-hidden')).toBe('true');
        expect(screenEl(el, 2).querySelector('[data-tile="power"]').firstElementChild.id).toBe('data-tile--power');
    });

    test('← and → switch, not while typing in a field', () => {
        const el = page();
        const key = (k, target = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', {key: k, code: k, bubbles: true}));
        key('ArrowRight');
        expect(el.screen).toBe(1);
        key('ArrowRight'); key('ArrowRight');
        expect(el.screen).toBe(2);                    // stops at the last
        key('ArrowLeft');
        expect(el.screen).toBe(1);
        const input = document.createElement('input');
        document.body.append(input);
        key('ArrowLeft', input);
        expect(el.screen).toBe(1);
    });

    test('← → on a focused dot (after clicking one) switch screens, and focus follows', () => {
        const el = page();
        el.querySelector('[data-dot="1"]').click();
        el.querySelector('[data-dot="1"]').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}));
        expect(el.screen).toBe(2);
        expect(document.activeElement).toBe(el.querySelector('[data-dot="2"]'));
    });

    test('the screen in view is remembered on this device, and falls back to the first', () => {
        let el = page();
        el.show(2);
        el = page();
        expect(el.screen).toBe(2);
        const fewer = defaultLayouts(); fewer.ride.large.screens = fewer.ride.large.screens.slice(0, 1);
        layouts.save(fewer);
        el = page();
        expect(el.screen).toBe(0);
    });

    test('a swipe right after tapping a dot still ends on the screen that snapped into view', () => {
        jest.useFakeTimers();
        try {
            const el = page();
            Object.defineProperty(el.$track, 'clientWidth', {value: 400, configurable: true});
            el.$track.scrollTo = ({left}) => { el.$track.scrollLeft = left; };
            el.show(1);                                   // the dot: a smooth scroll to screen 2
            el.$track.scrollLeft = 800;                   // the rider swipes on to screen 3 meanwhile
            el.$track.dispatchEvent(new Event('scroll'));
            jest.advanceTimersByTime(1000);
            expect(el.screen).toBe(2);
            expect(screenEl(el, 2).querySelector('[data-tile="power"]').firstElementChild.id).toBe('data-tile--power');
        } finally {
            jest.useRealTimers();
        }
    });

    test('one screen: no dots', () => {
        const one = defaultLayouts(); one.ride.large.screens = one.ride.large.screens.slice(0, 1);
        layouts.save(one);
        const el = page();
        expect(el.querySelector('.rs-dots').hidden).toBe(true);
    });

    test('a sideways finger on the live chart is the chart\'s; from the screen edge it switches screens', () => {
        const el = page();
        el.show(2);
        const slot = screenEl(el, 2).querySelector('[data-tile="chart"]');
        expect(slot.style.touchAction).toBe('pan-y');
        el.$track.getBoundingClientRect = () => ({left: 0, right: 400, top: 0, bottom: 600, width: 400, height: 600});
        const touch = (type, x) => {
            const e = new MouseEvent(type, {bubbles: true, clientX: x, clientY: 300});
            Object.defineProperty(e, 'pointerType', {value: 'touch'});
            slot.firstElementChild.dispatchEvent(e);
        };
        touch('pointerdown', 200); touch('pointermove', 100); touch('pointerup', 60);
        expect(el.screen).toBe(2);                    // the chart's read-out, not a screen change
        touch('pointerdown', 10); touch('pointermove', 80); touch('pointerup', 120);
        expect(el.screen).toBe(1);                    // from the left edge: the previous screen
    });
});

describe('editing screens', () => {
    beforeEach(() => {
        HTMLDialogElement.prototype.showModal ??= function() { this.open = true; };
        HTMLDialogElement.prototype.close ??= function() { this.open = false; };
    });

    test('add a screen: empty, named Screen N, shown; at most 8', () => {
        const el = page();
        el.begin();
        el.querySelector('[data-rs="add-screen"]').click();
        expect(el.screens().map(s => s.name)).toEqual(['Ride', 'Big numbers', 'Chart', 'Screen 4']);
        expect(el.screen).toBe(3);
        expect(screenEl(el, 3).querySelector('.rs-empty')).not.toBeNull();
        for(let i = 0; i < 6; i++) el.querySelector('[data-rs="add-screen"]').click();
        expect(el.screens()).toHaveLength(8);
        expect(el.querySelector('[data-rs="add-screen"]').disabled).toBe(true);
    });

    test('rename the screen in view', () => {
        const el = page();
        el.begin();
        const input = el.querySelector('[data-rs="name"]');
        expect(input.value).toBe('Ride');
        input.value = 'Climb';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        el.done();
        expect(layouts.get().ride.large.screens[0].name).toBe('Climb');
        expect(el.querySelector('[data-dot="0"]').getAttribute('aria-label')).toBe('Climb');
    });

    test('remove a screen: asks when it has tiles; never the last', () => {
        const el = page();
        el.begin();
        el.show(1);
        window.confirm = () => false;
        el.querySelector('[data-rs="remove-screen"]').click();
        expect(el.screens()).toHaveLength(3);
        window.confirm = () => true;
        el.querySelector('[data-rs="remove-screen"]').click();
        expect(el.screens().map(s => s.name)).toEqual(['Ride', 'Chart']);
        el.querySelector('[data-rs="remove-screen"]').click();
        expect(el.screens()).toHaveLength(1);
        expect(el.querySelector('[data-rs="remove-screen"]').disabled).toBe(true);
    });

    test('move the screen in view left or right with its dot\'s keys', () => {
        const el = page();
        el.begin();
        el.show(2);
        el.querySelector('[data-dot="2"]').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', shiftKey: true, bubbles: true}));
        expect(el.screens().map(s => s.name)).toEqual(['Ride', 'Chart', 'Big numbers']);
        expect(el.screen).toBe(1);
    });

    test('drag a dot onto another to reorder screens', () => {
        const el = page();
        el.begin();
        [...el.querySelectorAll('[data-dot]')].forEach((d, i) => {
            d.getBoundingClientRect = () => ({left: i * 50, right: i * 50 + 44, top: 0, bottom: 44, width: 44, height: 44});
        });
        const ev = (type, target, x) => {
            const e = new MouseEvent(type, {bubbles: true, clientX: x, clientY: 20, button: 0});
            Object.defineProperty(e, 'pointerType', {value: 'mouse'});
            target.dispatchEvent(e);
        };
        const dot0 = el.querySelector('[data-dot="0"]');
        ev('pointerdown', dot0, 20);
        ev('pointermove', document, 80);
        ev('pointerup', document, 120);
        expect(el.screens().map(s => s.name)).toEqual(['Big numbers', 'Chart', 'Ride']);
        expect(el.screen).toBe(2);
    });

    test('a tile dropped on the screen edge goes to the next screen', () => {
        const el = page();
        el.begin();
        el.moveToNeighbour('right', 'speed');
        expect(el.screens()[0].tiles.map(t => t.id)).not.toContain('speed');
        expect(el.screens()[1].tiles.map(t => t.id)).toContain('speed');
        expect(el.screen).toBe(1);
        el.moveToNeighbour('left', 'heart-rate');      // already there: moved, not doubled
        expect(el.screens()[0].tiles.filter(t => t.id === 'heart-rate')).toHaveLength(1);
        expect(el.screens()[1].tiles.map(t => t.id)).not.toContain('heart-rate');
        el.show(0);
        el.moveToNeighbour('left', 'power');           // no screen there: nothing happens
        expect(el.screens()[0].tiles.map(t => t.id)).toContain('power');
    });
});
