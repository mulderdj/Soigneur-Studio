// @ts-check

const GRAVITY = 9.80665;
const WHEEL_INERTIA_KG_M2 = 0.14;
const SPOKE_DRAG_AREA = 0.0044;
const BEARING_LOSS_LINEAR = 0.091;
const BEARING_LOSS_QUAD = 0.0087;
const DYNAMIC_CRR_COEFF = 0.1;

/**
 * Refine a root of f(x) = a*x^3 + b*x^2 + c*x + d = 0 via Newton-Raphson.
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} d
 * @param {number} initialGuess
 * @returns {number}
 */
function newtonRefineCubic(a, b, c, d, initialGuess) {
    let x = initialGuess;
    for (let iter = 0; iter < 32; iter++) {
        const fx = ((a * x + b) * x + c) * x + d;
        if (Math.abs(fx) < 1e-13) break;
        const dfx = (3 * a * x + 2 * b) * x + c;
        if (Math.abs(dfx) < 1e-14) break;
        const step = fx / dfx;
        x -= step;
        if (Math.abs(step) < 1e-13) break;
    }
    return x;
}

/**
 * Solve real roots of a*x^3 + b*x^2 + c*x + d = 0 using Newton-Raphson
 * combined with synthetic quadratic deflation, then select the physical
 * cycling velocity root (smallest positive root if one exists, otherwise
 * the largest real root).
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} d
 * @returns {number}
 */
function solveVelocityCubic(a, b, c, d) {
    /** @type {number[]} */
    const roots = [];

    if (Math.abs(a) < 1e-10) {
        if (Math.abs(b) < 1e-10) {
            if (Math.abs(c) >= 1e-10) {
                roots.push(-d / c);
            }
        } else {
            const disc = c * c - 4 * b * d;
            if (Math.abs(disc) < 1e-12) {
                roots.push(-c / (2 * b));
            } else if (disc > 0) {
                const sqrtDisc = Math.sqrt(disc);
                roots.push((-c + sqrtDisc) / (2 * b), (-c - sqrtDisc) / (2 * b));
            }
        }
    } else {
        // Inflection point x_inf = -b / (3a); choose initial guess on the monotone tail
        const xInf = -b / (3 * a);
        const fInf = ((a * xInf + b) * xInf + c) * xInf + d;
        const scale = Math.max(1, Math.cbrt(Math.abs(d / a)) + Math.abs(xInf) + Math.sqrt(Math.abs(c / a)));
        const direction = (a > 0 ? 1 : -1) * (fInf <= 0 ? 1 : -1);
        let x0 = newtonRefineCubic(a, b, c, d, xInf + direction * scale);
        roots.push(x0);

        // Deflate (a*x^3 + b*x^2 + c*x + d) by (x - x0) -> a*x^2 + q1*x + q0
        const q1 = b + a * x0;
        const q0 = c + q1 * x0;
        const disc = q1 * q1 - 4 * a * q0;
        if (Math.abs(disc) < 1e-10) {
            roots.push(newtonRefineCubic(a, b, c, d, -q1 / (2 * a)));
        } else if (disc > 0) {
            const sqrtDisc = Math.sqrt(disc);
            const r1 = (-q1 + sqrtDisc) / (2 * a);
            const r2 = (-q1 - sqrtDisc) / (2 * a);
            roots.push(
                newtonRefineCubic(a, b, c, d, r1),
                newtonRefineCubic(a, b, c, d, r2),
            );
        }
    }

    if (roots.length === 0) return 0;

    let selected = roots[0];
    for (let i = 1; i < roots.length; i++) {
        const candidate = roots[i];
        if (selected > 0) {
            if (candidate > 0 && candidate < selected) {
                selected = candidate;
            }
        } else if (candidate > selected) {
            selected = candidate;
        }
    }
    return selected;
}

/**
 * @param {number} slope
 * @returns {{ cosGrade: number, sinGrade: number }}
 */
