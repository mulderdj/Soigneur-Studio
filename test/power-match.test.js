/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import {
    DEFAULT_DEADBAND_WATTS,
    DEFAULT_MAX_OFFSET_WATTS,
    isExternalPowerActive,
    createPowerMatcher,
    startPowerMatch,
} from '../src/power-match.js';

describe('isExternalPowerActive', () => {
    const valid = {
        enabled: true,
        mode: 'erg',
        target: 240,
        controllableConnected: true,
        powerMeterConnected: true,
        powerSource: 'ble:powerMeter',
        controllableId: 'trainer-1',
        powerMeterId: 'pedals-1',
    };

    test('activates only when enabled in ERG mode with both a trainer and a separate power meter', () => {
        expect(isExternalPowerActive(valid)).toBe(true);
        expect(isExternalPowerActive({ ...valid, enabled: false })).toBe(false);
        expect(isExternalPowerActive({ ...valid, mode: 'sim' })).toBe(false);
        expect(isExternalPowerActive({ ...valid, mode: 'resistance' })).toBe(false);
        expect(isExternalPowerActive({ ...valid, target: 0 })).toBe(false);
    });

    test('never activates when only the controllable trainer is connected (prevents self-feedback)', () => {
        expect(isExternalPowerActive({ ...valid, powerMeterConnected: false })).toBe(false);
        expect(isExternalPowerActive({ ...valid, controllableConnected: false })).toBe(false);
        expect(isExternalPowerActive({ ...valid, powerSource: 'ble:controllable' })).toBe(false);
        expect(isExternalPowerActive({ ...valid, powerSource: 'ant:controllable' })).toBe(false);
    });

    test('never activates if the same physical BLE device was paired as both trainer and power meter', () => {
        expect(isExternalPowerActive({
            ...valid,
            controllableId: 'same-ble-id',
            powerMeterId: 'same-ble-id',
        })).toBe(false);
    });
});

describe('createPowerMatcher', () => {
    test('ignores small discrepancies within the ±2 W deadband', () => {
        const matcher = createPowerMatcher();
        for(let i = 0; i < 20; i++) {
            const res = matcher.update({ target: 200, meterPower: 199, trainerPower: 200, cadence: 90, dt: 1 });
            expect(res.offset).toBe(0);
            expect(res.setpoint).toBe(200);
        }
    });

    test('smoothly converges to positive offset when pedals read lower than trainer, and holds steady once adjusted', () => {
        const matcher = createPowerMatcher({ tauSec: 6 });
        let setpoint = 250;
        let last;

        // Simulate closed-loop trainer where trainer tracks `setpoint` and pedals read 15 W lower
        for(let s = 0; s < 30; s++) {
            const trainerPower = setpoint;
            const meterPower = trainerPower - 15;
            last = matcher.update({ target: 250, meterPower, trainerPower, cadence: 90, dt: 1 });
            setpoint = last.setpoint;
            if(s === 0) {
                // First second is smoothed, never an immediate 15 W jump
                expect(last.offset).toBeLessThan(6);
            }
        }

        expect(last.offset).toBe(15);
        expect(last.setpoint).toBe(265);
        // Actual crank power is now 265 - 15 = 250 W!
    });

    test('smoothly converges when trainer does not stream separate power (target vs external meter)', () => {
        const matcher = createPowerMatcher({ tauSec: 6 });
        let setpoint = 200;
        let last;

        // Closed-loop: trainer holds `setpoint`, crank reads 12 W higher than trainer (`setpoint + 12`)
        for(let s = 0; s < 35; s++) {
            const meterPower = setpoint + 12;
            last = matcher.update({ target: 200, meterPower, cadence: 85, dt: 1 });
            setpoint = last.setpoint;
        }

        expect(last.offset).toBe(-12);
        expect(last.setpoint).toBe(188);
    });

    test('clamps offset strictly to ±40 W and keeps setpoint non-negative', () => {
        const matcher = createPowerMatcher();
        let res;
        for(let s = 0; s < 40; s++) {
            res = matcher.update({ target: 220, meterPower: 140, trainerPower: 220, cadence: 85, dt: 1 });
        }
        expect(res.offset).toBe(DEFAULT_MAX_OFFSET_WATTS);
        expect(res.setpoint).toBe(260);

        matcher.reset();
        for(let s = 0; s < 40; s++) {
            res = matcher.update({ target: 35, meterPower: 130, trainerPower: 35, cadence: 85, dt: 1 });
        }
        expect(res.offset).toBe(-DEFAULT_MAX_OFFSET_WATTS);
        expect(res.setpoint).toBe(0);
    });

    test('pauses adaptation when coasting (cadence === 0 or power < 30 W)', () => {
        const matcher = createPowerMatcher({ tauSec: 5 });
        let settled;
        for(let s = 0; s < 25; s++) {
            settled = matcher.update({ target: 200, meterPower: 186, trainerPower: 200, cadence: 88, dt: 1 });
        }
        expect(settled.offset).toBe(14);

        // Stop pedalling: cadence 0 -> offset stays frozen rather than spiking to +40 W
        for(let s = 0; s < 10; s++) {
            const paused = matcher.update({ target: 200, meterPower: 0, trainerPower: 40, cadence: 0, dt: 1 });
            expect(paused.paused).toBe(true);
            expect(paused.offset).toBe(14);
        }

        // Low power (< 30 W) even with residual cadence -> also paused
        const lowPower = matcher.update({ target: 200, meterPower: 22, trainerPower: 35, cadence: 50, dt: 1 });
        expect(lowPower.paused).toBe(true);
        expect(lowPower.offset).toBe(14);
    });

    test('resets on large interval target jumps while preserving offset on ±10 W manual nudges', () => {
        const matcher = createPowerMatcher({ tauSec: 5 });
        for(let s = 0; s < 25; s++) {
            matcher.update({ target: 200, meterPower: 185, trainerPower: 200, cadence: 90, dt: 1 });
        }
        expect(matcher.getState().offset).toBe(15);

        // +10 W manual nudge keeps learned offset
        const nudged = matcher.update({ target: 210, meterPower: 195, trainerPower: 210, cadence: 90, dt: 1 });
        expect(nudged.offset).toBe(15);
        expect(nudged.setpoint).toBe(225);

        // Interval jump to 320 W resets offset to 0 cleanly
        const jumped = matcher.update({ target: 320, meterPower: 195, trainerPower: 210, cadence: 90, dt: 1 });
        expect(jumped.reset).toBe(true);
        expect(jumped.offset).toBe(0);
        expect(jumped.setpoint).toBe(320);
    });
});

