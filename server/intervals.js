// @ts-check
'use strict';

//
// intervals.icu activities as Auuki ride summaries (the shape the Training
// page uses, see src/training/summary.js). Pure functions; the shapes of
// the power curve and zone times are read defensively, since the API docs
// don't show them in full.
//

const SUMMARY_VERSION = 1;
const { DURATIONS: WINDOWS } = require('./durations.js');
const CYCLING = new Set(['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'TrackRide']);
const SWEET_SPOT_ZONE = 3; // Auuki's Z4 "Sweet Spot"

function sportOf(type) {
    if(!type) return 'other';
    return CYCLING.has(type) ? 'cycling' : String(type).toLowerCase();
}

function isStub(a) {
    if(!a || typeof a.start_date_local !== 'string') return true;
    return !Number.isFinite(a.moving_time) && !Number.isFinite(a.elapsed_time);
}

function curvePoints(curve) {
    if(!curve) return [];
    if(Array.isArray(curve)) return curve;
    if(Array.isArray(curve.list)) return curve.list;
    if(Array.isArray(curve.secs) && Array.isArray(curve.watts ?? curve.values)) {
        const watts = curve.watts ?? curve.values;
        return curve.secs.map((secs, i) => ({secs, watts: watts[i]}));
    }
    return [];
}

function bestFromPowerCurve(curve) {
    const points = curvePoints(curve);
    const best = {};
    for(const w of WINDOWS) {
        const p = points.find(x => Number(x?.secs) === w);
        const watts = Number(p?.watts ?? p?.value);
        best[w] = Number.isFinite(watts) && watts > 0 ? Math.round(watts) : null;
    }
    return best;
}

function zonesFromZoneTimes(zoneTimes) {
    const zones = Array(7).fill(0);
    if(!Array.isArray(zoneTimes)) return zones;
    zoneTimes.forEach((z, i) => {
        if(Number.isFinite(z)) { if(i < 7) zones[i] += z; return; }
        const secs = Number(z?.secs);
        if(!Number.isFinite(secs)) return;
        const id = String(z.id ?? '');
        const m = /^Z(\d)$/i.exec(id);
        if(m && Number(m[1]) >= 1 && Number(m[1]) <= 7) zones[Number(m[1]) - 1] += secs;
        else if(id.toUpperCase() === 'SS') zones[SWEET_SPOT_ZONE] += secs;
    });
    return zones;
}

function num(x) {
    return Number.isFinite(x) ? x : null;
}

function toSummary(a, {powerCurve = null, auukiRideId = null} = {}) {
    const sport = sportOf(a.type);
    const cycling = sport === 'cycling';
    const start = Number.isFinite(Date.parse(a.start_date)) ? Date.parse(a.start_date) : Date.parse(a.start_date_local);
    return {
        version:   SUMMARY_VERSION,
        id:        `icu-${a.id}`,
        source:    'intervals',
        sport,
        start,
        day:       a.start_date_local.slice(0, 10),
        name:      a.name || a.type || 'Activity',
        workoutId: null,
        duration:  num(a.moving_time) ?? num(a.elapsed_time) ?? 0,
        distance:  num(a.distance),
        tss:       num(a.icu_training_load),
        if:        num(a.icu_intensity) !== null ? a.icu_intensity / 100 : null,
        np:        num(a.icu_weighted_avg_watts),
        avgPower:  num(a.icu_average_watts),
        kj:        Number.isFinite(a.icu_joules) ? Math.round(a.icu_joules / 1000) : null,
        zoneSeconds: cycling ? zonesFromZoneTimes(a.icu_zone_times) : Array(7).fill(0),
        best:      cycling ? bestFromPowerCurve(powerCurve) : bestFromPowerCurve(null),
        avgHr:     num(a.average_heartrate), // for a heart-rate load when there is no load
        maxHr:     num(a.max_heartrate),
        ftp:       num(a.icu_ftp),
        weight:    num(a.icu_weight),
        remote:    {source: a.source ?? null, externalId: a.external_id ?? null},
        auukiRideId: auukiRideId ?? null,
    };
}

module.exports = { sportOf, isStub, bestFromPowerCurve, zonesFromZoneTimes, toSummary, WINDOWS, SUMMARY_VERSION };
