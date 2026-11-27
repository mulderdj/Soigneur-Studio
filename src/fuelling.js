// @ts-check
//
// In-ride Fuelling Calculator & Reminders
//
// Estimates carbohydrate oxidation rate (g/h) and cumulative burn (g) from
// mechanical work (kJ) and intensity factor (power / FTP), recommends an
// exogenous carbohydrate intake band (0–30, 30–60, or 60–90 g/h) and cumulative
// grams needed, and triggers configurable periodic reminders during rides.
//

import { xf as defaultXf, clamp } from './functions.js';

/** Valid reminder intervals in minutes (`0` means Off). */
const REMINDER_INTERVALS = [0, 15, 20, 30];

/**
 * Formats a fuelling reminder interval setting for UI display.
 *
 * @param {number} minutes
 * @returns {string}
 */
function formatReminderSetting(minutes) {
    const clean = Number(minutes) || 0;
    if(clean === 15) return '15m';
    if(clean === 20) return '20m';
    if(clean === 30) return '30m';
    return 'Off';
}

/**
 * Cycles to the next fuelling reminder setting (`0 -> 15 -> 20 -> 30 -> 0`).
 *
 * @param {number} current
 * @returns {number}
 */
function nextReminderSetting(current) {
    const idx = REMINDER_INTERVALS.indexOf(Number(current) || 0);
    return REMINDER_INTERVALS[(idx + 1) % REMINDER_INTERVALS.length];
}

/**
 * Fraction of metabolic energy derived from carbohydrate oxidation as a
 * function of Intensity Factor (`power / ftp`).
 *
 * Models substrate crossover: ~35% CHO at recovery/easy Z1 (`IF <= 0.40`),
 * ~60% in Z2 endurance (`IF = 0.65`), ~75% in tempo (`IF = 0.80`), ~95% at
 * threshold (`IF = 1.00`), and 100% above threshold (`IF >= 1.05`).
 *
 * @param {number} intensityFactor
 * @returns {number}
 */
function carbFraction(intensityFactor) {
    if(!Number.isFinite(intensityFactor) || intensityFactor <= 0) return 0;
    return clamp(0.35, 1.0, intensityFactor - 0.05);
}

/**
 * Estimates instantaneous carbohydrate oxidation rate (`g/h`) at `power` and `ftp`.
 *
 * At ~23.9% gross cycling efficiency, 1 kJ mechanical work ≈ 1 kcal metabolic
 * cost, so `power` Watts corresponds to `3.6 * power` kcal/h; dividing CHO
 * energy by `4 kcal/g` yields `0.9 * power * carbFraction(IF)` g/h.
 *
 * @param {number} powerWatts
 * @param {number} [ftpWatts=200]
 * @returns {number}
 */
function estimateBurnRateGh(powerWatts, ftpWatts = 200) {
    if(!Number.isFinite(powerWatts) || powerWatts <= 0) return 0;
    const safeFtp = Number.isFinite(ftpWatts) && ftpWatts > 0 ? ftpWatts : 200;
    const ifRatio = powerWatts / safeFtp;
    return 0.9 * powerWatts * carbFraction(ifRatio);
}

/**
 * Computes the recommended exogenous carbohydrate intake band (`g/h`) and
 * cumulative grams needed for the ride so far.
 *
 * @param {{
 *   durationSec?: number,
 *   plannedDurationSec?: number,
 *   intensityFactor?: number,
 * }} [params]
 */
