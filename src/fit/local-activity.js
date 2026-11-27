//
// Local Activity Encoder
//

import { first, last, empty, expect, } from '../functions.js';
import { profiles } from './profiles/profiles.js';
import productMessageDefinitions from './profiles/product-message-definitions.js';
import { CRC } from './crc.js';
import { fileHeader } from './file-header.js';
import { definitionRecord } from './definition-record.js';
import { dataRecord } from './data-record.js';
import { type } from './common.js';
import { FITjs } from './fitjs.js';
import { EventType } from '../activity/enums.js';

function LocalActivity(args = {}) {
    const definitions = productMessageDefinitions
          .reduce(function(acc, x) {
              const d = definitionRecord.toFITjs(x);
              acc[d.name] = d;
              return acc;
          }, {});

    // [FITjs] -> {fileSize: Int, dataSize: Int}
    function getSize(fitjs) {
        // byteLength of the whole file start to end
        // this is needed for the DataView size
        const fileSize = fitjs.reduce(
            (acc, x) => acc += (x?.length ?? 0), 0
        );

        // byteLength of the file minus the File Header and the CRC
        // this is needed for the dataSize field in the file header
        const header = first(fitjs);
        const dataSize = fileSize - (header.length + CRC.size);

        return {
            fileSize,
            dataSize,
        };
    }

    // [Record] -> Record?
    function findFirstRecord(records = []) {
        for(let i = 0; i < records.length; i+=1) {
            if(records[i].timestamp !== undefined) {
                return records[i];
            }
        }
        console.error(`:fit :records 'has no valid records'`);
        return records[0];
    }

    // [Record] -> Record?
    function findLastRecord(records = []) {
        for(let i = records.length-1; i >= 0 ; i-=1) {
            if(records[i].timestamp !== undefined) {
                return records[i];
            }
        }
        console.error(`:fit :records 'has no valid records'`);
        return records[0];
    }

    // {records: [Record], events: [Event]} -> Int
    function calcTotalTimerTime(args) {
        const records = args.records ?? [];
        const events = args.events ?? [];

        // fallbacks
        if(empty(events)) {
            if(records.length > 1) {
                // if no events are recorded fallback to first and last record
                return type.timestamp.elapsed(
                    // TODO: handle record is not guaranteed to be a Record
                    findFirstRecord(records)?.timestamp,
                    findLastRecord(records)?.timestamp
                );
            } else {
                // if no events are recorded and no more than one record return 0
                console.warn(`fit: calcTotalTimerTime: 'not enough records'`);
                return 0;
            }
        }

        // sum the difference between start and stop event pairs
        return events.reduce(function(acc, event, i) {
            if(event.type === EventType.stop) {
                const startEvent = events[i-1] ?? undefined;
                if(startEvent?.type === EventType.start) {
                    // all good
                    acc += type.timestamp.elapsed(
                        startEvent?.timestamp, event?.timestamp,
                    );
                } else {
                    // we are at a stop event, but the prev event is not start
                    console.warn(`fit: calcTotalTimerTime: 'invalid event order'`);
                }
                return acc;
            }
            return acc;
        }, 0);
    }

    // {records: [Record], laps: [Lap], events: [Event], } -> Int
    function calcTotalElapsedTime(args) {
        const records = args.records ?? [];
        const laps = args.laps ?? [];
        const events = args.events ?? [];

        if(records.length < 2) {
            console.warn(`fit: calcTotalElapsedTime: 'not enough records'`);
            return 0;
        }

        const start_time = first(events)?.timestamp ?? findFirstRecord(records)?.timestamp;
        const timestamp = last(laps)?.timestamp ?? findLastRecord(records)?.timestamp;

        return type.timestamp.elapsed(start_time, timestamp);
    }



    // {
    //     timestamp: Int,
    //     start_time: Int,
    //     totalElapsedTime: Int,
    //     avgPower: Int,
    //     maxPower: Int,
    //     avgCadence: Double,
    //     avgHeartRate: Double,
    //     saturated_hemoglobin_percent: Double,
    //     total_hemoglobin_conc: Double,
    //     core_temperature: Double,
    //     skin_temperature: Double
    // },
    // [{ timestamp: Int, type: EventType, }]
    // ->
    // Int
    function calcLapTotalTimerTime(lap, events) {
        const _lap = expect(lap, `calcLapTotalTimerTime needs lap: Lap.`);
        const _events = events ?? [];

        const pausedTime = _events.reduce(function(acc, event, i) {
            if(event.timestamp >= _lap.start_time &&
               event.timestamp <= _lap.timestamp &&
               event.type === EventType.stop) {
                // continue only if the event overlaps with the lap
                const startEvent = _events[i+1] ?? {timestamp: _lap.timestamp};
                const stopEvent = event;

                let startTime = stopEvent.timestamp;
                let endTime = startEvent.timestamp;

                if(endTime > _lap.timestamp) {
                    // clamp to lap start and end times
                    endTime = _lap.timestamp;
                }

                acc += type.timestamp.elapsed(startTime, endTime);
            }

            return acc;
        }, 0);

        const elapsedTime = calcLapTotalElapsedTime(lap);

        return elapsedTime - Math.max(0, Math.min(pausedTime, elapsedTime));
    }


    // {
    //     timestamp: Int,
    //     start_time: Int,
    //     totalElapsedTime: Int,
    //     avgPower: Int,
    //     maxPower: Int,
    //     avgCadence: Double,
    //     avgHeartRate: Double,
    //     saturated_hemoglobin_percent: Double,
    //     total_hemoglobin_conc: Double,
    //     core_temperature: Double,
    //     skin_temperature: Double
    // },
    // ->
    // Int
    function calcLapTotalElapsedTime(lap) {
        return type.timestamp.elapsed(lap.start_time, lap.timestamp);
    }

    const SEMICIRCLES_PER_DEGREE = 2147483648 / 180;

    function hasValidGps(record) {
        return Number.isFinite(record?.position_lat) &&
               Number.isFinite(record?.position_long) &&
               !(record.position_lat === 0 && record.position_long === 0);
    }

    function toFitPosition(lat, lon) {
        // Coordinates within degree bounds are converted to FIT semicircles;
        // larger magnitudes are already in semicircles (e.g. FIT courses).
        if(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            return {
                lat: Math.round(lat * SEMICIRCLES_PER_DEGREE),
                lon: Math.round(lon * SEMICIRCLES_PER_DEGREE),
            };
        }
        return {lat: Math.round(lat), lon: Math.round(lon)};
    }

    // Normalize records before encoding so absent sensors and indoor (0, 0)
    // placeholders write FIT base-type invalid sentinels instead of 0.
    function sanitizeRecords(records = []) {
        const dataRecords = records.filter(r => r && r.time === undefined);
        const rideHasGps = dataRecords.some(hasValidGps);
        const rideHasElevation = rideHasGps || dataRecords.some(r =>
            (Number.isFinite(r.altitude) && r.altitude !== 0) ||
            (Number.isFinite(r.grade) && r.grade !== 0)
        );
        const rideHasCadence = dataRecords.some(r => Number.isFinite(r.cadence) && r.cadence > 0);

        return records.map(r => {
            if(!r || r.time !== undefined) return r;
            const gps = hasValidGps(r);
            const pos = gps ? toFitPosition(r.position_lat, r.position_long) : null;
            const moxy = (Number.isFinite(r.total_hemoglobin_conc) && r.total_hemoglobin_conc > 0) ||
                         (Number.isFinite(r.saturated_hemoglobin_percent) && r.saturated_hemoglobin_percent > 0);
            return {
                ...r,
                position_lat:  pos ? pos.lat : undefined,
                position_long: pos ? pos.lon : undefined,
                altitude:      rideHasElevation && Number.isFinite(r.altitude) ? r.altitude : undefined,
                grade:         rideHasElevation && Number.isFinite(r.grade) ? r.grade : undefined,
                heart_rate:    Number.isFinite(r.heart_rate) && r.heart_rate > 0 ? r.heart_rate : undefined,
                cadence:       rideHasCadence && Number.isFinite(r.cadence) && r.cadence >= 0 ? r.cadence : undefined,
                power:         Number.isFinite(r.power) && r.power >= 0 ? r.power : undefined,
                speed:         Number.isFinite(r.speed) && r.speed >= 0 ? r.speed : undefined,
                distance:      Number.isFinite(r.distance) && r.distance >= 0 ? r.distance : undefined,
                total_hemoglobin_conc:        Number.isFinite(r.total_hemoglobin_conc) && r.total_hemoglobin_conc > 0 ? r.total_hemoglobin_conc : undefined,
                saturated_hemoglobin_percent: moxy && Number.isFinite(r.saturated_hemoglobin_percent) && r.saturated_hemoglobin_percent >= 0 ? r.saturated_hemoglobin_percent : undefined,
                core_temperature:             Number.isFinite(r.core_temperature) && r.core_temperature > 0 ? r.core_temperature : undefined,
                device_index:                 r.device_index ?? 0,
            };
        });
    }

    // {records: [Record], total_timer_time: Int}
    // ->
    // Stats
    function calcStats(args = {}) {
        const records = expect(
            args.records,
            `fit: calcStats: needs records: []`
        );
        const total_timer_time = expect(
            args.total_timer_time,
            `fit: calcStats: needs total_timer_tim: Int`
        );

        const validRecords = records.filter(record => record && record.timestamp !== undefined);

        let sumPower = 0, countPower = 0, maxPower = 0;
        let sumCadence = 0, countCadence = 0, maxCadence = 0;
        let sumSpeed = 0, countSpeed = 0, maxSpeed = 0;
        let sumHr = 0, countHr = 0, maxHr = 0;
        let lastDistance;

        for(const record of validRecords) {
            if(Number.isFinite(record.power) && record.power >= 0) {
                sumPower += record.power;
                countPower += 1;
                if(record.power > maxPower) maxPower = record.power;
            }
            if(Number.isFinite(record.cadence) && record.cadence >= 0) {
                sumCadence += record.cadence;
                countCadence += 1;
                if(record.cadence > maxCadence) maxCadence = record.cadence;
            }
            if(Number.isFinite(record.speed) && record.speed >= 0) {
                sumSpeed += record.speed;
                countSpeed += 1;
                if(record.speed > maxSpeed) maxSpeed = record.speed;
            }
            if(Number.isFinite(record.heart_rate) && record.heart_rate > 0) {
                sumHr += record.heart_rate;
                countHr += 1;
                if(record.heart_rate > maxHr) maxHr = record.heart_rate;
            }
            if(Number.isFinite(record.distance) && record.distance >= 0) {
                lastDistance = record.distance;
            }
        }

        const avg_power = countPower > 0 ? Math.floor(sumPower / countPower) : undefined;
        const avg_cadence = countCadence > 0 ? Math.floor(sumCadence / countCadence) : undefined;
        const avg_speed = countSpeed > 0 ? sumSpeed / countSpeed : undefined;
        const avg_heart_rate = countHr > 0 ? Math.floor(sumHr / countHr) : undefined;

        return {
            avg_power,
            avg_cadence,
            avg_speed,
            avg_heart_rate,
            max_power: countPower > 0 ? maxPower : undefined,
            max_cadence: countCadence > 0 ? maxCadence : undefined,
            max_speed: countSpeed > 0 ? maxSpeed : undefined,
            max_heart_rate: countHr > 0 ? maxHr : undefined,
            total_distance: lastDistance,
            total_calories: avg_power !== undefined ? Math.floor(avg_power * total_timer_time * 0.001) : undefined,
        };
    }

    function timestampToDate(x) {
        const timeKeys = ['time_created', 'start_time', 'timestamp'];
        for(let timeKey of timeKeys) {
            if(x[timeKey]) {
                x[timeKey] = new Date(x[timeKey]);
            }
        }
        return x;
    }

    function printAppData(records, laps, events) {
        const _records = window.structuredClone(records);
        const _laps = window.structuredClone(laps);
        const _events = window.structuredClone(events);
        console.log('----');
        console.log('records');
        console.log(_records.map(timestampToDate));
        // console.log(records);
        console.log('laps');
        console.log(_laps.map(timestampToDate));
        // console.log(laps);
        console.log('events');
        console.log(_events.map(timestampToDate));
        // console.log(events);
        console.log('----');
    }

    function printFITjs(structure) {
        const select = ['record', 'event', 'lap', 'session', 'activity'];

        console.log('----');
        const _structure = window.structuredClone(structure);
        const _filtered = [];
        for(let record of _structure) {
            if(record.type === "data") {
                if(record.fields) {
                    timestampToDate(record.fields);
                }
                if(select.includes(record.name)) {
                    _filtered.push(record);
                }
            }
        }
        console.log(_filtered);
        console.log('----');
    }

    // {records: [{<field>: Any}], laps: [{<field>: Any}]}
    // ->
    // [FITjs]
    function toFITjs(args = {}) {
        const records = sanitizeRecords(args.records ?? []);
        const laps = args.laps ?? [];
        const events = args.events ?? [];
        const ftp = args.ftp ?? 200;

        // printAppData(records, laps, events);

        const activity_start_time = first(events)?.start_time ?? findFirstRecord(records).timestamp;
        const time_created = last(laps)?.timestamp ?? findLastRecord(records)?.timestamp;
        const timestamp    = time_created;
        const total_elapsed_time = calcTotalElapsedTime({records, laps, events});
        const total_timer_time = calcTotalTimerTime({records, events});
        const stats = calcStats({records, total_timer_time});

        // structure: FITjs
        const structure = [
            // file header
            FileHeader(),

            // definition file_id
            definitions.file_id,
            // data file_id
            dataRecord.toFITjs(
                definitions.file_id,
                FileId({
                    time_created,
                    manufacturer:  1,    // garmin
                    product:       3570, // edge 1030
                    serial_number: 3313379353,
                })
            ),

            // definition file_creator
            definitions.file_creator,
            // data file_creator
            dataRecord.toFITjs(
                definitions.file_creator,
                FileCreator({
                    software_version: 29, // edge 1030
                })
            ),

            // definition record
            definitions.record,
            // definition hrv
            definitions.hrv,
            // data record messages
            ...records.map((record) =>
                dataRecord.toFITjs(
                    record.time === undefined ? definitions.record : definitions.hrv,
                    record
                )
            ),

            // definition events
            definitions.event,
            // data event messages
            ...events.map((event) =>
                dataRecord.toFITjs(
                    definitions.event,
                    Event(event)
                )
            ),

            // definition lap
            definitions.lap,
            // data lap messages
            ...laps.map((lap, message_index) =>
                dataRecord.toFITjs(
                    definitions.lap,
                    Lap({
                        total_elapsed_time: calcLapTotalElapsedTime(lap),
                        total_timer_time: calcLapTotalTimerTime(lap, events),
                        message_index,
                        ...lap,
                    })),
            ),

            // definition session
            definitions.session,
            // data session
            dataRecord.toFITjs(
                definitions.session,
                Session({
                    records,
                    laps,
                    events,
                    definition: definitions.session,
                    start_time: activity_start_time,
                    timestamp,
                    total_elapsed_time,
                    total_timer_time,
                    stats,
                    threshold_power: ftp,
                })
            ),

            // definition activity
            definitions.activity,
            // data activity
            dataRecord.toFITjs(
                definitions.activity,
                Activity({
                    timestamp,
                    activity_start_time,
                    total_elapsed_time,
                    total_timer_time,
                })
            ),
            // crc, needs to be computed last evetytime when encoding to binary
            CRC.toFITjs(),
        ];

        const header = first(structure);
        header.dataSize = getSize(structure).dataSize;

        // printFITjs(structure);

        return structure;
    }

    // {records: [{<field>: Any}], laps: [{<field>: Any}]}
    // -> Dataview
    function encode(args = {}) {
        const fitjs = toFITjs(args);
        return FITjs.encode(fitjs);
    }

    return Object.freeze({
        toFITjs,
        encode,
    });
}

