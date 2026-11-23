// node --test server/intervals.spec.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sportOf, isStub, bestFromPowerCurve, zonesFromZoneTimes, toSummary } = require('./intervals.js');

const ride = {
    id: 'i101', start_date_local: '2026-11-20T18:00:00', start_date: '2026-11-20T17:00:00Z',
    type: 'VirtualRide', name: 'Zwift Sweet spot', moving_time: 3600, elapsed_time: 3700, distance: 32000,
    icu_training_load: 72, icu_weighted_avg_watts: 231, icu_ftp: 250, source: 'ZWIFT', external_id: 'zw-9',
    icu_zone_times: [{id: 'Z1', secs: 600}, {id: 'Z2', secs: 900}, {id: 'Z3', secs: 600}, {id: 'Z4', secs: 900},
                     {id: 'Z5', secs: 300}, {id: 'Z6', secs: 0}, {id: 'Z7', secs: 0}, {id: 'SS', secs: 300}],
};
const curve = {secs: [1, 5, 60, 300, 1200, 3600], watts: [1000, 900, 450, 320, 280, 260]};

test('sport', () => {
    for(const t of ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'TrackRide']) assert.equal(sportOf(t), 'cycling');
    assert.equal(sportOf('Run'), 'run');
    assert.equal(sportOf('WeightTraining'), 'weighttraining');
    assert.equal(sportOf(undefined), 'other');
});

test('stubs (Strava, blocked sources)', () => {
    assert.equal(isStub({id: 'x'}), true);
    assert.equal(isStub({id: 'x', start_date_local: '2026-11-20T18:00:00'}), true);
    assert.equal(isStub(ride), false);
});

test('best efforts from the power curve, in any of its shapes', () => {
    const want = {5: 900, 60: 450, 300: 320, 1200: 280, 3600: 260};
    assert.deepEqual(bestFromPowerCurve(curve), want);
    assert.deepEqual(bestFromPowerCurve({list: curve.secs.map((s, i) => ({secs: s, watts: curve.watts[i]}))}), want);
    assert.deepEqual(bestFromPowerCurve(curve.secs.map((s, i) => ({secs: s, watts: curve.watts[i]}))), want);
    assert.deepEqual(bestFromPowerCurve({secs: [5, 60], watts: [800, 400]}), {5: 800, 60: 400, 300: null, 1200: null, 3600: null});
    assert.deepEqual(bestFromPowerCurve(null), {5: null, 60: null, 300: null, 1200: null, 3600: null});
});

test('zone times onto Auuki\'s 7 zones, sweet spot into Z4', () => {
    assert.deepEqual(zonesFromZoneTimes(ride.icu_zone_times), [600, 900, 600, 1200, 300, 0, 0]);
    assert.deepEqual(zonesFromZoneTimes([10, 20, 30]), [10, 20, 30, 0, 0, 0, 0]);
    assert.deepEqual(zonesFromZoneTimes(undefined), [0, 0, 0, 0, 0, 0, 0]);
});

test('a cycling activity becomes a ride summary', () => {
    const s = toSummary(ride, {powerCurve: curve, auukiRideId: null});
    assert.equal(s.version, 1);
    assert.equal(s.id, 'icu-i101');
    assert.equal(s.source, 'intervals');
    assert.equal(s.sport, 'cycling');
    assert.equal(s.day, '2026-11-20');
    assert.equal(s.start, Date.parse('2026-11-20T17:00:00Z'));
    assert.equal(s.duration, 3600);
    assert.equal(s.tss, 72);
    assert.equal(s.np, 231);
    assert.equal(s.ftp, 250);
    assert.equal(s.distance, 32000);
    assert.equal(s.name, 'Zwift Sweet spot');
    assert.deepEqual(s.zoneSeconds, [600, 900, 600, 1200, 300, 0, 0]);
    assert.equal(s.best[1200], 280);
    assert.deepEqual(s.remote, {source: 'ZWIFT', externalId: 'zw-9'});
    assert.equal(s.auukiRideId, null);
});

test('a run counts for load only', () => {
    const s = toSummary({...ride, id: 'i102', type: 'Run', icu_training_load: 55, moving_time: undefined}, {powerCurve: curve});
    assert.equal(s.sport, 'run');
    assert.equal(s.tss, 55);
    assert.equal(s.duration, 3700); // elapsed_time when moving_time is missing
    assert.deepEqual(s.zoneSeconds, [0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(Object.values(s.best), [null, null, null, null, null]);
});

test('no load reported', () => {
    assert.equal(toSummary({...ride, icu_training_load: undefined}, {}).tss, null);
});

test('start falls back to the local time when no UTC start is given', () => {
    const s = toSummary({...ride, start_date: undefined}, {});
    assert.equal(s.day, '2026-11-20');
    assert.ok(Number.isFinite(s.start));
});
