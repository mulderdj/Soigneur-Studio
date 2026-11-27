/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import {
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
} from '../src/fuelling.js';
import '../src/views/toast.js';
import '../src/views/data-views.js';

describe('fuelling physiology & recommendations', () => {
    test('carbohydrate fraction and burn rate increase with intensity factor (power / FTP)', () => {
        expect(carbFraction(0)).toBe(0);
        expect(carbFraction(0.35)).toBeCloseTo(0.35, 2);
        expect(carbFraction(0.65)).toBeCloseTo(0.60, 2);
        expect(carbFraction(1.00)).toBeCloseTo(0.95, 2);
        expect(carbFraction(1.15)).toBeCloseTo(1.00, 2);

        expect(estimateBurnRateGh(0, 250)).toBe(0);
        const easyZ2 = estimateBurnRateGh(160, 250);       // IF = 0.64 -> ~85 g/h
        const threshold = estimateBurnRateGh(250, 250);    // IF = 1.00 -> ~214 g/h
        expect(easyZ2).toBeGreaterThan(75);
        expect(easyZ2).toBeLessThan(100);
        expect(threshold).toBeGreaterThan(200);
        expect(threshold).toBeLessThan(230);
    });

    test('recommends 0–30, 30–60, and 60–90 g/h bands by duration and intensity', () => {
        const shortEasy = recommendIntake({ durationSec: 40 * 60, intensityFactor: 0.62 });
        expect(shortEasy.band).toBe('0–30');
        expect(shortEasy.minGh).toBe(0);
        expect(shortEasy.maxGh).toBe(30);

        const mod90m = recommendIntake({ durationSec: 90 * 60, intensityFactor: 0.72 });
        expect(mod90m.band).toBe('30–60');
        expect(mod90m.minGh).toBe(30);
        expect(mod90m.maxGh).toBe(60);
        expect(mod90m.intakeGrams).toBeGreaterThanOrEqual(50);

        const longEndurance = recommendIntake({ durationSec: 150 * 60, intensityFactor: 0.72 });
        expect(longEndurance.band).toBe('60–90');
        expect(longEndurance.minGh).toBe(60);
        expect(longEndurance.maxGh).toBe(90);

        const plannedHard = recommendIntake({ durationSec: 15 * 60, plannedDurationSec: 90 * 60, intensityFactor: 0.90 });
        expect(plannedHard.band).toBe('60–90');
    });

    test('estimateFuelling computes cumulative burned carbs from kJ work and intensity', () => {
        // 1 hour at 200 W with 250 W FTP -> 720 kJ, IF = 0.80 -> carbFraction = 0.75 -> 720 * 0.75 / 4 = 135 g
        const res = estimateFuelling({
            workKj: 720,
            power: 200,
            ftp: 250,
            elapsedSec: 3600,
        });
        expect(res.burnedGrams).toBe(135);
        expect(res.burnRateGh).toBe(135);
        expect(res.band).toBe('30–60');
        expect(res.intakeGrams).toBeGreaterThanOrEqual(45);
    });

    test('workoutPlannedDurationSec sums interval step durations safely', () => {
        expect(workoutPlannedDurationSec(null)).toBe(0);
        expect(workoutPlannedDurationSec({
            intervals: [
                { steps: [{ duration: 600 }, { duration: 300 }] },
                { steps: [{ duration: 1200 }] },
            ],
        })).toBe(2100);
    });
});

