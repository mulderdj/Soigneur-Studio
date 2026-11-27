import {
    xf, exists, existance, empty, equals, mavg, avg,
    first, second, last, clamp, toFixed, isArray, isString, isObject,
} from '../functions.js';
import { inRange, dateToDashString, timeDiff, pad } from '../utils.js';
import { LocalStorageItem } from '../storage/local-storage.js';
import { idb } from '../storage/idb.js';
import { uuid } from '../storage/uuid.js';
import { workouts as builtinWorkouts } from '../workouts/workouts.js';
import { zwo } from '../workouts/zwo.js';
import { toZwo } from '../workouts/formats.js';
import { protocols as testProtocols } from '../tests/protocols.js';
import { fileHandler } from '../file.js';
import { Model as CyclingPhysics } from '../physics.js';
import { fit } from '../fit/fit.js';
import { Device, Status, ControlMode } from '../ble/enums.js';
import { TimerStatus, EventType } from '../activity/enums.js';

class BaseModel {
    constructor(options = {}) {
        this.init(options);
        this.prop = options.prop;
        this.default = existance(options.default, this.defaultValue());
        this.prev = options.default;
        this.set = existance(options.set, this.defaultSet);
        this.parser = existance(options.parser, this.defaultParse);
        this.isValid = existance(options.isValid, this.defaultIsValid);
        this.onInvalid = existance(options.onInvalid, this.defaultOnInvalid);
        this.storage = this.defaultStorage();
        this.postInit(options);
    }

    init(_options) {}
    postInit(_options) {}
    defaultValue() { return ''; }
    defaultIsValid(value) { return exists(value); }
    defaultParse(value) { return value; }

    defaultSet(value) {
        if (this.isValid(value)) {
            this.state = value;
            return value;
        }
        this.defaultOnInvalid(value);
        return this.default;
    }

    defaultOnInvalid(value) {
        console.error(`Invalid value for ${this.prop}:`, value);
    }

    defaultStorage() {
        return {
            add: x => x,
            set: x => x,
            restore: () => this.default,
        };
    }

    backup(value) {
        this.storage.set(value);
    }

    restore() {
        return this.parser(this.storage.restore());
    }
}

class BoundedMetric extends BaseModel {
    postInit(options = {}) {
        const [minDefault, maxDefault] = this.bounds();
        this.min = existance(options.min, minDefault);
        this.max = existance(options.max, maxDefault);
    }

    bounds() { return [0, 100]; }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        return Number.isInteger(value) && inRange(this.min, this.max, value);
    }
}

class Power extends BoundedMetric {
    bounds() { return [0, 2500]; }
}

class HeartRate extends BoundedMetric {
    bounds() { return [0, 255]; }
}

class Cadence extends BoundedMetric {
    bounds() { return [0, 255]; }
}

class Speed extends BoundedMetric {
    bounds() { return [0, 120]; }
    defaultIsValid(value) {
        return Number.isFinite(value) && inRange(this.min, this.max, value);
    }
    kmhToMps(kmh) { return kmh / 3.6; }
    mpsToKmh(mps) { return mps * 3.6; }
    mpsToMph(mps) { return mps * 2.23693629; }
    kmhToMph(kmh) { return kmh * 0.621371192; }
}

class SmO2 extends BaseModel {
    postInit(options = {}) {
        this.min = existance(options.min, 0);
        this.max = existance(options.max, 100);
        this.zones = { one: 30, two: 70, three: 100 };
    }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        return Number.isFinite(value) && inRange(this.min, this.max, value);
    }
}

class THb extends BaseModel {
    postInit(options = {}) {
        this.min = existance(options.min, 0);
        this.max = existance(options.max, 400);
    }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        return Number.isFinite(value) && inRange(this.min, this.max, value);
    }
}

class Sources extends BaseModel {
    postInit(options = {}) {
        this.state = this.default;
        xf.sub('db:sources', value => { this.state = value; });

        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
            parse: JSON.parse,
            encode: JSON.stringify,
        });
    }

    defaultSet(target, patch) {
        if (exists(patch)) {
            return Object.assign(target, patch);
        }
        return target;
    }

    isSource(path, expected) {
        return exists(this.state?.[path]) && equals(this.state[path], expected);
    }

    defaultValue() {
        return {
            power: 'ble:controllable',
            cadence: 'ble:controllable',
            speed: 'ble:controllable',
            control: 'ble:controllable',
            heartRate: 'ble:heartRateMonitor',
            smo2: 'ble:smo2',
            thb: 'ble:smo2',
            coreBodyTemperature: 'ble:coreTemp',
            skinTemperature: 'ble:coreTemp',

            virtualState: 'power',
            powerMatch: false,
            fuellingReminder: 0,
            autoPause: true,
            autoStart: true,
            theme: 'DARK',

            powerZStack: 0,
            heartRateZStack: 0,
            cadenceZStack: 0,
            kcalZStack: 0,
            graphZStack: 0,
            fuellingZStack: 0,
        };
    }
}

class StepTarget extends BaseModel {
    postInit(options = {}) {
        const [minDefault, maxDefault, stepDefault] = this.targetDefaults();
        this.min = existance(options.min, minDefault);
        this.max = existance(options.max, maxDefault);
        this.step = existance(options.step, stepDefault);
    }

    targetDefaults() { return [0, 100, 1]; }
    defaultValue() { return 0; }
    parse(value) { return parseInt(value, 10); }

