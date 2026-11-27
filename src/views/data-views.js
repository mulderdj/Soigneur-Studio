import { compatibilityProblem, esc } from './compatibility.js';
import { xf, exists, existance, validate, equals, isNumber, last, empty, avg, toFixed, formatDate, } from '../functions.js';
import { formatTime } from '../utils.js';
import { models } from '../models/models.js';
import { DialogMsg } from '../models/enums.js';
import { formatReminderSetting, nextReminderSetting } from '../fuelling.js';
import { applyMaterialTheme, clearMaterialTheme, extractSeedFromFile, normalizeSeed } from '../theme-material.js';


//
// DataView
//
// Usage:
// <data-view id="count-value" prop="db:count">--</data-view>
//
// Template Method:
// overwrite methods to augment the general logic
//
// getDefaults() -> setup default and fallback values
// config()      -> work with attributes and props here
// subs()        -> subscribe to events or db
// unsubs()      -> executes after abort signal
// getValue()    -> getter for the value for state from a complex prop say an object or array
// onUpdate()    -> determine the rules for state update that will trigger rendering
// transform()   -> apply transforming functions to state just before rendering
//
class DataView extends HTMLElement {
    constructor() {
        super();
        this.state = '';
        this.postInit();
    }
    postInit() { return; }
    static get observedAttributes() {
        return ['disabled'];
    }
    attributeChangedCallback(name, oldValue, newValue) {
        if(equals(name, 'disabled')) {
            this.disabled = exists(newValue) ? true : false;
        }
    }
    getDefaults() {
        return { prop: '', };
    }
    config() {
        return;
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.prop     = existance(this.getAttribute('prop'), this.getDefaults().prop);
        this.disabled = this.hasAttribute('disabled');

        this.config();
        this.subs();
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
        this.unsubs();
    }
    unsubs() {}
    getValue(propValue) {
        return propValue;
    }
    shouldUpdate(value) {
        return !equals(value, this.state) && !this.disabled;
    }
    updateState(value) {
        this.state = value;
    }
    onUpdate(propValue) {
        const value = this.getValue(propValue);

        if(this.shouldUpdate(value)) {
            this.updateState(value);
            this.render();
        }
    }
    transform(state) {
        return state;
    }
    render() {
        this.textContent = this.transform(this.state);
    }
}

customElements.define('data-view', DataView);


class AutoStartCounter extends HTMLElement {
    constructor() {
        super();
        this.isVisible = false;
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        xf.sub('ui:autoStartCounter', this.onUpdate.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onUpdate(value) {
        if(value === -1) {
            this.hide();
        } else {
            if(!this.isVisible) {
                this.show();
            }
            this.render(value);
        }
    }
    show() {
        this.classList.add('active');
    }
    hide() {
        this.classList.remove('active');
    }
    render(value) {
        this.textContent = value;
    }
}

customElements.define('auto-start-counter', AutoStartCounter);

class ModeLockToggle extends HTMLElement {
    constructor() {
        super();
        this.isOn = false;
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };
        this.$icon = this.querySelector('.mode-lock--toggle--icon');
        this.$use = this.querySelector('use');

        this.addEventListener('pointerup', this.onPointerup.bind(this), this.signal);
        xf.sub('db:lock', this.onUpdate.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onUpdate(value) {
        this.isOn = value;
        this.render();
    }
    onPointerup() {
        xf.dispatch('ui:lock-set');
    }
    render() {
        if(this.isOn) {
            this.$use.setAttribute('href', '#icon--lock--close');
        } else {
            this.$use.setAttribute('href', '#icon--lock--open');
        }
    }
}

customElements.define('mode-lock-toggle', ModeLockToggle);


class TimerTime extends DataView {
    getDefaults() {
        return {
            format: 'hh:mm:ss',
            prop:   'db:elapsed',
        };
    }
    config() {
        this.format = existance(this.getAttribute('format'), this.getDefaults().format);
    }
    transform(state) {
        return formatTime({value: this.state, format: this.format, unit: 'seconds'});
    }
}

customElements.define('timer-time', TimerTime);


class IntervalTime extends DataView {
    getDefaults() {
        return {
            format: 'mm:ss',
            prop:   'db:lapTime',
        };
    }
    config() {
        this.format = existance(this.getAttribute('format'), this.getDefaults().format);
    }
    transform(state) {
        return formatTime({value: this.state, format: this.format, unit: 'seconds'});
    }
}

customElements.define('interval-time', IntervalTime);

class SpeedValue extends DataView {
    postInit() {
        this.measurement = this.getDefaults().measurement;
    }
    getDefaults() {
        return {
            prop: 'db:speed',
            measurement: 'metric',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        xf.sub(`db:measurement`, this.onMeasurement.bind(this), this.signal);
    }
    onMeasurement(measurement) {
        this.measurement = measurement;
    }
    format(value, measurement = 'metric') {
        if(equals(measurement, 'imperial')) {
            value = `${models.speed.mpsToMph(value).toFixed(1)}`;
        } else {
            value = `${(models.speed.mpsToKmh(value)).toFixed(1)}`;
        }
        return value;
    }
    transform(state) {
        return this.format(state, this.measurement);
    }
}

customElements.define('speed-value', SpeedValue);

class SpeedVirtual extends SpeedValue {
    getDefaults() {
        return {
            prop: 'db:speedVirtual',
            measurement: 'metric',
        };
    }
}

customElements.define('speed-virtual', SpeedVirtual);

class SpeedSwitch extends SpeedValue {
    postInit() {
        this.measurement = this.getDefaults().measurement;
    }
    getDefaults() {
        return {
            prop: '',
            measurement: 'metric',
        };
    }
    subs() {
        xf.sub(`db:speed`,        this.onSpeed.bind(this), this.signal);
        xf.sub(`db:speedVirtual`, this.onSpeedVirtual.bind(this), this.signal);
        xf.sub(`db:measurement`,  this.onMeasurement.bind(this), this.signal);
        xf.sub(`db:sources`,      this.onSources.bind(this), this.signal);
    }
    onSpeed(value) {
        if(equals(this.source, 'speed')) this.onUpdate(value);
    }
    onSpeedVirtual(value) {
        if(equals(this.source, 'power')) this.onUpdate(value);
    }
    onSources(sources) {
        this.source = sources.virtualState;
    }
}

customElements.define('speed-switch', SpeedSwitch);


class DistanceValue extends DataView {
    postInit() {
        this.measurement = this.getDefaults().measurement;
    }
    getDefaults() {
        return {
            prop: 'db:distance',
            measurement: 'metric',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        xf.sub(`db:measurement`, this.onMeasurement.bind(this), this.signal);
    }
    onMeasurement(measurement) {
        this.measurement = measurement;
    }
    metersToYards(meters) {
        return 1.09361 * meters;
    }
    format(meters, measurement = 'metric') {
        let value   = `0`;
        const km    = (meters / 1000);
        const miles = (meters / 1609.34);
        const yards = this.metersToYards(meters);

        if(equals(measurement, 'imperial')) {
            const yardsTemplate = `${(this.metersToYards(meters)).toFixed(0)}`;
            const milesTemplate = `${miles.toFixed(2)}`;
            return value = (yards < 1609.34) ? yardsTemplate : milesTemplate;
        } else {
            const metersTemplate = `${meters.toFixed(0)}`;
            const kmTemplate = `${km.toFixed(2)}`;
            return value = (meters < 1000) ? metersTemplate : kmTemplate;
        }
    }
    transform(state) {
        return this.format(state, this.measurement);
    }
}

customElements.define('distance-value', DistanceValue);


class AltitudeValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:altitude',
        };
    }
    transform(state) {
        return (state).toFixed(1);
    }
}

customElements.define('altitude-value', AltitudeValue);


class AscentValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:ascent',
        };
    }
    transform(state) {
        return (state).toFixed(1);
    }
}

