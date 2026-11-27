// @ts-check
import { xf, equals } from './functions.js';
import { models } from './models/models.js';
import { Sound } from './sound.js';
import { idb, DEFAULT_STORES } from './storage/idb.js';
import { riders } from './riders.js';
import { cleanupLegacyPrefs } from './legacy-prefs.js';
import { ControlMode } from './ble/enums.js';
import { TimerStatus } from './activity/enums.js';

const db = {
    // Live telemetry
    power: models.power.default,
    heartRate: models.heartRate.default,
    rrInterval: /** @type {number[]} */ ([]),
    cadence: models.cadence.default,
    speed: models.speed.default,
    sources: models.sources.default,
    smo2: models.smo2.default,
    thb: models.thb.default,
    coreBodyTemperature: 0,
    skinTemperature: 0,
    position_lat: 0,
    position_long: 0,

    // Virtual physics & course progress
    speedVirtual: models.virtualState.speed,
    altitude: models.virtualState.altitude,
    distance: models.virtualState.distance,
    ascent: models.virtualState.ascent,

    // Smoothed & zone power
    power1s: models.power1s.default,
    power3s: models.power3s.default,
    powerInZone: models.powerInZone.default,

    // Accumulators & lap averages
    powerLap: models.powerLap.default,
    heartRateLap: models.heartRateLap.default,
    cadenceLap: models.cadenceLap.default,
    kcal: models.kcal.default,
    powerAvg: models.powerAvg.default,
    virtualGear: models.virtualGear.default,
    cadenceAvg: models.cadenceAvg.default,
    heartRateAvg: models.heartRateAvg.default,

    powerLapCount: models.powerLap.count,
    heartRateLapCount: models.heartRateLap.count,
    cadenceLapCount: models.cadenceLap.count,
    powerAvgCount: models.powerAvg.count,
    cadenceAvgCount: models.cadenceAvg.count,
    heartRateAvgCount: models.heartRateAvg.count,
    heartRateMax: 0,

    // Trainer control targets
    powerTarget: models.powerTarget.default,
    resistanceTarget: models.resistanceTarget.default,
    slopeTarget: models.slopeTarget.default,
    cadenceTarget: models.cadenceTarget.default,

    mode: models.mode.default,
    page: models.page.default,
    lock: false,

    // Rider profile & appearance preferences
    ftp: models.ftp.default,
    weight: models.weight.default,
    theme: models.theme.default,
    palette: models.palette.default,
    materialSeed: models.materialSeed.default,
    mapStyle: models.mapStyle.default,
    mapApiKey: models.mapApiKey.default,
    mapTileUrl: models.mapTileUrl.default,
    measurement: models.measurement.default,
    volume: models.volume.default,

    // UI state
    powerSmoothing: 0,
    dataTileSwitch: models.dataTileSwitch.default,
    auth: ':login',

    // Workouts & activities
    workouts: /** @type {any[]} */ ([]),
    workout: models.workout.default,
    workoutTextEvent: '',
    activity: models.activity.default,

    // Recording buffers
    records: /** @type {any[]} */ ([]),
    lap: /** @type {any[]} */ ([]),
    laps: /** @type {any[]} */ ([]),
    events: /** @type {any[]} */ ([]),
    /** @type {number | false} */
    lapStartTime: false,

    // Session watch state
    elapsed: 0,
    lapTime: 0,
    stepTime: 0,
    intervalIndex: 0,
    stepIndex: 0,
    intervalDuration: 0,
    stepDuration: 0,
    watchStatus: TimerStatus.stopped,
    workoutStatus: TimerStatus.stopped,

    // Course state
    courseIndex: 0,

    // ANT+ discovery state
    antSearchList: /** @type {any[]} */ ([]),
    antDeviceId: {},

    // Connected external services & account
    services: { strava: false, intervals: false, trainingPeaks: false },
    account: { identifier: '' },
};

xf.create(db);

// Telemetry handlers
xf.reg(models.heartRate.prop, (heartRate, state) => {
    state.heartRate = heartRate;
    state.heartRateLap = models.heartRateLap.setState(heartRate);
    state.heartRateAvg = models.heartRateAvg.setState(heartRate);
    state.heartRateLapCount = models.heartRateLap.count;
    state.heartRateAvgCount = models.heartRateAvg.count;

    if (heartRate > state.heartRateMax) {
        state.heartRateMax = heartRate;
    }
});