    defaultIsValid(value) {
        return Number.isInteger(value) && inRange(this.min, this.max, value);
    }

    defaultSet(value) {
        if (Number.isNaN(Number(value))) {
            this.onInvalid(value);
            return this.default;
        }
        return clamp(this.min, this.max, this.parse(value));
    }

    inc(current) {
        return this.set(current + this.step);
    }

    dec(current) {
        return this.set(current - this.step);
    }
}

class Volume extends StepTarget {
    postInit(options = {}) {
        this.min = existance(options.min, 0);
        this.max = existance(options.max, 100);
        this.step = existance(options.step, 10);
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
            parse: val => parseInt(val, 10),
        });
    }

    mute() {
        return this.set(this.min);
    }
}

class PowerTarget extends StepTarget {
    targetDefaults() { return [0, 4000, 10]; }
}

class ResistanceTarget extends StepTarget {
    targetDefaults() { return [-100, 100, 10]; }
}

class SlopeTarget extends StepTarget {
    targetDefaults() { return [-40, 40, 0.5]; }
    parse(value) { return parseFloat(value); }
    defaultIsValid(value) {
        return Number.isFinite(value) && inRange(this.min, this.max, value);
    }
}

class CadenceTarget extends StepTarget {
    targetDefaults() { return [0, 255, 5]; }
}

class Mode extends BaseModel {
    postInit() {
        this.state = this.defaultValue();
        this.values = Object.values(ControlMode);
    }
    defaultValue() { return ControlMode.erg; }
    defaultIsValid(value) { return this.values.includes(value); }
}

class Page extends BaseModel {
    postInit() {
        this.values = ['settings', 'home', 'training', 'workouts', 'analysis'];
    }
    defaultValue() { return 'home'; }
    defaultIsValid(value) { return this.values.includes(value); }
}

const ZONE_COLORS = {
    one: '#636468',
    two: '#328AFF',
    three: '#44A5AB',
    thee: '#44A5AB',
    four: '#57C057',
    five: '#F8C73A',
    six: '#FF663A',
    seven: '#FE340B',
};

class FTP extends BaseModel {
    postInit(options = {}) {
        this.state = this.default;
        this.min = existance(options.min, 0);
        this.max = existance(options.max, 500);
        this.zones = existance(options.zones, ['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
        this.percentages = existance(options.percentages, {
            one: 0.54,
            two: 0.75,
            three: 0.87,
            four: 0.94,
            five: 1.05,
            six: 1.20,
        });
        this.minAbsValue = 9;
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
            parse: val => parseInt(val, 10),
        });
    }

    defaultValue() { return 200; }
    defaultIsValid(value) {
        return Number.isInteger(value) && inRange(this.min, this.max, value);
    }

    toRelative(value, ftpValue) {
        return value > this.minAbsValue ? toFixed(value / ftpValue, 2) : value;
    }

    toAbsolute(value, ftpValue) {
        if (value < this.minAbsValue) {
            const ratio = Math.round(value * 100) / 100;
            return Math.round(ratio * (ftpValue ?? this.state));
        }
        return value;
    }

    zoneIndexForRatio(ratio) {
        const p = this.percentages;
        if (ratio < p.one) return 0;
        if (ratio < p.two) return 1;
        if (ratio < p.three) return 2;
        if (ratio < p.four) return 3;
        if (ratio < p.five) return 4;
        if (ratio < p.six) return 5;
        return 6;
    }

    powerToZone(watts, ftpValue = this.state, zones = this.zones) {
        const refFtp = exists(ftpValue) ? ftpValue : this.state;
        const zoneNames = exists(zones) ? zones : this.zones;
        const index = refFtp > 0 ? this.zoneIndexForRatio(watts / refFtp) : 0;
        return { name: zoneNames[index], index };
    }

    zoneToColor(zoneName) {
        return ZONE_COLORS[zoneName] ?? '#636468';
    }

    percentageToZone(ratio) {
        return this.zones[this.zoneIndexForRatio(ratio)];
    }
}

class Weight extends BaseModel {
    postInit(options = {}) {
        this.min = existance(options.min, 0);
        this.max = existance(options.max, 500);
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
            parse: parseFloat,
        });
    }
    defaultValue() { return 75; }
    defaultIsValid(value) {
        return Number.isFinite(value) && inRange(this.min, this.max, value);
    }
}

class Theme extends BaseModel {
    postInit(options = {}) {
        this.values = ['dark', 'light'];
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
        });
    }
    defaultValue() { return 'dark'; }
    defaultIsValid(value) { return this.values.includes(value); }
    switch(current) {
        if (equals(current, first(this.values))) return second(this.values);
        if (equals(current, second(this.values))) return first(this.values);
        this.onInvalid(current);
        return this.default;
    }
}

class Palette extends BaseModel {
    postInit(options = {}) {
        this.values = ['default', 'abricot', 'material'];
        this.labels = {
            default: 'Default',
            abricot: 'Abricot Siena',
            material: 'Material You',
        };
        this.state = this.default;
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
            isValid: val => this.defaultIsValid(val),
        });
    }
    defaultValue() { return 'default'; }
    defaultIsValid(value) { return this.values.includes(value); }
    label(value) { return this.labels[value] ?? this.labels.default; }
    switch(current) {
        const idx = this.values.indexOf(current);
        if (idx === -1) {
            this.onInvalid(current);
            return this.set(this.default);
        }
        return this.set(this.values[(idx + 1) % this.values.length]);
    }
}

