/**
 * @jest-environment jsdom
 */
import './fake-idb.js';
import { idb } from '../../src/storage/idb.js';
import { history } from '../../src/training/history.js';
import { fit } from '../../src/fit/fit.js';
import { countable } from '../../src/training/merge.js';

const STORES = ['session', 'workouts', 'activity', 'rideSummaries', 'plan', 'externalRides', 'hiddenRides', 'wellness', 'rideRatings'];
let n = 0;

beforeEach(async () => {
    await idb.start(`test-history-${n++}`, 6, STORES);
});

const summary = (id, day, start) => ({version: 1, id, day, start, duration: 3600, tss: 50, zoneSeconds: Array(7).fill(0), best: {}});

function fitBlob(start, seconds = 60) {
    const records = Array.from({length: seconds}, (_, i) => ({
        timestamp: start + i * 1000, power: 220, cadence: 90, speed: 9, heart_rate: 140, distance: i * 9,
    }));
    const view = fit.localActivity.encode({records, laps: [], events: [], ftp: 250});
    return new Blob([view.buffer]);
}

describe('ride summaries on the device', () => {
    test('saved summaries come back sorted by start', async () => {
        await history.saveSummary(summary('b', '2026-11-21', 2000));
        await history.saveSummary(summary('a', '2026-11-20', 1000));
        expect((await history.summaries()).map(s => s.id)).toEqual(['a', 'b']);
    });

    test('summaries outlive the 7 .fit files the device keeps', async () => {
        for(let i = 0; i < 9; i++) {
            await idb.put('activity', {id: `r${i}`, blob: new Blob([]), summary: {id: `r${i}`}});
            await history.saveSummary(summary(`r${i}`, '2026-11-20', i));
        }
        await idb.remove('activity', 'r0');
        await idb.remove('activity', 'r1');
        expect(await history.summaries()).toHaveLength(9);
    });
});

describe('backfill', () => {
    test('reads old rides back from .fit and carries on past a broken file', async () => {
        const t = new Date(2026, 10, 18, 18, 0).getTime();
        await idb.put('activity', {id: 'good1', blob: fitBlob(t), summary: {id: 'good1', name: 'One', timestamp: t + 60000, duration: 60}});
        await idb.put('activity', {id: 'broken', blob: new Blob([new Uint8Array(10)]), summary: {id: 'broken', name: 'Bad', timestamp: t, duration: 60}});
        await idb.put('activity', {id: 'good2', blob: fitBlob(t + 86400000), summary: {id: 'good2', name: 'Two', timestamp: t + 86460000, duration: 60}});
        const progress = [];
        const result = await history.backfill({ftp: 250, weight: 75, onProgress: p => progress.push(p)});
        expect(result.added).toBe(3);
        expect(result.skipped).toEqual(['broken']);
        const all = await history.summaries();
        expect(all.map(s => s.id).sort()).toEqual(['broken', 'good1', 'good2']);
        // an unreadable ride keeps its duration and gets an estimated load
        expect(all.find(s => s.id === 'broken').rawTss).toBeNull();
        expect(all.find(s => s.id === 'broken').loadSource).toBe('estimate');
        expect(all.find(s => s.id === 'good1').name).toBe('One');
        expect(all.find(s => s.id === 'good1').avgPower).toBe(220);
        expect(progress.at(-1)).toEqual({done: 3, total: 3});
        // a second run has nothing left to do
        expect((await history.backfill({ftp: 250, weight: 75})).added).toBe(0);
    });
});

describe('plan', () => {
    const workout = {id: 'w1', meta: {name: 'Sweet spot'}, intervals: []};

    test('add, move and remove', async () => {
        const e = await history.addPlanEntry('2026-11-24', workout);
        expect((await history.planEntries()).map(x => x.day)).toEqual(['2026-11-24']);
        await history.movePlanEntry(e.id, '2026-11-26');
        expect((await history.planEntries())[0].day).toBe('2026-11-26');
        await history.removePlanEntry(e.id);
        expect(await history.planEntries()).toEqual([]);
    });

    test('a saved ride on a planned day is matched to the plan', async () => {
        const e = await history.addPlanEntry('2026-11-24', workout);
        const start = new Date(2026, 10, 24, 18, 0).getTime();
        const samples = Array.from({length: 120}, () => ({power: 200, heartRate: 130, cadence: 90}));
        const s = await history.recordRide({id: 'ride1', start, name: 'Sweet spot', workoutId: 'w1', ftp: 250, weight: 75}, samples);
        expect(s.day).toBe('2026-11-24');
        expect((await history.planEntries()).find(x => x.id === e.id).rideId).toBe('ride1');
        expect((await history.summaries()).map(x => x.id)).toEqual(['ride1']);
    });
});

