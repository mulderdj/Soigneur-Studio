// @ts-check
//
// Soigneur FIT Decoder powered by Garmin's official @garmin/fitsdk.
//
// Provides both:
//   - decodeFit(input) / FITjs.decode(input): ordered list of normalized
//     { type: 'data', name: '<snake_case>', mesgNum, fields: { <snake_case> } }
//     messages with Unix-ms timestamps and absent/invalid fields omitted.
//   - decodeFitMessages(input, options): direct @garmin/fitsdk grouped messages
//     plus integrity metadata.
//

import { Decoder, Profile, Stream, Utils } from '@garmin/fitsdk';

/** @type {Map<string, string>} */
const snakeCache = new Map();

/**
 * Convert a camelCase identifier or enum token from @garmin/fitsdk into snake_case.
 * @param {string} name
 * @returns {string}
 */
function camelToSnake(name) {
    const cached = snakeCache.get(name);
    if(cached !== undefined) return cached;
    const out = String(name)
        .trim()
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .toLowerCase();
    snakeCache.set(name, out);
    return out;
}

/** @type {Map<number, { name: string, fieldsByName: Map<string, any> }>} */
const mesgProfileCache = new Map();

/**
 * Look up (and memoize) the normalized profile metadata for a FIT global message number.
 * @param {number} mesgNum
 */
function getMesgMeta(mesgNum) {
    let meta = mesgProfileCache.get(mesgNum);
    if(meta !== undefined) return meta;

    const raw = /** @type {any} */ (Profile.messages)?.[mesgNum];
    const fieldsByName = new Map();
    if(raw?.fields) {
        for(const field of Object.values(raw.fields)) {
            if(field?.name) fieldsByName.set(field.name, field);
            if(Array.isArray(field?.subFields)) {
                for(const sub of field.subFields) {
                    if(sub?.name) fieldsByName.set(sub.name, sub);
                }
            }
        }
    }
    meta = {
        name: camelToSnake(raw?.name ?? `message_${mesgNum}`),
        fieldsByName,
    };
    mesgProfileCache.set(mesgNum, meta);
    return meta;
}

/**
 * Convert a DataView, TypedArray (Uint8Array / Buffer), ArrayBuffer, or Stream into a @garmin/fitsdk Stream.
 * @param {ArrayBuffer | ArrayBufferView | Stream} input
 * @returns {Stream}
 */
function toStream(input) {
    if(input instanceof Stream) return input;
    if(input instanceof ArrayBuffer) return Stream.fromArrayBuffer(input);
    if(ArrayBuffer.isView(input)) {
        if(input.buffer instanceof ArrayBuffer &&
           input.byteOffset === 0 &&
           input.byteLength === input.buffer.byteLength) {
            return Stream.fromArrayBuffer(input.buffer);
        }
        const copy = new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
        return Stream.fromArrayBuffer(copy.buffer);
    }
    throw new TypeError('Expected DataView, Uint8Array, ArrayBuffer, or Stream');
}

/**
 * Normalize a single field value from @garmin/fitsdk into Soigneur's canonical representation:
 *   - Date -> Unix timestamp in ms
 *   - localDateTime -> Unix timestamp in ms
 *   - FIT enum string -> snake_case string (leaving free-form string fields untouched)
 * @param {any} value
 * @param {any} fieldProfile
 * @returns {any}
 */
function normalizeValue(value, fieldProfile) {
    if(value instanceof Date) return value.getTime();
    const fieldType = fieldProfile?.type;
    if(fieldType === 'localDateTime' && typeof value === 'number') {
        return value * 1000 + Utils.FIT_EPOCH_MS;
    }
    if(typeof value === 'string' && fieldProfile && fieldType !== 'string') {
        return camelToSnake(value);
    }
    if(Array.isArray(value)) {
        return value.map(v => (v === null || v === undefined ? v : normalizeValue(v, fieldProfile)));
    }
    return value;
}

/**
 * Apply developer field scale and offset when provided in its field_description message.
 * @param {any} rawValue
 * @param {any} desc
 */
function scaleDeveloperValue(rawValue, desc) {
    if(rawValue === null || rawValue === undefined) return undefined;
    const scale = Number.isFinite(desc?.scale) && desc.scale !== 0 ? desc.scale : 1;
    const offset = Number.isFinite(desc?.offset) ? desc.offset : 0;
    if(scale === 1 && offset === 0) return rawValue;
    if(typeof rawValue === 'number') return (rawValue / scale) - offset;
    if(Array.isArray(rawValue)) {
        return rawValue.map(v => (typeof v === 'number' ? (v / scale) - offset : v));
    }
    return rawValue;
}

/**
 * Decode a binary FIT payload directly with @garmin/fitsdk's Decoder.
 * @param {ArrayBuffer | ArrayBufferView | Stream} input
 * @param {Record<string, any>} [options]
 */