class MaterialSeed extends BaseModel {
    postInit(options = {}) {
        this.state = this.default;
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
            isValid: val => this.defaultIsValid(val),
        });
    }
    defaultValue() { return '#006874'; }
    defaultIsValid(value) {
        return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
    }
    set(value) {
        if (!this.defaultIsValid(value)) {
            this.onInvalid(value);
            this.state = this.default;
            return this.state;
        }
        this.state = value.trim().toUpperCase();
        return this.state;
    }
}

class MapStyle extends BaseModel {
    postInit(options = {}) {
        this.values = ['standard', 'terrain', 'cyclosm', 'satellite', 'osm', 'mapy', 'thunderforest', 'custom'];
        this.labels = {
            standard: 'Standard (Dark/Light)',
            terrain: 'Terrain (OpenTopoMap)',
            cyclosm: 'CyclOSM',
            satellite: 'Satellite (Esri)',
            osm: 'OpenStreetMap',
            mapy: 'Mapy.com Outdoor',
            thunderforest: 'Thunderforest',
            custom: 'Custom URL',
        };
        this.state = this.default;
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
            isValid: val => this.defaultIsValid(val),
        });
    }
    defaultValue() { return 'standard'; }
    defaultIsValid(value) { return this.values.includes(value); }
    label(value) { return this.labels[value] ?? this.labels.standard; }
    switch(current) {
        const idx = this.values.indexOf(current);
        if (idx === -1) {
            this.onInvalid(current);
            return this.set(this.default);
        }
        return this.set(this.values[(idx + 1) % this.values.length]);
    }
}

class TextSetting extends BaseModel {
    postInit(options = {}) {
        this.state = this.default;
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
            isValid: val => this.defaultIsValid(val),
        });
    }
    defaultValue() { return ''; }
    defaultIsValid(value) {
        return typeof value === 'string' && value.length <= 512;
    }
    set(value) {
        if (!this.defaultIsValid(value)) {
            this.state = this.default;
            return this.state;
        }
        this.state = value.trim();
        return this.state;
    }
}

class Measurement extends BaseModel {
    postInit(options = {}) {
        this.values = ['metric', 'imperial'];
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
        });
    }
    defaultValue() { return 'metric'; }
    defaultIsValid(value) { return this.values.includes(value); }
    switch(current) {
        if (equals(current, first(this.values))) return second(this.values);
        if (equals(current, second(this.values))) return first(this.values);
        this.onInvalid(current);
        return this.default;
    }
}

class DataTileSwitch extends BaseModel {
    postInit(options = {}) {
        this.values = [0, 1, 2];
        this.storage = options.storage({
            key: this.prop,
            fallback: this.defaultValue(),
        });
    }
    defaultValue() { return 0; }
    defaultIsValid(value) { return this.values.includes(value); }
    defaultParse(value) { return parseInt(value, 10); }
}

class Activity extends BaseModel {
    name = 'activity';

    postInit() {
        this.capacity = 7;
    }

    defaultValue() { return []; }

    createFromCurrent(dbState) {
        const id = uuid();
        const blob = fileHandler.toBlob(this.encode(dbState));
        const name = dbState.workout?.meta?.name ?? 'Soigneur Studio workout';

        const summary = {
            id,
            timestamp: Date.now(),
            name,
            duration: dbState.elapsed ?? 0,
            status: { strava: 'none', intervals: 'none', trainingPeaks: 'none' },
        };
        const record = { id, blob, summary };

        this.add(summary, dbState.activity);
        idb.put('activity', record);
        xf.dispatch('activity:add', summary);
    }

    add(summary, activityList) {
        activityList.unshift(summary);
        if (activityList.length > this.capacity) {
            const oldest = activityList.pop();
            if (oldest?.id) {
                idb.remove('activity', oldest.id);
            }
        }
        return activityList;
    }

    remove(id) {
        idb.remove('activity', id);
    }

    async download(id) {
        const record = await idb.get('activity', id);
        if (!record) return;
        fileHandler.download()(
            record.blob,
            this.fileName(record.summary.timestamp),
            fileHandler.Type.OctetStream,
        );
    }

    fileName(timestamp) {
        return `workout-${dateToDashString(new Date(timestamp))}.fit`;
    }

    encode(dbState) {
        return fit.localActivity.encode({
            records: dbState.records,
            laps: dbState.laps,
            events: dbState.events,
            ftp: dbState.ftp,
        });
    }

    async restore() {
        const records = (await idb.getAll('activity')) ?? [];

        for (const record of records) {
            if (typeof record?.summary?.status === 'string') {
                record.summary.status = { strava: 'none', intervals: 'none' };
                idb.put('activity', record);
            }
        }

        return records
            .map(record => record.summary)
            .sort((a, b) => b.timestamp - a.timestamp);
    }
}

class Workout extends BaseModel {
    defaultValue() {
        return this.parse(first(builtinWorkouts));
    }

    defaultIsValid(value) {
        return exists(value);
    }

    restore(dbState) {
        return first(dbState.workouts);
    }

    find(workoutList, id) {
        const match = workoutList.find(item => equals(item.id, id));
        return match ?? first(workoutList);
    }

