// @ts-check
//
// OpenBikeControl (`d273f680-d548-419d-b9d1-fa0472345229` / `d273f681-...`)
// Button State Decoder & Ride/Workout Action Dispatcher
//

import { xf as defaultXf } from '../../functions.js';
import { ControlMode } from '../enums.js';

const OBC_MESSAGE_BUTTON_STATE = 0x01;

const OBC_BUTTON_ACTIONS = Object.freeze({
    0x01: 'shiftUp',
    0x02: 'shiftDown',
    0x03: 'gearSet',
    0x04: 'chainringSet',
    0x05: 'cassetteSet',
    0x10: 'up',
    0x11: 'down',
    0x12: 'left',
    0x13: 'right',
    0x14: 'select',
    0x15: 'back',
    0x16: 'menu',
    0x30: 'increaseDifficulty',
    0x31: 'decreaseDifficulty',
    0x32: 'skipInterval',
    0x33: 'pause',
    0x34: 'resume',
    0x35: 'lap',
    0x36: 'previousInterval',
    0x37: 'uTurn',
    0x38: 'changeMode',
    0x39: 'takeBreak',
});

const ANALOG_SET_ACTIONS = new Set(['gearSet', 'chainringSet', 'cassetteSet']);

/**
 * @param {DataView | ArrayBuffer | ArrayBufferView} input
 * @returns {DataView}
 */
function toDataView(input) {
    if (input instanceof DataView) return input;
    if (ArrayBuffer.isView(input)) {
        return new DataView(input.buffer, input.byteOffset, input.byteLength);
    }
    return new DataView(input);
}

/**
 * Decode an OpenBikeControl Button State (`d273f681-...`) characteristic notification.
 *
 * Format: `[0x01, buttonId_1, state_1, ..., buttonId_N, state_N]`
 *  - For set-position controls (`gearSet`, `chainringSet`, `cassetteSet`):
 *      0x00 -> `released`, 0x01 -> `noop`, 0x02..0xFF -> `value` (`raw - 1`, 1..254)
 *  - For button controls:
 *      0x00 -> `released`, >= 0x01 -> `pressed`
 *
 * @param {DataView | ArrayBuffer | ArrayBufferView} raw
 * @returns {Array<{ id: number, action: string, state: string, value?: number }>}
 */
function decodeOpenBikeControlButtonState(raw) {
    const view = toDataView(raw);
    if (view.byteLength < 3) return [];

    const msgType = view.getUint8(0);
    if (msgType !== OBC_MESSAGE_BUTTON_STATE) return [];

    /** @type {Array<{ id: number, action: string, state: string, value?: number }>} */
    const messages = [];

    for (let offset = 1; offset + 1 < view.byteLength; offset += 2) {
        const id = view.getUint8(offset);
        const stateByte = view.getUint8(offset + 1);
        const action = OBC_BUTTON_ACTIONS[id] ?? `button_${id}`;

        if (ANALOG_SET_ACTIONS.has(action)) {
            if (stateByte === 0x00) {
                messages.push({ id, action, state: 'released' });
            } else if (stateByte === 0x01) {
                messages.push({ id, action, state: 'noop' });
            } else {
                messages.push({ id, action, state: 'value', value: stateByte - 1 });
            }
        } else {
            messages.push({
                id,
                action,
                state: stateByte === 0x00 ? 'released' : 'pressed',
                ...(stateByte >= 0x02 ? { value: stateByte } : {}),
            });
        }
    }

    return messages;
}

/**
 * Cycle trainer control mode `erg -> resistance -> sim -> erg`.
 *
 * @param {string} currentMode
 * @returns {string}
 */
function nextControlMode(currentMode) {
    if (currentMode === ControlMode.erg) return ControlMode.resistance;
    if (currentMode === ControlMode.resistance) return ControlMode.sim;
    return ControlMode.erg;
}

/**
 * Create an OpenBikeControl controller wired to `xf`.
 *
 * @param {{
 *   xf?: typeof defaultXf,
 *   mode?: string,
 *   watchStatus?: string,
 * }} [options]
 */
function OpenBikeControl(options = {}) {
    const bus = options.xf ?? defaultXf;
    const abortController = new AbortController();
    const signal = { signal: abortController.signal };

    let mode = options.mode ?? ControlMode.erg;
    let watchStatus = options.watchStatus ?? 'stopped';

    bus.sub('db:mode', next => {
        if (typeof next === 'string') mode = next;
    }, signal);

    bus.sub('db:watchStatus', next => {
        if (typeof next === 'string') watchStatus = next;
    }, signal);

    function dispatchTargetStep(direction) {
        const suffix = direction > 0 ? 'inc' : 'dec';
        if (mode === ControlMode.resistance) {
            bus.dispatch(`ui:resistance-target-${suffix}`);
        } else if (mode === ControlMode.sim) {
            bus.dispatch(`ui:slope-target-${suffix}`);
        } else {
            bus.dispatch(`ui:power-target-${suffix}`);
        }
    }

    /**
     * @param {{ action?: string, state?: string }} message
     */
    function handleMessage(message) {
        if (!message || message.state !== 'pressed') return;

        switch (message.action) {
            case 'increaseDifficulty':
            case 'up':
                dispatchTargetStep(1);
                break;

            case 'decreaseDifficulty':
            case 'down':
                dispatchTargetStep(-1);
                break;

            case 'lap':
            case 'skipInterval':
                bus.dispatch('ui:watchLap');
                break;

            case 'previousInterval':
            case 'back':
                bus.dispatch('ui:watchBack');
                break;

            case 'pause':
            case 'takeBreak':
                bus.dispatch('ui:watchPause');
                break;

            case 'resume':
                if (watchStatus === 'stopped') {
                    bus.dispatch('ui:watchStart');
                    bus.dispatch('ui:workoutStart');
                } else {
                    bus.dispatch('ui:watchResume');
                }
                break;

            case 'start':
                bus.dispatch('ui:watchStart');
                bus.dispatch('ui:workoutStart');
                break;

            case 'select':
                if (watchStatus === 'stopped') {
                    bus.dispatch('ui:watchStart');
                    bus.dispatch('ui:workoutStart');
                } else if (watchStatus === 'paused') {
                    bus.dispatch('ui:watchResume');
                } else {
                    bus.dispatch('ui:watchPause');
                }
                break;

            case 'changeMode':
                bus.dispatch('ui:mode-set', nextControlMode(mode));
                break;

            default:
                break;
        }
    }

    /**
     * Handle either an already-decoded message array or a raw DataView/TypedArray/ArrayBuffer.
     *
     * @param {any} payload
     */
    function onButtonState(payload) {
        const list = Array.isArray(payload)
            ? payload
            : payload instanceof DataView || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)
                ? decodeOpenBikeControlButtonState(payload)
                : [];

        for (const msg of list) {
            handleMessage(msg);
        }
    }

    bus.sub('ble:openBikeControl:buttonState', onButtonState, signal);

    function stop() {
        abortController.abort();
    }

    return Object.freeze({
        stop,
        handleMessage,
        onButtonState,
        decode: decodeOpenBikeControlButtonState,
    });
}

const openBikeControl = OpenBikeControl();

export {
    OBC_MESSAGE_BUTTON_STATE,
    OBC_BUTTON_ACTIONS,
    decodeOpenBikeControlButtonState,
    nextControlMode,
    OpenBikeControl,
    openBikeControl,
};