describe('upgrading an existing database', () => {
    test('a version 3 database gains the Training stores', async () => {
        await idb.start('upgrade-from-3', 3, ['session', 'workouts', 'activity']);
        await idb.put('activity', {id: 'old', blob: new Blob([]), summary: {id: 'old'}});
        await idb.start('upgrade-from-3', 4, STORES);
        await history.saveSummary(summary('x', '2026-11-20', 1));
        expect((await history.summaries()).map(s => s.id)).toEqual(['x']);
        expect((await idb.get('activity', 'old')).id).toBe('old');
    });
});

test('a version 4 database gains the externalRides store', async () => {
    await idb.start('upgrade-from-4', 4, ['session', 'workouts', 'activity', 'rideSummaries', 'plan']);
    await history.saveSummary(summary('mine', '2026-11-20', 1));
    await idb.start('upgrade-from-4', 5, STORES);
    await idb.put('externalRides', {...summary('icu-9', '2026-11-22', 2 * 86400000), source: 'intervals'});
    expect((await history.summaries()).map(s => s.id)).toEqual(['mine', 'icu-9']);
});

test('a version 5 database gains the health and rating stores (review)', async () => {
    await idb.start('upgrade-from-5', 5, ['session', 'workouts', 'activity', 'rideSummaries', 'plan', 'externalRides', 'hiddenRides']);
    await idb.put('externalRides', {...summary('icu-1', '2026-11-22', 9), source: 'intervals'});
    await idb.start('upgrade-from-5', 6, STORES);
    await idb.put('wellness', {id: '2026-11-22', day: '2026-11-22', hrv: 60});
    await history.rateRide('icu-1', 4);
    expect((await history.wellnessDays()).map(d => d.hrv)).toEqual([60]);
    expect((await history.ratings()).get('icu-1')).toBe(4);
    expect((await history.summaries()).map(s => s.id)).toEqual(['icu-1']);
});

describe('plan sync', () => {
    test('an edit made while its upload is in flight is not lost', async () => {
        const e = await history.addPlanEntry('2026-11-24', {id: 'w1', meta: {name: 'A'}, intervals: []});
        let edited = false;
        const api = {
            get: async () => ({entries: [], now: Date.now()}),
            put: async () => {
                if(!edited) { edited = true; await history.movePlanEntry(e.id, '2026-11-28'); }
                return {updatedAt: Date.now()};
            },
            delete: async () => ({ok: true}),
        };
        history.connect({api, linked: () => true});
        try {
            await history.syncPlan();
            const after = (await history.planEntries()).find(x => x.id === e.id);
            expect(after.day).toBe('2026-11-28');
            const stored = await idb.get('plan', e.id);
            expect(stored.dirty).toBe(true);           // still to be pushed
        } finally {
            history.connect({api: null, linked: () => false});
        }
    });
});

describe('an unreadable ride', () => {
    test('stays on the calendar with its duration', async () => {
        const t = new Date(2026, 10, 18, 18, 0).getTime();
        await idb.put('activity', {id: 'broken', blob: new Blob([new Uint8Array(10)]), summary: {id: 'broken', name: 'Bad', timestamp: t, duration: 1800}});
        const result = await history.backfill({ftp: 250, weight: 75});
        expect(result.skipped).toEqual(['broken']);
        const s = (await history.summaries()).find(x => x.id === 'broken');
        expect(s.duration).toBe(1800);
        expect(s.rawTss).toBeNull();
        expect(s.loadSource).toBe('estimate'); // counted with an estimate, marked as such
        expect(s.day).toBe('2026-11-18');
        expect((await history.backfill({ftp: 250, weight: 75})).skipped).toEqual([]); // not retried
    });
});

describe('intervals.icu rides', () => {
    test('are pulled with a cursor and merged into the summaries', async () => {
        const t = new Date(2026, 10, 20, 18, 0).getTime();
        await history.saveSummary(summary('r1', '2026-11-20', t));
        const calls = [];
        let cursor = 0;
        const pages = [
            {rides: [{...summary('icu-1', '2026-11-20', t + 60000), source: 'intervals'},      // the same ride
                     {...summary('icu-2', '2026-11-19', t - 86400000), source: 'intervals', sport: 'run'}], now: 500},
            {rides: [{...summary('icu-3', '2026-11-21', t + 86400000), source: 'intervals'}], now: 900},
        ];
        const api = {get: async (path) => {
            if(path.startsWith('/me/wellness')) return {days: [], now: 1};
            calls.push(path);
            return pages.shift();
        }};
        history.connect({api, linked: () => true, externalSince: {get: () => cursor, set: v => { cursor = v; }}});
        try {
            await history.pullExternal();
            expect((await history.summaries()).map(s => s.id)).toEqual(['icu-2', 'r1']);
            await history.pullExternal();
            expect(calls).toEqual(['/me/external-rides?since=0', '/me/external-rides?since=500']);
            expect((await history.summaries()).map(s => s.id)).toEqual(['icu-2', 'r1', 'icu-3']);
            expect(cursor).toBe(900);
        } finally {
            history.connect({api: null, linked: () => false});
        }
    });
});

