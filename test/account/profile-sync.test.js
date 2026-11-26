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
import { db } from '../../src/db.js';
import { api } from '../../src/account/api.js';
import { syncNow } from '../../src/account/sync.js';
import { history } from '../../src/training/history.js';
import { idb } from '../../src/storage/idb.js';

beforeAll(() => idb.start('profile-sync', 6, ['session', 'workouts', 'activity', 'rideSummaries', 'plan', 'externalRides', 'hiddenRides', 'wellness', 'rideRatings']));

const local = k => JSON.parse(localStorage.getItem(`r:sync:${k}`) ?? 'null');
const wait = ms => new Promise(r => setTimeout(r, ms));
const profilePuts = () => api.put.mock.calls.filter(c => c[0] === '/me/profile');
let server;

beforeEach(() => {
    localStorage.clear();
    Object.values(api).forEach(f => f.mockReset());
    history.connect({api: null, linked: () => false});
    server = {data: null, updatedAt: 0};
    api.get.mockImplementation(async path => (path === '/me/profile' ? server : {now: 1, workouts: []}));
    api.put.mockImplementation(async (path, body) => {
        if(path === '/me/profile') server = {data: body.data, updatedAt: server.updatedAt + 1000};
        return {updatedAt: server.updatedAt};
    });
    db.ftp = 220;
});

// the app loading the rider's stored FTP: db.js sets db.ftp, which announces db:ftp
const appStart = () => { xf.dispatch('db:ftp', db); };

describe('profile sync', () => {
    test('loading the stored FTP at app start sends nothing; the server\'s newer FTP comes in', async () => {
        // this device last synced 220 W; since then another device set 200 W
        await syncNow();
        expect(server.data.ftp).toBe(220);
        server = {data: {...server.data, ftp: 200}, updatedAt: server.updatedAt + 5000};
        api.put.mockClear();

        appStart();
        await wait(1700);
        await syncNow();
        expect(profilePuts()).toEqual([]);
        expect(db.ftp).toBe(200);
        expect(server.data.ftp).toBe(200);
    });

    test('a device from before this fix (no record of what it synced) takes the server\'s FTP, even with a newer stamp', async () => {
        localStorage.setItem('r:sync:profileChangedAt', JSON.stringify(9e12));   // stamped by a start, as before
        server = {data: {ftp: 200, weight: 74}, updatedAt: 1000};
        appStart();
        await wait(1700);
        await syncNow();
        expect(profilePuts()).toEqual([]);
        expect(db.ftp).toBe(200);
    });

    test('a change on this device is sent, and marked as synced', async () => {
        await syncNow();
        db.ftp = 205;
        xf.dispatch('db:ftp', db);
        expect(local('profileDirty')).toBe(true);
        await wait(1700);
        expect(server.data.ftp).toBe(205);
        expect(local('profileDirty')).toBe(false);
    });

    test('changed offline: sent at the next sync, unless the server changed after it', async () => {
        await syncNow();
        api.put.mockRejectedValueOnce(Object.assign(new Error('offline'), {status: 0}));
        db.ftp = 210;
        xf.dispatch('db:ftp', db);
        await wait(1700);
        expect(server.data.ftp).toBe(220);                 // not sent yet
        await syncNow();
        expect(server.data.ftp).toBe(210);

        // changed offline again, but another device changed it later: the newer one wins
        api.put.mockRejectedValueOnce(Object.assign(new Error('offline'), {status: 0}));
        db.ftp = 215;
        xf.dispatch('db:ftp', db);
        await wait(1700);
        server = {data: {...server.data, ftp: 230}, updatedAt: Date.now() + 60000};
        await syncNow();
        expect(db.ftp).toBe(230);
        expect(server.data.ftp).toBe(230);
    });
});
