/**
 * @jest-environment jsdom
 */
import { rideSummary, SUMMARY_VERSION, DURATIONS, bestPowers, decouplingOf, durabilityPowers } from '../../src/training/summary.js';
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

    test('average and max heart rate, for a load without power', () => {
        const samples = [...steady(60, 0), ...Array.from({length: 60}, () => ({power: 0, heartRate: 160, cadence: 90})),
                         ...Array.from({length: 10}, () => ({power: 0, heartRate: 0, cadence: 0}))]; // dropouts don't count
        const s = rideSummary(samples, meta);
        expect(s.avgHr).toBe(150);
        expect(s.maxHr).toBe(160);
        expect(rideSummary(steady(10, 200).map(x => ({...x, heartRate: 0})), meta).avgHr).toBeNull();
    });
});

describe('best power at every duration the rider model uses', () => {
    test('22 durations, 1 s to 2 h (incl. 12 min for the 3+12 CP test); version 4', () => {
        expect(DURATIONS).toEqual([1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 420, 600, 720, 900, 1200, 1800, 2700, 3600, 5400, 7200]);
        expect(SUMMARY_VERSION).toBe(4);
    });
    test('rolling best averages', () => {
        const powers = [...Array(540).fill(200), ...Array(60).fill(400), ...Array(600).fill(150)];
        const b = bestPowers(powers);
        expect(b[60]).toBe(400);
        expect(b[1]).toBe(400);
        expect(b[600]).toBe(220);                 // 540 s at 200 W and the 60 s at 400 W
        expect(b[1200]).toBe(Math.round((540 * 200 + 60 * 400 + 600 * 150) / 1200));
        expect(b[1800]).toBeNull();               // longer than the ride
    });
    test('a ride summary keeps them; no power, no bests', () => {
        const s = rideSummary(Array.from({length: 700}, () => ({power: 250, heartRate: 140, cadence: 90})), {id: 'x', start: Date.UTC(2026, 10, 20), ftp: 250, weight: 75});
        expect(s.best[600]).toBe(250);
        expect(s.best[900]).toBeNull();
        const none = rideSummary(Array.from({length: 700}, () => ({power: 0, heartRate: 140})), {id: 'y', start: Date.UTC(2026, 10, 20), ftp: 250, weight: 75});
        expect(Object.values(none.best).every(v => v === null)).toBe(true);
    });
});

describe('decoupling and durability on ride summaries', () => {
    test('steady 2 h ride with HR drift stores decoupling and 1,000 kJ durability', () => {
        // 7200 s at 200 W = 1,440 kJ; HR drifts linearly from 135 to 149 bpm
        const samples = Array.from({length: 7200}, (_, t) => ({
            power: 200, heartRate: Math.round(135 + 14 * (t / 7200)), cadence: 90,
        }));
        const s = rideSummary(samples, meta);
        expect(s.decoupling).toBeGreaterThan(3.5);
        expect(s.decoupling).toBeLessThan(6.0);
        expect(s.durability).toEqual({1000: {300: 200, 1200: 200}});
    });

    test('short or highly variable rides have null decoupling; short rides have null durability', () => {
        // 40 min steady: under 45 min minimum
        const short = rideSummary(steady(2400, 200), meta);
        expect(short.decoupling).toBeNull();
        expect(short.durability).toBeNull();
        // 60 min intervals (VI > 1.10): no decoupling
        const intervals = Array.from({length: 3600}, (_, t) => ({
            power: t % 300 < 90 ? 380 : 100, heartRate: 155, cadence: 90,
        }));
        expect(rideSummary(intervals, meta).decoupling).toBeNull();
    });

    test('durabilityPowers captures 1,000 and 2,000 kJ thresholds separately', () => {
        // 5000 s at 200 W = 1,000 kJ, then 4000 s at 250 W = +1,000 kJ (2,000 kJ total), then 1500 s at 220 W
        const powers = [...Array(5000).fill(200), ...Array(4000).fill(250), ...Array(1500).fill(220)];
        expect(durabilityPowers(powers)).toEqual({
            1000: {300: 250, 1200: 250},
            2000: {300: 220, 1200: 220},
        });
        expect(decouplingOf(steady(2600, 200))).toBeNull();
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
        expect(fitToSamples(new DataView(new ArrayBuffer(10)))).toEqual({start: null, distance: null, ftp: null, samples: []});
    });
});
