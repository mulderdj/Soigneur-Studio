// @ts-check
//
// BLE Role Session & Trainer Control Lifecycle Manager
//

import { xf as defaultXf, clamp } from '../functions.js';
import { models } from '../models/models.js';
import { Status, ControlMode } from './enums.js';
import {
    ServiceUUIDs,
    CharacteristicUUIDs,
    createGattQueue,
} from './web-ble.js';
import {
    decodeIndoorBikeData,
    encodeRequestControl,
    encodeReset,
    encodeStartOrResume,
    encodeResistancePercent,
    encodeTargetPower,
    encodeIndoorBikeSimulation,
    decodeSupportedPowerRange,
    decodeSupportedResistanceRange,
    decodeFitnessMachineStatus,
} from './protocols/ftms.js';
import {
    decodeFecFrame,
    encodeFecBasicResistance,
    encodeFecTargetPower,
    encodeFecTrackResistance,
} from './protocols/fec.js';
import { createCyclingPowerDecoder } from './protocols/cps.js';
import { createCscDecoder } from './protocols/csc.js';
import { decodeHeartRateMeasurement } from './protocols/heart-rate.js';
import { decodeBatteryLevel } from './protocols/battery.js';
import { decodeMoxyMeasurement } from './protocols/moxy.js';
import { decodeCoreTemperature } from './protocols/core-temp.js';
import { decodeOpenBikeControlButtonState } from './obc/controls.js';

const DEFAULT_RECONNECT_DELAYS_MS = [300, 800, 1800];

/**
 * Write bytes to a Web Bluetooth characteristic using the best supported method.
 *
 * @param {any} characteristic
 * @param {Uint8Array} bytes
 */
async function writeCharacteristic(characteristic, bytes) {
    if (!characteristic) return;
    if (typeof characteristic.writeValueWithResponse === 'function') {
        await characteristic.writeValueWithResponse(bytes);
    } else if (typeof characteristic.writeValue === 'function') {
        await characteristic.writeValue(bytes);
    } else if (typeof characteristic.writeValueWithoutResponse === 'function') {
        await characteristic.writeValueWithoutResponse(bytes);
    }
}

/**
 * Try to retrieve a primary GATT service, returning `null` when absent.
 *
 * @param {any} server
 * @param {string} uuid
 * @returns {Promise<any | null>}
 */
async function tryGetService(server, uuid) {
    if (!server || typeof server.getPrimaryService !== 'function') return null;
    try {
        return await server.getPrimaryService(uuid);
    } catch (_) {
        return null;
    }
}

/**
 * Try to retrieve a GATT characteristic, returning `null` when absent.
 *
 * @param {any} service
 * @param {string} uuid
 * @returns {Promise<any | null>}
 */
async function tryGetCharacteristic(service, uuid) {
    if (!service || typeof service.getCharacteristic !== 'function') return null;
    try {
        return await service.getCharacteristic(uuid);
    } catch (_) {
        return null;
    }
}

/**
 * Decode a UTF-8 string from a DataView (e.g. GAP Device Name 0x2A00).
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 * @returns {string}
 */
function decodeUtf8(raw) {
    const bytes = raw instanceof DataView
        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        : ArrayBuffer.isView(raw)
            ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
            : new Uint8Array(raw);
    return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/g, '').trim();
}

/**
 * Create a managed Web Bluetooth session for one logical sensor role
 * (e.g. `ble:controllable`, `ble:powerMeter`, `ble:heartRateMonitor`, ...).
 *
 * @param {{
 *   identifier: string,
 *   filter: object,
 *   controllable?: boolean,
 *   xf?: typeof defaultXf,
 *   bluetooth?: any,
 *   isSource?: (metric: string, identifier: string) => boolean,
 *   reconnectDelaysMs?: number[],
 * }} config
 */