customElements.define('ascent-value', AscentValue);


class CadenceValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:cadence',
        };
    }
    transform(state) {
        return Math.round(state);
    }
}

customElements.define('cadence-value', CadenceValue);

class CadenceLapValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:cadenceLap',
        };
    }
    transform(state) {
        return Math.round(state);
    }
}

customElements.define('cadence-lap-value', CadenceLapValue);

class CadenceAvgValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:cadenceAvg',
        };
    }
    transform(state) {
        return Math.round(state);
    }
}

customElements.define('cadence-avg-value', CadenceAvgValue);


class CadenceTarget extends DataView {
    getDefaults() {
        return {
            prop: 'db:cadenceTarget',
        };
    }
    transform(state) {
        if(equals(state, 0)) {
            return '';
        }

        return state;
    }
}

customElements.define('cadence-target', CadenceTarget);


class CadenceGroup extends DataView {
    getDefaults() {
        return {
            prop: 'db:cadenceTarget',
        };
    }
    config() {
        this.$main = this.querySelector('cadence-value');
        this.$aux = this.querySelector('cadence-target');
    }
    render() {
        if(equals(this.state, 0)) {
            this.$main.classList.remove('active');
            this.$aux.classList.remove('active');
        } else {
            this.$main.classList.add('active');
            this.$aux.classList.add('active');
        }
    }
}

customElements.define('cadence-group', CadenceGroup);


class HeartRateValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:heartRate',
        };
    }
    transform(state) {
        this.style = 'color: #FE340B';
        return Math.round(state);
    }
}

customElements.define('heart-rate-value', HeartRateValue);

class HeartRateLapValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:heartRateLap',
        };
    }
    transform(state) {
        return Math.round(state);
    }
}

customElements.define('heart-rate-lap-value', HeartRateLapValue);

class HeartRateAvgValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:heartRateAvg',
        };
    }
    transform(state) {
        return Math.round(state);
    }
}

customElements.define('heart-rate-avg-value', HeartRateAvgValue);

class HeartRateMaxValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:heartRateMax',
        };
    }
    transform(state) {
        return Math.round(state);
    }
}

customElements.define('heart-rate-max-value', HeartRateMaxValue);


class SmO2Value extends DataView {
    getDefaults() {
        return {
            prop: 'db:smo2',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }

    // this.style = 'color: #2A5F97';
    // this.style = 'color: #278B65';
    // this.style = 'color: #D72A1C';
    transform(state) {
        // if(state < models.smo2.zones.one) {
        //     this.style = 'color: #328AFF';
        // } else if(state < models.smo2.zones.two) {
        //     this.style = 'color: #56C057';
        // } else {
        //     this.style = 'color: #FE340B';
        // }
        this.style = 'color: #56C057';
        return toFixed(state, 1);
    }
}

customElements.define('smo2-value', SmO2Value);


class THbValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:thb',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    transform(state) {
        this.style = 'color: #FF663A';
        return toFixed(state, 2);
    }
}

customElements.define('thb-value', THbValue);


class CoreBodyTemperatureValue extends DataView {
    postInit() {
        this.measurement = this.getDefaults().measurement;
    }
    getDefaults() {
        return {
            prop: 'db:coreBodyTemperature',
            measurement: 'metric',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        xf.sub(`db:measurement`, this.onMeasurement.bind(this), this.signal);
    }
    onMeasurement(measurement) {
        this.measurement = measurement;
    }
    celsiusToFahrenheit(celsius) {
        return Math.round(((celsius * 9/5) + 32) * 100) / 100;
    }
    format(temperature, measurement = 'metric') {
        if(equals(measurement, 'imperial')) {
            return this.celsiusToFahrenheit(temperature);
        }

        if(equals(measurement, 'metric')) {
            return toFixed(temperature);
        }

        return toFixed(temperature);
    }
    transform(state) {
        return this.format(state, this.measurement);
    }
}

customElements.define('core-body-temperature-value', CoreBodyTemperatureValue);


class SkinTemperatureValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:skinTemperature',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    transform(state) {
        return toFixed(state, 2);
    }
}

