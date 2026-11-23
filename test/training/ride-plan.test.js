/**
 * @jest-environment jsdom
 */
import './fake-idb.js';
import { idb } from '../../src/storage/idb.js';
import { history } from '../../src/training/history.js';
import { selectTodaysWorkout } from '../../src/training/today.js';

let n = 0;
beforeEach(async () => {
    await idb.start(`ride-plan-${n++}`, 4, ['session', 'workouts', 'activity', 'rideSummaries', 'plan']);
});

const today = '2026-11-24';
// a workout that is no longer in the library: the plan keeps its own copy
const workout = {id: 'gone', meta: {name: 'Threshold 3x10'}, intervals: [{duration: 600, steps: [{duration: 600, power: 1}]}]};

describe('today\'s planned workout on start', () => {
    test('is selected', async () => {
        await history.addPlanEntry(today, workout);
        const select = jest.fn();
        const picked = await selectTodaysWorkout({today, watchStatus: 'stopped', handPickedDay: null, select});
        expect(select).toHaveBeenCalledTimes(1);
        expect(select.mock.calls[0][0].meta.name).toBe('Threshold 3x10');
        expect(picked.id).toBe('gone');
    });

    test('not over a workout picked by hand today', async () => {
        await history.addPlanEntry(today, workout);
        const select = jest.fn();
        await selectTodaysWorkout({today, watchStatus: 'stopped', handPickedDay: today, select});
        expect(select).not.toHaveBeenCalled();
    });

    test('not during a ride', async () => {
        await history.addPlanEntry(today, workout);
        const select = jest.fn();
        await selectTodaysWorkout({today, watchStatus: 'started', handPickedDay: null, select});
        expect(select).not.toHaveBeenCalled();
    });

    test('nothing planned today', async () => {
        await history.addPlanEntry('2026-11-25', workout);
        const select = jest.fn();
        expect(await selectTodaysWorkout({today, watchStatus: 'stopped', handPickedDay: null, select})).toBeNull();
        expect(select).not.toHaveBeenCalled();
    });
});
