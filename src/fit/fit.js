// @ts-check
//
// Soigneur Studio FIT entry point powered by Garmin's official @garmin/fitsdk (v21.222.0).
//

import { CrcCalculator, Decoder, Encoder, Profile, Stream, Utils } from '@garmin/fitsdk';
import { FITjs, decodeFit, decodeFitMessages, toStream } from './decoder.js';
import { localActivity } from './local-activity.js';
import { localCourse } from './local-course.js';

/**
 * Convert a DataView, TypedArray, or ArrayBuffer into a Uint8Array view without unnecessary copying.
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {Uint8Array}
 */
function toUint8Array(input) {
    if(input instanceof Uint8Array) return input;
    if(ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if(input instanceof ArrayBuffer) return new Uint8Array(input);
    throw new TypeError('Expected DataView, Uint8Array, or ArrayBuffer');
}

const CRC = Object.freeze({
    size: 2,
    /**
     * Calculate FIT CRC-16 over bytes [start, endExclusive) using @garmin/fitsdk's CrcCalculator.
     * @param {ArrayBuffer | ArrayBufferView} input
     * @param {number} [start=0]
     * @param {number} [end]
     * @returns {number}
     */
    calculate(input, start = 0, end) {
        const bytes = toUint8Array(input);
        return CrcCalculator.calculateCRC(bytes, start, end ?? bytes.byteLength);
    },
    /**
     * Read the 2-byte header CRC from a 14-byte FIT file header.
     * @param {DataView} view
     */
    getHeaderCRC(view) {
        const number = view.getUint16(12, true);
        return {number, array: [number & 0xFF, (number >> 8) & 0xFF]};
    },
    /**
     * Read the trailing 2-byte file CRC from a FIT DataView.
     * @param {DataView} view
     */
    getFileCRC(view) {
        const pos = view.byteLength - 2;
        const number = view.getUint16(pos, true);
        return {number, array: [number & 0xFF, (number >> 8) & 0xFF]};
    },
    /**
     * Verify both header and file CRCs via @garmin/fitsdk's Decoder.checkIntegrity().
     * @param {ArrayBuffer | ArrayBufferView} input
     * @returns {boolean}
     */
    isValid(input) {
        try {
            return new Decoder(toStream(input)).checkIntegrity();
        } catch {
            return false;
        }
    },
});

function FIT() {
    return Object.freeze({
        localActivity,
        localCourse,
        FITjs,
        CRC,
        profiles: Profile,
        Decoder,
        Encoder,
        Profile,
        Stream,
        CrcCalculator,
        Utils,
        decodeFit,
        decodeFitMessages,
    });
}

const fit = FIT();

export {
    FIT,
    fit,
    FITjs,
    CRC,
    localActivity,
    localCourse,
    decodeFit,
    decodeFitMessages,
    Decoder,
    Encoder,
    Profile,
    Stream,
    CrcCalculator,
    Utils,
};
