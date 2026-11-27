// @ts-check
//
// Tacx ANT+ FE-C over BLE Codec (`6e40fec1-b5a3-f393-e0a9-e50e24dcca9e`)
//
// Frame layout (13 bytes):
//   [0]     0xA4 (ANT Sync)
//   [1]     0x09 (Payload length = 9: 1 channel byte + 8 data-page bytes)
//   [2]     Msg ID (0x4E broadcast data, 0x4F acknowledged data)
//   [3]     Channel number (default 0x05)
//   [4..11] 8-byte ANT+ FE-C data page
//   [12]    XOR checksum of bytes [0..11]
//

import { clamp } from '../../functions.js';

const FEC_SYNC = 0xa4;
const FEC_PAYLOAD_LENGTH = 0x09;
const FEC_MSG_BROADCAST = 0x4e;
const FEC_MSG_ACKNOWLEDGED = 0x4f;
const FEC_DEFAULT_CHANNEL = 0x05;

const FecDataPage = Object.freeze({
    generalFeData: 0x10,       // Page 16
    specificTrainerData: 0x19, // Page 25
    basicResistance: 0x30,     // Page 48
    targetPower: 0x31,         // Page 49
    windResistance: 0x32,      // Page 50
    trackResistance: 0x33,     // Page 51
    userConfig: 0x37,          // Page 55
});

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
 * Compute XOR checksum across `bytes[0..endExclusive-1]`.
 *
 * @param {Uint8Array | DataView} data
 * @param {number} [endExclusive]
 * @returns {number}
 */
function computeFecChecksum(data, endExclusive) {
    const view = data instanceof DataView ? data : toDataView(data);
    const limit = endExclusive ?? view.byteLength;
    let xorSum = 0;
    for (let i = 0; i < limit; i++) {
        xorSum ^= view.getUint8(i);
    }
    return xorSum & 0xff;
}

/**
 * Wrap an 8-byte FE-C data page into a 13-byte ANT-like frame.
 *
 * @param {ArrayLike<number>} pageBytes
 * @param {{ msgId?: number, channel?: number }} [options]
 * @returns {Uint8Array}
 */
function wrapFecFrame(pageBytes, options = {}) {
    const msgId = options.msgId ?? FEC_MSG_ACKNOWLEDGED;
    const channel = options.channel ?? FEC_DEFAULT_CHANNEL;
    const frame = new Uint8Array(13);
    frame[0] = FEC_SYNC;
    frame[1] = FEC_PAYLOAD_LENGTH;
    frame[2] = msgId & 0xff;
    frame[3] = channel & 0xff;
    for (let i = 0; i < 8; i++) {
        frame[4 + i] = (pageBytes[i] ?? 0xff) & 0xff;
    }
    frame[12] = computeFecChecksum(frame, 12);
    return frame;
}

/**
 * Parse an incoming FE-C over BLE packet (either 13-byte framed or raw 8-byte page).
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeFecFrame(raw) {
    const view = toDataView(raw);
    let pageOffset = 0;
    let channel = FEC_DEFAULT_CHANNEL;
    let msgId = FEC_MSG_BROADCAST;

    if (view.byteLength >= 12 && view.getUint8(0) === FEC_SYNC) {
        const msgLength = view.getUint8(1);
        msgId = view.getUint8(2);
        channel = view.getUint8(3);
        const totalExpected = msgLength + 4; // sync + len + msgId + payload + checksum
        if (view.byteLength >= totalExpected) {
            const expectedChecksum = computeFecChecksum(view, totalExpected - 1);
            const actualChecksum = view.getUint8(totalExpected - 1);
            if (expectedChecksum !== actualChecksum) {
                return null;
            }
        }
        pageOffset = 4;
    } else if (view.byteLength === 8) {
        pageOffset = 0;
    } else {
        return null;
    }

    if (pageOffset + 8 > view.byteLength) return null;

    const page = view.getUint8(pageOffset);

    /** @type {{
     *   page: number,
     *   channel: number,
     *   msgId: number,
     *   speed?: number,
     *   speedKmh?: number,
     *   heartRate?: number,
     *   distance?: number,
     *   elapsedTime?: number,
     *   cadence?: number,
     *   power?: number,
     *   accumulatedPower?: number,
     *   eventCount?: number,
     * }} */
    const out = { page, channel, msgId };

    if (page === FecDataPage.generalFeData) {
        // Page 16 (0x10): General FE Data
        const elapsedRaw = view.getUint8(pageOffset + 2);
        const distanceRaw = view.getUint8(pageOffset + 3);
        const speedRaw = view.getUint16(pageOffset + 4, true); // 0.001 m/s
        const hrRaw = view.getUint8(pageOffset + 6);

        out.elapsedTime = elapsedRaw * 0.25;
        out.distance = distanceRaw;

        if (speedRaw !== 0xffff) {
            const speedMps = speedRaw * 0.001;
            out.speed = speedMps;
            out.speedKmh = speedMps * 3.6;
        }
        if (hrRaw !== 0xff) {
            out.heartRate = hrRaw;
        }
    } else if (page === FecDataPage.specificTrainerData) {
        // Page 25 (0x19): Specific Trainer / Stationary Bike Data
        const eventCount = view.getUint8(pageOffset + 1);
        const cadenceRaw = view.getUint8(pageOffset + 2);
        const accumulatedPower = view.getUint16(pageOffset + 3, true);
        const powerLsb = view.getUint8(pageOffset + 5);
        const powerMsbAndStatus = view.getUint8(pageOffset + 6);
        const instPower = powerLsb | ((powerMsbAndStatus & 0x0f) << 8);

        out.eventCount = eventCount;
        out.accumulatedPower = accumulatedPower;

        if (cadenceRaw !== 0xff) {
            out.cadence = cadenceRaw;
        }
        if (instPower !== 0xfff) {
            out.power = instPower;
        }
    }

    return out;
}

