import { repsChart, recoveryChart, rideCurveChart, powerHrChart, efficiencyChart, readinessChart, polarisedChart } from '../../src/views/charts/insight-models.js';

const iv = (start, end, kind, stats = {}) => ({start, end, kind, stats});
const work = (n, start, p, hr) => iv(start, start + 240, 'work', {avgPower: p, avgTarget: 200, avgHr: hr, maxHr: hr + 8});

describe('ride charts', () => {
    test('rep by rep: power bars, target, heart rate on the right; the read-out', () => {
        const analysis = {intervals: [work(1, 600, 202, 175), iv(840, 960, 'rest'), work(2, 960, 203, 186)]};
        const {model, readout} = repsChart({analysis, ftp: 200}, {accent: 'a', muted: 'm', hr: 'h'});
        expect(model.x).toEqual([1, 2]);
        expect(model.series.map(s => [s.label, s.kind ?? 'line', s.scale ?? 'y'])).toEqual([
            ['Power', 'bars', 'y'], ['Target', 'line', 'y'], ['Heart rate', 'line', 'y2'], ['Max heart rate', 'line', 'y2']]);
        expect(readout(1).rows.map(r => r.value)).toEqual(['203 W', '200 W', '186 bpm']);
    });
    test('fewer than 2 efforts, or no efforts: nothing (the card is left out)', () => {
        expect(repsChart({analysis: {intervals: [work(1, 600, 202, 175)]}, ftp: 200}).model.x).toEqual([]);
        expect(recoveryChart({samples: [], analysis: {intervals: []}, ftp: 200}).model.x).toEqual([]);
        expect(powerHrChart({samples: [], pauses: []}).model.x).toEqual([]);
    });
    test('recovery: the x range reaches the last effort\'s number, also when one was skipped', () => {
        const hr = t => (t % 600 < 240 && t >= 600 ? 180 : 140);
        const samples = Array.from({length: 3600}, (_, t) => ({t, power: 200, heartRate: hr(t)}));
        const ivs = [600, 1200, 1800, 2400].map((s, k) => ({start: s, end: s + (k === 1 ? 20 : 240), kind: 'work', stats: {}}));
        const {model} = recoveryChart({samples, analysis: {intervals: ivs}, ftp: 200, pauses: []}, {});
        expect(model.x).toEqual([1, 3, 4]);
        expect(model.xRange).toEqual([0.5, 4.5]);
    });
    test('power curve: this ride against the 90 days before it (other rides only)', () => {
        const samples = Array.from({length: 900}, (_, t) => ({t, power: t < 300 ? 300 : 200}));
        const summaries = [
            {id: 'old', day: '2026-11-01', sport: 'cycling', best: {300: 330, 60: 400}},
            {id: 'me', day: '2026-11-20', sport: 'cycling', best: {300: 999}},
        ];
        const {model, readout} = rideCurveChart({samples, summaries, today: '2026-11-20', id: 'me'}, {});
        const i = model.x.indexOf(300);
        expect(model.series[1].values[i]).toBe(300);
        expect(model.series[0].values[i]).toBe(330);          // not the ride itself (999)
        expect(readout(i).rows[0].note).toBe('91 % of your 90-day best');
    });
    test('power and heart rate: points sorted by power, two halves', () => {
        const samples = Array.from({length: 1800}, (_, t) => ({t, power: 150 + (t % 600 < 300 ? 0 : 50), heartRate: 130 + (t > 900 ? 5 : 0)}));
        const {model} = powerHrChart({samples, pauses: []}, {});
        expect(model.series.map(s => s.kind)).toEqual(['points', 'points']);
        expect([...model.x].sort((a, b) => a - b)).toEqual(model.x);
    });
});

describe('trend charts', () => {
    test('efficiency: points and the rolling mean', () => {
        const summaries = [1, 5, 9].map(d => ({id: `${d}`, day: `2026-11-0${d}`, sport: 'cycling', np: 200 + d, avgHr: 140, duration: 3600, if: 0.7}));
        const {model} = efficiencyChart({summaries}, {});
        expect(model.series.map(s => s.label)).toEqual(['Ride', '28 days']);
        expect(model.x).toHaveLength(3);
    });
    test('readiness: no data gives an empty chart and the counts', () => {
        const out = readinessChart({summaries: [], wellness: []}, 'hrv', {});
        expect(out.model.x).toEqual([]);
        expect(out.stats).toMatchObject({n: 0, enough: false});
    });
    test('3 zones: stacked to 100 %', () => {
        const {model, readout} = polarisedChart({summaries: [{day: '2026-11-24', zoneSeconds: [1800, 1800, 600, 0, 0, 600, 0]}], today: '2026-11-25'}, {});
        const i = model.x.length - 1;
        expect(model.series.map(s => s.values[i])).toEqual([100, 87.5, 75]);
        expect(readout(i).rows.map(r => r.value)).toEqual(['75 %', '13 %', '13 %']);
    });
});
