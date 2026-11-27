// @ts-check
//
// BLE Sensor Registry & Startup Initialization
// Also boots the WebUSB ANT+ device manager (`../ant/devices.js`) so both
// wireless stacks are active whenever `./ble/devices.js` is imported.
//

import { xf as defaultXf } from '../functions.js';
import { Device } from './enums.js';
import { webBle } from './web-ble.js';
import { createBleSession } from './session.js';
import '../ant/devices.js';

/**
 * Create all standard BLE sensor role sessions on an `xf` bus.
 *
 * @param {{
 *   xf?: typeof defaultXf,
 *   bluetooth?: any,
 *   isSource?: (metric: string, identifier: string) => boolean,
 *   reconnectDelaysMs?: number[],
 * }} [options]
 */
function createBleDevices(options = {}) {
    const shared = {
        xf: options.xf ?? defaultXf,
        ...(options.bluetooth !== undefined ? { bluetooth: options.bluetooth } : {}),
        ...(options.isSource !== undefined ? { isSource: options.isSource } : {}),
        ...(options.reconnectDelaysMs !== undefined ? { reconnectDelaysMs: options.reconnectDelaysMs } : {}),
    };

    const controllable = createBleSession({
        ...shared,
        identifier: Device.controllable,
        filter: webBle.controllable,
        controllable: true,
    });

    const powerMeter = createBleSession({
        ...shared,
        identifier: Device.powerMeter,
        filter: webBle.powerMeter,
    });

    const speedCadenceSensor = createBleSession({
        ...shared,
        identifier: Device.speedCadenceSensor,
        filter: webBle.speedCadenceSensor,
    });

    const heartRateMonitor = createBleSession({
        ...shared,
        identifier: Device.heartRateMonitor,
        filter: webBle.heartRateMonitor,
    });

    const smo2 = createBleSession({
        ...shared,
        identifier: Device.smo2,
        filter: webBle.smo2,
    });

    const coreTemp = createBleSession({
        ...shared,
        identifier: Device.coreTemp,
        filter: webBle.coreTemp,
    });

    const openBikeControl = createBleSession({
        ...shared,
        identifier: Device.openBikeControl,
        filter: webBle.openBikeControl,
    });

    const allSessions = [
        controllable,
        powerMeter,
        speedCadenceSensor,
        heartRateMonitor,
        smo2,
        coreTemp,
        openBikeControl,
    ];

    function stop() {
        for (const session of allSessions) {
            session.stop();
        }
    }

    return Object.freeze({
        controllable,
        powerMeter,
        speedCadenceSensor,
        heartRateMonitor,
        smo2,
        coreTemp,
        openBikeControl,
        stop,
    });
}

const devices = createBleDevices();

export {
    createBleDevices,
    devices,
};