describe('hiding a ride', () => {
    test('a hidden ride stays listed but no longer counts; Show brings it back', async () => {
        await history.saveSummary(summary('a', '2026-11-20', 1));
        await history.saveSummary(summary('b', '2026-11-21', 2 * 86400000));
        await history.hideRide('b');
        const all = await history.summaries();
        expect(all.map(s => [s.id, !!s.hidden])).toEqual([['a', false], ['b', true]]);
        expect(countable(all).map(s => s.id)).toEqual(['a']);
        expect([...await history.hiddenIds()]).toEqual(['b']);
        await history.showRide('b');
        expect(countable(await history.summaries()).map(s => s.id)).toEqual(['a', 'b']);
    });

    test('hidden ids sync through the account: pushed, and pulled on another device', async () => {
        await history.saveSummary(summary('a', '2026-11-20', 1));
        await history.saveSummary(summary('b', '2026-11-21', 2 * 86400000));
        const server = new Set(['a']); // hidden on another device
        const calls = [];
        const api = {
            get: async (path) => path === '/me/hidden-rides' ? {ids: [...server]} : {entries: [], now: Date.now()},
            put: async (path) => { calls.push(['PUT', path]); if(path.startsWith('/me/hidden-rides/')) server.add(decodeURIComponent(path.split('/').pop())); return {}; },
            delete: async (path) => { calls.push(['DELETE', path]); server.delete(decodeURIComponent(path.split('/').pop())); return {}; },
        };
        history.connect({api, linked: () => true});
        try {
            await history.hideRide('b');
            await history.syncPlan();
            expect(server.has('b')).toBe(true);
            expect([...await history.hiddenIds()].sort()).toEqual(['a', 'b']);
            await history.showRide('a');
            await history.syncPlan();
            expect(server.has('a')).toBe(false);
            expect(countable(await history.summaries()).map(s => s.id)).toEqual(['a']);
        } finally {
            history.connect({api: null, linked: () => false});
        }
    });
});

describe('intervals.icu plan entries', () => {
    const parsed = {id: 'x', meta: {name: 'From zwo'}, intervals: [{duration: 600, steps: [{duration: 600, power: 0.9}]}]};
    const parseWorkout = (text) => { if(text !== 'GOOD') throw new Error('no steps'); return structuredClone(parsed); };
    const toZwo = (w) => `ZWO:${w.meta.name}`;
    const pulled = (id, zwo) => ({id, deleted: false, updatedAt: 10, data: {
        day: '2026-11-24', origin: 'intervals', intervalsEventId: 7, zwo, rideId: null,
        workout: {id: `icu-ev-${id}`, meta: {name: 'Threshold'}, intervals: []}}});

    afterEach(() => history.connect({api: null, linked: () => false, parseWorkout: undefined, toZwo: undefined}));

    test('a readable .zwo becomes the workout, named as on intervals.icu', async () => {
        const api = {get: async (p) => p.startsWith('/me/plan') ? {entries: [pulled('e1', 'GOOD')], now: 20} : {ids: []}};
        history.connect({api, linked: () => true, parseWorkout, toZwo});
        await history.syncPlan();
        const [e] = await history.planEntries();
        expect(e.workout.intervals).toHaveLength(1);
        expect(e.workout.meta.name).toBe('Threshold');
        expect(e.origin).toBe('intervals');
    });

    test('an unreadable .zwo leaves workout null; the entry is listed and can be removed', async () => {
        const api = {get: async (p) => p.startsWith('/me/plan') ? {entries: [pulled('e2', 'BAD')], now: 20} : {ids: []},
                     delete: async () => ({}), put: async () => ({})};
        history.connect({api, linked: () => true, parseWorkout, toZwo});
        await history.syncPlan();
        const [e] = await history.planEntries();
        expect(e.workout).toBeNull();
        expect(e.name).toBe('Threshold');
        await history.removePlanEntry(e.id);
        expect(await history.planEntries()).toEqual([]);
    });

    test('an entry planned in Auuki stores its .zwo', async () => {
        history.connect({parseWorkout, toZwo});
        const e = await history.addPlanEntry('2026-11-24', {id: 'w1', meta: {name: 'Sweet spot'}, intervals: []});
        expect(e.origin).toBe('auuki');
        expect(e.zwo).toBe('ZWO:Sweet spot');
    });

    test('a workout the writer cannot turn into .zwo is still planned, without one', async () => {
        history.connect({parseWorkout, toZwo: () => { throw new Error('erg'); }});
        const e = await history.addPlanEntry('2026-11-24', {id: 'w1', meta: {name: 'Erg'}, intervals: []});
        expect(e.zwo).toBeNull();
    });
});

