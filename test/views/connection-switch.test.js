/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import '../../src/views/connection-switch.js';

function mountDeviceCard({ open = false } = {}) {
    document.body.innerHTML = `
        <details class="card device-card"${open ? ' open' : ''}>
            <summary class="device-card--head">
                <connection-switch for="ble:powerMeter"
                    indicatorClass="connection-icon-switch--indicator"
                    class="connection-icon-switch"
                    role="button"
                    tabindex="0">
                    <div class="connection-icon-switch--indicator off"></div>
                </connection-switch>
                <div class="device-card--info">
                    <span class="device-card--title">Power Meter</span>
                </div>
            </summary>
            <div class="device-card--body"></div>
        </details>`;
    return {
        details: /** @type {HTMLDetailsElement} */ (document.querySelector('details.device-card')),
        summary: document.querySelector('summary.device-card--head'),
        sw: document.querySelector('connection-switch'),
    };
}

describe('<connection-switch> inside <details><summary>', () => {
    test('click on connection-switch is prevented and stopped so details does not toggle', () => {
        const { details, sw } = mountDeviceCard({ open: false });
        const dispatched = [];
        const onSwitch = () => dispatched.push('switch');
        window.addEventListener('ui:ble:powerMeter:switch', onSwitch);

        const summaryClicks = [];
        details.querySelector('summary').addEventListener('click', () => summaryClicks.push('summary'));

        sw.dispatchEvent(new Event('pointerup', { bubbles: true }));
        const clickEv = new MouseEvent('click', { bubbles: true, cancelable: true });
        sw.dispatchEvent(clickEv);

        expect(dispatched).toEqual(['switch']);
        expect(clickEv.defaultPrevented).toBe(true);
        expect(summaryClicks).toEqual([]);
        expect(details.open).toBe(false);

        window.removeEventListener('ui:ble:powerMeter:switch', onSwitch);
    });

    test('Enter/Space on connection-switch dispatches switch without bubbling to summary', () => {
        const { details, sw } = mountDeviceCard({ open: false });
        const dispatched = [];
        const onSwitch = () => dispatched.push('switch');
        window.addEventListener('ui:ble:powerMeter:switch', onSwitch);

        const summaryKeys = [];
        details.querySelector('summary').addEventListener('keydown', () => summaryKeys.push('key'));

        const keyEv = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        sw.dispatchEvent(keyEv);

        expect(dispatched).toEqual(['switch']);
        expect(keyEv.defaultPrevented).toBe(true);
        expect(summaryKeys).toEqual([]);
        expect(details.open).toBe(false);

        window.removeEventListener('ui:ble:powerMeter:switch', onSwitch);
    });

    test('connecting a device updates indicator and auto-opens its collapsed device card', () => {
        const { details, sw } = mountDeviceCard({ open: false });
        expect(details.open).toBe(false);

        xf.dispatch('ble:powerMeter:connected');

        expect(sw.querySelector('.connection-icon-switch--indicator').classList.contains('on')).toBe(true);
        expect(details.open).toBe(true);
    });
});
