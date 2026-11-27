//
// Desktop training dashboard
//
// <live-chart>      uPlot chart of power (zone coloured), target, heart rate, cadence, W′bal
// <training-stats>  live session statistics: interval, load, power, heart, zones, best efforts
//
// Both read from a single SessionStats instance that is fed one sample per
// recorded second (every tick of the watch while it is running).
//

import { xf } from '../functions.js';
import { db } from '../db.js';
import { riders } from '../riders.js';
import { SessionStats, zoneIndex, ZONES, DEFAULT_WPRIME } from '../analytics.js';
import { currentLayout, chartRangeFor } from './layout.js';
import { ChartTooltip } from './charts/tooltip.js';
import {
    RANGES, SERIES, fmtTime, powerMax, powerSplits, hrBounds, hrTicks, buildLiveData,
} from './charts/live-chart-data.js';

// --- session feed ---------------------------------------------------------

const live = {
    power: 0,
    heartRate: 0,
    cadence: 0,
    powerTarget: 0,
    mode: 'erg',
    workoutStatus: 'stopped',
    intervalIndex: 0,
    lastElapsed: 0,
};

function loadWprime() {
    try {
        const v = parseInt(localStorage.getItem(riders.key('dashboard:wprime')));
        return v > 0 ? v : DEFAULT_WPRIME;
    } catch(e) { return DEFAULT_WPRIME; }
}

const session = new SessionStats({ftp: db.ftp, weight: db.weight, wprime: loadWprime()});

// W' in joules; used by the panel input and by account sync
// (while the rider model is in use, W′bal keeps the model's W′; the typed
// one is stored for when it isn't)
let modelSource = 'settings';
function setWprime(joules) {
    if(!(joules >= 5000 && joules <= 60000)) return;
    const w = Math.round(joules);
    if(modelSource !== 'model') session.setWprime(w);
    try { localStorage.setItem(riders.key('dashboard:wprime'), String(w)); } catch(e) {}
    notify();
}

// the rider model (src/training/rider-model-wiring.js): W′bal against its CP
// and W′ when they are in use; the typed W′ stays stored, for when they aren't
function applyModel(eff) {
    if(!eff) return;
    modelSource = eff.source;
    session.setCp(eff.source === 'model' ? eff.cp : null);
    const w = eff.source === 'model' ? eff.wprime : loadWprime();
    if(w >= 5000 && w <= 60000) session.setWprime(Math.round(w));
    window.dispatchEvent(new CustomEvent('rider-model:applied', {detail: {data: eff}}));
    notify();
}

function currentTarget() {
    const following = live.mode === 'erg' || live.workoutStatus === 'started';
    return following ? (live.powerTarget || 0) : 0;
}

function notify() {
    xf.dispatch('analytics:update', session);
}

xf.sub('db:power1s',      x => { live.power = x; });
xf.sub('db:heartRate',    x => { live.heartRate = x; });
xf.sub('db:cadence',      x => { live.cadence = x; });
xf.sub('db:powerTarget',  x => { live.powerTarget = x; });
xf.sub('db:mode',         x => { live.mode = x; });
xf.sub('db:workoutStatus', x => { live.workoutStatus = x; });
xf.sub('db:intervalIndex', x => { live.intervalIndex = x; });
xf.sub('db:ftp',          x => { session.setFtp(x); notify(); });
xf.sub('db:weight',       x => { session.setWeight(x); notify(); });

// after a ride is stopped the statistics stay on screen for review;
// they reset when the next ride starts (or immediately if discarded)
let rideFinished = false;

xf.sub('activity:discarded', () => {
    rideFinished = false;
    live.lastElapsed = 0;
    session.reset();
    notify();
});

xf.sub('db:elapsed', elapsed => {
    if(!(elapsed > 0)) {
        if(live.lastElapsed > 0) rideFinished = true;
        live.lastElapsed = 0;
        return;
    }
    if(rideFinished) {
        rideFinished = false;
        session.reset();
    }
    if(elapsed <= live.lastElapsed) {
        live.lastElapsed = elapsed;
        return;
    }
    live.lastElapsed = elapsed;
    session.push({
        power:     live.power,
        heartRate: live.heartRate,
        cadence:   live.cadence,
        target:    currentTarget(),
        interval:  live.intervalIndex,
    });
    notify();
});

