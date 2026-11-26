import { effectiveLoad, mergeThresholds, restingHrOn, PER_HOUR } from '../../src/training/load-sources.js';

const hour = (extra) => ({id: 'x', day: '2026-11-20', duration: 3600, tss: null, ...extra});

describe('effectiveLoad', () => {
    test('power (or a source\'s own load) wins', () => {
        expect(effectiveLoad(hour({tss: 72.4, avgHr: 150}), {thresholds: {cycling: 170}, rating: 9}))
            .toEqual({tss: 72.4, loadSource: 'power'});
        expect(effectiveLoad(hour({tss: 40, source: 'intervals', sport: 'run'}), {}))
            .toEqual({tss: 40, loadSource: 'power'});
    });

    test('heart rate: (avg − rest) / (threshold − rest), squared, per hour', () => {
        const out = effectiveLoad(hour({avgHr: 150}), {thresholds: {cycling: 170}, restingHr: 50});
        expect(out.loadSource).toBe('hr');
        expect(out.tss).toBeCloseTo(69.4, 1);
        // resting heart rate defaults to 60
        expect(effectiveLoad(hour({avgHr: 150}), {thresholds: {cycling: 170}}).tss).toBeCloseTo(100 * (90 / 110) ** 2, 1);
        // a run uses the running threshold
        expect(effectiveLoad(hour({avgHr: 160, sport: 'run'}), {thresholds: {cycling: 150, running: 175}, restingHr: 50}).tss)
            .toBeCloseTo(100 * (110 / 125) ** 2, 1);
    });

    test('intensity is clamped to 0–1.2', () => {
        expect(effectiveLoad(hour({avgHr: 210}), {thresholds: {cycling: 170}, restingHr: 50}).tss).toBeCloseTo(144, 0);
        expect(effectiveLoad(hour({avgHr: 40}), {thresholds: {cycling: 170}, restingHr: 50}).tss).toBe(0);
    });

    test('a swim with heart rate has no threshold: rating or estimate, not a bogus HR load', () => {
        expect(effectiveLoad(hour({avgHr: 140, sport: 'swim'}), {thresholds: {cycling: 170, running: 175}}))
            .toEqual({tss: 50, loadSource: 'estimate'});
    });

    test('a rating: calibrated Borg CR-10 TSS/hr', () => {
        expect(effectiveLoad(hour({sport: 'weighttraining'}), {rating: 6})).toEqual({tss: 70, loadSource: 'rpe'});
        expect(effectiveLoad({...hour({sport: 'yoga'}), duration: 1800}, {rating: 4})).toEqual({tss: 25, loadSource: 'rpe'});
        expect(effectiveLoad(hour({tss: 0, avgHr: 150}), {thresholds: {cycling: 170}, restingHr: 50}).loadSource).toBe('hr');
    });

    test('nothing at all: an estimate from the sport', () => {
        expect(effectiveLoad(hour({sport: 'weighttraining'}), {})).toEqual({tss: 30, loadSource: 'estimate'});
        expect(effectiveLoad(hour({}), {})).toEqual({tss: PER_HOUR.cycling, loadSource: 'estimate'}); // Auuki rides are cycling
        expect(effectiveLoad(hour({sport: 'kayaking'}), {})).toEqual({tss: PER_HOUR.other, loadSource: 'estimate'});
        expect(effectiveLoad({...hour({}), duration: 0}, {})).toEqual({tss: 0, loadSource: 'estimate'});
    });

    test('the per-hour estimates', () => {
        expect(PER_HOUR).toEqual({cycling: 50, run: 60, swim: 50, walk: 20, hike: 35, weighttraining: 30, yoga: 15, other: 40});
    });
});

describe('thresholds and resting heart rate', () => {
    test('the rider\'s own threshold beats Garmin\'s, per sport', () => {
        expect(mergeThresholds({cycling: 158, running: null}, {cycling: 165, running: 172})).toEqual({cycling: 158, running: 172});
        expect(mergeThresholds(null, null)).toEqual({cycling: null, running: null});
    });

    test('resting heart rate: that day, else the nearest earlier day within 7 days', () => {
        const days = new Map([['2026-11-10', {restingHr: 48}], ['2026-11-18', {restingHr: 52}], ['2026-11-19', {hrv: 60}]]);
        expect(restingHrOn('2026-11-18', days)).toBe(52);
        expect(restingHrOn('2026-11-20', days)).toBe(52);
        expect(restingHrOn('2026-11-26', days)).toBeNull();   // more than 7 days after the last value
        expect(restingHrOn('2026-11-09', days)).toBeNull();
    });
});
