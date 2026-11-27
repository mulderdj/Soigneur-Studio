// @ts-check

const Status = Object.freeze({
    disconnected: 'disconnected',
    connecting: 'connecting',
    connected: 'connected',
    disconnecting: 'disconnecting',
});

const Device = Object.freeze({
    controllable: 'ble:controllable',
    powerMeter: 'ble:powerMeter',
    speedCadenceSensor: 'ble:speedCadenceSensor',
    heartRateMonitor: 'ble:heartRateMonitor',
    smo2: 'ble:smo2',
    coreTemp: 'ble:coreTemp',
    openBikeControl: 'ble:openBikeControl',
    antHrm: 'ant:hrm',
    antControllable: 'ant:controllable',
});

const Metric = Object.freeze({
    power: 'power',
    cadence: 'cadence',
    speed: 'speed',
    heartRate: 'heartRate',
    rrInterval: 'rrInterval',
    smo2: 'smo2',
    thb: 'thb',
    coreBodyTemperature: 'coreBodyTemperature',
    skinTemperature: 'skinTemperature',
    batteryLevel: 'batteryLevel',
});

const Responsibility = Object.freeze({
    control: 'control',
    power: 'power',
    cadence: 'cadence',
    speed: 'speed',
    heartRate: 'heartRate',
    smo2: 'smo2',
    thb: 'thb',
    coreBodyTemperature: 'coreBodyTemperature',
    skinTemperature: 'skinTemperature',
});

const Priority = Object.freeze({
    primary: 1,
    secondary: 2,
    fallback: 3,
});

const ControlMode = Object.freeze({
    erg: 'erg',
    sim: 'sim',
    resistance: 'resistance',
});

export {
    Status,
    Device,
    Metric,
    Responsibility,
    Priority,
    ControlMode,
};
