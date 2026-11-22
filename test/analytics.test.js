import { SessionStats, zoneIndex } from '../src/analytics.js';

function ride(stats, seconds, sample) {
    for(let i = 0; i < seconds; i++) stats.push(typeof sample === 'function' ? sample(i) : sample);
}

describe('SessionStats', () => {
    test('steady power: NP equals average, IF and TSS match definition', () => {
        const s = new SessionStats({ftp: 250, weight: 70});
        ride(s, 3600, {power: 250, heartRate: 150, cadence: 90});
        const r = s.summary();
        expect(r.avgPower).toBeCloseTo(250);
        expect(r.np).toBeCloseTo(250);
        expect(r.intensity).toBeCloseTo(1.0);
        expect(r.tss).toBeCloseTo(100, 0);
        expect(r.vi).toBeCloseTo(1.0);
        expect(r.kj).toBeCloseTo(900);
        expect(r.wkg).toBeCloseTo(250 / 70);
        expect(r.ef).toBeCloseTo(250 / 150);
        expect(r.decoupling).toBeCloseTo(0);
    });

    test('variable power: NP > avg power', () => {
        const s = new SessionStats({ftp: 250});
        ride(s, 1800, i => ({power: (Math.floor(i / 60) % 2) ? 350 : 150}));
        const r = s.summary();
        expect(r.avgPower).toBeCloseTo(250);
        expect(r.np).toBeGreaterThan(r.avgPower);
        expect(r.vi).toBeGreaterThan(1.05);
    });

    test('best efforts', () => {
        const s = new SessionStats({ftp: 250});
        ride(s, 600, {power: 200});
        ride(s, 5, {power: 900});
        ride(s, 600, {power: 200});
        const best = s.summary().best;
        expect(best[0].watts).toBeCloseTo(900);
        expect(best[1].watts).toBeCloseTo((900 * 5 + 200 * 25) / 30);
        expect(best[2].watts).toBeCloseTo((900 * 5 + 200 * 55) / 60);
        expect(best[5].available).toBe(true);
        expect(best[6].available).toBe(false);
    });

    test('zones follow app percentages', () => {
        expect(zoneIndex(100, 200)).toBe(0);
        expect(zoneIndex(140, 200)).toBe(1);
        expect(zoneIndex(180, 200)).toBe(3);
        expect(zoneIndex(200, 200)).toBe(4);
        expect(zoneIndex(500, 200)).toBe(6);
        const s = new SessionStats({ftp: 200});
        ride(s, 60, {power: 200});
        expect(s.summary().zones[4].seconds).toBe(60);
    });

    test('interval stats reset when interval changes; adherence', () => {
        const s = new SessionStats({ftp: 200});
        ride(s, 60, {power: 150, target: 150, interval: 0});
        ride(s, 30, i => ({power: i < 15 ? 300 : 200, target: 300, interval: 1}));
        const r = s.summary();
        expect(r.interval.id).toBe(1);
        expect(r.interval.seconds).toBe(30);
        expect(r.interval.adherence).toBeCloseTo(0.5);
        expect(r.adherence).toBeCloseTo(75 / 90);
    });

    test('decoupling detects HR drift', () => {
        const s = new SessionStats({ftp: 250});
        ride(s, 1800, {power: 200, heartRate: 140});
        ride(s, 1800, {power: 200, heartRate: 154});
        expect(s.summary().decoupling).toBeCloseTo((200/140 - 200/154) / (200/140) * 100);
        expect(s.cues().some(c => c.text.includes('HR drift'))).toBe(true);
    });

    test('cues for pacing', () => {
        const s = new SessionStats({ftp: 250});
        ride(s, 30, {power: 300, target: 250});
        expect(s.cues({target: 250})[0].text).toMatch(/Above target/);
    });

    test('ignores bad values', () => {
        const s = new SessionStats();
        s.push({power: NaN, heartRate: undefined, cadence: -1});
        expect(s.summary().avgPower).toBe(0);
    });
});

describe('GoldenCheetah metrics', () => {
    test("W'bal depletes 1 J per watt above CP and empties on time", () => {
        const s = new SessionStats({ftp: 250, wprime: 20000});
        ride(s, 200, {power: 350});
        const r = s.summary();
        expect(r.wbal).toBeCloseTo(0);
        expect(r.wExpendedMax).toBeCloseTo(20000);
        expect(r.aboveCPkj).toBeCloseTo(20);
        expect(r.wbalZones[3].seconds).toBeGreaterThan(0);
    });

    test("W'bal recovers with the differential model below CP", () => {
        const s = new SessionStats({ftp: 250, wprime: 20000});
        ride(s, 100, {power: 350});          // W'bal 10000
        s.push({power: 150});                // recovers (100 * 10000 / 20000) = 50 J
        expect(s.summary().wbal).toBeCloseTo(10050);
        ride(s, 1800, {power: 150});
        expect(s.summary().wbal).toBeGreaterThan(19900);
    });

    test('time to empty uses the last 10 s', () => {
        const s = new SessionStats({ftp: 250, wprime: 20000});
        ride(s, 20, {power: 350});
        expect(s.timeToEmpty()).toBeCloseTo((20000 - 2000) / 100);
        expect(s.cues()[0].text).toMatch(/W′ is empty in/);
    });

    test('matches count efforts above CP costing at least 2 kJ', () => {
        const s = new SessionStats({ftp: 250, wprime: 20000});
        ride(s, 120, {power: 150});
        for(let k = 0; k < 3; k++) {
            ride(s, 30, {power: 400});       // 4.5 kJ each
            ride(s, 120, {power: 120});
        }
        ride(s, 10, {power: 270});           // tiny surge: not a match
        ride(s, 60, {power: 120});
        expect(s.summary().matches).toBe(3);
    });

    test('xPower equals power when steady; BikeScore 100 for an hour at CP', () => {
        const s = new SessionStats({ftp: 250});
        ride(s, 3600, {power: 250});
        const r = s.summary();
        expect(r.xpower).toBeGreaterThan(248);  // EWMA warm-up from zero
        expect(r.bikescore).toBeGreaterThan(97);
        expect(r.bikescore).toBeLessThan(100.1);
    });

    test('TISS: endurance is mostly aerobic, sprints are anaerobic', () => {
        const easy = new SessionStats({ftp: 250});
        ride(easy, 1800, {power: 160});
        const hard = new SessionStats({ftp: 250});
        ride(hard, 1800, i => ({power: i % 60 < 30 ? 600 : 50}));
        expect(easy.summary().aerobicity).toBeGreaterThan(0.95);
        expect(hard.summary().aerobicity).toBeLessThan(easy.summary().aerobicity);
    });

    test("changing W' keeps the balance percentage", () => {
        const s = new SessionStats({ftp: 250, wprime: 20000});
        ride(s, 100, {power: 350});
        s.setWprime(30000);
        expect(s.summary().wbalPct).toBeCloseTo(0.5);
    });
});