// after a page reload the app restores the recorded session, rebuild from it
xf.sub('workout:restore', () => {
    session.setFtp(db.ftp);
    session.setWeight(db.weight);
    const records = (db.records ?? []).filter(r => r && 'power' in r);
    if(records.length === 0 || session.count > 0) return;
    records.forEach(r => session.push({
        power: r.power ?? 0, heartRate: r.heart_rate ?? 0, cadence: r.cadence ?? 0, target: 0, interval: -1,
    }));
    live.lastElapsed = db.elapsed ?? records.length;
    notify();
});

// --- helpers --------------------------------------------------------------

function n0(x) { return x > 0 ? Math.round(x).toString() : '--'; }
function n1(x) { return x > 0 ? x.toFixed(1) : '--'; }
function n2(x) { return x > 0 ? x.toFixed(2) : '--'; }

function cssVar(el, name, fallback) {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
}

// --- hero power tile: zone colour + zone name + W/kg ----------------------

function startHeroTile() {
    const $tile = document.querySelector('#data-tile--power');
    if(!$tile) return;
    const $meta = document.createElement('div');
    $meta.className = 'hero-meta';
    $meta.innerHTML = `<span class="hero-meta--zone">--</span><span class="hero-meta--wkg">-- W/kg</span>`;
    $tile.appendChild($meta);
    const $zone = $meta.querySelector('.hero-meta--zone');
    const $wkg  = $meta.querySelector('.hero-meta--wkg');

    xf.sub('db:power1s', power => {
        const z = ZONES[zoneIndex(power, session.ftp)];
        $tile.style.setProperty('--zone-color', power > 0 ? z.color : 'var(--line)');
        $tile.dataset.zone = power > 0 ? z.key : '';
        $zone.textContent = power > 0 ? `${z.short} ${z.name}` : 'No power';
        $wkg.textContent = power > 0 && session.weight > 0 ?
            `${(power / session.weight).toFixed(1)} W/kg` : '-- W/kg';
    });
}

xf.sub('app:start', () => {
    if(document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startHeroTile, {once: true});
    } else {
        startHeroTile();
    }
});

// --- <live-chart> ---------------------------------------------------------

// Series order inside uPlot's AlignedData: [x, power, wbal, target, cadence, hr]
// Power is first so the lines draw on top of the zone-coloured columns.
const SERIES_INDEX = {power: 1, wbal: 2, target: 3, cadence: 4, hr: 5};

let uplotPromise = null;
function loadUPlot() {
    if(!uplotPromise) uplotPromise = import('uplot').then(m => m.default ?? m);
    return uplotPromise;
}

function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(riders.key('dashboard:chart'))) ?? {};
    } catch(e) { return {}; }
}
function savePrefs(prefs) {
    try { localStorage.setItem(riders.key('dashboard:chart'), JSON.stringify(prefs)); } catch(e) {}
}

class LiveChart extends HTMLElement {
    // Tests may inject a uPlot constructor directly; in the browser uPlot is
    // dynamically imported so it stays in its own code-split chunk.
    static uPlot = null;

