/**
 * @jest-environment jsdom
 */
import './fake-idb.js';
import { idb } from '../../src/storage/idb.js';
import { history } from '../../src/training/history.js';
import { importFitFiles } from '../../src/training/fit-import.js';
import { fit } from '../../src/fit/fit.js';

const STORES = ['session', 'workouts', 'activity', 'rideSummaries', 'plan', 'externalRides', 'hiddenRides'];
let n = 0;
beforeEach(async () => {
    await idb.start(`fit-import-${n++}`, 5, STORES);
    history.connect({api: null, linked: () => false});
});

const T = new Date(2026, 10, 18, 7, 30).getTime();

function fitFile(name, start, seconds = 120) {
    const records = Array.from({length: seconds}, (_, i) => ({
        timestamp: start + i * 1000, power: 200, cadence: 85, speed: 8, heart_rate: 135, distance: i * 8,
    }));
    const view = fit.localActivity.encode({records, laps: [], events: [], ftp: 250});
    return new File([view.buffer], name);
}

test('readable files become rides; the same files again are skipped', async () => {
    const files = [fitFile('Morning.fit', T), fitFile('Evening.fit', T + 10 * 3600000)];
    const first = await importFitFiles(files, {ftp: 250, weight: 75});
    expect(first.added).toEqual(['Morning.fit', 'Evening.fit']);
    const rides = await history.summaries();
    expect(rides.map(r => [r.id, r.source, r.name])).toEqual([
        [`fit-${T}`, 'fit', 'Morning'], [`fit-${T + 10 * 3600000}`, 'fit', 'Evening']]);
    expect(rides[0].avgPower).toBe(200);
    expect(rides[0].duration).toBe(120);
    const again = await importFitFiles([fitFile('Morning.fit', T), fitFile('Evening.fit', T + 10 * 3600000)], {ftp: 250, weight: 75});
    expect(again).toEqual({added: [], skipped: ['Morning.fit', 'Evening.fit'], unreadable: []});
});

test('a file starting 60 s after a ride already there is skipped', async () => {
    await history.saveSummary({version: 1, id: 'r1', day: '2026-11-18', start: T, duration: 3600, tss: 50});
    const out = await importFitFiles([fitFile('Garmin.fit', T + 60000)], {ftp: 250, weight: 75});
    expect(out.skipped).toEqual(['Garmin.fit']);
    expect((await history.summaries()).map(r => r.id)).toEqual(['r1']);
});

test('a broken file is listed as unreadable, the rest goes on', async () => {
    const out = await importFitFiles([new File([new Uint8Array(20)], 'broken.fit'), fitFile('ok.fit', T)], {ftp: 250, weight: 75});
    expect(out.unreadable).toEqual(['broken.fit']);
    expect(out.added).toEqual(['ok.fit']);
});

test('signed in, imported rides go to the account; a failed send is retried on the next sync', async () => {
    const sent = [];
    let fail = true;
    const api = {
        put: async (path, body) => {
            if(path.startsWith('/me/external-rides/') && fail) throw new Error('offline');
            if(path.startsWith('/me/external-rides/')) sent.push([path, body.summary.id]);
            return {};
        },
        get: async () => ({entries: [], ids: [], rides: [], now: 1}),
        delete: async () => ({}),
    };
    history.connect({api, linked: () => true});
    try {
        await importFitFiles([fitFile('ok.fit', T)], {ftp: 250, weight: 75});
        expect(sent).toEqual([]);
        fail = false;
        await history.syncPlan();
        expect(sent).toEqual([[`/me/external-rides/fit-${T}`, `fit-${T}`]]);
        await history.syncPlan();
        expect(sent).toHaveLength(1);
    } finally {
        history.connect({api: null, linked: () => false});
    }
});

describe('the message after an import', () => {
    const { importMessage } = require('../../src/training/fit-import.js');
    test('says what was added, skipped and unreadable', () => {
        expect(importMessage({added: ['a', 'b'], skipped: [], unreadable: []})).toBe('Imported 2 rides.');
        expect(importMessage({added: ['a'], skipped: ['b'], unreadable: ['c.fit', 'd.fit']}))
            .toBe('Imported 1 ride. 1 was already there. Could not read: c.fit, d.fit.');
        expect(importMessage({added: [], skipped: ['b', 'c'], unreadable: []})).toBe('No new rides: 2 were already there.');
        expect(importMessage({added: [], skipped: [], unreadable: []})).toBe('No .fit files chosen.');
    });
});
