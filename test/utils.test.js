/**
 * @jest-environment jsdom
 */

import {
    formatTime,
    dateToDashString,
    isoDate,
    getStartEndOfWeek,
    isToday,
    kphToMps,
    mpsToKph,
    pad,
    inRange,
    translate,
    avgColor,
    hex,
    toFitTimestamp,
    toJsTimestamp,
    timeDiff,
    toFitSpeed,
    toFitDistance,
    splitAt,
    calculateCRC,
    typeToAccessor,
} from '../src/utils.js';

describe('time and date formatting', () => {
    test('formatTime formats seconds as hh:mm:ss and adaptive mm:ss', () => {
        expect(formatTime({ value: 0 })).toBe('00:00:00');
        expect(formatTime({ value: 3661, format: 'hh:mm:ss' })).toBe('01:01:01');
        expect(formatTime({ value: 125, format: 'mm:ss' })).toBe('02:05');
        expect(formatTime({ value: 3725, format: 'mm:ss' })).toBe('01:02:05');
    });

    test('isoDate formats local calendar date or UTC calendar date deterministically', () => {
        const localSample = new Date(2025, 1, 24, 23, 30, 0);
        expect(isoDate(localSample, true)).toBe('2025-02-24');

        const utcBeforeMidnight = new Date(Date.UTC(2025, 1, 24, 23, 45, 0));
        const utcAfterMidnight = new Date(Date.UTC(2025, 1, 25, 0, 15, 0));
        expect(isoDate(utcBeforeMidnight, false)).toBe('2025-02-24');
        expect(isoDate(utcAfterMidnight, false)).toBe('2025-02-25');
    });

    test('getStartEndOfWeek computes Monday through Sunday boundaries', () => {
        const wednesday = new Date(2026, 10, 25, 12, 0, 0);
        expect(getStartEndOfWeek(wednesday, true)).toEqual({
            startOfWeek: '2026-11-23',
            endOfWeek: '2026-11-29',
        });

        const sunday = new Date(2026, 10, 29, 12, 0, 0);
        expect(getStartEndOfWeek(sunday, true)).toEqual({
            startOfWeek: '2026-11-23',
            endOfWeek: '2026-11-29',
        });
    });

    test('dateToDashString and isToday', () => {
        const sample = new Date(2026, 2, 7, 14, 5, 0);
        expect(dateToDashString(sample)).toBe('07-03-2026-at-14-05h');
        expect(isToday(new Date())).toBe(true);
        expect(isToday('2000-01-01T12:00:00')).toBe(false);
    });
});

describe('unit, color, and FIT protocol helpers', () => {
    test('speed, range, linear translation, and color blending', () => {
        expect(kphToMps(36)).toBe(10);
        expect(mpsToKph(10)).toBe(36);
        expect(inRange(10, 20, 15)).toBe(true);
        expect(inRange(10, 20, 25)).toBe(false);
        expect(translate(50, 0, 100, 0, 500)).toBe(250);
        expect(avgColor('#000000', '#FFFFFF')).toBe('#7F7F7F');
        expect(hex(10)).toBe('0x0A');
    });

    test('FIT timestamps, scaling, padding, splitting, CRC16, and DataView accessors', () => {
        const epochPlus100s = Date.UTC(1989, 11, 31, 0, 1, 40);
        expect(toFitTimestamp(epochPlus100s)).toBe(100);
        expect(toJsTimestamp(100)).toBe(epochPlus100s);
        expect(timeDiff(10_000, 25_000)).toBe(15);
        expect(toFitSpeed(36, 'kph')).toBe(10000);
        expect(toFitDistance(1.5, 'km')).toBe(150000);

        expect(pad([0.882, 0.906], 5, 0xffff)).toEqual([0.882, 0.906, 0xffff, 0xffff, 0xffff]);
        expect(splitAt([1, 2, 0, 3, 0, 4], 0)).toEqual([[1, 2], [0, 3], [0, 4]]);

        const fitMagic = new Uint8Array([14, 16, 208, 7, 0, 0, 0, 0, 46, 70, 73, 84]);
        expect(calculateCRC(fitMagic, 0, fitMagic.length)).toBeGreaterThan(0);

        expect(typeToAccessor('uint16', 'get')).toBe('getUint16');
        expect(typeToAccessor(131, 'set')).toBe('setInt16');
        expect(typeToAccessor('float32', 'get')).toBe('getFloat32');
    });
});
