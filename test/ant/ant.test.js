/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import { createAntDevices } from '../../src/ant/devices.js';

function makeFakeDriver() {
    const handlers = new Map();
    return {
        on(ev, fn) { handlers.set(ev, fn); },
        open: jest.fn(async () => { handlers.get('startup')?.(); }),
        close: jest.fn(async () => {}),
    };
}

function makeFakeSensor(eventName) {
    const handlers = new Map();
    return {
        on(ev, fn) { handlers.set(ev, fn); },
        emit(ev, data) { handlers.get(ev)?.(data); },
        attach: jest.fn(async () => {}),
        detach: jest.fn(async () => {}),
        setTargetPower: jest.fn(),
        setBasicResistance: jest.fn(),
        setTrackResistance: jest.fn(),
        eventName,
    };
}

describe('WebUSB ANT+ adapter (web-ant-plus)', () => {
    test('connects ANT+ HRM, dispatches heartRate, and disconnects cleanly', async () => {
        const drv = makeFakeDriver();
        const hrSensor = makeFakeSensor('hbData');
        const lib = {
            USBDriver: {
                createFromPairedDevice: jest.fn(async () => drv),
                createFromNewDevice: jest.fn(async () => drv),
            },
            HeartRateSensor: jest.fn(() => hrSensor),
            FitnessEquipmentSensor: jest.fn(),
        };

        const hrs = [];
        const events = [];
        const ac = new AbortController();
        xf.sub('heartRate', v => hrs.push(v), { signal: ac.signal });
        xf.sub('ant:hrm:connected', () => events.push('connected'), { signal: ac.signal });
        xf.sub('ant:hrm:disconnected', () => events.push('disconnected'), { signal: ac.signal });

        const ant = createAntDevices({
            loadLib: async () => lib,
            isSource: () => true,
        });

        await ant.connectHrm(12345, true);
        hrSensor.emit('hbData', { DeviceID: 12345, ComputedHeartRate: 152 });
        expect(events).toContain('connected');
        expect(hrs).toEqual([152]);

        await ant.disconnectHrm();
        expect(events).toContain('disconnected');
        expect(drv.close).toHaveBeenCalled();

        ant.stop();
        ac.abort();
    });

    test('connects ANT+ FE-C trainer, forwards power/cadence, and sends ERG target power', async () => {
        const drv = makeFakeDriver();
        const feSensor = makeFakeSensor('fitnessData');
        const lib = {
            USBDriver: {
                createFromPairedDevice: jest.fn(async () => drv),
                createFromNewDevice: jest.fn(async () => drv),
            },
            HeartRateSensor: jest.fn(),
            FitnessEquipmentSensor: jest.fn(() => feSensor),
        };

        const powers = [];
        const ac = new AbortController();
        xf.sub('power', v => powers.push(v), { signal: ac.signal });

        const ant = createAntDevices({
            loadLib: async () => lib,
            isSource: () => true,
        });

        await ant.connectControllable(999, true);
        feSensor.emit('fitnessData', { DeviceID: 999, InstantaneousPower: 265, Cadence: 90 });
        expect(powers).toEqual([265]);

        xf.dispatch('db:powerTarget', { powerTarget: 280 });
        expect(feSensor.setTargetPower).toHaveBeenCalledWith(280);

        ant.stop();
        ac.abort();
    });
});