    parse(rawInput, fileName = '') {
        if (isArray(rawInput) || isObject(rawInput)) {
            const view = new DataView(rawInput);
            return fit.localCourse.decode(view, fileName);
        }
        const parsed = zwo.readToInterval(toZwo(rawInput, fileName));
        if (parsed.intervals.length === 0) {
            throw new Error(`${fileName || 'This file'} has no workout steps.`);
        }
        return parsed;
    }

    fromIntervalsEvent(event) {
        const parsed = this.parse(atob(event.workout_file_base64));
        parsed.meta.planned = true;
        parsed.meta.startDateLocal = event.start_date_local;
        parsed.id = uuid();
        parsed.intervals_id = event.id;
        return parsed;
    }

    fromIntervalsResponse(events) {
        return events.map(ev => this.fromIntervalsEvent(ev));
    }

    fromTrainingPeaksEvent(event) {
        const parsed = this.parse(atob(event.workout_file_base64));
        parsed.meta.planned = true;
        parsed.meta.startDateLocal = event.start_date_local;
        parsed.id = uuid();
        parsed.training_peaks_id = event.id;
        return parsed;
    }

    fromTrainingPeaksResponse(events) {
        return events.map(ev => this.fromTrainingPeaksEvent(ev));
    }

    async readFromFile(file) {
        const result = await fileHandler.read(file);
        return { result, name: file.name };
    }

    encode(dbState) {
        return fit.localActivity.encode({
            records: dbState.records,
            laps: dbState.laps,
            events: dbState.events,
            ftp: dbState.ftp,
        });
    }

    fileName() {
        return `workout-${dateToDashString(new Date())}.fit`;
    }

    download(dbState) {
        fileHandler.download()(this.encode(dbState), this.fileName(), fileHandler.Type.OctetStream);
    }
}

class Workouts extends BaseModel {
    name = 'workouts';

    init(options) {
        this.workoutModel = options.workoutModel;
    }

    defaultValue() {
        const builtIn = builtinWorkouts.map(xml => ({
            ...this.workoutModel.parse(xml),
            id: uuid(),
        }));
        return builtIn.concat(testProtocols());
    }

    defaultIsValid(value) {
        return exists(value);
    }

    async restore() {
        const saved = (await idb.getAll(this.name)) ?? [];
        return empty(saved) ? this.default : this.default.concat(saved);
    }

    get(workoutList, id) {
        const match = workoutList.find(item => equals(item.id, id));
        return match ?? first(workoutList);
    }

    add(workoutList, item) {
        workoutList.push(idb.setId(item));
        this.save(item);
        return workoutList;
    }

    save(item) {
        idb.put(this.name, idb.setId(item));
    }

    remove(workoutList, id) {
        if (!exists(id) || (isString(id) && empty(id))) {
            return workoutList;
        }
        idb.remove(this.name, id);
        return workoutList.filter(item => item.id !== id);
    }
}

