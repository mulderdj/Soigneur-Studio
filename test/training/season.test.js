/**
 * @jest-environment jsdom
 */
import './fake-idb.js';
import { idb } from '../../src/storage/idb.js';
import { history } from '../../src/training/history.js';
import { addDays } from '../../src/training/dates.js';
import { matchRide, autoSelectWorkout } from '../../src/training/plan.js';
import {
    isGoalEvent,
    eventTypeLabel,
    normalizeGoalEvent,
    goalEventsFromPlan,
    eventLoadTss,
    phaseForWeek,
    weeklyPhases,
} from '../../src/training/season.js';

const STORES = ['session', 'workouts', 'activity', 'rideSummaries', 'plan', 'externalRides', 'hiddenRides', 'wellness', 'rideRatings'];
let dbSeq = 0;

describe('goal event normalization and helpers', () => {
    test('normalizes valid goal events and trims optional fields', () => {
        const g = normalizeGoalEvent({
            name: '  Tour of Flanders Sportive  ',
            priority: 'a',
            eventType: 'gran-fondo',
            targetDurationS: 18000.4,
            targetTss: 260.2,
            notes: '  Cobbles + bergs  ',
        });
        expect(g).toEqual({
            name: 'Tour of Flanders Sportive',
            priority: 'A',
            eventType: 'gran-fondo',
            targetDurationS: 18000,
            targetTss: 260,
            notes: 'Cobbles + bergs',
        });
        expect(eventTypeLabel('gran-fondo')).toBe('Gran fondo');
        expect(eventTypeLabel('tt')).toBe('Time trial');
        expect(eventTypeLabel('hill-climb')).toBe('Hill climb');
        expect(eventTypeLabel(null)).toBe('');
    });

    test('rejects missing name, bad priority, or out-of-range duration/TSS', () => {
        expect(() => normalizeGoalEvent({name: '   ', priority: 'A'})).toThrow(/name/i);
        expect(() => normalizeGoalEvent({name: 'Race', priority: 'D'})).toThrow(/priority/i);
        expect(() => normalizeGoalEvent({name: 'Race', priority: 'B', targetDurationS: -10})).toThrow(/duration/i);
        expect(() => normalizeGoalEvent({name: 'Race', priority: 'B', targetTss: 5000})).toThrow(/TSS/i);
    });

    test('eventLoadTss uses explicit targetTss, else estimates from duration', () => {
        expect(eventLoadTss({name: 'Fondo', priority: 'A', targetTss: 220, targetDurationS: 14400})).toBe(220);
        expect(eventLoadTss({name: 'Fondo', priority: 'A', targetTss: null, targetDurationS: 7200})).toBe(140);
        expect(eventLoadTss({name: 'Club ride', priority: 'C', targetTss: null, targetDurationS: 7200})).toBe(110);
        expect(eventLoadTss({name: 'Crit', priority: 'B'})).toBe(0);
    });

    test('goalEventsFromPlan sorts chronologically then by priority A, B, C', () => {
        const list = goalEventsFromPlan([
            {id: 'c1', day: '2026-12-06', kind: 'event', event: {name: 'Club Run', priority: 'C'}},
            {id: 'a1', day: '2026-12-06', kind: 'event', event: {name: 'Championship', priority: 'A'}},
            {id: 'b1', day: '2026-11-29', kind: 'event', event: {name: 'Warm-up Crit', priority: 'B'}},
            {id: 'del', day: '2026-11-28', kind: 'event', deleted: true, event: {name: 'Gone', priority: 'A'}},
            {id: 'w1', day: '2026-11-25', workout: {id: 'w', intervals: []}},
        ]);
        expect(list.map(g => [g.id, g.priority])).toEqual([
            ['b1', 'B'],
            ['a1', 'A'],
            ['c1', 'C'],
        ]);
    });
});

