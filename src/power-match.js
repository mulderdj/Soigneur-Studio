// @ts-check
//
// Power Match
//
// Adjusts a controllable smart trainer's ERG target watts so that actual crank
// or pedal power from a separate external power meter matches the workout/rider
// target, without mutating `db.powerTarget` or feeding back on the trainer's
// own internal power reading.
//

import { xf as defaultXf, clamp } from './functions.js';
import { ControlMode } from './ble/enums.js';

const DEFAULT_TAU_SEC = 6;
const DEFAULT_DEADBAND_WATTS = 2;
const DEFAULT_MAX_OFFSET_WATTS = 40;
const DEFAULT_MIN_POWER_WATTS = 30;
const DEFAULT_TARGET_JUMP_WATTS = 50;
const TRAINER_POWER_STALE_MS = 3500;
const MIN_DISPATCH_INTERVAL_MS = 1500;

/**
 * Determines whether Power Match may actively adjust the controllable trainer.
 *
 * Power Match ONLY activates when:
 *  1. The rider enabled Power Match (`enabled === true`),
 *  2. The trainer is in ERG mode with a positive target (`target > 0`),
 *  3. A controllable trainer is connected (`controllableConnected === true`),
 *  4. A separate power meter is connected (`powerMeterConnected === true`),
 *  5. The active power source is NOT the controllable trainer itself, AND
 *  6. The power meter and controllable trainer do not share the same device ID.
 *
 * @param {{
 *   enabled?: boolean,
 *   mode?: string,
 *   target?: number,
 *   controllableConnected?: boolean,
 *   powerMeterConnected?: boolean,
 *   powerSource?: string,
 *   controllableId?: string | null,
 *   powerMeterId?: string | null,
 * }} state
 * @returns {boolean}
 */
function isExternalPowerActive(state = {}) {
    const {
        enabled = false,
        mode = ControlMode.erg,
        target = 0,
        controllableConnected = false,
        powerMeterConnected = false,
        powerSource = 'ble:powerMeter',
        controllableId = null,
        powerMeterId = null,
    } = state;

    if(!enabled) return false;
    if(mode !== ControlMode.erg) return false;
    if(!(Number.isFinite(target) && target > 0)) return false;
    if(!controllableConnected || !powerMeterConnected) return false;
    if(powerSource === 'ble:controllable' || powerSource === 'ant:controllable') return false;
    if(controllableId && powerMeterId && controllableId === powerMeterId) return false;

    return true;
}

/**
 * Creates a stateful EWMA Power Match controller.
 *
 * When both `trainerPower` and `meterPower` stream separately, the discrepancy
 * `trainerPower - meterPower` directly estimates drivetrain/calibration bias
 * independently of transient cadence changes. When `trainerPower` is not
 * available, `(target + offset) - meterPower` integrates external power error
 * smoothly with the same EWMA time constant.
 *
 * @param {{
 *   tauSec?: number,
 *   deadbandWatts?: number,
 *   maxOffsetWatts?: number,
 *   minPowerWatts?: number,
 *   targetJumpWatts?: number,
 * }} [options]
 */
