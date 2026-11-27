// @ts-check
//
// Moxy Muscle Oxygen Sensor BLE Codec (`6404d801-...` / `6404d804-...`)
//
// Moxy Sensor Data packet layout (little-endian):
//   Standard 7+ byte packet:
//     [0]    Packet / status byte (uint8)
//     [1..2] Current SmO2 (uint16 LE, 0.01 % resolution, 0..100%)
//     [3..4] Previous SmO2 (uint16 LE, 0.01 % resolution)
//     [5..6] Total Hemoglobin THb (uint16 LE, 0.01 g/dL resolution)
//   Compact 4..6 byte packet fallback:
//     [0..1] Current SmO2 (uint16 LE, 0.01 % resolution)
//     [2..3] Total Hemoglobin THb (uint16 LE, 0.01 g/dL resolution)
//

import { clamp, toFixed } from '../../functions.js';

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
 * Decode Moxy SmO2 & THb notification payload.
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeMoxyMeasurement(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 4) return null;

    let rawSmo2;
    let rawPrevSmo2;
    let rawThb;

    if (view.byteLength >= 7) {
        rawSmo2 = view.getUint16(1, true);
        rawPrevSmo2 = view.getUint16(3, true);
        rawThb = view.getUint16(5, true);
    } else {
        rawSmo2 = view.getUint16(0, true);
        rawThb = view.getUint16(2, true);
    }

    /** @type {{ smo2?: number, previousSmo2?: number, thb?: number }} */
    const out = {};

    if (rawSmo2 !== 0xffff && rawSmo2 !== 0x3ff && rawSmo2 !== 0x3fe) {
        const pct = rawSmo2 * 0.01;
        if (pct >= 0 && pct <= 100) {
            out.smo2 = toFixed(clamp(0, 100, pct), 2);
        }
    }

    if (rawPrevSmo2 !== undefined && rawPrevSmo2 !== 0xffff) {
        const prevPct = rawPrevSmo2 * 0.01;
        if (prevPct >= 0 && prevPct <= 100) {
            out.previousSmo2 = toFixed(clamp(0, 100, prevPct), 2);
        }
    }

    if (rawThb !== 0xffff && rawThb !== 0xfff && rawThb !== 0xffe) {
        const thbVal = rawThb * 0.01;
        if (thbVal >= 0 && thbVal <= 400) {
            out.thb = toFixed(thbVal, 2);
        }
    }

    return out;
}

export { decodeMoxyMeasurement };