xf.reg('rrInterval', (rrInterval, state) => {
    state.rrInterval = rrInterval;
});

xf.reg(models.power.prop, (power, state) => {
    state.power = power;
});

xf.reg(models.cadence.prop, (cadence, state) => {
    state.cadence = cadence;
    state.cadenceLap = models.cadenceLap.setState(cadence);
    state.cadenceAvg = models.cadenceAvg.setState(cadence);
    state.cadenceLapCount = models.cadenceLap.count;
    state.cadenceAvgCount = models.cadenceAvg.count;
});

xf.reg(models.speed.prop, (speed, state) => {
    state.speed = speed;
});

xf.reg(models.smo2.prop, (smo2, state) => {
    state.smo2 = smo2;
});

xf.reg(models.thb.prop, (thb, state) => {
    state.thb = thb;
});

xf.reg('coreBodyTemperature', (coreTemp, state) => {
    state.coreBodyTemperature = coreTemp;
});

xf.reg('skinTemperature', (skinTemp, state) => {
    state.skinTemperature = skinTemp;
});

xf.reg('ble:openBikeControl:buttonState', (messages, state) => {
    state.virtualGear = models.virtualGear.apply(state.virtualGear, messages);
});

xf.reg(models.sources.prop, (patch, state) => {
    state.sources = models.sources.set(state.sources, patch);
    models.sources.backup(state.sources);
});

xf.reg('power1s', (watts, state) => {
    state.power1s = watts;
    state.powerLap = models.powerLap.setState(watts);
    state.powerAvg = models.powerAvg.setState(watts);
    state.kcal = models.kcal.setState(watts);
    state.powerLapCount = models.powerLap.count;
    state.powerAvgCount = models.powerAvg.count;
});

xf.reg('power3s', (watts, state) => {
    state.power3s = watts;
});

xf.reg('powerInZone', (distribution, state) => {
    state.powerInZone = distribution;
});

xf.reg('speedVirtual', (speedVirtual, state) => {
    state.speedVirtual = speedVirtual;
});

xf.reg('altitude', (altitude, state) => {
    state.altitude = altitude;
});

xf.reg('ascent', (ascent, state) => {
    state.ascent = ascent;
});

xf.reg('distance', (distance, state) => {
    if (equals(state.watchStatus, TimerStatus.started)) {
        state.distance = distance;
    }
});

// Navigation & control modes
xf.reg('ui:page-set', (page, state) => {
    state.page = models.page.set(page);
});

xf.reg('ui:mode-set', (mode, state) => {
    if (state.lock) return;

    state.mode = models.mode.set(mode);

    if (equals(mode, ControlMode.erg)) {
        xf.dispatch('ui:power-target-set', state.powerTarget);
    } else if (equals(mode, ControlMode.resistance)) {
        xf.dispatch('ui:resistance-target-set', state.resistanceTarget);
    } else if (equals(mode, ControlMode.sim)) {
        xf.dispatch('ui:slope-target-set', state.slopeTarget);
    }
});

xf.reg('ui:lock-set', (_, state) => {
    state.lock = !state.lock;
});

xf.reg('ui:lock-toggle', (_, state) => {
    state.lock = !state.lock;
});

xf.reg('ui:data-tile-switch-set', (index, state) => {
    state.dataTileSwitch = index;
    models.dataTileSwitch.backup(state.dataTileSwitch);
});

// Trainer targets
xf.reg('ui:power-target-set', (target, state) => {
    state.powerTarget = models.powerTarget.set(target);
});
xf.reg('ui:power-target-inc', (_, state) => {
    state.powerTarget = models.powerTarget.inc(state.powerTarget);
});
xf.reg('ui:power-target-dec', (_, state) => {
    state.powerTarget = models.powerTarget.dec(state.powerTarget);
});

xf.reg('ui:cadence-target-set', (target, state) => {
    state.cadenceTarget = models.cadenceTarget.set(target);
});

