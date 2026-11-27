import { Encoder, Profile, Utils, fit } from '../../src/fit/fit.js';

const SEMICIRCLES_PER_DEG = 2147483648 / 180;
const T0 = Math.round((Date.UTC(2026, 10, 27, 8, 0, 0) - Utils.FIT_EPOCH_MS) / 1000);

function buildCourseFit({courseName, useEnhancedAltitude = false, points}) {
    const encoder = new Encoder();
    encoder.onMesg(Profile.MesgNum.FILE_ID, {
        type: 'course',
        manufacturer: 'garmin',
        timeCreated: T0,
    });
    if(courseName !== undefined) {
        encoder.onMesg(Profile.MesgNum.COURSE, {
            name: courseName,
            sport: 'cycling',
        });
    }
    points.forEach((pt, idx) => {
        const rec = {
            timestamp: T0 + idx,
            distance: pt.distance,
            positionLat: Math.round(pt.lat * SEMICIRCLES_PER_DEG),
            positionLong: Math.round(pt.lon * SEMICIRCLES_PER_DEG),
        };
        if(pt.altitude !== undefined) {
            if(useEnhancedAltitude) rec.enhancedAltitude = pt.altitude;
            else rec.altitude = pt.altitude;
        }
        encoder.onMesg(Profile.MesgNum.RECORD, rec);
    });
    const bytes = encoder.close();
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe('localCourse.decode (@garmin/fitsdk)', () => {
    test('decodes a .fit course into meta, points, and simplified slope segments', () => {
        const view = buildCourseFit({
            courseName: 'Alpe_d_Huez.fit',
            points: [
                {distance: 0,    altitude: 720, lat: 45.0680, lon: 6.0360},
                {distance: 100,  altitude: 730, lat: 45.0688, lon: 6.0370},
                {distance: 200,  altitude: 740, lat: 45.0696, lon: 6.0380},
                {distance: 400,  altitude: 740, lat: 45.0712, lon: 6.0400},
                {distance: 500,  altitude: 735, lat: 45.0720, lon: 6.0410},
            ],
        });

        const course = fit.localCourse.decode(view, 'fallback.fit');
        expect(course.meta).toEqual({
            name: 'Alpe d Huez',
            author: 'n/a',
            category: 'Course',
            description: '',
            distance: 500,
        });
        expect(course.points).toHaveLength(5);
        expect(course.points[0].y).toBeCloseTo(720, 1);
        expect(course.points[0].slope).toBeCloseTo(10, 0);
        expect(course.points[0].position_lat).toBe(Math.round(45.0680 * SEMICIRCLES_PER_DEG));
        expect(course.points[0].position_long).toBe(Math.round(6.0360 * SEMICIRCLES_PER_DEG));

        expect(course.pointsSimplified.length).toBeGreaterThanOrEqual(2);
        expect(course.pointsSimplified[0].slope).toBeGreaterThan(9.5);
        expect(course.pointsSimplified.at(-1).r).toBe(0);
    });

    test('supports enhanced_altitude-only courses, carries forward missing altitudes, and falls back to fileName', () => {
        const view = buildCourseFit({
            useEnhancedAltitude: true,
            points: [
                {distance: 0,   altitude: 150.4, lat: 50.85, lon: 5.85},
                {distance: 250, altitude: undefined, lat: 50.86, lon: 5.86},
                {distance: 500, altitude: 175.4, lat: 50.87, lon: 5.87},
            ],
        });

        const course = fit.localCourse.decode(view, 'Cauberg-Loop.fit');
        expect(course.meta.name).toBe('Cauberg Loop');
        expect(course.meta.distance).toBe(500);
        expect(course.points).toHaveLength(3);
        expect(course.points[0].y).toBeCloseTo(150.4, 1);
        expect(course.points[1].y).toBeCloseTo(150.4, 1);
        expect(course.points[2].y).toBeCloseTo(175.4, 1);
    });
});
