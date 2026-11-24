/**
 * @jest-environment jsdom
 */
import './fake-idb.js';
import { idb } from '../../src/storage/idb.js';
import { history } from '../../src/training/history.js';

const STORES = ['session', 'workouts', 'activity', 'rideSummaries', 'plan', 'externalRides', 'hiddenRides', 'wellness', 'rideRatings'];
let n = 0;
const iv = (duration, power) => ({duration, steps: [{duration, power}]});
const vo2 = {id: 'w-vo2', meta: {name: 'VO2 max'}, intervals: [iv(600, 0.6), iv(240, 1.15)]};
const spin = {id: 'spin', meta: {name: 'Recovery spin'}, intervals: [iv(1800, 0.52)]};

beforeEach(async () => {
    await idb.start(`replace-${n++}`, 6, STORES);
    history.connect({api: null, linked: () => false, toZwo: w => `<zwo>${w.meta.name}</zwo>`});
});

describe('changing a planned workout, and back', () => {
    test('replace: the new workout and its .zwo, the original kept once', async () => {
        const e = await history.addPlanEntry('2026-11-24', vo2);
        await history.replacePlanWorkout(e.id, {...vo2, id: 'w-vo2-easier', meta: {name: 'VO2 max (easier)'}});
        await history.replacePlanWorkout(e.id, spin);
        const now = await idb.get('plan', e.id);
        expect(now.workout.meta.name).toBe('Recovery spin');
        expect(now.zwo).toBe('<zwo>Recovery spin</zwo>');
        expect(now.name).toBe('Recovery spin');
        expect(now.original.workout.meta.name).toBe('VO2 max');
        expect(now.original.zwo).toBe('<zwo>VO2 max</zwo>');
        expect(now.dirty).toBe(true);
    });
    test('restore: the original back, nothing left over', async () => {
        const e = await history.addPlanEntry('2026-11-24', vo2);
        await history.replacePlanWorkout(e.id, spin);
        await history.restorePlanWorkout(e.id);
        const now = await idb.get('plan', e.id);
        expect(now.workout.meta.name).toBe('VO2 max');
        expect(now.zwo).toBe('<zwo>VO2 max</zwo>');
        expect(now.original ?? null).toBeNull();
    });
    test('restoring an entry that was never changed changes nothing', async () => {
        const e = await history.addPlanEntry('2026-11-24', vo2);
        const before = await idb.get('plan', e.id);
        await history.restorePlanWorkout(e.id);
        expect((await idb.get('plan', e.id)).updatedAt).toBe(before.updatedAt);
    });
});
