/**
 * @jest-environment jsdom
 */
import './browser-stubs.js';
import { formChart, healthChart } from '../../src/views/training/chart-models.js';
import { rangeWindow } from '../../src/views/training/uplot-chart.js';

const DAY = 86400;
const ride = (day, tss) => ({id: day, day, name: `Ride ${day}`, start: Date.parse(day), duration: 3600, tss});
const colors = {accent: '#4C9AFF', hr: '#FF5C7A', warn: '#F8C73A', band: 'rgba(0,0,0,.1)'};
const entry = (day, name, power = 0.9) => ({id: day + name, day, deleted: false, rideId: null,
    workout: {id: name, meta: {name}, intervals: [{duration: 3600, steps: [{duration: 3600, power}]}]}});

describe('form chart', () => {
    const data = {today: '2026-11-23', ftp: 250, summaries: [ride('2026-11-20', 80), ride('2026-11-22', 0)],
                  plan: [entry('2026-11-25', 'Sweet spot'), entry('2026-11-25', 'Spin', 0.5)]};

    test('opens on 3 months with the forecast; ranges, zoom and the shared cursor', () => {
        const {model} = formChart(data, colors);
        expect(model.defaultRange).toBe('3m');
        expect(model.ranges.map(r => r[0])).toEqual(['3m', '1y', 'all']);
        expect(model.zoom).toBe(true);
        expect(model.sync).toBe('days');
        expect(model.marks).toEqual({zero: true, today: Date.parse('2026-11-23T12:00:00Z') / 1000});
        expect(model.series.map(s => s.label)).toEqual(['Fitness', 'Fatigue', 'Form', 'Fitness (plan)', 'Fatigue (plan)', 'Form (plan)']);
        expect(model.series.slice(3).every(s => s.dash)).toBe(true);
    });

    test('a past day: the three numbers and that day\'s load', () => {
        const {model, readout} = formChart(data, colors);
        const i = model.x.indexOf(Date.parse('2026-11-20T12:00:00Z') / 1000);
        const r = readout(i);
        expect(r.title).toMatch(/20/);
        expect(r.title).not.toMatch(/forecast/);
        expect(r.rows.map(x => x.label)).toEqual(['Fitness', 'Fatigue', 'Form']);
        expect(r.rows[2].note).toMatch(/fresh|neutral|building|tired|transition|optimal/i);
        expect(r.more).toEqual(['Load that day: 80 TSS']);
        expect(r.day).toBe('2026-11-20');
    });

    test('a day without rides says nothing about load', () => {
        const {model, readout} = formChart(data, colors);
        expect(readout(model.x.indexOf(Date.parse('2026-11-21T12:00:00Z') / 1000)).more).toEqual([]);
    });

    test('a forecast day lists the planned workouts', () => {
        const {model, readout} = formChart(data, colors);
        const r = readout(model.x.indexOf(Date.parse('2026-11-25T12:00:00Z') / 1000));
        expect(r.title).toMatch(/forecast/);
        expect(r.more).toEqual(['Planned: Sweet spot · 81 TSS', 'Planned: Spin · 25 TSS']);
        expect(r.day).toBe('2026-11-25');
    });

    test('no rides yet: still a chart (zeros), and its range is never empty', () => {
        const {model, readout} = formChart({today: '2026-11-23', summaries: [], plan: []}, colors);
        expect(model.x.length).toBeGreaterThan(1);
        expect(readout(0).rows.every(r => !/NaN|undefined/.test(r.value))).toBe(true);
        const [a, b] = rangeWindow(model.x, model.defaultRange, model.marks.today);
        expect(b - a).toBeGreaterThanOrEqual(DAY);
    });
});

