/**
 * @jest-environment jsdom
 */
import './fake-idb.js';
import { idb } from '../../src/storage/idb.js';
import { history } from '../../src/training/history.js';
import { fit } from '../../src/fit/fit.js';

const STORES = ['session', 'workouts', 'activity', 'rideSummaries', 'plan'];
let n = 0;

beforeEach(async () => {
    await idb.start(`test-history-${n++}`, 4, STORES);
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
        expect(result.added).toBe(2);
        expect(result.skipped).toEqual(['broken']);
        const all = await history.summaries();
        expect(all.map(s => s.id).sort()).toEqual(['good1', 'good2']);
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
