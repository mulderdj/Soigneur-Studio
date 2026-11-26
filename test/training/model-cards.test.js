/**
 * @jest-environment jsdom
 */
import '../../src/views/training/model-cards.js';
import { modelSettings } from '../../src/training/rider-model-settings.js';
import { currentModel } from '../../src/training/rider-model.js';
import { DURATIONS } from '../../src/training/summary.js';

const today = '2026-11-24';
const curve = (cp, wprime) => Object.fromEntries(DURATIONS.map(d => [d, Math.round(cp + wprime / Math.max(d, 60))]));
const rides = [{id: 'a', day: '2026-11-20', name: 'VO2 max', sport: 'cycling', best: {...curve(270, 22000), 5: 1050}}];
const model = (settings = modelSettings.get(), summaries = rides) => currentModel({summaries, today, ftp: 250, typedWprime: 20000, settings});
const flush = () => new Promise(r => setTimeout(r, 0));

function mount(tag, data = {}) {
    document.body.innerHTML = `<${tag}></${tag}>`;
    const el = document.querySelector(tag);
    el.data = {today, ftp: 250, weight: 75, summaries: rides, ...data};
    return el;
}
const changed = m => window.dispatchEvent(new CustomEvent('rider-model:changed', {detail: {data: m}}));

beforeEach(() => localStorage.clear());

describe('the CP and W′ card', () => {
    test('the fit, the efforts, CP against FTP, and the offer in Ask me', () => {
        const el = mount('model-card');
        changed(model());
        expect(el.querySelector('[data-k="cp"]').textContent).toMatch(/27\d W/);
        expect(el.querySelector('[data-k="wprime"]').textContent).toMatch(/kJ/);
        expect(el.querySelectorAll('.mc-effort').length).toBe(9);
        expect(el.textContent).toMatch(/VO2 max/);
        expect(el.textContent).toMatch(/of your FTP/);
        expect(el.querySelector('[data-mc="use"]')).not.toBeNull();
        expect(el.textContent).toMatch(/W′bal uses your FTP/);
    });
    test('Use for W′bal: saved; then Back to my settings', () => {
        const el = mount('model-card');
        changed(model());
        el.querySelector('[data-mc="use"]').click();
        expect(modelSettings.get().use.cp).toBeGreaterThan(260);
        changed(model());
        expect(el.textContent).toMatch(/W′bal uses the model/);
        el.querySelector('[data-mc="unuse"]').click();
        expect(modelSettings.get().use).toBeNull();
    });
    test('Automatically: the setting saved, no offer', () => {
        const el = mount('model-card');
        changed(model());
        el.querySelector('[data-mode="auto"]').click();
        expect(modelSettings.get().mode).toBe('auto');
        changed(model());
        expect(el.querySelector('[data-mc="use"]')).toBeNull();
        expect(el.querySelector('[data-mode="auto"]').getAttribute('aria-pressed')).toBe('true');
    });
    test('no fit: what is missing', () => {
        const el = mount('model-card');
        changed(model(undefined, []));
        expect(el.textContent).toMatch(/No power data/);
        expect(el.textContent).not.toMatch(/NaN|undefined/);
    });
    test('no fit: Ride the 3 + 12 min test, hidden during a ride', () => {
        const el = mount('model-card');
        changed(model(undefined, []));
        const asked = [];
        const on = e => asked.push(e.detail.data);
        window.addEventListener('tests:ride', on);
        el.querySelector('[data-mc="ride-test"]').click();
        expect(asked).toEqual(['3-12']);
        const status = s => window.dispatchEvent(new CustomEvent('db:watchStatus', {detail: {data: {watchStatus: s}}}));
        status('started');
        expect(el.querySelector('[data-mc="ride-test"]')).toBeNull();
        status('stopped');
        expect(el.querySelector('[data-mc="ride-test"]')).not.toBeNull();
        window.removeEventListener('tests:ride', on);
    });
    test('with a fit: no test button', () => {
        const el = mount('model-card');
        changed(model());
        expect(el.querySelector('[data-mc="ride-test"]')).toBeNull();
    });
});

describe('the power profile card', () => {
    test('rows with W/kg and categories, and the sentence', () => {
        const el = mount('profile-card');
        changed(model());
        const rows = [...el.querySelectorAll('.pp-row')];
        expect(rows.map(r => r.querySelector('.pp-label').textContent)).toEqual(['5 s', '1 min', '5 min', 'FTP']);
        expect(el.querySelector('.pp-row .pp-cat').textContent).toBe('Moderate');      // 1050 W / 75 kg = 14 W/kg
        expect(el.querySelector('.pp-sentence').textContent).toMatch(/Strongest at/);
    });
    test('the women\'s table, chosen on the card', () => {
        const el = mount('profile-card');
        changed(model());
        el.querySelector('[data-table="women"]').click();
        expect(modelSettings.get().table).toBe('women');
        expect(el.querySelector('[data-table="women"]').getAttribute('aria-pressed')).toBe('true');
    });
    test('no weight: where to set it', () => {
        const el = mount('profile-card', {weight: null});
        changed(model());
        expect(el.textContent).toMatch(/weight in Settings/);
        expect(el.textContent).not.toMatch(/NaN|Infinity/);
    });
});