describe('health chart', () => {
    const night = (day, extra) => ({day, hrv: 50, restingHr: 52, ...extra});
    const many = Array.from({length: 20}, (_, i) => night(new Date(Date.UTC(2026, 9, 20 + i)).toISOString().slice(0, 10), {hrv: i % 2 ? 50 : 60}));

    test('HRV with its band per night, resting heart rate; 3 months, shared cursor', () => {
        const data = {today: '2026-11-23', wellness: [...many, night('2026-11-10', {hrv: 40})]};
        const {model} = healthChart(data, colors);
        expect(model.defaultRange).toBe('3m');
        expect(model.ranges.map(r => r[0])).toEqual(['1m', '3m', 'all']);
        expect(model.sync).toBe('days');
        expect(model.series.map(s => s.label)).toEqual(['Range high', 'Range low', 'HRV', 'Resting HR']);
        expect(model.bands).toEqual([[1, 2, colors.band]]);
    });

    test('a night with Garmin\'s baseline, one below its own range, one without a range', () => {
        const data = {today: '2026-11-23', wellness: [
            ...many,
            night('2026-11-09', {hrv: 40}),                                          // own range 50–60: below
            night('2026-11-20', {hrv: 44, hrvBaseline: {low: 38, high: 52}, sleepSeconds: 25020, sleepScore: 82, bodyBattery: 90}),
            night('2025-01-05', {hrv: 55}),                                          // nothing before it
        ]};
        const {model, readout} = healthChart(data, colors);
        const at = d => readout(model.x.indexOf(Date.parse(`${d}T12:00:00Z`) / 1000));
        const g = at('2026-11-20');
        expect(g.rows[0]).toMatchObject({label: 'HRV', value: '44 ms', note: 'in your range (38–52)'});
        expect(g.rows.map(r => r.label)).toEqual(['HRV', 'Resting HR', 'Sleep', 'Body Battery']);
        expect(g.rows[2]).toMatchObject({value: '6:57', note: 'score 82'});
        expect(at('2026-11-09').rows[0].note).toBe('below your range (50–60)');
        expect(at('2025-01-05').rows[0].note).toBe('no range yet');
        expect(g.day).toBe('2026-11-20');
    });

    test('one night: a usable range', () => {
        const {model} = healthChart({today: '2026-11-23', wellness: [night('2026-11-22')]}, colors);
        const [a, b] = rangeWindow(model.x, 'all', model.today);
        expect(b - a).toBeGreaterThanOrEqual(DAY);
    });
});

