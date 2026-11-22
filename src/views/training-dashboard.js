//
// Desktop training dashboard
//
// <live-chart>      canvas chart of power (zone coloured), target, heart rate, cadence
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
function setWprime(joules) {
    if(!(joules >= 5000 && joules <= 60000)) return;
    session.setWprime(Math.round(joules));
    try { localStorage.setItem(riders.key('dashboard:wprime'), String(session.wprime)); } catch(e) {}
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
// they reset when the next ride starts
let rideFinished = false;

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
        power: r.power, heartRate: r.heart_rate, cadence: r.cadence, target: 0, interval: -1,
    }));
    live.lastElapsed = db.elapsed ?? records.length;
    notify();
});

// --- helpers --------------------------------------------------------------

function fmtTime(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

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

const RANGES = [
    {key: '5',   label: '5 min',  seconds: 300},
    {key: '20',  label: '20 min', seconds: 1200},
    {key: 'all', label: 'Whole ride', seconds: Infinity},
];

const SERIES = [
    {key: 'power',   label: 'Power'},
    {key: 'target',  label: 'Target'},
    {key: 'hr',      label: 'Heart rate'},
    {key: 'cadence', label: 'Cadence'},
    {key: 'wbal',    label: 'W′bal'},
];

function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(riders.key('dashboard:chart'))) ?? {};
    } catch(e) { return {}; }
}
function savePrefs(prefs) {
    try { localStorage.setItem(riders.key('dashboard:chart'), JSON.stringify(prefs)); } catch(e) {}
}

class LiveChart extends HTMLElement {
    connectedCallback() {
        const prefs = loadPrefs();
        this.range = prefs.range ?? '20';
        this.visible = Object.assign({power: true, target: true, hr: true, cadence: false, wbal: true}, prefs.visible ?? {});
        this.hoverX = null;

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
                <canvas class="lc--canvas"></canvas>
                <div class="lc--empty">Start the clock and your ride is drawn here, second by second.</div>
                <div class="lc--tip" hidden></div>
            </div>`;

        this.$canvas = this.querySelector('canvas');
        this.$plot   = this.querySelector('.lc--plot');
        this.$empty  = this.querySelector('.lc--empty');
        this.$tip    = this.querySelector('.lc--tip');
        this.ctx     = this.$canvas.getContext('2d');

        this.querySelector('.lc--legend').addEventListener('click', e => {
            const b = e.target.closest('[data-series]');
            if(!b) return;
            const k = b.dataset.series;
            this.visible[k] = !this.visible[k];
            b.setAttribute('aria-pressed', this.visible[k]);
            this.persist();
            this.draw();
        });
        this.querySelector('.lc--range').addEventListener('click', e => {
            const b = e.target.closest('[data-range]');
            if(!b) return;
            this.range = b.dataset.range;
            this.querySelectorAll('[data-range]').forEach(x =>
                x.setAttribute('aria-pressed', x.dataset.range === this.range));
            this.persist();
            this.draw();
        });

        this.$canvas.addEventListener('pointermove', e => {
            const r = this.$canvas.getBoundingClientRect();
            this.hoverX = e.clientX - r.left;
            this.draw();
        });
        this.$canvas.addEventListener('pointerleave', () => {
            this.hoverX = null;
            this.$tip.hidden = true;
            this.draw();
        });

        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(this.$plot);

        this.onUpdate = () => this.draw();
        this.handler = xf.sub('analytics:update', this.onUpdate);
        this.themeObserver = new MutationObserver(() => this.draw());
        this.themeObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
        this.resize();
    }

    disconnectedCallback() {
        this.ro?.disconnect();
        this.themeObserver?.disconnect();
        xf.unsub('analytics:update', this.handler);
    }

    persist() {
        savePrefs({range: this.range, visible: this.visible});
    }

    resize() {
        const r = this.$plot.getBoundingClientRect();
        if(r.width === 0 || r.height === 0) return;
        const dpr = window.devicePixelRatio || 1;
        this.w = r.width;
        this.h = r.height;
        this.$canvas.width = Math.round(r.width * dpr);
        this.$canvas.height = Math.round(r.height * dpr);
        this.$canvas.style.width = `${r.width}px`;
        this.$canvas.style.height = `${r.height}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw();
    }

