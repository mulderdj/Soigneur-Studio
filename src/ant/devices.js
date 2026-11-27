// @ts-check
//
// WebUSB ANT+ device controller powered by `web-ant-plus` (MIT).
// Manages a shared ANT+ USB stick (Garmin USB2/USB3) and attaches ANT+
// Heart Rate (`ant:hrm`) and FE-C Smart Trainer (`ant:controllable`) channels
// onto the Soigneur Studio `xf` event bus.
//

import { xf as defaultXf } from '../functions.js';
import { models } from '../models/models.js';
import { ControlMode } from '../ble/enums.js';

/**
 * Lazy-load `web-ant-plus` in the browser (Vite bundles it cleanly; lazy import
 * keeps non-ANT+ startup light and allows clean dependency injection in tests).
 * @returns {Promise<any>}
 */
async function loadAntPlus() {
    return import('web-ant-plus');
}

/**
 * Create an ANT+ device manager bound to `xf`.
 * @param {{
 *   xf?: typeof defaultXf,
 *   loadLib?: () => Promise<any>,
 *   isSource?: (metric: string, id: string) => boolean,
 * }} [options]
 */
function createAntDevices(options = {}) {
    const bus = options.xf ?? defaultXf;
    const loadLib = options.loadLib ?? loadAntPlus;
    const isSource = options.isSource ?? ((m, id) => models.sources.isSource(m, id));

    /** @type {any} */
    let stick = null;
    /** @type {boolean} */
    let stickReady = false;
    /** @type {Promise<any> | null} */
    let stickOpening = null;

    /** @type {any} */
    let hrmSensor = null;
    let hrmConnected = false;

    /** @type {any} */
    let feSensor = null;
    let feConnected = false;
    /** @type {string} */
    let mode = ControlMode.erg;
    let lastPowerTarget = 0;
    let powerMatchOffset = 0;

    const ac = new AbortController();
    const signal = { signal: ac.signal };

    async function ensureStick(interactive = true) {
        if(stick && stickReady) return stick;
        if(stickOpening) return stickOpening;

        stickOpening = (async () => {
            const lib = await loadLib();
            const USBDriver = lib.USBDriver;
            if(!USBDriver) throw new Error('WebUSB ANT+ driver unavailable');

            let drv = await USBDriver.createFromPairedDevice?.();
            if(!drv && interactive) {
                drv = await USBDriver.createFromNewDevice();
            }
            if(!drv) throw new Error('No ANT+ USB stick paired');

            stick = drv;
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('ANT+ stick startup timed out')), 8000);
                drv.on('startup', () => {
                    clearTimeout(timer);
                    stickReady = true;
                    resolve(drv);
                });
                Promise.resolve(drv.open()).catch(err => {
                    clearTimeout(timer);
                    reject(err);
                });
            });
            return stick;
        })();

        try {
            return await stickOpening;
        } catch(err) {
            stick = null;
            stickReady = false;
            throw err;
        } finally {
            stickOpening = null;
        }
    }

    async function closeStickIfIdle() {
        if(hrmSensor || feSensor || !stick) return;
        try { await stick.close?.(); } catch(_) {}
        stick = null;
        stickReady = false;
    }

    // --- ANT+ Heart Rate (`ant:hrm`) ---

    async function connectHrm(deviceId = 0, interactive = true) {
        if(hrmSensor) return true;
        bus.dispatch('ant:hrm:connecting');
        try {
            const drv = await ensureStick(interactive);
            const lib = await loadLib();
            const sensor = new lib.HeartRateSensor(drv);
            hrmSensor = sensor;

            sensor.on('hbData', (/** @type {any} */ data) => {
                if(!hrmConnected) {
                    hrmConnected = true;
                    const devId = String(data?.DeviceID ?? deviceId ?? 'ant-hrm');
                    const name = data?.DeviceID ? `ANT+ HRM ${data.DeviceID}` : 'ANT+ HRM';
                    bus.dispatch('ant:hrm:connected');
                    bus.dispatch('ant:hrm:name', name);
                    bus.dispatch('sensor:connected', { identifier: 'ant:hrm', id: devId, name });
                }
                const hr = data?.ComputedHeartRate;
                if(Number.isFinite(hr) && hr > 0 && isSource('heartRate', 'ant:hrm')) {
                    bus.dispatch('heartRate', hr);
                }
            });

            await sensor.attach(0, Number(deviceId) || 0);
            return true;
        } catch(err) {
            console.warn(':ant :hrm connect failed', err);
            hrmSensor = null;
            hrmConnected = false;
            bus.dispatch('ant:hrm:disconnected');
            bus.dispatch('ant:hrm:name', '--');
            return false;
        }
    }

    async function disconnectHrm() {
        if(hrmSensor) {
            try { await hrmSensor.detach?.(); } catch(_) {}
            hrmSensor = null;
        }
        hrmConnected = false;
        bus.dispatch('ant:hrm:disconnected');
        bus.dispatch('ant:hrm:name', '--');
        if(isSource('heartRate', 'ant:hrm')) bus.dispatch('heartRate', 0);
        await closeStickIfIdle();
    }

    // --- ANT+ FE-C Smart Trainer (`ant:controllable`) ---

    async function connectControllable(deviceId = 0, interactive = true) {
        if(feSensor) return true;
        bus.dispatch('ant:controllable:connecting');
        try {
            const drv = await ensureStick(interactive);
            const lib = await loadLib();
            const sensor = new lib.FitnessEquipmentSensor(drv);
            feSensor = sensor;

            sensor.on('fitnessData', (/** @type {any} */ data) => {
                if(!feConnected) {
                    feConnected = true;
                    const devId = String(data?.DeviceID ?? deviceId ?? 'ant-fec');
                    const name = data?.DeviceID ? `ANT+ FE-C ${data.DeviceID}` : 'ANT+ Trainer';
                    bus.dispatch('ant:controllable:connected');
                    bus.dispatch('ant:controllable:name', name);
                    bus.dispatch('sensor:connected', { identifier: 'ant:controllable', id: devId, name });
                }
                if(Number.isFinite(data?.InstantaneousPower)) {
                    bus.dispatch('ant:controllable:power', data.InstantaneousPower);
                    if(isSource('power', 'ant:controllable')) bus.dispatch('power', data.InstantaneousPower);
                }
                if(Number.isFinite(data?.Cadence) && isSource('cadence', 'ant:controllable')) {
                    bus.dispatch('cadence', data.Cadence);
                }
                if(Number.isFinite(data?.VirtualSpeed) && isSource('speed', 'ant:controllable')) {
                    bus.dispatch('speed', data.VirtualSpeed);
                } else if(Number.isFinite(data?.RealSpeed) && isSource('speed', 'ant:controllable')) {
                    bus.dispatch('speed', data.RealSpeed);
                }
                if(Number.isFinite(data?.HeartRate) && data.HeartRate > 0 && isSource('heartRate', 'ant:controllable')) {
                    bus.dispatch('heartRate', data.HeartRate);
                }
            });

            await sensor.attach(1, Number(deviceId) || 0);
            return true;
        } catch(err) {
            console.warn(':ant :controllable connect failed', err);
            feSensor = null;
            feConnected = false;
            bus.dispatch('ant:controllable:disconnected');
            bus.dispatch('ant:controllable:name', '--');
            return false;
        }
    }

    async function disconnectControllable() {
        powerMatchOffset = 0;
        if(feSensor) {
            try { await feSensor.detach?.(); } catch(_) {}
            feSensor = null;
        }
        feConnected = false;
        bus.dispatch('ant:controllable:disconnected');
        bus.dispatch('ant:controllable:name', '--');
        if(isSource('power', 'ant:controllable')) bus.dispatch('power', 0);
        if(isSource('cadence', 'ant:controllable')) bus.dispatch('cadence', 0);
        if(isSource('speed', 'ant:controllable')) bus.dispatch('speed', 0);
        await closeStickIfIdle();
    }

    function sendPowerTarget(watts) {
        if(!feSensor || !feConnected || mode !== ControlMode.erg) return;
        const adjusted = watts > 0 ? Math.max(0, Math.round(watts + powerMatchOffset)) : 0;
        feSensor.setTargetPower?.(adjusted);
    }

    // Event subscriptions
    bus.sub('ui:ant:hrm:switch', () => {
        if(hrmSensor) disconnectHrm();
        else connectHrm(0, true);
    }, signal);

    bus.sub('ui:ant:hrm:reconnect', async (deviceId) => {
        const ok = await connectHrm(Number(deviceId) || 0, false);
        bus.dispatch('sensor:reconnect-result', { identifier: 'ant:hrm', ok });
    }, signal);

    bus.sub('ui:ant:controllable:switch', () => {
        if(feSensor) disconnectControllable();
        else connectControllable(0, true);
    }, signal);

    bus.sub('ui:ant:controllable:reconnect', async (deviceId) => {
        const ok = await connectControllable(Number(deviceId) || 0, false);
        bus.dispatch('sensor:reconnect-result', { identifier: 'ant:controllable', ok });
    }, signal);

    bus.sub('db:mode', m => { mode = m; }, signal);
    bus.sub('db:powerTarget', w => {
        lastPowerTarget = w;
        sendPowerTarget(w);
    }, signal);
    bus.sub('power-match:offset', payload => {
        powerMatchOffset = Number.isFinite(payload?.offset) ? payload.offset : 0;
        if(lastPowerTarget > 0) sendPowerTarget(lastPowerTarget);
    }, signal);
    bus.sub('db:resistanceTarget', r => {
        if(feSensor && feConnected && mode === ControlMode.resistance) {
            feSensor.setBasicResistance?.(r);
        }
    }, signal);
    bus.sub('db:slopeTarget', grade => {
        if(feSensor && feConnected && mode === ControlMode.sim) {
            feSensor.setTrackResistance?.(grade);
        }
    }, signal);

    return Object.freeze({
        connectHrm,
        disconnectHrm,
        connectControllable,
        disconnectControllable,
        stop() {
            ac.abort();
            disconnectHrm();
            disconnectControllable();
        },
    });
}

const antDevices = createAntDevices();

export { createAntDevices, antDevices };