function createSessionModel() {
    const storeName = 'session';

    function dbToSession(dbState) {
        return {
            elapsed: dbState.elapsed,
            lapTime: dbState.lapTime,
            stepTime: dbState.stepTime,
            intervalIndex: dbState.intervalIndex,
            stepIndex: dbState.stepIndex,
            intervalDuration: dbState.intervalDuration,
            stepDuration: dbState.stepDuration,
            lapStartTime: dbState.lapStartTime,
            watchStatus: dbState.watchStatus,
            workoutStatus: dbState.workoutStatus,

            courseIndex: dbState.courseIndex,
            speedVirtual: dbState.speedVirtual,
            speed: dbState.speed,

            records: dbState.records,
            laps: dbState.laps,
            events: dbState.events,
            lap: dbState.lap,
            distance: dbState.distance,
            altitude: dbState.altitude,
            position_lat: dbState.position_lat,
            position_long: dbState.position_long,

            kcal: dbState.kcal,
            powerLap: dbState.powerLap,
            cadenceLap: dbState.cadenceLap,
            heartRateLap: dbState.heartRateLap,
            powerAvg: dbState.powerAvg,
            cadenceAvg: dbState.cadenceAvg,
            heartRateAvg: dbState.heartRateAvg,
            powerLapCount: dbState.powerLapCount,
            cadenceLapCount: dbState.cadenceLapCount,
            heartRateLapCount: dbState.heartRateLapCount,
            powerAvgCount: dbState.powerAvgCount,
            cadenceAvgCount: dbState.cadenceAvgCount,
            heartRateAvgCount: dbState.heartRateAvgCount,

            powerInZone: dbState.powerInZone,

            workout: dbState.workout,
            mode: dbState.mode,
            lock: dbState.lock,
            page: dbState.page,

            powerTarget: dbState.powerTarget,
            resistanceTarget: dbState.resistanceTarget,
            slopeTarget: dbState.slopeTarget,

            powerSmoothing: dbState.powerSmoothing,
        };
    }

    function sessionToDb(dbState, snapshot) {
        return Object.assign(dbState, snapshot);
    }

    function backup(dbState) {
        idb.put(storeName, idb.setId(dbToSession(dbState), 0));
    }

    async function restore(dbState) {
        const snapshots = (await idb.getAll(storeName)) ?? [];
        xf.dispatch(`${storeName}:restore`, snapshots);

        if (!empty(snapshots)) {
            const latest = last(snapshots);
            if (latest.elapsed > 0) {
                sessionToDb(dbState, latest);
            } else {
                idb.clear(storeName);
            }
        }
    }

    function reset(dbState) {
        dbState.records = [];
        dbState.lap = [];
        dbState.laps = [];
        dbState.events = [];
        dbState.lapStartTime = false;
        dbState.rrInterval = [];

        dbState.elapsed = 0;
        dbState.lapTime = 0;
        dbState.stepTime = 0;
        dbState.intervalIndex = 0;
        dbState.stepIndex = 0;
        dbState.intervalDuration = 0;
        dbState.stepDuration = 0;

        dbState.resistanceTarget = 0;
        dbState.slopeTarget = 0;
        dbState.powerTarget = 0;
        dbState.position_lat = 0;
        dbState.position_long = 0;
        dbState.altitude = virtualState.altitude;
        dbState.distance = virtualState.distance;
        dbState.ascent = virtualState.ascent;
        dbState.powerLap = powerLap.default;
        dbState.heartRateLap = heartRateLap.default;
        dbState.cadenceLap = cadenceLap.default;
        dbState.kcal = kcal.default;
        dbState.powerAvg = powerAvg.default;
        dbState.cadenceAvg = cadenceAvg.default;
        dbState.heartRateAvg = heartRateAvg.default;
        dbState.powerLapCount = powerLap.count;
        dbState.heartRateLapCount = heartRateLap.count;
        dbState.cadenceLapCount = cadenceLap.count;
        dbState.powerAvgCount = powerAvg.count;
        dbState.cadenceAvgCount = cadenceAvg.count;
        dbState.heartRateAvgCount = heartRateAvg.count;
    }

    function elapsed(seconds, dbState) {
        if (equals(dbState.watchStatus, TimerStatus.stopped)) {
            dbState.elapsed = seconds;
            return;
        }

        dbState.elapsed = seconds;

        const hasGps =
            Number.isFinite(dbState.position_lat) &&
            Number.isFinite(dbState.position_long) &&
            !(dbState.position_lat === 0 && dbState.position_long === 0);

        const useMeasuredSpeed =
            equals(dbState.sources.virtualState, 'speed') ||
            equals(dbState.sources.speed, 'gps') ||
            (hasGps && dbState.speed > 0 && !(dbState.speedVirtual > 0));
        const activeSpeed = useMeasuredSpeed ? dbState.speed : dbState.speedVirtual;

        const hasElevation =
            hasGps ||
            exists(dbState.workout?.points) ||
            equals(dbState.mode, ControlMode.sim) ||
            dbState.altitude !== 0 ||
            dbState.slopeTarget !== 0;
        const hasMoxy = dbState.smo2 > 0 || dbState.thb > 0;

        const sample = {
            timestamp: Date.now(),
            power: dbState.power1s,
            cadence: dbState.cadence,
            speed: activeSpeed,
            heart_rate: dbState.heartRate > 0 ? dbState.heartRate : undefined,
            distance: dbState.distance,
            grade: hasElevation ? dbState.slopeTarget : undefined,
            altitude: hasElevation ? dbState.altitude : undefined,
            position_lat: hasGps ? dbState.position_lat : undefined,
            position_long: hasGps ? dbState.position_long : undefined,
            saturated_hemoglobin_percent: hasMoxy ? dbState.smo2 : undefined,
            total_hemoglobin_conc: dbState.thb > 0 ? dbState.thb : undefined,
            core_temperature: dbState.coreBodyTemperature > 0 ? dbState.coreBodyTemperature : undefined,
            skin_temperature: dbState.skinTemperature > 0 ? dbState.skinTemperature : undefined,
            device_index: 0,
        };

        dbState.records.push(sample);
        if (!empty(dbState.rrInterval)) {
            dbState.records.push({ time: pad([...dbState.rrInterval], 5, 0xffff) });
        }

        dbState.lap.push(sample);

        if (equals(dbState.elapsed % 60, 0)) {
            backup(dbState);
        }
    }

    function meanField(rows, field) {
        const vals = rows.map(r => r?.[field]).filter(Number.isFinite);
        return vals.length > 0 ? avg(vals) : undefined;
    }

    function maxField(rows, field) {
        const vals = rows.map(r => r?.[field]).filter(Number.isFinite);
        return vals.length > 0 ? vals.reduce((best, v) => (v > best ? v : best), vals[0]) : undefined;
    }

    function lap(_event, dbState) {
        const endTime = Date.now();
        const startTime = dbState.lapStartTime;
        const durationS = timeDiff(startTime, endTime);

        if (durationS > 0) {
            const avgCad = meanField(dbState.lap, 'cadence');
            const avgHr = meanField(dbState.lap, 'heart_rate');
            const avgSmo2 = meanField(dbState.lap, 'saturated_hemoglobin_percent');
            const avgThb = meanField(dbState.lap, 'total_hemoglobin_conc');
            const avgCore = meanField(dbState.lap, 'core_temperature');
            const avgSkin = meanField(dbState.lap, 'skin_temperature');

            dbState.laps.push({
                timestamp: endTime,
                start_time: startTime,
                totalElapsedTime: durationS,
                avgPower: dbState.powerLap,
                maxPower: maxField(dbState.lap, 'power') ?? 0,
                avgCadence: avgCad !== undefined ? Math.round(avgCad) : undefined,
                avgHeartRate: avgHr !== undefined ? Math.round(avgHr) : undefined,
                saturated_hemoglobin_percent: avgSmo2 !== undefined ? toFixed(avgSmo2, 2) : undefined,
                total_hemoglobin_conc: avgThb !== undefined ? toFixed(avgThb, 2) : undefined,
                core_temperature: avgCore !== undefined ? toFixed(avgCore, 2) : undefined,
                skin_temperature: avgSkin !== undefined ? toFixed(avgSkin, 2) : undefined,
            });
            dbState.lap = [];
        }
        dbState.lapStartTime = endTime;
    }

    function event(entry, dbState) {
        if (!empty(dbState.events) && equals(last(dbState.events).type, entry.type)) {
            return;
        }
        dbState.events.push(entry);
    }

    return Object.freeze({
        backup,
        restore,
        reset,
        sessionToDb,
        dbToSession,
        elapsed,
        lap,
        event,
    });
}