    // reduce [start, end) samples to one bucket per pixel column
    buckets(start, end, cols) {
        const span = end - start;
        const per = Math.max(1, span / cols);
        const out = [];
        for(let c = 0; c * per < span; c++) {
            const a = start + Math.floor(c * per);
            const b = Math.min(end, start + Math.floor((c + 1) * per));
            if(b <= a) continue;
            let p = 0, t = 0, h = 0, hc = 0, cd = 0, cc = 0, wb = 0;
            for(let i = a; i < b; i++) {
                p += session.power[i];
                wb += session.wbalSeries[i] ?? 0;
                t += session.target[i];
                if(session.hr[i] > 0) { h += session.hr[i]; hc++; }
                if(session.cadence[i] > 0) { cd += session.cadence[i]; cc++; }
            }
            const len = b - a;
            out.push({i: a, power: p / len, target: t / len, hr: hc ? h / hc : 0, cadence: cc ? cd / cc : 0, wbal: wb / len});
        }
        return out;
    }

    draw() {
        if(!this.ctx || !this.w) return;
        const ctx = this.ctx, W = this.w, H = this.h;
        ctx.clearRect(0, 0, W, H);

        const n = session.count;
        this.$empty.hidden = n > 0;
        this.dataset.samples = String(n);

        const ink   = cssVar(this, '--dash-ink', '#E8EDF3');
        const muted = cssVar(this, '--dash-muted', '#8A96A6');
        const line  = cssVar(this, '--dash-line', '#2A3442');
        const hrCol = cssVar(this, '--dash-hr', '#FF5C7A');
        const cdCol = cssVar(this, '--dash-cadence', '#B38CFF');
        const wbCol = cssVar(this, '--dash-wbal', '#39D0E8');
        const zoneCols = ['--zone-gray', '--zone-blue', '--zone-teal', '--zone-green',
                          '--zone-yellow', '--zone-orange', '--zone-red']
              .map(v => cssVar(document.body, v, '#888'));

        const padL = 44, padR = 40, padT = 10, padB = 24;
        const pw = W - padL - padR, ph = H - padT - padB;

        const rangeKey = chartRangeFor(currentLayout(), this.range);
        const range = RANGES.find(r => r.key === rangeKey) ?? RANGES[1];
        const windowSec = Number.isFinite(range.seconds) ? range.seconds : Math.max(n, 300);
        const start = Math.max(0, n - windowSec);
        const data = this.buckets(start, n, Math.max(1, Math.floor(pw)));
        const xOf = i => padL + ((i - start) / windowSec) * pw;
        const colW = Math.max(1, pw / windowSec * Math.max(1, (n - start) / Math.max(1, data.length)));

        // scales
        const ftp = session.ftp;
        let pMax = ftp * 1.3;
        data.forEach(d => { pMax = Math.max(pMax, d.power, d.target); });
        pMax = Math.ceil(pMax / 50) * 50;
        const yP = v => padT + ph - (v / pMax) * ph;

        let hMin = 80, hMax = 190;
        const hrs = data.map(d => d.hr).filter(x => x > 0);
        if(hrs.length) {
            hMin = Math.max(40, Math.floor((Math.min(...hrs) - 10) / 10) * 10);
            hMax = Math.max(hMin + 40, Math.ceil((Math.max(...hrs) + 10) / 10) * 10);
        }
        const yH = v => padT + ph - ((v - hMin) / (hMax - hMin)) * ph;
        const yC = v => padT + ph - (v / 140) * ph;
        const W0 = session.wprime;
        const yW = v => padT + ph - (Math.max(0, Math.min(W0, v)) / W0) * ph;

        ctx.font = '13px "Barlow", system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        // gridlines at FTP fractions
        let lastLabelY = Infinity;
        [1.0, 0.75, 0.5, 1.25].sort((a, b) => a - b).forEach(f => {
            const v = ftp * f;
            if(v > pMax) return;
            const yy = yP(v);
            const showLabel = Math.abs(lastLabelY - yy) >= 16;
            if(showLabel) lastLabelY = yy;
            const y = Math.round(yP(v)) + 0.5;
            ctx.strokeStyle = line;
            ctx.lineWidth = 1;
            ctx.setLineDash(f === 1 ? [6, 4] : []);
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
            ctx.setLineDash([]);
            if(!showLabel) return;
            ctx.fillStyle = f === 1 ? ink : muted;
            ctx.textAlign = 'right';
            ctx.fillText(f === 1 ? `FTP` : `${Math.round(v)}`, padL - 6, y);
        });

        // time axis
        ctx.fillStyle = muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const step = windowSec <= 300 ? 60 : windowSec <= 1200 ? 300 : windowSec <= 3600 ? 600 : 1800;
        for(let t = Math.ceil(start / step) * step; t <= start + windowSec; t += step) {
            const x = xOf(t);
            if(x < padL + 10 || x > W - padR - 10) continue;
            ctx.fillText(fmtTime(t), x, padT + ph + 6);
        }
        ctx.textBaseline = 'middle';

        if(n === 0) return;

        // power columns coloured by zone
        if(this.visible.power) {
            ctx.globalAlpha = 0.9;
            data.forEach(d => {
                if(d.power <= 0) return;
                ctx.fillStyle = zoneCols[zoneIndex(d.power, ftp)];
                const x = xOf(d.i);
                const y = yP(d.power);
                ctx.fillRect(x, y, Math.max(1, colW - (colW > 3 ? 1 : 0)), padT + ph - y);
            });
            ctx.globalAlpha = 1;
        }

        const path = (key, yFn, color, width, dash = []) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.setLineDash(dash);
            ctx.lineJoin = 'round';
            ctx.beginPath();
            let pen = false;
            data.forEach(d => {
                const v = d[key];
                if(!(v > 0)) { pen = false; return; }
                const x = xOf(d.i) + colW / 2, y = yFn(v);
                pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
                pen = true;
            });
            ctx.stroke();
            ctx.setLineDash([]);
        };

