// @ts-check
'use strict';

//
// Garmin Personal API responses → Auuki ride summaries and health days.
//
// Pure functions, no I/O. Field names follow Garmin Connect's services as
// far as known; everything is read defensively (several candidate names,
// several response wrappers), and a missing field leaves the value out
// instead of failing. The live check confirms the real shapes.
//

const WINDOW_DAYS = 28;      // days per health request (some endpoints cap a range near a month)
const { DURATIONS: WINDOWS } = require('./durations.js');
const SUMMARY_VERSION = 1;

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null));
const first = (...xs) => { for(const x of xs) { const n = num(x); if(n !== null) return n; } return null; };

// "2026-11-20 17:05:00" (or ISO) as UTC → ms
function utcMs(s) {
    if(typeof s !== 'string' || s.length < 10) return null;
    const iso = s.trim().replace(' ', 'T');
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
    return Number.isFinite(t) ? t : null;
}

function dayOf(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

const CYCLING = /(cycling|biking|_ride$|^ride$|virtual_ride|e_bike|bmx|cyclocross)/;

function sportOf(typeKey) {
    const k = String(typeKey ?? '').toLowerCase();
    if(!k) return 'other';
    if(CYCLING.test(k)) return 'cycling';
    if(/running|_run$|^run$/.test(k)) return 'run';
    if(/swimming|swim/.test(k)) return 'swim';
    if(/walking|^walk/.test(k)) return 'walk';
    if(/hiking/.test(k)) return 'hike';
    if(k === 'strength_training') return 'weighttraining';
    return k;
}

function toSummary(a) {
    if(!a || typeof a !== 'object') return null;
    const id = a.activityId ?? a.activityID ?? a.id;
    const day = dayOf(a.startTimeLocal) ?? dayOf(a.startTimeGMT);
    if(id == null || !day) return null;

    const sport = sportOf(a.activityType?.typeKey ?? a.activityTypeDTO?.typeKey ?? a.activityType);
    const duration = Math.round(first(a.movingDuration, a.duration, a.elapsedDuration) ?? 0);
    const cycling = sport === 'cycling';
    const avgPower = cycling ? first(a.avgPower, a.averagePower) : null;
    const hasPower = cycling && (avgPower > 0 || first(a.normPower, a.normalizedPower) > 0);
    const p = (x) => (hasPower ? x : null);

    const best = {};
    for(const w of WINDOWS) best[w] = p(first(a[`maxAvgPower_${w}`]));
    const zones = Array.from({length: 7}, (_, i) => first(a[`powerTimeInZone_${i + 1}`]));
    const zoneSeconds = hasPower && zones.every(z => z !== null) ? zones.map(Math.round) : Array(7).fill(0);

    const start = utcMs(a.startTimeGMT) ?? utcMs(a.startTimeLocal);
    return {
        version: SUMMARY_VERSION,
        id: `garmin-${id}`,
        source: 'garmin',
        sport,
        start,
        day,
        name: typeof a.activityName === 'string' && a.activityName.trim() ? a.activityName : 'Activity',
        workoutId: null,
        duration,
        distance: first(a.distance),
        tss: p(first(a.trainingStressScore)),
        if: p(first(a.intensityFactor)),
        np: p(first(a.normPower, a.normalizedPower)),
        avgPower: p(avgPower),
        kj: hasPower && avgPower > 0 ? Math.round(avgPower * duration / 1000) : null,
        zoneSeconds,
        best,
        avgHr: first(a.averageHR, a.averageHr, a.avgHr),
        maxHr: first(a.maxHR, a.maxHr),
        ftp: first(a.functionalThresholdPower, a.ftp),
        weight: null,
        remote: {source: 'garmin', externalId: String(id)},
        auukiRideId: null,
    };
}

// the list inside a response: an array, or the first array-valued field
function listOf(res, ...keys) {
    if(Array.isArray(res)) return res;
    if(!res || typeof res !== 'object') return [];
    for(const k of keys) if(Array.isArray(res[k])) return res[k];
    return [];
}

function wellnessFrom({hrv = undefined, daily = undefined, sleep = undefined, bodyBattery = undefined, stress = undefined, weight = undefined, vo2 = undefined} = {}) {
    const days = new Map();
    const set = (day, key, value) => {
        if(!day || value === null || value === undefined) return;
        if(!days.has(day)) days.set(day, {day});
        days.get(day)[key] = value;
    };

    for(const h of listOf(hrv, 'hrvSummaries', 'data')) {
        const day = dayOf(h?.calendarDate);
        set(day, 'hrv', first(h?.lastNightAvg, h?.lastNight));
        set(day, 'hrvWeekly', first(h?.weeklyAvg));
        if(typeof h?.status === 'string') set(day, 'hrvStatus', h.status);
        const low = first(h?.baseline?.balancedLow), high = first(h?.baseline?.balancedUpper, h?.baseline?.balancedHigh);
        if(low !== null && high !== null) set(day, 'hrvBaseline', {low, high});
    }
    for(const d of listOf(daily, 'data', 'dailySummaries')) {
        set(dayOf(d?.calendarDate), 'restingHr', first(d?.restingHeartRate, d?.heartRate?.restingValue, d?.restingHeartRateValue));
    }
    for(const raw of listOf(sleep, 'dailySleepSummaries', 'data')) {
        const s = raw?.dailySleepDTO ?? raw;
        const day = dayOf(s?.calendarDate);
        set(day, 'sleepSeconds', first(s?.sleepTimeSeconds));
        set(day, 'sleepScore', first(s?.sleepScores?.overall?.value, s?.sleepScore, raw?.sleepScore));
    }
    for(const b of listOf(bodyBattery, 'data')) {
        const day = dayOf(b?.calendarDate ?? b?.date);
        const values = Array.isArray(b?.bodyBatteryValuesArray) ?
              b.bodyBatteryValuesArray.map(v => num(Array.isArray(v) ? v[1] : null)).filter(v => v !== null) : [];
        set(day, 'bodyBattery', first(b?.bodyBatteryHighestValue, b?.highest, values.length ? Math.max(...values) : null));
    }
    for(const s of listOf(stress, 'values', 'data')) {
        set(dayOf(s?.calendarDate), 'stress', first(s?.values?.overallStressLevel, s?.overallStressLevel, s?.averageStressLevel));
    }
    const grams = (g) => (g === null ? null : Math.round(g / 10) / 100);   // g → kg, 2 decimals
    for(const w of listOf(weight, 'dailyWeightSummaries', 'dateWeightList')) {
        const day = dayOf(w?.summaryDate ?? w?.calendarDate);
        set(day, 'weight', grams(first(w?.latestWeight?.weight, w?.weight)));
    }
    for(const v of listOf(vo2, 'data')) {
        const day = dayOf(v?.cycling?.calendarDate ?? v?.generic?.calendarDate ?? v?.calendarDate);
        set(day, 'vo2max', first(v?.cycling?.vo2MaxPreciseValue, v?.cycling?.vo2MaxValue,
                                 v?.generic?.vo2MaxPreciseValue, v?.generic?.vo2MaxValue, v?.vo2MaxValue));
    }
    return days;
}

function thresholdsFrom(zones) {
    const list = listOf(zones, 'data');
    const of = (sport) => first(list.find(z => String(z?.sport).toUpperCase() === sport)?.lactateThresholdHeartRateUsed);
    const def = of('DEFAULT');
    return {cycling: of('CYCLING') ?? def, running: of('RUNNING') ?? def};
}

module.exports = { sportOf, toSummary, wellnessFrom, thresholdsFrom, utcMs, WINDOW_DAYS };
