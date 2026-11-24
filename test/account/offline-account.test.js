/**
 * @jest-environment jsdom
 */
import '../training/fake-idb.js';
import { api } from '../../src/account/api.js';

describe('probe: unreachable is not "no server"', () => {
    afterEach(() => { delete global.fetch; });

    test('no answer at all: offline, and asked again next time', async () => {
        global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
        expect(await api.probe(true)).toEqual({available: false, offline: true});
        await Promise.resolve();
        global.fetch = jest.fn(async () => ({ok: true, headers: {get: () => 'application/json'}, json: async () => ({needsSetup: false, signup: false})}));
        expect(await api.probe()).toEqual({available: true, needsSetup: false, signup: false});
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('an answer that is not the account server: no server (and remembered)', async () => {
        global.fetch = jest.fn(async () => ({ok: false, status: 404, headers: {get: () => 'text/html'}}));
        expect(await api.probe(true)).toEqual({available: false});
        await api.probe();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
