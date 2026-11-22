/** @jest-environment jsdom */
import { toZwo, extensionOf, isSupported } from '../src/workouts/formats.js';
import { zwo } from '../src/workouts/zwo.js';

const read = (text, name) => zwo.readToInterval(toZwo(text, name));
const powers = w => w.intervals.flatMap(i => i.steps.map(s => s.power));

describe('workout formats', () => {
    test('extensions are case-insensitive', () => {
        expect(extensionOf('My Workout.ERG')).toBe('erg');
        expect(isSupported('a.MRC')).toBe(true);
        expect(isSupported('a.gpx')).toBe(false);
    });

    test('zwo passes through unchanged', () => {
        const x = '<workout_file><name>A</name><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>';
        expect(toZwo(x, 'a.zwo')).toBe(x);
        expect(toZwo(x, 'a.xml')).toBe(x);
    });

    test('mrc: steps, ramps, text cues', () => {
        const mrc = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Test set
FILE NAME = Over Unders
MINUTES PERCENT
[END COURSE HEADER]
[COURSE DATA]
0.00\t50
5.00\t75
5.00\t100
9.00\t100
9.00\t55
12.00\t55
[END COURSE DATA]
[COURSE TEXT]
330\tHold it!\t10
[END COURSE TEXT]`;
        const w = read(mrc, 'over-unders.mrc');
        expect(w.meta.name).toBe('Over Unders');
        expect(w.meta.duration).toBe(720);
        expect(w.intervals.length).toBe(3);
        expect(w.intervals[0].steps.length).toBeGreaterThan(1);          // ramp 50 -> 75
        expect(w.intervals[1].steps[0].power).toBeCloseTo(1.0);
        expect(w.intervals[2].steps[0].power).toBeCloseTo(0.55);
        const msgs = w.intervals[1].steps.flatMap(s => s.messages ?? []);
        expect(msgs[0].message).toBe('Hold it!');
    });

    test('erg with FTP converts to fraction of FTP', () => {
        const erg = `[COURSE HEADER]
FTP = 250
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
0\t125
10\t125
10\t300
14\t300
[END COURSE DATA]`;
        const w = read(erg, 'vo2.erg');
        expect(w.meta.name).toBe('vo2');
        expect(powers(w)).toEqual([0.5, 1.2]);
    });

    test('erg without FTP keeps absolute watts', () => {
        const erg = `[COURSE HEADER]\nMINUTES WATTS\n[END COURSE HEADER]\n[COURSE DATA]\n0 200\n10 200\n[END COURSE DATA]`;
        expect(powers(read(erg, 'abs.erg'))).toEqual([200]);
    });

    test('intervals.icu text with repeats, ramps, watts, zones, cadence and cues', () => {
        const txt = `Warmup
- 10m ramp 50-75% 85rpm

Main set 3x
- 4m 105% stay seated
- 3m Z1

- 1m30s 300w
Cooldown
- 5m 50%`;
        const w = read(txt, 'threshold.txt');
        expect(w.meta.name).toBe('threshold');
        expect(w.meta.duration).toBe(600 + 3 * 420 + 90 + 300);
        const flat = w.intervals.map(i => i.steps[0]);
        expect(flat[0].power).toBeCloseTo(0.5);
        expect(flat[0].cadence).toBe(85);
        expect(flat[1].power).toBeCloseTo(1.05);
        expect(flat[1].messages[0].message).toBe('stay seated');
        expect(flat[2].power).toBeCloseTo(0.5);
        expect(flat[7].power).toBe(300);
    });

    test('helpful errors', () => {
        expect(() => toZwo('hello', 'x.txt')).toThrow(/no steps found/);
        expect(() => toZwo('[COURSE HEADER]\n[END COURSE HEADER]', 'x.erg')).toThrow(/COURSE DATA/);
    });
});
