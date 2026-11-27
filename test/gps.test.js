/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import { models } from '../src/models/models.js';
import { fit } from '../src/fit/fit.js';
import { sensors } from '../src/sensors.js';
import { haversineMeters, createGpsDevice } from '../src/gps.js';

const SEMICIRCLES_PER_DEG = 2147483648 / 180;

function makeMockGeo() {
    let nextId = 1;
    let onPos = null;
    let onErr = null;
    let lastOpts = null;
    const cleared = [];

    return {
        watchPosition: jest.fn((success, error, options) => {
            onPos = success;
            onErr = error;
            lastOpts = options;
            return nextId++;
        }),
        clearWatch: jest.fn((id) => {
            cleared.push(id);
        }),
        emitPosition(pos) {
            if(onPos) onPos(pos);
        },
        emitError(err) {
            if(onErr) onErr(err);
        },
        getLastOptions: () => lastOpts,
        cleared,
    };
}

function makeFakeDb(overrides = {}) {
    return {
        position_lat: 0,
        position_long: 0,
        altitude: 0,
        ascent: 0,
        speed: 0,
        speedVirtual: 0,
        distance: 0,
        power: 0,
        power1s: 0,
        cadence: 0,
        heartRate: 0,
        smo2: 0,
        thb: 0,
        coreBodyTemperature: 0,
        skinTemperature: 0,
        slopeTarget: 0,
        elapsed: 0,
        watchStatus: 'stopped',
        mode: 'erg',
        records: [],
        lap: [],
        laps: [],
        events: [],
        rrInterval: [],
        ftp: 250,
        sources: {
            speed: 'gps',
            virtualState: 'power',
        },
        ...overrides,
    };
}

describe('haversineMeters', () => {
    test('returns 0 for identical or non-finite coordinates', () => {
        expect(haversineMeters(52.3676, 4.9041, 52.3676, 4.9041)).toBe(0);
        expect(haversineMeters(NaN, 4.9, 52.3, 4.9)).toBe(0);
        expect(haversineMeters(52.3, 4.9, undefined, 4.9)).toBe(0);
    });

    test('computes accurate great-circle distance', () => {
        // 1 degree of latitude along a meridian is ~111.195 km
        const oneDegLat = haversineMeters(52.0, 4.9, 53.0, 4.9);
        expect(oneDegLat).toBeGreaterThan(111000);
        expect(oneDegLat).toBeLessThan(111400);

        // ~100 m north at 52 deg N
        const shortDist = haversineMeters(52.3676, 4.9041, 52.3685, 4.9041);
        expect(shortDist).toBeGreaterThan(95);
        expect(shortDist).toBeLessThan(105);
    });
});

