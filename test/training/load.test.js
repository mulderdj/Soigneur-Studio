import { dailyTss, pmc, forecast, formLabel, rampRate, rampStatus } from '../../src/training/load.js';
import { addDays } from '../../src/training/dates.js';

describe('fitness, fatigue and form', () => {
    test('one 100 TSS day', () => {
        const rows = pmc(new Map([['2026-01-01', 100]]), '2026-01-01', '2026-01-02');
        expect(rows).toHaveLength(2);
        expect(rows[0].atl).toBeCloseTo(100 / 7);
        expect(rows[0].ctl).toBeCloseTo(100 / 42);
        expect(rows[0].tsb).toBe(0); // yesterday's values
        expect(rows[1].tsb).toBeCloseTo(100 / 42 - 100 / 7);
    });

    test('constant load converges', () => {
        const m = new Map();
        let d = '2026-01-01';
        for(let i = 0; i < 400; i++) { m.set(d, 100); d = addDays(d, 1); }
        const last = pmc(m, '2026-01-01', addDays('2026-01-01', 399)).at(-1);
        expect(last.ctl).toBeGreaterThan(99);
        expect(last.atl).toBeCloseTo(100, 3);
    });

    test('forecast decays without plan and rises with plan', () => {
        const rest = forecast({ctl: 60, atl: 80}, new Map(), '2026-01-10', 28);
        expect(rest).toHaveLength(28);
        expect(rest[0].day).toBe('2026-01-11');
        expect(rest[0].tsb).toBeCloseTo(-20);
        expect(rest.at(-1).tsb).toBeGreaterThan(0);
        const busy = forecast({ctl: 60, atl: 80}, new Map([['2026-01-11', 150]]), '2026-01-10', 1);
        expect(busy[0].atl).toBeGreaterThan(80);
    });

    test.each([[30, 'Very fresh'], [25, 'Fresh'], [5, 'Fresh'], [0, 'Neutral'], [-10, 'Neutral'],
               [-11, 'Building'], [-30, 'Building'], [-31, 'Overreaching']])
        ('form %d is %s', (t, label) => expect(formLabel(t)).toBe(label));

    test('daily TSS sums rides and ignores rides without power', () => {
        const m = dailyTss([{day: '2026-01-01', tss: 50}, {day: '2026-01-01', tss: 30}, {day: '2026-01-02', tss: null}]);
        expect(m.get('2026-01-01')).toBe(80);
        expect(m.get('2026-01-02') ?? 0).toBe(0);
    });

    test('rampRate computes 7-day CTL change and rampStatus flags rapid build', () => {
        expect(rampRate([{ctl: 10}, {ctl: 20}])).toBeNull();
        const m = new Map();
        for(let i = 0; i < 14; i++) m.set(addDays('2026-01-01', i), i >= 7 ? 120 : 40);
        const rows = pmc(m, '2026-01-01', '2026-01-14');
        const r = rampRate(rows);
        expect(r).toBeCloseTo(rows.at(-1).ctl - rows.at(-8).ctl);
        expect(r).toBeGreaterThan(8);
        expect(rampStatus(r).level).toBe('danger');
        expect(rampStatus(6.2).level).toBe('warn');
        expect(rampStatus(3.1).level).toBe('ok');
        expect(rampStatus(-6.0).level).toBe('muted');
    });
});
