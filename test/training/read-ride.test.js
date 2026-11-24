import { readRide, samplesFromRecords } from '../../src/training/fit-records.js';
import { fit } from '../../src/fit/fit.js';

const T = Date.UTC(2026, 10, 20, 8, 0, 0);
const rec = (s, f = {}) => ({timestamp: T + s * 1000, ...f});

describe('records to 1 s samples', () => {
    test('1 s records come through as they are, missing values null', () => {
        const r = samplesFromRecords([rec(0, {power: 200, heart_rate: 120}), rec(1, {power: 210}), rec(2, {power: 220, heart_rate: 122})]);
        expect(r.start).toBe(T);
        expect(r.samples.map(s => s.t)).toEqual([0, 1, 2]);
        expect(r.samples.map(s => s.power)).toEqual([200, 210, 220]);
        expect(r.samples[1].heartRate).toBe(120);        // held across a 1 s gap in that field? no: held only across missing records
    });

    test('smart recording (a record every 6 s) is held to 1 s', () => {
        const r = samplesFromRecords([0, 6, 12].map(s => rec(s, {speed: 8, heart_rate: 130 + s})));
        expect(r.samples).toHaveLength(13);
        expect(r.samples[3]).toMatchObject({t: 3, speed: 8, heartRate: 130});
        expect(r.samples[12]).toMatchObject({heartRate: 142});
        expect(r.recorded).toBe(3);
    });

    test('a pause longer than 15 s is a gap of nulls, not a flat line', () => {
        const r = samplesFromRecords([rec(0, {power: 200}), rec(1, {power: 200}), rec(121, {power: 180})]);
        expect(r.samples).toHaveLength(122);
        expect(r.samples[60].power).toBeNull();
        expect(r.samples[121].power).toBe(180);
        expect(r.pauses).toEqual([{start: 2, end: 121}]);
    });

    test('Garmin\'s enhanced speed and altitude are used when the plain fields are missing', () => {
        const r = samplesFromRecords([rec(0, {enhanced_speed: 7.5, enhanced_altitude: 412.2})]);
        expect(r.samples[0]).toMatchObject({speed: 7.5, altitude: 412.2});
    });

    test('nonsense values are null; laps are seconds from the start', () => {
        const r = samplesFromRecords([rec(0, {power: 65535, heart_rate: 255, cadence: 90})], [{start_time: T, timestamp: T + 300000}, {start_time: T + 300000, timestamp: T + 600000}]);
        expect(r.samples[0]).toMatchObject({power: null, heartRate: null, cadence: 90});
        expect(r.laps).toEqual([{start: 0, end: 300}, {start: 300, end: 600}]);
    });

    test('Garmin laps: the end from start + elapsed time (their timestamp reads as the ride\'s start)', () => {
        const r = samplesFromRecords([rec(0, {power: 1}), rec(3000, {power: 1})],
            [{start_time: T, timestamp: T, total_elapsed_time: 1282.1}, {start_time: T + 1283000, timestamp: T, total_elapsed_time: 1689.2}]);
        expect(r.laps).toEqual([{start: 0, end: 1282}, {start: 1283, end: 2972}]);
    });

    test('a short auto-pause the file marks with timer events is a pause, not a held line', () => {
        const records = [];
        for(let i = 0; i < 60; i++) records.push({timestamp: T + i * 1000, power: 200, heart_rate: 130, cadence: 85, speed: 8, distance: i * 8});
        for(let i = 68; i < 120; i++) records.push({timestamp: T + i * 1000, power: 200, heart_rate: 130, cadence: 85, speed: 8, distance: i * 8});
        const events = [{timestamp: T, type: 'start'}, {timestamp: T + 60000, type: 'stop'}, {timestamp: T + 68000, type: 'start'}];
        const view = fit.localActivity.encode({records, laps: [], events, ftp: 250});
        const r = readRide(view);
        expect(r.pauses).toEqual([{start: 60, end: 68}]);
        expect(r.samples[63].power).toBeNull();
    });

    test('no records: an empty ride', () => {
        expect(samplesFromRecords([]).samples).toEqual([]);
    });
});

describe('reading a .fit', () => {
    test('a file the app wrote: samples, laps, sport', () => {
        const records = Array.from({length: 120}, (_, i) => ({timestamp: T + i * 1000, power: 200 + i, cadence: 85, speed: 8, heart_rate: 135, distance: i * 8}));
        const laps = [{start_time: T, timestamp: T + 60000}, {start_time: T + 60000, timestamp: T + 119000}];
        const view = fit.localActivity.encode({records, laps, events: [], ftp: 250});
        const r = readRide(view);
        expect(r.samples).toHaveLength(120);
        expect(r.samples[10]).toMatchObject({t: 10, power: 210, heartRate: 135, cadence: 85});
        expect(r.laps.map(l => l.start)).toEqual([0, 60]);
        expect(r.start).toBe(T);
    });
    test('garbage gives an empty ride, never an error', () => {
        expect(readRide(new DataView(new ArrayBuffer(30))).samples).toEqual([]);
    });
});
