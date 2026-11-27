import { repsChart, recoveryChart, rideCurveChart, powerHrChart, efficiencyChart, decouplingChart, durabilityChart, readinessChart, polarisedChart, complianceChart } from '../../src/views/charts/insight-models.js';

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
    test('recovery: no gaps where efforts were left out; labels keep their numbers', () => {
        const hr = t => (t % 600 < 240 && t >= 600 ? 180 : 140);
        const samples = Array.from({length: 3600}, (_, t) => ({t, power: 200, heartRate: hr(t)}));
        const ivs = [600, 1200, 1800, 2400].map((s, k) => ({start: s, end: s + (k === 1 ? 20 : 240), kind: 'work', stats: {}}));
        const {model} = recoveryChart({samples, analysis: {intervals: ivs}, ftp: 200, pauses: []}, {});
        // side by side, labelled with the efforts' own numbers
        expect(model.x).toEqual([1, 2, 3]);
        expect(model.x.map(model.xFormat)).toEqual(['1', '3', '4']);
        expect(model.xRange).toEqual([0.5, 3.5]);
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
    test('3 zones: stacked to 100 % with intensity classification', () => {
        const {model, readout, classification} = polarisedChart({summaries: [{day: '2026-11-24', zoneSeconds: [1800, 1800, 600, 0, 0, 600, 0]}], today: '2026-11-25'}, {});
        const i = model.x.length - 1;
        expect(model.series.map(s => s.values[i])).toEqual([100, 87.5, 75]);
        expect(readout(i).rows.map(r => r.value)).toEqual(['75 %', '13 %', '13 %']);
        expect(classification).toMatchObject({enough: true, pattern: 'polarised', label: 'Polarised'});
    });
    test('decoupling: 5 % reference line, ride points, 28-day rolling mean and readout', () => {
        const summaries = [
            {id: '1', day: '2026-11-01', sport: 'cycling', name: 'Endurance', duration: 5400, np: 200, avgPower: 195, decoupling: 6.2},
            {id: '2', day: '2026-11-10', sport: 'cycling', name: 'Long ride', duration: 7200, np: 200, avgPower: 195, decoupling: 3.4},
        ];
        const {model, readout} = decouplingChart({summaries, today: '2026-11-15'}, {});
        expect(model.series.map(s => s.label)).toEqual(['5 % threshold', 'Ride', '28 days']);
        expect(model.x).toHaveLength(2);
        expect(readout(1).rows.map(r => r.value)).toEqual(['3.4 %', '4.8 %']);
        expect(readout(1).more[0]).toMatch(/Under 5 %/);
        expect(decouplingChart({summaries: []}, {}).model.x).toEqual([]);
    });
    test('durability: active kJ thresholds as % of 90-day fresh best, empty when no ride reaches 1,000 kJ', () => {
        const summaries = [
            {id: 'a', day: '2026-11-02', sport: 'cycling', name: 'VO2', best: {300: 320, 1200: 280}, durability: null},
            {id: 'b', day: '2026-11-24', sport: 'cycling', name: 'Long ride', best: {300: 300, 1200: 260},
             durability: {1000: {300: 288, 1200: 252}, 2000: {300: 256, 1200: null}}},
        ];
        const out5 = durabilityChart({summaries, today: '2026-11-25'}, 300, {});
        expect(out5.thresholds).toEqual([1000, 2000]);
        expect(out5.model.series.map(s => s.label)).toEqual(['After 1,000 kJ', 'After 2,000 kJ']);
        const last = out5.model.x.length - 1;
        expect(out5.readout(last).rows.map(r => r.value)).toEqual(['90 %', '80 %']);
        expect(out5.readout(last).rows[0].note).toContain('288 W of 320 W fresh');
        expect(out5.readout(last).day).toBe('2026-11-24');

        const out20 = durabilityChart({summaries, today: '2026-11-25'}, 1200, {});
        expect(out20.thresholds).toEqual([1000]);
        expect(durabilityChart({summaries: [], today: '2026-11-25'}, 300, {}).model.x).toEqual([]);
    });
    test('compliance: workouts mode, load % mode, readouts, and empty state', () => {
        const w = (power = 0.8, duration = 3600) => ({intervals: [{duration, steps: [{duration, power}]}]});
        const plan = [
            {id: 'p1', day: '2026-11-23', workout: w(0.8, 3600), rideId: 'r1', deleted: false},
            {id: 'p2', day: '2026-11-24', workout: w(0.8, 3600), rideId: null, deleted: false},
            {id: 'p3', day: '2026-11-27', workout: w(0.8, 3600), rideId: null, deleted: false},
        ];
        const summaries = [{id: 'r1', day: '2026-11-23', duration: 3600, tss: 64}];

        const outW = complianceChart({plan, summaries, today: '2026-11-25', ftp: 250}, 'workouts', {good: 'g', warn: 'w', accent: 'a', muted: 'm'});
        expect(outW.model.series.map(s => s.label)).toEqual(['Missed', 'Completed']);
        const last = outW.model.x.length - 1;
        expect(outW.model.series[0].values[last]).toBe(2); // due = done + missed
        expect(outW.model.series[1].values[last]).toBe(1); // done
        const rw = outW.readout(last);
        expect(rw.rows.map(r => [r.label, r.value])).toEqual([
            ['Completed', '1 of 2'], ['Missed', '1'], ['Upcoming', '1'], ['Load', '50 %'], ['Duration', '50 %'],
        ]);
        expect(rw.rows[0].note).toBe('50 %');
        expect(outW.readout(0).more).toEqual(['No workouts planned this week']);

        const outL = complianceChart({plan, summaries, today: '2026-11-25', ftp: 250}, 'load', {good: 'g', warn: 'w', accent: 'a', muted: 'm'});
        expect(outL.model.series.map(s => s.label)).toEqual(['Target (100 %)', 'Load adherence', 'Duration adherence']);
        expect(outL.model.series[1].values[last]).toBe(50);
        expect(outL.model.series[2].values[last]).toBe(50);
        expect(outL.readout(last).rows.find(r => r.label === 'Load').value).toBe('50 %');

        expect(complianceChart({plan: [], summaries: [], today: '2026-11-25'}, 'workouts', {}).model.x).toEqual([]);
    });
});