describe('reminder settings & periodic notifications', () => {
    test('cycles Off -> 15m -> 20m -> 30m -> Off', () => {
        expect(REMINDER_INTERVALS).toEqual([0, 15, 20, 30]);
        expect( REMINDER_INTERVALS.map(formatReminderSetting) ).toEqual(['Off', '15m', '20m', '30m']);
        let cur = 0;
        const visited = [];
        for(let i = 0; i < 4; i++) {
            cur = nextReminderSetting(cur);
            visited.push(cur);
        }
        expect(visited).toEqual([15, 20, 30, 0]);
    });

    test('formatFuelReminderToast produces clean non-blocking copy', () => {
        expect(formatFuelReminderToast({ reminderMinutes: 20, elapsedSec: 2400, targetGh: 60 }))
            .toBe('Fuel check · ~20 g carbs (40 min)');
    });

    test('createFuellingTracker fires reminders at configured intervals and avoids retroactive firing', () => {
        const tracker = createFuellingTracker({ ftp: 250, reminderMinutes: 20 });
        let reminders = [];
        for(let sec = 1; sec <= 2400; sec++) {
            const out = tracker.tick({ power: 190, elapsedSec: sec, dt: 1, plannedDurationSec: 5400 });
            if(out.reminder) reminders.push(out.reminder);
        }
        expect(reminders).toHaveLength(2);
        expect(reminders[0]).toMatch(/Fuel check · ~\d+ g carbs \(20 min\)/);
        expect(reminders[1]).toMatch(/Fuel check · ~\d+ g carbs \(40 min\)/);

        // Changing interval mid-ride to 15m at 40m does NOT fire retroactively at 40m01s, fires next at 45m
        tracker.setReminderMinutes(15);
        expect(tracker.tick({ power: 190, elapsedSec: 2401, dt: 1 }).reminder).toBeNull();
        expect(tracker.tick({ power: 190, elapsedSec: 2700, dt: 1 }).reminder)
            .toMatch(/Fuel check · ~\d+ g carbs \(45 min\)/);
    });

    test('startFuelling dispatches fuelling:state, toast, and watch:fuel-beep on reminder', () => {
        const toasts = [];
        let fuelBeeps = 0;
        const states = [];
        const svc = startFuelling({ xf });
        xf.sub('ui:toast', t => toasts.push(t));
        xf.sub('watch:fuel-beep', () => { fuelBeeps += 1; });
        xf.sub('fuelling:state', s => states.push(s));

        try {
            xf.dispatch('db:ftp', { ftp: 250 });
            xf.dispatch('db:sources', { sources: { fuellingReminder: 15 } });
            xf.dispatch('db:watchStatus', { watchStatus: 'started' });
            xf.dispatch('db:power1s', { power1s: 200 });

            for(let sec = 1; sec <= 900; sec++) {
                xf.dispatch('db:elapsed', { elapsed: sec });
            }

            expect(fuelBeeps).toBe(1);
            expect(toasts).toHaveLength(1);
            expect(toasts[0]).toMatch(/Fuel check · ~\d+ g carbs \(15 min\)/);
            expect(document.querySelector('.app-toast')?.textContent).toBe(toasts[0]);
            expect(states.at(-1).burnedGrams).toBeGreaterThan(30);

            // Stopping the ride resets cumulative fuelling state
            xf.dispatch('db:watchStatus', { watchStatus: 'stopped' });
            expect(states.at(-1).burnedGrams).toBe(0);
        } finally {
            svc.stop();
        }
    });
});

describe('fuelling Ride tile & Settings controls', () => {
    test('renders Carbs burned, intake needed, burn rate, and target band in custom elements', () => {
        document.body.innerHTML = `
            <fuelling-burned>0g</fuelling-burned>
            <fuelling-intake>0g</fuelling-intake>
            <fuelling-rate>0</fuelling-rate>
            <fuelling-band>0–30</fuelling-band>
            <power-match>Off</power-match>
            <fuelling-reminder>Off</fuelling-reminder>
        `;

        xf.dispatch('fuelling:state', {
            burnedGrams: 48,
            intakeGrams: 22,
            burnRateGh: 112,
            band: '30–60',
        });

        expect(document.querySelector('fuelling-burned').textContent).toBe('48g');
        expect(document.querySelector('fuelling-intake').textContent).toBe('22g');
        expect(document.querySelector('fuelling-rate').textContent).toBe('112');
        expect(document.querySelector('fuelling-band').textContent).toBe('30–60');

        const sourceEvents = [];
        xf.sub('sources', s => sourceEvents.push(s));

        const pm = document.querySelector('power-match');
        const fr = document.querySelector('fuelling-reminder');
        pm.dispatchEvent(new Event('pointerup'));
        expect(sourceEvents).toContainEqual({ powerMatch: true });

        xf.dispatch('db:sources', { sources: { powerMatch: true, fuellingReminder: 20 } });
        expect(pm.textContent).toBe('On');
        expect(fr.textContent).toBe('20m');

        fr.dispatchEvent(new Event('pointerup'));
        expect(sourceEvents).toContainEqual({ fuellingReminder: 30 });
    });
});
