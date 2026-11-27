/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import { Sound } from '../src/sound.js';

function createMockAudio() {
    const calls = {
        instances: 0,
        resumes: 0,
        suspends: 0,
        oscillators: [],
        gains: [],
    };

    class MockAudioContext {
        constructor(initialState = 'running') {
            calls.instances += 1;
            this.state = initialState;
            this.currentTime = 10;
            this.destination = { kind: 'destination' };
        }
        resume() {
            calls.resumes += 1;
            this.state = 'running';
            return Promise.resolve();
        }
        suspend() {
            calls.suspends += 1;
            this.state = 'suspended';
            return Promise.resolve();
        }
        createGain() {
            const gain = {
                events: [],
                gain: {
                    setTargetAtTime: (value, time, tc) => {
                        gain.events.push({ value, time, tc });
                    },
                },
                connect: dest => dest,
            };
            calls.gains.push(gain);
            return gain;
        }
        createOscillator() {
            const osc = {
                type: 'sine',
                freqs: [],
                startedAt: null,
                stoppedAt: null,
                frequency: {
                    setValueAtTime: (freq, time) => {
                        osc.freqs.push({ freq, time });
                    },
                },
                connect: node => node,
                start: t => { osc.startedAt = t; },
                stop: t => { osc.stoppedAt = t; },
            };
            calls.oscillators.push(osc);
            return osc;
        }
    }

    return { MockAudioContext, calls };
}

describe('Sound cues (watch:beep, watch:lap-beep, watch:fuel-beep)', () => {
    test('never throws when volume is 0 or AudioContext is missing/unavailable', () => {
        const soundMuted = Sound({ volume: 0 });
        soundMuted.start();
        expect(() => {
            xf.dispatch('watch:beep');
            xf.dispatch('watch:lap-beep');
            xf.dispatch('watch:fuel-beep');
            xf.dispatch('watch:paused');
        }).not.toThrow();
        expect(soundMuted.interval()).toBe(false);
        expect(soundMuted.lap()).toBe(false);
        expect(soundMuted.fuel()).toBe(false);
        soundMuted.stop();

        // Even with volume > 0, missing AudioContext in JSDOM cleanly returns false without throwing
        const soundNoAudio = Sound({ volume: 80 });
        soundNoAudio.start();
        expect(() => {
            xf.dispatch('watch:beep');
            xf.dispatch('watch:lap-beep');
            xf.dispatch('watch:fuel-beep');
        }).not.toThrow();
        expect(soundNoAudio.lap()).toBe(false);
        soundNoAudio.stop();
    });

    test('lazily creates AudioContext and plays interval, lap, and fuelling cues when volume > 0', () => {
        const { MockAudioContext, calls } = createMockAudio();
        const sound = Sound({ volume: 60, AudioContext: /** @type {any} */ (MockAudioContext) });
        sound.start();

        // Before watch:started, firing watch:lap-beep still lazily initializes AudioContext cleanly!
        xf.dispatch('watch:lap-beep');
        expect(calls.instances).toBe(1);
        expect(calls.oscillators).toHaveLength(1);
        const lapOsc = calls.oscillators[0];
        expect(lapOsc.freqs[0].freq).toBeCloseTo(880, 1);
        expect(lapOsc.stoppedAt - lapOsc.startedAt).toBeLessThan(0.25);

        // Gentle two-note rising fuelling chime (C5 -> E5)
        xf.dispatch('watch:fuel-beep');
        expect(calls.oscillators).toHaveLength(2);
        const fuelOsc = calls.oscillators[1];
        expect(fuelOsc.freqs).toHaveLength(2);
        expect(fuelOsc.freqs[1].freq).toBeGreaterThan(fuelOsc.freqs[0].freq);

        // 4-beep interval countdown
        xf.dispatch('watch:beep');
        expect(calls.oscillators).toHaveLength(3);
        const intOsc = calls.oscillators[2];
        expect(intOsc.freqs).toHaveLength(2);
        expect(intOsc.stoppedAt - intOsc.startedAt).toBeCloseTo(4.15, 2);

        // Muting stops subsequent cues from scheduling oscillators
        xf.dispatch('db:volume', { volume: 0 });
        xf.dispatch('watch:lap-beep');
        xf.dispatch('watch:fuel-beep');
        expect(calls.oscillators).toHaveLength(3);

        sound.stop();
    });

    test('resumes a suspended AudioContext before playing cues', () => {
        const { MockAudioContext, calls } = createMockAudio();
        class SuspendedAudioContext extends MockAudioContext {
            constructor() { super('suspended'); }
        }
        const sound = Sound({ volume: 50, AudioContext: /** @type {any} */ (SuspendedAudioContext) });
        sound.start();

        xf.dispatch('watch:lap-beep');
        expect(calls.resumes).toBe(1);
        expect(calls.oscillators).toHaveLength(1);

        sound.stop();
    });
});