    connectedCallback() {
        const prefs = loadPrefs();
        this.range = prefs.range ?? '20';
        this.visible = Object.assign({power: true, target: true, hr: true, cadence: false, wbal: true}, prefs.visible ?? {});
        this._xMin = 0;
        this._xMax = 1200;
        this._step = 1;
        this._hasHr = false;
        this._colors = null;

        this.innerHTML = `
            <div class="lc--bar">
                <h3 class="panel__title">Ride</h3>
                <div class="lc--legend" role="group" aria-label="Series">
                    ${SERIES.map(s => `
                        <button type="button" class="lc--chip lc--chip-${s.key}" data-series="${s.key}"
                                aria-pressed="${this.visible[s.key]}">
                            <span class="lc--swatch"></span>${s.label}
                        </button>`).join('')}
                </div>
                <div class="lc--range" role="group" aria-label="Time range">
                    ${RANGES.map(r => `
                        <button type="button" class="lc--seg" data-range="${r.key}"
                                aria-pressed="${r.key === this.range}">${r.label}</button>`).join('')}
                </div>
            </div>
            <div class="lc--plot">
                <div class="lc--stage"></div>
                <div class="lc--empty">Start the clock and your ride is drawn here, second by second.</div>
                <div class="lc--tip" hidden></div>
            </div>`;

        this.$plot   = this.querySelector('.lc--plot');
        this.$stage  = this.querySelector('.lc--stage');
        this.$empty  = this.querySelector('.lc--empty');
        this.$tip    = this.querySelector('.lc--tip');
        this.tooltip = new ChartTooltip(this.$tip, {owner: this});

        this.querySelector('.lc--legend').addEventListener('click', e => {
            const b = e.target.closest('[data-series]');
            if(!b) return;
            const k = b.dataset.series;
            this.visible[k] = !this.visible[k];
            b.setAttribute('aria-pressed', String(this.visible[k]));
            this.persist();
            const idx = SERIES_INDEX[k];
            if(this.plot && idx) this.plot.setSeries(idx, {show: this.visible[k]});
        });
        this.querySelector('.lc--range').addEventListener('click', e => {
            const b = e.target.closest('[data-range]');
            if(!b) return;
            this.range = b.dataset.range;
            this.querySelectorAll('[data-range]').forEach(x =>
                x.setAttribute('aria-pressed', String(x.dataset.range === this.range)));
            this.persist();
            this.update();
        });

        this.ro = new ResizeObserver(() => this.onResize());
        this.ro.observe(this.$plot);

        this.onUpdate = () => this.update();
        this.handler = xf.sub('analytics:update', this.onUpdate);
        this.themeObserver = new MutationObserver(() => this.rebuild());
        this.themeObserver.observe(document.body, {attributes: true, attributeFilter: ['class', 'data-palette']});

        this.syncEmpty();
        this.ensurePlot();
    }

    disconnectedCallback() {
        this.tooltip?.hide();
        this.ro?.disconnect();
        this.themeObserver?.disconnect();
        xf.unsub('analytics:update', this.handler);
        this.plot?.destroy();
        this.plot = null;
    }

    persist() {
        savePrefs({range: this.range, visible: this.visible});
    }

    syncEmpty() {
        const n = session.count;
        if(this.$empty) this.$empty.hidden = n > 0;
        this.dataset.samples = String(n);
    }

    size() {
        const r = this.$plot?.getBoundingClientRect();
        const width = Math.floor(r?.width || this.$plot?.clientWidth || 0);
        const height = Math.floor(r?.height || this.$plot?.clientHeight || 0);
        return {width, height};
    }

    colors() {
        return {
            ink:   cssVar(this, '--ink', '#E8EDF3'),
            muted: cssVar(this, '--muted', '#8A96A6'),
            line:  cssVar(this, '--line', '#2A3442'),
            hr:    cssVar(this, '--hr', '#FF5C7A'),
            cadence: cssVar(this, '--cadence', '#B38CFF'),
            wbal:  cssVar(this, '--wbal', '#39D0E8'),
            font:  `12px ${cssVar(this, '--font-text', '"Barlow", system-ui, sans-serif')}`,
            zones: ['--zone-1', '--zone-2', '--zone-3', '--zone-4',
                    '--zone-5', '--zone-6', '--zone-7']
                .map(v => cssVar(document.body, v, '#888')),
        };
    }

    prepareData() {
        const rangeKey = chartRangeFor(currentLayout(), this.range);
        const prepared = buildLiveData(session, rangeKey);
        this._xMin = prepared.xMin;
        this._xMax = prepared.xMax;
        this._step = prepared.step;
        this._hasHr = prepared.hasHr;
        return prepared.data;
    }

    ensurePlot() {
        if(!this.isConnected || this.plot) return;
        const {width, height} = this.size();
        if(!(width > 0 && height > 0)) return;
        if(LiveChart.uPlot) {
            this.build(LiveChart.uPlot, width, height);
            return;
        }
        if(this._loading) return;
        this._loading = true;
        loadUPlot().then(U => {
            this._loading = false;
            if(!this.isConnected || this.plot) return;
            const sz = this.size();
            if(sz.width > 0 && sz.height > 0) this.build(U, sz.width, sz.height);
        }).catch(() => { this._loading = false; });
    }

    onResize() {
        const {width, height} = this.size();
        if(!(width > 0 && height > 0)) return;
        if(!this.plot) {
            this.ensurePlot();
            return;
        }
        this.plot.setSize({width, height});
    }

