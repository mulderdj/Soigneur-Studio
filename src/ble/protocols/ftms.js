// @ts-check
//
// Bluetooth SIG Fitness Machine Service (FTMS 0x1826) Codec
//

import { clamp } from '../../functions.js';

const FtmsOpCode = Object.freeze({
    requestControl: 0x00,
    reset: 0x01,
    setTargetSpeed: 0x02,
    setTargetInclination: 0x03,
    setTargetResistanceLevel: 0x04,
    setTargetPower: 0x05,
    setTargetHeartRate: 0x06,
    startOrResume: 0x07,
    stopOrPause: 0x08,
    setIndoorBikeSimulation: 0x11,
    responseCode: 0x80,
});

const FtmsResultCode = Object.freeze({
    success: 0x01,
    opCodeNotSupported: 0x02,
    invalidParameter: 0x03,
    operationFailed: 0x04,
    controlNotPermitted: 0x05,
});

const FtmsStatusCode = Object.freeze({
    reset: 0x01,
    stoppedOrPausedByUser: 0x02,
    stoppedBySafetyKey: 0x03,
    startedOrResumedByUser: 0x04,
    targetSpeedChanged: 0x05,
    targetInclineChanged: 0x06,
    targetResistanceChanged: 0x07,
    targetPowerChanged: 0x08,
    indoorBikeSimulationChanged: 0x12,
    wheelCircumferenceChanged: 0x13,
    spinDownStatus: 0x14,
    controlPermissionLost: 0xff,
});

/**
 * Convert an ArrayBuffer, TypedArray, or DataView to a DataView.
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} input
 * @returns {DataView}
 */
function toDataView(input) {
    if (input instanceof DataView) return input;
    if (ArrayBuffer.isView(input)) {
        return new DataView(input.buffer, input.byteOffset, input.byteLength);
    }
    return new DataView(input);
}

/**
 * Parse FTMS Indoor Bike Data characteristic (0x2AD2).
 *
 * Bit 0 of flags is "More Data":
 *  - bit 0 === 0 -> Instantaneous Speed IS present (uint16, 0.01 km/h)
 *  - bit 0 === 1 -> Instantaneous Speed is ABSENT
 *
 * Speed is converted to m/s (`kmh / 3.6`) to match the app's canonical `speed` metric,
 * while `speedKmh` preserves the raw decoded km/h value.
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeIndoorBikeData(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 2) {
        return { flags: 0 };
    }

    const flags = view.getUint16(0, true);
    let offset = 2;

    /** @type {{
     *   flags: number,
     *   speed?: number,
     *   speedKmh?: number,
     *   averageSpeedKmh?: number,
     *   cadence?: number,
     *   averageCadence?: number,
     *   totalDistance?: number,
     *   resistanceLevel?: number,
     *   power?: number,
     *   averagePower?: number,
     *   totalEnergy?: number,
     *   energyPerHour?: number,
     *   energyPerMinute?: number,
     *   heartRate?: number,
     *   metabolicEquivalent?: number,
     *   elapsedTime?: number,
     *   remainingTime?: number,
     * }} */
    const result = { flags };

    // Bit 0: More Data (0 = Instantaneous Speed present, 1 = absent)
    const moreData = (flags & (1 << 0)) !== 0;
    if (!moreData && offset + 2 <= view.byteLength) {
        const speedKmh = view.getUint16(offset, true) * 0.01;
        result.speedKmh = speedKmh;
        result.speed = speedKmh / 3.6;
        offset += 2;
    }

    // Bit 1: Average Speed present (uint16, 0.01 km/h)
    if ((flags & (1 << 1)) !== 0 && offset + 2 <= view.byteLength) {
        result.averageSpeedKmh = view.getUint16(offset, true) * 0.01;
        offset += 2;
    }

    // Bit 2: Instantaneous Cadence present (uint16, 0.5 rpm)
    if ((flags & (1 << 2)) !== 0 && offset + 2 <= view.byteLength) {
        result.cadence = view.getUint16(offset, true) * 0.5;
        offset += 2;
    }

    // Bit 3: Average Cadence present (uint16, 0.5 rpm)
    if ((flags & (1 << 3)) !== 0 && offset + 2 <= view.byteLength) {
        result.averageCadence = view.getUint16(offset, true) * 0.5;
        offset += 2;
    }

    // Bit 4: Total Distance present (uint24, 1 m)
    if ((flags & (1 << 4)) !== 0 && offset + 3 <= view.byteLength) {
        result.totalDistance =
            view.getUint8(offset) |
            (view.getUint8(offset + 1) << 8) |
            (view.getUint8(offset + 2) << 16);
        offset += 3;
    }

    // Bit 5: Resistance Level present (sint16, 1 unitless)
    if ((flags & (1 << 5)) !== 0 && offset + 2 <= view.byteLength) {
        result.resistanceLevel = view.getInt16(offset, true);
        offset += 2;
    }

    // Bit 6: Instantaneous Power present (sint16, 1 W)
    if ((flags & (1 << 6)) !== 0 && offset + 2 <= view.byteLength) {
        result.power = view.getInt16(offset, true);
        offset += 2;
    }

    // Bit 7: Average Power present (sint16, 1 W)
    if ((flags & (1 << 7)) !== 0 && offset + 2 <= view.byteLength) {
        result.averagePower = view.getInt16(offset, true);
        offset += 2;
    }

    // Bit 8: Expended Energy present (uint16 + uint16 + uint8 = 5 bytes)
    if ((flags & (1 << 8)) !== 0 && offset + 5 <= view.byteLength) {
        const totalEnergy = view.getUint16(offset, true);
        const energyPerHour = view.getUint16(offset + 2, true);
        const energyPerMinute = view.getUint8(offset + 4);
        if (totalEnergy !== 0xffff) result.totalEnergy = totalEnergy;
        if (energyPerHour !== 0xffff) result.energyPerHour = energyPerHour;
        if (energyPerMinute !== 0xff) result.energyPerMinute = energyPerMinute;
        offset += 5;
    }

    // Bit 9: Heart Rate present (uint8, 1 bpm)
    if ((flags & (1 << 9)) !== 0 && offset + 1 <= view.byteLength) {
        result.heartRate = view.getUint8(offset);
        offset += 1;
    }

    // Bit 10: Metabolic Equivalent present (uint8, 0.1 MET)
    if ((flags & (1 << 10)) !== 0 && offset + 1 <= view.byteLength) {
        result.metabolicEquivalent = view.getUint8(offset) * 0.1;
        offset += 1;
    }

    // Bit 11: Elapsed Time present (uint16, 1 s)
    if ((flags & (1 << 11)) !== 0 && offset + 2 <= view.byteLength) {
        result.elapsedTime = view.getUint16(offset, true);
        offset += 2;
    }

    // Bit 12: Remaining Time present (uint16, 1 s)
    if ((flags & (1 << 12)) !== 0 && offset + 2 <= view.byteLength) {
        result.remainingTime = view.getUint16(offset, true);
        offset += 2;
    }

    return result;
}

