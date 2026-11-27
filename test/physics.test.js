import { Model } from '../src/physics.js';

const STEADY_STATE_REFERENCE = [
    { power: 100, speedKph: 23.432924360367274 },
    { power: 120, speedKph: 25.189052126217685 },
    { power: 140, speedKph: 26.74838013569652 },
    { power: 160, speedKph: 28.157617078281067 },
    { power: 180, speedKph: 29.448007183812937 },
    { power: 200, speedKph: 30.64158051826261 },
    { power: 220, speedKph: 31.75451044656484 },
    { power: 240, speedKph: 32.79905643261226 },
    { power: 260, speedKph: 33.78475556200895 },
    { power: 280, speedKph: 34.71918831599576 },
    { power: 300, speedKph: 35.608490046695934 },
    { power: 320, speedKph: 36.45770380681783 },
];

const POWERS = Array.from({ length: 12 }, (_, idx) => 100 + idx * 20);

describe('Cycling physics solver', () => {
    const fullModel = Model({
        use: {
            spokeDrag: true,
            bearingLoss: true,
            wheelInertia: true,
            dynamicCrr: true,
        },
    });

    test('powerToMaxSpeed matches exact steady-state speeds across power range', () => {
        const denseAirModel = Model({
            rho: 1.275,
            dragCoefficient: 1,
            frontalArea: 0.4,
            CdA: 0.4,
            use: {
                spokeDrag: true,
                bearingLoss: true,
                wheelInertia: true,
                dynamicCrr: true,
            },
        });

        for (const { power, speedKph } of STEADY_STATE_REFERENCE) {
            const solvedKph = denseAirModel.powerToMaxSpeed({ power, drivetrainLoss: 0.02 }) * 3.6;
            expect(solvedKph).toBeCloseTo(speedKph, 10);
        }
    });

    test.each([0, 2, 4, 8])('virtualSpeed converges to steady state at %i%% gradient', gradePct => {
        const slope = gradePct / 100;
        for (const power of POWERS) {
            let state = { speed: 0, acceleration: 0, distance: 0, altitude: 0 };
            for (let t = 0; t < 70; t++) {
                state = fullModel.virtualSpeed({ power, slope, dt: 1, ...state });
            }
            const reachedKph = state.speed * 3.6;
            const predictedKph = fullModel.powerToMaxSpeed({
                power,
                slope,
                acceleration: state.acceleration,
            }) * 3.6;

            expect(Math.abs(reachedKph - predictedKph)).toBeLessThan(0.015);
        }
    });

    test('virtualSpeed and virtualSpeedCF coast down smoothly to zero when pedaling stops', () => {
        for (const watts of [68, 190, 415, 1310]) {
            const initialSpeed = fullModel.powerToMaxSpeed({ power: watts, slope: 0 });

            let kineticState = { speed: initialSpeed, distance: 0, altitude: 0 };
            let steps = 0;
            while (kineticState.speed > 0 && steps < 2500) {
                kineticState = fullModel.virtualSpeed({ power: 0, slope: 0, dt: 0.25, ...kineticState });
                steps += 1;
            }
            expect(steps).toBeLessThan(2000);
            expect(kineticState.speed).toBe(0);

            let implicitState = { speed: initialSpeed, distance: 0, altitude: 0, ascent: 0 };
            let cfSteps = 0;
            while (implicitState.speed > 0 && cfSteps < 2500) {
                implicitState = fullModel.virtualSpeedCF({ power: 0, slope: 0, dt: 0.25, ...implicitState });
                cfSteps += 1;
            }
            expect(cfSteps).toBeLessThan(2000);
            expect(implicitState.speed).toBe(0);
        }
    });

    test('virtualSpeedCF and trainerSpeed accumulate distance, altitude, and positive ascent', () => {
        const stepUp = fullModel.virtualSpeedCF({
            power: 250,
            slope: 0.05,
            speed: 5,
            distance: 100,
            altitude: 10,
            ascent: 10,
            dt: 1,
        });
        expect(stepUp.distance).toBeGreaterThan(100);
        expect(stepUp.altitude).toBeGreaterThan(10);
        expect(stepUp.ascent).toBeCloseTo(stepUp.altitude, 6);

        const trainerDown = fullModel.trainerSpeed({
            slope: -0.04,
            speedPrev: 8,
            speed: 10,
            distance: 200,
            altitude: 50,
            ascent: 25,
            dt: 1,
        });
        expect(trainerDown.acceleration).toBeCloseTo(2, 6);
        expect(trainerDown.distance).toBeCloseTo(210, 6);
        expect(trainerDown.altitude).toBeLessThan(50);
        expect(trainerDown.ascent).toBe(25);
    });
});