function decodeFitMessages(input, options = {}) {
    if(!input) {
        return {messages: {}, profileVersion: null, errors: [], isFIT: false, integrityValid: false};
    }
    const stream = toStream(input);
    const isFIT = Decoder.isFIT(stream);
    if(!isFIT) {
        return {messages: {}, profileVersion: null, errors: [new Error('Input is not a FIT file')], isFIT: false, integrityValid: false};
    }
    const decoder = new Decoder(stream);
    const integrityValid = decoder.checkIntegrity();
    stream.reset();
    const result = decoder.read({
        expandSubFields: true,
        expandComponents: true,
        applyScaleAndOffset: true,
        convertTypesToStrings: true,
        convertDateTimesToDates: true,
        mergeHeartRates: true,
        ...options,
    });
    return {
        messages: result.messages,
        profileVersion: result.profileVersion,
        errors: result.errors,
        isFIT,
        integrityValid,
    };
}

/**
 * Decode a binary FIT payload into an ordered list of normalized data messages:
 *   [{ type: 'data', name: 'record', mesgNum: 20, fields: { timestamp, power, ... } }, ...]
 * Never throws on malformed or truncated inputs; returns any valid messages decoded before EOF.
 *
 * @param {ArrayBuffer | ArrayBufferView | Stream} input
 * @returns {Array<{ type: 'data', name: string, mesgNum: number, fields: Record<string, any>, developer_fields?: Record<string, any>, developerFields?: Record<string, any> }>}
 */
function decodeFit(input) {
    if(!input) return [];
    let stream;
    try {
        stream = toStream(input);
    } catch {
        return [];
    }
    if(!Decoder.isFIT(stream)) return [];

    /** @type {Array<{ mesgNum: number, message: Record<string, any> }>} */
    const ordered = [];
    /** @type {Map<number | string, any>} */
    const devDescriptions = new Map();

    const readOpts = {
        /** @param {number} mesgNum @param {Record<string, any>} message */
        mesgListener: (mesgNum, message) => {
            ordered.push({mesgNum, message});
        },
        /** @param {number} key @param {any} _devId @param {any} fieldDesc */
        fieldDescriptionListener: (key, _devId, fieldDesc) => {
            devDescriptions.set(key, fieldDesc);
            devDescriptions.set(String(key), fieldDesc);
        },
        expandSubFields: true,
        expandComponents: true,
        applyScaleAndOffset: true,
        convertTypesToStrings: true,
        convertDateTimesToDates: true,
        mergeHeartRates: true,
    };

    const decoder = new Decoder(stream);
    decoder.read(readOpts);

    // Unfinished FIT files (e.g. crashed head unit / Zwift session) sometimes leave
    // header.dataSize === 0 even though valid records follow the 14-byte header.
    if(ordered.length === 0 && stream.length > 16) {
        stream.reset();
        if(stream.peekByte() === 14) {
            decoder.read({...readOpts, skipHeader: true});
        }
    }

    return ordered.map(({mesgNum, message}) => {
        const meta = getMesgMeta(mesgNum);
        /** @type {Record<string, any>} */
        const fields = {};

        for(const [key, rawVal] of Object.entries(message)) {
            if(key === 'developerFields' || rawVal === null || rawVal === undefined) continue;
            const fieldProfile = meta.fieldsByName.get(key);
            fields[camelToSnake(key)] = normalizeValue(rawVal, fieldProfile);
        }

        if(message.developerFields && typeof message.developerFields === 'object') {
            /** @type {Record<string, any>} */
            const devNamed = {};
            /** @type {Record<string, any>} */
            const devIndexed = {};
            for(const [devKey, rawVal] of Object.entries(message.developerFields)) {
                const desc = devDescriptions.get(devKey);
                const val = scaleDeveloperValue(rawVal, desc);
                if(val === undefined) continue;
                devIndexed[devKey] = val;
                if(typeof desc?.fieldName === 'string' && desc.fieldName.trim() !== '') {
                    const snakeName = camelToSnake(desc.fieldName);
                    devNamed[snakeName] = val;
                    if(fields[snakeName] === undefined) fields[snakeName] = val;
                }
            }
            if(Object.keys(devIndexed).length > 0) {
                return {
                    type: /** @type {'data'} */ ('data'),
                    name: meta.name,
                    mesgNum,
                    fields,
                    developer_fields: devNamed,
                    developerFields: devIndexed,
                };
            }
        }

        return {
            type: /** @type {'data'} */ ('data'),
            name: meta.name,
            mesgNum,
            fields,
        };
    });
}

const FITjs = Object.freeze({
    decode: decodeFit,
});

export {
    FITjs,
    decodeFit,
    decodeFitMessages,
    toStream,
    camelToSnake,
};
