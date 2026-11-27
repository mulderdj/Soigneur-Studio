// @ts-check
import { equals, exists, xf } from './functions.js';

const notes = [
    {}, // 0
    {}, // 1
    {}, // 2
    {c: 130.81, 'c#': 138.59, d: 146.83, 'd#': 155.56, e: 164.81, f: 174.61,
     'f#': 185.00, g: 196.00, 'g#': 207.65, a: 220.00, 'a#': 233.08, b: 246.94}, // 3

    {c: 261.63, 'c#': 277.18, d: 293.66, 'd#': 311.13, e: 329.63, f: 349.23,
     'f#': 369.99, g: 392.00, 'g#': 415.30, a: 440.00, 'a#': 466.16, b: 493.88}, // 4

    {c: 523.25, 'c#': 554.37, d: 587.33, 'd#': 622.25, e: 659.25, f: 698.46,
     'f#': 739.99, g: 783.99, 'g#': 830.61, a: 880.00, 'a#': 932.33, b: 987.77}, // 5
];

/**
 * @param {{
 *   volume?: number,
 *   AudioContext?: typeof AudioContext,
 *   xf?: typeof xf,
 * }} [args]
 */
function Sound(args = {}) {
    let volume = Number.isFinite(args.volume) ? args.volume : 0;
    const bus = args.xf ?? xf;
    /** @type {AudioContext | null} */
    let audioContext = null;
    /** @type {OscillatorNode | null} */
    let oscillator = null;
    /** @type {AbortController | null} */
    let abortController = null;

    function resolveAudioContextCtor() {
        if(typeof args.AudioContext === 'function') return args.AudioContext;
        if(typeof AudioContext === 'function') return AudioContext;
        if(typeof /** @type {any} */ (globalThis).webkitAudioContext === 'function') {
            return /** @type {any} */ (globalThis).webkitAudioContext;
        }
        return null;
    }

    /**
     * Lazily initializes (and resumes if suspended) the Web Audio context.
     * Returns `null` cleanly if Web Audio is unavailable or fails.
     *
     * @returns {AudioContext | null}
     */
    function ensureContext() {
        if(!exists(audioContext)) {
            const Ctor = resolveAudioContextCtor();
            if(!Ctor) return null;
            try {
                audioContext = new Ctor();
            } catch(_) {
                audioContext = null;
                return null;
            }
        }
        if(audioContext && equals(audioContext.state, 'suspended')) {
            try {
                const p = audioContext.resume?.();
                if(p && typeof p.catch === 'function') p.catch(() => {});
            } catch(_) {}
        }
        return audioContext;
    }

    /**
     * Creates an OscillatorNode across standard browsers and lightweight mocks.
     *
     * @param {AudioContext} ctx
     * @param {OscillatorType} type
     * @returns {OscillatorNode | null}
     */
    function makeOscillator(ctx, type) {
        try {
            if(typeof ctx.createOscillator === 'function') {
                const osc = ctx.createOscillator();
                osc.type = type;
                return osc;
            }
            if(typeof OscillatorNode === 'function') {
                return new OscillatorNode(ctx, { type });
            }
        } catch(_) {}
        return null;
    }

    function start() {
        abortController?.abort();
        abortController = new AbortController();
        const signal = { signal: abortController.signal };

        bus.sub('db:volume', x => {
            volume = Number.isFinite(x) ? x : 0;
        }, signal);

        bus.sub('watch:started', () => {
            if(volume > 0 || exists(audioContext)) {
                ensureContext();
            }
        }, signal);

        bus.sub('watch:beep', () => {
            interval();
        }, signal);

        bus.sub('watch:lap-beep', () => {
            lap();
        }, signal);

        bus.sub('watch:fuel-beep', () => {
            fuel();
        }, signal);

        bus.sub('watch:paused', () => {
            if(exists(audioContext) && exists(oscillator)) {
                try {
                    const p = audioContext.suspend?.();
                    if(p && typeof p.catch === 'function') p.catch(() => {});
                } catch(_) {}
            }
        }, signal);
    }

    function stop() {
        abortController?.abort();
    }

    // 4-beep interval countdown (3 × C5 + 1 × A5)
    function interval() {
        if(!(volume > 0)) return false;
        const ctx = ensureContext();
        if(!ctx) return false;

        try {
            const osc = makeOscillator(ctx, 'triangle');
            if(!osc) return false;
            oscillator = osc;
            const gainNode = ctx.createGain();

            const high = Math.min(1, Math.max(0, volume / 100));
            const low = 0;
            const time = ctx.currentTime || 0;

            gainNode.gain.setTargetAtTime(low,  time, 0.001);
            gainNode.gain.setTargetAtTime(high, time + 0.84, 0.001);
            gainNode.gain.setTargetAtTime(low,  time + 1.00, 0.001);
            gainNode.gain.setTargetAtTime(high, time + 1.84, 0.001);
            gainNode.gain.setTargetAtTime(low,  time + 2.00, 0.001);
            gainNode.gain.setTargetAtTime(high, time + 2.84, 0.001);
            gainNode.gain.setTargetAtTime(low,  time + 3.00, 0.001);
            gainNode.gain.setTargetAtTime(high, time + 3.84, 0.001);
            gainNode.gain.setTargetAtTime(low,  time + 4.00, 0.001);

            osc.frequency.setValueAtTime(notes[5].c, time);
            osc.frequency.setValueAtTime(notes[5].a, time + 3.74);

            osc.connect(gainNode);
            gainNode.connect(ctx.destination);

            osc.start(time);
            osc.stop(time + 4.15);
            return true;
        } catch(_) {
            return false;
        }
    }

    // Crisp short single lap chirp (A5, ~100 ms)
    function lap() {
        if(!(volume > 0)) return false;
        const ctx = ensureContext();
        if(!ctx) return false;

        try {
            const osc = makeOscillator(ctx, 'triangle');
            if(!osc) return false;
            const gainNode = ctx.createGain();

            const peak = Math.min(1, Math.max(0, (volume / 100) * 0.85));
            const time = ctx.currentTime || 0;

            gainNode.gain.setTargetAtTime(0, time, 0.001);
            gainNode.gain.setTargetAtTime(peak, time + 0.005, 0.004);
            gainNode.gain.setTargetAtTime(0, time + 0.095, 0.008);

            osc.frequency.setValueAtTime(notes[5].a, time);

            osc.connect(gainNode);
            gainNode.connect(ctx.destination);

            osc.start(time);
            osc.stop(time + 0.14);
            return true;
        } catch(_) {
            return false;
        }
    }

    // Gentle rising two-note fuelling chime (C5 -> E5)
    function fuel() {
        if(!(volume > 0)) return false;
        const ctx = ensureContext();
        if(!ctx) return false;

        try {
            const osc = makeOscillator(ctx, 'sine');
            if(!osc) return false;
            const gainNode = ctx.createGain();

            const peak = Math.min(1, Math.max(0, (volume / 100) * 0.6));
            const time = ctx.currentTime || 0;

            gainNode.gain.setTargetAtTime(0, time, 0.001);
            gainNode.gain.setTargetAtTime(peak, time + 0.01, 0.01);
            gainNode.gain.setTargetAtTime(0, time + 0.13, 0.012);
            gainNode.gain.setTargetAtTime(peak, time + 0.18, 0.01);
            gainNode.gain.setTargetAtTime(0, time + 0.34, 0.02);

            osc.frequency.setValueAtTime(notes[5].c, time);
            osc.frequency.setValueAtTime(notes[5].e, time + 0.17);

            osc.connect(gainNode);
            gainNode.connect(ctx.destination);

            osc.start(time);
            osc.stop(time + 0.44);
            return true;
        } catch(_) {
            return false;
        }
    }

    return Object.freeze({
        start,
        stop,
        interval,
        lap,
        fuel,
    });
}

export { Sound };
