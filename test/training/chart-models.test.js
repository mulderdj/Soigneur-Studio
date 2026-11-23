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
