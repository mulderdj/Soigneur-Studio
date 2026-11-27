// @ts-check
//
// Soigneur FIT Course Decoder powered by Garmin's official @garmin/fitsdk.
//
// Decodes a binary .fit course into { meta, points, pointsSimplified } for
// indoor elevation simulation (src/course.js) and route previews.
//

import { decodeFit } from './decoder.js';
import { g } from '../views/graph.js';

/** @typedef {{ x: number, y: number, r: number, slope: number, distance: number, position_lat?: number, position_long?: number }} CoursePoint */

/**
 * Simplify raw course points with Ramer-Douglas-Peucker and compute segment run/slope.
 * @param {CoursePoint[]} points
 * @param {number} distance
 * @param {string} name
 * @param {string} description
 */
function toCourse(points, distance, name, description) {
    const simplified = /** @type {CoursePoint[]} */ (g.simplify(points, 0.5, true)).map((p, i, xs) => {
        const x1 = p.x;
        const y1 = p.y;
        const next = xs[i + 1] ?? p;
        const run = next.x - x1;
        const rise = next.y - y1;
        const r = Math.sqrt(run ** 2 + rise ** 2);
        const slope = run === 0 ? 0 : 100 * (rise / run);
        return {...p, r, slope};
    });

    return {
        meta: {
            name: name || 'Course',
            author: 'n/a',
            category: 'Course',
            description,
            distance,
        },
        points,
        pointsSimplified: simplified,
    };
}

/**
 * Resolve human-readable course name from the FIT `course` message or fallback filename.
 * @param {Array<{ name: string, fields: Record<string, any> }>} messages
 * @param {string} [fileName]
 * @returns {string}
 */
function resolveCourseName(messages, fileName = '') {
    const courseMsg = messages.find(m => m.name === 'course' && typeof m.fields?.name === 'string' && m.fields.name.trim() !== '');
    const raw = courseMsg?.fields?.name ?? fileName ?? 'Course';
    return String(raw).replace(/\.fit$/gi, '').replace(/[_-]/g, ' ').trim() || 'Course';
}

/**
 * Extract altitude (m) from a FIT record's fields, preferring standard altitude then enhanced_altitude.
 * @param {Record<string, any> | undefined} fields
 * @returns {number | undefined}
 */
function recordAltitude(fields) {
    if(!fields) return undefined;
    if(Number.isFinite(fields.altitude)) return fields.altitude;
    if(Number.isFinite(fields.enhanced_altitude)) return fields.enhanced_altitude;
    return undefined;
}

/**
 * Decode a binary .fit course payload into { meta, points, pointsSimplified }.
 * @param {ArrayBuffer | ArrayBufferView} view
 * @param {string} [fileName]
 */
function decode(view, fileName = '') {
    const messages = decodeFit(view);
    const name = resolveCourseName(messages, fileName);
    const description = '';

    const dataRecords = messages.filter(m => m.name === 'record' && Number.isFinite(m.fields?.distance));
    if(dataRecords.length === 0) {
        return toCourse([], 0, name, description);
    }

    let prevAltitude = 0;
    for(const rec of dataRecords) {
        const alt = recordAltitude(rec.fields);
        if(alt !== undefined) {
            prevAltitude = alt;
            break;
        }
    }

    const altitudes = dataRecords.map(rec => {
        const alt = recordAltitude(rec.fields);
        if(alt !== undefined) prevAltitude = alt;
        return prevAltitude;
    });

    let distanceTotal = 0;
    let x = 0;
    /** @type {CoursePoint[]} */
    const points = [];

    for(let i = 0; i < dataRecords.length; i++) {
        const fields = dataRecords[i].fields;
        const altitude = altitudes[i];
        const altitudeNext = altitudes[i + 1] ?? altitude;
        const distance = fields.distance;
        const distanceNext = dataRecords[i + 1]?.fields?.distance ?? distance;

        const rise = altitudeNext - altitude;
        const r = distanceNext - distance;
        const run = r === 0 ? 0 : Math.sqrt(Math.abs(r ** 2 - rise ** 2));
        const slope = run === 0 ? 0 : 100 * (rise / run);

        points.push({
            x,
            y: altitude,
            r,
            slope,
            distance,
            position_lat: fields.position_lat,
            position_long: fields.position_long,
        });

        x += run;
        distanceTotal = distance;
    }

    return toCourse(points, distanceTotal, name, description);
}

const localCourse = Object.freeze({
    decode,
});

export {
    localCourse,
};