function createBleSession(config) {
    const {
        identifier,
        filter,
        controllable = false,
    } = config;
    const bus = config.xf ?? defaultXf;
    const isSource = config.isSource ?? ((metric, id) => models.sources.isSource(metric, id));
    const reconnectDelaysMs = config.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;

    const getBluetooth = () => {
        if (config.bluetooth !== undefined) return config.bluetooth;
        return typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).bluetooth : undefined;
    };

    const abortController = new AbortController();
    const signal = { signal: abortController.signal };
    const gattQueue = createGattQueue();

    const cpsDecoder = createCyclingPowerDecoder();
    const cscDecoder = createCscDecoder();

    let status = Status.disconnected;
    let userDisconnected = false;
    let recovering = false;
    let connectionToken = 0;

    /** @type {any | null} */
    let device = null;
    /** @type {Array<() => void>} */
    let charUnsubs = [];
    /** @type {(() => void) | null} */
    let disconnectUnsub = null;

    // Trainer control characteristics & supported ranges
    /** @type {any | null} */
    let ftmsControlPoint = null;
    /** @type {any | null} */
    let fecWriteChar = null;
    /** @type {{ min: number, max: number, increment: number } | null} */
    let supportedPowerRange = null;
    /** @type {{ min: number, max: number, increment: number } | null} */
    let supportedResistanceRange = null;

    // Live trainer control state
    let mode = ControlMode.erg;
    let powerTarget = 0;
    let powerMatchOffset = 0;
    let powerMatchActive = false;
    let resistanceTarget = 0;
    let slopeTarget = 0;

    function emitMetric(metric, value) {
        if (!Number.isFinite(value)) return;
        bus.dispatch(`${identifier}:${metric}`, value);
        if (isSource(metric, identifier)) {
            bus.dispatch(metric, value);
        }
    }

    function emitPower(watts) {
        if (!Number.isFinite(watts)) return;
        const clean = clamp(0, 2500, Math.round(watts));
        bus.dispatch(`${identifier}:power`, clean);
        if (isSource('power', identifier)) {
            bus.dispatch('power', clean);
        }
    }

    function emitCadence(rpm) {
        if (!Number.isFinite(rpm)) return;
        const clean = clamp(0, 255, Math.round(rpm));
        bus.dispatch(`${identifier}:cadence`, clean);
        if (isSource('cadence', identifier)) {
            bus.dispatch('cadence', clean);
        }
    }

    function emitSpeed(mps) {
        if (!Number.isFinite(mps)) return;
        const clean = clamp(0, 120, mps);
        bus.dispatch(`${identifier}:speed`, clean);
        if (isSource('speed', identifier)) {
            bus.dispatch('speed', clean);
        }
    }

    function emitHeartRate(bpm, rrIntervals) {
        if (Number.isFinite(bpm) && bpm > 0) {
            const clean = clamp(0, 255, Math.round(bpm));
            bus.dispatch(`${identifier}:heartRate`, clean);
            if (isSource('heartRate', identifier)) {
                bus.dispatch('heartRate', clean);
            }
        }
        if (Array.isArray(rrIntervals) && rrIntervals.length > 0 && isSource('heartRate', identifier)) {
            bus.dispatch('rrInterval', rrIntervals);
        }
    }

    function clearCharacteristicListeners() {
        while (charUnsubs.length > 0) {
            const fn = charUnsubs.pop();
            try { fn?.(); } catch (_) {}
        }
        ftmsControlPoint = null;
        fecWriteChar = null;
        supportedPowerRange = null;
        supportedResistanceRange = null;
        cpsDecoder.reset();
        cscDecoder.reset();
    }

    function clearDeviceListener() {
        if (disconnectUnsub) {
            try { disconnectUnsub(); } catch (_) {}
            disconnectUnsub = null;
        }
    }

    /**
     * Subscribe to notifications on a GATT characteristic inside the sequential GATT queue.
     *
     * @param {any} characteristic
     * @param {(view: DataView) => void} onValue
     */
    async function subscribeCharacteristic(characteristic, onValue) {
        if (!characteristic) return false;
        const handler = (event) => {
            const value = event?.target?.value ?? characteristic.value;
            if (value) onValue(value);
        };
        characteristic.addEventListener?.('characteristicvaluechanged', handler);
        charUnsubs.push(() => {
            characteristic.removeEventListener?.('characteristicvaluechanged', handler);
        });
        if (typeof characteristic.startNotifications === 'function') {
            await gattQueue.enqueue(() => characteristic.startNotifications());
        }
        return true;
    }

    function canControlTrainer() {
        if (!controllable || status !== Status.connected) return false;
        if (!ftmsControlPoint && !fecWriteChar) return false;
        // Control defaults to ble:controllable unless explicitly reassigned
        return isSource('control', identifier) || !isSource('control', 'ant:controllable');
    }

    function effectiveErgWatts() {
        const base = Number.isFinite(powerTarget) && powerTarget > 0 ? powerTarget : 0;
        if (base <= 0) return 0;
        const offset = powerMatchActive && Number.isFinite(powerMatchOffset) ? powerMatchOffset : 0;
        return Math.max(0, Math.round(base + offset));
    }

    function sendTrainerCommand(ftmsBytes, fecBytes) {
        if (!canControlTrainer()) return Promise.resolve(false);
        if (ftmsControlPoint && ftmsBytes) {
            const ch = ftmsControlPoint;
            return gattQueue.enqueue(async () => {
                await writeCharacteristic(ch, ftmsBytes);
                return true;
            }).catch(() => false);
        }
        if (fecWriteChar && fecBytes) {
            const ch = fecWriteChar;
            return gattQueue.enqueue(async () => {
                await writeCharacteristic(ch, fecBytes);
                return true;
            }).catch(() => false);
        }
        return Promise.resolve(false);
    }

    function applyCurrentControlTarget() {
        if (!canControlTrainer()) return Promise.resolve(false);
        if (mode === ControlMode.resistance) {
            return sendTrainerCommand(
                encodeResistancePercent(resistanceTarget, supportedResistanceRange),
                encodeFecBasicResistance(resistanceTarget),
            );
        }
        if (mode === ControlMode.sim) {
            return sendTrainerCommand(
                encodeIndoorBikeSimulation({ grade: slopeTarget, windSpeed: 0, crr: 0.004, cw: 0.51 }),
                encodeFecTrackResistance({ grade: slopeTarget, crr: 0.004 }),
            );
        }
        const watts = effectiveErgWatts();
        return sendTrainerCommand(
            encodeTargetPower(watts, supportedPowerRange),
            encodeFecTargetPower(watts),
        );
    }

    function resetTrainer() {
        if (!canControlTrainer()) return Promise.resolve(false);
        if (ftmsControlPoint) {
            const ch = ftmsControlPoint;
            return gattQueue.enqueue(async () => {
                await writeCharacteristic(ch, encodeRequestControl());
                await writeCharacteristic(ch, encodeReset());
                await writeCharacteristic(ch, encodeRequestControl());
                return true;
            }).catch(() => false);
        }
        return Promise.resolve(false);
    }

    /**
     * Discover services and bind all relevant GATT characteristics on `server`.
     *
     * @param {any} bleDevice
     * @param {any} server
     */
    async function setupGattServices(bleDevice, server) {
        clearCharacteristicListeners();

        // Resolve device display name (preferring `bleDevice.name`, falling back to GAP 0x2A00)
        let resolvedName = bleDevice?.name?.trim() || '';
        if (!resolvedName) {
            const gapService = await tryGetService(server, ServiceUUIDs.genericAccess);
            const nameChar = await tryGetCharacteristic(gapService, CharacteristicUUIDs.deviceName);
            if (nameChar && typeof nameChar.readValue === 'function') {
                try {
                    const val = await gattQueue.enqueue(() => nameChar.readValue());
                    if (val) resolvedName = decodeUtf8(val);
                } catch (_) {}
            }
        }
        if (!resolvedName) resolvedName = 'Bluetooth Sensor';

        let hasFtmsTelemetry = false;
        let hasCpsTelemetry = false;

        // 1. FTMS (0x1826)
        const ftmsService = await tryGetService(server, ServiceUUIDs.fitnessMachine);
        if (ftmsService) {
            const powerRangeChar = await tryGetCharacteristic(ftmsService, CharacteristicUUIDs.supportedPowerRange);
            if (powerRangeChar && typeof powerRangeChar.readValue === 'function') {
                try {
                    const raw = await gattQueue.enqueue(() => powerRangeChar.readValue());
                    if (raw) supportedPowerRange = decodeSupportedPowerRange(raw);
                } catch (_) {}
            }

            const resRangeChar = await tryGetCharacteristic(ftmsService, CharacteristicUUIDs.supportedResistanceLevelRange);
            if (resRangeChar && typeof resRangeChar.readValue === 'function') {
                try {
                    const raw = await gattQueue.enqueue(() => resRangeChar.readValue());
                    if (raw) supportedResistanceRange = decodeSupportedResistanceRange(raw);
                } catch (_) {}
            }

            const bikeDataChar = await tryGetCharacteristic(ftmsService, CharacteristicUUIDs.indoorBikeData);
            if (bikeDataChar) {
                hasFtmsTelemetry = true;
                await subscribeCharacteristic(bikeDataChar, view => {
                    const parsed = decodeIndoorBikeData(view);
                    if (parsed.power !== undefined) emitPower(parsed.power);
                    if (parsed.cadence !== undefined) emitCadence(parsed.cadence);
                    if (parsed.speed !== undefined) emitSpeed(parsed.speed);
                    if (parsed.heartRate !== undefined && parsed.heartRate > 0) emitHeartRate(parsed.heartRate);
                });
            }

            if (controllable) {
                const cpChar = await tryGetCharacteristic(ftmsService, CharacteristicUUIDs.fitnessMachineControlPoint);
                if (cpChar) {
                    ftmsControlPoint = cpChar;
                    await subscribeCharacteristic(cpChar, () => {});
                    try {
                        await gattQueue.enqueue(() => writeCharacteristic(cpChar, encodeRequestControl()));
                        await gattQueue.enqueue(() => writeCharacteristic(cpChar, encodeStartOrResume()));
                    } catch (_) {}
                }

                const statusChar = await tryGetCharacteristic(ftmsService, CharacteristicUUIDs.fitnessMachineStatus);
                if (statusChar) {
                    await subscribeCharacteristic(statusChar, view => {
                        const st = decodeFitnessMachineStatus(view);
                        if (st?.controlLost && ftmsControlPoint) {
                            const ch = ftmsControlPoint;
                            gattQueue.enqueue(() => writeCharacteristic(ch, encodeRequestControl())).catch(() => {});
                        }
                    });
                }
            }
        }

        // 2. Tacx FE-C over BLE fallback (`6e40fec1-...`)
        if (!ftmsService) {
            const fecService = await tryGetService(server, ServiceUUIDs.fec);
            if (fecService) {
                const fecNotify = await tryGetCharacteristic(fecService, CharacteristicUUIDs.fecNotify);
                if (fecNotify) {
                    await subscribeCharacteristic(fecNotify, view => {
                        const parsed = decodeFecFrame(view);
                        if (!parsed) return;
                        if (parsed.power !== undefined) emitPower(parsed.power);
                        if (parsed.cadence !== undefined) emitCadence(parsed.cadence);
                        if (parsed.speed !== undefined) emitSpeed(parsed.speed);
                        if (parsed.heartRate !== undefined && parsed.heartRate > 0) emitHeartRate(parsed.heartRate);
                    });
                }
                if (controllable) {
                    fecWriteChar = await tryGetCharacteristic(fecService, CharacteristicUUIDs.fecWrite);
                }
            }
        }

        // 3. Cycling Power Service (0x1818)
        if (!hasFtmsTelemetry) {
            const cpsService = await tryGetService(server, ServiceUUIDs.cyclingPower);
            if (cpsService) {
                const cpsChar = await tryGetCharacteristic(cpsService, CharacteristicUUIDs.cyclingPowerMeasurement);
                if (cpsChar) {
                    hasCpsTelemetry = true;
                    await subscribeCharacteristic(cpsChar, view => {
                        const parsed = cpsDecoder.decode(view);
                        if (!parsed) return;
                        emitPower(parsed.power);
                        if (parsed.cadence !== undefined) emitCadence(parsed.cadence);
                        if (parsed.speed !== undefined) emitSpeed(parsed.speed);
                    });
                }
            }
        }

        // 4. Cycling Speed & Cadence Service (0x1816)
        if (!hasFtmsTelemetry && !hasCpsTelemetry) {
            const cscService = await tryGetService(server, ServiceUUIDs.cyclingSpeedCadence);
            if (cscService) {
                const cscChar = await tryGetCharacteristic(cscService, CharacteristicUUIDs.cscMeasurement);
                if (cscChar) {
                    await subscribeCharacteristic(cscChar, view => {
                        const parsed = cscDecoder.decode(view);
                        if (!parsed) return;
                        if (parsed.cadence !== undefined) emitCadence(parsed.cadence);
                        if (parsed.speed !== undefined) emitSpeed(parsed.speed);
                    });
                }
            }
        }

        // 5. Heart Rate Service (0x180D)
        const hrService = await tryGetService(server, ServiceUUIDs.heartRate);
        if (hrService) {
            const hrChar = await tryGetCharacteristic(hrService, CharacteristicUUIDs.heartRateMeasurement);
            if (hrChar) {
                await subscribeCharacteristic(hrChar, view => {
                    const parsed = decodeHeartRateMeasurement(view);
                    if (!parsed) return;
                    emitHeartRate(parsed.heartRate, parsed.rrIntervals);
                });
            }
        }

        // 6. Moxy SmO2 Service (`6404d801-...`)
        const moxyService = await tryGetService(server, ServiceUUIDs.smo2);
        if (moxyService) {
            const moxyChar = await tryGetCharacteristic(moxyService, CharacteristicUUIDs.smo2Measurement);
            if (moxyChar) {
                await subscribeCharacteristic(moxyChar, view => {
                    const parsed = decodeMoxyMeasurement(view);
                    if (!parsed) return;
                    if (parsed.smo2 !== undefined) emitMetric('smo2', parsed.smo2);
                    if (parsed.thb !== undefined) emitMetric('thb', parsed.thb);
                });
            }
        }

        // 7. CORE Body Temperature Service (`00002100-...`)
        const coreService = await tryGetService(server, ServiceUUIDs.coreTemp);
        if (coreService) {
            const coreChar = await tryGetCharacteristic(coreService, CharacteristicUUIDs.coreTempMeasurement);
            if (coreChar) {
                await subscribeCharacteristic(coreChar, view => {
                    const parsed = decodeCoreTemperature(view);
                    if (!parsed) return;
                    if (parsed.coreBodyTemperature !== undefined) {
                        emitMetric('coreBodyTemperature', parsed.coreBodyTemperature);
                    }
                    if (parsed.skinTemperature !== undefined) {
                        emitMetric('skinTemperature', parsed.skinTemperature);
                    }
                    if (parsed.heartRate !== undefined && !hrService) {
                        emitHeartRate(parsed.heartRate);
                    }
                });
            }
        }

        // 8. OpenBikeControl Service (`d273f680-...`)
        const obcService = await tryGetService(server, ServiceUUIDs.openBikeControl);
        if (obcService) {
            const obcChar = await tryGetCharacteristic(obcService, CharacteristicUUIDs.openBikeControlButtonState);
            if (obcChar) {
                await subscribeCharacteristic(obcChar, view => {
                    const messages = decodeOpenBikeControlButtonState(view);
                    if (messages.length > 0) {
                        bus.dispatch('ble:openBikeControl:buttonState', messages);
                    }
                });
            }
        }

        // 9. Battery Service (0x180F / 0x2A19)
        const batteryService = await tryGetService(server, ServiceUUIDs.battery);
        if (batteryService) {
            const batteryChar = await tryGetCharacteristic(batteryService, CharacteristicUUIDs.batteryLevel);
            if (batteryChar) {
                if (typeof batteryChar.readValue === 'function') {
                    try {
                        const raw = await gattQueue.enqueue(() => batteryChar.readValue());
                        const level = raw ? decodeBatteryLevel(raw) : null;
                        if (level !== null) bus.dispatch(`${identifier}:batteryLevel`, level);
                    } catch (_) {}
                }
                await subscribeCharacteristic(batteryChar, view => {
                    const level = decodeBatteryLevel(view);
                    if (level !== null) bus.dispatch(`${identifier}:batteryLevel`, level);
                }).catch(() => {});
            }
        }

        return resolvedName;
    }

    /**
     * Handle unintended GATT drops by attempting silent background recovery.
     *
     * @param {any} droppedDevice
     * @param {number} tokenAtConnect
     */
    async function handleGattDisconnected(droppedDevice, tokenAtConnect) {
        clearCharacteristicListeners();

        if (userDisconnected || tokenAtConnect !== connectionToken || !droppedDevice?.gatt) {
            status = Status.disconnected;
            bus.dispatch(`${identifier}:disconnected`);
            return;
        }

        if (recovering) return;
        recovering = true;
        status = Status.connecting;
        bus.dispatch(`${identifier}:connecting`);

        for (let attempt = 0; attempt < reconnectDelaysMs.length; attempt++) {
            const waitMs = reconnectDelaysMs[attempt];
            if (waitMs > 0) {
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
            if (userDisconnected || tokenAtConnect !== connectionToken) {
                recovering = false;
                status = Status.disconnected;
                bus.dispatch(`${identifier}:disconnected`);
                return;
            }
            try {
                const server = await droppedDevice.gatt.connect();
                if (userDisconnected || tokenAtConnect !== connectionToken) {
                    try { droppedDevice.gatt.disconnect?.(); } catch (_) {}
                    recovering = false;
                    status = Status.disconnected;
                    bus.dispatch(`${identifier}:disconnected`);
                    return;
                }
                const resolvedName = await setupGattServices(droppedDevice, server);
                recovering = false;
                status = Status.connected;
                bus.dispatch(`${identifier}:name`, resolvedName);
                bus.dispatch(`${identifier}:connected`);
                if (controllable) {
                    await applyCurrentControlTarget();
                }
                return;
            } catch (_) {
                // Continue retry loop
            }
        }

        recovering = false;
        status = Status.disconnected;
        bus.dispatch(`${identifier}:disconnected`);
    }

    /**
     * Connect to a chosen or saved `BluetoothDevice`.
     *
     * @param {any} targetDevice
     * @param {number} token
     */
    async function connectDevice(targetDevice, token) {
        clearDeviceListener();
        clearCharacteristicListeners();

        device = targetDevice;
        userDisconnected = false;

        const onDisconnected = () => {
            handleGattDisconnected(targetDevice, token);
        };
        targetDevice.addEventListener?.('gattserverdisconnected', onDisconnected);
        disconnectUnsub = () => {
            targetDevice.removeEventListener?.('gattserverdisconnected', onDisconnected);
        };

        if (!targetDevice?.gatt || typeof targetDevice.gatt.connect !== 'function') {
            throw new Error('BluetoothDevice has no GATT server');
        }

        const server = await targetDevice.gatt.connect();
        if (userDisconnected || token !== connectionToken) {
            try { targetDevice.gatt.disconnect?.(); } catch (_) {}
            throw new Error('Connection cancelled');
        }

        const resolvedName = await setupGattServices(targetDevice, server);
        if (userDisconnected || token !== connectionToken) {
            try { targetDevice.gatt.disconnect?.(); } catch (_) {}
            throw new Error('Connection cancelled');
        }

        status = Status.connected;
        bus.dispatch(`${identifier}:name`, resolvedName);
        bus.dispatch(`${identifier}:connected`);
        bus.dispatch('sensor:connected', {
            identifier,
            id: targetDevice.id ?? resolvedName,
            name: resolvedName,
        });

        if (controllable) {
            await applyCurrentControlTarget();
        }

        return true;
    }

    /**
     * Disconnect intentionally (cancel connecting or disconnect active GATT link).
     */
    function disconnect() {
        userDisconnected = true;
        recovering = false;
        connectionToken += 1;
        clearDeviceListener();
        clearCharacteristicListeners();

        const current = device;
        device = null;
        if (current?.gatt?.connected && typeof current.gatt.disconnect === 'function') {
            try { current.gatt.disconnect(); } catch (_) {}
        }

        status = Status.disconnected;
        bus.dispatch(`${identifier}:disconnected`);
    }

    /**
     * Interactive chooser flow (`ui:<identifier>:switch`).
     */
    async function toggleSwitch() {
        if (status === Status.connected || status === Status.connecting) {
            disconnect();
            return false;
        }

        const bt = getBluetooth();
        if (!bt || typeof bt.requestDevice !== 'function') {
            status = Status.disconnected;
            bus.dispatch(`${identifier}:disconnected`);
            return false;
        }

        const token = ++connectionToken;
        userDisconnected = false;
        status = Status.connecting;
        bus.dispatch(`${identifier}:connecting`);

        try {
            const chosen = await bt.requestDevice(filter);
            if (userDisconnected || token !== connectionToken || !chosen) {
                status = Status.disconnected;
                bus.dispatch(`${identifier}:disconnected`);
                return false;
            }
            await connectDevice(chosen, token);
            return true;
        } catch (_) {
            if (token === connectionToken) {
                status = Status.disconnected;
                bus.dispatch(`${identifier}:disconnected`);
            }
            return false;
        }
    }

    /**
     * Silent saved-device reconnect flow (`ui:<identifier>:reconnect`).
     *
     * @param {string} savedDeviceId
     */
    async function reconnectById(savedDeviceId) {
        if (!savedDeviceId) {
            bus.dispatch('sensor:reconnect-result', { identifier, ok: false });
            return false;
        }

        if (status === Status.connected && device?.id === savedDeviceId) {
            bus.dispatch('sensor:reconnect-result', { identifier, ok: true });
            return true;
        }

        const bt = getBluetooth();
        if (!bt || typeof bt.getDevices !== 'function') {
            bus.dispatch('sensor:reconnect-result', { identifier, ok: false });
            return false;
        }

        let permittedDevices = [];
        try {
            permittedDevices = await bt.getDevices();
        } catch (_) {
            bus.dispatch('sensor:reconnect-result', { identifier, ok: false });
            return false;
        }

        const matched = Array.isArray(permittedDevices)
            ? permittedDevices.find(d => d && d.id === savedDeviceId)
            : null;

        if (!matched) {
            bus.dispatch('sensor:reconnect-result', { identifier, ok: false });
            return false;
        }

        const token = ++connectionToken;
        userDisconnected = false;
        status = Status.connecting;
        bus.dispatch(`${identifier}:connecting`);

        try {
            await connectDevice(matched, token);
            bus.dispatch('sensor:reconnect-result', { identifier, ok: true });
            return true;
        } catch (_) {
            if (token === connectionToken) {
                status = Status.disconnected;
                bus.dispatch(`${identifier}:disconnected`);
            }
            bus.dispatch('sensor:reconnect-result', { identifier, ok: false });
            return false;
        }
    }

    // Subscriptions
    bus.sub(`ui:${identifier}:switch`, () => {
        toggleSwitch();
    }, signal);

    bus.sub(`ui:${identifier}:reconnect`, savedId => {
        reconnectById(savedId);
    }, signal);

    if (controllable) {
        bus.sub('db:mode', nextMode => {
            if (typeof nextMode === 'string') {
                mode = nextMode;
                if (mode !== ControlMode.erg) {
                    powerMatchOffset = 0;
                    powerMatchActive = false;
                }
                applyCurrentControlTarget();
            }
        }, signal);

        bus.sub('db:powerTarget', nextTarget => {
            powerTarget = Number.isFinite(nextTarget) ? nextTarget : 0;
            if (mode === ControlMode.erg) {
                applyCurrentControlTarget();
            }
        }, signal);

        bus.sub('power-match:offset', payload => {
            if (!payload || typeof payload !== 'object') return;
            powerMatchOffset = Number.isFinite(payload.offset) ? payload.offset : 0;
            powerMatchActive = Boolean(payload.active);
            if (mode === ControlMode.erg) {
                applyCurrentControlTarget();
            }
        }, signal);

        bus.sub('db:resistanceTarget', nextResistance => {
            resistanceTarget = Number.isFinite(nextResistance) ? nextResistance : 0;
            if (mode === ControlMode.resistance) {
                applyCurrentControlTarget();
            }
        }, signal);

        bus.sub('db:slopeTarget', nextSlope => {
            slopeTarget = Number.isFinite(nextSlope) ? nextSlope : 0;
            if (mode === ControlMode.sim) {
                applyCurrentControlTarget();
            }
        }, signal);

        bus.sub('ui:trainer:reset', () => {
            resetTrainer();
        }, signal);
    }

    function stop() {
        if (status !== Status.disconnected) {
            disconnect();
        }
        abortController.abort();
    }

    return Object.freeze({
        identifier,
        getStatus: () => status,
        getDevice: () => device,
        toggleSwitch,
        reconnectById,
        disconnect,
        applyCurrentControlTarget,
        resetTrainer,
        stop,
    });
}

export {
    writeCharacteristic,
    createBleSession,
};
