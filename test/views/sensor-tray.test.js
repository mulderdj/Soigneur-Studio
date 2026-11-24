/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import { fit } from '../../src/views/sensor-tray.js';
import '../../src/views/sensor-panel.js';

HTMLDialogElement.prototype.showModal ??= function() { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function() { this.removeAttribute('open'); };

const phone = matches => { window.matchMedia = () => ({matches, addEventListener() {}}); };

function mount() {
    document.body.innerHTML = '<sensor-tray hidden></sensor-tray><sensor-panel></sensor-panel>';
    return document.querySelector('sensor-tray');
}
const ids = el => [...el.querySelectorAll('[data-sensor]')].map(b => b.dataset.sensor);

describe('fit', () => {
    test('all fit, or max - 1 and "+N"', () => {
        expect(fit(['a', 'b', 'c'], 3)).toEqual({shown: ['a', 'b', 'c'], more: []});
        expect(fit(['a', 'b', 'c', 'd'], 3)).toEqual({shown: ['a', 'b'], more: ['c', 'd']});
    });
});

describe('<sensor-tray>', () => {
    afterEach(() => ['ant:hrm', 'ble:powerMeter', 'ble:speedCadenceSensor', 'ble:smo2', 'ble:coreTemp', 'ble:openBikeControl']
        .forEach(id => xf.dispatch(`${id}:disconnected`)));

    test('nothing in use: hidden', () => {
        phone(true);
        const el = mount();
        expect(el.hidden).toBe(true);
    });

    test('a sensor shows while connecting and connected, and goes when disconnected', () => {
        phone(true);
        const el = mount();
        xf.dispatch('ble:powerMeter:connecting');
        expect(ids(el)).toEqual(['ble:powerMeter']);
        expect(el.querySelector('.hdr-icon__dot').classList.contains('loading')).toBe(true);
        xf.dispatch('ble:powerMeter:connected');
        expect(el.querySelector('.hdr-icon__dot').classList.contains('on')).toBe(true);
        xf.dispatch('ble:powerMeter:disconnected');
        expect(el.hidden).toBe(true);
    });

    test('phone: 4 in use → 2 icons and "+2", which opens a list; a pick opens that sensor', () => {
        phone(true);
        const el = mount();
        ['ble:powerMeter', 'ble:speedCadenceSensor', 'ble:smo2', 'ble:coreTemp'].forEach(id => xf.dispatch(`${id}:connected`));
        expect(ids(el)).toEqual(['ble:powerMeter', 'ble:speedCadenceSensor']);
        const more = el.querySelector('[data-more]');
        expect(more.textContent).toMatch(/\+2/);
        more.click();
        const panel = document.querySelector('sensor-panel');
        expect(panel.querySelector('[data-k="title"]').textContent).toBe('Sensors');
        const picks = [...panel.querySelectorAll('[data-sp-open]')].map(b => b.dataset.spOpen);
        expect(picks).toEqual(['ble:smo2', 'ble:coreTemp']);
        panel.querySelector('[data-sp-open="ble:coreTemp"]').click();
        expect(panel.querySelector('[data-k="title"]').textContent).toBe('Core temperature');
        expect(panel.querySelector('[data-k="status"]').textContent).toBe('Connected');
    });

    test('wider screens: up to 6 icons', () => {
        phone(false);
        const el = mount();
        ['ble:powerMeter', 'ble:speedCadenceSensor', 'ble:smo2', 'ble:coreTemp'].forEach(id => xf.dispatch(`${id}:connected`));
        expect(ids(el)).toHaveLength(4);
        expect(el.querySelector('[data-more]')).toBeNull();
    });
});
