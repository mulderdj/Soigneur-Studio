// @ts-check
//
// Bluetooth SIG Heart Rate Service (0x180D / 0x2A37) Codec
//

const RR_INTERVAL_RESOLUTION = 1024; // 1/1024 s per tick

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
 * Decode Heart Rate Measurement (0x2A37).
 *
 * Flags (uint8 at offset 0):
 *  - bit 0 (0x01): 0 = uint8 HR (1 byte), 1 = uint16 HR (2 bytes LE)
 *  - bits 1..2 (0x06): Sensor Contact Status
 *  - bit 3 (0x08): Energy Expended present (uint16 LE, 2 bytes, kJ)
 *  - bit 4 (0x10): RR-Interval values present (one or more uint16 LE in 1/1024 s)
 *
 * `rrIntervals` are returned in seconds (`raw / 1024`, rounded to millisecond precision
 * or exact seconds matching FIT `hrv.time` expectations in `models.js` / `hrv.test.js`).
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 */
function decodeHeartRateMeasurement(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 2) return null;

    const flags = view.getUint8(0);
    let offset = 1;

    const is16Bit = (flags & 0x01) !== 0;
    if (is16Bit && offset + 2 > view.byteLength) return null;

    const heartRate = is16Bit ? view.getUint16(offset, true) : view.getUint8(offset);
    offset += is16Bit ? 2 : 1;

    const contactSupported = (flags & 0x04) !== 0;
    const contactDetected = contactSupported ? (flags & 0x02) !== 0 : undefined;

    /** @type {number | undefined} */
    let energyExpended = undefined;
    if ((flags & 0x08) !== 0) {
        if (offset + 2 <= view.byteLength) {
            energyExpended = view.getUint16(offset, true);
            offset += 2;
        } else {
            offset = view.byteLength;
        }
    }

    /** @type {number[]} */
    const rrIntervals = [];
    if ((flags & 0x10) !== 0) {
        while (offset + 2 <= view.byteLength) {
            const rawRr = view.getUint16(offset, true);
            offset += 2;
            if (rawRr > 0 && rawRr !== 0xffff) {
                rrIntervals.push(Math.round((rawRr / RR_INTERVAL_RESOLUTION) * 1000) / 1000);
            }
        }
    }

    return {
        flags,
        heartRate,
        contactDetected,
        energyExpended,
        rrIntervals,
    };
}

export {
    RR_INTERVAL_RESOLUTION,
    decodeHeartRateMeasurement,
};