    rebuild() {
        if(!this.isConnected) return;
        const U = LiveChart.uPlot ?? this._U;
        if(!U) { this.ensurePlot(); return; }
        const {width, height} = this.size();
        if(!(width > 0 && height > 0)) return;
        this.build(U, width, height);
    }

    build(U, width, height) {
        this._U = U;
        this.tooltip?.hide();
        this.plot?.destroy();
        this.plot = null;
        this.$stage.innerHTML = '';

        const c = this._colors = this.colors();
        const data = this.prepareData();
        const axisBase = {stroke: c.muted, font: c.font, gap: 3, ticks: {show: false}};

        const opts = {
            width,
            height,
            legend: {show: false},
            padding: [4, 4, 0, 0],
            scales: {
                x:    {time: false, auto: false, range: () => [this._xMin, this._xMax]},
                w:    {auto: true,  range: (u, min, max) => [0, powerMax(session.ftp, max)]},
                wbal: {auto: false, range: () => [0, Math.max(1, session.wprime)]},
                rpm:  {auto: false, range: (u, min, max) => [0, Math.max(140, Number.isFinite(max) ? max : 0)]},
                bpm:  {auto: true,  range: (u, min, max) => hrBounds(min, max)},
            },
            series: [
                {},
                {
                    label: 'Power', scale: 'w', show: this.visible.power,
                    stroke: 'transparent', width: 0, paths: () => null,
                    points: {show: false},
                },
                {
                    label: 'W′bal', scale: 'wbal', show: this.visible.wbal,
                    stroke: c.wbal, width: 2, spanGaps: false,
                    points: {show: false},
                },
                {
                    label: 'Target', scale: 'w', show: this.visible.target,
                    stroke: c.ink, width: 2, dash: [5, 3], spanGaps: false,
                    points: {show: false},
                },
                {
                    label: 'Cadence', scale: 'rpm', show: this.visible.cadence,
                    stroke: c.cadence, width: 1.5, spanGaps: false,
                    points: {show: false},
                },
                {
                    label: 'Heart rate', scale: 'bpm', show: this.visible.hr,
                    stroke: c.hr, width: 2, spanGaps: false,
                    points: {show: false},
                },
            ],
            axes: [
                {
                    ...axisBase,
                    size: 20,
                    grid: {show: false},
                    incrs: [30, 60, 120, 300, 600, 900, 1800, 3600],
                    values: (u, vals) => vals.map(fmtTime),
                },
                {
                    ...axisBase,
                    scale: 'w',
                    size: 32,
                    grid: {stroke: c.line, width: 1},
                    splits: (u, axisIdx, scaleMin, scaleMax) => powerSplits(session.ftp, scaleMax),
                    values: (u, vals) => vals.map(v =>
                        session.ftp > 0 && Math.abs(v - session.ftp) < 1 ? 'FTP' : String(Math.round(v))),
                },
                {
                    ...axisBase,
                    scale: 'bpm',
                    side: 1,
                    size: () => (this.visible.hr && this._hasHr ? 28 : 0),
                    stroke: c.hr,
                    grid: {show: false},
                    splits: (u, axisIdx, scaleMin, scaleMax) => {
                        if(!this.visible.hr || !this._hasHr) return [];
                        const dpr = window.devicePixelRatio || 1;
                        return hrTicks(scaleMin, scaleMax, (u.bbox?.height ?? 0) / dpr);
                    },
                    values: (u, vals) => vals.map(v => String(Math.round(v))),
                },
            ],
            cursor: {
                drag: {x: false, y: false},
                y: false,
                points: {
                    size: 6,
                    fill: (u, sidx) => {
                        if(sidx === 1) {
                            const i = u.cursor?.idx;
                            const p = i != null ? u.data[1]?.[i] : null;
                            return p > 0 ? c.zones[zoneIndex(p, session.ftp)] : c.muted;
                        }
                        return u.series[sidx]?.stroke ?? c.ink;
                    },
                },
            },
            hooks: {
                drawAxes: [u => this.drawFtpLine(u)],
                drawSeries: [(u, sidx) => { if(sidx === 1) this.drawZoneBars(u); }],
                setCursor: [u => this.showTip(u)],
            },
        };

        this.plot = new U(opts, data, this.$stage);
        this.plot.setScale?.('x', {min: this._xMin, max: this._xMax});
        this.bindPlotEvents();
        this.syncEmpty();
    }