class ReactiveModel {
    constructor(options = {}) {
        this.init(options);
        const defaults = this.getDefaults();
        this.prop = options.prop ?? defaults.prop;
        this.disabled = options.default ?? defaults.disabled;
        this.default = options.default ?? defaults.default;
        this.state = options.state ?? this.default;
        this.name = options.name ?? 'reactive-prop';
        this.propName = this.kebabToCamel(options.name) ?? 'reactiveProp';
        this.postInit(options);
        this.start();
    }

    init(options) { return options; }
    postInit(options = {}) { return options; }
    getDefaults() { return { prop: '', disabled: false, default: 0 }; }
    getState() { return this.format(this.state); }
    setState(value) { return this.updateState(value); }
    format(state) { return state; }
    shouldUpdate() { return true; }

    kebabToCamel(str) {
        if (!exists(str)) return str;
        return str.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    }

    start() {
        this.abortController = new AbortController();
        this.signal = { signal: this.abortController.signal };
        this.subs();
    }

    stop() {
        this.abortController?.abort();
    }

    subs() {
        this.subsConfig();
    }

    subsConfig() {}

    onUpdate(value) {
        if (this.shouldUpdate(value)) {
            this.updateState(value);
        }
    }

    updateState(value) {
        this.state = value;
        return this.state;
    }
}

class RunningAverage extends ReactiveModel {
    postInit(options = {}) {
        const defaults = this.getDefaults();
        this.event = options.event ?? defaults.event;
        this.count = defaults.count;
        this.prev = defaults.prev;
    }

    getDefaults() {
        return {
            value: 0,
            prev: 0,
            default: 0,
            disabled: false,
            prop: '',
            event: '',
            count: 0,
        };
    }

    format(state) {
        return Math.round(state);
    }

    reset() {
        this.count = 0;
    }

    subsConfig() {
        if (!equals(this.prop, '')) {
            xf.sub(this.prop, this.onUpdate.bind(this), this.signal);
        }
        if (!equals(this.event, '')) {
            xf.sub(this.event, this.onEvent.bind(this), this.signal);
        }
    }

    updateState(value) {
        if (this.state === 0 && value === 0) {
            this.state = 0;
            return this.state;
        }
        if (value === 0) {
            return this.state;
        }
        this.count += 1;
        this.state = mavg(value, this.prev, this.count, this.count - 1);
        this.prev = this.state;
        return this.state;
    }

    onEvent() {
        this.reset();
    }

    restore(dbState) {
        this.count = dbState[`${this.propName}Count`] ?? this.count;
        this.state = dbState[this.propName] ?? this.state;
        this.prev = dbState[this.propName] ?? this.prev;
    }
}

class EnergyAccumulator extends RunningAverage {
    updateState(watts) {
        this.state += watts * 0.001;
        return this.state;
    }
}

const powerLap = new RunningAverage({ event: 'watch:lap', name: 'power-lap' });
const powerAvg = new RunningAverage({ event: 'watch:stopped', name: 'power-avg' });
const kcal = new EnergyAccumulator({ event: 'watch:stopped', name: 'kcal' });

const cadenceLap = new RunningAverage({ event: 'watch:lap', name: 'cadence-lap' });
const cadenceAvg = new RunningAverage({ event: 'watch:stopped', name: 'cadence-avg' });

const heartRateLap = new RunningAverage({ event: 'watch:lap', name: 'heart-rate-lap' });
const heartRateAvg = new RunningAverage({ event: 'watch:stopped', name: 'heart-rate-avg' });

class PropInterval {
    constructor(options = {}) {
        const defaults = this.getDefaults();
        this.default = existance(options.default, defaults.default);
        this.state = existance(options.state, defaults.default);
        this.accumulator = existance(options.accumulator, defaults.accumulator);
        this.count = existance(options.count, defaults.count);
        this.prop = existance(options.prop, defaults.prop);
        this.effect = existance(options.effect, defaults.effect);
        this.interval = existance(options.interval, defaults.interval);
        this.start();
    }

    getDefaults() {
        return {
            default: 0,
            accumulator: 0,
            count: 0,
            interval: 1000,
            prop: '',
            effect: '',
        };
    }

    start() {
        this.subs();
        this.intervalId = setInterval(() => this.onInterval(), this.interval);
    }

    stop() {
        clearInterval(this.intervalId);
        this.unsubs();
    }

    reset() {
        this.accumulator = 0;
        this.count = 0;
    }

    subs() {
        this.abortController = new AbortController();
        this.signal = { signal: this.abortController.signal };
        xf.sub(this.prop, val => this.onUpdate(val), this.signal);
    }

