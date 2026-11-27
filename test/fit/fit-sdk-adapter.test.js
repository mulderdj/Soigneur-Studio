import {
    fit,
    FIT,
    Decoder,
    Encoder,
    Profile,
    Stream,
    CrcCalculator,
    Utils,
    decodeFit,
    decodeFitMessages,
} from '../../src/fit/fit.js';
import { fitToSamples, readRide } from '../../src/training/fit-records.js';

const T0 = Date.UTC(2026, 10, 27, 10, 0, 0);
const SEMICIRCLES_PER_DEG = 2147483648 / 180;

function byName(decoded, name) {
    return decoded.filter(m => m.type === 'data' && m.name === name).map(m => m.fields);
}

describe('Soigneur @garmin/fitsdk adapter', () => {
    test('exports official SDK primitives and Soigneur codecs', () => {
        const instance = FIT();
        expect(instance.localActivity).toBe(fit.localActivity);
        expect(instance.localCourse).toBe(fit.localCourse);
        expect(instance.FITjs).toBe(fit.FITjs);
        expect(instance.profiles).toBe(Profile);
        expect(Decoder).toBeDefined();
        expect(Encoder).toBeDefined();
        expect(Stream).toBeDefined();
        expect(CrcCalculator).toBeDefined();
        expect(Utils.FIT_EPOCH_MS).toBe(631065600000);
    });

    test('full encode -> @garmin/fitsdk Decoder round-trip passes isFIT and checkIntegrity CRC validation', () => {
        const records = Array.from({length: 10}, (_, i) => ({
            timestamp: T0 + i * 1000,
            power: 210 + i * 5,
            heart_rate: 140 + i,
            cadence: 88 + (i % 4),
            speed: 8.5 + i * 0.1,
            distance: i * 8.5,
        }));
        const events = [
            {timestamp: T0, type: 'start'},
            {timestamp: T0 + 9000, type: 'stop'},
        ];
        const laps = [
            {start_time: T0, timestamp: T0 + 9000},
        ];

        const view = fit.localActivity.encode({records, laps, events, ftp: 265});
        expect(view).toBeInstanceOf(DataView);
        expect(view.byteOffset).toBe(0);
        expect(view.byteLength).toBe(view.buffer.byteLength);

        const stream = Stream.fromArrayBuffer(view.buffer);
        expect(Decoder.isFIT(stream)).toBe(true);

        const sdkDecoder = new Decoder(stream);
        expect(sdkDecoder.checkIntegrity()).toBe(true);
        expect(fit.CRC.isValid(view)).toBe(true);

        // Verify header & file CRCs directly against CrcCalculator
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        expect(fit.CRC.getHeaderCRC(view).number).toBe(CrcCalculator.calculateCRC(bytes, 0, 12));
        expect(fit.CRC.getFileCRC(view).number).toBe(CrcCalculator.calculateCRC(bytes, 0, bytes.length - 2));

        const {messages, errors} = sdkDecoder.read();
        expect(errors).toEqual([]);
        expect(messages.fileIdMesgs).toHaveLength(1);
        expect(messages.fileIdMesgs[0].type).toBe('activity');
        expect(messages.fileCreatorMesgs).toHaveLength(1);
        expect(messages.recordMesgs).toHaveLength(10);
        expect(messages.eventMesgs).toHaveLength(2);
        expect(messages.lapMesgs).toHaveLength(1);
        expect(messages.sessionMesgs).toHaveLength(1);
        expect(messages.sessionMesgs[0].thresholdPower).toBe(265);
        expect(messages.activityMesgs).toHaveLength(1);

        // Normalized FITjs.decode accepts DataView, Uint8Array, and offset views
        const subBuf = new Uint8Array(bytes.length + 16);
        subBuf.set(bytes, 8);
        const offsetView = new DataView(subBuf.buffer, 8, bytes.length);

        for(const input of [view, bytes, view.buffer, offsetView]) {
            const decoded = fit.FITjs.decode(input);
            const recs = byName(decoded, 'record');
            expect(recs).toHaveLength(10);
            expect(recs[0].timestamp).toBe(T0);
            expect(recs[9].timestamp).toBe(T0 + 9000);
            expect(recs[0].power).toBe(210);
            expect(recs[0].heart_rate).toBe(140);
            expect(recs[0].cadence).toBe(88);
        }
    });

    test('indoor ride omits absent sensors: no (0, 0) Null Island GPS, no 0 bpm HR, no 0 rpm cadence', () => {
        const records = [
            {
                timestamp: T0,
                position_lat: 0,
                position_long: 0,
                altitude: 0,
                grade: 0,
                heart_rate: 0,
                cadence: 0,
                power: 200,
                speed: 8.5,
                distance: 0,
                total_hemoglobin_conc: 0,
                saturated_hemoglobin_percent: 0,
                core_temperature: 0,
            },
            {
                timestamp: T0 + 1000,
                position_lat: 0,
                position_long: 0,
                altitude: 0,
                grade: 0,
                heart_rate: 0,
                cadence: 0,
                power: 220,
                speed: 9.0,
                distance: 9,
                total_hemoglobin_conc: 0,
                saturated_hemoglobin_percent: 0,
                core_temperature: 0,
            },
        ];

        const view = fit.localActivity.encode({records, laps: [], ftp: 250});
        const {messages, integrityValid} = decodeFitMessages(view);
        expect(integrityValid).toBe(true);

        // Raw SDK message must not contain zeroed absent fields
        const rawRec0 = messages.recordMesgs[0];
        expect(rawRec0.positionLat).toBeUndefined();
        expect(rawRec0.positionLong).toBeUndefined();
        expect(rawRec0.altitude).toBeUndefined();
        expect(rawRec0.grade).toBeUndefined();
        expect(rawRec0.heartRate).toBeUndefined();
        expect(rawRec0.cadence).toBeUndefined();
        expect(rawRec0.totalHemoglobinConc).toBeUndefined();
        expect(rawRec0.saturatedHemoglobinPercent).toBeUndefined();
        expect(rawRec0.coreTemperature).toBeUndefined();

        const decoded = fit.FITjs.decode(view);
        const rec0 = byName(decoded, 'record')[0];
        expect(rec0.position_lat).toBeUndefined();
        expect(rec0.position_long).toBeUndefined();
        expect(rec0.altitude).toBeUndefined();
        expect(rec0.grade).toBeUndefined();
        expect(rec0.heart_rate).toBeUndefined();
        expect(rec0.cadence).toBeUndefined();
        expect(rec0.total_hemoglobin_conc).toBeUndefined();
        expect(rec0.saturated_hemoglobin_percent).toBeUndefined();
        expect(rec0.core_temperature).toBeUndefined();
        expect(rec0.power).toBe(200);
        expect(rec0.speed).toBeCloseTo(8.5, 2);
        expect(rec0.distance).toBe(0);

        const session = byName(decoded, 'session')[0];
        expect(session.sport).toBe('cycling');
        expect(session.sub_sport).toBe('virtual_activity');
        expect(session.avg_heart_rate).toBeUndefined();
        expect(session.max_heart_rate).toBeUndefined();
        expect(session.avg_cadence).toBeUndefined();
        expect(session.max_cadence).toBeUndefined();
        expect(session.avg_power).toBe(210);
        expect(session.max_power).toBe(220);
        expect(session.total_distance).toBe(9);
        expect(session.threshold_power).toBe(250);
    });

    test('converts GPS degrees to semicircles, preserves existing semicircles, and retains elevation, HR, cadence, Moxy, and core temp', () => {
        const degLat = 52.3676;
        const degLon = 4.9041;
        const semiLat = 620001200;
        const semiLon = 58000900;

        const records = [
            {
                timestamp: T0,
                position_lat: degLat,
                position_long: degLon,
                altitude: 0,       // genuine sea level on a GPS ride
                grade: 0,          // genuine flat grade on a GPS ride
                heart_rate: 142,
                cadence: 0,        // genuine coasting (cadence > 0 in next record)
                power: 0,          // genuine coasting power
                speed: 10.0,
                distance: 10,
                total_hemoglobin_conc: 12.4,
                saturated_hemoglobin_percent: 64.5,
                core_temperature: 37.8,
            },
            {
                timestamp: T0 + 1000,
                position_lat: semiLat,
                position_long: semiLon,
                altitude: 12.4,
                grade: 2.5,
                heart_rate: 156,
                cadence: 92,
                power: 260,
                speed: 9.2,
                distance: 19.2,
                total_hemoglobin_conc: 12.5,
                saturated_hemoglobin_percent: 61.0,
                core_temperature: 38.1,
            },
            {
                // Single GPS dropout (0, 0) and zeroed Moxy/core-temp mid-ride
                timestamp: T0 + 2000,
                position_lat: 0,
                position_long: 0,
                altitude: 13.0,
                grade: 1.0,
                heart_rate: 158,
                cadence: 90,
                power: 250,
                speed: 9.0,
                distance: 28.2,
                total_hemoglobin_conc: 0,
                saturated_hemoglobin_percent: 0,
                core_temperature: 0,
            },
        ];

        const view = fit.localActivity.encode({records, laps: []});
        const decoded = fit.FITjs.decode(view);
        const recs = byName(decoded, 'record');

        expect(recs[0].position_lat).toBe(Math.round(degLat * SEMICIRCLES_PER_DEG));
        expect(recs[0].position_long).toBe(Math.round(degLon * SEMICIRCLES_PER_DEG));
        expect(recs[0].altitude).toBeCloseTo(0, 1);
        expect(recs[0].grade).toBeCloseTo(0, 1);
        expect(recs[0].heart_rate).toBe(142);
        expect(recs[0].cadence).toBe(0);
        expect(recs[0].power).toBe(0);
        expect(recs[0].total_hemoglobin_conc).toBeCloseTo(12.4, 1);
        expect(recs[0].saturated_hemoglobin_percent).toBeCloseTo(64.5, 1);
        expect(recs[0].core_temperature).toBeCloseTo(37.8, 2);

        expect(recs[1].position_lat).toBe(semiLat);
        expect(recs[1].position_long).toBe(semiLon);
        expect(recs[1].altitude).toBeCloseTo(12.4, 1);
        expect(recs[1].grade).toBeCloseTo(2.5, 1);
        expect(recs[1].heart_rate).toBe(156);
        expect(recs[1].cadence).toBe(92);
        expect(recs[1].power).toBe(260);

        expect(recs[2].position_lat).toBeUndefined();
        expect(recs[2].position_long).toBeUndefined();
        expect(recs[2].altitude).toBeCloseTo(13.0, 1);
        expect(recs[2].grade).toBeCloseTo(1.0, 1);
        expect(recs[2].heart_rate).toBe(158);
        expect(recs[2].cadence).toBe(90);
        expect(recs[2].total_hemoglobin_conc).toBeUndefined();
        expect(recs[2].saturated_hemoglobin_percent).toBeUndefined();
        expect(recs[2].core_temperature).toBeUndefined();

        const session = byName(decoded, 'session')[0];
        expect(session.sub_sport).toBe('generic');
        expect(session.avg_heart_rate).toBe(152);
        expect(session.max_heart_rate).toBe(158);
        expect(session.avg_cadence).toBe(60);
        expect(session.max_cadence).toBe(92);
        expect(session.avg_power).toBe(170);
        expect(session.max_power).toBe(260);
    });

    test('multi-lap summary stats compute per-lap averages, maxima, distance delta, triggers, and sub_sport', () => {
        const records = [
            {timestamp: T0,        power: 150, heart_rate: 130, cadence: 80, speed: 8.0,  distance: 0},
            {timestamp: T0 + 1000, power: 170, heart_rate: 134, cadence: 84, speed: 8.5,  distance: 8.5},
            {timestamp: T0 + 2000, power: 300, heart_rate: 162, cadence: 92, speed: 10.5, distance: 19.0},
            {timestamp: T0 + 3000, power: 320, heart_rate: 168, cadence: 96, speed: 11.0, distance: 30.0},
        ];
        const laps = [
            {start_time: T0,        timestamp: T0 + 1000},
            {start_time: T0 + 2000, timestamp: T0 + 3000},
        ];

        const view = fit.localActivity.encode({records, laps, ftp: 250});
        expect(fit.CRC.isValid(view)).toBe(true);

        const decoded = fit.FITjs.decode(view);
        const lapMsgs = byName(decoded, 'lap');

        expect(lapMsgs).toHaveLength(2);
        expect(lapMsgs[0]).toMatchObject({
            avg_power: 160,
            max_power: 170,
            avg_heart_rate: 132,
            max_heart_rate: 134,
            avg_cadence: 82,
            max_cadence: 84,
            sport: 'cycling',
            sub_sport: 'virtual_activity',
            lap_trigger: 'manual',
            intensity: 'active',
        });
        expect(lapMsgs[0].total_distance).toBeCloseTo(8.5, 1);

        expect(lapMsgs[1]).toMatchObject({
            avg_power: 310,
            max_power: 320,
            avg_heart_rate: 165,
            max_heart_rate: 168,
            avg_cadence: 94,
            max_cadence: 96,
            sport: 'cycling',
            sub_sport: 'virtual_activity',
            lap_trigger: 'session_end',
        });
        expect(lapMsgs[1].total_distance).toBeCloseTo(11.0, 1);

        const session = byName(decoded, 'session')[0];
        expect(session.num_laps).toBe(2);
    });

    test('HRV beat-to-beat RR intervals (padded with 0xFFFF sentinels) encode and decode accurately', () => {
        const pad = xs => [...xs, ...Array(5 - xs.length).fill(0xFFFF)];
        const records = [
            {timestamp: T0, power: 195, heart_rate: 68, cadence: 85, speed: 8.0, distance: 0},
            {time: pad([0.882, 0.906])},
            {timestamp: T0 + 1000, power: 205, heart_rate: 70, cadence: 86, speed: 8.2, distance: 8.2},
            {time: pad([0.854])},
        ];

        const view = fit.localActivity.encode({records, laps: [], events: []});
        expect(fit.CRC.isValid(view)).toBe(true);

        const decoded = fit.FITjs.decode(view);
        const hrv = byName(decoded, 'hrv');
        expect(hrv).toHaveLength(2);
        expect(hrv[0].time[0]).toBeCloseTo(0.882, 3);
        expect(hrv[0].time[1]).toBeCloseTo(0.906, 3);
        expect(hrv[0].time.slice(2)).toEqual([null, null, null]);
        expect(hrv[1].time[0]).toBeCloseTo(0.854, 3);
        expect(hrv[1].time.slice(1)).toEqual([null, null, null, null]);
    });

    test('structured workout steps encode into workout + workout_step messages when provided', () => {
        const workout = {
            meta: {name: 'VO2 2x3', description: 'Crisp aerobic intervals'},
            intervals: [
                {duration: 300, steps: [{duration: 300, power: 0.55, name: 'Warmup'}]},
                {duration: 180, steps: [{duration: 180, power: 1.15, cadence: 95, name: 'Work'}]},
                {duration: 300, steps: [{duration: 300, power: 0.50, name: 'Cooldown'}]},
            ],
        };
        const records = [
            {timestamp: T0, power: 138, heart_rate: 120, cadence: 85, speed: 7.5, distance: 0},
            {timestamp: T0 + 1000, power: 140, heart_rate: 122, cadence: 86, speed: 7.6, distance: 7.6},
        ];

        const view = fit.localActivity.encode({records, laps: [], events: [], ftp: 250, workout});
        expect(fit.CRC.isValid(view)).toBe(true);

        const decoded = fit.FITjs.decode(view);
        const wkt = byName(decoded, 'workout');
        const steps = byName(decoded, 'workout_step');

        expect(wkt).toHaveLength(1);
        expect(wkt[0].wkt_name).toBe('VO2 2x3');
        expect(wkt[0].num_valid_steps).toBe(3);

        expect(steps).toHaveLength(3);
        expect(steps[0].intensity).toBe('warmup');
        expect(steps[0].duration_time).toBe(300);
        expect(steps[1].wkt_step_name).toBe('Work');
        expect(steps[1].target_type).toBe('power');
        expect(steps[1].custom_target_power_low).toBe(1000 + Math.round(1.15 * 250));
        expect(steps[1].secondary_target_type).toBe('cadence');
        expect(steps[2].intensity).toBe('cooldown');
    });

    test('decodes Connect IQ developer fields and running dynamics cleanly via fit-records', () => {
        const devIdMesg = {
            applicationId: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            developerDataIndex: 0,
        };
        const fieldDescMesg = {
            developerDataIndex: 0,
            fieldDefinitionNumber: 0,
            fitBaseTypeId: Utils.FitBaseType.UINT16,
            fieldName: 'Form Power',
            units: 'watts',
        };
        const encoder = new Encoder({
            fieldDescriptions: {
                formPower: {developerDataIdMesg: devIdMesg, fieldDescriptionMesg: fieldDescMesg},
            },
        });
        const fitTs = Math.round((T0 - Utils.FIT_EPOCH_MS) / 1000);
        encoder.onMesg(Profile.MesgNum.FILE_ID, {type: 'activity', manufacturer: 'garmin', timeCreated: fitTs});
        encoder.onMesg(Profile.MesgNum.DEVELOPER_DATA_ID, devIdMesg);
        encoder.onMesg(Profile.MesgNum.FIELD_DESCRIPTION, fieldDescMesg);
        encoder.onMesg(Profile.MesgNum.RECORD, {
            timestamp: fitTs,
            power: 285,
            heartRate: 164,
            cadence: 89,
            fractionalCadence: 0.5,
            speed: 4.1,
            distance: 0,
            stanceTime: 218.5,
            verticalOscillation: 82.4,
            stepLength: 1360,
            developerFields: {formPower: 68},
        });
        encoder.onMesg(Profile.MesgNum.SESSION, {
            timestamp: fitTs,
            startTime: fitTs,
            totalElapsedTime: 1,
            totalTimerTime: 1,
            sport: 'running',
            subSport: 'street',
        });
        const bytes = encoder.close();
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        const decoded = decodeFit(view);
        const recMsg = decoded.find(m => m.name === 'record');
        expect(recMsg.developer_fields).toEqual({form_power: 68});
        expect(recMsg.fields.form_power).toBe(68);

        const ride = readRide(view);
        expect(ride.sport).toBe('running');
        expect(ride.samples[0]).toMatchObject({
            power: 285,
            heartRate: 164,
            cadence: 89.5,
            stanceTime: 218.5,
            verticalOscillation: 82.4,
            stepLength: 1360,
        });

        const summarySamples = fitToSamples(view);
        expect(summarySamples.samples[0].cadence).toBe(89.5);
    });

    test('gracefully returns empty array on malformed or non-FIT inputs', () => {
        expect(decodeFit(null)).toEqual([]);
        expect(decodeFit(new ArrayBuffer(0))).toEqual([]);
        expect(decodeFit(new DataView(new ArrayBuffer(24)))).toEqual([]);
        expect(decodeFitMessages(new Uint8Array(12)).isFIT).toBe(false);
    });
});
