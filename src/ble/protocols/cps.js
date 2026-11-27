// @ts-check
//
// Bluetooth SIG Cycling Power Service (0x1818) / Measurement (0x2A63) Codec
//

const DEFAULT_WHEEL_CIRCUMFERENCE_M = 2.105;
const CPS_WHEEL_TIME_RESOLUTION = 2048; // 1/2048 s per tick
const CPS_CRANK_TIME_RESOLUTION = 1024; // 1/1024 s per tick
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
 * Rollover-safe unsigned modular difference `(current - previous) mod modulo`.
 *
 * @param {number} current
 * @param {number} previous
 * @param {number} modulo
 * @returns {number}
 */
function unsignedDelta(current, previous, modulo) {
    const diff = current - previous;
    return diff >= 0 ? diff : diff + modulo;
}

/**
 * Decode raw fields of a Cycling Power Measurement (0x2A63) packet.
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeCyclingPowerMeasurement(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 4) return null;

    const flags = view.getUint16(0, true);
    const power = view.getInt16(2, true);
    let offset = 4;

    /** @type {{
     *   flags: number,
     *   power: number,
     *   pedalPowerBalance?: number,
     *   accumulatedTorque?: number,
     *   wheelRevolutions?: number,
     *   lastWheelEventTime?: number,
     *   crankRevolutions?: number,
     *   lastCrankEventTime?: number,
     * }} */
    const out = { flags, power };

    // Bit 0: Pedal Power Balance Present (uint8, 0.5%)
    if ((flags & (1 << 0)) !== 0 && offset + 1 <= view.byteLength) {
        out.pedalPowerBalance = view.getUint8(offset) * 0.5;
        offset += 1;
    }

    // Bit 2: Accumulated Torque Present (uint16, 1/32 Nm)
    if ((flags & (1 << 2)) !== 0 && offset + 2 <= view.byteLength) {
        out.accumulatedTorque = view.getUint16(offset, true) / 32;
        offset += 2;
    }

    // Bit 4: Wheel Revolution Data Present (uint32 revs + uint16 1/2048 s event time)
    if ((flags & (1 << 4)) !== 0 && offset + 6 <= view.byteLength) {
        out.wheelRevolutions = view.getUint32(offset, true);
        out.lastWheelEventTime = view.getUint16(offset + 4, true);
        offset += 6;
    }

    // Bit 5: Crank Revolution Data Present (uint16 revs + uint16 1/1024 s event time)
    if ((flags & (1 << 5)) !== 0 && offset + 4 <= view.byteLength) {
        out.crankRevolutions = view.getUint16(offset, true);
        out.lastCrankEventTime = view.getUint16(offset + 2, true);
        offset += 4;
    }

    return out;
}

/**
 * Create a stateful Cycling Power decoder that derives rollover-safe wheel speed
 * and crank cadence across successive notifications.
 *
 * @param {{
 *   wheelCircumferenceM?: number,
 *   staleMs?: number,
 *   maxCoastRepeats?: number,
 * }} [options]
 */
function createCyclingPowerDecoder(options = {}) {
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
    let lastSpeed = undefined;

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
        lastSpeed = undefined;
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
        const packet = decodeCyclingPowerMeasurement(raw);
        if (!packet) return null;

        /** @type {{
         *   flags: number,
         *   power: number,
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
                    const dtSec = dTicks / CPS_WHEEL_TIME_RESOLUTION;
                    const speedMps = (dRevs * wheelCircumferenceM) / dtSec;
                    if (speedMps >= 0 && speedMps <= 120) {
                        lastSpeed = speedMps;
                    }
                    wheelStaleCount = 0;
                    lastWheelAdvanceAt = nowMs;
                } else {
                    wheelStaleCount += 1;
                    if (wheelStaleCount >= maxCoastRepeats || (lastWheelAdvanceAt > 0 && nowMs - lastWheelAdvanceAt >= staleMs)) {
                        lastSpeed = 0;
                    }
                }
            } else {
                lastWheelAdvanceAt = nowMs;
            }
            prevWheelRevs = packet.wheelRevolutions;
            prevWheelTime = packet.lastWheelEventTime;

            if (lastSpeed !== undefined) {
                result.speed = lastSpeed;
                result.speedKmh = lastSpeed * 3.6;
            }
        }

        if (packet.crankRevolutions !== undefined && packet.lastCrankEventTime !== undefined) {
            if (prevCrankRevs !== null && prevCrankTime !== null) {
                const dRevs = unsignedDelta(packet.crankRevolutions, prevCrankRevs, UINT16_MOD);
                const dTicks = unsignedDelta(packet.lastCrankEventTime, prevCrankTime, UINT16_MOD);
                if (dRevs > 0 && dTicks > 0) {
                    const dtSec = dTicks / CPS_CRANK_TIME_RESOLUTION;
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
    DEFAULT_WHEEL_CIRCUMFERENCE_M,
    CPS_WHEEL_TIME_RESOLUTION,
    CPS_CRANK_TIME_RESOLUTION,
    unsignedDelta,
    decodeCyclingPowerMeasurement,
    createCyclingPowerDecoder,
};
