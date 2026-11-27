// @ts-check

import {
    ServiceUUIDs,
    CharacteristicUUIDs,
    bleUuid,
    normalizeUuid,
    uuidToName,
} from './uuids.js';

const COMMON_OPTIONAL_SERVICES = Object.freeze([
    ServiceUUIDs.battery,
    ServiceUUIDs.deviceInformation,
    ServiceUUIDs.genericAccess,
]);

/**
 * Merge unique service UUID lists.
 *
 * @param {...readonly string[]} groups
 * @returns {string[]}
 */
function uniqueServices(...groups) {
    const set = new Set();
    for (const group of groups) {
        for (const item of group) {
            set.add(item);
        }
    }
    return Array.from(set);
}

const controllable = Object.freeze({
    filters: [
        { services: [ServiceUUIDs.fitnessMachine] },
        { services: [ServiceUUIDs.fec] },
        { services: [ServiceUUIDs.cyclingPower] },
    ],
    optionalServices: uniqueServices(
        [
            ServiceUUIDs.fitnessMachine,
            ServiceUUIDs.fec,
            ServiceUUIDs.cyclingPower,
            ServiceUUIDs.cyclingSpeedCadence,
            ServiceUUIDs.heartRate,
        ],
        COMMON_OPTIONAL_SERVICES,
    ),
});

const powerMeter = Object.freeze({
    filters: [
        { services: [ServiceUUIDs.cyclingPower] },
    ],
    optionalServices: uniqueServices(
        [
            ServiceUUIDs.cyclingPower,
            ServiceUUIDs.cyclingSpeedCadence,
        ],
        COMMON_OPTIONAL_SERVICES,
    ),
});

const speedCadenceSensor = Object.freeze({
    filters: [
        { services: [ServiceUUIDs.cyclingSpeedCadence] },
    ],
    optionalServices: uniqueServices(
        [ServiceUUIDs.cyclingSpeedCadence],
        COMMON_OPTIONAL_SERVICES,
    ),
});

const heartRateMonitor = Object.freeze({
    filters: [
        { services: [ServiceUUIDs.heartRate] },
    ],
    optionalServices: uniqueServices(
        [ServiceUUIDs.heartRate],
        COMMON_OPTIONAL_SERVICES,
    ),
});

const smo2 = Object.freeze({
    filters: [
        { services: [ServiceUUIDs.smo2] },
    ],
    optionalServices: uniqueServices(
        [ServiceUUIDs.smo2],
        COMMON_OPTIONAL_SERVICES,
    ),
});

const coreTemp = Object.freeze({
    filters: [
        { services: [ServiceUUIDs.coreTemp] },
    ],
    optionalServices: uniqueServices(
        [
            ServiceUUIDs.coreTemp,
            ServiceUUIDs.heartRate,
        ],
        COMMON_OPTIONAL_SERVICES,
    ),
});

const openBikeControl = Object.freeze({
    filters: [
        { services: [ServiceUUIDs.openBikeControl] },
    ],
    optionalServices: uniqueServices(
        [ServiceUUIDs.openBikeControl],
        COMMON_OPTIONAL_SERVICES,
    ),
});

const ALL_PRIMARY_SERVICES = uniqueServices([
    ServiceUUIDs.fitnessMachine,
    ServiceUUIDs.fec,
    ServiceUUIDs.cyclingPower,
    ServiceUUIDs.cyclingSpeedCadence,
    ServiceUUIDs.heartRate,
    ServiceUUIDs.smo2,
    ServiceUUIDs.coreTemp,
    ServiceUUIDs.openBikeControl,
]);

const all = Object.freeze({
    filters: ALL_PRIMARY_SERVICES.map(uuid => ({ services: [uuid] })),
    optionalServices: uniqueServices(ALL_PRIMARY_SERVICES, COMMON_OPTIONAL_SERVICES),
});

const generic = Object.freeze({
    acceptAllDevices: true,
    optionalServices: uniqueServices(ALL_PRIMARY_SERVICES, COMMON_OPTIONAL_SERVICES),
});

/**
 * Check whether Web Bluetooth is supported in the current runtime.
 *
 * @param {any} [nav]
 * @returns {boolean}
 */
function isAvailable(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
    return Boolean(nav && nav.bluetooth && typeof nav.bluetooth.requestDevice === 'function');
}

/**
 * Create a promise queue that serializes GATT operations sequentially so
 * concurrent reads/writes/subscriptions never throw `GATT operation already in progress`.
 */
function createGattQueue() {
    /** @type {Promise<any>} */
    let tail = Promise.resolve();

    /**
     * @template T
     * @param {() => Promise<T> | T} task
     * @returns {Promise<T>}
     */
    function enqueue(task) {
        const next = tail.then(task, task);
        tail = next.catch(() => {});
        return next;
    }

    return Object.freeze({ enqueue });
}

const webBle = Object.freeze({
    ServiceUUIDs,
    CharacteristicUUIDs,
    bleUuid,
    normalizeUuid,
    uuidToName,
    isAvailable,
    createGattQueue,
    controllable,
    powerMeter,
    speedCadenceSensor,
    heartRateMonitor,
    smo2,
    coreTemp,
    openBikeControl,
    all,
    generic,
});

export {
    ServiceUUIDs,
    CharacteristicUUIDs,
    bleUuid,
    normalizeUuid,
    uuidToName,
    isAvailable,
    createGattQueue,
    controllable,
    powerMeter,
    speedCadenceSensor,
    heartRateMonitor,
    smo2,
    coreTemp,
    openBikeControl,
    all,
    generic,
    webBle,
};