    bindPlotEvents() {
        const over = this.plot?.over;
        if(!over) return;
        const touchDevice = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
        over.addEventListener('mouseleave', () => { if(!touchDevice) this.tooltip?.hide(); });

        const scrub = e => {
            const t = e.touches?.[0];
            if(!t || !this.plot) return;
            const r = over.getBoundingClientRect();
            this.plot.setCursor({left: t.clientX - r.left, top: t.clientY - r.top});
        };
        let start = null;
        over.addEventListener('touchstart', e => {
            const t = e.touches?.[0];
            start = t ? {x: t.clientX, y: t.clientY} : null;
            scrub(e);
        }, {passive: true});
        over.addEventListener('touchmove', e => {
            const t = e.touches?.[0];
            if(!t || !start || Math.abs(t.clientY - start.y) > Math.abs(t.clientX - start.x)) return;
            scrub(e);
            e.preventDefault();
        }, {passive: false});
        over.style.touchAction = 'pan-y';
    }

    update() {
        this.syncEmpty();
        if(!this.plot) {
            this.ensurePlot();
            return;
        }
        const data = this.prepareData();
        const apply = () => {
            this.plot.setData(data, true);
            this.plot.setScale?.('x', {min: this._xMin, max: this._xMax});
        };
        if(typeof this.plot.batch === 'function') this.plot.batch(apply);
        else apply();
    }

    drawFtpLine(u) {
        const ftp = session.ftp;
        if(!(ftp > 0) || !u.ctx || !u.bbox) return;
        const y = Math.round(u.valToPos(ftp, 'w', true)) + 0.5;
        if(y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;
        const dpr = window.devicePixelRatio || 1;
        const ctx = u.ctx;
        ctx.save();
        ctx.strokeStyle = this._colors?.muted ?? '#8A96A6';
        ctx.lineWidth = Math.max(1, Math.round(dpr));
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(u.bbox.left, y);
        ctx.lineTo(u.bbox.left + u.bbox.width, y);
        ctx.stroke();
        ctx.restore();
    }

    drawZoneBars(u) {
        const xs = u.data?.[0];
        const ps = u.data?.[1];
        if(!xs?.length || !ps || !u.ctx || !u.bbox) return;
        const span = Math.max(1, (u.scales.x.max ?? 1) - (u.scales.x.min ?? 0));
        const dpr = window.devicePixelRatio || 1;
        const rawW = (this._step || 1) * (u.bbox.width / span);
        const barW = Math.max(1, rawW - (rawW > 3 * dpr ? dpr : 0));
        const baseY = u.bbox.top + u.bbox.height;
        const ftp = session.ftp;
        const zones = this._colors?.zones ?? [];
        const byZone = [[], [], [], [], [], [], []];

        for(let i = 0; i < xs.length; i++) {
            const p = ps[i];
            if(!(p > 0)) continue;
            const x = u.valToPos(xs[i], 'x', true);
            const y = u.valToPos(p, 'w', true);
            const h = baseY - y;
            if(!(h > 0)) continue;
            byZone[zoneIndex(p, ftp)].push(x, y, h);
        }

        const ctx = u.ctx;
        ctx.save();
        ctx.globalAlpha = 0.9;
        for(let z = 0; z < byZone.length; z++) {
            const rects = byZone[z];
            if(!rects.length) continue;
            ctx.fillStyle = zones[z] ?? '#888';
            ctx.beginPath();
            for(let j = 0; j < rects.length; j += 3) {
                ctx.rect(rects[j], rects[j + 1], barW, rects[j + 2]);
            }
            ctx.fill();
        }
        ctx.restore();
    }

    showTip(u) {
        const i = u.cursor?.idx;
        const xs = u.data?.[0];
        if(i == null || !xs?.length || !(u.cursor.left >= 0) || u.cursor.left > (u.over?.clientWidth ?? Infinity)) {
            this.tooltip?.hide();
            return;
        }
        const t = xs[i];
        const p = u.data[1]?.[i] ?? 0;
        const wb = u.data[2]?.[i] ?? 0;
        const tg = u.data[3]?.[i] ?? 0;
        const cd = u.data[4]?.[i] ?? 0;
        const hr = u.data[5]?.[i] ?? 0;
        const rows = [
            `<b>${fmtTime(Math.round(t) + 1)}</b>`,
            `Power ${Math.round(p)} W`,
            tg > 0 ? `Target ${Math.round(tg)} W` : '',
            hr > 0 ? `Heart rate ${Math.round(hr)} bpm` : '',
            cd > 0 ? `Cadence ${Math.round(cd)} rpm` : '',
            `W′bal ${(wb / 1000).toFixed(1)} kJ`,
        ].filter(Boolean);
        const over = u.over?.getBoundingClientRect() ?? this.$plot.getBoundingClientRect();
        this.tooltip?.show({
            html: rows.join('<br>'),
            x: over.left + u.cursor.left,
            plotTop: over.top,
        });
    }
}

customElements.define('live-chart', LiveChart);

// --- <training-stats> -----------------------------------------------------

class TrainingStats extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <section class="panel ts--section ts--interval">
                <h3 class="panel__title">This interval <span class="ts--sub" data-k="iv-time"></span></h3>
                <div class="ts--interval-main">
                    <div class="ts--big"><span data-k="iv-power">--</span><small>W avg</small></div>
                    <div class="ts--vs">target <span data-k="iv-target">--</span> W</div>
                </div>
                <div class="ts--meter" aria-label="Time on target">
                    <div class="ts--meter-fill" data-k="iv-adh-bar"></div>
                </div>
                <div class="ts--meter-label"><span data-k="iv-adh">--</span> of the interval within 5% of target</div>
                <ul class="ts--cues" data-k="cues"></ul>
            </section>

