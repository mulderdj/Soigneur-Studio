import { weeklyVolume, weekCompare, powerCurve, ftpEstimates, zoneTotals } from '../../src/training/progress.js';

const best = (b5, b60, b300, b1200, b3600) => ({5: b5, 60: b60, 300: b300, 1200: b1200, 3600: b3600});
const z = (...s) => [...s, ...Array(7 - s.length).fill(0)];
const ride = (day, duration, tss, kj, zones, b, weight = 75) =>
    ({id: day, day, start: 0, duration, tss, kj, zoneSeconds: zones, best: b, weight, ftp: 250, version: 1});

const today = '2026-11-25'; // Wednesday; week starts Monday 2026-11-23
const rides = [
    ride('2026-11-23', 3600, 60, 700,  z(600, 1800, 1200),       best(500, 350, 280, 250, 260)),
    ride('2026-11-25', 1800, 40, 400,  z(0, 0, 600, 1200),       best(600, 400, 300, null, null), 70),
    ride('2026-11-17', 5400, 90, 1100, z(0, 5400),               best(450, 330, 270, 260, 240)),
    ride('2026-11-18', 3600, null, null, z(),                    best(null, null, null, null, null)),
    ride('2026-11-20', 3600, 70, 800,  z(0, 0, 0, 3600),         best(400, 300, 260, 270, 230)),
    ride('2026-09-01', 3600, 100, 1000, z(0, 0, 0, 3600),        best(900, 450, 320, 300, 280)),
    ride('2026-10-30', 3600, 50, 600,  z(0, 0, 3600),            best(null, null, null, null, null)),
];

describe('weekly volume', () => {
    test('per week, oldest first, ending this week', () => {
        expect(weeklyVolume(rides, today, 3)).toEqual([
            {week: '2026-11-09', rides: 0, hours: 0,   tss: 0,   kj: 0},
            {week: '2026-11-16', rides: 3, hours: 3.5, tss: 160, kj: 1900},
            {week: '2026-11-23', rides: 2, hours: 1.5, tss: 100, kj: 1100},
        ]);
    });
    test('this week against the same days of last week', () => {
        expect(weekCompare(rides, today)).toEqual({
            current:  {rides: 2, hours: 1.5, tss: 100, kj: 1100},
            previous: {rides: 2, hours: 2.5, tss: 90,  kj: 1100},
        });
    });
});

describe('power curve', () => {
    test('last 6 weeks against all time, W/kg from the ride the best came from', () => {
        const c = powerCurve(rides, today);
        expect(c.windows).toEqual([5, 60, 300, 1200, 3600]);
        expect(c.recent.watts).toEqual([600, 400, 300, 270, 260]);
        expect(c.recent.wkg[0]).toBeCloseTo(600 / 70);
        expect(c.recent.wkg[3]).toBeCloseTo(270 / 75);
        expect(c.allTime.watts).toEqual([900, 450, 320, 300, 280]);
        expect(c.allTime.wkg[0]).toBeCloseTo(12);
    });
    test('no rides', () => {
        const c = powerCurve([], today);
        expect(c.recent.watts).toEqual([null, null, null, null, null]);
    });
});

describe('FTP estimate', () => {
    test('max of 95 % of best 20 min and best 60 min over the 6 weeks ending each week', () => {
        const f = ftpEstimates(rides, today, 3);
        expect(f.map(x => x.week)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
        expect(f[0].ftp).toBeNull();                 // only a ride without power in its window
        expect(f[1].ftp).toBeCloseTo(0.95 * 270);    // 256.5 > best 60 min 240
        expect(f[2].ftp).toBeCloseTo(260);           // best 60 min 260 > 0.95 × 270
    });
});

describe('time in zones', () => {
    test('per week', () => {
        expect(zoneTotals(rides, today, 'week', 2)).toEqual([
            {period: '2026-11-16', seconds: z(0, 5400, 0, 3600)},
            {period: '2026-11-23', seconds: z(600, 1800, 1800, 1200)},
        ]);
    });
    test('per month', () => {
        expect(zoneTotals(rides, today, 'month', 2)).toEqual([
            {period: '2026-10-01', seconds: z(0, 0, 3600)},
            {period: '2026-11-01', seconds: z(600, 7200, 1800, 4800)},
        ]);
    });
});
