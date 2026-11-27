// @ts-check
import { equals, exists, empty, xf } from './functions.js';
import { models } from './models/models.js';
import { ControlMode } from './ble/enums.js';
import { TimerStatus, EventType } from './activity/enums.js';
import { confirmAction } from './views/confirm.js';

const DEFAULT_CUE_DURATION_S = 10;
const AUTO_PAUSE_TICKS = 4;
const AUTO_RESUME_WATTS = 40;

function createFallbackClock() {
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let intervalId;
    /** @type {Set<(ev: { data: string }) => void>} */
    const listeners = new Set();

    function stopClock() {
        if (intervalId !== undefined) {
            clearInterval(intervalId);
            intervalId = undefined;
        }
    }

    function startClock() {
        stopClock();
        intervalId = setInterval(() => {
            for (const listener of listeners) {
                listener({ data: 'tick' });
            }
        }, 1000);
    }

    return {
        postMessage(command) {
            if (command === 'start') startClock();
            else if (command === 'stop' || command === 'pause') stopClock();
        },
        addEventListener(type, handler) {
            if (type === 'message') listeners.add(handler);
        },
        removeEventListener(type, handler) {
            if (type === 'message') listeners.delete(handler);
        },
    };
}

const clockWorker = typeof Worker === 'function'
    ? new Worker(new URL('./timer.js', import.meta.url), { type: 'module' })
    : createFallbackClock();

function flattenTextCues(intervals) {
    /** @type {Array<{ start: number, end: number, message: string }>} */
    const cues = [];
    if (!exists(intervals) || empty(intervals)) return cues;

    let timelineCursor = 0;

    for (let i = 0; i < intervals.length; i++) {
        const steps = intervals[i].steps ?? [];
        for (let s = 0; s < steps.length; s++) {
            const step = steps[s];
            if (!exists(step.duration)) continue;

            const messages = step.messages ?? [];
            for (let m = 0; m < messages.length; m++) {
                const entry = messages[m];
                if (!exists(entry.offset)) continue;
                const start = timelineCursor + entry.offset;
                const duration = exists(entry.duration) ? entry.duration : DEFAULT_CUE_DURATION_S;
                cues.push({
                    start,
                    end: start + duration,
                    message: entry.message,
                });
            }

            timelineCursor += step.duration;
        }
    }

    return cues;
}

function resolveWorkoutSecond(intervals, intervalIndex, stepIndex, stepDuration, stepTimeRemaining) {
    if (!exists(intervals) || empty(intervals)) return 0;

    let cursor = 0;

    for (let i = 0; i < intervalIndex; i++) {
        const steps = intervals[i]?.steps ?? [];
        for (let s = 0; s < steps.length; s++) {
            if (exists(steps[s].duration)) {
                cursor += steps[s].duration;
            }
        }
    }

    const activeSteps = intervals[intervalIndex]?.steps ?? [];
    for (let s = 0; s < stepIndex; s++) {
        if (exists(activeSteps[s]?.duration)) {
            cursor += activeSteps[s].duration;
        }
    }

    if (exists(stepDuration)) {
        cursor += stepDuration - stepTimeRemaining;
    }

    return cursor;
}

function activeCueAt(cues, second) {
    if (!exists(cues) || empty(cues)) return '';
    let current = '';
    for (let i = 0; i < cues.length; i++) {
        if (second >= cues[i].start && second < cues[i].end) {
            current = cues[i].message;
        }
    }
    return current;
}

class SessionWatch {
    constructor() {
        this.elapsed = 0;
        this.lapTime = 0;
        this.stepTime = 0;

        this.intervalIndex = 0;
        this.stepIndex = 0;
        this.intervalDuration = 0;
        this.stepDuration = 0;

        /** @type {string} */
        this.state = TimerStatus.stopped;
        /** @type {string} */
        this.stateWorkout = TimerStatus.stopped;
        this.intervalType = 'duration';

        /** @type {any[]} */
        this.intervals = [];
        /** @type {Array<{ start: number, end: number, message: string }>} */
        this.textEvents = [];
        this.textEvent = '';
        this.workoutType = 'workout';

        this.autoStartCounter = 3;
        this.autoPauseCounter = 0;
        this.hasBeenAutoPaused = false;
        this.autoPause = true;
        this.autoStart = true;

        /** @type {number | undefined} */
        this.lapDuration = undefined;
        /** @type {any} */
        this.points = undefined;

        this.init();
    }