            <section class="panel ts--section ts--wbal">
                <h3 class="panel__title">Anaerobic reserve
                    <label class="ts--wprime" title="W′: the work you can do above FTP/CP before you are empty. GoldenCheetah default is 20 kJ.">
                        W′ <input type="number" min="5" max="60" step="0.5" data-k="wprime-input"> kJ
                    </label>
                </h3>
                <div class="ts--interval-main">
                    <div class="ts--big"><span data-k="wbal-pct">100</span><small>% W′bal</small></div>
                    <div class="ts--vs"><span data-k="wbal-kj">--</span> kJ left</div>
                </div>
                <div class="ts--meter ts--meter-wbal" aria-label="W′ balance">
                    <div class="ts--meter-fill" data-k="wbal-bar"></div>
                </div>
                <div class="ts--meter-label" data-k="wbal-state">Full</div>
                <dl class="ts--grid ts--grid-3">
                    <div class="ts--kpi"><dt>Matches</dt><dd data-k="matches">0</dd></div>
                    <div class="ts--kpi"><dt>Lowest</dt><dd><span data-k="wbal-min">--</span><small>%</small></dd></div>
                    <div class="ts--kpi"><dt>Above FTP</dt><dd><span data-k="above-cp">--</span><small>kJ</small></dd></div>
                </dl>
            </section>

            <section class="panel ts--section">
                <h3 class="panel__title">Training load</h3>
                <dl class="ts--grid ts--grid-3">
                    <div class="ts--kpi ts--kpi-lead"><dt>TSS</dt><dd data-k="tss">--</dd></div>
                    <div class="ts--kpi" title="Skiba's BikeScore, as in GoldenCheetah"><dt>BikeScore</dt><dd data-k="bikescore">--</dd></div>
                    <div class="ts--kpi"><dt>IF</dt><dd data-k="if">--</dd></div>
                    <div class="ts--kpi"><dt>NP</dt><dd><span data-k="np">--</span><small>W</small></dd></div>
                    <div class="ts--kpi" title="Skiba's xPower (25 s weighted)"><dt>xPower</dt><dd><span data-k="xpower">--</span><small>W</small></dd></div>
                    <div class="ts--kpi"><dt>Work</dt><dd><span data-k="kj">--</span><small>kJ</small></dd></div>
                </dl>
                <div class="ts--focus" title="Skiba aerobic and anaerobic TISS, as in GoldenCheetah">
                    <div class="ts--focus-label"><span>Aerobic <b data-k="aer">--</b></span><span>Anaerobic <b data-k="anaer">--</b></span></div>
                    <div class="ts--focus-bar"><span data-k="aer-bar"></span></div>
                </div>
            </section>

