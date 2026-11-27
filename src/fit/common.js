import { equals, } from '../functions.js';

const HeaderType = {
    normal:    'normal',
    timestamp: 'timestamp',
};

const RecordType = {
    header:     'header',
    definition: 'definition',
    data:       'data',
    crc:        'crc',
};

// Base Type To DataView accessor method
const uint8   = [0, 2, 7, 10, 13, 'enum', 'uint8', 'string', 'byte'];
const uint16  = [132, 139, 'uint16', 'uint16z'];
const uint32  = [134, 140, 'uint32', 'uint32z'];
const uint64  = [143, 144, 'uint64', 'uint64z'];

const int8    = [1, 'sint8'];
const int16   = [131, 'sint16'];
const int32   = [133, 'sint32'];
const int64   = [142, 'sint64'];

const float32 = [136, 'float32'];
const float64 = [137, 'float64'];

function typeToAccessor(basetype, method = 'set') {
    if(uint8.includes(basetype))   return `${method}Uint8`;
    if(uint16.includes(basetype))  return `${method}Uint16`;
    if(uint32.includes(basetype))  return `${method}Uint32`;
    if(uint64.includes(basetype))  return `${method}Uint64`;
    if(int8.includes(basetype))    return `${method}Int8`;
    if(int16.includes(basetype))   return `${method}Int16`;
    if(int32.includes(basetype))   return `${method}Int32`;
    if(int64.includes(basetype))   return `${method}Int64`;
    if(float32.includes(basetype)) return `${method}Float32`;
    if(float64.includes(basetype)) return `${method}Float64`;

    return `${method}Uint8`;
}
// END Base Type To DataView accessor method

// BaseType | DataviewType, DataView, Int, Bool, Bool -> Int?
function getView(type, dataview, i = 0, architecture = true, useBaseType = true) {
    if(useBaseType) {
        return dataview[typeToAccessor(type, 'get')](i, architecture);
    }
    try {
        return dataview[`get${type}`](i, architecture);
    } catch(e) {
        console.error(`:fit :getView ${type} at ${i}`, e);
    }
}

// Int, DataView, Int, Bool, -> String
function getStringView(size, dataview, i = 0, architecture = true) {
    let value = '';
    for(let f=0; f < size; f++) {
        value += String.fromCharCode(dataview.getUint8(i+f, architecture));
    }
    return value.replace(/\x00/gi, '');
}

// BaseType | DataviewType, Number, DataView, Int, Bool -> Dataview
function setView(
    type, value, dataview, i = 0, architecture = true, useBaseType = true
) {
    if(useBaseType) {
        return dataview[typeToAccessor(type, 'set')](i, value, architecture);
    }
    return dataview[`set${type}`](i, value, architecture);
}

function ValueParser(args = {}) {
    return Object.freeze({
        encode: args.encode ?? ((x) => x),
        decode: args.decode ?? ((x) => x),
    });
}

const identityParser = ValueParser();

function FitString() {

    // BaseType -> Bool
    function isString(base_type) {
        return equals(base_type, 7);
    }

    function encode() {
    }

    // {size: Int}, DataView, Int, Bool, -> String
    function decode(field, dataview, i = 0, architecture) {
        return getStringView(field.size, dataview, i, architecture);
    }

    return Object.freeze({
        isString,
        encode,
        decode,
    });
}

function FitTimestamp() {
    const garmin_epoch = Date.parse('31 Dec 1989 00:00:00 GMT');
    const INVALID_TIMESTAMP = 0xFFFFFFFF;

    // FitSemanticType -> Bool
    function isTimestamp(type) {
        return ['date_time', 'local_date_time'].includes(type);
    }

    // JSTimestamp -> FitTimestamp
    function apply(jsTimestamp) {
        if(!Number.isFinite(jsTimestamp)) return INVALID_TIMESTAMP;
        return Math.round((jsTimestamp - garmin_epoch) / 1000);
    }

    // FitTimestamp -> JSTimestamp
    function remove(fitTimestamp) {
        if(fitTimestamp === INVALID_TIMESTAMP) return undefined;
        return (fitTimestamp * 1000) + garmin_epoch;
    }

    // JSTimestamp, JSTimestamp -> FitTimestamp
    function elapsed(start, end) {
        return (apply(end) - apply(start));
    }

    function encode(field, value, view, i, architecture) {
        return setView(field.base_type, apply(value), view, i, architecture);
    }

    // {base_type: BaseType}, Dataview, Int, Bool -> Timestamp
    function decode(field, view, i, architecture) {
        return remove(getView(field.base_type, view, i, architecture));
    }

    return Object.freeze({
        isTimestamp,
        apply,
        remove,
        elapsed,
        encode,
        decode,
    });
}

function FitNumber() {
    function isNumber() {
        throw `Not implemented!`;
    }

    function isFloatType(base_type) {
        return float32.includes(base_type) || float64.includes(base_type);
    }

    function apply(scale, offset, value, invalid, isFloat = false) {
        if(value === undefined || value === null || !Number.isFinite(value)) {
            return invalid ?? 0;
        }
        if(invalid !== undefined && value === invalid) return value;
        const scaled = (value * (scale ?? 1)) + ((offset ?? 0) * (scale ?? 1));
        return isFloat ? scaled : Math.round(scaled);
    }

    function remove(scale, offset, value, invalid, keepInvalid = false) {
        if(Number.isNaN(value)) return keepInvalid ? value : undefined;
        if(invalid !== undefined && value === invalid) {
            return keepInvalid ? value : undefined;
        }
        return ((value ?? 0) - ((offset ?? 0) * (scale ?? 1))) / (scale ?? 1);
    }

    // {base_type: BaseType, scale: Int, offset: Int}, Number, DataView, Int, Bool,
    // ->
    // DataView
    function encode(field, value, view, i = 0, architecture = true) {
        const isFloat = isFloatType(field.base_type);
        if(isFloat && (value === undefined || value === null || !Number.isFinite(value))) {
            if(float32.includes(field.base_type)) {
                return view.setUint32(i, 0xFFFFFFFF, architecture);
            }
            return view.setFloat64(i, NaN, architecture);
        }
        return setView(
            field.base_type,
            apply(field.scale, field.offset, value, field.invalid, isFloat),
            view, i, architecture
        );
    }

    // {base_type: BaseType, scale: Int, offset: Int}, DataView, Int, Bool, Bool
    // ->
    // Number | undefined
    function decode(field, view, i = 0, architecture = true, keepInvalid = false) {
        return remove(
            field.scale,
            field.offset,
            getView(field.base_type, view, i, architecture),
            field.invalid,
            keepInvalid
        );
    }

    return Object.freeze({
        isNumber,
        apply,
        remove,
        encode,
        decode,
    });
}

const type = {
    string: FitString(),
    timestamp: FitTimestamp(),
    number: FitNumber(),
};

export {
    HeaderType,
    RecordType,

    typeToAccessor,
    getView,
    setView,

    ValueParser,
    identityParser,

    type,
};

