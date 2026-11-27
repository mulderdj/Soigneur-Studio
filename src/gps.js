// @ts-check
//
// GPS Device (Browser Geolocation API)
//
// Follows the same xf event contract as BLE/ANT+ devices so GPS appears
// in Settings -> Devices, can be toggled on/off, remembered/forgotten via
// sensors.js, and feeds live coordinates, altitude, speed, and distance
// into outdoor rides and exported .fit files.
//

import { xf as defaultXf } from './functions.js';
import { db as defaultDb } from './db.js';
import { models as defaultModels } from './models/models.js';
import { showToast as defaultShowToast } from './views/toast.js';

const EARTH_RADIUS_M = 6371000;
const DEFAULT_WATCH_OPTIONS = Object.freeze({
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 15000,
});
const DEFAULT_MIN_DISTANCE_M = 2;
const DEFAULT_MAX_ACCURACY_M = 50;
const DEFAULT_MAX_SPEED_MPS = 40;
const MAX_DELTA_TIME_S = 30;
const MIN_ASCENT_STEP_M = 1;

/**
 * Great-circle distance in meters between two WGS-84 coordinates (degrees).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
    if(!Number.isFinite(lat1) || !Number.isFinite(lon1) ||
       !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
        return 0;
    }
    const toRad = /** @param {number} d */ d => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const a = sinLat * sinLat +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              sinLon * sinLon;
    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/**
 * Map a GeolocationPositionError to a concise user-facing message.
 * @param {any} err
 * @returns {string}
 */
function geolocationErrorMessage(err) {
    const code = err?.code;
    if(code === 1) return 'Location permission denied';
    if(code === 2) return 'Location unavailable';
    if(code === 3) return 'Location timed out';
    return err?.message || 'Location error';
}

/**
 * Create a GPS device controller bound to xf / db / Geolocation API.
 * @param {object} [opts]
 * @param {Geolocation|any} [opts.geolocation]
 * @param {typeof defaultXf} [opts.xf]
 * @param {any} [opts.db]
 * @param {typeof defaultModels} [opts.models]
 * @param {typeof defaultShowToast} [opts.showToast]
 * @param {PositionOptions} [opts.watchOptions]
 * @param {number} [opts.minDistanceM]
 * @param {number} [opts.maxAccuracyM]
 * @param {number} [opts.maxSpeedMps]
 * @param {boolean} [opts.autoStart]
 */
