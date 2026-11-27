// @ts-check
//
// Bluetooth SIG Battery Service (0x180F / 0x2A19) Codec
//

import { clamp } from '../../functions.js';

/**
 * Decode Battery Level (0x2A19): uint8 percentage 0..100.
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 * @returns {number | null}
 */
function decodeBatteryLevel(raw) {
    const view = raw instanceof DataView
        ? raw
        : ArrayBuffer.isView(raw)
            ? new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
            : new DataView(raw);
    if (view.byteLength < 1) return null;
    return clamp(0, 100, view.getUint8(0));
}

export { decodeBatteryLevel };