describe('weekly training phases (Base, Build, Peak, Taper)', () => {
    // Anchor Monday: 2026-11-02; A goal 11 weeks later on Sunday 2027-01-24 (week 2027-01-18, weeksOut = 11..0)
    const aRace = {id: 'a1', day: '2027-01-24', kind: 'event', event: {name: 'Winter Classic', priority: 'A'}};

    test('derives Base -> Build -> Peak -> Taper working backward from an A goal', () => {
        const phases = weeklyPhases([aRace], '2026-11-02', '2027-02-01');
        expect(phases).toHaveLength(14); // 12 weeks up to race week + 2 weeks after
        const byWeek = new Map(phases.map(p => [p.week, p]));

        // 11, 10, 9 weeks out -> Base
        expect(byWeek.get('2026-11-02').phase).toBe('base');
        expect(byWeek.get('2026-11-09').phase).toBe('base');
        expect(byWeek.get('2026-11-16').phase).toBe('base');

        // 8..4 weeks out -> Build (5 weeks)
        expect(byWeek.get('2026-11-23').phase).toBe('build');
        expect(byWeek.get('2026-12-21').phase).toBe('build');

        // 3..2 weeks out -> Peak (2 weeks)
        expect(byWeek.get('2026-12-28').phase).toBe('peak');
        expect(byWeek.get('2027-01-04').phase).toBe('peak');

        // 1..0 weeks out -> Taper (2 weeks)
        expect(byWeek.get('2027-01-11')).toMatchObject({phase: 'taper', label: 'Taper', weeksToGoal: 1});
        expect(byWeek.get('2027-01-18')).toMatchObject({phase: 'taper', label: 'Taper', weeksToGoal: 0});

        // After the only A goal passes -> null phase
        expect(byWeek.get('2027-01-25').phase).toBeNull();
    });

    test('B goals get a miniTaper badge without resetting the 12-week A cycle', () => {
        const bTuneUp = {id: 'b1', day: '2026-12-13', kind: 'event', event: {name: 'December Crit', priority: 'B'}};
        const cEvent = {id: 'c1', day: '2026-11-29', kind: 'event', event: {name: 'Social Sportive', priority: 'C'}};
        const phases = weeklyPhases([aRace, bTuneUp, cEvent], '2026-11-23', '2027-01-18');
        const bWeek = phases.find(p => p.week === '2026-12-07');
        expect(bWeek.phase).toBe('build');
        expect(bWeek.miniTaper).toBe(true);
        expect(bWeek.targetGoal.id).toBe('a1');
        // Week after B tune-up continues smoothly in Build -> Peak -> Taper for A
        expect(phases.find(p => p.week === '2026-12-14').phase).toBe('build');
        expect(phases.find(p => p.week === '2026-12-28').phase).toBe('peak');
        // C event does not trigger miniTaper
        expect(phases.find(p => p.week === '2026-11-23').miniTaper).toBe(false);
    });

    test('handles multiple A goals: distant second peak restarts Base, close double-peak stays in Peak/Taper', () => {
        const a1 = {id: 'a1', day: '2026-12-06', kind: 'event', event: {name: 'Peak One', priority: 'A'}};
        const a2Close = {id: 'a2', day: '2026-12-27', kind: 'event', event: {name: 'Peak Two', priority: 'A'}};
        const closePhases = weeklyPhases([a1, a2Close], '2026-11-30', '2026-12-27');
        expect(closePhases.map(p => [p.week, p.phase, p.targetGoal.id])).toEqual([
            ['2026-11-30', 'taper', 'a1'],
            ['2026-12-07', 'peak', 'a2'],
            ['2026-12-14', 'taper', 'a2'],
            ['2026-12-21', 'taper', 'a2'],
        ]);

        const a2Far = {id: 'a3', day: addDays('2026-12-06', 14 * 7), kind: 'event', event: {name: 'Spring Classic', priority: 'A'}};
        expect(phaseForWeek([a1, a2Far], '2026-12-07')).toMatchObject({phase: 'base', targetGoal: {id: 'a3'}});
    });
});

describe('goal events in training history and sync', () => {
    beforeEach(async () => {
        await idb.start(`test-season-${dbSeq++}`, 6, STORES);
    });

    test('adds, updates, lists and removes goal events, and never matches rides or workouts to them', async () => {
        const created = await history.addGoalEvent('2026-12-20', {
            name: 'Solstice Fondo',
            priority: 'A',
            eventType: 'gran-fondo',
            targetDurationS: 14400,
            targetTss: 230,
            notes: 'Pace the first climb',
        });
        expect(isGoalEvent(created)).toBe(true);
        expect(await history.goalEvents()).toHaveLength(1);

        // Rides and autoSelectWorkout ignore goal events on the same day
        const entries = await history.planEntries();
        expect(matchRide({day: '2026-12-20', workoutId: null}, entries)).toBeNull();
        expect(autoSelectWorkout({entries, today: '2026-12-20', watchStatus: 'stopped', handPickedDay: null})).toBeNull();

        await history.updateGoalEvent(created.id, {day: '2026-12-21', priority: 'B', name: 'Moved Fondo'});
        const [updated] = await history.goalEvents();
        expect(updated).toMatchObject({id: created.id, day: '2026-12-21', priority: 'B', name: 'Moved Fondo'});

        await history.removeGoalEvent(created.id);
        expect(await history.goalEvents()).toEqual([]);
    });

    test('syncs goal events two-way with /me/plan', async () => {
        const localGoal = await history.addGoalEvent('2026-12-20', {name: 'Local A Race', priority: 'A'});
        const pushed = [];
        const api = {
            get: async () => ({
                entries: [{
                    id: 'srv-goal-1',
                    deleted: false,
                    updatedAt: Date.now() + 1000,
                    data: {day: '2026-12-06', kind: 'event', event: {name: 'Remote B Race', priority: 'B', eventType: 'crit', targetDurationS: null, targetTss: 90, notes: null}},
                }],
                now: 1234,
            }),
            put: async (path, body) => { pushed.push({path, body}); return {updatedAt: Date.now()}; },
            delete: async () => ({ok: true}),
        };
        history.connect({api, linked: () => true});
        try {
            await history.syncPlan();
            expect(pushed.some(p => p.path === `/me/plan/${localGoal.id}` && p.body.data.kind === 'event')).toBe(true);
            const goals = await history.goalEvents();
            expect(goals.map(g => [g.name, g.priority])).toEqual([
                ['Remote B Race', 'B'],
                ['Local A Race', 'A'],
            ]);
        } finally {
            history.connect({api: null, linked: () => false});
        }
    });
});