function createPowerMatcher(options = {}) {
    const tauSec = options.tauSec ?? DEFAULT_TAU_SEC;
    const deadbandWatts = options.deadbandWatts ?? DEFAULT_DEADBAND_WATTS;
    const maxOffsetWatts = options.maxOffsetWatts ?? DEFAULT_MAX_OFFSET_WATTS;
    const minPowerWatts = options.minPowerWatts ?? DEFAULT_MIN_POWER_WATTS;
    const targetJumpWatts = options.targetJumpWatts ?? DEFAULT_TARGET_JUMP_WATTS;

    let ewma = 0;
    let offset = 0;
    let lastTarget = 0;
    let paused = false;
    let samples = 0;

    function reset() {
        ewma = 0;
        offset = 0;
        paused = false;
        samples = 0;
        return {
            offset: 0,
            ewma: 0,
            setpoint: Math.max(0, Math.round(lastTarget)),
            active: false,
            paused: false,
        };
    }

    /**
     * @param {{
     *   target: number,
     *   meterPower: number,
     *   trainerPower?: number | null,
     *   cadence?: number | null,
     *   dt?: number,
     *   active?: boolean,
     * }} sample
     */
    function update(sample) {
        const {
            target,
            meterPower,
            trainerPower = null,
            cadence = null,
            dt = 1,
            active = true,
        } = sample;

        const cleanTarget = Number.isFinite(target) && target > 0 ? target : 0;

        if(!active || cleanTarget === 0) {
            lastTarget = cleanTarget;
            return reset();
        }

        // Reset accumulated bias on interval jumps so previous step offset does not carry over
        if(lastTarget > 0 && Math.abs(cleanTarget - lastTarget) >= targetJumpWatts) {
            lastTarget = cleanTarget;
            reset();
            return {
                offset: 0,
                ewma: 0,
                setpoint: Math.round(cleanTarget),
                active: true,
                paused: false,
                reset: true,
            };
        }

        lastTarget = cleanTarget;

        const cadenceStopped = cadence !== null && cadence !== undefined && cadence <= 0;
        const meterCoasting = !Number.isFinite(meterPower) || meterPower < minPowerWatts;
        const trainerCoasting = trainerPower !== null && trainerPower !== undefined &&
            Number.isFinite(trainerPower) && trainerPower < minPowerWatts;

        if(cadenceStopped || meterCoasting || trainerCoasting) {
            paused = true;
            return {
                offset,
                ewma,
                setpoint: Math.max(0, Math.round(cleanTarget + offset)),
                active: true,
                paused: true,
            };
        }

        paused = false;
        const safeDt = clamp(0.1, 5, Number.isFinite(dt) && dt > 0 ? dt : 1);
        const alpha = 1 - Math.exp(-safeDt / tauSec);

        const hasTrainer = trainerPower !== null && trainerPower !== undefined && Number.isFinite(trainerPower);
        const rawDelta = hasTrainer
            ? trainerPower - meterPower
            : (cleanTarget + offset) - meterPower;

        const boundedDelta = clamp(-maxOffsetWatts * 1.5, maxOffsetWatts * 1.5, rawDelta);
        ewma = clamp(-maxOffsetWatts, maxOffsetWatts, ewma + alpha * (boundedDelta - ewma));
        samples += 1;

        offset = Math.abs(ewma) <= deadbandWatts
            ? 0
            : Math.round(clamp(-maxOffsetWatts, maxOffsetWatts, ewma));

        const setpoint = Math.max(0, Math.round(cleanTarget + offset));

        return {
            offset,
            ewma,
            setpoint,
            active: true,
            paused: false,
        };
    }

    function getState() {
        return {
            offset,
            ewma,
            target: lastTarget,
            setpoint: lastTarget > 0 ? Math.max(0, Math.round(lastTarget + offset)) : 0,
            paused,
            samples,
        };
    }

    return Object.freeze({
        update,
        reset,
        getState,
    });
}

/**
 * Wires Power Match to the app's `xf` event bus.
 *
 * @param {{
 *   xf?: typeof defaultXf,
 *   now?: () => number,
 *   tauSec?: number,
 *   deadbandWatts?: number,
 *   maxOffsetWatts?: number,
 * }} [options]
 */
