// @ts-check

function equals(a, b) {
    return Object.is(a, b);
}

function isNull(value) {
    return value === null;
}

function isUndefined(value) {
    return value === undefined;
}

function isFunction(value) {
    return typeof value === 'function';
}

function isArray(value) {
    return Array.isArray(value);
}

function isArrayBuffer(value) {
    return value instanceof ArrayBuffer;
}

function isDataView(value) {
    return value instanceof DataView;
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCollection(value) {
    return isArray(value) || isObject(value);
}

function isString(value) {
    return typeof value === 'string';
}

function isNumber(value) {
    return typeof value === 'number' && !Number.isNaN(value);
}

function isAtomic(value) {
    return isNumber(value) || isString(value);
}

function exists(value) {
    return value !== null && value !== undefined;
}

function existance(value, fallback) {
    if (exists(value)) return value;
    if (exists(fallback)) return fallback;
    throw new Error('existance requires a fallback when value is null or undefined');
}

function expect(value, message = 'Expected a defined value') {
    if (exists(value)) return value;
    throw new Error(message);
}

function validate(predicates = [], value, fallback = undefined) {
    if (predicates.every(predicate => predicate(value))) {
        return value;
    }
    if (exists(fallback)) {
        return fallback;
    }
    throw new Error('Validation failed and no fallback was provided');
}

function empty(collection) {
    if (collection === undefined) return true;
    if (isObject(collection)) return Object.keys(collection).length === 0;
    if (typeof collection?.length !== 'number') {
        throw new TypeError(`empty expects an array, string, or object; received: ${collection}`);
    }
    return collection.length === 0;
}

function curry2(fn) {
    return function curried(firstArg, secondArg) {
        if (exists(secondArg)) {
            return fn(firstArg, secondArg);
        }
        return nextArg => fn(firstArg, nextArg);
    };
}

const nth = curry2((offset, items) => {
    const idx = offset < 0 ? items.length + offset : offset;
    return isString(items) ? items.charAt(idx) : items[idx];
});

function first(items) {
    return items === undefined ? undefined : items.at(0);
}

function second(items) {
    return items === undefined ? undefined : items.at(1);
}

function third(items) {
    return items === undefined ? undefined : items.at(2);
}

function last(items) {
    return items === undefined ? undefined : items.at(-1);
}

function map(collection, mapper) {
    if (isArray(collection)) {
        return collection.map(mapper);
    }
    if (isObject(collection)) {
        for (const key of Object.keys(collection)) {
            collection[key] = mapper(collection[key]);
        }
        return collection;
    }
    if (isString(collection)) {
        return Array.from(collection, ch => mapper(ch)).join('');
    }
    throw new TypeError('map expects an array, plain object, or string');
}

function traverse(root, visitor = x => x, initial = []) {
    let acc = initial;
    function walk(node) {
        for (const key of Object.keys(node)) {
            const val = node[key];
            if (isObject(val)) {
                walk(val);
            } else {
                acc = visitor(acc, key, val, node);
            }
        }
    }
    if (isObject(root)) {
        walk(root);
    }
    return acc;
}

function getIn(root, ...path) {
    let cursor = root;
    for (const key of path) {
        if (!exists(cursor) || !exists(cursor[key])) {
            return undefined;
        }
        cursor = cursor[key];
    }
    return cursor;
}

function set(target, key, value) {
    const out = target || {};
    out[key] = value;
    return out;
}

/**
 * @param {any} target
 * @param {any[]} path
 * @param {any} value
 * @returns {any}
 */
function setIn(target = {}, [head, ...rest], value) {
    return rest.length > 0
        ? set(target, head, setIn(target[head], rest, value))
        : set(target, head, value);
}

/**
 * @param {any[]} items
 * @param {string|number|false} [prop]
 */
function avg(items, prop = false) {
    if (prop !== false) {
        return items.reduce((mean, item, idx) => mean + (item[prop] - mean) / (idx + 1), 0);
    }
    return items.reduce((mean, item, idx) => mean + (item - mean) / (idx + 1), 0);
}

function mavg(currentValue, prevMean, currentCount, prevCount = currentCount - 1) {
    return (currentValue + prevCount * prevMean) / currentCount;
}

/**
 * @param {any[]} items
 * @param {string|number|false} [prop]
 */
function max(items, prop = false) {
    if (prop !== false) {
        return items.reduce((best, item) => (item[prop] > best ? item[prop] : best), 0);
    }
    return Math.max(...items);
}

/**
 * @param {any[]} items
 * @param {string|number|false} [prop]
 */
function sum(items, prop = false) {
    if (prop !== false) {
        return items.reduce((total, item) => total + item[prop], 0);
    }
    return items.reduce((total, item) => total + item, 0);
}

function rand(min = 0, maxVal = 10) {
    return Math.floor(Math.random() * (maxVal - min + 1) + min);
}

function capitalize(str) {
    return str.trim().replace(/^\w/, ch => ch.toUpperCase());
}

function escapeHtml(value) {
    if (!exists(value)) return '';
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function clamp(lower, upper, value) {
    if (value >= upper) return upper;
    if (value < lower) return lower;
    return value;
}

function compose2(f, g) {
    return (...args) => f(g(...args));
}

function compose(...fns) {
    return fns.reduce(compose2);
}

const comp = compose;

function pipe(...fns) {
    return fns.reduceRight(compose2);
}

function repeat(count) {
    return fn => initial => {
        let result = initial;
        for (let i = 0; i < count; i++) {
            result = fn(result);
        }
        return result;
    };
}

function once(fn, context) {
    let pending = fn;
    let cached;
    return /** @this {any} */ function runOnce(...args) {
        if (pending) {
            cached = pending.apply(context || this, args);
            pending = null;
        }
        return cached;
    };
}

function debounce(fn, waitMs, options = {}) {
    if (!isFunction(fn)) {
        throw new TypeError('debounce expects a function');
    }

    const host = typeof window !== 'undefined' ? window : globalThis;
    const useFrame = !waitMs && waitMs !== 0 && typeof host.requestAnimationFrame === 'function';
    const delayMs = existance(toNumber(waitMs), 0);
    const leading = toBool(options.leading);
    const trailing = exists(options.trailing) ? toBool(options.trailing) : true;
    const hasMaxWait = exists(options.maxWait);
    const maxWaitMs = hasMaxWait ? Math.max(existance(toNumber(options.maxWait), 0), delayMs) : 0;

    let timerId;
    let lastArgs;
    let lastThis;
    let lastCallAt;
    let lastInvokeAt = 0;
    let lastResult;

    function schedule(callback, ms) {
        if (useFrame) {
            if (timerId !== undefined) host.cancelAnimationFrame(timerId);
            return host.requestAnimationFrame(callback);
        }
        return setTimeout(callback, ms);
    }

    function clearScheduled(id) {
        if (useFrame) {
            host.cancelAnimationFrame(id);
        } else {
            clearTimeout(id);
        }
    }

    function invoke(at) {
        const args = lastArgs;
        const ctx = lastThis;
        lastArgs = undefined;
        lastThis = undefined;
        lastInvokeAt = at;
        lastResult = fn.apply(ctx, args);
        return lastResult;
    }

    function canInvoke(at) {
        if (lastCallAt === undefined) return true;
        const sinceCall = at - lastCallAt;
        const sinceInvoke = at - lastInvokeAt;
        return sinceCall >= delayMs || sinceCall < 0 || (hasMaxWait && sinceInvoke >= maxWaitMs);
    }

    function remainingMs(at) {
        const untilTrailing = delayMs - (at - lastCallAt);
        return hasMaxWait ? Math.min(untilTrailing, maxWaitMs - (at - lastInvokeAt)) : untilTrailing;
    }

    function finishTrailing(at) {
        timerId = undefined;
        if (trailing && lastArgs) {
            return invoke(at);
        }
        lastArgs = undefined;
        lastThis = undefined;
        return lastResult;
    }

    function onTimer() {
        const now = Date.now();
        if (canInvoke(now)) {
            return finishTrailing(now);
        }
        timerId = schedule(onTimer, remainingMs(now));
        return timerId;
    }

    /** @this {any} */
    function debounced(...args) {
        const now = Date.now();
        const ready = canInvoke(now);

        lastArgs = args;
        lastThis = this;
        lastCallAt = now;

        if (ready) {
            if (timerId === undefined) {
                lastInvokeAt = now;
                timerId = schedule(onTimer, delayMs);
                return leading ? invoke(now) : lastResult;
            }
            if (hasMaxWait) {
                timerId = schedule(onTimer, delayMs);
                return invoke(now);
            }
        }

        if (timerId === undefined) {
            timerId = schedule(onTimer, delayMs);
        }
        return lastResult;
    }

    debounced.cancel = () => {
        if (timerId !== undefined) {
            clearScheduled(timerId);
        }
        lastInvokeAt = 0;
        lastArgs = undefined;
        lastCallAt = undefined;
        lastThis = undefined;
        timerId = undefined;
    };

    debounced.flush = () => (timerId === undefined ? lastResult : finishTrailing(Date.now()));
    debounced.pending = () => timerId !== undefined;

    return debounced;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const wait = delay;

function createEventBus(options = {}) {
    const namespace = options.name || 'db';
    const bus = typeof window !== 'undefined' ? window : new EventTarget();
    let store = {};

    function create(initialState) {
        store = new Proxy(initialState, {
            set(target, prop, value) {
                const key = String(prop);
                target[key] = value;
                dispatch(`${namespace}:${key}`, target);
                return true;
            },
        });
    }

    function dispatch(eventType, payload) {
        bus.dispatchEvent(new CustomEvent(eventType, { detail: { data: payload } }));
    }

    function sub(eventType, handler, listenerOptions = {}) {
        const [prefix, prop] = eventType.split(':');
        const fromStore = prefix === namespace;

        function listener(event) {
            const detailData = /** @type {CustomEvent} */ (event).detail?.data;
            handler(fromStore ? detailData?.[prop] : detailData);
        }

        bus.addEventListener(eventType, listener, { capture: false, ...listenerOptions });
        return listener;
    }

    function reg(eventType, handler, listenerOptions = {}) {
        function listener(event) {
            const detailData = /** @type {CustomEvent} */ (event).detail?.data;
            return handler(detailData, store);
        }

        bus.addEventListener(eventType, listener, { capture: false, ...listenerOptions });
        return listener;
    }

    function unsub(eventType, listener, listenerOptions = {}) {
        bus.removeEventListener(eventType, listener, { capture: false, ...listenerOptions });
    }

    return Object.freeze({
        create,
        reg,
        sub,
        dispatch,
        unsub,
    });
}

const xf = createEventBus();

function hex(n) {
    return '0x' + Math.trunc(Number(n)).toString(16).toUpperCase().padStart(2, '0');
}

function toNumber(value) {
    return +value;
}

function toBool(value) {
    return Boolean(value);
}

function toFixed(value, decimals = 2, fallback = 0) {
    if (!isNumber(value)) return fallback;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function dataviewToArray(view) {
    return Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function dataviewToString(view) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    return new TextDecoder('utf-8').decode(bytes);
}

function arrayBufferToArray(buffer) {
    return Array.from(new Uint8Array(buffer));
}

function stringToCharCodes(str) {
    return Array.from(str, ch => ch.charCodeAt(0));
}

function stringToDataview(str) {
    const bytes = Uint8Array.from(str, ch => ch.charCodeAt(0));
    return new DataView(bytes.buffer);
}

function time() {
    const now = new Date();
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(4, '0');
    return `${mm}:${ss}:${ms}`;
}

function formatDate(options = {}) {
    const date = options.date ?? new Date();
    const sep = options.separator ?? '/';
    const includeYear = options.year ?? true;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());

    return includeYear ? `${day}${sep}${month}${sep}${year}` : `${day}${sep}${month}`;
}

function nthBit(field, bit) {
    return (field >> bit) & 1;
}

function setBit(bit, field) {
    return field | (1 << bit);
}

function getBits(start, end, value) {
    return (value >> start) & ((1 << (end - start)) - 1);
}

function nthBitToBool(field, bit) {
    return Boolean(nthBit(field, bit));
}

function xor(view, start = 0, end = view.byteLength) {
    let checksum = 0;
    const stop = end < 0 ? view.byteLength + end : end;
    for (let i = start; i < stop; i++) {
        checksum ^= view.getUint8(i);
    }
    return checksum;
}

function setUint24LE(view, byteOffset, value) {
    view.setUint8(byteOffset, value & 0xff);
    view.setUint8(byteOffset + 1, (value >> 8) & 0xff);
    view.setUint8(byteOffset + 2, (value >> 16) & 0xff);
    return view;
}

function getUint24LE(view, byteOffset = 0) {
    const b0 = view.getUint8(byteOffset);
    const b1 = view.getUint8(byteOffset + 1);
    const b2 = view.getUint8(byteOffset + 2);
    return (b2 << 16) + (b1 << 8) + b0;
}

function Spec(options = {}) {
    const definitions = expect(options.definitions);

    const applyResolution = curry2((prop, value) => value / definitions[prop].resolution);
    const removeResolution = curry2((prop, value) => value * definitions[prop].resolution);

    function encodeField(prop, input, transform = applyResolution(prop)) {
        const def = definitions[prop];
        const value = input ?? def.default;
        const encoded = transform(value);
        if (isNumber(def.min) && isNumber(def.max)) {
            const minScaled = applyResolution(prop, def.min);
            const maxScaled = applyResolution(prop, def.max);
            return Math.floor(clamp(minScaled, maxScaled, encoded));
        }
        return Math.floor(encoded);
    }

    function decodeField(prop, input, transform = removeResolution) {
        return transform(prop, input);
    }

    return {
        definitions,
        applyResolution,
        removeResolution,
        encodeField,
        decodeField,
    };
}

function createLogger() {
    const env = typeof process !== 'undefined' ? process?.env?.NODE_ENV : 'development';
    const verbose = env !== 'production' && env !== 'test';

    function log(msg) {
        if (verbose) {
            console.log(`[${time()}] ${msg}`);
        }
    }

    function warn(msg) {
        console.warn(`[${time()}] ${msg}`);
    }

    function noop() {}

    return {
        log,
        warn,
        makeCoffee: noop,
        callKarenFromHR: noop,
    };
}

const print = createLogger();
const log = print.log;

export {
    equals,
    isNull,
    isUndefined,
    isFunction,
    exists,
    existance,
    expect,
    isArray,
    isArrayBuffer,
    isDataView,
    isObject,
    isString,
    isCollection,
    isNumber,
    isAtomic,
    validate,
    first,
    second,
    third,
    last,
    empty,
    map,
    traverse,
    getIn,
    set,
    setIn,
    avg,
    mavg,
    max,
    sum,
    rand,
    capitalize,
    escapeHtml,
    clamp,
    comp,
    compose,
    compose2,
    pipe,
    repeat,
    nth,
    curry2,
    once,
    debounce,
    delay,
    wait,
    xf,
    createEventBus,
    hex,
    toNumber,
    toFixed,
    toBool,
    dataviewToArray,
    dataviewToString,
    arrayBufferToArray,
    stringToCharCodes,
    stringToDataview,
    time,
    formatDate,
    print,
    log,
    Spec,
    nthBit,
    setBit,
    getBits,
    nthBitToBool,
    xor,
    setUint24LE,
    getUint24LE,
};
