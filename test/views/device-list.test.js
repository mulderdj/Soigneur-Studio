/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import { sensors } from '../../src/sensors.js';
import { initDeviceList } from '../../src/views/device-list.js';

function mountDevices() {
    document.body.innerHTML = `
        <section class="settings__devices">
            <h2 class="settings__heading">Devices</h2>
            <details class="card device-card" id="c-trainer" open>
                <summary class="device-card--head">
                    <connection-switch for="ble:controllable"></connection-switch>
                    <div class="device-card--info"><span class="device-card--title">Smart Trainer</span></div>
                </summary>
            </details>
            <details class="card device-card" id="c-hrm">
                <summary class="device-card--head">
                    <connection-switch for="ble:heartRateMonitor"></connection-switch>
                    <div class="device-card--info"><span class="device-card--title">HRM</span></div>
                </summary>
            </details>
            <details class="card device-card" id="c-moxy">
                <summary class="device-card--head">
                    <connection-switch for="ble:smo2"></connection-switch>
                    <div class="device-card--info"><span class="device-card--title">Moxy</span></div>
                </summary>
            </details>
        </section>`;
    return document.querySelector('.settings__devices');
}

describe('Settings Devices list', () => {
    beforeEach(() => {
        localStorage.clear();
        sensors.forgetAll();
    });

    test('hides unpaired devices, shows empty note, and reveals only paired/connected ones', () => {
        const sec = mountDevices();
        const ctrl = initDeviceList(sec);

        expect(sec.querySelector('#c-trainer').hidden).toBe(true);
        expect(sec.querySelector('#c-hrm').hidden).toBe(true);
        expect(sec.querySelector('#c-moxy').hidden).toBe(true);
        expect(sec.querySelector('.devices-empty').hidden).toBe(false);

        // Connecting a device reveals its card and hides the empty note
        xf.dispatch('ble:heartRateMonitor:connected');
        expect(sec.querySelector('#c-hrm').hidden).toBe(false);
        expect(sec.querySelector('#c-trainer').hidden).toBe(true);
        expect(sec.querySelector('.devices-empty').hidden).toBe(true);

        // Saving a paired sensor keeps it visible even when disconnected
        xf.dispatch('sensor:connected', {identifier: 'ble:controllable', id: 'd1', name: 'Tacx'});
        expect(sec.querySelector('#c-trainer').hidden).toBe(false);
        xf.dispatch('ble:heartRateMonitor:disconnected');
        expect(sec.querySelector('#c-hrm').hidden).toBe(true);

        ctrl.destroy();
    });

    test('+ Add device opens picker for hidden devices and triggers pairing when chosen', () => {
        const sec = mountDevices();
        const ctrl = initDeviceList(sec);
        const switched = [];
        xf.sub('ui:ble:smo2:switch', () => switched.push('ble:smo2'));

        const addBtn = sec.querySelector('.devices-add');
        const picker = sec.querySelector('.devices-picker');
        expect(picker.hidden).toBe(true);

        addBtn.click();
        expect(picker.hidden).toBe(false);
        expect(picker.querySelectorAll('[data-add-device]')).toHaveLength(3);

        picker.querySelector('[data-add-device="ble:smo2"]').click();
        expect(picker.hidden).toBe(true);
        expect(sec.querySelector('#c-moxy').hidden).toBe(false);
        expect(sec.querySelector('#c-moxy').open).toBe(true);
        expect(switched).toEqual(['ble:smo2']);

        ctrl.destroy();
    });
});
