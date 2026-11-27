// @ts-check
//
// CORE Body Temperature BLE Codec (`00002100-5b1e-4347-b07c-97b514dae121` / `00002101-...`)
//
// Supports both:
//   1. CORE Temperature Measurement (0x2101):
//      - Byte 0: Flags
//          bit 0 (0x01): Skin Temperature Present (sint16 LE, 0.01 deg)
//          bit 1 (0x02): Core Reserved Present (sint16 LE)
//          bit 2 (0x04): Quality & State Present (uint8)
//          bit 3 (0x08): Temperature Unit (0 = Celsius, 1 = Fahrenheit)
//          bit 4 (0x10): Heart Rate Present (uint8 bpm)
//      - Bytes 1..2: Core Body Temperature (sint16 LE, 0.01 deg; 0x7FFF = invalid)
//      - Optional fields in flag bit order
//   2. IEEE-11073 32-bit FLOAT decoding helper (for standard BLE Health Thermometer 0x2A1C).
//

import { toFixed } from '../../functions.js';

const CORE_TEMP_INVALID = 0x7fff;

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
 * Convert Fahrenheit to Celsius.
 * @param {number} f
 * @returns {number}
 */
function fahrenheitToCelsius(f) {
    return ((f - 32) * 5) / 9;
}

/**
 * Decode an IEEE-11073 32-bit FLOAT (24-bit signed mantissa LE + 8-bit signed exponent).
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 * @param {number} [offset]
 * @returns {number | null}
 */
function decodeIeee11073Float(raw, offset = 0) {
    const view = toDataView(raw);
    if (offset + 4 > view.byteLength) return null;

    const b0 = view.getUint8(offset);
    const b1 = view.getUint8(offset + 1);
    const b2 = view.getUint8(offset + 2);
    const exponent = view.getInt8(offset + 3);

    let mantissa = b0 | (b1 << 8) | (b2 << 16);
    // Special IEEE-11073 NaN / NRes / +/-Inf sentinels
    if (mantissa === 0x007fffff || mantissa === 0x00800000 || mantissa === 0x007ffffe || mantissa === 0x00800002) {
        return null;
    }
    if ((mantissa & 0x00800000) !== 0) {
        mantissa |= ~0x00ffffff;
    }

    return mantissa * Math.pow(10, exponent);
}

/**
 * Decode CORE Body Temperature characteristic (`00002101-5b1e-4347-b07c-97b514dae121`).
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeCoreTemperature(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 3) return null;

    const flags = view.getUint8(0);
    const hasSkinTemp = (flags & 0x01) !== 0;
    const hasCoreReserved = (flags & 0x02) !== 0;
    const hasQualityAndState = (flags & 0x04) !== 0;
    const isFahrenheit = (flags & 0x08) !== 0;
    const hasHeartRate = (flags & 0x10) !== 0;

    let offset = 1;
    const rawCore = view.getInt16(offset, true);
    offset += 2;

    /** @type {{
     *   flags: number,
     *   coreBodyTemperature?: number,
     *   skinTemperature?: number,
     *   quality?: number,
     *   heartRate?: number,
     * }} */
    const result = { flags };

    if (rawCore !== CORE_TEMP_INVALID && rawCore !== -32768) {
        const temp = rawCore * 0.01;
        result.coreBodyTemperature = toFixed(isFahrenheit ? fahrenheitToCelsius(temp) : temp, 2);
    }

    if (hasSkinTemp && offset + 2 <= view.byteLength) {
        const rawSkin = view.getInt16(offset, true);
        offset += 2;
        if (rawSkin !== CORE_TEMP_INVALID && rawSkin !== -32768) {
            const skin = rawSkin * 0.01;
            result.skinTemperature = toFixed(isFahrenheit ? fahrenheitToCelsius(skin) : skin, 2);
        }
    }

    if (hasCoreReserved && offset + 2 <= view.byteLength) {
        offset += 2;
    }

    if (hasQualityAndState && offset + 1 <= view.byteLength) {
        const qs = view.getUint8(offset);
        offset += 1;
        result.quality = qs & 0x07;
    }

    if (hasHeartRate && offset + 1 <= view.byteLength) {
        const hr = view.getUint8(offset);
        offset += 1;
        if (hr > 0 && hr !== 0xff) {
            result.heartRate = hr;
        }
    }

    return result;
}

/**
 * Decode standard Bluetooth Health Thermometer Measurement (0x2A1C) using IEEE-11073 FLOAT.
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeHealthThermometer(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 5) return null;
    const flags = view.getUint8(0);
    const isFahrenheit = (flags & 0x01) !== 0;
    const value = decodeIeee11073Float(view, 1);
    if (value === null) return null;
    return {
        flags,
        coreBodyTemperature: toFixed(isFahrenheit ? fahrenheitToCelsius(value) : value, 2),
    };
}

export {
    CORE_TEMP_INVALID,
    decodeIeee11073Float,
    decodeCoreTemperature,
    decodeHealthThermometer,
};