            <section class="panel ts--section">
                <h3 class="panel__title">Power</h3>
                <dl class="ts--grid">
                    <div class="ts--kpi"><dt>Average</dt><dd><span data-k="avg">--</span><small>W</small></dd></div>
                    <div class="ts--kpi"><dt>Max</dt><dd><span data-k="max">--</span><small>W</small></dd></div>
                    <div class="ts--kpi"><dt>Average W/kg</dt><dd data-k="wkg">--</dd></div>
                    <div class="ts--kpi"><dt>Variability</dt><dd data-k="vi">--</dd></div>
                </dl>
            </section>

            <section class="panel ts--section">
                <h3 class="panel__title">Heart</h3>
                <dl class="ts--grid">
                    <div class="ts--kpi"><dt>Average</dt><dd><span data-k="hr-avg">--</span><small>bpm</small></dd></div>
                    <div class="ts--kpi"><dt>Max</dt><dd><span data-k="hr-max">--</span><small>bpm</small></dd></div>
                    <div class="ts--kpi"><dt>Efficiency (NP/HR)</dt><dd data-k="ef">--</dd></div>
                    <div class="ts--kpi"><dt>Power:HR drift</dt><dd data-k="dec">--</dd></div>
                </dl>
            </section>

            <section class="panel ts--section">
                <h3 class="panel__title">Time in zone</h3>
                <ol class="ts--zones" data-k="zones">
                    ${ZONES.map(z => `
                        <li class="ts--zone" style="--zc: ${z.color}">
                            <span class="ts--zone-name"><b>${z.short}</b> ${z.name}</span>
                            <span class="ts--zone-track"><span class="ts--zone-bar"></span></span>
                            <span class="ts--zone-time">0:00</span>
                        </li>`).join('')}
                </ol>
            </section>

            <section class="panel ts--section">
                <h3 class="panel__title">Best efforts</h3>
                <table class="ts--best">
                    <tbody data-k="best"></tbody>
                </table>
            </section>`;

        this.$ = {};
        this.querySelectorAll('[data-k]').forEach(el => { this.$[el.dataset.k] = el; });
        this.$zoneRows = [...this.querySelectorAll('.ts--zone')];
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.handler = xf.sub('analytics:update', () => this.render());

        const $w = this.$['wprime-input'];
        $w.value = (session.wprime / 1000).toFixed(1);
        // from the rider model: shown, not typed over
        const showSource = () => {
            const model = modelSource === 'model';
            $w.value = (session.wprime / 1000).toFixed(1);
            $w.disabled = model;
            $w.title = model ? 'From the rider model (Training → CP and W′)' : '';
        };
        showSource();
        window.addEventListener('rider-model:applied', showSource, signal);
        $w.addEventListener('change', () => {
            const kj = parseFloat($w.value);
            if(!(kj >= 5 && kj <= 60)) {
                $w.value = (session.wprime / 1000).toFixed(1);
                return;
            }
            setWprime(Math.round(kj * 1000));
            xf.dispatch('dashboard:wprime', session.wprime);
        }, signal);

        this.render();
    }

    disconnectedCallback() {
        this.abort?.abort();
        xf.unsub('analytics:update', this.handler);
    }

    set(k, v) {
        if(this.$[k] && this.$[k].textContent !== v) this.$[k].textContent = v;
    }

    render() {
        const s = session.summary();
        const iv = s.interval;

        this.set('iv-time', iv.seconds > 0 ? fmtTime(iv.seconds) : '');
        this.set('iv-power', n0(iv.avgPower));
        this.set('iv-target', n0(iv.avgTarget));
        const adh = iv.adherence;
        this.set('iv-adh', adh === null ? '--' : `${Math.round(adh * 100)}%`);
        this.$['iv-adh-bar'].style.width = `${adh === null ? 0 : Math.round(adh * 100)}%`;
        this.$['iv-adh-bar'].dataset.level = adh === null ? '' : adh >= 0.8 ? 'good' : adh >= 0.5 ? 'ok' : 'low';

        const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const cues = session.cues({target: currentTarget()});
        const html = cues.length ?
            cues.map(c => `<li class="ts--cue" data-level="${esc(c.level)}">${esc(c.text)}</li>`).join('') :
            (s.seconds === 0 ? `<li class="ts--cue" data-level="info">Pacing tips show up once you start riding.</li>` : '');
        if(this.$.cues.innerHTML !== html) this.$.cues.innerHTML = html;

        // W'bal
        const pct = Math.round(s.wbalPct * 100);
        this.set('wbal-pct', `${pct}`);
        this.set('wbal-kj', (s.wbal / 1000).toFixed(1));
        const $bar = this.$['wbal-bar'];
        $bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        $bar.dataset.level = pct > 75 ? 'good' : pct > 50 ? 'ok' : pct > 25 ? 'low' : 'empty';
        let state;
        if(s.seconds === 0) {
            state = 'Full. It drains above FTP and refills below it.';
        } else if(s.timeToEmpty !== null) {
            state = `Draining — empty in ${fmtTime(s.timeToEmpty)} at this power`;
        } else if(s.wbalPct >= 0.995) {
            state = 'Full';
        } else {
            const zone = s.wbalZones[Math.min(3, Math.floor((1 - Math.max(0, s.wbalPct)) * 4))];
            state = `Refilling, ${zone.short} ${zone.name.toLowerCase()}`;
        }
        this.set('wbal-state', state);
        this.set('matches', `${s.matches}`);
        this.set('wbal-min', `${Math.round(s.wbalMin / s.wprime * 100)}`);
        this.set('above-cp', s.aboveCPkj > 0 ? s.aboveCPkj.toFixed(1) : '0');
        if(document.activeElement !== this.$['wprime-input']) {
            const v = (s.wprime / 1000).toFixed(1);
            if(this.$['wprime-input'].value !== v) this.$['wprime-input'].value = v;
        }

        this.set('bikescore', s.bikescore > 0 ? Math.round(s.bikescore).toString() : '--');
        this.set('xpower', n0(s.xpower));
        const aer = s.aerobicity;
        const pctText = x => x < 0.1 && x > 0 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`;
        this.set('aer', aer === null ? '--' : pctText(aer));
        this.set('anaer', aer === null ? '--' : pctText(1 - aer));
        this.$['aer-bar'].style.width = `${aer === null ? 0 : Math.round(aer * 100)}%`;