describe('a load for every workout', () => {
    afterEach(() => history.connect({api: null, linked: () => false, thresholds: () => ({cycling: null, running: null})}));

    test('summaries carry the effective load, where it came from, and the original', async () => {
        await history.saveSummary({...summary('p', '2026-11-20', 1), tss: 64});
        await idb.put('externalRides', {...summary('icu-run', '2026-11-21', 86400000), tss: null, sport: 'run', avgHr: 150, source: 'garmin'});
        await idb.put('externalRides', {...summary('gym', '2026-11-22', 2 * 86400000), tss: null, sport: 'weighttraining', source: 'garmin'});
        await idb.put('wellness', {id: '2026-11-21', day: '2026-11-21', restingHr: 50}); // keyed by day
        history.connect({thresholds: () => ({cycling: null, running: 170})});
        const byId = Object.fromEntries((await history.summaries()).map(s => [s.id, s]));
        expect([byId.p.tss, byId.p.loadSource, byId.p.rawTss]).toEqual([64, 'power', 64]);
        expect(byId['icu-run'].loadSource).toBe('hr');
        expect(byId['icu-run'].tss).toBeCloseTo(69.4, 1);
        expect(byId['icu-run'].rawTss).toBeNull();
        expect([byId.gym.tss, byId.gym.loadSource]).toEqual([30, 'estimate']);
        await history.rateRide('gym', 7);
        const gym = (await history.summaries()).find(s => s.id === 'gym');
        expect([gym.tss, gym.loadSource]).toEqual([49, 'rpe']);
        expect((await history.ratings()).get('gym')).toBe(7);
        await history.rateRide('gym', null);
        expect((await history.summaries()).find(s => s.id === 'gym').loadSource).toBe('estimate');
    });

    test('ratings sync through the account: pushed, and pulled on another device', async () => {
        const server = new Map([['other', 5]]);
        const api = {
            get: async (path) => path === '/me/ride-ratings' ? {ratings: Object.fromEntries(server)} :
                                 path === '/me/hidden-rides' ? {ids: []} : {entries: [], now: Date.now()},
            put: async (path, body) => { if(path.startsWith('/me/ride-ratings/')) server.set(decodeURIComponent(path.split('/').pop()), body.rpe); return {}; },
            delete: async (path) => { server.delete(decodeURIComponent(path.split('/').pop())); return {}; },
        };
        history.connect({api, linked: () => true});
        await history.rateRide('gym', 8);
        await history.syncPlan();
        expect(server.get('gym')).toBe(8);
        expect(Object.fromEntries(await history.ratings())).toEqual({gym: 8, other: 5});
        await history.rateRide('other', null);
        await history.syncPlan();
        expect(server.has('other')).toBe(false);
    });
});

describe('health data', () => {
    test('pulled with a cursor, stored per day, sorted', async () => {
        let cursor = 0;
        const calls = [];
        const pages = {
            '/me/wellness?since=0': {days: [{day: '2026-11-21', hrv: 48}, {day: '2026-11-20', hrv: 62, restingHr: 46}], now: 700},
            '/me/wellness?since=700': {days: [{day: '2026-11-21', hrv: 50, sleepScore: 70}], now: 900},
        };
        const api = {get: async (path) => { calls.push(path); return pages[path] ?? {rides: [], now: 1}; }};
        history.connect({api, linked: () => true, wellnessSince: {get: () => cursor, set: v => { cursor = v; }}});
        try {
            await history.pullWellness();
            await history.pullWellness();
            expect(calls).toEqual(['/me/wellness?since=0', '/me/wellness?since=700']);
            const days = await history.wellnessDays();
            expect(days.map(d => [d.day, d.hrv])).toEqual([['2026-11-20', 62], ['2026-11-21', 50]]);
            expect(days[1].sleepScore).toBe(70);
            expect(cursor).toBe(900);
        } finally {
            history.connect({api: null, linked: () => false});
        }
    });
});