    init() {
        xf.sub('db:elapsed', val => { this.elapsed = val; });
        xf.sub('db:lapTime', val => { this.lapTime = val; });
        xf.sub('db:stepTime', val => { this.stepTime = val; });
        xf.sub('db:intervalDuration', val => {
            this.intervalDuration = val;
            this.lapDuration = val;
        });
        xf.sub('db:stepDuration', val => { this.stepDuration = val; });
        xf.sub('db:intervalIndex', val => { this.intervalIndex = val; });
        xf.sub('db:stepIndex', val => { this.stepIndex = val; });
        xf.sub('db:watchStatus', val => { this.state = val; });
        xf.sub('db:workoutStatus', val => {
            this.stateWorkout = val;

            if (!this.isWorkoutStarted()) {
                this.dispatchTextEvent();
            }

            if (this.isWorkoutDone()) {
                xf.dispatch('watch:lap');
                xf.dispatch('ui:slope-target-set', 0);
                xf.dispatch('ui:mode-set', ControlMode.sim);
            }
        });

        xf.sub('db:workout', workout => {
            this.intervals = workout?.intervals ?? [];
            this.points = workout?.points;
            this.textEvents = flattenTextCues(this.intervals);
            const category = workout?.meta?.category?.toLowerCase() ?? '';
            this.workoutType = category.includes('test') ? 'test' : 'workout';
            this.dispatchTextEvent();
        });

        xf.sub('db:power1s', watts => this.onPower1s(watts));
        xf.sub('db:sources', sources => this.onSources(sources));
        clockWorker.addEventListener('message', () => this.onTick());

        xf.sub('ui:workoutStart', () => this.startWorkout());
        xf.sub('ui:watchStart', () => this.start());
        xf.sub('workout:restore', () => this.restoreWorkout());
        xf.sub('ui:watchPause', () => this.pause());
        xf.sub('ui:watchResume', () => this.resume());
        xf.sub('ui:watchLap', () => {
            if (this.isStarted()) this.lap();
        });
        xf.sub('ui:watchBack', () => this.back());
        xf.sub('ui:watchStop', async () => {
            const confirmed = await confirmAction({
                title: 'End ride?',
                message: 'Stop the clock and finish this ride?',
                confirmLabel: 'End ride',
                danger: true,
            });
            if (confirmed) {
                this.stop();
                xf.dispatch('ui:toast', 'Ride ended — tap Save to keep it');
            }
        });
    }

    isStarted() { return this.state === TimerStatus.started; }
    isPaused() { return this.state === TimerStatus.paused; }
    isStopped() { return this.state === TimerStatus.stopped; }
    isWorkoutStarted() { return this.stateWorkout === TimerStatus.started; }
    isWorkoutDone() { return this.stateWorkout === 'done'; }
    isIntervalType(type) { return equals(this.intervalType, type); }
    status() { return this.state; }

    onSources(sources) {
        if (!exists(sources)) return;
        this.autoPause = sources.autoPause ?? this.autoPause;
        this.autoStart = sources.autoStart ?? this.autoStart;
    }

    onPower1s(watts) {
        if (this.autoPause && this.workoutType !== 'test') {
            if (watts === 0 && this.isStarted()) {
                this.autoPauseCounter += 1;
            } else {
                this.autoPauseCounter = 0;
            }

            if (this.autoPauseCounter >= AUTO_PAUSE_TICKS) {
                this.autoPauseCounter = 0;
                xf.dispatch('ui:watchPause');
                this.hasBeenAutoPaused = true;
            }

            if (watts > AUTO_RESUME_WATTS && this.hasBeenAutoPaused) {
                xf.dispatch('ui:watchResume');
            }
        }

        if (this.autoStart && this.isStopped()) {
            if (this.autoStartCounter < 0) return;

            if (this.autoStartCounter === 0) {
                this.autoStartCounter = -1;
                xf.dispatch('ui:watchStart');
                xf.dispatch('ui:workoutStart');
                xf.dispatch('ui:autoStartCounter', -1);
                return;
            }

            if (watts === 0) {
                this.autoStartCounter = 3;
                xf.dispatch('ui:autoStartCounter', this.autoStartCounter);
            } else if (watts > AUTO_RESUME_WATTS) {
                this.autoStartCounter -= 1;
                xf.dispatch('ui:autoStartCounter', this.autoStartCounter);
            }
        }
    }

    start() {
        if (this.isStarted() && !this.isWorkoutStarted()) {
            this.pause();
            return;
        }
        clockWorker.postMessage('start');
        xf.dispatch('watch:started');
        xf.dispatch('watch:event', {
            timestamp: Date.now(),
            type: EventType.start,
        });
    }