xf.reg('ui:resistance-target-set', (target, state) => {
    state.resistanceTarget = models.resistanceTarget.set(target);
});
xf.reg('ui:resistance-target-inc', (_, state) => {
    state.resistanceTarget = models.resistanceTarget.inc(state.resistanceTarget);
});
xf.reg('ui:resistance-target-dec', (_, state) => {
    state.resistanceTarget = models.resistanceTarget.dec(state.resistanceTarget);
});

xf.reg('ui:slope-target-set', (target, state) => {
    state.slopeTarget = models.slopeTarget.set(target);
});
xf.reg('ui:slope-target-inc', (_, state) => {
    state.slopeTarget = models.slopeTarget.inc(state.slopeTarget);
});
xf.reg('ui:slope-target-dec', (_, state) => {
    state.slopeTarget = models.slopeTarget.dec(state.slopeTarget);
});

// Rider profile & visual preferences
xf.reg('ui:ftp-set', (ftp, state) => {
    state.ftp = models.ftp.set(ftp);
    models.ftp.backup(state.ftp);
});

xf.reg('ui:weight-set', (weight, state) => {
    state.weight = models.weight.set(weight);
    models.weight.backup(state.weight);
});

xf.reg('ui:theme-switch', (_, state) => {
    state.theme = models.theme.switch(state.theme);
    models.theme.backup(state.theme);
});

xf.reg('ui:palette-set', (palette, state) => {
    state.palette = models.palette.set(palette);
    models.palette.backup(state.palette);
});

xf.reg('ui:palette-switch', (_, state) => {
    state.palette = models.palette.switch(state.palette);
    models.palette.backup(state.palette);
});

xf.reg('ui:materialSeed-set', (seed, state) => {
    state.materialSeed = models.materialSeed.set(seed);
    models.materialSeed.backup(state.materialSeed);
});

xf.reg('ui:mapStyle-set', (style, state) => {
    state.mapStyle = models.mapStyle.set(style);
    models.mapStyle.backup(state.mapStyle);
});

xf.reg('ui:mapStyle-switch', (_, state) => {
    state.mapStyle = models.mapStyle.switch(state.mapStyle);
    models.mapStyle.backup(state.mapStyle);
});

xf.reg('ui:mapApiKey-set', (apiKey, state) => {
    state.mapApiKey = models.mapApiKey.set(apiKey);
    models.mapApiKey.backup(state.mapApiKey);
});

xf.reg('ui:mapTileUrl-set', (tileUrl, state) => {
    state.mapTileUrl = models.mapTileUrl.set(tileUrl);
    models.mapTileUrl.backup(state.mapTileUrl);
});

xf.reg('ui:measurement-switch', (_, state) => {
    state.measurement = models.measurement.switch(state.measurement);
    models.measurement.backup(state.measurement);
});

xf.reg('ui:volume-mute', (_, state) => {
    state.volume = models.volume.mute();
    models.volume.backup(state.volume);
});

xf.reg('ui:volume-down', (_, state) => {
    state.volume = models.volume.dec(state.volume);
    models.volume.backup(state.volume);
});

xf.reg('ui:volume-up', (_, state) => {
    state.volume = models.volume.inc(state.volume);
    models.volume.backup(state.volume);
});

// Workout library & upload handlers
xf.reg('workout', (workout, state) => {
    state.workout = models.workout.set(workout);
});

xf.reg('ui:workout:select', (id, state) => {
    state.workout = models.workouts.get(state.workouts, id);
});

xf.reg('ui:workout:remove', (id, state) => {
    state.workouts = models.workouts.remove(state.workouts, id);
});