        this.set('tss', s.tss > 0 ? Math.round(s.tss).toString() : '--');
        this.set('if', n2(s.intensity));
        this.set('np', n0(s.np));
        this.set('kj', n0(s.kj));

        this.set('avg', n0(s.avgPower));
        this.set('max', n0(s.maxPower));
        this.set('wkg', n2(s.wkg));
        this.set('vi', n2(s.vi));

        this.set('hr-avg', n0(s.avgHR));
        this.set('hr-max', n0(s.maxHR));
        this.set('ef', n2(s.ef));
        this.set('dec', s.decoupling === null ? 'after 10 min' : `${s.decoupling.toFixed(1)}%`);
        if(this.$.dec) this.$.dec.dataset.level = s.decoupling === null ? 'muted' :
            s.decoupling > 5 ? 'warn' : 'good';

        const maxFrac = Math.max(0.0001, ...s.zones.map(z => z.fraction));
        s.zones.forEach((z, i) => {
            const row = this.$zoneRows[i];
            row.querySelector('.ts--zone-bar').style.width = `${(z.fraction / maxFrac) * 100}%`;
            const t = fmtTime(z.seconds);
            const $t = row.querySelector('.ts--zone-time');
            if($t.textContent !== t) $t.textContent = t;
            row.title = `${Math.round(z.fraction * 100)}% of ride`;
        });

        const best = s.best.map(b => `
            <tr${b.available ? '' : ' class="is-pending"'}>
                <th scope="row">${b.label}</th>
                <td>${b.available ? Math.round(b.watts) : '--'}<small>W</small></td>
                <td>${b.available && b.wkg > 0 ? b.wkg.toFixed(2) : '--'}<small>W/kg</small></td>
            </tr>`).join('');
        if(this._bestHtml !== best) {
            this.$.best.innerHTML = best;
            this._bestHtml = best;
        }
    }
}

customElements.define('training-stats', TrainingStats);

export { session, setWprime, applyModel, loadWprime, LiveChart };