describe('weekly volume and time in zones', () => {
    const { volumeChart, zonesChart } = require('../../src/views/training/chart-models.js');
    const r = (day, hours, tss, kj, zones) => ({id: day, day, name: day, start: Date.parse(day), duration: hours * 3600, tss, kj, zoneSeconds: zones});
    const data = {today: '2026-11-25', summaries: [
        r('2026-11-23', 1, 60, 700, [600, 1800, 1200, 0, 0, 0, 0]),
        r('2026-11-25', 1.5, 40, 400, [0, 0, 3600, 1800, 0, 0, 0]),
        r('2026-11-10', 2, 90, 1100, [0, 7200, 0, 0, 0, 0, 0]),
    ]};

    test('volume: bars of the chosen metric over 52 weeks, opening on 12', () => {
        const {model} = volumeChart(data, 'hours', {accent: '#00f'});
        expect(model.x).toHaveLength(52);
        expect(model.series).toHaveLength(1);
        expect(model.series[0].kind).toBe('bars');
        expect(model.series[0].values.at(-1)).toBeCloseTo(2.5);
        expect(model.ranges.map(x => x[0])).toEqual(['12w', '1y']);
        expect(model.defaultRange).toBe('12w');
        expect(volumeChart(data, 'tss', {}).model.series[0].values.at(-1)).toBe(100);
    });

    test('volume read-out: the week, hours, TSS, kJ and rides; no day to open', () => {
        const {model, readout} = volumeChart(data, 'hours', {});
        const o = readout(model.x.length - 1);
        expect(o.title).toMatch(/23/);
        expect(o.title).toMatch(/29/);
        expect(o.rows.map(x => [x.label, x.value])).toEqual([['Hours', '2:30'], ['TSS', '100'], ['kJ', '1100'], ['Rides', '2']]);
        expect(o.day).toBeUndefined();
    });

    test('zones: stacked per week, 52 weeks or 12 months', () => {
        const {model} = zonesChart(data, 'week', {zones: ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7']});
        expect(model.x).toHaveLength(52);
        expect(model.series).toHaveLength(7);
        // stacked: the top series holds the total of the week (hours), the bottom one zone 1
        expect(model.series[0].values.at(-1)).toBeCloseTo(2.5);
        expect(model.series[6].values.at(-1)).toBeCloseTo(600 / 3600);
        expect(model.ranges.map(x => x[0])).toEqual(['12w', '52w']);
        expect(zonesChart(data, 'month', {zones: []}).model.x).toHaveLength(12);
        expect(zonesChart(data, 'month', {zones: []}).model.ranges ?? []).toEqual([]);
    });

    test('zones read-out: only zones with time, then the total', () => {
        const {model, readout} = zonesChart(data, 'week', {zones: ['a', 'b', 'c', 'd', 'e', 'f', 'g']});
        const o = readout(model.x.length - 1);
        expect(o.rows.map(x => [x.label, x.value])).toEqual([
            ['Recovery', '0:10'], ['Endurance', '0:30'], ['Tempo', '1:20'], ['Sweet Spot', '0:30'], ['Total', '2:30'],
        ]);
        expect(o.rows[0].color).toBe('a');
        expect(o.day).toBeUndefined();
    });
});

describe('period titles', () => {
    const { weekTitle } = require('../../src/views/training/chart-models.js');
    test('a week inside one month, and one across two months', () => {
        expect(weekTitle('2026-11-23', 'en-GB')).toMatch(/^23\s?–\s?29 Nov 2026$/);
        expect(weekTitle('2026-10-26', 'en-GB')).toMatch(/^26 Oct\s?–\s?1 Nov 2026$/);
        expect(weekTitle('2026-12-28', 'en-GB')).toMatch(/^28 Dec 2026\s?–\s?3 Jan 2027$/);
    });
});

describe('power curve and FTP trend', () => {
    const { curveChart, ftpChart } = require('../../src/views/training/chart-models.js');
    const best = (b5, b60, b300, b1200, b3600) => ({5: b5, 60: b60, 300: b300, 1200: b1200, 3600: b3600});
    const r = (id, day, b, weight, name) => ({id, day, name, start: Date.parse(day), duration: 3600, tss: 60, kj: 600, zoneSeconds: Array(7).fill(0), best: b, weight, ftp: 250});
    const data = {today: '2026-11-25', ftp: 250, summaries: [
        r('old', '2026-09-12', best(900, 450, 320, 285, 280), 75, 'Long ride'),
        r('new', '2026-11-04', best(600, 400, 300, 268, 240), 75, 'Sweet spot'),
        r('noweight', '2026-11-20', best(500, 350, 280, 250, 230), null, 'No scale'),
    ]};

    test('a line per period with points, over 5 s to 60 min on a log axis', () => {
        const {model} = curveChart(data, 'w', {accent: 'a', muted: 'm'});
        expect(model.x).toEqual([5, 60, 300, 1200, 3600]);
        expect(model.log).toBe(true);
        expect(model.time).toBe(false);
        expect(model.series.map(s => [s.label, s.color, s.points])).toEqual([['Last 6 weeks', 'a', true], ['All time', 'm', true]]);
        expect(model.series[1].values).toEqual([900, 450, 320, 285, 280]);
        expect(model.xFormat(1200)).toBe('20 min');
    });

    test('the read-out names each record\'s ride and day; a click opens the recent record', () => {
        const {readout} = curveChart(data, 'w', {});
        const o = readout(3);
        expect(o.title).toBe('20 min');
        expect(o.rows.map(x => [x.label, x.value])).toEqual([['Last 6 weeks', '268 W'], ['All time', '285 W']]);
        expect(o.rows[0].note).toMatch(/Sweet spot/);
        expect(o.rows[0].note).toMatch(/4/);
        expect(o.rows[1].note).toMatch(/Long ride/);
        expect(o.day).toBe('2026-11-04');
    });

    test('the x axis: ticks at round durations within the data, never "null"', () => {
        const {model} = curveChart(data, 'w', {});
        expect(model.xTicks).toEqual([5, 15, 60, 300, 1200, 3600]);
        expect(model.xFormat(null)).toBe('');
        expect(model.xFormat(undefined)).toBe('');
    });

    test('the rider model\'s curve over it, 2–20 min, dashed, in the read-out', () => {
        const withFit = {...data, summaries: data.summaries.map(x => ({...x, best: {...x.best, 120: 420, 600: 300}}))};
        const {model, readout} = curveChart(withFit, 'w', {accent: 'a', muted: 'm', model: 'g'}, {ok: true, cp: 260, wprime: 20000});
        const m = model.series.find(x => x.label === 'Model (CP 260 W, W′ 20.0 kJ)');
        expect(m.dash).toBeTruthy();
        const at = sec => m.values[model.x.indexOf(sec)];
        expect(at(120)).toBe(Math.round(260 + 20000 / 120));
        expect(at(1200)).toBe(Math.round(260 + 20000 / 1200));
        expect(at(5)).toBeNull();
        expect(at(3600)).toBeNull();
        expect(readout(model.x.indexOf(600)).rows.map(r => r.label)).toContain('Model');
    });

    test('W/kg: "–" where the ride has no weight', () => {
        const only = {today: '2026-11-25', summaries: [r('noweight', '2026-11-20', best(500, 350, 280, 250, 230), null, 'No scale')]};
        const {model, readout} = curveChart(only, 'wkg', {});
        expect(model.series[0].values[3]).toBeNull();
        expect(readout(3).rows[0].value).toBe('–');
    });

    test('FTP: the estimate per week with where it came from, the set FTP dashed', () => {
        const {model, readout} = ftpChart(data, {accent: 'a', muted: 'm'});
        expect(model.x).toHaveLength(52);
        expect(model.ranges.map(x => x[0])).toEqual(['12w', '1y']);
        expect(model.series.map(s => s.label)).toEqual(['Set FTP', 'Estimate']);
        expect(model.series[0].dash).toBeTruthy();
        const o = readout(model.x.length - 1);
        expect(o.rows.map(x => [x.label, x.value])).toEqual([['Estimate', '255 W'], ['Set', '250 W']]);
        expect(o.more[0]).toMatch(/^95 % of 268 W over 20 min · /);
        expect(o.day).toBe('2026-11-04');
    });

    test('a week without an effort says so and has nothing to open', () => {
        const {readout} = ftpChart(data, {});
        const o = readout(0);
        expect(o.rows[0]).toMatchObject({label: 'Estimate', value: '–'});
        expect(o.more).toEqual(['No 20 or 60-minute effort in the 6 weeks before']);
        expect(o.day).toBeUndefined();
    });

    test('power curve comparison modes (90d vs all time, prior season) and delta readout', () => {
        const withPrior = {
            ...data,
            summaries: [
                ...data.summaries,
                r('prior', '2025-08-15', best(800, 410, 290, 260, 240), 75, 'Last year'),
            ],
        };
        const cAll = curveChart(withPrior, 'w', {}, null, 'all');
        expect(cAll.readout(3).more[0]).toMatch(/Last 6 weeks vs all time: −17 W \(−6\.0 %\)/);

        const c90 = curveChart(withPrior, 'w', {}, null, '90d');
        expect(c90.model.series.map(s => s.label)).toEqual(['Last 90 days', 'All time']);
        expect(c90.readout(3).more[0]).toBe('Last 90 days vs all time: Matches best (100 %)');

        const cPrior = curveChart(withPrior, 'w', {}, null, 'prior');
        expect(cPrior.model.series.map(s => s.label)).toEqual(['Last 90 days', 'Prior season']);
        expect(cPrior.readout(3).rows.map(x => [x.label, x.value])).toEqual([['Last 90 days', '285 W'], ['Prior season', '260 W']]);
        expect(cPrior.readout(3).more[0]).toMatch(/Last 90 days vs prior season: \+25 W \(\+9\.6 %\)/);

        const cPriorWkg = curveChart(withPrior, 'wkg', {}, null, 'prior');
        expect(cPriorWkg.readout(3).more[0]).toMatch(/\+0\.33 W\/kg/);
    });
});

describe('CP and W′ trend chart', () => {
    const { cpTrendChart } = require('../../src/views/training/chart-models.js');
    const trend = [
        {week: '2026-11-02', end: '2026-11-08', cp: null, wprime: null, r2: null},
        {week: '2026-11-09', end: '2026-11-15', cp: 260, wprime: 19500, r2: 0.994},
        {week: '2026-11-16', end: '2026-11-22', cp: 268, wprime: 21000, r2: 0.996},
    ];

    test('plots CP on y and W′ (kJ) on y2 with 12w/24w ranges and readouts', () => {
        const {model, readout} = cpTrendChart({today: '2026-11-22', trend}, {accent: 'a', good: 'g'});
        expect(model.x).toHaveLength(3);
        expect(model.ranges.map(r => r[0])).toEqual(['12w', '24w']);
        expect(model.defaultRange).toBe('12w');
        expect(model.series.map(s => [s.label, s.scale ?? 'y'])).toEqual([['CP', 'y'], ['W′', 'y2']]);
        expect(model.series[0].values).toEqual([null, 260, 268]);
        expect(model.series[1].values).toEqual([null, 19.5, 21]);
        expect(model.yFormat(268)).toBe('268 W');
        expect(model.y2Format(21)).toBe('21.0 kJ');

        const o = readout(2);
        expect(o.rows.map(x => [x.label, x.value])).toEqual([['CP', '268 W'], ['W′', '21.0 kJ'], ['Fit', 'R² 0.996']]);
        expect(o.more).toEqual(['Rolling 90-day fit']);

        const empty = readout(0);
        expect(empty.rows.map(x => [x.label, x.value])).toEqual([['CP', '–'], ['W′', '–']]);
        expect(empty.more[0]).toMatch(/Not enough 2–20 min efforts/);
    });

    test('returns an empty model when no week can be fitted', () => {
        const {model} = cpTrendChart({today: '2026-11-22', summaries: []}, {});
        expect(model.x).toEqual([]);
        expect(model.series).toEqual([]);
    });
});