customElements.define('skin-temperature-value', SkinTemperatureValue);


class WorkoutTextEvent extends DataView {
    getDefaults() {
        return {
            prop: 'db:workoutTextEvent',
        };
    }
    render() {
        const message = this.transform(this.state);

        this.textContent = message;

        if(empty(message)) {
            this.classList.remove('active');
        } else {
            this.classList.add('active');
        }
    }
}

customElements.define('workout-text-event', WorkoutTextEvent);



class WorkoutName extends DataView {
    getDefaults() {
        return {
            prop: 'db:workout',
        };
    }
    getValue(propValue) {
        return propValue.meta.name;
    }
}

customElements.define('workout-name', WorkoutName);


class PowerTarget extends DataView {
    getDefaults() {
        return {
            prop: 'db:powerTarget',
        };
    }
}

customElements.define('power-target', PowerTarget);

class PowerTargetFTP extends DataView {
    getDefaults() {
        return {
            prop: 'db:powerTarget',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        xf.sub(`db:ftp`,       this.onFTP.bind(this), this.signal);
    }
    onFTP(ftp) {
        this.ftp = ftp;
    }
    toPercentage(state, ftp) {
        return Math.round((state * 100) / ftp);
    }
    transform(state) {
        return `${this.toPercentage(state, this.ftp)}%`;
    }
}

customElements.define('power-target-ftp', PowerTargetFTP);

class CompanionGroup extends DataView {
    getDefaults() {
        return {
            prop: '',
            active: false,
        };
    }
    config() {
        this.$main = this.querySelector('.companion-main');
        this.$aux = this.querySelector('.companion-aux');
    }
    subs() {
        this.addEventListener(`pointerup`, this.onPointerup.bind(this), this.signal);
    }
    onPointerup() {
        this.active = !this.active;
        this.render();
    }
    render() {
        if(this.active) {
            this.$main.classList.add('active');
            this.$aux.classList.add('active');
        } else {
            this.$main.classList.remove('active');
            this.$aux.classList.remove('active');
        }
    }
}

customElements.define('companion-group', CompanionGroup);

class ZStack extends HTMLElement {
    constructor() {
        super();
        this.items = [];
        this.activeIndex = 0;
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.$items = this.querySelectorAll('z-stack-item');
        this.key = this.dataset.key;
        this.persistance = exists(this.key) ? true : false;
        this.hasSwitchSub = exists(this.dataset.sub);

        if(this.hasSwitchSub) {
            xf.sub(this.$sub, this.onSwitch.bind(this), this.signal);
        } else {
            this.addEventListener(`pointerup`, this.onSwitch.bind(this), this.signal);
        }

        if(this.persistance) {
            xf.sub(`db:sources`, this.onSources.bind(this), this.signal);
        }
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onSources(value) {
        const index = parseInt(value[this.key] ?? this.activeIndex);
        // console.log(`:onSources ${index} === ${this.activeIndex}`);
        if(index === this.activeIndex) return;
        this.activeIndex = index;
        this.render();
    }
    onSwitch() {
        this.incrementActive();
        this.render();

        if(this.persistance) {
            this.backup();
        }
    }
    backup() {
        const update = {};
        update[this.key] = this.activeIndex;
        xf.dispatch(`sources`, update);
    }
    incrementActive() {
        this.activeIndex = (this.activeIndex + 1) % Math.max(this.$items.length, 1);
    }
    render() {
        this.$items.forEach(($item, i) => {
            if(equals(i, this.activeIndex)) {
                $item.classList.add('active');
            } else {
                $item.classList.remove('active');
            }
        });
    }
}

customElements.define('z-stack', ZStack);


class SlopeTarget extends DataView {
    getDefaults() {
        return {
            prop: 'db:slopeTarget',
        };
    }
    transform(state) {
        return state.toFixed(1);
    }
}

customElements.define('slope-target', SlopeTarget);


class PowerTargetControl extends DataView {
    postInit() {
        const self = this;
        this.state = 0;
    }
    setDefaults() {
        this.prop = 'db:powerTarget';
        this.selectors = {
            input: '#power-target-input',
            inc:   '#power-target-inc',
            dec:   '#power-target-dec',
        };
        this.effects = {
            inc: 'power-target-inc',
            dec: 'power-target-dec',
            set: 'power-target-set',
        };
        this.parse = parseInt;
    }
    config() {
        this.setDefaults();
        this.$input = document.querySelector(this.selectors.input);
        this.$inc   = document.querySelector(this.selectors.inc);
        this.$dec   = document.querySelector(this.selectors.dec);
    }
    subs() {
        this.$input.addEventListener('change', this.onChange.bind(this), this.signal);
        this.$inc.addEventListener('pointerup', this.onInc.bind(this), this.signal);
        this.$dec.addEventListener('pointerup', this.onDec.bind(this), this.signal);

        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    onInc(e) {
        xf.dispatch(`ui:${this.effects.inc}`);
    }
    onDec(e) {
        xf.dispatch(`ui:${this.effects.dec}`);
    }
    onChange(e) {
        this.state = this.parse(e.target.value);
        xf.dispatch(`ui:${this.effects.set}`, this.state);
    }
    render() {
        this.$input.value = this.transform(this.state);
    }
}

customElements.define('power-target-control', PowerTargetControl);


class ResistanceTargetControl extends PowerTargetControl {
    setDefaults() {
        this.prop = 'db:resistanceTarget';
        this.selectors = {
            input: '#resistance-target-input',
            inc:   '#resistance-target-inc',
            dec:   '#resistance-target-dec',
        };
        this.effects = {
            inc: 'resistance-target-inc',
            dec: 'resistance-target-dec',
            set: 'resistance-target-set',
        };
        this.parse = parseInt;
    }
}

customElements.define('resistance-target-control', ResistanceTargetControl);


class SlopeTargetControl extends PowerTargetControl {
    setDefaults() {
        this.prop = 'db:slopeTarget';
        this.selectors = {
            input: '#slope-target-input',
            inc:   '#slope-target-inc',
            dec:   '#slope-target-dec',
        };
        this.effects = {
            inc: 'slope-target-inc',
            dec: 'slope-target-dec',
            set: 'slope-target-set',
        };
        this.parse = parseFloat;
    }
    transform(state) {
        return (state).toFixed(1);
    }
}

customElements.define('slope-target-control', SlopeTargetControl);


class PowerValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:power',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    transform(state) {
        this.style = 'color: #F8C73A';
        return Math.round(state);
    }
}

customElements.define('power-value', PowerValue);

class PowerAvg extends DataView {
    getDefaults() {
        return {
            prop: 'db:powerAvg',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    transform(state) {
        return Math.ceil(state);
    }
}

customElements.define('power-avg', PowerAvg);

class PowerLap extends DataView {
    getDefaults() {
        return {
            prop: 'db:powerLap',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    transform(state) {
        return Math.ceil(state);
    }
}

customElements.define('power-lap', PowerLap);

class KcalAvg extends DataView {
    getDefaults() {
        return {
            prop: 'db:kcal',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    transform(state) {
        return Math.round(state);
    }
}

customElements.define('kcal-avg', KcalAvg);

class VirtualGearValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:virtualGear',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    transform(state) {
        if(equals(state, 0)) return '--';
        return state;
    }
}

customElements.define('virtual-gear', VirtualGearValue);

class FuellingBurnedValue extends DataView {
    getDefaults() {
        return { prop: 'fuelling:state' };
    }
    getValue(state) {
        return state?.burnedGrams ?? 0;
    }
    transform(value) {
        return `${Math.round(Number(value) || 0)}g`;
    }
}

customElements.define('fuelling-burned', FuellingBurnedValue);

class FuellingIntakeValue extends DataView {
    getDefaults() {
        return { prop: 'fuelling:state' };
    }
    getValue(state) {
        return state?.intakeGrams ?? 0;
    }
    transform(value) {
        return `${Math.round(Number(value) || 0)}g`;
    }
}

customElements.define('fuelling-intake', FuellingIntakeValue);

class FuellingRateValue extends DataView {
    getDefaults() {
        return { prop: 'fuelling:state' };
    }
    getValue(state) {
        return state?.burnRateGh ?? 0;
    }
    transform(value) {
        return `${Math.round(Number(value) || 0)}`;
    }
}

customElements.define('fuelling-rate', FuellingRateValue);

class FuellingBandValue extends DataView {
    getDefaults() {
        return { prop: 'fuelling:state' };
    }
    getValue(state) {
        return state?.band ?? '0–30';
    }
    transform(value) {
        return String(value || '0–30');
    }
}

customElements.define('fuelling-band', FuellingBandValue);

function scale(value, max = 100) {
    return 100 * (value/max);
}

class InstantPowerGraph extends HTMLElement {
    constructor() {
        super();
        this.value       = this.defaults().value;
        this.metricValue = this.defaults().metricValue;
        this.scaleFactor = this.defaults().scaleFactor;
        this.barsCount   = this.defaults().barsCount;
        this.scaleMax    = this.setScaleMax();
        this.model       = {};
        this.postInit();
    }
    postInit() {
        this.model  = models.ftp;
        this.prop   = 'power';
        this.metric = 'ftp';
    }
    defaults () {
        return {
            value:       0,
            barsCount:   0,
            metricValue: 200,
            scaleFactor: 1.6,
        };
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.graphWidth = this.calcGraphWidth();

        xf.sub(`db:${this.prop}`, this.onUpdate.bind(this), this.signal);
        xf.sub(`db:${this.metric}`, this.onMetric.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    calcGraphWidth() {
        return this.getBoundingClientRect().width;
    }
    onUpdate(value) {
        this.value = value;
        this.render();
    }
    onMetric(value) {
        this.metricValue = value;
        this.setScaleMax();
    }
    setScaleMax() {
        this.scaleMax = this.metricValue * this.scaleFactor;
    }
    bar(zone = 'one', height = 80, width = 1) {
        return `<div class="graph-bar zone-${zone}" style="height: ${height}%; width: ${width}px;"></div>`;
    }
    shift() {
        this.removeChild(this.childNodes[0]);
    }
    render() {
        const zone = models.ftp.powerToZone(this.value, this.metricValue).name;
        const barHeight = scale(this.value, this.scaleMax);
        if(this.barsCount >= this.graphWidth) {
            this.shift();
        }
        this.insertAdjacentHTML('beforeend', this.bar(zone, barHeight, 1));
        this.barsCount += 1;
    }
}

customElements.define('instant-power-graph', InstantPowerGraph);


class SwitchGroup extends HTMLElement {
    constructor() {
        super();
        this.state = 0;
        this.postInit();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.$switchList = this.querySelectorAll('.switch-item');
        this.config();

        xf.sub(`db:${this.prop}`, this.onState.bind(this), this.signal);
        this.addEventListener('pointerup', this.onSwitch.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    eventOwner(e) {
        const path = e.composedPath();
        const pathLength = path.length;

        for(let i = 0; i < pathLength; i++) {
            if(exists(path[i].hasAttribute) &&
               path[i].hasAttribute('index')) {
                return path[i];
            }
        }

        return e.path[0];
    }
    onSwitch(e) {
        const element = this.eventOwner(e);

        if(exists(element.attributes.index)) {

            const id = parseInt(element.attributes.index.value) || 0;

            if(equals(id, this.state)) {
                return;
            } else {
                xf.dispatch(`${this.effect}`, id);
            }
        }
    }
    onState(state) {
        this.state = state;
        this.setSwitch(this.state);
        this.renderEffect(this.state);
    }
    setSwitch(state) {
        this.$switchList.forEach(function(s, i) {
            if(equals(i, state)) {
                s.classList.add('active');
            } else {
                s.classList.remove('active');
            }
        });
    }
    // overwrite the rest to augment behavior
    postInit() {
        this.prop = '';
    }
    config() {
    }
    renderEffect(state) {
        return state;
    }
}

class NavigationStack extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.tabs = {
            settings: {
                $view: document.querySelector(`#view--settings`),
                $link: document.querySelector(`#link--settings`),
                children: {
                    settings: {
                        $view: document.querySelector(`#view--settings-settings`),
                        $link: document.querySelector(`#link--settings-settings`),
                    },
                }
            },
            home: {
                $view: document.querySelector(`#view--home`),
                $link: document.querySelector(`#link--home`),
            },
            workouts: {
                $view: document.querySelector(`#view--workouts`),
                $link: document.querySelector(`#view--workouts`),

                children: {
                    workouts: {
                        $view: document.querySelector(`#view--workouts-workouts`),
                        $link: document.querySelector(`#link--workouts-workouts`),
                    },
                    editor: {
                        $view: document.querySelector(`#view--workouts-editor`),
                        $link: document.querySelector(`#link--workouts-editor`),
                    }
                }
            },
        };
        xf.sub(`action:nav`, this.onAction.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onAction(action) {
        console.log(action);

        if(action === 'settings') {
            this.switch('settings', this.tabs);
            return;
        }
        if(action === 'home') {
            this.switch('home', this.tabs);
            return;
        }
        if(action === 'workouts') {
            this.switch('workouts', this.tabs);
            return;
        }

        if(action === 'settings:settings') {
            this.switch('settings', this.tabs.settings.children);
            return;
        }

        if(action === 'workouts:workouts') {
            this.switch('workouts', this.tabs.workouts.children);
            return;
        }
        if(action === 'workouts:editor') {
            this.switch('editor', this.tabs.workouts.children);
            return;
        }
    }
    switch(target, elements) {
        // prevent potential content flash
        // by first removing and only after that adding .active
        // if there is no target element this is not an error,
        // it means all content should be 'non-active'
        for(let prop in elements) {
            if(!(target === prop)) {
                elements[prop].$view?.classList.remove('active');
                elements[prop].$link?.classList.remove('active');
            }
        }
        if(target) {
            elements[target]?.$view?.classList.add('active');
            elements[target]?.$link?.classList.add('active');
        }
    }
}

customElements.define('navigation-stack', NavigationStack);


// TODO:
// - use data-<prop name> properties instead of attributes
// - get them with this.dataset.<data name>
class ViewAction extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        const action = this.getAttribute('action');
        const topic = this.getAttribute('topic') ?? '';
        const on = this.getAttribute('on') ?? 'pointerup';
        const stopPropagation = this.hasAttribute('stoppropagation');

        if(action === undefined || action === '') {
            throw Error(`need to setup action attribute on view-action `, self);
        }

        this.addEventListener(on, (e) => {
            if(stopPropagation) {
                e.stopPropagation();
            }
            // console.log(`action${topic}`, action, stopPropagation);
            xf.dispatch(`action${topic}`, action);
            this.postAction();
        }, this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    postAction() {
    }
}

customElements.define('view-action', ViewAction);


class BatteryLevel extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.for = this.getAttribute('for');
        this.$level = this.querySelector('.battery--level');

        xf.sub(`${this.for}:batteryLevel`, this.onUpdate.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onUpdate(level) {
        this.$level.style.width = `${level}%`;

        this.classList.remove('ok');
        this.classList.remove('low');
        this.classList.remove('critical');

        if(level < 11) {
            this.classList.add('critical');
            return;
        }
        if(level < 21) {
            this.classList.add('low');
            return;
        }
        this.classList.add('ok');
    }
}

customElements.define('battery-level', BatteryLevel);


class NavigationAction extends ViewAction {
    constructor() {
        super();
    }
    connectedCallback() {
        super.connectedCallback();
    }
    disconnectedCallback() {
        super.disconnectedCallback();
    }
    postAction() {
        // this.siblings = this.parentElement.querySelectorAll('navigation-action');
        // for(let sibling of this.siblings) {
        //     sibling.classList.remove('active');
        // }
        // this.classList.add('active');
    }
}

customElements.define('navigation-action', NavigationAction);


class ModalError extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.$dialog = this.querySelector(`dialog`);
        this.$dismissBtn = this.querySelector(`.dialog--dismiss--btn`);
        this.$message = this.querySelector(`.dialog--message`);

        xf.sub(`ui:modal:error:open`, this.onOpen.bind(this), this.signal);
        this.$dismissBtn.addEventListener('pointerup', this.onClose.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onOpen(msg) {
        this.$dialog.showModal();
        this.$message.innerHTML = this.message(msg);
    }
    onClose(result) {
        this.$dialog.close();
    }
    message(msg) {
        if(msg === DialogMsg.noAuth) {
            return `Your session is over. You need to login again.`;
        };
        if(typeof msg === 'string') {
            return msg.split('<br>')
                .map(line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
                .join('<br>');
        }
        return '';
    }
}

customElements.define('modal-error', ModalError);


class MeasurementUnit extends DataView {
    getDefaults() {
        return {
            state: models.measurement.default,
            prop: 'db:measurement',
        };
    }
    formatUnit(measurement = models.measurement.default) {
        if(measurement === 'imperial') {
            return `lbs`;
        } else {
            return `kg`;
        }
    }
    transform(state) {
        return this.formatUnit(state);
    }
}

customElements.define('measurement-unit', MeasurementUnit);

class ThemeValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:theme',
        };
    }
}

customElements.define('theme-value', ThemeValue);

class MeasurementValue extends DataView {
    getDefaults() {
        return {
            prop: 'db:measurement',
        };
    }
}

customElements.define('measurement-value', MeasurementValue);


class VirtualStateSource extends DataView {
    postInit() {
        this.sources = ['power', 'speed'];
        this.source  = 'power';
        this.effect  = 'sources';
        this.state   = { virtualState: 'power' };
    }
    getDefaults() {
        return {
            prop: 'db:sources',
            effect: 'sources'
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        this.addEventListener('pointerup', this.onEffect.bind(this), this.signal);
    }
    onUpdate(value) {
        this.state = value.virtualState;
        this.render();
    }
    onEffect() {
        if(equals(this.state, 'power')) {
            xf.dispatch(`${this.effect}`, {virtualState: 'speed'});
        } else {
            xf.dispatch(`${this.effect}`, {virtualState: 'power'});
        }
    }
    render() {
        this.textContent = this.state;
    }
}

customElements.define('virtual-state-source', VirtualStateSource);


class AutoPause extends DataView {
    postInit() {
        this.effect  = 'sources';
        this.key     = 'autoPause';
        this.state   = { autoPause: false };
        this.values  = {on: {autoPause: true}, off: {autoPause: false}};
    }
    getDefaults() {
        return {
            prop: 'db:sources',
            effect: 'sources'
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        this.addEventListener('pointerup', this.onEffect.bind(this), this.signal);
    }
    onUpdate(value) {
        this.state = value[this.key];
        this.render();
    }
    onEffect() {
        if(equals(this.state, true)) {
            xf.dispatch(`${this.effect}`, this.values.off);
        } else {
            xf.dispatch(`${this.effect}`, this.values.on);
        }
    }
    render() {
        this.textContent = this.state ? 'On' : 'Off';
    }
}

customElements.define('auto-pause', AutoPause);

class AutoStart extends AutoPause {
    postInit() {
        this.effect  = 'sources';
        this.key     = 'autoStart';
        this.state   = { autoStart: true };
        this.values  = {on: {autoStart: true}, off: {autoStart: false}};
    }
}

customElements.define('auto-start', AutoStart);

const THEME_COLORS = {
    default: {dark: '#151B23', light: '#ECEFF3'},
    abricot: {dark: '#17120F', light: '#FAF7F2'},
};

function effectiveColorMode(themeMode) {
    if(equals(themeMode, 'WHITE')) return 'light';
    if(equals(themeMode, 'AUTO')) {
        const prefersLight = typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-color-scheme: light)').matches;
        return prefersLight ? 'light' : 'dark';
    }
    return 'dark';
}

function currentThemeMode() {
    if(typeof document === 'undefined' || !document.body) return 'DARK';
    if(document.body.classList.contains('white-theme')) return 'WHITE';
    if(document.body.classList.contains('auto-theme')) return 'AUTO';
    return 'DARK';
}

function syncThemeSurface(themeMode = currentThemeMode(), palette = undefined, seed = undefined) {
    if(typeof document === 'undefined' || !document.body) return;
    const rawPalette = palette ?? document.body.dataset.palette ?? 'default';
    const activePalette = rawPalette === 'abricot' || rawPalette === 'material' ? rawPalette : 'default';
    const mode = effectiveColorMode(themeMode);
    let color = THEME_COLORS.default[mode];

    if(activePalette === 'material') {
        const activeSeed = normalizeSeed(seed ?? models.materialSeed.state ?? models.materialSeed.default);
        const tokens = applyMaterialTheme(activeSeed, mode === 'dark', document.body);
        document.body.setAttribute('data-palette', 'material');
        color = tokens['--bg'];
    } else {
        clearMaterialTheme(document.body);
        color = THEME_COLORS[activePalette][mode];
    }

    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', color);
}

function updateThemeColor(themeMode = currentThemeMode(), palette = undefined) {
    syncThemeSurface(themeMode, palette);
}

function applyThemeMode(themeMode) {
    if(typeof document === 'undefined' || !document.body) return;
    document.body.classList.remove('dark-theme', 'white-theme', 'auto-theme');
    document.body.classList.add(equals(themeMode, 'DARK') ? 'dark-theme' : equals(themeMode, 'WHITE') ? 'white-theme' : 'auto-theme');
    syncThemeSurface(themeMode);
}

function applyPalette(palette) {
    if(typeof document === 'undefined' || !document.body) return;
    if(palette === 'abricot' || palette === 'material') {
        document.body.dataset.palette = palette;
    } else {
        delete document.body.dataset.palette;
    }
    syncThemeSurface(currentThemeMode(), palette);
}

function applyMapStyle(style) {
    if(typeof document === 'undefined' || !document.body) return;
    if(style && style !== 'standard' && models.mapStyle.isValid(style)) {
        document.body.dataset.mapStyle = style;
    } else {
        delete document.body.dataset.mapStyle;
    }
}

function applyMapApiKey(key) {
    if(typeof document === 'undefined' || !document.body) return;
    if(key) document.body.dataset.mapApiKey = key;
    else delete document.body.dataset.mapApiKey;
}

function applyMapTileUrl(url) {
    if(typeof document === 'undefined' || !document.body) return;
    if(url) document.body.dataset.mapTileUrl = url;
    else delete document.body.dataset.mapTileUrl;
}

if(typeof window !== 'undefined') {
    xf.sub('db:palette', applyPalette);
    xf.sub('db:materialSeed', seed => {
        if(document.body?.dataset?.palette === 'material') {
            syncThemeSurface(currentThemeMode(), 'material', seed);
        }
    });
    xf.sub('db:mapStyle', applyMapStyle);
    xf.sub('db:mapApiKey', applyMapApiKey);
    xf.sub('db:mapTileUrl', applyMapTileUrl);
    xf.sub('db:sources', s => { if(s?.theme) applyThemeMode(s.theme); });
    if(typeof window.matchMedia === 'function') {
        const mq = window.matchMedia('(prefers-color-scheme: light)');
        mq.addEventListener?.('change', () => syncThemeSurface());
    }
}

class Theme extends DataView {
    postInit() {
        this.effect  = 'sources';
        this.state   = 'DARK';
    }
    getDefaults() {
        return {
            prop: 'db:sources',
            effect: 'sources'
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        this.addEventListener('pointerup', this.onEffect.bind(this), this.signal);
    }
    onUpdate(value) {
        this.state = value.theme;
        this.render();
    }
    onEffect() {
        if(equals(this.state, 'DARK')) {
            xf.dispatch(`${this.effect}`, {theme: 'WHITE'});
        }else if (equals(this.state, 'WHITE')) {
            xf.dispatch(`${this.effect}`, {theme: 'AUTO'});
        } else {
            xf.dispatch(`${this.effect}`, {theme: 'DARK'});
        }
    }
    render() {
        this.textContent = equals(this.state, 'DARK') ? 'DARK' : equals(this.state, 'WHITE') ? 'WHITE' : 'AUTO';
        applyThemeMode(this.state);
    }
}

customElements.define('theme-layout', Theme);

class PaletteLayout extends DataView {
    postInit() {
        this.state = models.palette.default;
    }
    getDefaults() {
        return {
            prop: 'db:palette',
        };
    }
    subs() {
        this.state = models.palette.state || models.palette.default;
        this.render();
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        this.addEventListener('pointerup', this.onEffect.bind(this), this.signal);
    }
    onUpdate(value) {
        this.state = models.palette.isValid(value) ? value : models.palette.default;
        this.render();
    }
    onEffect() {
        xf.dispatch('ui:palette-switch');
    }
    render() {
        this.textContent = models.palette.label(this.state);
        applyPalette(this.state);
    }
}

customElements.define('palette-layout', PaletteLayout);

class MaterialSeedControl extends HTMLElement {
    connectedCallback() {
        if(!this.$picker) {
            this.innerHTML = `
                <div class="list--row--inner option list-row material-seed__row">
                    <div class="option--name">Theme color</div>
                    <div class="material-seed__controls">
                        <input type="color" class="material-seed__picker" aria-label="Material You seed color" title="Pick seed color">
                        <button type="button" class="btn btn--secondary material-seed__wall">Wallpaper</button>
                        <input type="file" class="material-seed__file" accept="image/*" hidden>
                    </div>
                </div>`;
            this.$picker = this.querySelector('.material-seed__picker');
            this.$wall   = this.querySelector('.material-seed__wall');
            this.$file   = this.querySelector('.material-seed__file');
        }
        this._abort?.abort();
        this._abort = new AbortController();
        const signal = {signal: this._abort.signal};

        const syncVisible = pal => {
            this.hidden = pal !== 'material';
        };
        const syncSeed = seed => {
            if(this.$picker) this.$picker.value = normalizeSeed(seed);
        };

        syncVisible(models.palette.state || models.palette.default);
        syncSeed(models.materialSeed.state || models.materialSeed.default);

        xf.sub('db:palette', syncVisible, signal);
        xf.sub('db:materialSeed', syncSeed, signal);

        this.$picker.addEventListener('input', () => {
            xf.dispatch('ui:materialSeed-set', this.$picker.value);
        }, signal);
        this.$wall.addEventListener('click', () => {
            this.$file.value = '';
            this.$file.click();
        }, signal);
        this.$file.addEventListener('change', async () => {
            const file = this.$file.files?.[0];
            if(!file) return;
            try {
                const seed = await extractSeedFromFile(file);
                xf.dispatch('ui:materialSeed-set', seed);
            } catch(_) {}
        }, signal);
    }

    disconnectedCallback() {
        this._abort?.abort();
        this._abort = null;
    }
}

customElements.define('material-seed-control', MaterialSeedControl);

class MapStyleLayout extends HTMLElement {
    connectedCallback() {
        if(!this.$select) {
            this.innerHTML = `<select class="input map-style__select" aria-label="Map style">${
                models.mapStyle.values
                    .map(v => `<option value="${v}">${models.mapStyle.label(v)}</option>`)
                    .join('')
            }</select>`;
            this.$select = this.querySelector('select');
        }
        this._abort?.abort();
        this._abort = new AbortController();
        const signal = {signal: this._abort.signal};

        const sync = val => {
            const style = models.mapStyle.isValid(val) ? val : models.mapStyle.default;
            if(this.$select) this.$select.value = style;
            applyMapStyle(style);
        };
        sync(models.mapStyle.state || models.mapStyle.default);
        xf.sub('db:mapStyle', sync, signal);
        this.$select.addEventListener('change', () => {
            xf.dispatch('ui:mapStyle-set', this.$select.value);
        }, signal);
    }
    disconnectedCallback() {
        this._abort?.abort();
        this._abort = null;
    }
}

customElements.define('map-style-layout', MapStyleLayout);

class MapProviderConfig extends HTMLElement {
    connectedCallback() {
        if(!this.$key) {
            this.innerHTML = `
                <div class="list--row--inner map-config__fields">
                    <label class="map-config__field" data-mc-url>
                        <span>Custom tile URL (use {z}, {x}, {y}, optional {key})</span>
                        <input type="url" class="input" data-mc-url-input placeholder="https://tile.example.com/{z}/{x}/{y}.png?apikey={key}" autocomplete="off" spellcheck="false">
                    </label>
                    <label class="map-config__field" data-mc-key>
                        <span>API key</span>
                        <input type="text" class="input" data-mc-key-input placeholder="Paste provider API key" autocomplete="off" spellcheck="false">
                    </label>
                </div>`;
            this.$urlWrap = this.querySelector('[data-mc-url]');
            this.$url     = this.querySelector('[data-mc-url-input]');
            this.$keyWrap = this.querySelector('[data-mc-key]');
            this.$key     = this.querySelector('[data-mc-key-input]');
        }
        this._abort?.abort();
        this._abort = new AbortController();
        const signal = {signal: this._abort.signal};

        const syncStyle = style => {
            const needsKey = style === 'thunderforest' || style === 'custom';
            const needsUrl = style === 'custom';
            this.hidden = !needsKey && !needsUrl;
            if(this.$urlWrap) this.$urlWrap.hidden = !needsUrl;
            if(this.$keyWrap) this.$keyWrap.hidden = !needsKey;
        };
        const syncKey = key => {
            if(this.$key && document.activeElement !== this.$key) this.$key.value = key || '';
            applyMapApiKey(key || '');
        };
        const syncUrl = url => {
            if(this.$url && document.activeElement !== this.$url) this.$url.value = url || '';
            applyMapTileUrl(url || '');
        };

        syncStyle(models.mapStyle.state || models.mapStyle.default);
        syncKey(models.mapApiKey.state || '');
        syncUrl(models.mapTileUrl.state || '');

        xf.sub('db:mapStyle', syncStyle, signal);
        xf.sub('db:mapApiKey', syncKey, signal);
        xf.sub('db:mapTileUrl', syncUrl, signal);

        this.$key.addEventListener('change', () => xf.dispatch('ui:mapApiKey-set', this.$key.value), signal);
        this.$url.addEventListener('change', () => xf.dispatch('ui:mapTileUrl-set', this.$url.value), signal);
    }
    disconnectedCallback() {
        this._abort?.abort();
        this._abort = null;
    }
}

customElements.define('map-provider-config', MapProviderConfig);

class SoundControl extends DataView {
    postInit() {
        this.volume = 100;
        this.selectors = {
            mute:    '#sound--mute',
            down:    '#sound--down',
            up:      '#sound--up',
            volume:  '#sound--volume',
        };
    }
    getDefaults() {
        return { prop: 'db:volume', };
    }
    config() {
        this.$mute   = this.querySelector(this.selectors.mute);
        this.$down   = this.querySelector(this.selectors.down);
        this.$up     = this.querySelector(this.selectors.up);
        this.$volume = this.querySelector(this.selectors.volume);
    }
    subs() {
        this.$mute.addEventListener(`pointerup`, this.onMute.bind(this), this.signal);
        this.$down.addEventListener(`pointerup`, this.onDown.bind(this), this.signal);
        this.$up.addEventListener(`pointerup`, this.onUp.bind(this), this.signal);
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    onMute() {
        xf.dispatch(`ui:volume-mute`);
    }
    onDown() {
        xf.dispatch(`ui:volume-down`);
    }
    onUp() {
        xf.dispatch(`ui:volume-up`);
    }
    render() {
        this.$volume.textContent = `${this.state}%`;
    }
}

customElements.define('sound-control', SoundControl);

class PowerMatchToggle extends DataView {
    postInit() {
        this.effect = 'sources';
        this.key    = 'powerMatch';
        this.state  = false;
    }
    getDefaults() {
        return {
            prop: 'db:sources',
            effect: 'sources',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        this.addEventListener('pointerup', this.onEffect.bind(this), this.signal);
    }
    onUpdate(value) {
        this.state = Boolean(value?.[this.key]);
        this.render();
    }
    onEffect() {
        xf.dispatch(`${this.effect}`, { powerMatch: !this.state });
    }
    render() {
        this.textContent = this.state ? 'On' : 'Off';
    }
}

customElements.define('power-match', PowerMatchToggle);

class FuellingReminderToggle extends DataView {
    postInit() {
        this.effect = 'sources';
        this.key    = 'fuellingReminder';
        this.state  = 0;
    }
    getDefaults() {
        return {
            prop: 'db:sources',
            effect: 'sources',
        };
    }
    subs() {
        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        this.addEventListener('pointerup', this.onEffect.bind(this), this.signal);
    }
    onUpdate(value) {
        this.state = Number(value?.[this.key]) || 0;
        this.render();
    }
    onEffect() {
        xf.dispatch(`${this.effect}`, { fuellingReminder: nextReminderSetting(this.state) });
    }
    render() {
        this.textContent = formatReminderSetting(this.state);
    }
}

customElements.define('fuelling-reminder', FuellingReminderToggle);


class CompatibilityCheck extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        if(!self.compatible()) {
            self.show();
        }
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    problem() {
        return compatibilityProblem({
            secure: window.isSecureContext,
            bluetooth: 'bluetooth' in navigator,
            host: location.host,
            userAgent: navigator.userAgent,
        });
    }
    compatible() {
        return this.problem() === null;
    }
    show() {
        const problem = this.problem();
        if(!problem) return;
        this.innerHTML =
        `<div id="compatibility--cont" data-kind="${problem.kind}" role="status">
             <p>${esc(problem.text)}</p>
         </div>`;
    }
    hide() {
        const self = this;
        this.innerHTML = '';
    }
}


customElements.define('compatibility-check', CompatibilityCheck);

export {
    DataView,

    TimerTime,
    IntervalTime,
    CadenceValue,
    CadenceLapValue,
    CadenceAvgValue,
    CadenceTarget,
    CadenceGroup,
    SpeedValue,
    DistanceValue,
    HeartRateValue,
    HeartRateLapValue,
    HeartRateAvgValue,
    SmO2Value,
    THbValue,
    PowerAvg,
    PowerValue,
    MeasurementUnit,
    ThemeValue,
    MeasurementValue,
    PaletteLayout,
    applyPalette,
    applyThemeMode,
    updateThemeColor,

    SlopeTarget,
    PowerTarget,

    WorkoutName,

    InstantPowerGraph,

    SwitchGroup,


    NavigationStack,
    ViewAction,
    BatteryLevel,

}
