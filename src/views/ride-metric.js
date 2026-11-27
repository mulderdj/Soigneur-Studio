// @ts-check
//
// <ride-metric>: standalone live metric tile for Ride screens so riders can
// place multiple cards from the same category side-by-side (e.g. Current HR +
// Avg HR + Max HR, or Current Power + 3s Power + Lap Power + NP).
//

import { xf } from '../functions.js';
import { db } from '../db.js';
import { models } from '../models/models.js';

const fmtInt = v => (Number.isFinite(v) && v > 0 ? String(Math.round(v)) : '--');
const fmtDec = (v, d = 1) => (Number.isFinite(v) && v > 0 ? v.toFixed(d) : '--');

const RIDE_METRICS = {
    'hr-avg':      {label: 'Avg HR',           unit: 'bpm',  prop: 'db:heartRateAvg', read: () => db.heartRateAvg, fmt: fmtInt},
    'hr-lap':      {label: 'Lap HR',           unit: 'bpm',  prop: 'db:heartRateLap', read: () => db.heartRateLap, fmt: fmtInt},
    'hr-max':      {label: 'Max HR',           unit: 'bpm',  prop: 'db:heartRateMax', read: () => db.heartRateMax, fmt: fmtInt},
    'power-3s':    {label: '3s Power',         unit: 'W',    prop: 'db:power3s',      read: () => db.power3s,      fmt: fmtInt},
    'power-lap':   {label: 'Lap Power',        unit: 'W',    prop: 'db:powerLap',     read: () => db.powerLap,     fmt: fmtInt},
    'power-np':    {label: 'Normalized Power', unit: 'W',    analytics: s => s.np,                                 fmt: fmtInt},
    'power-max':   {label: 'Max Power',        unit: 'W',    analytics: s => s.maxPower,                           fmt: fmtInt},
    'power-wkg':   {label: 'W/kg',             unit: 'W/kg', custom: 'wkg'},
    'cadence-avg': {label: 'Avg Cadence',      unit: 'rpm',  prop: 'db:cadenceAvg',   read: () => db.cadenceAvg,   fmt: fmtInt},
    'cadence-lap': {label: 'Lap Cadence',      unit: 'rpm',  prop: 'db:cadenceLap',   read: () => db.cadenceLap,   fmt: fmtInt},
    'speed-avg':   {label: 'Avg Speed',        unit: 'km/h', custom: 'speedAvg'},
    'tss':         {label: 'TSS',              unit: '',     analytics: s => s.tss,                                fmt: fmtInt},
    'if':          {label: 'IF',               unit: '',     analytics: s => s.intensity,                          fmt: v => fmtDec(v, 2)},
    'kj':          {label: 'Work',             unit: 'kJ',   analytics: s => s.kj,                                 fmt: fmtInt},
};

class RideMetric extends HTMLElement {
    connectedCallback() {
        this.metric = this.dataset.metric || this.getAttribute('metric') || 'hr-avg';
        const def = RIDE_METRICS[this.metric];
        if(!def) return;

        this.classList.add('tile', 'rm-metric');
        this.innerHTML = `
            <h2 class="tile__label">${def.label}</h2>
            <div class="tile__value" data-rm-val>--</div>
            <span class="tile__unit" data-rm-unit>${def.unit}</span>`;
        this.$val = this.querySelector('[data-rm-val]');
        this.$unit = this.querySelector('[data-rm-unit]');

        this.abort?.abort();
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};

        if(def.prop) {
            this.setVal(def.fmt(def.read()));
            xf.sub(def.prop, v => this.setVal(def.fmt(v)), signal);
        } else if(def.analytics) {
            xf.sub('analytics:update', session => {
                const s = session?.summary?.();
                this.setVal(s ? def.fmt(def.analytics(s)) : '--');
            }, signal);
        } else if(def.custom === 'wkg') {
            const render = () => {
                const p = Number.isFinite(db.power1s) ? db.power1s : db.power;
                const w = db.weight > 0 ? db.weight : 75;
                this.setVal(Number.isFinite(p) && p > 0 ? (p / w).toFixed(2) : '--');
            };
            render();
            xf.sub('db:power1s', render, signal);
            xf.sub('db:weight', render, signal);
        } else if(def.custom === 'speedAvg') {
            const render = () => {
                const imperial = db.measurement === 'imperial';
                if(this.$unit) this.$unit.textContent = imperial ? 'mph' : 'km/h';
                const dist = Number(db.distance) || 0;
                const sec = Number(db.elapsed) || 0;
                if(!(dist > 0 && sec > 0)) { this.setVal('--'); return; }
                const mps = dist / sec;
                const val = imperial ? models.speed.mpsToMph(mps) : models.speed.mpsToKmh(mps);
                this.setVal(val.toFixed(1));
            };
            render();
            xf.sub('db:distance', render, signal);
            xf.sub('db:elapsed', render, signal);
            xf.sub('db:measurement', render, signal);
        }
    }

    disconnectedCallback() {
        this.abort?.abort();
    }

    setVal(text) {
        if(this.$val && this.$val.textContent !== text) this.$val.textContent = text;
    }
}

if(!customElements.get('ride-metric')) {
    customElements.define('ride-metric', RideMetric);
}

export { RideMetric, RIDE_METRICS };
