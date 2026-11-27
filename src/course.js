// @ts-check
import { xf, exists, first } from './functions.js';
import { ControlMode } from './ble/enums.js';

function createCourseFollower() {
    const abortController = new AbortController();
    const signal = { signal: abortController.signal };

    let active = false;
    let lapDistance = 0;
    let segmentIndex = 0;
    let maxSegmentIndex = 0;
    let totalDistance = 0;
    let segmentLength = 0;
    let segmentSlope = 0;
    let segmentStart = 0;
    let pointCursor = 0;
    /** @type {any} */
    let currentCourse = undefined;

    function hasCoursePoints() {
        return Array.isArray(currentCourse?.points) && currentCourse.points.length > 0;
    }

    function loadCourseMetrics(courseData) {
        maxSegmentIndex = Math.max(1, (courseData.pointsSimplified?.length ?? 1) - 1);
        totalDistance = courseData.meta?.distance ?? 0;
    }

    function applySegment(idx) {
        const seg = currentCourse?.pointsSimplified?.[idx];
        if (!seg) return;
        segmentLength = seg.r ?? 0;
        segmentSlope = seg.slope ?? 0;
        segmentStart = seg.distance ?? lapDistance;
    }

    function updatePosition(wrappedDist) {
        const pts = currentCourse?.points;
        if (!Array.isArray(pts) || pts.length === 0) return;

        if (pointCursor >= pts.length || wrappedDist < (pts[pointCursor]?.distance ?? 0) && pointCursor > 0 && wrappedDist < (pts[0]?.distance ?? 0)) {
            pointCursor = 0;
        }

        while (pointCursor < pts.length - 1 && wrappedDist > pts[pointCursor].distance) {
            pointCursor += 1;
        }

        const prevIdx = Math.max(0, pointCursor - 1);
        const dPrev = Math.abs((pts[prevIdx]?.distance ?? 0) - wrappedDist);
        const dCurr = Math.abs((pts[pointCursor]?.distance ?? 0) - wrappedDist);
        const chosenIdx = dPrev < dCurr ? prevIdx : pointCursor;
        const chosen = pts[chosenIdx];

        if (chosen) {
            xf.dispatch('course:position', {
                position_lat: chosen.position_lat,
                position_long: chosen.position_long,
            });
        }
        pointCursor = chosenIdx;
    }

    function onCourseIndex(idx) {
        segmentIndex = idx;
    }

    function onDistance(rawDistance) {
        if (!active || !hasCoursePoints() || !(totalDistance > 0)) return;

        const total = Number(rawDistance);
        if (!Number.isFinite(total)) return;

        const wrapped = total % totalDistance;
        updatePosition(wrapped);

        lapDistance = wrapped;

        if (lapDistance - segmentStart >= segmentLength || segmentStart > lapDistance) {
            const nextIndex = (segmentIndex + 1) % maxSegmentIndex;
            xf.dispatch('course:index', nextIndex);
            applySegment(nextIndex);
            xf.dispatch('ui:slope-target-set', segmentSlope);
        }
    }

    function onWorkout(workout) {
        currentCourse = workout;
        active = false;
        lapDistance = 0;
        pointCursor = 0;

        if (exists(currentCourse?.points) && currentCourse.points.length > 0) {
            loadCourseMetrics(currentCourse);
            applySegment(segmentIndex);
            const startPoint = first(currentCourse.points);
            if (exists(startPoint?.y)) {
                xf.dispatch('altitude', startPoint.y);
            }
        }
    }

    function start() {
        if (lapDistance > 0 || !hasCoursePoints()) return;
        active = true;
        loadCourseMetrics(currentCourse);
        applySegment(segmentIndex);
        xf.dispatch('ui:slope-target-set', segmentSlope);
        xf.dispatch('ui:mode-set', ControlMode.sim);
    }

    function onWatchStart() {
        if (hasCoursePoints()) {
            start();
        }
    }

    xf.sub('db:distance', onDistance, signal);
    xf.sub('db:workout', onWorkout, signal);
    xf.sub('ui:workoutStart', onWatchStart, signal);
    xf.sub('ui:watchStart', onWatchStart, signal);
    xf.sub('db:courseIndex', onCourseIndex, signal);

    return Object.freeze({
        start,
        stop: () => abortController.abort(),
    });
}

const course = createCourseFollower();

export { course, createCourseFollower };