function startPowerMatch(options = {}) {
    const bus = options.xf ?? defaultXf;
    const now = options.now ?? (() => Date.now());
    const matcher = createPowerMatcher(options);
    const abortController = new AbortController();
    const signal = { signal: abortController.signal };

    let enabled = false;
    let powerSource = 'ble:controllable';
    let mode = ControlMode.erg;
    let target = 0;

    let bleControllable = false;
    let antControllable = false;
    let blePowerMeter = false;

    /** @type {string | null} */
    let controllableId = null;
    /** @type {string | null} */
    let powerMeterId = null;

    /** @type {number | null} */
    let trainerPower = null;
    let trainerPowerAt = 0;

    /** @type {number | null} */
    let cadence = null;
    let hasSeenCadence = false;

    let lastSampleAt = 0;
    let lastDispatchedOffset = 0;
    let lastDispatchAt = 0;

    function controllableConnected() {
        return bleControllable || antControllable;
    }

    function canMatch() {
        return isExternalPowerActive({
            enabled,
            mode,
            target,
            controllableConnected: controllableConnected(),
            powerMeterConnected: blePowerMeter,
            powerSource,
            controllableId,
            powerMeterId,
        });
    }

    function publishOffset(nextOffset, active, force = false) {
        const t = now();
        const delta = Math.abs(nextOffset - lastDispatchedOffset);
        const zeroing = nextOffset === 0 && lastDispatchedOffset !== 0;
        const settledStep = nextOffset !== lastDispatchedOffset && (t - lastDispatchAt) >= MIN_DISPATCH_INTERVAL_MS;

        if(!force && !zeroing && delta < DEFAULT_DEADBAND_WATTS && !settledStep) {
            return;
        }

        lastDispatchedOffset = nextOffset;
        lastDispatchAt = t;
        bus.dispatch('power-match:offset', {
            offset: nextOffset,
            target,
            setpoint: target > 0 ? Math.max(0, Math.round(target + nextOffset)) : 0,
            active,
        });
    }

    function resetOffset() {
        matcher.reset();
        lastSampleAt = 0;
        if(lastDispatchedOffset !== 0) {
            publishOffset(0, false, true);
        }
    }

    function autoSelectPowerSourceOnConnect() {
        if(!blePowerMeter) return;
        if(controllableId && powerMeterId && controllableId === powerMeterId) return;
        if(powerSource === 'ble:controllable') {
            bus.dispatch('sources', { power: 'ble:powerMeter' });
        }
    }

    bus.sub('db:sources', sources => {
        if(!sources) return;
        enabled = Boolean(sources.powerMatch);
        powerSource = sources.power ?? powerSource;
        if(!canMatch()) {
            resetOffset();
        }
    }, signal);

    bus.sub('db:mode', nextMode => {
        mode = nextMode;
        if(mode !== ControlMode.erg) {
            resetOffset();
        }
    }, signal);

    bus.sub('db:powerTarget', nextTarget => {
        const prev = target;
        target = Number.isFinite(nextTarget) ? nextTarget : 0;
        if(target <= 0 || (prev > 0 && Math.abs(target - prev) >= DEFAULT_TARGET_JUMP_WATTS)) {
            resetOffset();
        }
    }, signal);

    bus.sub('db:cadence', nextCadence => {
        if(Number.isFinite(nextCadence)) {
            cadence = nextCadence;
            if(nextCadence > 0) hasSeenCadence = true;
        }
    }, signal);

    bus.sub('sensor:connected', info => {
        if(!info) return;
        if(info.identifier === 'ble:controllable') {
            controllableId = info.id ?? null;
        }
        if(info.identifier === 'ble:powerMeter') {
            powerMeterId = info.id ?? null;
            autoSelectPowerSourceOnConnect();
        }
        if(!canMatch()) resetOffset();
    }, signal);

    bus.sub('ble:controllable:connected', () => {
        bleControllable = true;
    }, signal);

    bus.sub('ble:controllable:disconnected', () => {
        bleControllable = false;
        controllableId = null;
        trainerPower = null;
        resetOffset();
    }, signal);

    bus.sub('ant:controllable:connected', () => {
        antControllable = true;
    }, signal);

    bus.sub('ant:controllable:disconnected', () => {
        antControllable = false;
        trainerPower = null;
        resetOffset();
    }, signal);

    bus.sub('ble:powerMeter:connected', () => {
        blePowerMeter = true;
        autoSelectPowerSourceOnConnect();
    }, signal);

    bus.sub('ble:powerMeter:disconnected', () => {
        blePowerMeter = false;
        powerMeterId = null;
        resetOffset();
        if(powerSource === 'ble:powerMeter' && controllableConnected()) {
            bus.dispatch('sources', { power: 'ble:controllable' });
        }
    }, signal);

    bus.sub('ble:speedCadenceSensor:disconnected', () => {
        hasSeenCadence = false;
        cadence = null;
    }, signal);

    bus.sub('ble:controllable:power', watts => {
        if(Number.isFinite(watts)) {
            trainerPower = watts;
            trainerPowerAt = now();
        }
    }, signal);

    bus.sub('ant:controllable:power', watts => {
        if(Number.isFinite(watts)) {
            trainerPower = watts;
            trainerPowerAt = now();
        }
    }, signal);

    bus.sub('ble:powerMeter:power', meterPower => {
        if(!canMatch()) {
            resetOffset();
            return;
        }
        const t = now();
        const dt = lastSampleAt > 0 ? (t - lastSampleAt) / 1000 : 1;
        lastSampleAt = t;

        const freshTrainerPower = trainerPower !== null && (t - trainerPowerAt) <= TRAINER_POWER_STALE_MS
            ? trainerPower
            : null;

        const result = matcher.update({
            target,
            meterPower,
            trainerPower: freshTrainerPower,
            cadence: hasSeenCadence ? cadence : null,
            dt,
            active: true,
        });

        publishOffset(result.offset, result.active);
    }, signal);

    for(const evt of ['watch:step', 'watch:intervalIndex', 'workout:started', 'workout:stopped', 'watch:stopped']) {
        bus.sub(evt, () => {
            if(evt === 'watch:stopped') {
                hasSeenCadence = false;
                cadence = null;
            }
            resetOffset();
        }, signal);
    }

    function stop() {
        resetOffset();
        abortController.abort();
    }

    return Object.freeze({
        stop,
        getState: () => ({
            ...matcher.getState(),
            active: canMatch(),
            lastDispatchedOffset,
        }),
    });
}

export {
    DEFAULT_TAU_SEC,
    DEFAULT_DEADBAND_WATTS,
    DEFAULT_MAX_OFFSET_WATTS,
    DEFAULT_MIN_POWER_WATTS,
    DEFAULT_TARGET_JUMP_WATTS,
    isExternalPowerActive,
    createPowerMatcher,
    startPowerMatch,
};
