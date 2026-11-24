/**
 * @jest-environment jsdom
 */
import '../training/fake-idb.js';

jest.mock('../../src/account/api.js', () => {
    class ApiError extends Error {
        constructor(status, message, reason = null) { super(message); this.status = status; this.reason = reason; }
    }
    const api = {get: jest.fn(), put: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn(), raw: jest.fn()};
    return {api, ApiError};
});
jest.mock('../../src/riders.js', () => ({
    riders: {current: () => ({id: 'r', account: {token: 't'}}), key: k => `r:${k}`, dbName: k => `r-${k}`},
}));

import { xf } from '../../src/functions.js';
import { api, ApiError } from '../../src/account/api.js';
import { syncNow, status } from '../../src/account/sync.js';
import { history } from '../../src/training/history.js';
import { idb } from '../../src/storage/idb.js';

beforeAll(() => idb.start('sync-offline', 6, ['session', 'workouts', 'activity', 'rideSummaries', 'plan', 'externalRides', 'hiddenRides', 'wellness', 'rideRatings']));

const offline = () => new ApiError(0, 'The account server cannot be reached.');
const local = k => JSON.parse(localStorage.getItem(`r:sync:${k}`) ?? 'null');
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    localStorage.clear();
    Object.values(api).forEach(f => f.mockReset());
    // the plan and outside rides have their own tests: not part of these runs
    history.connect({api: null, linked: () => false});
});

describe('offline', () => {
    test('a workout deleted offline is deleted on the server at the next sync', async () => {
        api.delete.mockRejectedValueOnce(offline());
        xf.dispatch('ui:workout:remove', 'w1');
        await flush();
        expect(local('pendingDeletes')).toEqual(['w1']);
        expect(status().state).toBe('offline');

        // back online: the delete goes first; the server's copy is not brought back
        api.delete.mockResolvedValue({});
        api.get.mockImplementation(async path => path === '/me/profile' ? {data: null, updatedAt: 0} :
            {now: 5, workouts: [{id: 'w1', data: {meta: {name: 'Gone'}, intervals: []}}]});
        api.put.mockResolvedValue({updatedAt: 1});
        await syncNow();
        expect(api.delete).toHaveBeenLastCalledWith('/me/workouts/w1');
        expect(local('pendingDeletes')).toEqual([]);
        const putIds = api.put.mock.calls.map(c => c[0]);
        expect(putIds).not.toContain('/me/workouts/w1');
    });

    test('still offline at the next sync: the delete stays queued', async () => {
        localStorage.setItem('r:sync:pendingDeletes', JSON.stringify(['w1', 'w2']));
        api.get.mockImplementation(async path => path === '/me/profile' ? {data: null, updatedAt: 0} : {now: 1, workouts: []});
        api.put.mockResolvedValue({updatedAt: 1});
        api.delete.mockRejectedValue(offline());
        await syncNow();
        expect(local('pendingDeletes')).toEqual(['w1', 'w2']);
        expect(api.delete).toHaveBeenCalledTimes(1);           // stops at the first that can't reach the server
        expect(status().state).toBe('offline');
    });

    test('the offline status says how many rides are waiting', async () => {
        localStorage.setItem('r:sync:pendingRides', JSON.stringify([{id: 'a'}, {id: 'b'}]));
        api.get.mockRejectedValue(offline());
        await syncNow();
        expect(status()).toEqual({state: 'offline', message: 'Offline: 2 rides waiting to sync'});
        localStorage.setItem('r:sync:pendingRides', '[]');
        window.dispatchEvent(new Event('offline'));
        expect(status().message).toBe('Offline: changes sync when you\'re back online');
    });

    test('a server error is not "offline"', async () => {
        api.get.mockRejectedValue(new ApiError(502, 'Bad gateway'));
        await syncNow();
        expect(status()).toEqual({state: 'error', message: 'Bad gateway'});
    });
});