function recommendIntake(params = {}) {
    const elapsedSec = Math.max(0, Number(params.durationSec) || 0);
    const plannedSec = Math.max(0, Number(params.plannedDurationSec) || 0);
    const effectiveSec = Math.max(elapsedSec, plannedSec);
    const durationMin = effectiveSec / 60;
    const ifClamped = clamp(0, 1.5, Number.isFinite(params.intensityFactor) ? params.intensityFactor : 0);

    /** @type {number} */
    let minGh;
    /** @type {number} */
    let maxGh;
    /** @type {number} */
    let targetGh;
    /** @type {string} */
    let band;

    if(durationMin < 60 && ifClamped < 0.85) {
        minGh = 0;
        maxGh = 30;
        band = '0–30';
        targetGh = (durationMin < 45 && ifClamped < 0.70)
            ? 0
            : Math.round(clamp(0, 30, (ifClamped - 0.50) * 60 + Math.max(0, durationMin - 30) * 0.4));
    } else if(
        (durationMin > 120 && ifClamped >= 0.60) ||
        (durationMin >= 75 && ifClamped >= 0.85) ||
        (durationMin >= 60 && ifClamped >= 0.90)
    ) {
        minGh = 60;
        maxGh = 90;
        band = '60–90';
        targetGh = Math.round(clamp(
            60,
            90,
            60 + Math.max(0, ifClamped - 0.70) * 80 + Math.max(0, (durationMin - 120) / 60) * 10,
        ));
    } else {
        minGh = 30;
        maxGh = 60;
        band = '30–60';
        targetGh = Math.round(clamp(30, 60, 35 + Math.max(0, ifClamped - 0.60) * 80));
    }

    const intakeGrams = Math.round(targetGh * (elapsedSec / 3600));

    return {
        minGh,
        maxGh,
        targetGh,
        band,
        bandLabel: `${band} g/h`,
        intakeGrams,
    };
}

/**
 * Pure one-shot fuelling summary from mechanical work (`kJ`), `power`, and `ftp`.
 *
 * @param {{
 *   workKj?: number,
 *   power?: number,
 *   avgPower?: number | null,
 *   ftp?: number,
 *   elapsedSec?: number,
 *   plannedDurationSec?: number,
 * }} [input]
 */
function estimateFuelling(input = {}) {
    const workKj = Math.max(0, Number(input.workKj) || 0);
    const power = Math.max(0, Number(input.power) || 0);
    const safeFtp = Number.isFinite(input.ftp) && input.ftp > 0 ? input.ftp : 200;
    const elapsedSec = Math.max(0, Number(input.elapsedSec) || 0);
    const plannedDurationSec = Math.max(0, Number(input.plannedDurationSec) || 0);

    const derivedAvgPower = input.avgPower !== null && input.avgPower !== undefined && Number.isFinite(input.avgPower)
        ? Math.max(0, input.avgPower)
        : (elapsedSec > 0 && workKj > 0 ? (workKj * 1000) / elapsedSec : power);

    const avgIf = derivedAvgPower > 0 ? derivedAvgPower / safeFtp : 0;
    const currentIf = power > 0 ? power / safeFtp : 0;
    const effectiveIf = avgIf > 0 ? avgIf : currentIf;

    const burnedExact = workKj > 0 ? (workKj * carbFraction(avgIf > 0 ? avgIf : 0.65)) / 4 : 0;
    const burnRateExact = estimateBurnRateGh(power, safeFtp);
    const intake = recommendIntake({
        durationSec: elapsedSec,
        plannedDurationSec,
        intensityFactor: effectiveIf,
    });

    return {
        workKj: Math.round(workKj * 10) / 10,
        burnedGrams: Math.round(burnedExact),
        burnedGramsExact: burnedExact,
        burnRateGh: Math.round(burnRateExact),
        intensityFactor: Math.round(effectiveIf * 100) / 100,
        ...intake,
    };
}

/**
 * Sums step durations (`seconds`) of a structured workout if present.
 *
 * @param {any} workout
 * @returns {number}
 */
function workoutPlannedDurationSec(workout) {
    const intervals = workout?.intervals;
    if(!Array.isArray(intervals)) return 0;
    let total = 0;
    for(let i = 0; i < intervals.length; i++) {
        const steps = intervals[i]?.steps;
        if(!Array.isArray(steps)) continue;
        for(let s = 0; s < steps.length; s++) {
            const dur = steps[s]?.duration;
            if(Number.isFinite(dur) && dur > 0) total += dur;
        }
    }
    return total;
}

/**
 * Formats the non-blocking toast message for a fuelling reminder.
 *
 * @param {{
 *   reminderMinutes: number,
 *   elapsedSec: number,
 *   targetGh?: number,
 * }} args
 * @returns {string}
 */
function formatFuelReminderToast(args) {
    const reminderMin = Math.max(1, Math.round(args.reminderMinutes || 20));
    const elapsedMin = Math.max(1, Math.round((args.elapsedSec || 0) / 60));
    const rate = Number.isFinite(args.targetGh) && args.targetGh > 0 ? args.targetGh : 45;
    const servingGrams = Math.max(15, Math.round((rate * reminderMin) / 60));
    return `Fuel check · ~${servingGrams} g carbs (${elapsedMin} min)`;
}

