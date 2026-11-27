// @ts-check
//
// <ride-map>: Ride page Map tile wrapping <route-map>.
//
// Listens to:
//   - gps:fix        live GPS breadcrumb trail + accuracy/distance header
//   - watch:stopped  marks trail to reset on the next ride start
//   - db:workout     draws a loaded .fit course's GPS track underneath
//

import { xf } from '../functions.js';
import './charts/route-map.js';

const SEMICIRCLE_TO_DEG = 180 / 2147483648;
const SINT32_INVALID = 0x7fffffff;
const EARTH_R_M = 6371000;

/**
 * @param {any} val
 * @param {number} limit
 * @returns {number | null}
 */
function toDeg(val, limit) {
    if(!Number.isFinite(val) || val === SINT32_INVALID || val === -2147483648) return null;
    const deg = Math.abs(val) <= 180 ? val : val * SEMICIRCLE_TO_DEG;
    return Math.abs(deg) <= limit ? deg : null;
}

/**
 * Extract a valid {lat, lon} pair from either {lat, lon} or {position_lat, position_long}.
 * @param {any} raw
 * @returns {{lat: number, lon: number} | null}
 */
function extractLatLon(raw) {
    if(!raw || typeof raw !== 'object') return null;
    const lat = toDeg(raw.lat ?? raw.position_lat, 90);
    const lon = toDeg(raw.lon ?? raw.position_long, 180);
    if(lat === null || lon === null) return null;
    if(lat === 0 && lon === 0) return null;
    return {lat, lon};
}

/**
 * Haversine distance in metres between two WGS84 coordinates.
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 * @returns {number}
 */
function haversine(a, b) {
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

class RideMap extends HTMLElement {
    constructor() {
        super();
        /** @type {AbortController | null} */
        this._abort = null;
        /** @type {Array<{lat: number, lon: number, power?: number | null}>} */
        this._trail = [];
        /** @type {Array<{lat: number, lon: number}>} */
        this._course = [];
        /** @type {number} */
        this._distanceM = 0;
        /** @type {number | null} */
        this._accuracyM = null;
        /** @type {boolean} */
        this._resetOnNextFix = false;
        /** @type {any} */
        this.$map = null;
        /** @type {HTMLElement | null} */
        this.$meta = null;
        /** @type {HTMLElement | null} */
        this.$empty = null;
    }

    connectedCallback() {
        if(!this.$map) {
            this.innerHTML = `
                <div class="rm-head">
                    <h2 class="tile__label">Map</h2>
                    <span class="rm-meta" data-rm-meta></span>
                </div>
                <div class="rm-stage">
                    <route-map class="rm-canvas"></route-map>
                    <p class="rm-empty" data-rm-empty>Turn on GPS in Settings → Devices to see your live route</p>
                </div>`;
            this.$map = this.querySelector('route-map');
            this.$meta = this.querySelector('[data-rm-meta]');
            this.$empty = this.querySelector('[data-rm-empty]');
        }

        this._abort?.abort();
        this._abort = new AbortController();
        const signal = {signal: this._abort.signal};

        xf.sub('gps:fix', fix => this.onFix(fix), signal);
        xf.sub('watch:stopped', () => { this._resetOnNextFix = true; }, signal);
        xf.sub('watch:started', () => {
            if(this._resetOnNextFix) this.resetTrail();
        }, signal);
        xf.sub('db:workout', workout => this.onWorkout(workout), signal);

        this._syncState();
    }

    disconnectedCallback() {
        this._abort?.abort();
        this._abort = null;
    }

    resetTrail() {
        this._trail = [];
        this._distanceM = 0;
        this._accuracyM = null;
        this._resetOnNextFix = false;
        this.$map?.setTrack({points: []});
        this._syncState();
    }

    /**
     * @param {any} fix
     */
    onFix(fix) {
        const pt = extractLatLon(fix);
        if(!pt) return;

        if(this._resetOnNextFix) {
            this._trail = [];
            this._distanceM = 0;
            this._resetOnNextFix = false;
            this.$map?.setTrack({points: []});
        }

        const prev = this._trail.length ? this._trail[this._trail.length - 1] : null;
        if(Number.isFinite(fix?.distance) && fix.distance >= 0) {
            this._distanceM = fix.distance;
        } else if(prev) {
            const step = haversine(prev, pt);
            if(step < 5000) this._distanceM += step;
        }

        if(Number.isFinite(fix?.accuracy) && fix.accuracy >= 0) {
            this._accuracyM = fix.accuracy;
        }

        const point = {
            lat: pt.lat,
            lon: pt.lon,
            power: Number.isFinite(fix?.power) ? fix.power : null,
        };
        this._trail.push(point);
        this.$map?.appendPoint(point);
        this._syncState();
    }

    /**
     * @param {any} workout
     */
    onWorkout(workout) {
        const rawPoints = Array.isArray(workout?.points) ? workout.points : [];
        /** @type {Array<{lat: number, lon: number}>} */
        const coursePoints = [];
        for(const p of rawPoints) {
            const pt = extractLatLon(p);
            if(pt) coursePoints.push(pt);
        }
        this._course = coursePoints.length >= 2 ? coursePoints : [];
        this.$map?.setCourse(this._course);
        this._syncState();
    }

    _syncState() {
        const hasTrack = this._trail.length > 0 || this._course.length >= 2;
        if(this.$empty) this.$empty.hidden = hasTrack;
        if(this.$meta) {
            const parts = [];
            if(this._trail.length > 0 && this._distanceM > 0) {
                parts.push(this._distanceM >= 1000
                    ? `${(this._distanceM / 1000).toFixed(1)} km`
                    : `${Math.round(this._distanceM)} m`);
            }
            if(Number.isFinite(this._accuracyM)) {
                parts.push(`±${Math.round(this._accuracyM)} m`);
            }
            this.$meta.textContent = parts.join(' · ');
        }
    }
}

if(!customElements.get('ride-map')) {
    customElements.define('ride-map', RideMap);
}

export { RideMap };
