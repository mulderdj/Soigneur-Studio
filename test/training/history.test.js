/**
 * @jest-environment jsdom
 */
import './fake-idb.js';
import { idb } from '../../src/storage/idb.js';
import { history } from '../../src/training/history.js';
import { fit } from '../../src/fit/fit.js';

const STORES = ['session', 'workouts', 'activity', 'rideSummaries', 'plan', 'externalRides'];
let n = 0;

beforeEach(async () => {
    await idb.start(`test-history-${n++}`, 5, STORES);
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
        expect(all.find(s => s.id === 'broken').tss).toBeNull();
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
        expect(s.tss).toBeNull();
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
        const api = {get: async (path) => { calls.push(path); return pages.shift(); }};
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
