// @ts-check

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/** @type {Array<[number, string]>} */
const SLOPE_PALETTE = [
    [-40, '#328AFF'],
    [-17.5, '#3690EA'],
    [-15, '#3B97D5'],
    [-12.5, '#3F9EC0'],
    [-10, '#44A5AB'],
    [-7.5, '#48AB96'],
    [-5, '#4DB281'],
    [-2.5, '#52B96C'],
    [0, '#57C057'],
    [2.5, '#68AC4E'],
    [5, '#799845'],
    [7.5, '#8A843C'],
    [10, '#9B7134'],
    [12.5, '#B36129'],
    [15, '#CC521F'],
    [17.5, '#E54315'],
    [40, '#FE340B'],
];

function sqDist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function sqSegmentDist(point, start, end) {
    let x = start.x;
    let y = start.y;
    const dx = end.x - x;
    const dy = end.y - y;

    if (dx !== 0 || dy !== 0) {
        const proj = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);
        if (proj > 1) {
            x = end.x;
            y = end.y;
        } else if (proj > 0) {
            x += dx * proj;
            y += dy * proj;
        }
    }

    const px = point.x - x;
    const py = point.y - y;
    return px * px + py * py;
}

function filterByRadialDistance(points, sqTolerance) {
    let anchor = points[0];
    const filtered = [anchor];
    let current = anchor;

    for (let i = 1; i < points.length; i++) {
        current = points[i];
        if (sqDist(current, anchor) > sqTolerance) {
            filtered.push(current);
            anchor = current;
        }
    }

    if (anchor !== current) {
        filtered.push(current);
    }
    return filtered;
}

function rdpSubdivide(points, startIdx, endIdx, sqTolerance, out) {
    let maxDistSq = sqTolerance;
    let splitIdx = -1;

    for (let i = startIdx + 1; i < endIdx; i++) {
        const distSq = sqSegmentDist(points[i], points[startIdx], points[endIdx]);
        if (distSq > maxDistSq) {
            maxDistSq = distSq;
            splitIdx = i;
        }
    }

    if (splitIdx !== -1 && maxDistSq > sqTolerance) {
        if (splitIdx - startIdx > 1) {
            rdpSubdivide(points, startIdx, splitIdx, sqTolerance, out);
        }
        out.push(points[splitIdx]);
        if (endIdx - splitIdx > 1) {
            rdpSubdivide(points, splitIdx, endIdx, sqTolerance, out);
        }
    }
}

function simplifyDouglasPeucker(points, sqTolerance) {
    const endIdx = points.length - 1;
    const out = [points[0]];
    rdpSubdivide(points, 0, endIdx, sqTolerance, out);
    out.push(points[endIdx]);
    return out;
}

function simplify(points, tolerance, highestQuality = false) {
    if (!Array.isArray(points) || points.length <= 2) {
        return points;
    }
    const sqTolerance = tolerance !== undefined ? tolerance * tolerance : 1;
    const candidates = highestQuality ? points : filterByRadialDistance(points, sqTolerance);
    return simplifyDouglasPeucker(candidates, sqTolerance);
}

function slopeToColor(slope) {
    for (const [threshold, hex] of SLOPE_PALETTE) {
        if (slope <= threshold) {
            return hex;
        }
    }
    return SLOPE_PALETTE[SLOPE_PALETTE.length - 1][1];
}

function gradeToDeg(grade) {
    return DEG_PER_RAD * Math.atan(grade / 100);
}

function slopeToRise(slope, distance) {
    return distance * Math.sin(Math.atan(slope / 100));
}

function slopeToRun(slope, distance) {
    return distance * Math.cos(Math.atan(slope / 100));
}

function adjacent(deg, radius) {
    return radius * Math.cos(RAD_PER_DEG * deg);
}

function opposite(deg, radius) {
    return radius * Math.sin(RAD_PER_DEG * deg);
}

const g = Object.freeze({
    simplifyDouglasPeucker,
    simplify,
    slopeToColor,
    gradeToDeg,
    slopeToRise,
    slopeToRun,
    adjacent,
    opposite,
});

export { g };
