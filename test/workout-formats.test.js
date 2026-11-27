/** @jest-environment jsdom */
import { toZwo, extensionOf, isSupported, isBinary } from '../src/workouts/formats.js';
import { zwo } from '../src/workouts/zwo.js';

const parseWorkout = (text, name) => zwo.readToInterval(toZwo(text, name));
const stepPowers = workout => workout.intervals.flatMap(iv => iv.steps.map(step => step.power));

describe('workout format converters', () => {
    test('identifies supported text and binary extensions case-insensitively', () => {
        expect(extensionOf('Threshold_Session.ERG')).toBe('erg');
        expect(isSupported('block.MRC')).toBe(true);
        expect(isSupported('course.FIT')).toBe(true);
        expect(isBinary('course.FIT')).toBe(true);
        expect(isBinary('workout.zwo')).toBe(false);
        expect(isSupported('track.gpx')).toBe(false);
    });

    test('passes native ZWO XML through untouched', () => {
        const xml = '<workout_file><name>Spin</name><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>';
        expect(toZwo(xml, 'spin.zwo')).toBe(xml);
        expect(toZwo(xml, 'spin.xml')).toBe(xml);
    });

    test('converts MRC percent-based files including ramps, steps, and text cues', () => {
        const mrc = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Lactate clearance set
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
330\tHold smooth cadence!\t10
[END COURSE TEXT]`;

        const parsed = parseWorkout(mrc, 'over-unders.mrc');
        expect(parsed.meta.name).toBe('Over Unders');
        expect(parsed.meta.duration).toBe(720);
        expect(parsed.intervals).toHaveLength(3);
        expect(parsed.intervals[0].steps.length).toBeGreaterThan(1);
        expect(parsed.intervals[1].steps[0].power).toBeCloseTo(1.0);
        expect(parsed.intervals[2].steps[0].power).toBeCloseTo(0.55);

        const cues = parsed.intervals[1].steps.flatMap(s => s.messages ?? []);
        expect(cues[0].message).toBe('Hold smooth cadence!');
    });

    test('converts ERG watt files relative to header FTP or keeps absolute watts when FTP is absent', () => {
        const ergWithFtp = `[COURSE HEADER]
FTP = 250
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
0\t125
10\t125
10\t300
14\t300
[END COURSE DATA]`;
        const rel = parseWorkout(ergWithFtp, 'vo2.erg');
        expect(rel.meta.name).toBe('vo2');
        expect(stepPowers(rel)).toEqual([0.5, 1.2]);

        const ergAbs = `[COURSE HEADER]\nMINUTES WATTS\n[END COURSE HEADER]\n[COURSE DATA]\n0 200\n10 200\n[END COURSE DATA]`;
        expect(stepPowers(parseWorkout(ergAbs, 'abs.erg'))).toEqual([200]);
    });

    test('parses intervals.icu workout text with repeats, ramps, watts, zones, cadence, and coaching cues', () => {
        const text = `Warmup
- 10m ramp 50-75% 85rpm

Main set 3x
- 4m 105% stay seated
- 3m Z1

- 1m30s 300w
Cooldown
- 5m 50%`;

        const parsed = parseWorkout(text, 'threshold.txt');
        expect(parsed.meta.name).toBe('threshold');
        expect(parsed.meta.duration).toBe(600 + 3 * 420 + 90 + 300);

        const firstSteps = parsed.intervals.map(iv => iv.steps[0]);
        expect(firstSteps[0].power).toBeCloseTo(0.5);
        expect(firstSteps[0].cadence).toBe(85);
        expect(firstSteps[1].power).toBeCloseTo(1.05);
        expect(firstSteps[1].messages[0].message).toBe('stay seated');
        expect(firstSteps[2].power).toBeCloseTo(0.5);
        expect(firstSteps[7].power).toBe(300);
    });

    test('surfaces descriptive parse errors for invalid ERG/MRC and text files', () => {
        expect(() => toZwo('hello', 'x.txt')).toThrow(/no steps found/);
        expect(() => toZwo('[COURSE HEADER]\n[END COURSE HEADER]', 'x.erg')).toThrow(/COURSE DATA/);
    });
});