/**
 * Encode Page 48 (0x30) Basic Resistance: percentage 0..100% with 0.5% resolution (0..200).
 *
 * @param {number} resistancePercent
 * @param {{ channel?: number }} [options]
 * @returns {Uint8Array}
 */
function encodeFecBasicResistance(resistancePercent, options = {}) {
    const pct = clamp(0, 100, Math.max(0, Number.isFinite(resistancePercent) ? resistancePercent : 0));
    const raw = clamp(0, 200, Math.round(pct * 2));
    return wrapFecFrame(
        [FecDataPage.basicResistance, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, raw],
        options,
    );
}

/**
 * Encode Page 49 (0x31) Target Power: 0..4000 W with 0.25 W resolution (uint16 LE 0..16000).
 *
 * @param {number} watts
 * @param {{ channel?: number }} [options]
 * @returns {Uint8Array}
 */
function encodeFecTargetPower(watts, options = {}) {
    const clean = clamp(0, 4000, Number.isFinite(watts) ? watts : 0);
    const raw = clamp(0, 16000, Math.round(clean * 4));
    return wrapFecFrame(
        [
            FecDataPage.targetPower,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            raw & 0xff,
            (raw >> 8) & 0xff,
        ],
        options,
    );
}

/**
 * Encode Page 51 (0x33) Track Resistance:
 *  - grade: -200.00% .. +200.00% encoded with +200% offset at 0.01% resolution (0..40000)
 *  - crr:   0.0 .. 0.0127 encoded at 5e-5 resolution (0..254, default 0.004 -> 80)
 *
 * @param {{ grade?: number, crr?: number }} [params]
 * @param {{ channel?: number }} [options]
 * @returns {Uint8Array}
 */
function encodeFecTrackResistance(params = {}, options = {}) {
    const grade = clamp(-200, 200, Number.isFinite(params.grade) ? params.grade : 0);
    const crr = params.crr;
    const rawGrade = clamp(0, 40000, Math.round((grade + 200) * 100));
    const rawCrr = Number.isFinite(crr)
        ? clamp(0, 254, Math.round(/** @type {number} */ (crr) * 20000))
        : 80; // 0.004 default rolling resistance

    return wrapFecFrame(
        [
            FecDataPage.trackResistance,
            0xff,
            0xff,
            0xff,
            0xff,
            rawGrade & 0xff,
            (rawGrade >> 8) & 0xff,
            rawCrr,
        ],
        options,
    );
}

export {
    FEC_SYNC,
    FEC_PAYLOAD_LENGTH,
    FEC_MSG_BROADCAST,
    FEC_MSG_ACKNOWLEDGED,
    FEC_DEFAULT_CHANNEL,
    FecDataPage,
    computeFecChecksum,
    wrapFecFrame,
    decodeFecFrame,
    encodeFecBasicResistance,
    encodeFecTargetPower,
    encodeFecTrackResistance,
};
