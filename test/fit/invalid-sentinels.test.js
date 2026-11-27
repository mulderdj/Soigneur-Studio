import { fit } from '../../src/fit/fit.js';
import { profiles } from '../../src/fit/profiles/profiles.js';
import { type } from '../../src/fit/common.js';

const T0 = Date.UTC(2026, 10, 27, 10, 0, 0);

function findMessages(fitjs, name) {
    return fitjs.filter(m => m.type === 'data' && m.name === name);
}

// Read the raw unscaled integer written for a field inside a FIT data message
// using its definition message's field layout.
function rawFieldValue(view, messageName, fieldName, messageIndex = 0) {
    const headerSize = view.getUint8(0);
    const dataSize = view.getUint32(4, true);
    const end = headerSize + dataSize;
    const defs = new Map();
    let offset = headerSize;
    let seen = 0;

    while(offset < end) {
        const header = view.getUint8(offset);
        const isDef = (header & 0x40) !== 0;
        const localNum = header & 0x0F;
        if(isDef) {
            const hasDev = (header & 0x20) !== 0;
            const arch = view.getUint8(offset + 2);
            const littleEndian = arch === 0;
            const globalNum = view.getUint16(offset + 3, littleEndian);
            const numFields = view.getUint8(offset + 5);
            const fields = [];
            let pos = offset + 6;
            for(let i = 0; i < numFields; i++) {
                fields.push({
                    number: view.getUint8(pos),
                    size: view.getUint8(pos + 1),
                    baseType: view.getUint8(pos + 2),
                });
                pos += 3;
            }
            if(hasDev) {
                const numDev = view.getUint8(pos);
                pos += 1 + numDev * 3;
            }
            const name = profiles.numberToMessageName(globalNum);
            const dataLength = fields.reduce((s, f) => s + f.size, 0);
            defs.set(localNum, {name, littleEndian, fields, dataLength});
            offset = pos;
        } else {
            const def = defs.get(localNum);
            const dataStart = offset + 1;
            if(def.name === messageName) {
                if(seen === messageIndex) {
                    let fieldPos = dataStart;
                    for(const f of def.fields) {
                        const info = profiles.numberToField(def.name, f.number);
                        if(info.name === fieldName) {
                            const bt = profiles.BaseType[f.baseType];
                            if(bt === 'uint8' || bt === 'enum' || bt === 'byte') return view.getUint8(fieldPos);
                            if(bt === 'sint8') return view.getInt8(fieldPos);
                            if(bt === 'uint16') return view.getUint16(fieldPos, def.littleEndian);
                            if(bt === 'sint16') return view.getInt16(fieldPos, def.littleEndian);
                            if(bt === 'uint32') return view.getUint32(fieldPos, def.littleEndian);
                            if(bt === 'sint32') return view.getInt32(fieldPos, def.littleEndian);
                            throw new Error(`Unhandled base type ${bt}`);
                        }
                        fieldPos += f.size;
                    }
                    throw new Error(`Field ${fieldName} not found in ${messageName}`);
                }
                seen += 1;
            }
            offset = dataStart + def.dataLength;
        }
    }
    throw new Error(`Message ${messageName}[${messageIndex}] not found`);
}

