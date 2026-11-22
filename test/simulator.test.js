import { initialState, step } from '../src/dev/simulator.js';

const noNoise = () => 0.5; // rand() in the middle: noise terms are zero

function ride(state, inputs, seconds, dt = 0.25) {
    for(let t = 0; t < seconds; t += dt) state = step(state, inputs, dt, noNoise);
    return state;
}

describe('simulated rider', () => {
    const ftp = 250;

    test('starts at rest', () => {
        const s = initialState();
        expect(s.power).toBe(0);
        expect(s.heartRate).toBeGreaterThan(40);
        expect(s.heartRate).toBeLessThan(80);
    });

    test('ERG mode: power settles on the target within a few seconds', () => {
        const s = ride(initialState(), {mode: 'erg', powerTarget: 200, ftp}, 10);
        expect(s.power).toBeCloseTo(200, 0);
    });

    test('ERG mode follows a change of target', () => {
        let s = ride(initialState(), {mode: 'erg', powerTarget: 150, ftp}, 10);
        s = ride(s, {mode: 'erg', powerTarget: 300, ftp}, 10);
        expect(s.power).toBeCloseTo(300, 0);
    });

    test('no target: rides at an endurance pace', () => {
        const s = ride(initialState(), {mode: 'erg', powerTarget: 0, ftp}, 10);
        expect(s.power).toBeGreaterThan(0.5 * ftp);
        expect(s.power).toBeLessThan(0.75 * ftp);
    });

    test('slope mode: climbing takes more power than flat', () => {
        const flat  = ride(initialState(), {mode: 'sim', slopeTarget: 0, ftp}, 10);
        const climb = ride(initialState(), {mode: 'sim', slopeTarget: 6, ftp}, 10);
        expect(climb.power).toBeGreaterThan(flat.power);
    });

    test('heart rate rises with power, lags behind it, and stays in range', () => {
        const easy = ride(initialState(), {mode: 'erg', powerTarget: 120, ftp}, 300);
        const hard = ride(initialState(), {mode: 'erg', powerTarget: 300, ftp}, 300);
        expect(hard.heartRate).toBeGreaterThan(easy.heartRate);
        expect(hard.heartRate).toBeLessThanOrEqual(195);

        const early = ride(initialState(), {mode: 'erg', powerTarget: 300, ftp}, 5);
        expect(early.heartRate).toBeLessThan(hard.heartRate - 20);
    });

    test('cadence and speed are realistic', () => {
        const s = ride(initialState(), {mode: 'erg', powerTarget: 200, ftp}, 30);
        expect(s.cadence).toBeGreaterThan(70);
        expect(s.cadence).toBeLessThan(105);
        // m/s: roughly 30-40 km/h at 200 W on the flat
        expect(s.speed * 3.6).toBeGreaterThan(25);
        expect(s.speed * 3.6).toBeLessThan(45);
    });

    test('noise keeps values plausible', () => {
        let s = initialState();
        for(let i = 0; i < 2000; i++) {
            s = step(s, {mode: 'erg', powerTarget: 250, ftp}, 0.25, Math.random);
            expect(s.power).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(s.power)).toBe(true);
            expect(Number.isInteger(s.heartRate)).toBe(true);
            expect(Number.isInteger(s.cadence)).toBe(true);
        }
        expect(s.power).toBeGreaterThan(220);
        expect(s.power).toBeLessThan(280);
    });
});
