/**
 * @jest-environment jsdom
 */
import './browser-stubs.js';
import { formModel } from '../../src/views/training/form-card.js';

const ride = (day, tss) => ({id: day, day, start: Date.parse(day), duration: 3600, tss});

describe('form over any period', () => {
    const summaries = [ride('2025-06-01', 80), ride('2026-11-20', 60)];
    test('90 days back by default; since the first ride with pastDays null', () => {
        expect(formModel({today: '2026-11-23', summaries, plan: []}).past).toHaveLength(90);
        const all = formModel({today: '2026-11-23', summaries, plan: []}, {pastDays: null}).past;
        expect(all[0].day).toBe('2025-06-01');
        expect(all.at(-1).day).toBe('2026-11-23');
    });
    test('no rides: zeros, no NaN', () => {
        const m = formModel({today: '2026-11-23', summaries: [], plan: []}, {pastDays: null});
        for(const r of [...m.past, ...m.ahead]) for(const k of ['ctl', 'atl', 'tsb']) expect(Number.isFinite(r[k])).toBe(true);
    });
    test('extends forecast horizon up to 42 days when an A/B goal falls between day 29 and 42', () => {
        const m = formModel({
            today: '2026-11-23',
            summaries,
            plan: [{id: 'ga', day: '2026-12-28', kind: 'event', event: {name: 'Festive 500 Finale', priority: 'A'}}],
        });
        expect(m.ahead).toHaveLength(35);
        expect(m.ahead.at(-1).day).toBe('2026-12-28');
        expect(m.raceForecast?.goal.name).toBe('Festive 500 Finale');
    });
});
