// @ts-check

const BLE_BASE_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/**
 * Expand a 16-bit or 32-bit Bluetooth SIG assigned number into a lowercase 128-bit UUID.
 *
 * @param {number | string} assigned
 * @returns {string}
 */
function bleUuid(assigned) {
    if (typeof assigned === 'number') {
        return `${assigned.toString(16).padStart(8, '0').toLowerCase()}${BLE_BASE_SUFFIX}`;
    }
    const clean = String(assigned).trim().toLowerCase().replace(/^0x/, '');
    if (clean.includes('-')) return clean;
    return `${clean.padStart(8, '0')}${BLE_BASE_SUFFIX}`;
}

/**
 * Normalize any 16-bit integer or UUID string into canonical lowercase 128-bit form.
 *
 * @param {number | string} uuid
 * @returns {string}
 */
function normalizeUuid(uuid) {
    return bleUuid(uuid);
}

const ServiceUUIDs = Object.freeze({
    genericAccess: bleUuid(0x1800),
    genericAttribute: bleUuid(0x1801),
    deviceInformation: bleUuid(0x180a),
    heartRate: bleUuid(0x180d),
    battery: bleUuid(0x180f),
    cyclingSpeedCadence: bleUuid(0x1816),
    cyclingPower: bleUuid(0x1818),
    userData: bleUuid(0x181c),
    fitnessMachine: bleUuid(0x1826),
    fec: '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
    smo2: '6404d801-4cb9-11e8-b566-0800200c9a66',
    coreTemp: '00002100-5b1e-4347-b07c-97b514dae121',
    openBikeControl: 'd273f680-d548-419d-b9d1-fa0472345229',
});

const CharacteristicUUIDs = Object.freeze({
    deviceName: bleUuid(0x2a00),
    batteryLevel: bleUuid(0x2a19),
    modelNumber: bleUuid(0x2a24),
    serialNumber: bleUuid(0x2a25),
    firmwareRevision: bleUuid(0x2a26),
    hardwareRevision: bleUuid(0x2a27),
    manufacturerName: bleUuid(0x2a29),
    heartRateMeasurement: bleUuid(0x2a37),
    bodySensorLocation: bleUuid(0x2a38),
    cscMeasurement: bleUuid(0x2a5b),
    cscFeature: bleUuid(0x2a5c),
    cyclingPowerMeasurement: bleUuid(0x2a63),
    cyclingPowerFeature: bleUuid(0x2a65),
    cyclingPowerControlPoint: bleUuid(0x2a66),
    fitnessMachineFeature: bleUuid(0x2acc),
    indoorBikeData: bleUuid(0x2ad2),
    supportedResistanceLevelRange: bleUuid(0x2ad6),
    supportedPowerRange: bleUuid(0x2ad8),
    fitnessMachineControlPoint: bleUuid(0x2ad9),
    fitnessMachineStatus: bleUuid(0x2ada),
    fecNotify: '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
    fecWrite: '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e',
    smo2Measurement: '6404d804-4cb9-11e8-b566-0800200c9a66',
    coreTempMeasurement: '00002101-5b1e-4347-b07c-97b514dae121',
    openBikeControlButtonState: 'd273f681-d548-419d-b9d1-fa0472345229',
    openBikeControlAppState: 'd273f682-d548-419d-b9d1-fa0472345229',
});

/** @type {Readonly<Record<string, string>>} */
const UUID_NAMES = Object.freeze({
    [ServiceUUIDs.genericAccess]: 'Generic Access',
    [ServiceUUIDs.genericAttribute]: 'Generic Attribute',
    [ServiceUUIDs.deviceInformation]: 'Device Information',
    [ServiceUUIDs.heartRate]: 'Heart Rate',
    [ServiceUUIDs.battery]: 'Battery Service',
    [ServiceUUIDs.cyclingSpeedCadence]: 'Cycling Speed and Cadence',
    [ServiceUUIDs.cyclingPower]: 'Cycling Power',
    [ServiceUUIDs.userData]: 'User Data',
    [ServiceUUIDs.fitnessMachine]: 'Fitness Machine',
    [ServiceUUIDs.fec]: 'ANT+ FE-C over BLE',
    [ServiceUUIDs.smo2]: 'Moxy Muscle Oxygen',
    [ServiceUUIDs.coreTemp]: 'CORE Body Temperature',
    [ServiceUUIDs.openBikeControl]: 'OpenBikeControl',
    [CharacteristicUUIDs.deviceName]: 'Device Name',
    [CharacteristicUUIDs.batteryLevel]: 'Battery Level',
    [CharacteristicUUIDs.manufacturerName]: 'Manufacturer Name',
    [CharacteristicUUIDs.modelNumber]: 'Model Number',
    [CharacteristicUUIDs.firmwareRevision]: 'Firmware Revision',
    [CharacteristicUUIDs.heartRateMeasurement]: 'Heart Rate Measurement',
    [CharacteristicUUIDs.cscMeasurement]: 'CSC Measurement',
    [CharacteristicUUIDs.cyclingPowerMeasurement]: 'Cycling Power Measurement',
    [CharacteristicUUIDs.cyclingPowerControlPoint]: 'Cycling Power Control Point',
    [CharacteristicUUIDs.fitnessMachineFeature]: 'Fitness Machine Feature',
    [CharacteristicUUIDs.indoorBikeData]: 'Indoor Bike Data',
    [CharacteristicUUIDs.supportedResistanceLevelRange]: 'Supported Resistance Level Range',
    [CharacteristicUUIDs.supportedPowerRange]: 'Supported Power Range',
    [CharacteristicUUIDs.fitnessMachineControlPoint]: 'Fitness Machine Control Point',
    [CharacteristicUUIDs.fitnessMachineStatus]: 'Fitness Machine Status',
    [CharacteristicUUIDs.fecNotify]: 'FE-C Notify',
    [CharacteristicUUIDs.fecWrite]: 'FE-C Write',
    [CharacteristicUUIDs.smo2Measurement]: 'Moxy SmO2 Measurement',
    [CharacteristicUUIDs.coreTempMeasurement]: 'CORE Temperature Measurement',
    [CharacteristicUUIDs.openBikeControlButtonState]: 'OpenBikeControl Button State',
    [CharacteristicUUIDs.openBikeControlAppState]: 'OpenBikeControl App State',
});

/**
 * Look up a human-readable service/characteristic name from its UUID.
 *
 * @param {number | string} uuid
 * @returns {string}
 */
function uuidToName(uuid) {
    if (uuid === undefined || uuid === null || uuid === '') return 'Unknown';
    const key = normalizeUuid(uuid);
    return UUID_NAMES[key] ?? key;
}

export {
    BLE_BASE_SUFFIX,
    bleUuid,
    normalizeUuid,
    ServiceUUIDs,
    CharacteristicUUIDs,
    UUID_NAMES,
    uuidToName,
};