function gradeTrig(slope) {
    const cosGrade = 1 / Math.hypot(1, slope);
    return {
        cosGrade,
        sinGrade: slope * cosGrade,
    };
}

/**
 * Create a road cycling power-to-speed physics solver.
 * @param {Record<string, any>} [options]
 */
function Model(options = {}) {
    const defaults = {
        mass: 85,
        slope: 0,
        wheelCircumference: 2105,
        drivetrainLoss: 0.02,
        crr: 0.004,
        windSpeed: 0,
        rho: 1.225,
        dragCoefficient: 1.0,
        frontalArea: 0.4,
        CdA: 0.4,
        draftingFactor: 1,
    };

    const use = {
        spokeDrag: false,
        bearingLoss: false,
        wheelInertia: false,
        dynamicCrr: false,
        ...(options.use ?? {}),
    };

    const wheelCircumference = options.wheelCircumference ?? defaults.wheelCircumference;
    const baseDrivetrainLoss = options.drivetrainLoss ?? defaults.drivetrainLoss;
    const crr = options.crr ?? defaults.crr;
    const rho = options.rho ?? defaults.rho;
    const cda = options.CdA ?? defaults.CdA;

    const wheelRadiusM = wheelCircumference / (2000 * Math.PI);
    const wheelInertiaMass = use.wheelInertia ? WHEEL_INERTIA_KG_M2 / (wheelRadiusM * wheelRadiusM) : 0;
    const spokeDrag = use.spokeDrag ? SPOKE_DRAG_AREA : 0;
    const bearingLinear = use.bearingLoss ? BEARING_LOSS_LINEAR : 0;
    const bearingQuad = use.bearingLoss ? BEARING_LOSS_QUAD : 0;
    const dynamicCrr = (use.dynamicCrr ?? use.useDynamicCrr) ? DYNAMIC_CRR_COEFF : 0;
    const effectiveArea = cda + spokeDrag;

    function powerToMaxSpeed(params = {}) {
        const power = params.power;
        const slope = params.slope ?? defaults.slope;
        const mass = params.mass ?? defaults.mass;
        const windSpeed = params.windSpeed ?? defaults.windSpeed;
        const acceleration = params.acceleration ?? 0;
        const dtLoss = params.drivetrainLoss ?? baseDrivetrainLoss;
        const drafting = params.draftingFactor ?? defaults.draftingFactor;

        const { cosGrade, sinGrade } = gradeTrig(slope);
        const aeroFactor = 0.5 * effectiveArea * rho * drafting;

        const c3 = aeroFactor;
        const c2 = 2 * aeroFactor * windSpeed + bearingQuad + dynamicCrr * cosGrade;
        const c1 =
            GRAVITY * mass * sinGrade +
            GRAVITY * mass * crr * cosGrade +
            aeroFactor * windSpeed * windSpeed +
            bearingLinear +
            (mass + wheelInertiaMass) * acceleration;
        const c0 = -power * (1 - dtLoss);

        return solveVelocityCubic(c3, c2, c1, c0);
    }

    function virtualSpeed(params = {}) {
        const power = params.power;
        const slope = params.slope ?? defaults.slope;
        const mass = params.mass ?? defaults.mass;
        const windSpeed = params.windSpeed ?? 0;
        const dtLoss = params.drivetrainLoss ?? baseDrivetrainLoss;
        const drafting = params.draftingFactor ?? defaults.draftingFactor;
        const dt = params.dt ?? 1;
        const prevSpeed = params.speed ?? 0;
        let distance = params.distance ?? 0;
        let altitude = params.altitude ?? 0;

        const { cosGrade, sinGrade } = gradeTrig(slope);
        const airSpeed = prevSpeed + windSpeed;

        const fGravity = GRAVITY * mass * sinGrade;
        const fRolling = GRAVITY * mass * cosGrade * crr + prevSpeed * dynamicCrr * cosGrade;
        const fAero = 0.5 * rho * effectiveArea * Math.abs(airSpeed) * airSpeed * drafting;
        const fBearing = use.bearingLoss ? BEARING_LOSS_LINEAR + BEARING_LOSS_QUAD * prevSpeed : 0;

        const steadyPower = (fGravity + fRolling + fAero + fBearing) * prevSpeed;
        const kineticPower = power * (1 - dtLoss) - steadyPower;

        const nextSpeedSq = prevSpeed * prevSpeed + (2 * kineticPower * dt) / (mass + wheelInertiaMass);
        const speed = nextSpeedSq > 0 && Number.isFinite(nextSpeedSq) ? Math.sqrt(nextSpeedSq) : 0;

        const acceleration = (speed - prevSpeed) / dt;
        const deltaDist = speed * dt;
        const deltaAlt = deltaDist * sinGrade;

        distance += deltaDist;
        altitude = Math.max(0, altitude + deltaAlt);

        return { acceleration, speed, distance, altitude };
    }

    function virtualSpeedCF(params = {}) {
        const power = params.power;
        const slope = params.slope ?? defaults.slope;
        const mass = params.mass ?? defaults.mass;
        const windSpeed = params.windSpeed ?? 0;
        const dtLoss = params.drivetrainLoss ?? baseDrivetrainLoss;
        const drafting = params.draftingFactor ?? defaults.draftingFactor;
        const dt = params.dt ?? 1;
        const prevSpeed = params.speed ?? 0;
        let distance = params.distance ?? 0;
        let altitude = params.altitude ?? 0;
        let ascent = params.ascent ?? 0;

        const { cosGrade, sinGrade } = gradeTrig(slope);
        const aeroFactor = 0.5 * effectiveArea * rho * drafting;
        const effectiveMass = mass + wheelInertiaMass;

        const c3 = aeroFactor;
        const c2 = 2 * aeroFactor * windSpeed + bearingQuad + dynamicCrr * cosGrade + (0.5 * effectiveMass) / dt;
        const c1 =
            GRAVITY * mass * sinGrade +
            GRAVITY * mass * crr * cosGrade +
            aeroFactor * windSpeed * windSpeed +
            bearingLinear;
        const c0 = -power * (1 - dtLoss) - (0.5 * effectiveMass * prevSpeed * prevSpeed) / dt;

        let speed = solveVelocityCubic(c3, c2, c1, c0);
        if (speed < 0.1 || Number.isNaN(speed)) {
            speed = 0;
        }

        const acceleration = (speed - prevSpeed) / dt;
        const deltaDist = speed * dt;
        const deltaAlt = deltaDist * sinGrade;

        distance += deltaDist;
        altitude = Math.max(0, altitude + deltaAlt);
        if (deltaAlt > 0) {
            ascent += deltaAlt;
        }

        return { acceleration, speed, distance, altitude, ascent };
    }

    function trainerSpeed(params = {}) {
        const slope = params.slope ?? defaults.slope;
        const dt = params.dt ?? 1;
        const prevSpeed = params.speedPrev ?? 0;
        const speed = params.speed ?? 0;
        let distance = params.distance ?? 0;
        let altitude = params.altitude ?? 0;
        let ascent = params.ascent ?? 0;

        const { sinGrade } = gradeTrig(slope);
        const acceleration = (speed - prevSpeed) / dt;
        const deltaDist = speed * dt;
        const deltaAlt = deltaDist * sinGrade;

        distance += deltaDist;
        altitude = Math.max(0, altitude + deltaAlt);
        if (deltaAlt > 0) {
            ascent += deltaAlt;
        }

        return { acceleration, distance, altitude, ascent };
    }

    return Object.freeze({
        powerToMaxSpeed,
        virtualSpeed,
        virtualSpeedCF,
        trainerSpeed,
    });
}

export { Model };