    unsubs() {
        this.abortController?.abort();
    }

    onUpdate(value) {
        this.accumulator += value;
        this.count += 1;
    }

    onInterval() {
        if (equals(this.count, 0)) return;
        this.state = this.accumulator / this.count;
        xf.dispatch(this.effect, this.state);
        this.reset();
    }
}

class PowerInZone {
    constructor(options = {}) {
        this.ftpModel = existance(options.ftpModel);
        const defaults = this.getDefaults();
        this.default = existance(options.default, defaults.default);
        this.count = existance(options.count, defaults.count);
        this.weights = existance(options.weights, defaults.weights);
        this.state = existance(options.state, defaults.default);
        this.prop = existance(options.prop, defaults.prop);
        this.start();
    }

    getDefaults() {
        return {
            default: this.ftpModel.zones.map(() => [0, 0]),
            weights: this.ftpModel.zones.map(() => 0),
            count: 0,
            prop: 'db:elapsed',
        };
    }

    start() { this.subs(); }
    stop() { this.unsubs(); }

    subs() {
        this.abortController = new AbortController();
        this.signal = { signal: this.abortController.signal };
        xf.reg(this.prop, (val, dbState) => this.onUpdate(val, dbState), this.signal);
    }

    unsubs() {
        this.abortController?.abort();
    }

    onUpdate(_elapsed, dbState) {
        this.updateState(dbState.power);
    }

    powerToZone(watts) {
        return this.ftpModel.powerToZone(watts);
    }

    updateState(watts) {
        if (equals(watts, 0)) return this.state;

        const zone = this.powerToZone(watts);
        this.count += 1;
        this.weights[zone.index] += 1;

        for (let i = 0; i < this.state.length; i++) {
            if (!equals(this.weights[i], 0)) {
                this.state[i] = [this.weights[i] / this.count, this.weights[i]];
            }
        }

        xf.dispatch('powerInZone', this.state);
        return this.state;
    }
}

class VirtualState extends ReactiveModel {
    postInit() {
        const defaults = this.getDefaults();
        this.speed = defaults.speed;
        this.altitude = defaults.altitude;
        this.distance = defaults.distance;
        this.ascent = defaults.ascent;
        this.slope = defaults.slope;
        this.riderWeight = defaults.riderWeight;
        this.equipmentWeight = defaults.equipmentWeight;
        this.mass = defaults.mass;
        this.source = defaults.source;
        this.cycling = CyclingPhysics({
            rho: 1.225,
            dragCoefficient: 0.88,
            frontalArea: 0.36,
            CdA: 0.3168,
        });
        this.lastUpdate = undefined;
    }

    getDefaults() {
        return {
            riderWeight: 75,
            equipmentWeight: 10,
            mass: 85,
            slope: 0,
            speed: 0,
            altitude: 0,
            distance: 0,
            ascent: 0,
            prop: 'power',
            source: 'power',
            disabled: false,
            default: 0,
        };
    }

    subs() {
        this.abortController = new AbortController();
        this.signal = { signal: this.abortController.signal };
        xf.reg(this.prop, (val, dbState) => this.onUpdate(val, dbState), this.signal);
        xf.sub('db:sources', val => this.onSources(val), this.signal);
        xf.sub('db:weight', val => this.onWeight(val), this.signal);
        xf.sub('watch:started', () => this.onStarted(), this.signal);
    }

    onSources(sourcesState) {
        if (!equals(this.source, sourcesState.virtualState)) {
            this.lastUpdate = Date.now();
        }
        this.source = sourcesState.virtualState;
    }

    onWeight(weightKg) {
        if (!(weightKg > 0)) return;
        this.riderWeight = weightKg;
        this.systemWeight = this.riderWeight + this.equipmentWeight;
        this.mass = this.systemWeight;
    }

    onStarted() {
        this.lastUpdate = Date.now();
    }

    hasActiveGps(dbState) {
        return (
            Number.isFinite(dbState.position_lat) &&
            Number.isFinite(dbState.position_long) &&
            !(dbState.position_lat === 0 && dbState.position_long === 0)
        );
    }

    onUpdate(_power, dbState) {
        if (!equals(this.source, this.prop)) return;
        const hasGps = this.hasActiveGps(dbState);
        if (hasGps && equals(dbState.sources?.speed, 'gps')) return;

        const nowMs = Date.now();
        const dt = (nowMs - this.lastUpdate) / 1000;
        this.lastUpdate = nowMs;
        if (equals(dt, 0)) return;

        const next = this.cycling.virtualSpeedCF({
            power: dbState.power,
            slope: dbState.slopeTarget / 100,
            distance: dbState.distance,
            altitude: dbState.altitude,
            ascent: dbState.ascent,
            mass: this.mass,
            speed: this.speed,
            dt: Number.isNaN(dt) ? 0.25 : dt,
        });

        this.speed = next.speed;
        xf.dispatch('speedVirtual', next.speed);
        xf.dispatch('distance', next.distance);
        if (!hasGps) {
            xf.dispatch('altitude', next.altitude);
            xf.dispatch('ascent', next.ascent);
        }
    }
}

class SpeedState extends VirtualState {
    getDefaults() {
        return {
            prop: 'speed',
            source: 'power',
            disabled: false,
            default: 0,
            riderWeight: 75,
            equipmentWeight: 10,
            mass: 85,
            slope: 0,
            speed: 0,
            altitude: 0,
            distance: 0,
            ascent: 0,
        };
    }

