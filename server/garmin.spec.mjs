// Garmin Personal API responses → ride summaries and health days.
// Field names follow Garmin Connect's services as far as known; the live
// check (Task 7) confirms them and adds tests for any real shape that differs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sportOf, toSummary, wellnessFrom, thresholdsFrom, WINDOW_DAYS } = require('./garmin.js');

const ride = {
    activityId: 1234567890, activityName: 'Zwift - Watopia', activityType: {typeKey: 'virtual_ride'},
    startTimeLocal: '2026-11-20 18:05:00', startTimeGMT: '2026-11-20 17:05:00',
    duration: 3725.4, movingDuration: 3700, distance: 35210.5,
    averageHR: 142, maxHR: 171, avgPower: 205, normPower: 221, trainingStressScore: 71.3, intensityFactor: 0.84,
    maxAvgPower_5: 612, maxAvgPower_60: 402, maxAvgPower_300: 301, maxAvgPower_1200: 268, maxAvgPower_3600: 219,
    powerTimeInZone_1: 300, powerTimeInZone_2: 900, powerTimeInZone_3: 1200, powerTimeInZone_4: 800,
    powerTimeInZone_5: 300, powerTimeInZone_6: 150, powerTimeInZone_7: 50,
};

test('sports: cycling types, runs, strength and others', () => {
    for(const k of ['road_biking', 'indoor_cycling', 'virtual_ride', 'cycling', 'mountain_biking', 'gravel_cycling', 'track_cycling', 'e_bike_fitness', 'e_bike_mountain'])
        assert.equal(sportOf(k), 'cycling', k);
    for(const k of ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run']) assert.equal(sportOf(k), 'run', k);
    assert.equal(sportOf('walking'), 'walk');
    assert.equal(sportOf('hiking'), 'hike');
    assert.equal(sportOf('lap_swimming'), 'swim');
    assert.equal(sportOf('open_water_swimming'), 'swim');
    assert.equal(sportOf('strength_training'), 'weighttraining');
    assert.equal(sportOf('yoga'), 'yoga');
    assert.equal(sportOf('rowing'), 'rowing');
    assert.equal(sportOf(undefined), 'other');
});

test('a ride with power', () => {
    const s = toSummary(ride);
    assert.equal(s.version, 1);
    assert.equal(s.id, 'garmin-1234567890');
    assert.equal(s.source, 'garmin');
    assert.deepEqual(s.remote, {source: 'garmin', externalId: '1234567890'});
    assert.equal(s.sport, 'cycling');
    assert.equal(s.start, Date.parse('2026-11-20T17:05:00Z'));
    assert.equal(s.day, '2026-11-20');
    assert.equal(s.name, 'Zwift - Watopia');
    assert.equal(s.duration, 3700);
    assert.equal(s.distance, 35210.5);
    assert.equal(s.tss, 71.3);
    assert.equal(s.if, 0.84);
    assert.equal(s.np, 221);
    assert.equal(s.avgPower, 205);
    assert.equal(s.kj, Math.round(205 * 3700 / 1000));
    // every duration the app keeps; Garmin's summary fills the ones it has
    assert.deepEqual(Object.keys(s.best).map(Number), require('./durations.js').DURATIONS);
    assert.deepEqual([5, 60, 300, 1200, 3600].map(d => s.best[d]), [612, 402, 301, 268, 219]);
    assert.deepEqual(s.zoneSeconds, [300, 900, 1200, 800, 300, 150, 50]);
    assert.equal(s.avgHr, 142);
    assert.equal(s.maxHr, 171);
    assert.equal(s.workoutId, null);
    assert.equal(s.auukiRideId, null);
});

test('a run: heart rate, no power', () => {
    const s = toSummary({activityId: 5, activityName: 'Lunch run', activityType: {typeKey: 'running'},
                         startTimeLocal: '2026-11-21 12:10:00', startTimeGMT: '2026-11-21 11:10:00',
                         duration: 2710, averageHR: 151, maxHR: 176, distance: 8120,
                         trainingStressScore: 55, avgPower: 260});  // running power doesn't count
    assert.equal(s.sport, 'run');
    assert.equal(s.avgHr, 151);
    assert.equal(s.tss, null);
    assert.equal(s.np, null);
    assert.equal(s.avgPower, null);
    assert.equal(s.kj, null);
    assert.deepEqual(s.zoneSeconds, [0, 0, 0, 0, 0, 0, 0]);
    assert.ok(Object.values(s.best).every(v => v === null));
});

test('a ride without power has no power numbers', () => {
    const s = toSummary({activityId: 6, activityType: {typeKey: 'road_biking'}, startTimeGMT: '2026-11-21 08:00:00',
                         startTimeLocal: '2026-11-21 09:00:00', duration: 5400, averageHR: 128});
    assert.equal(s.sport, 'cycling');
    assert.equal(s.tss, null);
    assert.equal(s.avgHr, 128);
    assert.deepEqual(s.zoneSeconds, [0, 0, 0, 0, 0, 0, 0]);
});

test('a minimal activity never throws (Review Focus 1)', () => {
    const s = toSummary({activityId: 9, startTimeLocal: '2026-11-20 21:30:00'});
    assert.equal(s.id, 'garmin-9');
    assert.equal(s.day, '2026-11-20');
    assert.equal(s.duration, 0);
    assert.equal(s.sport, 'other');
    assert.equal(s.name, 'Activity');
    assert.equal(toSummary({}), null);
    assert.equal(toSummary(null), null);
});

test('a late-evening local start keeps its local day; start is the UTC instant (Review Focus 5)', () => {
    const s = toSummary({activityId: 10, startTimeLocal: '2026-11-20 23:40:00', startTimeGMT: '2026-11-21 07:40:00', duration: 600});
    assert.equal(s.day, '2026-11-20');
    assert.equal(s.start, Date.parse('2026-11-21T07:40:00Z'));
});

test('health: one record per day, merged across endpoints', () => {
    const days = wellnessFrom({
        hrv: {hrvSummaries: [
            {calendarDate: '2026-11-20', lastNightAvg: 62, weeklyAvg: 58, status: 'BALANCED', baseline: {balancedLow: 52, balancedUpper: 66}},
            {calendarDate: '2026-11-21', lastNightAvg: 48, weeklyAvg: 56, status: 'UNBALANCED', baseline: {balancedLow: 52, balancedUpper: 66}},
        ]},
        daily: {data: [{calendarDate: '2026-11-20', restingHeartRate: 46}, {calendarDate: '2026-11-21', heartRate: {restingValue: 51}}]},
        sleep: [{calendarDate: '2026-11-20', sleepTimeSeconds: 27000, sleepScores: {overall: {value: 84}}},
                {dailySleepDTO: {calendarDate: '2026-11-21', sleepTimeSeconds: 21600, sleepScores: {overall: {value: 61}}}}],
        bodyBattery: [{date: '2026-11-20', bodyBatteryValuesArray: [[1, 35], [2, 88], [3, 70]]},
                      {calendarDate: '2026-11-21', bodyBatteryHighestValue: 54}],
        stress: [{calendarDate: '2026-11-20', values: {overallStressLevel: 28}}],
        weight: {dailyWeightSummaries: [{summaryDate: '2026-11-21', latestWeight: {weight: 74350}}]},
        vo2: [{generic: {calendarDate: '2026-11-20', vo2MaxPreciseValue: 57.4}, cycling: {calendarDate: '2026-11-20', vo2MaxPreciseValue: 59.1}}],
    });
    assert.deepEqual(days.get('2026-11-20'), {
        day: '2026-11-20', hrv: 62, hrvWeekly: 58, hrvStatus: 'BALANCED', hrvBaseline: {low: 52, high: 66},
        restingHr: 46, sleepSeconds: 27000, sleepScore: 84, bodyBattery: 88, stress: 28, vo2max: 59.1,
    });
    assert.deepEqual(days.get('2026-11-21'), {
        day: '2026-11-21', hrv: 48, hrvWeekly: 56, hrvStatus: 'UNBALANCED', hrvBaseline: {low: 52, high: 66},
        restingHr: 51, sleepSeconds: 21600, sleepScore: 61, bodyBattery: 54, weight: 74.35,
    });
});

test('health: empty or odd responses give no days, not errors', () => {
    assert.equal(wellnessFrom({}).size, 0);
    assert.equal(wellnessFrom({hrv: null, daily: {data: null}, sleep: 'x', stress: {values: [{}]}}).size, 0);
    // a stress response wrapped in {values: [...]}
    const d = wellnessFrom({stress: {values: [{calendarDate: '2026-11-22', values: {overallStressLevel: 31}}]}});
    assert.equal(d.get('2026-11-22').stress, 31);
    // weight as a list of dated entries
    const w = wellnessFrom({weight: {dateWeightList: [{calendarDate: '2026-11-22', weight: 75100}]}});
    assert.equal(w.get('2026-11-22').weight, 75.1);
});

test('threshold heart rate per sport from the heart-rate zones', () => {
    assert.deepEqual(thresholdsFrom([
        {sport: 'DEFAULT', lactateThresholdHeartRateUsed: 168},
        {sport: 'CYCLING', lactateThresholdHeartRateUsed: 163},
    ]), {cycling: 163, running: 168});
    assert.deepEqual(thresholdsFrom([{sport: 'RUNNING', lactateThresholdHeartRateUsed: 171}]), {cycling: null, running: 171});
    assert.deepEqual(thresholdsFrom(null), {cycling: null, running: null});
});

test('requests go in 28-day windows', () => {
    assert.equal(WINDOW_DAYS, 28);
});
