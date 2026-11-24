/**
 * @jest-environment jsdom
 */
import { analyseRide } from '../../src/analysis/ride.js';
import '../../src/views/analysis/interval-table.js';
const { FTP, workout, rideOf, steady } = require('./fixtures.js');

const base = {ftp: FTP, wprime: 20000, lthr: 170, summaries: []};
function table(analysis) {
    document.body.innerHTML = '<interval-table></interval-table>';
    const el = document.querySelector('interval-table');
    el.data = {analysis, ftp: FTP};
    return el;
}

describe('the intervals table', () => {
    test('a row per interval, the work reps marked, numbers in place', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        const el = table(analyseRide({...base, samples, pauses, workout: w}));
        const rows = el.querySelectorAll('[data-iv]');
        expect(rows).toHaveLength(12);
        expect(el.querySelectorAll('.it-row.is-work')).toHaveLength(5);
        expect(el.querySelector('.it-row.is-work').textContent).toMatch(/Rep 1/);
        expect(el.querySelector('.it-row.is-work').textContent).toMatch(/27\d/);       // ~275 W
        expect(el.textContent).not.toMatch(/NaN|undefined|null/);
    });

    test('planned against actual: target, difference and status only for a workout', () => {
        const w = workout(), {samples, pauses} = rideOf(w, {stopAt: 1560 + 90});
        const el = table(analyseRide({...base, samples, pauses, workout: w}));
        expect(el.querySelector('thead').textContent).toMatch(/Target/);
        expect(el.textContent).toMatch(/Cut short/);
        expect(el.textContent).toMatch(/Skipped/);
        const detected = table(analyseRide({...base, samples: rideOf(workout()).samples, pauses: []}));
        expect(detected.querySelector('thead').textContent).not.toMatch(/Target/);
        expect(detected.querySelector('.it-source').textContent).toMatch(/found from your power/i);
    });

    test('a row\'s button asks the chart to zoom to it', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        const el = table(analyseRide({...base, samples, pauses, workout: w}));
        const zooms = [];
        el.addEventListener('interval-zoom', e => zooms.push(e.detail));
        el.querySelector('.it-row.is-work [data-zoom]').click();
        expect(zooms).toEqual([{start: 300, end: 540}]);
    });

    test('no intervals: says so', () => {
        const el = table(analyseRide({...base, samples: steady({seconds: 3600, power: 150}), pauses: []}));
        expect(el.textContent).toMatch(/No intervals/);
    });

    test('times as m:ss, and a change that rounds to nothing is ±0, not −0', () => {
        const w = workout(), {samples, pauses} = rideOf(w);
        const el = table(analyseRide({...base, samples, pauses, workout: w}));
        expect(el.querySelector('.it-row.is-work [data-l="Time"]').textContent).toBe('4:00');
        expect(el.textContent).not.toMatch(/[−-]0 %/);
    });

    test('no power and no laps: says there is no power to find efforts from', () => {
        const el = table(analyseRide({...base, samples: steady({withPower: false}), pauses: []}));
        expect(el.textContent).toMatch(/no power/i);
        expect(el.textContent).not.toMatch(/88 %/);
    });
});