    onUpdate(measuredSpeed, dbState) {
        if (!equals(this.source, this.prop)) return;
        const hasGps = this.hasActiveGps(dbState);
        if (hasGps && equals(dbState.sources?.speed, 'gps')) return;

        const nowMs = Date.now();
        const dt = (nowMs - this.lastUpdate) / 1000;
        this.lastUpdate = nowMs;

        const next = this.cycling.trainerSpeed({
            slope: dbState.slopeTarget / 100,
            speed: dbState.speed,
            distance: dbState.distance,
            altitude: dbState.altitude,
            ascent: dbState.ascent,
            speedPrev: this.speedPrev,
            mass: this.mass,
            dt: Number.isNaN(dt) ? 0.25 : dt,
        });

        this.speedPrev = measuredSpeed;
        xf.dispatch('distance', next.distance);
        if (!hasGps) {
            xf.dispatch('altitude', next.altitude);
            xf.dispatch('ascent', next.ascent);
        }
    }
}

class VirtualGear extends BaseModel {
    postInit(options = {}) {
        this.min = existance(options.min, 1);
        this.max = existance(options.max, 254);
    }

    defaultValue() { return 0; }

    apply(currentGear, messages = []) {
        if (!isArray(messages)) return currentGear;
        let next = currentGear;
        for (const msg of messages) {
            next = this.applyOne(next, msg);
        }
        return next;
    }

    applyOne(gear, message) {
        if (!message) return gear;

        if (equals(message.action, 'shiftUp') && equals(message.state, 'pressed')) {
            return gear < this.min ? this.min : clamp(this.min, this.max, gear + 1);
        }

        if (equals(message.action, 'shiftDown') && equals(message.state, 'pressed')) {
            return gear <= this.min ? gear : gear - 1;
        }

        if (equals(message.action, 'gearSet') && equals(message.state, 'value') && Number.isFinite(message.value)) {
            return clamp(this.min, this.max, message.value);
        }

        return gear;
    }
}

const power = new Power({ prop: 'power' });
const cadence = new Cadence({ prop: 'cadence' });
const heartRate = new HeartRate({ prop: 'heartRate' });
const speed = new Speed({ prop: 'speed' });
const smo2 = new SmO2({ prop: 'smo2' });
const thb = new THb({ prop: 'thb' });
const sources = new Sources({ prop: 'sources', storage: LocalStorageItem });

const virtualState = new VirtualState();
const speedState = new SpeedState();

const powerTarget = new PowerTarget({ prop: 'powerTarget' });
const resistanceTarget = new ResistanceTarget({ prop: 'resistanceTarget' });
const slopeTarget = new SlopeTarget({ prop: 'slopeTarget' });
const cadenceTarget = new CadenceTarget({ prop: 'cadenceTarget' });
const mode = new Mode({ prop: 'mode' });
const page = new Page({ prop: 'page' });

const ftp = new FTP({ prop: 'ftp', storage: LocalStorageItem });
const weight = new Weight({ prop: 'weight', storage: LocalStorageItem });
const theme = new Theme({ prop: 'theme', storage: LocalStorageItem });
const palette = new Palette({ prop: 'palette', storage: LocalStorageItem });
const materialSeed = new MaterialSeed({ prop: 'materialSeed', storage: LocalStorageItem });
const mapStyle = new MapStyle({ prop: 'mapStyle', storage: LocalStorageItem });
const mapApiKey = new TextSetting({ prop: 'mapApiKey', storage: LocalStorageItem });
const mapTileUrl = new TextSetting({ prop: 'mapTileUrl', storage: LocalStorageItem });
const volume = new Volume({ prop: 'volume', storage: LocalStorageItem });
const measurement = new Measurement({ prop: 'measurement', storage: LocalStorageItem });
const dataTileSwitch = new DataTileSwitch({ prop: 'dataTileSwitch', storage: LocalStorageItem });

const virtualGear = new VirtualGear({ prop: 'virtualGear' });

const power1s = new PropInterval({ prop: 'db:power', effect: 'power1s', interval: 1000 });
const power3s = new PropInterval({ prop: 'db:power', effect: 'power3s', interval: 3000 });
const powerInZone = new PowerInZone({ ftpModel: ftp });

const activity = new Activity({ prop: 'activity' });
const workout = new Workout({ prop: 'workout' });
const workouts = new Workouts({ prop: 'workouts', workoutModel: workout });

const session = createSessionModel();

void Device;
void Status;
void EventType;
void speedState;

const models = {
    power,
    heartRate,
    cadence,
    speed,
    smo2,
    thb,
    sources,

    virtualState,

    power1s,
    power3s,
    powerLap,
    powerAvg,
    powerInZone,
    kcal,
    virtualGear,

    heartRateLap,
    heartRateAvg,

    cadenceLap,
    cadenceAvg,

    powerTarget,
    resistanceTarget,
    slopeTarget,
    cadenceTarget,

    mode,
    page,
    ftp,
    weight,
    volume,
    theme,
    palette,
    materialSeed,
    mapStyle,
    mapApiKey,
    mapTileUrl,
    measurement,
    dataTileSwitch,

    activity,
    workout,
    workouts,
    session,

    PropInterval,
};

export { models };