describe('startPowerMatch live xf wiring', () => {
    let clock = 1000;
    let service;
    /** @type {any[]} */
    let offsets;
    /** @type {any[]} */
    let sourceUpdates;

    beforeEach(() => {
        clock = 1000;
        offsets = [];
        sourceUpdates = [];
        service = startPowerMatch({
            xf,
            now: () => clock,
            tauSec: 5,
            deadbandWatts: DEFAULT_DEADBAND_WATTS,
        });
        xf.sub('power-match:offset', p => offsets.push(p));
        xf.sub('sources', s => sourceUpdates.push(s));
    });

    afterEach(() => {
        service?.stop();
    });

    test('never adjusts trainer when only controllable trainer is connected', () => {
        xf.dispatch('db:sources', { sources: { powerMatch: true, power: 'ble:controllable' } });
        xf.dispatch('db:mode', { mode: 'erg' });
        xf.dispatch('db:powerTarget', { powerTarget: 220 });
        xf.dispatch('ble:controllable:connected');
        xf.dispatch('sensor:connected', { identifier: 'ble:controllable', id: 'kickr-1', name: 'KICKR' });

        for(let i = 0; i < 15; i++) {
            clock += 1000;
            xf.dispatch('ble:controllable:power', 200);
        }

        expect(offsets).toHaveLength(0);
        expect(service.getState().active).toBe(false);
    });

    test('matches external BLE power meter against controllable trainer and resets on interval step or disconnect', () => {
        xf.dispatch('ble:controllable:connected');
        xf.dispatch('sensor:connected', { identifier: 'ble:controllable', id: 'kickr-1', name: 'KICKR' });

        xf.dispatch('ble:powerMeter:connected');
        xf.dispatch('sensor:connected', { identifier: 'ble:powerMeter', id: 'assioma-1', name: 'Assioma' });

        // Auto-selects external power meter as active power source on connect
        expect(sourceUpdates).toContainEqual({ power: 'ble:powerMeter' });

        xf.dispatch('db:sources', { sources: { powerMatch: true, power: 'ble:powerMeter' } });
        xf.dispatch('db:mode', { mode: 'erg' });
        xf.dispatch('db:powerTarget', { powerTarget: 250 });
        xf.dispatch('db:cadence', { cadence: 90 });

        for(let i = 0; i < 25; i++) {
            clock += 1000;
            xf.dispatch('ble:controllable:power', 250);
            xf.dispatch('ble:powerMeter:power', 234);
        }

        expect(offsets.length).toBeGreaterThan(0);
        const settled = offsets.at(-1);
        expect(settled.active).toBe(true);
        expect(settled.offset).toBe(16);
        expect(settled.setpoint).toBe(266);

        // Interval transition resets offset back to 0 immediately
        xf.dispatch('watch:step');
        expect(offsets.at(-1)).toMatchObject({ offset: 0, setpoint: 250, active: false });

        // Build offset again, then disconnect external PM -> resets offset and falls back to trainer power source
        for(let i = 0; i < 15; i++) {
            clock += 1000;
            xf.dispatch('ble:controllable:power', 250);
            xf.dispatch('ble:powerMeter:power', 230);
        }
        expect(offsets.at(-1).offset).toBeGreaterThan(10);

        xf.dispatch('ble:powerMeter:disconnected');
        expect(offsets.at(-1)).toMatchObject({ offset: 0, active: false });
        expect(sourceUpdates).toContainEqual({ power: 'ble:controllable' });
    });
});