    startWorkout() {
        this.autoStartCounter = -1;
        xf.dispatch('ui:autoStartCounter', -1);

        if (this.isWorkoutStarted() || (this.isWorkoutDone() && this.intervalIndex > 0)) {
            return;
        }

        if (exists(this.intervals) && !empty(this.intervals)) {
            const firstIntervalDur = this.intervals[0]?.duration ?? 0;
            const firstStepDur = this.intervals[0]?.steps?.[0]?.duration ?? 0;

            xf.dispatch('watch:intervalIndex', 0);
            xf.dispatch('watch:stepIndex', 0);
            xf.dispatch('workout:started');
            xf.dispatch('watch:intervalDuration', firstIntervalDur);
            xf.dispatch('watch:stepDuration', firstStepDur);
            xf.dispatch('watch:lapTime', firstIntervalDur);
            xf.dispatch('watch:stepTime', firstStepDur);
        }

        if (exists(this.points)) {
            this.intervalType = 'distance';
        } else {
            this.intervalType = 'duration';
        }

        if (!this.isStarted()) {
            this.start();
        }

        this.dispatchTextEvent();
    }

    restoreWorkout() {
        if (this.isWorkoutStarted()) {
            xf.dispatch('workout:started');
        }
        if (this.isStarted()) {
            this.pause();
        }
    }

    resume() {
        if (!this.isStarted()) {
            clockWorker.postMessage('start');
            xf.dispatch('watch:started');
            xf.dispatch('watch:event', {
                timestamp: Date.now(),
                type: EventType.start,
            });
            this.hasBeenAutoPaused = false;
        }
    }

    pause() {
        clockWorker.postMessage('pause');
        xf.dispatch('watch:paused');
        xf.dispatch('watch:event', {
            timestamp: Date.now(),
            type: EventType.stop,
        });
    }

    stop() {
        if (!this.isStarted() && !this.isPaused()) return;

        clockWorker.postMessage('stop');
        xf.dispatch('watch:event', {
            timestamp: Date.now(),
            type: EventType.stop,
        });

        if (this.isWorkoutStarted()) {
            xf.dispatch('workout:stopped');
        }

        this.lap();
        xf.dispatch('watch:stopped');

        if (exists(this.intervals) && !empty(this.intervals)) {
            xf.dispatch('watch:intervalIndex', 0);
            xf.dispatch('watch:stepIndex', 0);
        }
        xf.dispatch('watch:elapsed', 0);
        xf.dispatch('watch:lapTime', 0);
    }

    onTick() {
        const nextElapsed = this.elapsed + 1;
        let nextLapTime = this.lapTime;
        let nextStepTime = this.stepTime;

        if (this.isWorkoutStarted() && !equals(this.stepTime, 0)) {
            nextLapTime -= 1;
            nextStepTime -= 1;
        } else {
            nextLapTime += 1;
        }

        if (equals(nextLapTime, 4) && nextStepTime > 0) {
            xf.dispatch('watch:beep', 'interval');
        }

        xf.dispatch('watch:elapsed', nextElapsed);
        xf.dispatch('watch:lapTime', nextLapTime);
        xf.dispatch('watch:stepTime', nextStepTime);

        if (this.isWorkoutStarted() && nextStepTime <= 0 && this.isIntervalType('duration')) {
            this.step();
        }

        this.dispatchTextEvent();
    }

    dispatchTextEvent() {
        let message = '';
        if (this.isWorkoutStarted() && exists(this.intervals) && !empty(this.intervals)) {
            const second = resolveWorkoutSecond(
                this.intervals,
                this.intervalIndex,
                this.stepIndex,
                this.stepDuration,
                this.stepTime,
            );
            message = activeCueAt(this.textEvents, second);
        }

        if (equals(message, this.textEvent)) return;
        this.textEvent = message;
        xf.dispatch('watch:workoutTextEvent', message);
    }

    lap() {
        if (this.isWorkoutStarted()) {
            const nextIdx = this.intervalIndex + 1;
            if (nextIdx < this.intervals.length) {
                this.advanceInterval(this.intervals, nextIdx, 0);
                this.advanceStep(this.intervals, nextIdx, 0);
            } else {
                xf.dispatch('workout:done');
            }
        } else {
            xf.dispatch('watch:lap');
            xf.dispatch('watch:lapTime', 0);
        }
    }

