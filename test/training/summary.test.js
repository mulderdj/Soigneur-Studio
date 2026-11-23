/**
 * @jest-environment jsdom
 */
import { rideSummary, SUMMARY_VERSION } from '../../src/training/summary.js';
import { fitToSamples } from '../../src/training/fit-records.js';
import { localDay } from '../../src/training/dates.js';
import { fit } from '../../src/fit/fit.js';

const start = new Date(2026, 10, 20, 18, 0).getTime();
const meta = {id: 'r1', start, name: 'Sweet spot', workoutId: 'w1', ftp: 250, weight: 75, distance: 30000};
const steady = (n, power) => Array.from({length: n}, () => ({power, heartRate: 140, cadence: 90}));

describe('ride summary', () => {
    test('an hour at FTP', () => {
        const s = rideSummary(steady(3600, 250), meta);
        expect(s.version).toBe(SUMMARY_VERSION);
        expect(s.id).toBe('r1');
        expect(s.day).toBe(localDay(start));
        expect(s.duration).toBe(3600);
        expect(s.tss).toBeCloseTo(100, 0);
        expect(s.if).toBeCloseTo(1, 2);
        expect(s.np).toBeCloseTo(250, 0);
        expect(s.avgPower).toBeCloseTo(250);
        expect(s.kj).toBeCloseTo(900);
        expect(s.zoneSeconds).toHaveLength(7);
        expect(s.zoneSeconds[4]).toBe(3600);
        expect(s.best[3600]).toBe(250);
        expect(s.ftp).toBe(250);
        expect(s.weight).toBe(75);
        expect(s.distance).toBe(30000);
        expect(s.workoutId).toBe('w1');
    });

    test('short ride has no long bests', () => {
        const s = rideSummary(steady(30, 300), meta);
        expect(s.best[5]).toBe(300);
        expect(s.best[60]).toBeNull();
    });

    test('no power: duration only', () => {
        const s = rideSummary(steady(3600, 0), meta);
        expect(s.duration).toBe(3600);
        for(const k of ['tss', 'if', 'np', 'avgPower', 'kj']) expect(s[k]).toBeNull();
    });
});

describe('.fit back to samples', () => {
    test('round trip of a ride the app recorded', () => {
        const records = Array.from({length: 120}, (_, i) => ({
            timestamp: start + i * 1000, power: 200 + (i % 10), cadence: 90, speed: 9, heart_rate: 130, distance: i * 9,
        }));
        const view = fit.localActivity.encode({records, laps: [], events: [], ftp: 250});
        const out = fitToSamples(view);
        expect(out.samples).toHaveLength(120);
        expect(out.samples.map(s => s.power)).toEqual(records.map(r => r.power));
        expect(out.samples[5].heartRate).toBe(130);
        expect(Math.abs(out.start - start)).toBeLessThan(1000);
    });

    test('a file that can\'t be read', () => {
        expect(fitToSamples(new DataView(new ArrayBuffer(10)))).toEqual({start: null, distance: null, samples: []});
    });
});