// Special Data Messages
function FileHeader() {
    return fileHeader.toFITjs();
}

function FileId(args = {}) {
    return {
        time_created: args.time_created ?? Date.now(),
        manufacturer: args.manufacturer ?? 255,
        product: args.product ?? 0,
	      serial_number: args.serial_number ?? 0,
        number: 0,
        type: 4,
    };
}

function FileCreator(args = {}) {
    return {
        software_version: args.software_version ?? 0,
    };
}

function Event(args = {}) {
    return {
        timestamp: expect(args.timestamp, 'Event needs timestamp.'),
        event: profiles?.types?.event_type?.values['timer'] ?? 0,
        event_type: profiles?.types?.event_type?.values[args.type] ?? 0,
        event_group: 0,
    };
}

function Lap(args = {}) {
    return {
        timestamp: expect(args.timestamp, 'Lap needs timestamp.'),
        start_time: expect(args.start_time, 'Lap needs start_time.'),
        total_elapsed_time: expect(args.total_elapsed_time, 'Lap needs total_elapsed_time.'),
        total_timer_time: expect(args.total_timer_time, 'Lap needs total_timer_time'),
        message_index: args.message_index ?? 0,
        event: profiles.types?.event?.values?.lap ?? 9,
        event_type: profiles.types?.event_type?.values?.stop ?? 1,
    };
}

