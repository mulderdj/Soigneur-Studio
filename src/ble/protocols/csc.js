// @ts-check
//
// Bluetooth SIG Cycling Speed and Cadence (0x1816 / 0x2A5B) Codec
//

import { unsignedDelta, DEFAULT_WHEEL_CIRCUMFERENCE_M } from './cps.js';

const CSC_TIME_RESOLUTION = 1024; // 1/1024 s for both wheel and crank in CSCS
const UINT32_MOD = 0x100000000;
const UINT16_MOD = 0x10000;

/**
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
 * Parse raw cumulative counters from a CSC Measurement (0x2A5B) notification.
 *
 * Flags (uint8 at offset 0):
 *  - bit 0 (0x01): Wheel Revolution Data Present (uint32 revs + uint16 1/1024s event time)
 *  - bit 1 (0x02): Crank Revolution Data Present (uint16 revs + uint16 1/1024s event time)
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeCscMeasurement(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 1) return null;

    const flags = view.getUint8(0);
    let offset = 1;

    /** @type {{
     *   flags: number,
     *   wheelRevolutions?: number,
     *   lastWheelEventTime?: number,
     *   crankRevolutions?: number,
     *   lastCrankEventTime?: number,
     * }} */
    const out = { flags };

    if ((flags & 0x01) !== 0 && offset + 6 <= view.byteLength) {
        out.wheelRevolutions = view.getUint32(offset, true);
        out.lastWheelEventTime = view.getUint16(offset + 4, true);
        offset += 6;
    }

    if ((flags & 0x02) !== 0 && offset + 4 <= view.byteLength) {
        out.crankRevolutions = view.getUint16(offset, true);
        out.lastCrankEventTime = view.getUint16(offset + 2, true);
        offset += 4;
    }

    return out;
}

/**
 * Stateful CSC decoder computing rollover-safe wheel speed (`speed` in m/s and
 * `speedKmh` in km/h, default 2.105 m wheel circumference) and crank `cadence` (rpm),
 * dropping to 0 after coasting / staleness.
 *
 * @param {{
 *   wheelCircumferenceM?: number,
 *   staleMs?: number,
 *   maxCoastRepeats?: number,
 * }} [options]
 */
function createCscDecoder(options = {}) {
    const wheelCircumferenceM = options.wheelCircumferenceM ?? DEFAULT_WHEEL_CIRCUMFERENCE_M;
    const staleMs = options.staleMs ?? 3000;
    const maxCoastRepeats = options.maxCoastRepeats ?? 2;

    /** @type {number | null} */
    let prevWheelRevs = null;
    /** @type {number | null} */
    let prevWheelTime = null;
    let wheelStaleCount = 0;
    let lastWheelAdvanceAt = 0;
    /** @type {number | undefined} */
    let lastSpeedMps = undefined;

    /** @type {number | null} */
    let prevCrankRevs = null;
    /** @type {number | null} */
    let prevCrankTime = null;
    let crankStaleCount = 0;
    let lastCrankAdvanceAt = 0;
    /** @type {number | undefined} */
    let lastCadence = undefined;

    function reset() {
        prevWheelRevs = null;
        prevWheelTime = null;
        wheelStaleCount = 0;
        lastWheelAdvanceAt = 0;
        lastSpeedMps = undefined;
        prevCrankRevs = null;
        prevCrankTime = null;
        crankStaleCount = 0;
        lastCrankAdvanceAt = 0;
        lastCadence = undefined;
    }

    /**
     * @param {DataView | ArrayBuffer | ArrayBufferView} raw
     * @param {number} [nowMs]
     */
    function decode(raw, nowMs = Date.now()) {
        const packet = decodeCscMeasurement(raw);
        if (!packet) return null;

        /** @type {{
         *   flags: number,
         *   speed?: number,
         *   speedKmh?: number,
         *   cadence?: number,
         *   wheelRevolutions?: number,
         *   lastWheelEventTime?: number,
         *   crankRevolutions?: number,
         *   lastCrankEventTime?: number,
         * }} */
        const result = { ...packet };

        if (packet.wheelRevolutions !== undefined && packet.lastWheelEventTime !== undefined) {
            if (prevWheelRevs !== null && prevWheelTime !== null) {
                const dRevs = unsignedDelta(packet.wheelRevolutions, prevWheelRevs, UINT32_MOD);
                const dTicks = unsignedDelta(packet.lastWheelEventTime, prevWheelTime, UINT16_MOD);
                if (dRevs > 0 && dTicks > 0) {
                    const dtSec = dTicks / CSC_TIME_RESOLUTION;
                    const speedMps = (dRevs * wheelCircumferenceM) / dtSec;
                    if (speedMps >= 0 && speedMps <= 120) {
                        lastSpeedMps = speedMps;
                    }
                    wheelStaleCount = 0;
                    lastWheelAdvanceAt = nowMs;
                } else {
                    wheelStaleCount += 1;
                    if (wheelStaleCount >= maxCoastRepeats || (lastWheelAdvanceAt > 0 && nowMs - lastWheelAdvanceAt >= staleMs)) {
                        lastSpeedMps = 0;
                    }
                }
            } else {
                lastWheelAdvanceAt = nowMs;
            }
            prevWheelRevs = packet.wheelRevolutions;
            prevWheelTime = packet.lastWheelEventTime;

            if (lastSpeedMps !== undefined) {
                result.speed = lastSpeedMps;
                result.speedKmh = lastSpeedMps * 3.6;
            }
        }

        if (packet.crankRevolutions !== undefined && packet.lastCrankEventTime !== undefined) {
            if (prevCrankRevs !== null && prevCrankTime !== null) {
                const dRevs = unsignedDelta(packet.crankRevolutions, prevCrankRevs, UINT16_MOD);
                const dTicks = unsignedDelta(packet.lastCrankEventTime, prevCrankTime, UINT16_MOD);
                if (dRevs > 0 && dTicks > 0) {
                    const dtSec = dTicks / CSC_TIME_RESOLUTION;
                    const rpm = Math.round((dRevs / dtSec) * 60);
                    if (rpm >= 0 && rpm <= 255) {
                        lastCadence = rpm;
                    }
                    crankStaleCount = 0;
                    lastCrankAdvanceAt = nowMs;
                } else {
                    crankStaleCount += 1;
                    if (crankStaleCount >= maxCoastRepeats || (lastCrankAdvanceAt > 0 && nowMs - lastCrankAdvanceAt >= staleMs)) {
                        lastCadence = 0;
                    }
                }
            } else {
                lastCrankAdvanceAt = nowMs;
            }
            prevCrankRevs = packet.crankRevolutions;
            prevCrankTime = packet.lastCrankEventTime;

            if (lastCadence !== undefined) {
                result.cadence = lastCadence;
            }
        }

        return result;
    }

    return Object.freeze({ decode, reset });
}

export {
    CSC_TIME_RESOLUTION,
    DEFAULT_WHEEL_CIRCUMFERENCE_M,
    decodeCscMeasurement,
    createCscDecoder,
};