/**
 * Encode Request Control (0x00).
 * @returns {Uint8Array}
 */
function encodeRequestControl() {
    return new Uint8Array([FtmsOpCode.requestControl]);
}

/**
 * Encode Reset (0x01).
 * @returns {Uint8Array}
 */
function encodeReset() {
    return new Uint8Array([FtmsOpCode.reset]);
}

/**
 * Encode Start or Resume (0x07).
 * @returns {Uint8Array}
 */
function encodeStartOrResume() {
    return new Uint8Array([FtmsOpCode.startOrResume]);
}

/**
 * Encode Stop or Pause (0x08).
 * @param {'stop' | 'pause'} [action]
 * @returns {Uint8Array}
 */
function encodeStopOrPause(action = 'stop') {
    return new Uint8Array([FtmsOpCode.stopOrPause, action === 'pause' ? 0x02 : 0x01]);
}

/**
 * Encode Set Target Resistance Level (0x04).
 * Per Bluetooth SIG FTMS 4.16.1, Target Resistance Level is uint8 with 0.1 resolution
 * (or sint16 when `signed16` is requested for extended-range trainers).
 *
 * @param {number} level Resistance level in units (resolution 0.1 -> multiplied by 10)
 * @param {{ signed16?: boolean, min?: number, max?: number }} [options]
 * @returns {Uint8Array}
 */
function encodeTargetResistance(level, options = {}) {
    const clean = Number.isFinite(level) ? level : 0;
    if (options.signed16) {
        const min = options.min ?? -3276.8;
        const max = options.max ?? 3276.7;
        const raw = Math.round(clamp(min, max, clean) * 10);
        const buf = new ArrayBuffer(3);
        const view = new DataView(buf);
        view.setUint8(0, FtmsOpCode.setTargetResistanceLevel);
        view.setInt16(1, clamp(-32768, 32767, raw), true);
        return new Uint8Array(buf);
    }
    const min = options.min ?? 0;
    const max = options.max ?? 25.5;
    const raw = clamp(0, 255, Math.round(clamp(min, max, clean) * 10));
    return new Uint8Array([FtmsOpCode.setTargetResistanceLevel, raw]);
}

/**
 * Map a UI percentage resistance (-100..100 or 0..100) onto the trainer's supported
 * FTMS resistance range (defaulting to 0..20.0 -> uint8 0..200 when no range was read).
 *
 * @param {number} percent
 * @param {{ min: number, max: number } | null} [range]
 * @returns {Uint8Array}
 */
function encodeResistancePercent(percent, range = null) {
    const pct = clamp(0, 100, Math.max(0, Number.isFinite(percent) ? percent : 0));
    if (range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min) {
        const mapped = range.min + (pct / 100) * (range.max - range.min);
        const needsSigned16 = range.min < 0 || range.max > 25.5;
        return encodeTargetResistance(mapped, {
            signed16: needsSigned16,
            min: range.min,
            max: range.max,
        });
    }
    // Default 0..100% -> 0.0..20.0 (raw 0..200 in 0.1 unit steps)
    return encodeTargetResistance((pct / 100) * 20, { min: 0, max: 25.5 });
}

