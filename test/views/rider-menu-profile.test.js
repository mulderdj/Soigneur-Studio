/**
 * @jest-environment jsdom
 */
import '../training/fake-idb.js';
import { xf } from '../../src/functions.js';
import { api } from '../../src/account/api.js';
import '../../src/views/training/hr-thresholds.js';
import '../../src/views/rider-menu.js';

HTMLDialogElement.prototype.showModal ??= function() { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function() { this.removeAttribute('open'); };

describe('RiderMenu Profile tab', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.spyOn(api, 'probe').mockResolvedValue({available: false});
        xf.dispatch('db:ftp', {ftp: 250});
        xf.dispatch('db:weight', {weight: 75});
        xf.dispatch('db:measurement', {measurement: 'metric'});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        document.body.innerHTML = '';
    });

    test('uses Profile as first tab, keeps device riders in Users tab, and aliases riders -> users', async () => {
        document.body.innerHTML = '<rider-menu></rider-menu>';
        const el = document.querySelector('rider-menu');
        await el.open();

        const tabs = Array.from(el.querySelectorAll('[data-tab]')).map(b => [b.dataset.tab, b.textContent]);
        expect(tabs).toEqual([['profile', 'Profile'], ['account', 'Account'], ['users', 'Users']]);
        expect(el.querySelector('[data-tab="sensors"]')).toBeNull();
        expect(el.querySelector('hr-thresholds')).not.toBeNull();
        expect(el.querySelector('[data-form="add-rider"]')).toBeNull();

        el.tab = 'riders';
        expect(el.tab).toBe('users');
        el.render();
        expect(el.querySelector('[data-form="add-rider"]')).not.toBeNull();
    });

    test('edits FTP and Weight in metric units, dispatches events, and shows Saved feedback', async () => {
        document.body.innerHTML = '<rider-menu></rider-menu>';
        const el = document.querySelector('rider-menu');
        await el.open();
        xf.dispatch('db:ftp', {ftp: 240});
        xf.dispatch('db:weight', {weight: 72});

        const ftps = [];
        const weights = [];
        const ac = new AbortController();
        xf.sub('ui:ftp-set', v => ftps.push(v), {signal: ac.signal});
        xf.sub('ui:weight-set', v => weights.push(v), {signal: ac.signal});

        const form = el.querySelector('form[data-form="metrics"]');
        expect(form.elements.ftp.value).toBe('240');
        expect(form.elements.weight.value).toBe('72');
        expect(form.textContent).toContain('(kg)');

        form.elements.ftp.value = '275';
        form.elements.weight.value = '70';
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));

        expect(ftps).toEqual([275]);
        expect(weights).toEqual([70]);
        expect(el.querySelector('.rm--metrics-status').textContent).toBe('Saved');

        ac.abort();
    });

    test('displays Weight in lb when measurement is imperial and converts back to kg on save', async () => {
        document.body.innerHTML = '<rider-menu></rider-menu>';
        const el = document.querySelector('rider-menu');
        await el.open();
        xf.dispatch('db:weight', {weight: 75});
        xf.dispatch('db:measurement', {measurement: 'imperial'});

        const weights = [];
        const ac = new AbortController();
        xf.sub('ui:weight-set', v => weights.push(v), {signal: ac.signal});

        const form = el.querySelector('form[data-form="metrics"]');
        expect(form.textContent).toContain('(lb)');
        expect(form.elements.weight.value).toBe(String(Math.round(2.20462 * 75)));

        form.elements.weight.value = '176';
        form.elements.weight.dispatchEvent(new Event('change', {bubbles: true}));

        expect(weights).toEqual([Math.round(0.453592 * 176)]);
        expect(el.querySelector('.rm--metrics-status').textContent).toBe('Saved');

        ac.abort();
    });
});
