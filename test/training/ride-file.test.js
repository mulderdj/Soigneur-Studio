/**
 * @jest-environment jsdom
 */
import './fake-idb.js';
import { idb } from '../../src/storage/idb.js';
import { history } from '../../src/training/history.js';
import { ApiError } from '../../src/account/api.js';

const STORES = ['session', 'workouts', 'activity', 'rideSummaries', 'plan', 'externalRides', 'hiddenRides', 'wellness', 'rideRatings'];
let n = 0;
const fitBytes = tag => { const b = new Uint8Array(40).fill(tag); b[0] = 14; b.set([46, 70, 73, 84], 8); return b; };

beforeEach(async () => {
    await idb.start(`ride-file-${n++}`, 6, STORES);
    history.connect({api: null, linked: () => false});
});

describe('a ride\'s file for the ride page', () => {
    test('a ride still on this device: its own .fit, no server needed', async () => {
        await idb.put('activity', {id: 'r1', blob: new Blob([fitBytes(1)]), summary: {name: 'Mine'}});
        const out = await history.rideFile('r1');
        expect(out.view.getUint8(20)).toBe(1);
    });
    test('otherwise from the account server', async () => {
        const calls = [];
        history.connect({linked: () => true, api: {raw: async path => { calls.push(path); const b = fitBytes(2); return {arrayBuffer: async () => b.buffer}; }}});
        const out = await history.rideFile('garmin-111');
        expect(calls).toEqual(['/me/rides/garmin-111/file']);
        expect(out.view.getUint8(20)).toBe(2);
    });
    test('the server\'s reason comes through; not signed in says so', async () => {
        history.connect({linked: () => true, api: {raw: async () => { throw new ApiError(404, 'intervals.icu doesn\'t hand out rides that came from Strava.', 'strava'); }}});
        expect(await history.rideFile('icu-i3')).toMatchObject({reason: 'strava'});
        history.connect({linked: () => true, api: {raw: async () => { throw new ApiError(0, 'The account server cannot be reached.'); }}});
        expect(await history.rideFile('icu-i3')).toMatchObject({reason: 'offline'});
        history.connect({linked: () => false, api: null});
        expect(await history.rideFile('garmin-1')).toMatchObject({reason: 'no-account'});
    });
});