describe('FIT invalid sentinels vs real sensor/course values', () => {
    test('indoor ride with (0,0) GPS and absent sensors encodes FIT invalid sentinels, not 0', () => {
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

        // Raw binary bytes must contain FIT invalid sentinels, not 0
        expect(rawFieldValue(view, 'record', 'position_lat', 0)).toBe(0x7FFFFFFF);
        expect(rawFieldValue(view, 'record', 'position_long', 0)).toBe(0x7FFFFFFF);
        expect(rawFieldValue(view, 'record', 'altitude', 0)).toBe(0xFFFF);
        expect(rawFieldValue(view, 'record', 'grade', 0)).toBe(0x7FFF);
        expect(rawFieldValue(view, 'record', 'heart_rate', 0)).toBe(0xFF);
        expect(rawFieldValue(view, 'record', 'cadence', 0)).toBe(0xFF);
        expect(rawFieldValue(view, 'record', 'total_hemoglobin_conc', 0)).toBe(0xFFFF);
        expect(rawFieldValue(view, 'record', 'saturated_hemoglobin_percent', 0)).toBe(0xFFFF);
        expect(rawFieldValue(view, 'record', 'core_temperature', 0)).toBe(0xFFFF);

        // Session summary stats for absent HR and cadence must also be invalid sentinels
        expect(rawFieldValue(view, 'session', 'avg_heart_rate')).toBe(0xFF);
        expect(rawFieldValue(view, 'session', 'max_heart_rate')).toBe(0xFF);
        expect(rawFieldValue(view, 'session', 'avg_cadence')).toBe(0xFF);
        expect(rawFieldValue(view, 'session', 'max_cadence')).toBe(0xFF);

        // Decoding back yields undefined for absent fields and keeps real power/speed/distance
        const decoded = fit.FITjs.decode(view);
        const rec0 = findMessages(decoded, 'record')[0].fields;
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

        const session = findMessages(decoded, 'session')[0].fields;
        expect(session.avg_heart_rate).toBeUndefined();
        expect(session.max_heart_rate).toBeUndefined();
        expect(session.avg_cadence).toBeUndefined();
        expect(session.max_cadence).toBeUndefined();
        expect(session.avg_power).toBe(210);
        expect(session.max_power).toBe(220);
        expect(session.total_distance).toBe(9);
    });

    test('missing/undefined optional fields encode as invalid sentinels without NaN', () => {
        const records = [
            {timestamp: T0, power: 180, speed: 7.5, distance: 0},
            {timestamp: T0 + 1000, power: 200, speed: 8.0, distance: 8},
        ];

        const view = fit.localActivity.encode({records, laps: []});
        const decoded = fit.FITjs.decode(view);
        const rec = findMessages(decoded, 'record')[1].fields;
        const session = findMessages(decoded, 'session')[0].fields;

        expect(rec.position_lat).toBeUndefined();
        expect(rec.position_long).toBeUndefined();
        expect(rec.heart_rate).toBeUndefined();
        expect(rec.cadence).toBeUndefined();
        expect(rec.power).toBe(200);
        expect(session.avg_power).toBe(190);
        expect(session.avg_heart_rate).toBeUndefined();
        expect(session.avg_cadence).toBeUndefined();
    });

    test('real GPS, elevation, HR, cadence, Moxy, and core temperature values are preserved', () => {
        const lat1 = 620000000;
        const lon1 = 58000000;
        const lat2 = 620001200;
        const lon2 = 58000900;

        const records = [
            {
                timestamp: T0,
                position_lat: lat1,
                position_long: lon1,
                altitude: 0,       // genuine sea-level altitude on a GPS/elevation ride
                grade: 0,          // genuine flat grade on a GPS/elevation ride
                heart_rate: 142,
                cadence: 0,        // genuine coasting (cadence > 0 exists in next record)
                power: 0,          // genuine coasting power
                speed: 10.0,
                distance: 10,
                total_hemoglobin_conc: 12.4,
                saturated_hemoglobin_percent: 64.5,
                core_temperature: 37.8,
            },
            {
                timestamp: T0 + 1000,
                position_lat: lat2,
                position_long: lon2,
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
                // Single GPS dropout (0, 0) in an otherwise GPS ride
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
        const recs = findMessages(decoded, 'record').map(m => m.fields);

        // Record 0 preserves real GPS and genuine zeros (sea level, flat, coasting)
        expect(recs[0].position_lat).toBe(lat1);
        expect(recs[0].position_long).toBe(lon1);
        expect(recs[0].altitude).toBeCloseTo(0, 1);
        expect(recs[0].grade).toBeCloseTo(0, 1);
        expect(recs[0].heart_rate).toBe(142);
        expect(recs[0].cadence).toBe(0);
        expect(recs[0].power).toBe(0);
        expect(recs[0].total_hemoglobin_conc).toBeCloseTo(12.4, 1);
        expect(recs[0].saturated_hemoglobin_percent).toBeCloseTo(64.5, 1);
        expect(recs[0].core_temperature).toBeCloseTo(37.8, 1);

        // Record 1 preserves all real sensor and course values
        expect(recs[1].position_lat).toBe(lat2);
        expect(recs[1].position_long).toBe(lon2);
        expect(recs[1].altitude).toBeCloseTo(12.4, 1);
        expect(recs[1].grade).toBeCloseTo(2.5, 1);
        expect(recs[1].heart_rate).toBe(156);
        expect(recs[1].cadence).toBe(92);
        expect(recs[1].power).toBe(260);
        expect(recs[1].total_hemoglobin_conc).toBeCloseTo(12.5, 1);
        expect(recs[1].saturated_hemoglobin_percent).toBeCloseTo(61.0, 1);
        expect(recs[1].core_temperature).toBeCloseTo(38.1, 1);

        // Record 2 drops only the (0, 0) GPS and zeroed Moxy/core-temp while keeping elevation/HR/cadence
        expect(recs[2].position_lat).toBeUndefined();
        expect(recs[2].position_long).toBeUndefined();
        expect(recs[2].altitude).toBeCloseTo(13.0, 1);
        expect(recs[2].grade).toBeCloseTo(1.0, 1);
        expect(recs[2].heart_rate).toBe(158);
        expect(recs[2].cadence).toBe(90);
        expect(recs[2].total_hemoglobin_conc).toBeUndefined();
        expect(recs[2].saturated_hemoglobin_percent).toBeUndefined();
        expect(recs[2].core_temperature).toBeUndefined();

        // Session summary stats reflect the real HR and cadence values
        const session = findMessages(decoded, 'session')[0].fields;
        expect(session.avg_heart_rate).toBe(152);
        expect(session.max_heart_rate).toBe(158);
        expect(session.avg_cadence).toBe(60); // Math.floor((0 + 92 + 90) / 3)
        expect(session.max_cadence).toBe(92);
        expect(session.avg_power).toBe(170);
        expect(session.max_power).toBe(260);
    });

    test('FitNumber and FitTimestamp encode non-finite values as invalid and decode back to undefined', () => {
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);

        const uint16Field = {base_type: 'uint16', scale: 5, offset: 500, invalid: 0xFFFF};
        type.number.encode(uint16Field, undefined, view, 0, true);
        expect(view.getUint16(0, true)).toBe(0xFFFF);
        expect(type.number.decode(uint16Field, view, 0, true, false)).toBeUndefined();
        expect(type.number.decode(uint16Field, view, 0, true, true)).toBe(0xFFFF);

        type.timestamp.encode({base_type: 'uint32'}, undefined, view, 0, true);
        expect(view.getUint32(0, true)).toBe(0xFFFFFFFF);
        expect(type.timestamp.decode({base_type: 'uint32'}, view, 0, true)).toBeUndefined();
    });

    test('lap messages encode per-lap summary stats (power, HR, cadence, speed, distance, calories) and sport', () => {
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
        const decoded = fit.FITjs.decode(view);
        const lapMsgs = findMessages(decoded, 'lap').map(m => m.fields);

        expect(lapMsgs).toHaveLength(2);
        expect(lapMsgs[0].avg_power).toBe(160);
        expect(lapMsgs[0].max_power).toBe(170);
        expect(lapMsgs[0].avg_heart_rate).toBe(132);
        expect(lapMsgs[0].max_heart_rate).toBe(134);
        expect(lapMsgs[0].avg_cadence).toBe(82);
        expect(lapMsgs[0].max_cadence).toBe(84);
        expect(lapMsgs[0].total_distance).toBeCloseTo(8.5, 1);
        expect(lapMsgs[0].sport).toBe(profiles.types.sport.values.cycling);

        expect(lapMsgs[1].avg_power).toBe(310);
        expect(lapMsgs[1].max_power).toBe(320);
        expect(lapMsgs[1].avg_heart_rate).toBe(165);
        expect(lapMsgs[1].max_heart_rate).toBe(168);
        expect(lapMsgs[1].total_distance).toBeCloseTo(11.0, 1);
        expect(lapMsgs[1].lap_trigger).toBe(profiles.types.lap_trigger.values.session_end);
    });
});
