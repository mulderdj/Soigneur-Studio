/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import '../../src/views/sensor-panel.js';

HTMLDialogElement.prototype.showModal ??= function() { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function() { this.removeAttribute('open'); };

function mount() {
    document.body.innerHTML = `
        <button id="anchor">T</button>
        <sensor-panel><div data-sp-trainer><div class="mode-selector"><tab-btn param="erg">ERG</tab-btn></div></div></sensor-panel>`;
    return document.querySelector('sensor-panel');
}
const q = (el, s) => el.querySelector(s);
const open = id => xf.dispatch('ui:sensor-panel', {for: id, anchor: document.getElementById('anchor')});

describe('<sensor-panel>', () => {
    beforeEach(() => localStorage.clear());

    test('the trainer: status, device, battery, its mode control; Disconnect', () => {
        const el = mount();
        xf.dispatch('ble:controllable:connected');
        xf.dispatch('ble:controllable:name', 'Tacx Neo 2T');
        xf.dispatch('ble:controllable:batteryLevel', 80);
        open('ble:controllable');
        expect(q(el, 'dialog').hasAttribute('open')).toBe(true);
        expect(q(el, '[data-k="title"]').textContent).toBe('Trainer');
        expect(q(el, '[data-k="status"]').textContent).toBe('Connected');
        expect(q(el, '[data-k="device"]').textContent).toBe('Tacx Neo 2T');
        expect(q(el, '[data-k="battery"]').textContent).toBe('80 %');
        expect(q(el, '[data-k="trainer"]').hidden).toBe(false);
        expect(q(el, '[data-k="trainer"] .mode-selector')).not.toBeNull();
        const asked = [];
        const on = () => asked.push('switch');
        window.addEventListener('ui:ble:controllable:switch', on);
        q(el, '[data-sp="switch"]').click();
        expect(q(el, '[data-sp="switch"]').textContent).toBe('Disconnect');
        expect(asked).toEqual(['switch']);
        window.removeEventListener('ui:ble:controllable:switch', on);
    });

    test('heart rate: no mode control; not connected says Connect and the last device', () => {
        const el = mount();
        xf.dispatch('ble:heartRateMonitor:disconnected');
        open('ble:heartRateMonitor');
        expect(q(el, '[data-k="title"]').textContent).toBe('Heart rate');
        expect(q(el, '[data-k="status"]').textContent).toBe('Not connected');
        expect(q(el, '[data-k="trainer"]').hidden).toBe(true);
        expect(q(el, '[data-sp="switch"]').textContent).toBe('Connect');
        expect(q(el, '[data-k="battery"]')).toBeNull();
    });

    test('the mode control is moved in once and stays (no re-render takes it out)', () => {
        const el = mount();
        open('ble:controllable');
        const node = q(el, '.mode-selector');
        xf.dispatch('ble:controllable:connecting');
        expect(q(el, '[data-k="status"]').textContent).toBe('Connecting…');
        expect(q(el, '.mode-selector')).toBe(node);
    });

    test('the same button again closes it; another sensor switches it', () => {
        const el = mount();
        open('ble:controllable');
        open('ble:controllable');
        expect(q(el, 'dialog').hasAttribute('open')).toBe(false);
        open('ble:controllable');
        open('ble:heartRateMonitor');
        expect(q(el, '[data-k="title"]').textContent).toBe('Heart rate');
    });
});