function Activity(args = {}) {
    return {
        timestamp: expect(args.timestamp, 'Activity needs timestamp.'),
        total_timer_time: expect(args.total_timer_time, 'Activity needs total_timer_time'),
        num_sessions: 1,
        type: profiles.types.activity.values.manual,
        event: profiles.types.event.values.activity,
        event_type: profiles.types.event_type.values.stop,
        // local_timestamp: args.timestamp,
    };
}

function Session(args = {}) {
    return {
        timestamp: expect(args.timestamp, 'Session needs timestamp.'),
        start_time: expect(args.start_time, 'Session needs start_time.'),
        total_elapsed_time: expect(
            args.total_elapsed_time,
            'Session needs total_elapsed_time.'
        ),
        total_timer_time: expect(
            args.total_timer_time,
            'Session needs total_timer_time'
        ),
        message_index:      args.message_index ?? 0,
        sport:              profiles.types.sport.values.cycling,
        sub_sport:          profiles.types.sub_sport.values.virtual_activity,
        ...args.stats,
        first_lap_index:    0,
        num_laps:           args.laps?.length ?? 1,
        threshold_power:    args.threshold_power,
    };
}
// END Special Data Messages

const localActivity = LocalActivity();

export {
    localActivity,
    FileId,
    Event,
    Lap,
    Session,
    Activity,
};