describe('createGpsDevice', () => {
    let geo;
    let fakeDb;
    let toasts;
    let device;
    let ac;
    let events;

    beforeEach(() => {
        localStorage.clear();
        sensors.forgetAll();
        geo = makeMockGeo();
        fakeDb = makeFakeDb();
        toasts = [];
        ac = new AbortController();
        events = [];

        const sig = {signal: ac.signal};
        for(const name of ['gps:connecting', 'gps:connected', 'gps:disconnected', 'gps:name', 'gps:fix', 'gps:speed', 'sensor:connected']) {
            xf.sub(name, payload => events.push({name, payload}), sig);
        }

        device = createGpsDevice({
            geolocation: geo,
            db: fakeDb,
            showToast: payload => toasts.push(payload),
        });
    });

    afterEach(() => {
        device.destroy();
        ac.abort();
    });

    test('starts and stops watchPosition via ui:gps:switch with high accuracy options', () => {
        xf.dispatch('ui:gps:switch');

        expect(geo.watchPosition).toHaveBeenCalledTimes(1);
        expect(geo.getLastOptions()).toEqual({
            enableHighAccuracy: true,
            maximumAge: 2000,
            timeout: 15000,
        });
        expect(device.getStatus()).toBe('connecting');
        expect(events).toEqual([
            {name: 'gps:connecting', payload: undefined},
            {name: 'gps:name', payload: 'Locating…'},
        ]);

        // Toggling again stops watching and resets status
        xf.dispatch('ui:gps:switch');
        expect(geo.clearWatch).toHaveBeenCalledWith(1);
        expect(device.getStatus()).toBe('disconnected');
        expect(events.some(e => e.name === 'gps:disconnected')).toBe(true);
        expect(events.filter(e => e.name === 'gps:name').at(-1).payload).toBe('--');
    });

    test('handles ui:gps:reconnect and stores gps in sensors.ROLES', () => {
        expect(sensors.ROLES.gps).toBe('GPS');
        xf.dispatch('ui:gps:reconnect', 'browser-gps');
        expect(geo.watchPosition).toHaveBeenCalledTimes(1);

        geo.emitPosition({
            coords: {latitude: 52.3676, longitude: 4.9041, accuracy: 6, altitude: 12, speed: 5.5},
            timestamp: 10000,
        });

        expect(device.isConnected()).toBe(true);
        expect(sensors.list().map(d => d.identifier)).toContain('gps');
    });

    test('emits gps:fix and updates db.position_lat, position_long, altitude, and gps:name', () => {
        xf.dispatch('ui:gps:switch');

        geo.emitPosition({
            coords: {
                latitude: 52.3676,
                longitude: 4.9041,
                accuracy: 4.7,
                altitude: 14.5,
                speed: 8.2,
            },
            timestamp: 1700000000000,
        });

        expect(device.isConnected()).toBe(true);
        expect(fakeDb.position_lat).toBeCloseTo(52.3676, 6);
        expect(fakeDb.position_long).toBeCloseTo(4.9041, 6);
        expect(fakeDb.altitude).toBeCloseTo(14.5, 4);
        expect(fakeDb.speed).toBeCloseTo(8.2, 4);

        const fixEvents = events.filter(e => e.name === 'gps:fix');
        expect(fixEvents).toHaveLength(1);
        expect(fixEvents[0].payload).toEqual({
            lat: 52.3676,
            lon: 4.9041,
            altitude: 14.5,
            speed: 8.2,
            accuracy: 4.7,
            timestamp: 1700000000000,
        });

        const nameEvents = events.filter(e => e.name === 'gps:name');
        expect(nameEvents.at(-1).payload).toBe('Precise (±5 m)');

        // Second fix should NOT re-emit gps:connected
        geo.emitPosition({
            coords: {
                latitude: 52.3678,
                longitude: 4.9041,
                accuracy: 5,
                altitude: 15.0,
                speed: 8.5,
            },
            timestamp: 1700000002000,
        });
        expect(events.filter(e => e.name === 'gps:connected')).toHaveLength(1);
    });

    test('accumulates Haversine distance and ascent while watch is running and filters jitter/inaccuracy', () => {
        fakeDb.watchStatus = 'started';
        xf.dispatch('ui:gps:switch');

        const t0 = 1700000000000;
        // Fix 1: anchor
        geo.emitPosition({
            coords: {latitude: 52.3676, longitude: 4.9041, accuracy: 5, altitude: 10, speed: null},
            timestamp: t0,
        });
        expect(fakeDb.distance).toBe(0);

        // Fix 2: tiny jitter (< 2 m) -> ignored for distance
        geo.emitPosition({
            coords: {latitude: 52.367605, longitude: 4.9041, accuracy: 5, altitude: 10.3, speed: null},
            timestamp: t0 + 1000,
        });
        expect(fakeDb.distance).toBe(0);
        expect(fakeDb.ascent).toBe(0);

        // Fix 3: poor accuracy (> 50 m) -> ignored for distance
        geo.emitPosition({
            coords: {latitude: 52.3685, longitude: 4.9041, accuracy: 85, altitude: 12, speed: null},
            timestamp: t0 + 2000,
        });
        expect(fakeDb.distance).toBe(0);

        // Fix 4: real movement (~100 m north in 10 s -> ~10 m/s) and +5 m climb
        geo.emitPosition({
            coords: {latitude: 52.3685, longitude: 4.9041, accuracy: 6, altitude: 15, speed: null},
            timestamp: t0 + 10000,
        });
        const expectedDist = haversineMeters(52.3676, 4.9041, 52.3685, 4.9041);
        expect(fakeDb.distance).toBeCloseTo(expectedDist, 2);
        expect(fakeDb.speed).toBeCloseTo(expectedDist / 10, 1);
        expect(fakeDb.ascent).toBeGreaterThanOrEqual(3);
    });

    test('does not accumulate distance when watch is stopped', () => {
        fakeDb.watchStatus = 'stopped';
        xf.dispatch('ui:gps:switch');

        const t0 = 1700000000000;
        geo.emitPosition({
            coords: {latitude: 52.3676, longitude: 4.9041, accuracy: 5, altitude: 10, speed: 5},
            timestamp: t0,
        });
        geo.emitPosition({
            coords: {latitude: 52.3685, longitude: 4.9041, accuracy: 5, altitude: 12, speed: 5},
            timestamp: t0 + 10000,
        });
        expect(fakeDb.distance).toBe(0);
    });

    test('dispatches disconnected and shows toast on PERMISSION_DENIED', () => {
        xf.dispatch('ui:gps:switch');
        geo.emitError({code: 1, message: 'User denied Geolocation'});

        expect(geo.clearWatch).toHaveBeenCalledWith(1);
        expect(device.getStatus()).toBe('disconnected');
        expect(events.some(e => e.name === 'gps:disconnected')).toBe(true);
        expect(events.filter(e => e.name === 'gps:name').at(-1).payload).toBe('--');
        expect(toasts).toHaveLength(1);
        expect(toasts[0].text).toMatch(/Location permission denied/i);
    });

    test('records a GPS ride via models.session.elapsed and encodes real semicircles into .fit', () => {
        fakeDb.watchStatus = 'started';
        fakeDb.power1s = 210;
        fakeDb.cadence = 88;
        fakeDb.heartRate = 148;
        xf.dispatch('ui:gps:switch');

        const t0 = Date.UTC(2026, 10, 27, 9, 0, 0);
        const pts = [
            {lat: 52.3676, lon: 4.9041, alt: 10, speed: 8.0, ts: t0},
            {lat: 52.3677, lon: 4.9042, alt: 11, speed: 8.5, ts: t0 + 1000},
            {lat: 52.3678, lon: 4.9043, alt: 12, speed: 9.0, ts: t0 + 2000},
        ];

        pts.forEach((p, i) => {
            geo.emitPosition({
                coords: {
                    latitude: p.lat,
                    longitude: p.lon,
                    accuracy: 5,
                    altitude: p.alt,
                    speed: p.speed,
                },
                timestamp: p.ts,
            });
            models.session.elapsed(i + 1, fakeDb);
        });

        expect(fakeDb.records).toHaveLength(3);
        expect(fakeDb.records[0].position_lat).toBeCloseTo(52.3676, 6);
        expect(fakeDb.records[0].position_long).toBeCloseTo(4.9041, 6);
        expect(fakeDb.records[2].speed).toBeCloseTo(9.0, 2);
        expect(fakeDb.records[2].distance).toBeGreaterThan(20);

        const view = fit.localActivity.encode({
            records: fakeDb.records,
            laps: fakeDb.laps,
            events: fakeDb.events,
            ftp: fakeDb.ftp,
        });
        const decoded = fit.FITjs.decode(view);
        const fitRecords = decoded.filter(m => m.type === 'data' && m.name === 'record').map(m => m.fields);

        expect(fitRecords).toHaveLength(3);
        for(let i = 0; i < pts.length; i++) {
            expect(fitRecords[i].position_lat).toBe(Math.round(pts[i].lat * SEMICIRCLES_PER_DEG));
            expect(fitRecords[i].position_long).toBe(Math.round(pts[i].lon * SEMICIRCLES_PER_DEG));
            expect(fitRecords[i].altitude).toBeCloseTo(pts[i].alt, 1);
            expect(fitRecords[i].speed).toBeCloseTo(pts[i].speed, 2);
        }
        expect(fitRecords[2].distance).toBeCloseTo(fakeDb.records[2].distance, 1);
    });
});
