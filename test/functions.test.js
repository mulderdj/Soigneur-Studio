/**
 * @jest-environment jsdom
 */

import {
    equals,
    exists,
    existance,
    expect as requireValue,
    validate,
    isNumber,
    isString,
    isArray,
    isObject,
    isFunction,
    first,
    second,
    third,
    last,
    empty,
    map,
    traverse,
    getIn,
    setIn,
    avg,
    mavg,
    max,
    sum,
    capitalize,
    escapeHtml,
    clamp,
    compose,
    pipe,
    repeat,
    nth,
    curry2,
    once,
    debounce,
    xf,
    toBool,
    toFixed,
    formatDate,
    dataviewToArray,
    dataviewToString,
    stringToCharCodes,
    nthBit,
    nthBitToBool,
    getBits,
    setUint24LE,
    getUint24LE,
    xor,
} from '../src/functions.js';

describe('value predicates and guards', () => {
    test('exists distinguishes null/undefined from defined values', () => {
        expect(exists(null)).toBe(false);
        expect(exists(undefined)).toBe(false);
        expect(exists({})).toBe(true);
        expect(exists([])).toBe(true);
        expect(exists('')).toBe(true);
        expect(exists(new Uint8Array([]))).toBe(true);
        expect(exists(0)).toBe(true);
        expect(exists(false)).toBe(true);
        expect(exists(true)).toBe(true);
    });

    test('existance returns value when defined and fallback otherwise', () => {
        expect(existance(null, 42)).toBe(42);
        expect(existance(undefined, 'fallback')).toBe('fallback');
        expect(existance(0, 1)).toBe(0);
        expect(existance('', 'x')).toBe('');
        expect(existance(false, true)).toBe(false);
        expect(existance({}, 1)).toStrictEqual({});
        expect(() => existance(null)).toThrow();
    });

    test('expect and validate enforce invariants', () => {
        expect(requireValue('ok')).toBe('ok');
        expect(() => requireValue(undefined, 'missing')).toThrow('missing');
        expect(validate([isNumber, x => x > 0], 15, 0)).toBe(15);
        expect(validate([isNumber, x => x > 0], -5, 0)).toBe(0);
        expect(() => validate([isNumber], 'bad')).toThrow();
    });

    test('type predicates handle NaN, null, arrays, and objects accurately', () => {
        expect(equals(NaN, NaN)).toBe(true);
        expect(isNumber(10)).toBe(true);
        expect(isNumber(NaN)).toBe(false);
        expect(isString('watt')).toBe(true);
        expect(isArray([1, 2])).toBe(true);
        expect(isObject({ a: 1 })).toBe(true);
        expect(isObject(null)).toBe(false);
        expect(isObject([1])).toBe(false);
        expect(isFunction(() => {})).toBe(true);
    });
});

describe('collection utilities', () => {
    test('empty handles arrays, objects, strings, undefined, and rejects non-collections', () => {
        expect(empty([])).toBe(true);
        expect(empty({})).toBe(true);
        expect(empty('')).toBe(true);
        expect(empty(undefined)).toBe(true);
        expect(empty([0])).toBe(false);
        expect(empty({ a: 0 })).toBe(false);
        expect(empty('zero')).toBe(false);
        expect(() => empty(null)).toThrow();
        expect(() => empty(0)).toThrow();
    });

    test('first, second, third, last, and nth index collections and strings', () => {
        expect(first([10, 20, 30])).toBe(10);
        expect(second([10, 20, 30])).toBe(20);
        expect(third([10, 20, 30])).toBe(30);
        expect(last([10, 20, 30])).toBe(30);
        expect(first('ride')).toBe('r');
        expect(second('ride')).toBe('i');
        expect(last('ride')).toBe('e');
        expect(nth(-1)([5, 6, 7])).toBe(7);

        expect(first([])).toBeUndefined();
        expect(second([])).toBeUndefined();
        expect(last('')).toBeUndefined();
        expect(first(undefined)).toBeUndefined();
        expect(second(undefined)).toBeUndefined();
        expect(last(undefined)).toBeUndefined();

        expect(() => first(0)).toThrow();
        expect(() => first(null)).toThrow();
        expect(() => second(0)).toThrow();
        expect(() => last(null)).toThrow();
    });

    test('map and traverse process arrays, objects, and strings', () => {
        const inc = n => n + 1;
        expect(map([0, 1, 2], inc)).toStrictEqual([1, 2, 3]);
        expect(map({ x: 0, y: 2 }, inc)).toStrictEqual({ x: 1, y: 3 });
        expect(map('ab cd', ch => ch.toUpperCase())).toBe('AB CD');

        const tree = {
            data: { file_id: true, event: { start: true, stop: false } },
            crc: false,
        };
        const leaves = traverse(tree, (acc, _k, v) => {
            acc.push(v);
            return acc;
        }, []);
        expect(leaves).toEqual([true, true, false, false]);
    });

    test('getIn and setIn access and update nested paths', () => {
        const state = { rider: { profile: { ftp: 280 } } };
        expect(getIn(state, 'rider', 'profile', 'ftp')).toBe(280);
        expect(getIn(state, 'rider', 'missing')).toBeUndefined();

        const updated = setIn({}, ['a', 'b', 'c'], 99);
        expect(updated).toEqual({ a: { b: { c: 99 } } });
    });

    test('numeric reductions and clamping', () => {
        expect(avg([0, 1, 2])).toBe(1);
        expect(avg([{ x: 10 }, { x: 20 }, { x: 30 }], 'x')).toBe(20);
        expect(mavg(300, 200, 2)).toBe(250);
        expect(sum([1, 2, 3, 4])).toBe(10);
        expect(sum([{ w: 100 }, { w: 150 }], 'w')).toBe(250);
        expect(max([0, 3, 1])).toBe(3);
        expect(max([{ x: 0 }, { x: 5 }, { x: 2 }], 'x')).toBe(5);
        expect(clamp(50, 300, 20)).toBe(50);
        expect(clamp(50, 300, 400)).toBe(300);
        expect(clamp(50, 300, 180)).toBe(180);
        expect(toFixed(3.14159, 2)).toBe(3.14);
        expect(toFixed(NaN, 2, -1)).toBe(-1);
    });
});

