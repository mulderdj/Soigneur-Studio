/**
 * @jest-environment jsdom
 */

import { zwo } from '../../src/workouts/zwo.js';

describe('ZWO parser and serializer', () => {
    const sampleWithoutCues = `
        <workout_file>
            <author>Soigneur Studio</author>
            <name>Mixed Terrain Set</name>
            <category>Sweet Spot</category>
            <subcategory></subcategory>
            <description>Structured sweet spot with slope segments</description>
            <sporttype>bike</sporttype>
            <tags></tags>
            <workout>
                <SteadyState Duration="10" Power="0.50"/>
                <SteadyState Duration="15" Power="0.90"/>
                <SteadyState Duration="10" Power="0.70" Slope="2.1" Cadence="90"/>
                <SteadyState Duration="15" Power="0.92" Cadence="80"/>
                <IntervalsT Repeat="2" OnDuration="40" OffDuration="20" OnPower="1.21" OffPower="0.7" OnSlope="4.8" OffSlope="0" />
                <SteadyState Duration="10" Cadence="90"/>
            </workout>
        </workout_file>`;

    const sampleWithCues = `
        <workout_file>
            <author>Soigneur Studio</author>
            <name>Cued Session</name>
            <category>Sweet Spot</category>
            <subcategory></subcategory>
            <description>Workout with timed coaching cues</description>
            <sporttype>bike</sporttype>
            <tags></tags>
            <workout>
                <SteadyState Duration="10" Power="0.50">
                    <textevent timeoffset="0" message="Warm up spin" duration="10" />
                </SteadyState>
                <SteadyState Duration="20" Power="0.90">
                    <textevent timeoffset="0" message="Settle in" duration="10" />
                    <textevent timeoffset="10" message="Hold steady" duration="10" />
                </SteadyState>
                <FreeRide Duration="10">
                    <textevent timeoffset="0" message="Open road effort" duration="10" />
                </FreeRide>
                <IntervalsT Repeat="2" OnDuration="10" OffDuration="5" OnPower="1.21" OffPower="0.7">
                    <textevent timeoffset="0" message="Rep 1 on" duration="10" />
                    <textevent timeoffset="10" message="Rep 1 float" duration="5" />
                    <textevent timeoffset="15" message="Rep 2 on" duration="10" />
                    <textevent timeoffset="25" message="Rep 2 float" duration="5" />
                </IntervalsT>
            </workout>
        </workout_file>`;

    test('read parses document header and element AST', () => {
        expect(zwo.read(sampleWithoutCues)).toStrictEqual({
            head: {
                author: 'Soigneur Studio',
                name: 'Mixed Terrain Set',
                category: 'Sweet Spot',
                subcategory: '',
                sportType: 'bike',
                description: 'Structured sweet spot with slope segments',
                tags: '',
            },
            body: [
                { element: 'SteadyState', Duration: 10, Power: 0.50 },
                { element: 'SteadyState', Duration: 15, Power: 0.90 },
                { element: 'SteadyState', Duration: 10, Power: 0.70, Slope: 2.1, Cadence: 90 },
                { element: 'SteadyState', Duration: 15, Power: 0.92, Cadence: 80 },
                { element: 'IntervalsT', Repeat: 2, OnDuration: 40, OffDuration: 20, OnPower: 1.21, OffPower: 0.7, OnSlope: 4.8, OffSlope: 0 },
                { element: 'SteadyState', Duration: 10, Cadence: 90 },
            ],
        });
    });

    test('readToInterval expands steady states, intervals, slopes, and zero-power cadence steps', () => {
        expect(zwo.readToInterval(sampleWithoutCues)).toStrictEqual({
            meta: {
                author: 'Soigneur Studio',
                name: 'Mixed Terrain Set',
                category: 'Sweet Spot',
                subcategory: '',
                sportType: 'bike',
                description: 'Structured sweet spot with slope segments',
                tags: '',
                duration: 180,
            },
            intervals: [
                { duration: 10, steps: [{ duration: 10, power: 0.50 }] },
                { duration: 15, steps: [{ duration: 15, power: 0.90 }] },
                { duration: 10, steps: [{ duration: 10, power: 0.70, slope: 2.1, cadence: 90 }] },
                { duration: 15, steps: [{ duration: 15, power: 0.92, cadence: 80 }] },
                { duration: 40, steps: [{ duration: 40, power: 1.21, slope: 4.8 }] },
                { duration: 20, steps: [{ duration: 20, power: 0.7, slope: 0 }] },
                { duration: 40, steps: [{ duration: 40, power: 1.21, slope: 4.8 }] },
                { duration: 20, steps: [{ duration: 20, power: 0.7, slope: 0 }] },
                { duration: 10, steps: [{ duration: 10, power: 0, slope: 0, cadence: 90 }] },
            ],
        });
    });

    test('readToInterval slices nested textevents across steady, freeride, and repeated steps', () => {
        const parsed = zwo.readToInterval(sampleWithCues);
        expect(parsed.meta.duration).toBe(70);
        expect(parsed.intervals).toStrictEqual([
            {
                duration: 10,
                steps: [{ duration: 10, power: 0.50, messages: [{ duration: 10, offset: 0, message: 'Warm up spin' }] }],
            },
            {
                duration: 20,
                steps: [{
                    duration: 20,
                    power: 0.90,
                    messages: [
                        { duration: 10, offset: 0, message: 'Settle in' },
                        { duration: 10, offset: 10, message: 'Hold steady' },
                    ],
                }],
            },
            {
                duration: 10,
                steps: [{ duration: 10, power: 0, slope: 0, messages: [{ duration: 10, offset: 0, message: 'Open road effort' }] }],
            },
            {
                duration: 10,
                steps: [{ duration: 10, power: 1.21, messages: [{ duration: 10, offset: 0, message: 'Rep 1 on' }] }],
            },
            {
                duration: 5,
                steps: [{ duration: 5, power: 0.7, messages: [{ duration: 5, offset: 0, message: 'Rep 1 float' }] }],
            },
            {
                duration: 10,
                steps: [{ duration: 10, power: 1.21, messages: [{ duration: 10, offset: 0, message: 'Rep 2 on' }] }],
            },
            {
                duration: 5,
                steps: [{ duration: 5, power: 0.7, messages: [{ duration: 5, offset: 0, message: 'Rep 2 float' }] }],
            },
        ]);
    });

    test('fromInterval and write round-trip ramps, cooldowns, steady states, and XML special characters', () => {
        const source = {
            meta: {
                author: 'Soigneur Studio',
                name: 'Chrono & Climb',
                category: 'Threshold',
                subcategory: 'TT',
                sportType: 'bike',
                description: '2x10 > 95% FTP',
                tags: '',
            },
            intervals: [
                { duration: 30, steps: [{ duration: 10, power: 0.5 }, { duration: 10, power: 0.6 }, { duration: 10, power: 0.7 }] },
                { duration: 60, steps: [{ duration: 60, power: 0.95, cadence: 92 }] },
                { duration: 30, steps: [{ duration: 10, power: 0.6 }, { duration: 10, power: 0.5 }, { duration: 10, power: 0.4 }] },
            ],
        };

        const xml = zwo.write(zwo.fromInterval(source));
        const roundTripped = zwo.readToInterval(xml);
        expect(roundTripped.meta.name).toBe('Chrono & Climb');
        expect(roundTripped.meta.description).toBe('2x10 > 95% FTP');
        expect(roundTripped.meta.duration).toBe(120);
        expect(roundTripped.intervals[1].steps[0]).toEqual({ duration: 60, power: 0.95, cadence: 92 });
    });
});