function createGpsDevice(opts = {}) {
    const bus = opts.xf ?? defaultXf;
    const stateDb = opts.db ?? defaultDb;
    const stateModels = opts.models ?? defaultModels;
    const toast = opts.showToast ?? defaultShowToast;
    const watchOptions = opts.watchOptions ?? DEFAULT_WATCH_OPTIONS;
    const minDistanceM = opts.minDistanceM ?? DEFAULT_MIN_DISTANCE_M;
    const maxAccuracyM = opts.maxAccuracyM ?? DEFAULT_MAX_ACCURACY_M;
    const maxSpeedMps = opts.maxSpeedMps ?? DEFAULT_MAX_SPEED_MPS;

    /** @returns {any} */
    function getGeolocation() {
        if('geolocation' in opts) return opts.geolocation;
        return typeof navigator !== 'undefined' ? navigator.geolocation : null;
    }

    /** @type {'disconnected'|'connecting'|'connected'} */
    let status = 'disconnected';
    /** @type {number|null} */
    let watchId = null;
    /** @type {{lat: number, lon: number, timestamp: number}|null} */
    let lastFix = null;
    /** @type {number|null} */
    let lastAlt = null;
    let reconnecting = false;
    /** @type {AbortController|null} */
    let abortController = null;

    function isGpsSpeedActive() {
        const speedSource = stateDb?.sources?.speed;
        return !speedSource || speedSource === 'gps';
    }

    function startWatch(isReconnect = false) {
        if(status !== 'disconnected' || watchId !== null) return true;
        const geo = getGeolocation();
        if(!geo || typeof geo.watchPosition !== 'function') {
            bus.dispatch('gps:disconnected');
            bus.dispatch('gps:name', '--');
            bus.dispatch('gps:coords', '--');
            bus.dispatch('gps:accuracy', '--');
            if(isReconnect) {
                bus.dispatch('sensor:reconnect-result', {identifier: 'gps', ok: false});
            }
            toast({text: 'Location is not supported in this browser', tone: 'warn'});
            return false;
        }

        status = 'connecting';
        reconnecting = isReconnect;
        lastFix = null;
        lastAlt = null;
        bus.dispatch('gps:connecting');
        bus.dispatch('gps:name', 'Locating…');

        try {
            watchId = geo.watchPosition(onPosition, onError, watchOptions);
        } catch(err) {
            onError(err);
            return false;
        }
        return true;
    }

    function stopWatch() {
        const geo = getGeolocation();
        if(watchId !== null && geo && typeof geo.clearWatch === 'function') {
            try { geo.clearWatch(watchId); } catch(_) {}
        }
        watchId = null;
        status = 'disconnected';
        reconnecting = false;
        lastFix = null;
        lastAlt = null;

        bus.dispatch('gps:disconnected');
        bus.dispatch('gps:name', '--');
        bus.dispatch('gps:coords', '--');
        bus.dispatch('gps:accuracy', '--');

        if(stateModels?.sources?.isSource?.('speed', 'gps')) {
            stateDb.speed = 0;
        }
    }

    /** @param {GeolocationPosition|any} pos */
    function onPosition(pos) {
        if(status === 'disconnected') return;
        const coords = pos?.coords;
        if(!coords) return;

        const lat = coords.latitude;
        const lon = coords.longitude;
        if(!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const accuracy = Number.isFinite(coords.accuracy) ? coords.accuracy : null;
        const altitude = Number.isFinite(coords.altitude) ? coords.altitude : null;
        const rawSpeed = Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null;
        const timestamp = Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now();

        if(status !== 'connected') {
            status = 'connected';
            bus.dispatch('gps:connected');
            bus.dispatch('sensor:connected', {
                identifier: 'gps',
                id: 'browser-gps',
                name: 'GPS',
            });
            if(reconnecting) {
                reconnecting = false;
                bus.dispatch('sensor:reconnect-result', {identifier: 'gps', ok: true});
            }
        }

        const label = accuracy !== null ? `Precise (±${Math.round(accuracy)} m)` : 'GPS';
        bus.dispatch('gps:name', label);
        bus.dispatch('gps:accuracy', accuracy !== null ? `±${Math.round(accuracy)} m` : '--');
        bus.dispatch('gps:coords', `${lat.toFixed(5)}, ${lon.toFixed(5)}`);

        // Update live position in db (degrees; FIT encoder converts to semicircles)
        stateDb.position_lat = lat;
        stateDb.position_long = lon;

        // Update altitude and track ascent when recording
        if(altitude !== null) {
            stateDb.altitude = altitude;
            if(stateDb.watchStatus === 'started') {
                if(lastAlt === null) {
                    lastAlt = altitude;
                } else if(altitude - lastAlt >= MIN_ASCENT_STEP_M) {
                    stateDb.ascent = (stateDb.ascent || 0) + (altitude - lastAlt);
                    lastAlt = altitude;
                } else if(altitude < lastAlt) {
                    lastAlt = altitude;
                }
            } else {
                lastAlt = altitude;
            }
        }

        const accurate = accuracy === null || accuracy <= maxAccuracyM;
        let deltaM = 0;
        let dt = 0;
        if(lastFix !== null) {
            dt = (timestamp - lastFix.timestamp) / 1000;
            deltaM = haversineMeters(lastFix.lat, lastFix.lon, lat, lon);
        }

        // Determine speed (m/s)
        /** @type {number|null} */
        let speed = null;
        if(rawSpeed !== null) {
            speed = Math.min(rawSpeed, maxSpeedMps);
        } else if(lastFix !== null && accurate && dt > 0 && dt <= MAX_DELTA_TIME_S) {
            speed = deltaM >= minDistanceM ? Math.min(deltaM / dt, maxSpeedMps) : 0;
        }

        const fix = {
            lat,
            lon,
            altitude,
            speed,
            accuracy,
            timestamp,
        };
        bus.dispatch('gps:fix', fix);

        if(isGpsSpeedActive()) {
            if(speed !== null) {
                bus.dispatch('gps:speed', speed);
                stateDb.speed = speed;
            }

            if(stateDb.watchStatus === 'started') {
                if(accurate) {
                    if(lastFix === null || dt > MAX_DELTA_TIME_S) {
                        lastFix = {lat, lon, timestamp};
                    } else if(deltaM >= minDistanceM) {
                        stateDb.distance = (stateDb.distance || 0) + deltaM;
                        lastFix = {lat, lon, timestamp};
                    }
                }
            } else if(accurate) {
                lastFix = {lat, lon, timestamp};
            }
        } else if(accurate) {
            lastFix = {lat, lon, timestamp};
        }
    }

    /** @param {GeolocationPositionError|any} err */
    function onError(err) {
        const geo = getGeolocation();
        if(watchId !== null && geo && typeof geo.clearWatch === 'function') {
            try { geo.clearWatch(watchId); } catch(_) {}
        }
        const wasReconnecting = reconnecting;
        watchId = null;
        status = 'disconnected';
        reconnecting = false;
        lastFix = null;
        lastAlt = null;

        bus.dispatch('gps:disconnected');
        bus.dispatch('gps:name', '--');
        bus.dispatch('gps:coords', '--');
        bus.dispatch('gps:accuracy', '--');

        if(wasReconnecting) {
            bus.dispatch('sensor:reconnect-result', {identifier: 'gps', ok: false});
        }

        toast({text: geolocationErrorMessage(err), tone: 'warn'});
    }

    function onSwitch() {
        if(status === 'disconnected') {
            startWatch(false);
        } else {
            stopWatch();
        }
    }

    function onReconnect() {
        if(status === 'disconnected') {
            startWatch(true);
        }
    }

    function onWatchStopped() {
        lastFix = null;
        lastAlt = null;
    }

    function start() {
        if(abortController) return;
        abortController = new AbortController();
        const signal = {signal: abortController.signal};
        bus.sub('ui:gps:switch', onSwitch, signal);
        bus.sub('ui:gps:reconnect', onReconnect, signal);
        bus.sub('watch:stopped', onWatchStopped, signal);
    }

    function destroy() {
        stopWatch();
        if(abortController) {
            abortController.abort();
            abortController = null;
        }
    }

    if(opts.autoStart !== false) {
        start();
    }

    return Object.freeze({
        start,
        destroy,
        startWatch,
        stopWatch,
        getStatus: () => status,
        isConnected: () => status === 'connected',
    });
}

const gpsDevice = createGpsDevice({autoStart: false});
defaultXf.sub('app:start', () => gpsDevice.start());

export {
    haversineMeters,
    createGpsDevice,
    gpsDevice,
};
export default gpsDevice;
