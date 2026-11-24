/**
 * @jest-environment jsdom
 */
import { analyseRide } from '../../src/analysis/ride.js';
import '../../src/views/analysis/ride-cards.js';
const { FTP, workout, rideOf, steady } = require('./fixtures.js');

const base = {ftp: FTP, wprime: 20000, lthr: 170, summaries: []};
function cards(analysis) {
    document.body.innerHTML = '<ride-cards></ride-cards>';
    const el = document.querySelector('ride-cards');
    el.data = {analysis, ftp: FTP};
    return el;
}
const card = (el, name) => el.querySelector(`[data-card="${name}"]`);

describe('the ride\'s cards', () => {
    test('a workout: W′bal with its matches, best efforts, power and HR zones; no decoupling under 45 min of steady riding', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        const el = cards(analyseRide({...base, samples, pauses, workout: w}));
        expect(card(el, 'wbal').textContent).toMatch(/Lowest/);
        expect(card(el, 'wbal').querySelectorAll('.rc-match').length).toBeGreaterThanOrEqual(1);
        expect(card(el, 'wbal').textContent).toMatch(/kJ/);
        expect(card(el, 'bests').textContent).toMatch(/1 min/);
        expect(card(el, 'zones').querySelectorAll('.rc-zone')).toHaveLength(7 + 5);
        expect(el.textContent).not.toMatch(/NaN|undefined|null/);
    });

    test('a long steady ride: decoupling, efficiency factor, durability for the thresholds reached', () => {
        const el = cards(analyseRide({...base, samples: steady({drift: 0.1}), pauses: []}));
        expect(card(el, 'endurance').textContent).toMatch(/Decoupling/);
        expect(card(el, 'endurance').textContent).toMatch(/Efficiency factor/);
        expect(card(el, 'durability').querySelectorAll('tbody tr')).toHaveLength(1);
        expect(card(el, 'durability').textContent).toMatch(/1,?000 kJ/);
    });

    test('a short ride: no decoupling, no durability card', () => {
        const el = cards(analyseRide({...base, samples: steady({seconds: 1800}), pauses: []}));
        expect(card(el, 'endurance')?.textContent ?? '').not.toMatch(/Decoupling/);
        expect(card(el, 'durability')).toBeNull();
    });

    test('records are marked', () => {
        const summaries = [{id: 'old', day: '2026-11-01', best: {5: 900, 60: 400, 300: 150, 1200: 150, 3600: 150}}];
        const el = cards(analyseRide({...base, samples: steady(), pauses: [], summaries, day: '2026-11-20', id: 'x'}));
        expect(card(el, 'bests').querySelectorAll('.rc-record').length).toBeGreaterThanOrEqual(1);
        expect(card(el, 'bests').textContent).toMatch(/Best ever|Best in 6 weeks/);
    });

    test('no power: only the heart-rate side', () => {
        const el = cards(analyseRide({...base, samples: steady({withPower: false}), pauses: []}));
        expect(card(el, 'wbal')).toBeNull();
        expect(card(el, 'bests')).toBeNull();
        expect(card(el, 'durability')).toBeNull();
        expect(card(el, 'zones').querySelectorAll('.rc-zone')).toHaveLength(5);
        expect(el.textContent).not.toMatch(/NaN|undefined|null/);
    });

    test('the W′bal card says which CP and W′ it used', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        document.body.innerHTML = '<ride-cards></ride-cards>';
        const el = document.querySelector('ride-cards');
        el.data = {analysis: analyseRide({...base, samples, pauses, workout: w, cp: 262, wprime: 23000}), ftp: FTP, wbalSource: 'model'};
        expect(card(el, 'wbal').textContent).toMatch(/CP 262 W and W′ 23\.0 kJ from the rider model/);
        el.data = {analysis: analyseRide({...base, samples, pauses, workout: w}), ftp: FTP, wbalSource: 'settings'};
        expect(card(el, 'wbal').textContent).toMatch(/FTP \(250 W\) as CP and W′ 20\.0 kJ/);
    });
});
