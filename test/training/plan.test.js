import { plannedTss, planStatus, matchRide, autoSelectWorkout } from '../../src/training/plan.js';

const workout = (intervals, id = 'w1') => ({id, meta: {name: 'W'}, intervals});
const step = (duration, power) => (power === undefined ? {duration} : {duration, power});

describe('planned TSS', () => {
    test('one hour at FTP is 100', () => {
        expect(plannedTss(workout([{duration: 3600, steps: [step(3600, 1.0)]}]))).toBeCloseTo(100);
    });
    test('steps add up', () => {
        const w = workout([{duration: 1800, steps: [step(1800, 0.5)]}, {duration: 1800, steps: [step(1800, 1.0)]}]);
        expect(plannedTss(w)).toBeCloseTo(12.5 + 50);
    });
    test('slope-only steps count as 65 % of FTP', () => {
        expect(plannedTss(workout([{duration: 3600, steps: [step(3600)]}]))).toBeCloseTo(0.65 * 0.65 * 100);
    });
    test('a step without duration uses its interval duration', () => {
        expect(plannedTss(workout([{duration: 3600, steps: [{power: 1.0}]}]))).toBeCloseTo(100);
    });
    test('no intervals is 0', () => {
        expect(plannedTss({})).toBe(0);
    });
});

describe('plan status and matching', () => {
    const e = (id, day, extra = {}) => ({id, day, workout: workout([], extra.workoutId ?? 'w1'), rideId: null, deleted: false, ...extra});

    test('status', () => {
        expect(planStatus(e('a', '2026-11-20', {rideId: 'r'}), '2026-11-23')).toBe('done');
        expect(planStatus(e('a', '2026-11-20'), '2026-11-23')).toBe('missed');
        expect(planStatus(e('a', '2026-11-23'), '2026-11-23')).toBe('planned');
        expect(planStatus(e('a', '2026-11-25'), '2026-11-23')).toBe('planned');
    });

    test('prefers the same workout over an earlier entry', () => {
        const entries = [e('a', '2026-11-23', {workoutId: 'other'}), e('b', '2026-11-23', {workoutId: 'w9'})];
        expect(matchRide({day: '2026-11-23', workoutId: 'w9'}, entries)).toBe('b');
    });
    test('falls back to the first unmatched, skipping matched and deleted entries', () => {
        const entries = [e('a', '2026-11-23', {rideId: 'r1'}), e('b', '2026-11-23', {deleted: true}), e('c', '2026-11-23')];
        expect(matchRide({day: '2026-11-23', workoutId: 'x'}, entries)).toBe('c');
    });
    test('no entries that day', () => {
        expect(matchRide({day: '2026-11-24', workoutId: 'w1'}, [e('a', '2026-11-23')])).toBeNull();
    });
});

describe('auto-select today\'s workout', () => {
    const copy = workout([{duration: 600, steps: [step(600, 0.6)]}], 'deleted-from-library');
    const entries = [{id: 'a', day: '2026-11-23', workout: copy, rideId: null, deleted: false}];

    test('selects the stored copy, even if the library no longer has it', () => {
        expect(autoSelectWorkout({entries, today: '2026-11-23', watchStatus: 'stopped', handPickedDay: null})).toBe(copy);
    });
    test('never while a ride is running', () => {
        expect(autoSelectWorkout({entries, today: '2026-11-23', watchStatus: 'started', handPickedDay: null})).toBeNull();
        expect(autoSelectWorkout({entries, today: '2026-11-23', watchStatus: 'paused', handPickedDay: null})).toBeNull();
    });
    test('never over a hand pick made today', () => {
        expect(autoSelectWorkout({entries, today: '2026-11-23', watchStatus: 'stopped', handPickedDay: '2026-11-23'})).toBeNull();
        expect(autoSelectWorkout({entries, today: '2026-11-23', watchStatus: 'stopped', handPickedDay: '2026-11-22'})).toBe(copy);
    });
    test('skips an entry whose workout could not be read, takes the next one', () => {
        const unreadable = {id: 'u', day: '2026-11-23', workout: null, rideId: null, deleted: false, origin: 'intervals'};
        expect(autoSelectWorkout({entries: [unreadable], today: '2026-11-23', watchStatus: 'stopped', handPickedDay: null})).toBeNull();
        expect(autoSelectWorkout({entries: [unreadable, ...entries], today: '2026-11-23', watchStatus: 'stopped', handPickedDay: null})).toBe(copy);
    });
    test('not when today\'s entry is done', () => {
        const done = [{...entries[0], rideId: 'r'}];
        expect(autoSelectWorkout({entries: done, today: '2026-11-23', watchStatus: 'stopped', handPickedDay: null})).toBeNull();
    });
});

describe('planned TSS for workouts in watts', () => {
    test('an hour at 200 W with FTP 200 is 100', () => {
        expect(plannedTss(workout([{duration: 3600, steps: [step(3600, 200)]}]), 200)).toBeCloseTo(100);
    });
    test('relative and absolute steps mix', () => {
        const w = workout([{duration: 1800, steps: [step(1800, 0.5)]}, {duration: 1800, steps: [step(1800, 250)]}]);
        expect(plannedTss(w, 250)).toBeCloseTo(12.5 + 50);
    });
});