/**
 * Stateful in-ride fuelling tracker with cumulative CHO integration and
 * reminder scheduling.
 *
 * @param {{
 *   ftp?: number,
 *   reminderMinutes?: number,
 * }} [initial]
 */
function createFuellingTracker(initial = {}) {
    let ftp = Number.isFinite(initial.ftp) && initial.ftp > 0 ? initial.ftp : 200;
    let reminderMinutes = REMINDER_INTERVALS.includes(Number(initial.reminderMinutes))
        ? Number(initial.reminderMinutes)
        : 0;

    let workKj = 0;
    let burnedExact = 0;
    let elapsedSec = 0;
    let plannedDurationSec = 0;
    let lastPower = 0;
    let lastReminderSlot = 0;

    function reset() {
        workKj = 0;
        burnedExact = 0;
        elapsedSec = 0;
        lastPower = 0;
        lastReminderSlot = 0;
    }

    /**
     * Updates reminder cadence without firing retroactively for already-passed intervals.
     *
     * @param {number} minutes
     */
    function setReminderMinutes(minutes) {
        const clean = REMINDER_INTERVALS.includes(Number(minutes)) ? Number(minutes) : 0;
        if(clean === reminderMinutes) return;
        reminderMinutes = clean;
        lastReminderSlot = clean > 0 ? Math.floor(elapsedSec / (clean * 60)) : 0;
    }

    /**
     * @param {number} nextFtp
     */
    function setFtp(nextFtp) {
        if(Number.isFinite(nextFtp) && nextFtp > 0) {
            ftp = nextFtp;
        }
    }

    /**
     * @param {number} seconds
     */
    function setPlannedDurationSec(seconds) {
        plannedDurationSec = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    }

    /**
     * Advances the tracker by one tick (`dt` seconds) during an active ride.
     *
     * @param {{
     *   power?: number,
     *   elapsedSec?: number,
     *   dt?: number,
     *   ftp?: number,
     *   plannedDurationSec?: number,
     * }} sample
     */
    function tick(sample = {}) {
        if(sample.ftp !== undefined) setFtp(sample.ftp);
        if(sample.plannedDurationSec !== undefined) setPlannedDurationSec(sample.plannedDurationSec);

        const dt = Number.isFinite(sample.dt) && sample.dt > 0 ? sample.dt : 1;
        const p = Number.isFinite(sample.power) && sample.power > 0 ? sample.power : 0;
        lastPower = p;

        if(p > 0) {
            const stepKj = (p * dt) / 1000;
            workKj += stepKj;
            burnedExact += (stepKj * carbFraction(p / ftp)) / 4;
        }

        elapsedSec = sample.elapsedSec !== undefined && Number.isFinite(sample.elapsedSec)
            ? Math.max(0, sample.elapsedSec)
            : elapsedSec + dt;

        const avgPower = elapsedSec > 0 ? (workKj * 1000) / elapsedSec : p;
        const avgIf = avgPower > 0 ? avgPower / ftp : (p > 0 ? p / ftp : 0);
        const burnRateGh = Math.round(estimateBurnRateGh(p, ftp));
        const intake = recommendIntake({
            durationSec: elapsedSec,
            plannedDurationSec,
            intensityFactor: avgIf,
        });

        /** @type {string | null} */
        let reminder = null;
        if(reminderMinutes > 0 && elapsedSec >= reminderMinutes * 60) {
            const slot = Math.floor(elapsedSec / (reminderMinutes * 60));
            if(slot > lastReminderSlot) {
                lastReminderSlot = slot;
                reminder = formatFuelReminderToast({
                    reminderMinutes,
                    elapsedSec: slot * reminderMinutes * 60,
                    targetGh: intake.targetGh,
                });
            }
        }

        return {
            burnedGrams: Math.round(burnedExact),
            burnedGramsExact: burnedExact,
            burnRateGh,
            workKj: Math.round(workKj * 10) / 10,
            elapsedSec,
            ...intake,
            reminder,
        };
    }

    function snapshot() {
        const avgPower = elapsedSec > 0 ? (workKj * 1000) / elapsedSec : lastPower;
        const avgIf = avgPower > 0 ? avgPower / ftp : (lastPower > 0 ? lastPower / ftp : 0);
        const intake = recommendIntake({
            durationSec: elapsedSec,
            plannedDurationSec,
            intensityFactor: avgIf,
        });
        return {
            burnedGrams: Math.round(burnedExact),
            burnedGramsExact: burnedExact,
            burnRateGh: Math.round(estimateBurnRateGh(lastPower, ftp)),
            workKj: Math.round(workKj * 10) / 10,
            elapsedSec,
            reminderMinutes,
            ...intake,
        };
    }

    return Object.freeze({
        tick,
        reset,
        setFtp,
        setReminderMinutes,
        setPlannedDurationSec,
        snapshot,
    });
}

