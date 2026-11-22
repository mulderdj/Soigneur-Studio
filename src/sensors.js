//
// Saved sensors
//
// Remembers the last Bluetooth device used for each role (trainer, heart
// rate, power meter, ...) for the current rider on this device, and can
// reconnect them without Chrome's device chooser.
//
// Reconnecting needs navigator.bluetooth.getDevices(), which Chrome only
// offers with persistent Web Bluetooth permissions enabled
// (chrome://flags/#enable-web-bluetooth-new-permissions-backend). Without it
// saved sensors are still listed, and connecting falls back to the chooser.
//

import { xf } from './functions.js';
import { riders } from './riders.js';

const ROLES = {
    'ble:controllable':       'Trainer',
    'ble:heartRateMonitor':   'Heart rate',
    'ble:powerMeter':         'Power meter',
    'ble:speedCadenceSensor': 'Speed / cadence',
    'ble:smo2':               'Moxy',
    'ble:coreTemp':           'Core temperature',
    'ble:openBikeControl':    'Bike controls',
};

const FLAG_URL = 'chrome://flags/#enable-web-bluetooth-new-permissions-backend';

function read() {
    try {
        return JSON.parse(localStorage.getItem(riders.key('sensors'))) ?? {devices: {}, auto: true};
    } catch(e) {
        return {devices: {}, auto: true};
    }
}

function write(state) {
    try { localStorage.setItem(riders.key('sensors'), JSON.stringify(state)); } catch(e) {}
    xf.dispatch('sensors:changed', state);
}

function canReconnect() {
    return typeof navigator !== 'undefined' && typeof navigator.bluetooth?.getDevices === 'function';
}

function list() {
    const {devices} = read();
    return Object.entries(devices)
        .filter(([identifier]) => identifier in ROLES)
        .map(([identifier, d]) => ({identifier, role: ROLES[identifier], ...d}));
}

function forget(identifier) {
    const state = read();
    delete state.devices[identifier];
    write(state);
}

function forgetAll() {
    const state = read();
    state.devices = {};
    write(state);
}

function setAuto(auto) {
    const state = read();
    state.auto = !!auto;
    write(state);
}

function isAuto() {
    return read().auto !== false;
}

// asks each saved role to reconnect; results arrive as 'sensor:reconnect-result'
function reconnectAll() {
    if(!canReconnect()) return false;
    list().forEach(d => xf.dispatch(`ui:${d.identifier}:reconnect`, d.id));
    return true;
}

xf.sub('sensor:connected', ({identifier, id, name}) => {
    if(!(identifier in ROLES) || !id) return;
    const state = read();
    state.devices[identifier] = {id, name: name || 'Unknown', savedAt: Date.now()};
    write(state);
});

xf.sub('app:start', () => {
    if(isAuto() && list().length > 0) {
        // give the views a moment to subscribe to connection events
        setTimeout(reconnectAll, 800);
    }
});

const sensors = {
    ROLES,
    FLAG_URL,
    list,
    forget,
    forgetAll,
    setAuto,
    isAuto,
    canReconnect,
    reconnectAll,
};

export { sensors };
