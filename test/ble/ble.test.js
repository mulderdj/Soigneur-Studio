/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import {
    decodeIndoorBikeData,
    encodeRequestControl,
    encodeTargetPower,
    encodeIndoorBikeSimulation,
} from '../../src/ble/protocols/ftms.js';
import { decodeHeartRateMeasurement } from '../../src/ble/protocols/heart-rate.js';
import { decodeBatteryLevel } from '../../src/ble/protocols/battery.js';
import { decodeOpenBikeControlButtonState, OpenBikeControl } from '../../src/ble/obc/controls.js';
import { ControlMode } from '../../src/ble/enums.js';

describe('Clean-room BLE protocol decoders & encoders', () => {
    test('FTMS Indoor Bike Data decodes speed, cadence, power, and HR', () => {
        // flags: bit0=0 (instantaneous speed present), bit2=1 (cadence), bit6=1 (power), bit9=1 (HR)
        const flags = (1 << 2) | (1 << 6) | (1 << 9);
        const buf = new ArrayBuffer(10);
        const dv = new DataView(buf);
        dv.setUint16(0, flags, true);
        dv.setUint16(2, 3250, true); // 32.50 km/h
        dv.setUint16(4, 180, true);  // 90.0 rpm (0.5 resolution)
        dv.setInt16(6, 245, true);   // 245 W
        dv.setUint8(8, 154);         // 154 bpm

        const out = decodeIndoorBikeData(dv);
        expect(out.speed).toBeCloseTo(32.5 / 3.6, 2);
        expect(out.cadence).toBe(90);
        expect(out.power).toBe(245);
        expect(out.heartRate).toBe(154);
    });

    test('FTMS Control Point encodes Request Control, Target Power, and Simulation', () => {
        const req = encodeRequestControl();
        expect(req[0]).toBe(0x00);

        const pwrBytes = encodeTargetPower(250);
        const pwr = new DataView(pwrBytes.buffer, pwrBytes.byteOffset, pwrBytes.byteLength);
        expect(pwr.getUint8(0)).toBe(0x05);
        expect(pwr.getInt16(1, true)).toBe(250);

        const simBytes = encodeIndoorBikeSimulation({ grade: 5.5 });
        const sim = new DataView(simBytes.buffer, simBytes.byteOffset, simBytes.byteLength);
        expect(sim.getUint8(0)).toBe(0x11);
        expect(sim.getInt16(3, true)).toBe(550);
    });

    test('Heart Rate Measurement decodes 8-bit BPM and RR intervals', () => {
        const buf = new ArrayBuffer(4);
        const dv = new DataView(buf);
        dv.setUint8(0, 0x10); // bit 4 = RR-Interval present, 8-bit HR
        dv.setUint8(1, 148);
        dv.setUint16(2, 1024, true); // 1.0 s

        const out = decodeHeartRateMeasurement(dv);
        expect(out.heartRate).toBe(148);
        expect(out.rrIntervals).toEqual([1]);
    });

    test('Battery Level decodes percentage', () => {
        const dv = new DataView(new Uint8Array([87]).buffer);
        expect(decodeBatteryLevel(dv)).toBe(87);
    });

    test('OpenBikeControl decodes button states and dispatches ride actions', () => {
        const msgs = decodeOpenBikeControlButtonState(new Uint8Array([0x01, 0x30, 0x01, 0x35, 0x01]));
        expect(msgs).toEqual([
            { id: 0x30, action: 'increaseDifficulty', state: 'pressed' },
            { id: 0x35, action: 'lap', state: 'pressed' },
        ]);

        const dispatched = [];
        const ac = new AbortController();
        xf.sub('ui:power-target-inc', () => dispatched.push('inc'), { signal: ac.signal });
        xf.sub('ui:watchLap', () => dispatched.push('lap'), { signal: ac.signal });

        const ctrl = OpenBikeControl({ mode: ControlMode.erg, watchStatus: 'started' });
        ctrl.onButtonState(msgs);
        expect(dispatched).toEqual(['inc', 'lap']);

        ctrl.stop();
        ac.abort();
    });
});