    step() {
        const currentSteps = this.intervals[this.intervalIndex]?.steps ?? [];
        if (this.stepIndex + 1 < currentSteps.length) {
            this.advanceStep(this.intervals, this.intervalIndex, this.stepIndex + 1);
        } else if (this.intervalIndex + 1 < this.intervals.length) {
            const nextIntervalIdx = this.intervalIndex + 1;
            this.advanceInterval(this.intervals, nextIntervalIdx, 0);
            this.advanceStep(this.intervals, nextIntervalIdx, 0);
        } else {
            xf.dispatch('workout:done');
        }
    }

    back() {
        if (this.isWorkoutStarted()) {
            if (this.intervalIndex > 0) {
                const prevIdx = this.intervalIndex - 1;
                this.advanceInterval(this.intervals, prevIdx, 0);
                this.advanceStep(this.intervals, prevIdx, 0);
            }
        } else {
            xf.dispatch('watch:lap');
            xf.dispatch('watch:lapTime', 0);
        }
    }

    advanceInterval(intervals, intervalIdx, _stepIdx) {
        const duration = intervals[intervalIdx]?.duration;
        if (exists(duration)) {
            xf.dispatch('watch:intervalDuration', duration);
            xf.dispatch('watch:lapTime', duration);
            xf.dispatch('watch:intervalIndex', intervalIdx);
            xf.dispatch('watch:lap');
        }
    }

    advanceStep(intervals, intervalIdx, stepIdx) {
        const stepDuration = intervals[intervalIdx]?.steps?.[stepIdx]?.duration;
        if (exists(stepDuration)) {
            this.intervalType = 'duration';
            xf.dispatch('watch:stepDuration', stepDuration);
            xf.dispatch('watch:stepTime', stepDuration);
            xf.dispatch('watch:stepIndex', stepIdx);
            xf.dispatch('watch:step');
        }
    }
}

xf.reg('watch:intervalDuration', (duration, dbState) => { dbState.intervalDuration = duration; });
xf.reg('watch:lapDuration', (duration, dbState) => { dbState.intervalDuration = duration; });
xf.reg('watch:stepDuration', (duration, dbState) => { dbState.stepDuration = duration; });
xf.reg('watch:lapTime', (seconds, dbState) => { dbState.lapTime = seconds; });
xf.reg('watch:stepTime', (seconds, dbState) => { dbState.stepTime = seconds; });
xf.reg('watch:workoutTextEvent', (message, dbState) => { dbState.workoutTextEvent = message; });
xf.reg('watch:intervalIndex', (index, dbState) => { dbState.intervalIndex = index; });

xf.reg('watch:stepIndex', (index, dbState) => {
    dbState.stepIndex = index;
    const step = dbState.workout?.intervals?.[dbState.intervalIndex]?.steps?.[index];
    if (!exists(step)) return;

    const { power: powerTarget, slope: slopeTarget, cadence: cadenceTarget, distance: distanceTarget } = step;

    if (exists(slopeTarget)) {
        xf.dispatch('ui:slope-target-set', slopeTarget);
        if (!equals(dbState.mode, ControlMode.sim)) {
            xf.dispatch('ui:mode-set', ControlMode.sim);
        }
    }

    if (exists(distanceTarget)) {
        xf.dispatch('ui:distance-target-set', distanceTarget);
    }

    xf.dispatch('ui:cadence-target-set', exists(cadenceTarget) ? cadenceTarget : 0);

    if (exists(powerTarget)) {
        xf.dispatch('ui:power-target-set', models.ftp.toAbsolute(powerTarget, dbState.ftp));
        if (!exists(slopeTarget) && !equals(dbState.mode, ControlMode.erg)) {
            xf.dispatch('ui:mode-set', ControlMode.erg);
        }
    } else {
        xf.dispatch('ui:power-target-set', 0);
    }
});

xf.reg('workout:started', (_, dbState) => { dbState.workoutStatus = TimerStatus.started; });
xf.reg('workout:stopped', (_, dbState) => { dbState.workoutStatus = TimerStatus.stopped; });
xf.reg('workout:done', (_, dbState) => { dbState.workoutStatus = 'done'; });

xf.reg('watch:started', (_, dbState) => {
    dbState.watchStatus = TimerStatus.started;
    if (dbState.lapStartTime === false) {
        dbState.lapStartTime = Date.now();
    }
});
xf.reg('watch:paused', (_, dbState) => { dbState.watchStatus = TimerStatus.paused; });
xf.reg('watch:stopped', (_, dbState) => { dbState.watchStatus = TimerStatus.stopped; });

xf.reg('watch:elapsed', models.session.elapsed);
xf.reg('watch:lap', models.session.lap);
xf.reg('watch:event', models.session.event);

const watch = new SessionWatch();

export { watch, SessionWatch, flattenTextCues, resolveWorkoutSecond, activeCueAt };