/**
 * Wires live fuelling metrics and periodic reminders to `xf`.
 *
 * @param {{ xf?: typeof defaultXf }} [options]
 */
function startFuelling(options = {}) {
    const bus = options.xf ?? defaultXf;
    const tracker = createFuellingTracker();
    const abortController = new AbortController();
    const signal = { signal: abortController.signal };

    let watchStatus = 'stopped';
    let workoutStatus = 'stopped';
    let currentWorkout = null;
    let currentFtp = 200;
    let power1s = 0;

    function syncPlannedDuration() {
        const planned = workoutStatus === 'started' ? workoutPlannedDurationSec(currentWorkout) : 0;
        tracker.setPlannedDurationSec(planned);
    }

    function publish(state) {
        bus.dispatch('fuelling:state', state);
    }

    bus.sub('db:ftp', ftp => {
        if(Number.isFinite(ftp) && ftp > 0) currentFtp = ftp;
        tracker.setFtp(ftp);
        publish(tracker.snapshot());
    }, signal);

    bus.sub('db:sources', sources => {
        if(!sources) return;
        tracker.setReminderMinutes(sources.fuellingReminder ?? 0);
    }, signal);

    bus.sub('db:workout', workout => {
        currentWorkout = workout;
        syncPlannedDuration();
        publish(tracker.snapshot());
    }, signal);

    bus.sub('db:workoutStatus', status => {
        workoutStatus = status;
        syncPlannedDuration();
        publish(tracker.snapshot());
    }, signal);

    bus.sub('db:watchStatus', status => {
        watchStatus = status;
        if(status === 'stopped') {
            tracker.reset();
            publish(tracker.snapshot());
        }
    }, signal);

    bus.sub('db:power1s', watts => {
        power1s = Number.isFinite(watts) ? watts : 0;
        if(watchStatus !== 'started') {
            publish({
                ...tracker.snapshot(),
                burnRateGh: Math.round(estimateBurnRateGh(power1s, currentFtp)),
            });
        }
    }, signal);

    bus.sub('db:elapsed', elapsed => {
        if(watchStatus !== 'started') {
            if(elapsed === 0) {
                tracker.reset();
                publish(tracker.snapshot());
            }
            return;
        }
        const state = tracker.tick({
            power: power1s,
            elapsedSec: elapsed,
            dt: 1,
        });
        publish(state);
        if(state.reminder) {
            bus.dispatch('ui:toast', state.reminder);
            bus.dispatch('watch:fuel-beep');
        }
    }, signal);

    bus.sub('session:restore', sessions => {
        const session = Array.isArray(sessions) && sessions.length > 0 ? sessions[sessions.length - 1] : null;
        if(!session || !(session.elapsed > 0)) return;
        tracker.reset();
        const records = Array.isArray(session.records) ? session.records : [];
        for(let i = 0; i < records.length; i++) {
            const rec = records[i];
            if(rec && Number.isFinite(rec.power)) {
                tracker.tick({ power: rec.power, dt: 1 });
            }
        }
        publish(tracker.snapshot());
    }, signal);

    function stop() {
        abortController.abort();
    }

    return Object.freeze({
        stop,
        tracker,
    });
}

export {
    REMINDER_INTERVALS,
    formatReminderSetting,
    nextReminderSetting,
    carbFraction,
    estimateBurnRateGh,
    recommendIntake,
    estimateFuelling,
    workoutPlannedDurationSec,
    formatFuelReminderToast,
    createFuellingTracker,
    startFuelling,
};