xf.reg('ui:workout:upload', async (files, state) => {
    const failures = [];
    for (const file of Object.values(files)) {
        try {
            const { result, name } = await models.workout.readFromFile(file);
            const parsed = models.workout.parse(result, name);
            models.workouts.add(state.workouts, parsed);
            xf.dispatch('db:workouts', state);
        } catch (err) {
            const rawMsg = err?.message?.startsWith(file.name)
                ? err.message
                : `${file.name}: not a valid workout file.`;
            failures.push(rawMsg.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`));
        }
    }
    if (failures.length > 0) {
        xf.dispatch('ui:modal:error:open', failures.join('<br>'));
    }
});

// Activity & session persistence
let lastSavedActivityId = null;

xf.sub('activity:add', summary => {
    if (summary?.id) lastSavedActivityId = summary.id;
});

xf.reg('watch:stopped', (_, state) => {
    try {
        models.activity.createFromCurrent(state);
        xf.dispatch('activity:save:success');
    } catch (err) {
        console.error('Failed to save activity:', err);
        xf.dispatch('activity:save:fail');
    }
});

xf.reg('watch:discarded', (payload, state) => {
    const wasRunning = Boolean(payload?.wasRunning);
    state.watchStatus = 'stopped';
    models.session.reset(state);
    if (!wasRunning && lastSavedActivityId) {
        const id = lastSavedActivityId;
        lastSavedActivityId = null;
        if (Array.isArray(state.activity)) {
            state.activity = state.activity.filter(a => a?.id !== id);
        }
        models.activity.remove(id);
        import('./training/history.js').then(({ history }) => history.deleteRide(id)).catch(() => {});
    }
    xf.dispatch('activity:discarded');
});

xf.reg('activity:save:success', (_, state) => {
    models.session.reset(state);
});

xf.reg('ui:activity:save', () => {
    xf.dispatch('ui:page-set', 'workouts');
});

// Course tracking
xf.reg('course:index', (index, state) => {
    state.courseIndex = index;
});

xf.reg('course:position', (pos, state) => {
    state.position_lat = pos.position_lat;
    state.position_long = pos.position_long;
});

// Wake lock session checkpoints
xf.reg('lock:beforeunload', (_, state) => {
    models.session.backup(state);
});

xf.reg('lock:release', (_, state) => {
    models.session.backup(state);
});

// ANT+ device pairing
xf.reg('ui:ant:request:selected', (deviceNumberStr, state) => {
    const targetNumber = parseInt(deviceNumberStr, 10);
    state.antDeviceId = state.antSearchList.find(d => d.deviceNumber === targetNumber);
});

xf.reg('ant:search:device-found', (device, state) => {
    if (state.antSearchList.some(d => d.deviceNumber === device.deviceNumber)) {
        return;
    }
    state.antSearchList.push(device);
    state.antSearchList = state.antSearchList;
});

xf.reg('ant:search:stopped', (_, state) => {
    state.antSearchList = [];
});

xf.reg('auth', () => {});

xf.reg('services', (patch, state) => {
    state.services = Object.assign(state.services, patch);
});

// Application bootstrap
xf.reg('app:start', async (_, state) => {
    try {
        cleanupLegacyPrefs(localStorage, riders.key);
    } catch {}

    state.ftp = models.ftp.set(models.ftp.restore());
    state.weight = models.weight.set(models.weight.restore());
    state.theme = models.theme.set(models.theme.restore());
    state.palette = models.palette.set(models.palette.restore());
    state.materialSeed = models.materialSeed.set(models.materialSeed.restore());
    state.mapStyle = models.mapStyle.set(models.mapStyle.restore());
    state.mapApiKey = models.mapApiKey.set(models.mapApiKey.restore());
    state.mapTileUrl = models.mapTileUrl.set(models.mapTileUrl.restore());
    state.measurement = models.measurement.set(models.measurement.restore());
    state.volume = models.volume.set(models.volume.restore());
    state.dataTileSwitch = models.dataTileSwitch.set(models.dataTileSwitch.restore());
    state.sources = models.sources.set(models.sources.restore());

    await idb.start(riders.dbName('store'), 6, DEFAULT_STORES);
    state.workouts = await models.workouts.restore();
    state.activity = await models.activity.restore();
    state.workout = models.workout.restore(state);

    await models.session.restore(state);
    xf.dispatch('workout:restore');
    xf.dispatch('activity:restore');

    models.kcal.restore(state);
    models.powerLap.restore(state);
    models.powerAvg.restore(state);
    models.cadenceLap.restore(state);
    models.cadenceAvg.restore(state);
    models.heartRateLap.restore(state);
    models.heartRateAvg.restore(state);

    const sound = Sound({ volume: state.volume });
    sound.start();
});

xf.dispatch('db:start');

export { db };