describe('function combinators', () => {
    const inc = n => n + 1;
    const dec = n => n - 1;
    const sqr = n => n * n;

    test('compose, pipe, repeat, curry2, once, and debounce', () => {
        expect(compose(dec, inc)(5)).toBe(5);
        expect(compose(inc, sqr)(3)).toBe(10);
        expect(pipe(sqr, inc)(3)).toBe(10);
        expect(pipe(inc, sqr)(3)).toBe(16);
        expect(repeat(0)(inc)(0)).toBe(0);
        expect(repeat(4)(inc)(0)).toBe(4);

        const add = curry2((a, b) => a + b);
        expect(add(3, 4)).toBe(7);
        expect(add(3)(4)).toBe(7);

        let calls = 0;
        const initOnce = once(() => ++calls);
        expect(initOnce()).toBe(1);
        expect(initOnce()).toBe(1);

        jest.useFakeTimers();
        const spy = jest.fn();
        const debounced = debounce(spy, 100);
        debounced('a');
        debounced('b');
        expect(debounced.pending()).toBe(true);
        jest.advanceTimersByTime(100);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('b');
        jest.useRealTimers();
    });
});

describe('xf reactive event bus', () => {
    test('propagates store mutations, custom events, unsub, and AbortSignal cleanup', () => {
        const controller = new AbortController();
        const opts = { signal: controller.signal };
        const store = { count: 0 };
        xf.create(store);

        xf.reg('test:count-set', (val, db) => { db.count = val; }, opts);
        xf.reg('test:count-inc', (_, db) => { db.count += 1; }, opts);
        const decHandler = xf.reg('test:count-dec', (_, db) => { db.count -= 1; }, opts);

        let observed = 0;
        const subHandler = xf.sub('db:count', val => { observed = val; }, opts);

        xf.dispatch('test:count-inc');
        expect(observed).toBe(1);
        expect(store.count).toBe(1);

        xf.dispatch('test:count-set', 5);
        expect(observed).toBe(5);

        xf.unsub('db:count', subHandler);
        xf.unsub('test:count-dec', decHandler);

        xf.dispatch('test:count-set', 2);
        expect(observed).toBe(5);
        expect(store.count).toBe(2);

        xf.dispatch('test:count-dec');
        expect(store.count).toBe(2);

        controller.abort();
        xf.dispatch('test:count-set', 99);
        expect(store.count).toBe(2);
    });
});

describe('string, binary, and bit helpers', () => {
    test('escapes HTML entities safely', () => {
        expect(escapeHtml('Col du Galibier')).toBe('Col du Galibier');
        expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
        expect(escapeHtml("Rider's & Coach's")).toBe('Rider&#39;s &amp; Coach&#39;s');
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(90)).toBe('90');
        expect(capitalize('  tempo ')).toBe('Tempo');
    });

    test('formats dates and converts buffers and bitfields', () => {
        expect(formatDate({ date: new Date(2026, 6, 4), separator: '-' })).toBe('04-07-2026');
        expect(formatDate({ date: new Date(2026, 6, 4), year: false })).toBe('04/07');
        expect(toBool(1)).toBe(true);
        expect(toBool(0)).toBe(false);

        expect(nthBit(0b10010101, 0)).toBe(1);
        expect(nthBit(0b10010101, 6)).toBe(0);
        expect(nthBitToBool(0b10010101, 7)).toBe(true);
        expect(getBits(2, 5, 0b1101100)).toBe(0b011);

        const raw = new Uint8Array([70, 117, 110, 99, 116, 105, 111, 110, 115]);
        const view = new DataView(raw.buffer);
        expect(dataviewToArray(view)).toEqual([70, 117, 110, 99, 116, 105, 111, 110, 115]);
        expect(dataviewToString(view)).toBe('Functions');
        expect(stringToCharCodes('Functions')).toEqual([70, 117, 110, 99, 116, 105, 111, 110, 115]);
        expect(xor(view)).toBe(81);

        const u24 = new DataView(new ArrayBuffer(3));
        setUint24LE(u24, 0, 0x123456);
        expect(getUint24LE(u24, 0)).toBe(0x123456);
    });
});