/**
 * Encode Set Target Power (0x05): sint16 little-endian in 1 W increments.
 *
 * @param {number} watts
 * @param {{ min?: number, max?: number } | null} [range]
 * @returns {Uint8Array}
 */
function encodeTargetPower(watts, range = null) {
    const min = range?.min ?? 0;
    const max = range?.max ?? 4000;
    const clean = Number.isFinite(watts) ? watts : 0;
    const clampedWatts = clamp(-32768, 32767, Math.round(clamp(min, max, clean)));
    const buf = new ArrayBuffer(3);
    const view = new DataView(buf);
    view.setUint8(0, FtmsOpCode.setTargetPower);
    view.setInt16(1, clampedWatts, true);
    return new Uint8Array(buf);
}

/**
 * Encode Set Indoor Bike Simulation Parameters (0x11):
 *  - windSpeed: sint16 (0.001 m/s)
 *  - grade:     sint16 (0.01 %)
 *  - crr:       uint8  (0.0001)
 *  - cw:        uint8  (0.01 kg/m)
 *
 * @param {{
 *   windSpeed?: number,
 *   grade?: number,
 *   crr?: number,
 *   cw?: number,
 * }} [params]
 * @returns {Uint8Array}
 */
function encodeIndoorBikeSimulation(params = {}) {
    const windSpeed = Number.isFinite(params.windSpeed) ? params.windSpeed : 0;
    const grade = Number.isFinite(params.grade) ? params.grade : 0;
    const crr = Number.isFinite(params.crr) ? params.crr : 0.004;
    const cw = Number.isFinite(params.cw) ? params.cw : 0.51;

    const rawWind = clamp(-32768, 32767, Math.round(windSpeed * 1000));
    const rawGrade = clamp(-32768, 32767, Math.round(grade * 100));
    const rawCrr = clamp(0, 255, Math.round(crr * 10000));
    const rawCw = clamp(0, 255, Math.round(cw * 100));

    const buf = new ArrayBuffer(7);
    const view = new DataView(buf);
    view.setUint8(0, FtmsOpCode.setIndoorBikeSimulation);
    view.setInt16(1, rawWind, true);
    view.setInt16(3, rawGrade, true);
    view.setUint8(5, rawCrr);
    view.setUint8(6, rawCw);
    return new Uint8Array(buf);
}

/**
 * Decode Fitness Machine Control Point indication response (0x2AD9).
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeControlPointResponse(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 3) return null;
    const responseOpCode = view.getUint8(0);
    if (responseOpCode !== FtmsOpCode.responseCode) return null;
    const requestOpCode = view.getUint8(1);
    const resultCode = view.getUint8(2);
    return {
        responseOpCode,
        requestOpCode,
        resultCode,
        ok: resultCode === FtmsResultCode.success,
    };
}

/**
 * Decode Fitness Machine Status notification (0x2ADA).
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeFitnessMachineStatus(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 1) return null;
    const statusCode = view.getUint8(0);
    /** @type {{ statusCode: number, targetPower?: number, targetResistance?: number, controlLost?: boolean }} */
    const out = { statusCode };

    if (statusCode === FtmsStatusCode.targetPowerChanged && view.byteLength >= 3) {
        out.targetPower = view.getInt16(1, true);
    } else if (statusCode === FtmsStatusCode.targetResistanceChanged && view.byteLength >= 2) {
        out.targetResistance = view.byteLength >= 3
            ? view.getInt16(1, true) * 0.1
            : view.getUint8(1) * 0.1;
    } else if (statusCode === FtmsStatusCode.controlPermissionLost) {
        out.controlLost = true;
    }
    return out;
}

/**
 * Decode Supported Power Range characteristic (0x2AD8): sint16 min, sint16 max, uint16 increment (1 W).
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeSupportedPowerRange(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 6) return null;
    return {
        min: view.getInt16(0, true),
        max: view.getInt16(2, true),
        increment: view.getUint16(4, true),
    };
}

/**
 * Decode Supported Resistance Level Range characteristic (0x2AD6):
 * sint16 min (0.1), sint16 max (0.1), uint16 increment (0.1).
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeSupportedResistanceRange(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 6) return null;
    return {
        min: view.getInt16(0, true) * 0.1,
        max: view.getInt16(2, true) * 0.1,
        increment: view.getUint16(4, true) * 0.1,
    };
}

export {
    FtmsOpCode,
    FtmsResultCode,
    FtmsStatusCode,
    decodeIndoorBikeData,
    encodeRequestControl,
    encodeReset,
    encodeStartOrResume,
    encodeStopOrPause,
    encodeTargetResistance,
    encodeResistancePercent,
    encodeTargetPower,
    encodeIndoorBikeSimulation,
    decodeControlPointResponse,
    decodeFitnessMachineStatus,
    decodeSupportedPowerRange,
    decodeSupportedResistanceRange,
};
