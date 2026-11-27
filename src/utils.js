// @ts-check
import { exists, existance, equals, isArray, delay } from './functions.js';

const GARMIN_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);
const SEMICIRCLES_PER_DEG = (2 ** 31) / 180;
const DEG_PER_SEMICIRCLE = 180 / (2 ** 31);

const CRC16_NIBBLE_TABLE = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];

function twoDigits(n) {
    return String(Math.trunc(n)).padStart(2, '0');
}

function formatTime(options = {}) {
    const value = options.value;
    const fmt = options.format ?? 'hh:mm:ss';
    const unit = options.unit ?? 'seconds';

    if (unit !== 'seconds') {
        return value;
    }

    const total = Math.max(0, Math.floor(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    const hh = twoDigits(hours);
    const mm = twoDigits(minutes);
    const ss = twoDigits(seconds);

    if (fmt === 'mm:ss') {
        return total < 3600 ? `${mm}:${ss}` : `${hh}:${mm}:${ss}`;
    }
    if (fmt === 'hh:mm:ss') {
        return `${hh}:${mm}:${ss}`;
    }
    return '';
}

function dateToDashString(date) {
    const day = twoDigits(date.getDate());
    const month = twoDigits(date.getMonth() + 1);
    const year = String(date.getFullYear());
    const hour = twoDigits(date.getHours());
    const minute = twoDigits(date.getMinutes());
    return `${day}-${month}-${year}-at-${hour}-${minute}h`;
}

function time() {
    const nowDate = new Date();
    const hh = twoDigits(nowDate.getHours());
    const mm = twoDigits(nowDate.getMinutes());
    const ss = twoDigits(nowDate.getSeconds());
    const ms = String(nowDate.getMilliseconds()).padStart(4, '0');
    return `${hh}:${mm}:${ss}:${ms}`;
}

function isoDate(date = new Date(), local = true) {
    if (!local) {
        return date.toISOString().slice(0, 10);
    }
    const year = String(date.getFullYear());
    const month = twoDigits(date.getMonth() + 1);
    const day = twoDigits(date.getDate());
    return `${year}-${month}-${day}`;
}

function isoDateToWeekDay(isoDateString = isoDate()) {
    const date = new Date(isoDateString);
    return {
        day: date.getDate(),
        weekDay: date.toLocaleString('en-US', { weekday: 'short' }),
    };
}

function getStartEndOfWeek(fromDate = new Date(), iso = false) {
    const base = new Date(fromDate);
    const weekday = base.getDay();
    const mondayShift = weekday === 0 ? -6 : 1 - weekday;

    const monday = new Date(base);
    monday.setDate(monday.getDate() + mondayShift);

    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    return {
        startOfWeek: iso ? isoDate(monday) : monday,
        endOfWeek: iso ? isoDate(sunday) : sunday,
    };
}

function isToday(dateInput) {
    const target = new Date(dateInput);
    const current = new Date();
    return (
        target.getFullYear() === current.getFullYear() &&
        target.getMonth() === current.getMonth() &&
        target.getDate() === current.getDate()
    );
}

function format(value, precision = 1000) {
    return Math.round(value * precision) / precision;
}

function kphToMps(kph) {
    return format(kph / 3.6);
}

function mpsToKph(mps) {
    return 3.6 * mps;
}

async function backoff(options = {}) {
    const maxRetries = existance(options.max, 1);
    const initialWait = existance(options.wait, 1000);
    const fn = existance(options.fn);
    const onSuccess = existance(options.success, x => x);
    const onFail = existance(options.fail, x => x);
    const nextWait = existance(options.rate, x => x);
    const label = options.msg;

    let remaining = maxRetries;
    let waitMs = initialWait;

    while (true) {
        try {
            const out = await fn(remaining);
            return onSuccess(out);
        } catch (err) {
            if (remaining <= 0) {
                return onFail(err);
            }
            if (exists(label)) {
                console.log(`[retry] ${label} in ${nextWait(waitMs)}ms (${remaining} left)`);
            }
            await delay(waitMs);
            waitMs = nextWait(waitMs);
            remaining -= 1;
        }
    }
}

function degToSemicircles(degrees) {
    return degrees * SEMICIRCLES_PER_DEG;
}

function semicirclesToDeg(semicircles) {
    return semicircles * DEG_PER_SEMICIRCLE;
}

function digits(n) {
    return (Math.log(Math.max(1, Math.abs(n))) * Math.LOG10E + 1) | 0;
}

function rand(min = 0, max = 10) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function gte(a, b) { return a >= b; }
function lte(a, b) { return a <= b; }
function gt(a, b) { return a > b; }
function lt(a, b) { return a < b; }

function inRange(min, max, value, lowerCmp = gte, upperCmp = lte) {
    return lowerCmp(value, min) && upperCmp(value, max);
}

function divisors(n) {
    const result = [1];
    const limit = n / 2;
    for (let d = 2; d < limit; d++) {
        if (n % d === 0) {
            result.push(d);
        }
    }
    return result;
}

function translate(value, inMin, inMax, outMin, outMax) {
    const normalized = (value - inMin) / (inMax - inMin);
    return outMin + normalized * (outMax - outMin);
}

function hexColorToArray(hexColor) {
    const clean = hexColor.replace('#', '');
    const pairs = clean.match(/.{1,2}/g) ?? [];
    return pairs.map(part => parseInt(part, 16));
}

function arrayToHexColor(channels) {
    return '#' + channels.map(ch => Math.trunc(ch).toString(16).toUpperCase().padStart(2, '0')).join('');
}

function avgColor(hexA, hexB) {
    const a = hexColorToArray(hexA);
    const b = hexColorToArray(hexB);
    return arrayToHexColor(a.map((ch, idx) => Math.trunc((ch + b[idx]) / 2)));
}

function hex(n) {
    return '0x' + Math.trunc(Number(n)).toString(16).toUpperCase().padStart(2, '0');
}

function toFitTimestamp(timestampMs) {
    return Math.round((timestampMs - GARMIN_EPOCH_MS) / 1000);
}

function toJsTimestamp(fitSeconds) {
    return fitSeconds * 1000 + GARMIN_EPOCH_MS;
}

function now() {
    return toFitTimestamp(Date.now());
}

function timeDiff(t1, t2) {
    return Math.round(Math.abs(t1 / 1000 - t2 / 1000));
}

function toFitSpeed(speed, unit = 'kph') {
    if (unit === 'kph') {
        return Math.trunc((speed / 3.6) * 1000);
    }
    return speed;
}

function toFitDistance(distance, unit = 'km') {
    if (unit === 'km') {
        return Math.trunc(distance * 1000 * 100);
    }
    return distance;
}

function splitAt(items, delimiter) {
    if (!isArray(items)) {
        throw new TypeError(`splitAt expects an array, received: ${items}`);
    }
    /** @type {any[][]} */
    const groups = [];
    for (const item of items) {
        if (equals(item, delimiter) || groups.length === 0) {
            groups.push([item]);
        } else {
            groups[groups.length - 1].push(item);
        }
    }
    return groups;
}

function pad(items = [], targetLength = 0, fillValue = 0) {
    while (items.length < targetLength) {
        items.push(fillValue);
    }
    return items;
}

function calculateCRC(bytes, start, end) {
    let crc = 0;
    for (let i = start; i < end; i++) {
        const byte = bytes[i];
        let tmp = CRC16_NIBBLE_TABLE[crc & 0x0f];
        crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC16_NIBBLE_TABLE[byte & 0x0f];
        tmp = CRC16_NIBBLE_TABLE[crc & 0x0f];
        crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC16_NIBBLE_TABLE[(byte >> 4) & 0x0f];
    }
    return crc;
}

/** @type {Map<number | string, string>} */
const FIT_BASE_TYPE_ACCESSORS = new Map(/** @type {Array<[number | string, string]>} */ ([
    [0, 'Uint8'], ['enum', 'Uint8'],
    [1, 'Int8'], ['sint8', 'Int8'],
    [2, 'Uint8'], ['uint8', 'Uint8'],
    [7, 'Uint8'], ['string', 'Uint8'],
    [10, 'Uint8'],
    [13, 'Uint8'], ['byte', 'Uint8'],
    [131, 'Int16'], ['sint16', 'Int16'],
    [132, 'Uint16'], ['uint16', 'Uint16'],
    [133, 'Int32'], ['sint32', 'Int32'],
    [134, 'Uint32'], ['uint32', 'Uint32'],
    [136, 'Float32'], ['float32', 'Float32'],
    [137, 'Float64'], ['float64', 'Float64'],
    [139, 'Uint16'], ['uint16z', 'Uint16'],
    [140, 'Uint32'], ['uint32z', 'Uint32'],
    [142, 'Int64'], ['sint64', 'Int64'],
    [143, 'Uint64'], ['uint64', 'Uint64'],
    [144, 'Uint64'], ['uint64z', 'Uint64'],
]));

function typeToAccessor(baseType, prefix = 'set') {
    const suffix = FIT_BASE_TYPE_ACCESSORS.get(baseType) ?? 'Uint8';
    return `${prefix}${suffix}`;
}

export {
    formatTime,
    dateToDashString,
    isoDate,
    isoDateToWeekDay,
    getStartEndOfWeek,
    isToday,
    format,
    kphToMps,
    mpsToKph,
    time,
    pad,
    backoff,
    degToSemicircles,
    semicirclesToDeg,
    digits,
    rand,
    gte,
    lte,
    gt,
    lt,
    inRange,
    divisors,
    translate,
    hexColorToArray,
    arrayToHexColor,
    avgColor,
    hex,
    toFitTimestamp,
    toJsTimestamp,
    now,
    timeDiff,
    toFitSpeed,
    toFitDistance,
    splitAt,
    calculateCRC,
    typeToAccessor,
};