        // W'bal: full height = W' full, bottom = empty
        if(this.visible.wbal) {
            ctx.strokeStyle = wbCol;
            ctx.lineWidth = 2;
            ctx.beginPath();
            data.forEach((d, k) => {
                const x = xOf(d.i) + colW / 2, y = yW(d.wbal);
                k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            });
            ctx.stroke();
        }

        if(this.visible.target)  path('target', yP, ink, 2, [5, 3]);
        if(this.visible.cadence) path('cadence', yC, cdCol, 1.5);
        if(this.visible.hr)      path('hr', yH, hrCol, 2);

        // right axis for heart rate
        if(this.visible.hr && hrs.length) {
            ctx.fillStyle = hrCol;
            ctx.textAlign = 'left';
            const ticks = ph > 120 ? [hMin, Math.round((hMin + hMax) / 2), hMax] : [hMin, hMax];
            ticks.forEach(v => ctx.fillText(`${v}`, W - padR + 6, yH(v)));
        }

        // hover crosshair
        if(this.hoverX !== null && this.hoverX >= padL && this.hoverX <= W - padR) {
            const i = Math.min(n - 1, Math.max(start, Math.round(start + (this.hoverX - padL) / pw * windowSec)));
            if(i < n) {
                const x = Math.round(xOf(i)) + 0.5;
                ctx.strokeStyle = ink;
                ctx.globalAlpha = 0.5;
                ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
                ctx.globalAlpha = 1;
                const rows = [
                    `<b>${fmtTime(i + 1)}</b>`,
                    `Power ${Math.round(session.power[i])} W`,
                    session.target[i] > 0 ? `Target ${Math.round(session.target[i])} W` : '',
                    session.hr[i] > 0 ? `Heart rate ${Math.round(session.hr[i])} bpm` : '',
                    session.cadence[i] > 0 ? `Cadence ${Math.round(session.cadence[i])} rpm` : '',
                    `W′bal ${(session.wbalSeries[i] / 1000).toFixed(1)} kJ`,
                ].filter(Boolean);
                this.$tip.innerHTML = rows.join('<br>');
                this.$tip.hidden = false;
                const left = x + 12 + 160 > W ? x - 172 : x + 12;
                this.$tip.style.left = `${left}px`;
                this.$tip.style.top = `${padT + 4}px`;
            }
        }
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
        this.handler = xf.sub('analytics:update', () => this.render());

        const $w = this.$['wprime-input'];
        $w.value = (session.wprime / 1000).toFixed(1);
        $w.addEventListener('change', () => {
            const kj = parseFloat($w.value);
            if(!(kj >= 5 && kj <= 60)) {
                $w.value = (session.wprime / 1000).toFixed(1);
                return;
            }
            setWprime(Math.round(kj * 1000));
            xf.dispatch('dashboard:wprime', session.wprime);
        });

        this.render();
    }

    disconnectedCallback() {
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

        const cues = session.cues({target: currentTarget()});
        const html = cues.length ?
            cues.map(c => `<li class="ts--cue" data-level="${c.level}">${c.text}</li>`).join('') :
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

export { session, setWprime };
