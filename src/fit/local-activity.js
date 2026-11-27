// @ts-check
//
// Soigneur Local Activity Encoder powered by Garmin's official @garmin/fitsdk.
//
// Encodes { records, laps, events, ftp, workout, sport } into a valid FIT 2.0
// binary DataView with header & file CRCs, proper semicircle coordinates,
// HRV RR-intervals, per-lap & session summaries, and absent sensors omitted.
//

import { Encoder, Profile, Utils } from '@garmin/fitsdk';
import { EventType } from '../activity/enums.js';

const FIT_EPOCH_MS = Utils.FIT_EPOCH_MS; // 631065600000 (1989-12-31T00:00:00Z)
const SEMICIRCLES_PER_DEGREE = 2147483648 / 180;
const SINT32_INVALID = 0x7FFFFFFF;
const UINT16_INVALID = 0xFFFF;

/**
 * Convert snake_case strings (e.g. 'stop_all', 'virtual_activity') to camelCase for @garmin/fitsdk Profile enums.
 * @param {string} value
 * @returns {string}
 */
function snakeToCamel(value) {
    return String(value).replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

/**
 * Convert a JS millisecond timestamp, Date, or FIT-epoch seconds into integer FIT seconds.
 * @param {number | Date | undefined | null} ts
 * @returns {number | undefined}
 */
function toFitTimestamp(ts) {
    const raw = ts instanceof Date ? ts.getTime() : ts;
    if(typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    const fitSec = raw >= 1e10 ? Math.round((raw - FIT_EPOCH_MS) / 1000) : Math.round(raw);
    return fitSec >= 0 ? fitSec : 0;
}

/**
 * Convert a timestamp input to Unix milliseconds for window comparisons.
 * @param {number | Date | undefined | null} ts
 * @returns {number | undefined}
 */
function toUnixMs(ts) {
    const raw = ts instanceof Date ? ts.getTime() : ts;
    if(typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return raw >= 1e10 ? raw : raw * 1000 + FIT_EPOCH_MS;
}

/**
 * Elapsed seconds between two timestamps using FIT second resolution.
 * @param {number | Date | undefined | null} start
 * @param {number | Date | undefined | null} end
 * @returns {number}
 */
function elapsedSeconds(start, end) {
    const s = toFitTimestamp(start);
    const e = toFitTimestamp(end);
    if(s === undefined || e === undefined) return 0;
    return Math.max(0, e - s);
}

/**
 * Check whether a record carries valid, non-Null-Island GPS coordinates.
 * @param {Record<string, any> | null | undefined} record
 * @returns {boolean}
 */
function hasValidGps(record) {
    if(!record) return false;
    const lat = record.position_lat ?? record.positionLat ?? record.lat;
    const lon = record.position_long ?? record.positionLong ?? record.lon;
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if(lat === 0 && lon === 0) return false;
    if(lat === SINT32_INVALID || lon === SINT32_INVALID) return false;
    if(lat === -2147483648 || lon === -2147483648) return false;
    return true;
}

/**
 * Convert degree coordinates (|lat| <= 90, |lon| <= 180) to FIT semicircles,
 * while preserving coordinates already in semicircles.
 * @param {number} lat
 * @param {number} lon
 * @returns {{ lat: number, lon: number }}
 */
function toFitPosition(lat, lon) {
    if(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return {
            lat: Math.round(lat * SEMICIRCLES_PER_DEGREE),
            lon: Math.round(lon * SEMICIRCLES_PER_DEGREE),
        };
    }
    return {lat: Math.round(lat), lon: Math.round(lon)};
}

/**
 * Return a copy of an object with all null/undefined properties omitted so @garmin/fitsdk
 * writes clean definitions containing only active fields.
 * @param {Record<string, any>} obj
 * @returns {Record<string, any>}
 */
function compact(obj) {
    /** @type {Record<string, any>} */
    const out = {};
    for(const [k, v] of Object.entries(obj)) {
        if(v !== undefined && v !== null) out[k] = v;
    }
    return out;
}

/**
 * Write a compacted FIT message to @garmin/fitsdk's Encoder.
 * @param {Encoder} encoder
 * @param {number} mesgNum
 * @param {Record<string, any>} fields
 */
function emitMesg(encoder, mesgNum, fields) {
    encoder.onMesg(mesgNum, /** @type {any} */ (compact(fields)));
}

/**
 * Sanitize raw app records into clean @garmin/fitsdk record & HRV payloads:
 *   - Indoor (0, 0) GPS placeholders and absent sensors (HR 0, ride-wide cadence 0,
 *     flat indoor altitude/grade 0, Moxy 0, core temp 0) become undefined (omitted).
 *   - Genuine sea-level altitude (0 m), flat grade (0 %), and coasting power/cadence (0)
 *     on rides that have those sensors/elevation are preserved.
 *
 * @param {Array<Record<string, any>>} [records]
 */
function sanitizeRecords(records = []) {
    const dataRecords = records.filter(r => r && r.time === undefined && toUnixMs(r.timestamp) !== undefined);
    const rideHasGps = dataRecords.some(hasValidGps);
    const rideHasElevation = rideHasGps || dataRecords.some(r =>
        (Number.isFinite(r.altitude) && r.altitude !== 0) ||
        (Number.isFinite(r.grade) && r.grade !== 0)
    );
    const rideHasCadence = dataRecords.some(r => Number.isFinite(r.cadence) && r.cadence > 0);

    /** @type {Array<{ kind: 'record', ms: number, mesg: Record<string, any> } | { kind: 'hrv', mesg: { time: Array<number | null> } }>} */
    const items = [];

    for(const r of records) {
        if(!r) continue;

        if(Array.isArray(r.time)) {
            const rr = r.time.map(v =>
                typeof v === 'number' && Number.isFinite(v) && v > 0 && v !== UINT16_INVALID && v < 65.535
                    ? v
                    : null
            );
            if(rr.some(v => v !== null)) {
                items.push({kind: 'hrv', mesg: {time: rr}});
            }
            continue;
        }

        const ms = toUnixMs(r.timestamp);
        const fitTs = toFitTimestamp(r.timestamp);
        if(ms === undefined || fitTs === undefined) continue;

        const gps = hasValidGps(r);
        const rawLat = r.position_lat ?? r.positionLat ?? r.lat;
        const rawLon = r.position_long ?? r.positionLong ?? r.lon;
        const pos = gps ? toFitPosition(rawLat, rawLon) : null;

        const hr = r.heart_rate ?? r.heartRate;
        const thb = r.total_hemoglobin_conc ?? r.totalHemoglobinConc;
        const smo2 = r.saturated_hemoglobin_percent ?? r.saturatedHemoglobinPercent;
        const coreTemp = r.core_temperature ?? r.coreTemperature;
        const stanceTime = r.stance_time ?? r.stanceTime;
        const vertOsc = r.vertical_oscillation ?? r.verticalOscillation;
        const stepLen = r.step_length ?? r.stepLength;
        const vertRatio = r.vertical_ratio ?? r.verticalRatio;
        const stanceBal = r.stance_time_balance ?? r.stanceTimeBalance;
        const lrBalance = r.left_right_balance ?? r.leftRightBalance;
        const respRate = r.respiration_rate ?? r.respirationRate;

        const hasMoxy = (Number.isFinite(thb) && thb > 0) || (Number.isFinite(smo2) && smo2 > 0);

        const mesg = compact({
            timestamp: fitTs,
            positionLat: pos ? pos.lat : undefined,
            positionLong: pos ? pos.lon : undefined,
            altitude: rideHasElevation && Number.isFinite(r.altitude) && r.altitude >= -500 && r.altitude <= 12600 ? r.altitude : undefined,
            grade: rideHasElevation && Number.isFinite(r.grade) ? r.grade : undefined,
            heartRate: Number.isFinite(hr) && hr > 0 && hr < 255 ? Math.round(hr) : undefined,
            cadence: rideHasCadence && Number.isFinite(r.cadence) && r.cadence >= 0 && r.cadence < 255 ? Math.round(r.cadence) : undefined,
            power: Number.isFinite(r.power) && r.power >= 0 && r.power < UINT16_INVALID ? Math.round(r.power) : undefined,
            speed: Number.isFinite(r.speed) && r.speed >= 0 && r.speed < 65.535 ? r.speed : undefined,
            distance: Number.isFinite(r.distance) && r.distance >= 0 ? r.distance : undefined,
            totalHemoglobinConc: Number.isFinite(thb) && thb > 0 ? thb : undefined,
            saturatedHemoglobinPercent: hasMoxy && Number.isFinite(smo2) && smo2 >= 0 && smo2 <= 100 ? smo2 : undefined,
            coreTemperature: Number.isFinite(coreTemp) && coreTemp > 0 ? coreTemp : undefined,
            temperature: Number.isFinite(r.temperature) && r.temperature > -128 && r.temperature < 127 ? Math.round(r.temperature) : undefined,
            stanceTime: Number.isFinite(stanceTime) && stanceTime > 0 ? stanceTime : undefined,
            verticalOscillation: Number.isFinite(vertOsc) && vertOsc > 0 ? vertOsc : undefined,
            stepLength: Number.isFinite(stepLen) && stepLen > 0 ? stepLen : undefined,
            verticalRatio: Number.isFinite(vertRatio) && vertRatio > 0 ? vertRatio : undefined,
            stanceTimeBalance: Number.isFinite(stanceBal) && stanceBal > 0 ? stanceBal : undefined,
            leftRightBalance: Number.isFinite(lrBalance) && lrBalance >= 0 ? Math.round(lrBalance) : undefined,
            respirationRate: Number.isFinite(respRate) && respRate > 0 && respRate < 255 ? Math.round(respRate) : undefined,
        });

        items.push({kind: 'record', ms, mesg});
    }

    return {items, rideHasGps};
}

/**
 * Check whether an event represents a timer stop/pause.
 * @param {Record<string, any>} ev
 */
function isStopEvent(ev) {
    const t = ev?.type ?? ev?.event_type ?? ev?.eventType;
    return t === EventType.stop || t === 1 || t === 4 || t === 8 || t === 9 ||
           t === 'stop_all' || t === 'stopAll' || t === 'stop_disable' || t === 'stopDisable' ||
           t === 'stop_disable_all' || t === 'stopDisableAll';
}

/**
 * Check whether an event represents a timer start.
 * @param {Record<string, any>} ev
 */
function isStartEvent(ev) {
    const t = ev?.type ?? ev?.event_type ?? ev?.eventType;
    return t === EventType.start || t === 0 || t === 'start';
}

/**
 * Compute total active timer time in seconds across records and start/stop events.
 * @param {Array<{ ms: number, mesg: Record<string, any> }>} recordItems
 * @param {Array<Record<string, any>>} events
 * @returns {number}
 */
function calcTotalTimerTime(recordItems, events) {
    if(events.length === 0) {
        if(recordItems.length > 1) {
            return elapsedSeconds(recordItems[0].ms, recordItems[recordItems.length - 1].ms);
        }
        return 0;
    }

    let total = 0;
    let openStart = undefined;
    for(const ev of events) {
        if(isStartEvent(ev)) {
            openStart = ev.timestamp;
        } else if(isStopEvent(ev) && openStart !== undefined) {
            total += elapsedSeconds(openStart, ev.timestamp);
            openStart = undefined;
        }
    }
    // If timer was started and never paired with a final stop event, close against the last record
    if(openStart !== undefined && recordItems.length > 0) {
        const lastMs = recordItems[recordItems.length - 1].ms;
        if(toUnixMs(openStart) !== undefined && lastMs > /** @type {number} */ (toUnixMs(openStart))) {
            total += elapsedSeconds(openStart, lastMs);
        }
    }
    if(total === 0 && recordItems.length > 1 && !events.some(isStopEvent)) {
        return elapsedSeconds(recordItems[0].ms, recordItems[recordItems.length - 1].ms);
    }
    return total;
}

/**
 * Compute total elapsed wall-clock time in seconds.
 * @param {Array<{ ms: number, mesg: Record<string, any> }>} recordItems
 * @param {Array<Record<string, any>>} laps
 * @param {Array<Record<string, any>>} events
 * @returns {number}
 */
function calcTotalElapsedTime(recordItems, laps, events) {
    const startMs = toUnixMs(events[0]?.timestamp) ?? recordItems[0]?.ms ?? toUnixMs(laps[0]?.start_time ?? laps[0]?.startTime);
    const lastLap = laps[laps.length - 1];
    const endMs = toUnixMs(lastLap?.timestamp) ?? recordItems[recordItems.length - 1]?.ms ?? toUnixMs(events[events.length - 1]?.timestamp);
    if(startMs === undefined || endMs === undefined) return 0;
    return elapsedSeconds(startMs, endMs);
}

/**
 * Compute active timer seconds for a single lap, subtracting paused intervals.
 * @param {number} lapStartMs
 * @param {number} lapEndMs
 * @param {Array<Record<string, any>>} events
 * @returns {number}
 */
function calcLapTimerTime(lapStartMs, lapEndMs, events) {
    const elapsed = elapsedSeconds(lapStartMs, lapEndMs);
    let paused = 0;
    for(let i = 0; i < events.length; i++) {
        const ev = events[i];
        const evMs = toUnixMs(ev?.timestamp);
        if(evMs !== undefined && evMs >= lapStartMs && evMs <= lapEndMs && isStopEvent(ev)) {
            const nextMs = toUnixMs(events[i + 1]?.timestamp) ?? lapEndMs;
            const clampedEnd = Math.min(nextMs, lapEndMs);
            paused += elapsedSeconds(evMs, clampedEnd);
        }
    }
    return elapsed - Math.max(0, Math.min(paused, elapsed));
}

/**
 * Aggregate power, HR, cadence, speed, distance, calories, Moxy, and core temperature
 * across a slice of sanitized record messages.
 * @param {Array<{ ms: number, mesg: Record<string, any> }>} recordItems
 * @param {number} timerSeconds
 */
function calcStats(recordItems, timerSeconds) {
    let sumPower = 0, countPower = 0, maxPower = 0;
    let sumCadence = 0, countCadence = 0, maxCadence = 0;
    let sumSpeed = 0, countSpeed = 0, maxSpeed = 0;
    let sumHr = 0, countHr = 0, maxHr = 0;
    let sumThb = 0, countThb = 0;
    let sumSmo2 = 0, countSmo2 = 0;
    let sumCore = 0, countCore = 0, maxCore = 0;
    /** @type {number | undefined} */
    let lastDistance;

    for(const {mesg} of recordItems) {
        if(Number.isFinite(mesg.power) && mesg.power >= 0) {
            sumPower += mesg.power;
            countPower += 1;
            if(mesg.power > maxPower) maxPower = mesg.power;
        }
        if(Number.isFinite(mesg.cadence) && mesg.cadence >= 0) {
            sumCadence += mesg.cadence;
            countCadence += 1;
            if(mesg.cadence > maxCadence) maxCadence = mesg.cadence;
        }
        if(Number.isFinite(mesg.speed) && mesg.speed >= 0) {
            sumSpeed += mesg.speed;
            countSpeed += 1;
            if(mesg.speed > maxSpeed) maxSpeed = mesg.speed;
        }
        if(Number.isFinite(mesg.heartRate) && mesg.heartRate > 0) {
            sumHr += mesg.heartRate;
            countHr += 1;
            if(mesg.heartRate > maxHr) maxHr = mesg.heartRate;
        }
        if(Number.isFinite(mesg.distance) && mesg.distance >= 0) {
            lastDistance = mesg.distance;
        }
        if(Number.isFinite(mesg.totalHemoglobinConc) && mesg.totalHemoglobinConc > 0) {
            sumThb += mesg.totalHemoglobinConc;
            countThb += 1;
        }
        if(Number.isFinite(mesg.saturatedHemoglobinPercent) && mesg.saturatedHemoglobinPercent >= 0) {
            sumSmo2 += mesg.saturatedHemoglobinPercent;
            countSmo2 += 1;
        }
        if(Number.isFinite(mesg.coreTemperature) && mesg.coreTemperature > 0) {
            sumCore += mesg.coreTemperature;
            countCore += 1;
            if(mesg.coreTemperature > maxCore) maxCore = mesg.coreTemperature;
        }
    }

    const avgPower = countPower > 0 ? Math.floor(sumPower / countPower) : undefined;
    const avgCadence = countCadence > 0 ? Math.floor(sumCadence / countCadence) : undefined;
    const avgSpeed = countSpeed > 0 ? sumSpeed / countSpeed : undefined;
    const avgHeartRate = countHr > 0 ? Math.floor(sumHr / countHr) : undefined;

    return {
        avgPower,
        maxPower: countPower > 0 ? maxPower : undefined,
        avgCadence,
        maxCadence: countCadence > 0 ? maxCadence : undefined,
        avgSpeed,
        maxSpeed: countSpeed > 0 ? maxSpeed : undefined,
        avgHeartRate,
        maxHeartRate: countHr > 0 ? maxHr : undefined,
        totalDistance: lastDistance,
        totalCalories: avgPower !== undefined ? Math.floor(avgPower * timerSeconds * 0.001) : undefined,
        avgTotalHemoglobinConc: countThb > 0 ? sumThb / countThb : undefined,
        avgSaturatedHemoglobinPercent: countSmo2 > 0 ? sumSmo2 / countSmo2 : undefined,
        avgCoreTemperature: countCore > 0 ? sumCore / countCore : undefined,
        maxCoreTemperature: countCore > 0 ? maxCore : undefined,
    };
}

/**
 * Compute per-lap summary stats over the records falling in [lapStartMs, lapEndMs],
 * with distance delta and fallback to pre-aggregated lap fields when needed.
 * @param {Array<{ ms: number, mesg: Record<string, any> }>} recordItems
 * @param {Record<string, any>} lap
 * @param {number} lapStartMs
 * @param {number} lapEndMs
 * @param {number} timerSeconds
 */
function calcLapStats(recordItems, lap, lapStartMs, lapEndMs, timerSeconds) {
    const windowRecords = recordItems.filter(r => r.ms >= lapStartMs && r.ms <= lapEndMs);
    const stats = calcStats(windowRecords, timerSeconds);

    /** @type {number | undefined} */
    let firstDist;
    /** @type {number | undefined} */
    let lastDist;
    for(const {mesg} of windowRecords) {
        if(Number.isFinite(mesg.distance) && mesg.distance >= 0) {
            if(firstDist === undefined) firstDist = mesg.distance;
            lastDist = mesg.distance;
        }
    }
    stats.totalDistance = firstDist !== undefined && lastDist !== undefined
        ? Math.max(0, lastDist - firstDist)
        : undefined;

    const fallbackAvgPwr = lap.avgPower ?? lap.avg_power;
    const fallbackMaxPwr = lap.maxPower ?? lap.max_power;
    const fallbackAvgCad = lap.avgCadence ?? lap.avg_cadence;
    const fallbackAvgHr = lap.avgHeartRate ?? lap.avg_heart_rate;

    if(stats.avgPower === undefined && Number.isFinite(fallbackAvgPwr)) stats.avgPower = Math.floor(fallbackAvgPwr);
    if(stats.maxPower === undefined && Number.isFinite(fallbackMaxPwr)) stats.maxPower = Math.floor(fallbackMaxPwr);
    if(stats.avgCadence === undefined && Number.isFinite(fallbackAvgCad) && fallbackAvgCad > 0) stats.avgCadence = Math.floor(fallbackAvgCad);
    if(stats.avgHeartRate === undefined && Number.isFinite(fallbackAvgHr) && fallbackAvgHr > 0) stats.avgHeartRate = Math.floor(fallbackAvgHr);
    if(stats.totalCalories === undefined && stats.avgPower !== undefined) {
        stats.totalCalories = Math.floor(stats.avgPower * timerSeconds * 0.001);
    }

    return stats;
}

/**
 * Optionally write structured workout + workout_step messages when args.workout has intervals/steps.
 * @param {Encoder} encoder
 * @param {Record<string, any> | null | undefined} workout
 * @param {number} ftp
 * @param {string} sport
 * @param {string} subSport
 */
function writeWorkoutMesgs(encoder, workout, ftp, sport, subSport) {
    if(!workout || typeof workout !== 'object') return;

    /** @type {Array<Record<string, any>>} */
    const rawSteps = [];
    if(Array.isArray(workout.intervals)) {
        for(const iv of workout.intervals) {
            if(Array.isArray(iv?.steps)) {
                for(const st of iv.steps) {
                    if(st && Number.isFinite(st.duration) && st.duration > 0) rawSteps.push(st);
                }
            } else if(iv && Number.isFinite(iv.duration) && iv.duration > 0) {
                rawSteps.push(iv);
            }
        }
    } else if(Array.isArray(workout.steps)) {
        for(const st of workout.steps) {
            if(st && Number.isFinite(st.duration) && st.duration > 0) rawSteps.push(st);
        }
    }

    if(rawSteps.length === 0) return;

    const wktName = String(workout.meta?.name ?? workout.name ?? 'Workout').trim() || 'Workout';
    const wktDesc = typeof workout.meta?.description === 'string' && workout.meta.description.trim() !== ''
        ? workout.meta.description.trim()
        : undefined;

    emitMesg(encoder, Profile.MesgNum.WORKOUT, {
        wktName,
        sport,
        subSport,
        numValidSteps: rawSteps.length,
        wktDescription: wktDesc,
    });

    const baseFtp = Number.isFinite(ftp) && ftp > 0 ? ftp : 200;

    rawSteps.forEach((step, idx) => {
        const pStart = Number.isFinite(step.power) ? step.power : (Number.isFinite(step.powerStart) ? step.powerStart : undefined);
        const pEnd = Number.isFinite(step.powerEnd) ? step.powerEnd : pStart;
        const hasPower = pStart !== undefined && pEnd !== undefined;

        // Power <= 5 is a fraction of FTP (e.g. 0.90); larger numbers are direct watts.
        // FIT workoutPower encodes absolute watts as (watts + 1000).
        let lowWatts;
        let highWatts;
        if(hasPower) {
            const w1 = Math.round((/** @type {number} */ (pStart) <= 5 ? /** @type {number} */ (pStart) * baseFtp : /** @type {number} */ (pStart)));
            const w2 = Math.round((/** @type {number} */ (pEnd) <= 5 ? /** @type {number} */ (pEnd) * baseFtp : /** @type {number} */ (pEnd)));
            lowWatts = 1000 + Math.max(0, Math.min(w1, w2));
            highWatts = 1000 + Math.max(0, Math.max(w1, w2));
        }

        const relPower = hasPower ? (/** @type {number} */ (pStart) <= 5 ? /** @type {number} */ (pStart) : /** @type {number} */ (pStart) / baseFtp) : 0.75;
        let intensity = 'active';
        if(idx === 0 && rawSteps.length > 2 && relPower < 0.75) intensity = 'warmup';
        else if(idx === rawSteps.length - 1 && rawSteps.length > 2 && relPower < 0.75) intensity = 'cooldown';
        else if(relPower <= 0.6) intensity = 'rest';

        const hasCadence = Number.isFinite(step.cadence) && step.cadence > 0;
        const stepName = typeof step.name === 'string' && step.name.trim() !== ''
            ? step.name.trim()
            : (typeof step.text === 'string' && step.text.trim() !== '' ? step.text.trim() : undefined);

        emitMesg(encoder, Profile.MesgNum.WORKOUT_STEP, {
            messageIndex: idx,
            wktStepName: stepName,
            durationType: 'time',
            durationValue: Math.round(step.duration * 1000),
            targetType: hasPower ? 'power' : 'open',
            targetValue: 0,
            customTargetValueLow: lowWatts,
            customTargetValueHigh: highWatts,
            intensity,
            secondaryTargetType: hasCadence ? 'cadence' : undefined,
            secondaryTargetValue: hasCadence ? 0 : undefined,
            secondaryCustomTargetValueLow: hasCadence ? Math.max(1, Math.round(step.cadence - 5)) : undefined,
            secondaryCustomTargetValueHigh: hasCadence ? Math.round(step.cadence + 5) : undefined,
        });
    });
}

/**
 * Encode a recorded Soigneur Studio session into a FIT 2.0 binary DataView.
 *
 * @param {{
 *   records?: Array<Record<string, any>>,
 *   laps?: Array<Record<string, any>>,
 *   events?: Array<Record<string, any>>,
 *   ftp?: number,
 *   workout?: Record<string, any> | null,
 *   sport?: string,
 * }} [args]
 * @returns {DataView}
 */
function encode(args = {}) {
    const rawRecords = args.records ?? [];
    const laps = args.laps ?? [];
    const events = args.events ?? [];
    const ftp = args.ftp ?? 200;
    const sport = args.sport ? snakeToCamel(args.sport) : 'cycling';

    const {items, rideHasGps} = sanitizeRecords(rawRecords);
    const recordItems = /** @type {Array<{ kind: 'record', ms: number, mesg: Record<string, any> }>} */ (
        items.filter(it => it.kind === 'record')
    );

    const fallbackNow = Date.now();
    const startMs = toUnixMs(events[0]?.start_time ?? events[0]?.timestamp) ??
                    recordItems[0]?.ms ??
                    toUnixMs(laps[0]?.start_time ?? laps[0]?.startTime) ??
                    fallbackNow;
    const lastLap = laps[laps.length - 1];
    const endMs = toUnixMs(lastLap?.timestamp) ??
                  recordItems[recordItems.length - 1]?.ms ??
                  toUnixMs(events[events.length - 1]?.timestamp) ??
                  startMs;

    const fitStart = toFitTimestamp(startMs) ?? toFitTimestamp(fallbackNow) ?? 0;
    const fitEnd = toFitTimestamp(endMs) ?? fitStart;
    const totalElapsedTime = calcTotalElapsedTime(recordItems, laps, events);
    const totalTimerTime = calcTotalTimerTime(recordItems, events);
    const sessionStats = calcStats(recordItems, totalTimerTime);
    const subSport = rideHasGps ? 'generic' : 'virtualActivity';

    const encoder = new Encoder();

    // 1. file_id (must be the first message in every FIT file)
    emitMesg(encoder, Profile.MesgNum.FILE_ID, {
        type: 'activity',
        manufacturer: 'garmin',
        product: 3570,
        serialNumber: 3313379353,
        timeCreated: fitEnd,
        number: 0,
    });

    // 2. file_creator
    emitMesg(encoder, Profile.MesgNum.FILE_CREATOR, {
        softwareVersion: 29,
    });

    // 3. Optional structured workout + workout_step metadata
    if(args.workout) {
        writeWorkoutMesgs(encoder, args.workout, ftp, sport, subSport);
    }

    // 4. Interleaved record and hrv messages in chronological order
    for(const item of items) {
        if(item.kind === 'hrv') {
            encoder.onMesg(Profile.MesgNum.HRV, /** @type {any} */ (item.mesg));
        } else {
            encoder.onMesg(Profile.MesgNum.RECORD, /** @type {any} */ (item.mesg));
        }
    }

    // 5. Timer / session events
    for(const ev of events) {
        if(!ev) continue;
        const evTs = toFitTimestamp(ev.timestamp);
        if(evTs === undefined) continue;
        const rawEvent = ev.event ?? 'timer';
        const rawEventType = ev.type ?? ev.event_type ?? ev.eventType ?? 'start';
        emitMesg(encoder, Profile.MesgNum.EVENT, {
            timestamp: evTs,
            event: typeof rawEvent === 'string' ? snakeToCamel(rawEvent) : rawEvent,
            eventType: typeof rawEventType === 'string' ? snakeToCamel(rawEventType) : rawEventType,
            eventGroup: ev.event_group ?? ev.eventGroup ?? 0,
        });
    }

    // 6. Laps with per-lap summary statistics
    laps.forEach((lap, index) => {
        if(!lap) return;
        const lapStartMs = toUnixMs(lap.start_time ?? lap.startTime);
        const lapEndMs = toUnixMs(lap.timestamp);
        if(lapStartMs === undefined || lapEndMs === undefined) return;

        const lapElapsed = elapsedSeconds(lapStartMs, lapEndMs);
        const lapTimer = calcLapTimerTime(lapStartMs, lapEndMs, events);
        const lapStats = calcLapStats(recordItems, lap, lapStartMs, lapEndMs, lapTimer);
        const isLastLap = index === laps.length - 1;
        const rawTrigger = lap.lap_trigger ?? lap.lapTrigger;
        const lapTrigger = rawTrigger !== undefined
            ? (typeof rawTrigger === 'string' ? snakeToCamel(rawTrigger) : rawTrigger)
            : (isLastLap ? 'sessionEnd' : 'manual');
        const rawIntensity = lap.intensity;
        const intensity = rawIntensity !== undefined
            ? (typeof rawIntensity === 'string' ? snakeToCamel(rawIntensity) : rawIntensity)
            : 'active';

        emitMesg(encoder, Profile.MesgNum.LAP, {
            messageIndex: index,
            timestamp: toFitTimestamp(lapEndMs),
            startTime: toFitTimestamp(lapStartMs),
            totalElapsedTime: lapElapsed,
            totalTimerTime: lapTimer,
            event: 'lap',
            eventType: 'stop',
            sport,
            subSport,
            lapTrigger,
            intensity,
            ...lapStats,
        });
    });

    // 7. Session summary
    emitMesg(encoder, Profile.MesgNum.SESSION, {
        messageIndex: 0,
        timestamp: fitEnd,
        startTime: fitStart,
        totalElapsedTime,
        totalTimerTime,
        event: 'session',
        eventType: 'stop',
        trigger: 'activityEnd',
        sport,
        subSport,
        firstLapIndex: 0,
        numLaps: laps.length,
        thresholdPower: Number.isFinite(ftp) && ftp > 0 ? Math.round(ftp) : undefined,
        ...sessionStats,
    });

    // 8. Activity footer
    emitMesg(encoder, Profile.MesgNum.ACTIVITY, {
        timestamp: fitEnd,
        totalTimerTime,
        numSessions: 1,
        type: 'manual',
        event: 'activity',
        eventType: 'stop',
    });

    const bytes = encoder.close();
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const localActivity = Object.freeze({
    encode,
});

export {
    localActivity,
    toFitTimestamp,
    toFitPosition,
    sanitizeRecords,
};
