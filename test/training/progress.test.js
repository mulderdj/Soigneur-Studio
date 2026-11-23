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

describe('other sports', () => {
    const run = {...ride('2026-11-24', 7200, 80, 900, z(0, 7200), best(1200, 800, 600, 500, 450)), id: 'run', sport: 'run'};
    const withRun = [...rides, run];

    test('a 2 h run adds to weekly hours and TSS', () => {
        const week = weeklyVolume(withRun, today, 1)[0];
        const without = weeklyVolume(rides, today, 1)[0];
        expect(week.hours).toBeCloseTo(without.hours + 2);
        expect(week.tss).toBe(without.tss + 80);
        expect(weekCompare(withRun, today).current.tss).toBe(weekCompare(rides, today).current.tss + 80);
    });

    test('but not to zones, power curve or FTP estimates', () => {
        expect(zoneTotals(withRun, today, 'week', 1)).toEqual(zoneTotals(rides, today, 'week', 1));
        expect(powerCurve(withRun, today)).toEqual(powerCurve(rides, today));
        expect(ftpEstimates(withRun, today, 2)).toEqual(ftpEstimates(rides, today, 2));
    });
});

describe('where the numbers come from (chart read-outs)', () => {
    const r = (id, day, b, weight = 75, name = id) => ({id, day, name, start: 0, duration: 3600, tss: 50, kj: 500, zoneSeconds: z(), best: b, weight, ftp: 250, version: 1});

    test('each best names the ride and day that set it; an equal best keeps the earlier ride', () => {
        const list = [
            r('a', '2026-11-02', best(500, 350, 280, 260, 240), 75, 'Sweet spot'),
            r('b', '2026-11-10', best(520, 350, 270, 268, 230), 75, 'Threshold'),
        ];
        const c = powerCurve(list, today);
        expect(c.allTime.from[3]).toEqual({id: 'b', day: '2026-11-10', name: 'Threshold'});   // 20 min
        expect(c.allTime.from[1]).toEqual({id: 'a', day: '2026-11-02', name: 'Sweet spot'});  // 1 min, equal: earlier
        expect(c.recent.from[0].id).toBe('b');
    });

    test('W/kg is null when the ride has no weight', () => {
        const c = powerCurve([r('a', '2026-11-20', best(500, 350, 280, 260, 240), null)], today);
        expect(c.allTime.watts[3]).toBe(260);
        expect(c.allTime.wkg[3]).toBeNull();
    });

    test('an FTP estimate says which effort decided it', () => {
        const est = ftpEstimates([r('a', '2026-11-18', best(500, 350, 280, 268, 240), 75, 'Sweet spot')], today, 1)[0];
        expect(est.ftp).toBeCloseTo(254.6, 1);
        expect(est.factor).toBe(0.95);
        expect(est.from).toEqual({seconds: 1200, watts: 268, day: '2026-11-18', name: 'Sweet spot', id: 'a'});
        const long = ftpEstimates([r('b', '2026-11-19', best(500, 350, 280, 262, 255), 75, 'Long')], today, 1)[0];
        expect(long.ftp).toBe(255);
        expect(long.factor).toBe(1);
        expect(long.from).toMatchObject({seconds: 3600, watts: 255, day: '2026-11-19'});
        const none = ftpEstimates([], today, 1)[0];
        expect([none.ftp, none.from, none.factor]).toEqual([null, null, null]);
    });

    test('a year of weekly volume', () => {
        expect(weeklyVolume(rides, today, 52)).toHaveLength(52);
    });
});
