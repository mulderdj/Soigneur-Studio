//
// <ride-chart>: one ride on uPlot — power (coloured by zone), target, heart
// rate, cadence, W′bal, speed and elevation. When a ride has both power and
// telemetry (HR / W′bal / cadence / speed / elevation), defaults to two
// synchronized stacked panes (Power + Target on top; HR + overlays below)
// sharing one X-axis cursor, zoom, and top-anchored tooltip, with a Split /
// Overlay toggle. Overview plots use a dynamic rolling mean on power that
// automatically sharpens to raw 1-second detail when zoomed in.
//
//   el.data = {samples, analysis, ftp}
//

import uPlot from 'uplot';
import { DEFAULT_PERCENTAGES } from '../../analytics.js';
import { esc, fmtDuration } from '../training/format.js';
import { ChartTooltip } from '../charts/tooltip.js';

let syncSeq = 0;

const token = (el, name, fallback = '#888') => getComputedStyle(el).getPropertyValue(name).trim() || fallback;
const clock = s => (Number.isFinite(s) ? fmtDuration(Math.round(s)) : '');
// the read-out: 4:05 or 1:02:30
const exact = s => {
    if(!Number.isFinite(s)) return '';
    const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const num = x => Number.isFinite(x);

// Dynamic display smoothing window (seconds) based on visible X-axis span:
// smooth overview when zoomed out, full 1 s raw detail when zoomed in.
function smoothWindow(spanSec) {
    if(!Number.isFinite(spanSec) || spanSec <= 90) return 1;
    if(spanSec <= 300) return 3;
    if(spanSec <= 900) return 5;
    if(spanSec <= 2400) return 10;
    return 15;
}

// Centred/trailing rolling mean preserving null gaps (pauses).
function smoothSeries(values, win) {
    if(win <= 1 || values.length <= win) return values;
    const out = new Array(values.length);
    let sum = 0, count = 0;
    for(let i = 0; i < values.length; i++) {
        const v = values[i];
        if(num(v)) { sum += v; count++; }
        if(i >= win) {
            const old = values[i - win];
            if(num(old)) { sum -= old; count--; }
        }
        out[i] = num(v) && count > 0 ? sum / count : null;
    }
    return out;
}

class RideChart extends HTMLElement {
    static uPlot = uPlot;

    connectedCallback() {
        if(!this.$plot) {
            this.split = true;
            this.innerHTML = `<div class="rc-head"><div class="rc-chips" role="group" aria-label="Series"></div>
                <button type="button" class="btn btn--secondary rc-reset" hidden>Reset zoom</button>
                <button type="button" class="btn btn--icon rc-split" aria-label="Combine charts" title="Combine charts" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/></svg></button>
                <button type="button" class="btn btn--icon rc-full" aria-label="Full screen" title="Full screen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div>
                <div class="rc-plot"></div><div class="rc-tip" hidden></div>`;
            this.$chips = this.querySelector('.rc-chips');
            this.$reset = this.querySelector('.rc-reset');
            this.$reset.addEventListener('click', () => this.resetZoom());
            this.$split = this.querySelector('.rc-split');
            this.$split.addEventListener('click', () => { this.split = !this.split; this.build(); });
            this.$full = this.querySelector('.rc-full');
            this.$full.addEventListener('click', () => this.full ? this.exitFull() : this.enterFull());
            this.$plot = this.querySelector('.rc-plot');
            this.$tip = this.querySelector('.rc-tip');
            this.tooltip = new ChartTooltip(this.$tip, {owner: this});
            this.$chips.addEventListener('click', e => this.toggle(e));
        }
        // page-wide listeners live as long as the chart is on the page
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        document.addEventListener('fullscreenchange', () => { if(this.full && document.fullscreenElement !== this) this.exitFull(); }, signal);
        document.addEventListener('keydown', e => { if(e.key === 'Escape' && this.full) this.exitFull(); }, signal);
        // turning the phone changes the height too, which the ResizeObserver (width) can miss
        window.addEventListener('resize', () => { if(this.full) this.resizePlots(); }, signal);
        this.resize = new ResizeObserver(() => this.resizePlots());
        this.resize.observe(this.$plot);
        this.theme = new MutationObserver(() => this.build());
        this.theme.observe(document.body, {attributes: true, attributeFilter: ['class', 'data-palette']});
        this.build();
    }

    disconnectedCallback() {
        this.tooltip?.hide();
        this.exitFull({fromBack: true}); // don't trigger unexpected history.back() when unmounting
        this.abort?.abort();
        this.resize?.disconnect();
        this.theme?.disconnect();
        this.destroyPlots();
    }

    destroyPlots() {
        for(const p of this.plots ?? []) p.plot?.destroy();
        this.plots = [];
        this.plot = null;
    }

    set data(d) { this._data = d; this.build(); }
    get data() { return this._data; }

    size() {
        const w = this.$plot?.clientWidth || 800;
        if(this.full) {
            const head = this.querySelector('.rc-head')?.offsetHeight ?? 0;
            return {width: w, height: Math.max(160, (window.innerHeight || 400) - head - 24)};
        }
        const narrow = w < 600;
        return {width: w, height: Math.max(narrow ? 230 : 240, Math.min(480, Math.round(w * (narrow ? 0.62 : 0.42))))};
    }

    paneSizes(count) {
        const sz = this.size();
        if(count <= 1) return [sz];
        const total = this.full ? sz.height : Math.max(sz.width < 600 ? 280 : 320, Math.min(540, Math.round(sz.height * 1.28)));
        const top = Math.round(total * 0.54);
        return [{width: sz.width, height: top}, {width: sz.width, height: Math.max(110, total - top)}];
    }

    resizePlots() {
        if(!this.plots?.length) return;
        const sizes = this.paneSizes(this.plots.length);
        this.plots.forEach((p, idx) => p.plot?.setSize(sizes[idx] ?? sizes[0]));
    }

    // --- full screen ---

    async enterFull() {
        this.tooltip?.hide();
        const run = this.fullRun = Symbol();          // a Close while this runs ends it
        const still = () => this.full && this.fullRun === run;
        this.full = true;
        this.classList.add('is-full');
        this.setFullButton();
        try {
            if(this.requestFullscreen) await this.requestFullscreen({navigationUI: 'hide'});
        } catch(e) {}                                     // not allowed: the window-filling view stays
        if(!still()) { if(document.fullscreenElement === this) document.exitFullscreen?.().catch(() => {}); return; }
        try { await screen.orientation?.lock?.('landscape'); } catch(e) {}   // phones only, in full screen
        if(!still()) { try { screen.orientation?.unlock?.(); } catch(e) {} return; }
        // a Back on Android closes the view instead of leaving the page
        if(!document.fullscreenElement) { history.pushState({rcFull: true}, ''); this.popped = () => this.exitFull({fromBack: true}); window.addEventListener('popstate', this.popped, {once: true}); }
        this.resizePlots();
    }

    exitFull({fromBack = false} = {}) {
        if(!this.full) return;
        this.tooltip?.hide();
        this.full = false;
        this.fullRun = null;
        this.classList.remove('is-full');
        this.setFullButton();
        try { screen.orientation?.unlock?.(); } catch(e) {}
        if(document.fullscreenElement === this) document.exitFullscreen?.().catch(() => {});
        if(this.popped && !fromBack) { window.removeEventListener('popstate', this.popped); this.popped = null; history.back(); }
        this.popped = null;
        this.resizePlots();
    }

    setFullButton() {
        this.$full.setAttribute('aria-label', this.full ? 'Close full screen' : 'Full screen');
        this.$full.title = this.full ? 'Close' : 'Full screen';
        this.$full.innerHTML = this.full ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    }

    setSplitButton(canSplit) {
        if(!this.$split) return;
        this.$split.hidden = !canSplit;
        this.$split.setAttribute('aria-pressed', String(this.split));
        const label = this.split ? 'Combine into one chart' : 'Split Power and HR charts';
        this.$split.setAttribute('aria-label', label);
        this.$split.title = label;
    }

    // the series this ride has, with their default visibility and pane group
    series(narrow = false) {
        const {samples, analysis} = this._data;
        const has = k => samples.some(s => num(s[k]) && s[k] > 0);
        const power = analysis.hasPower, hr = has('heartRate');
        const list = [];
        if(power) list.push({key: 'power', pane: 'power', label: 'Power', scale: 'w', unit: 'W', raw: samples.map(s => s.power), smooth: true, show: true, width: narrow ? 1.75 : 1.5});
        if(analysis.target?.some(num)) list.push({key: 'target', pane: 'power', label: 'Target', scale: 'w', unit: 'W', raw: analysis.target, show: true, dash: [5, 4], width: 1.25});
        if(hr) list.push({key: 'hr', pane: 'other', label: 'Heart rate', scale: 'bpm', unit: 'bpm', raw: samples.map(s => s.heartRate), show: true, width: 1.5});
        if(has('cadence')) list.push({key: 'cadence', pane: 'other', label: 'Cadence', scale: 'rpm', unit: 'rpm', raw: samples.map(s => s.cadence), smooth: true, show: false, width: 1});
        if(analysis.wbal) list.push({key: 'wbal', pane: 'other', label: 'W′bal', scale: 'kj', unit: 'kJ', raw: analysis.wbal.series.map(w => (num(w) ? w / 1000 : null)), show: !narrow || !hr, width: 1.5, digits: 1});
        if(has('speed')) list.push({key: 'speed', pane: 'other', label: 'Speed', scale: 'kmh', unit: 'km/h', raw: samples.map(s => (num(s.speed) ? s.speed * 3.6 : null)), show: !power, width: 1, digits: 1});
        if(samples.some(s => num(s.altitude))) list.push({key: 'alt', pane: 'other', label: 'Elevation', scale: 'm', unit: 'm', raw: samples.map(s => s.altitude), show: !power, width: 1, fill: true});
        return list;
    }

    colors() {
        return {
            power: token(this, '--accent'), target: token(this, '--muted'), hr: token(this, '--hr', '#e5484d'),
            cadence: token(this, '--cadence', '#b38cff'), wbal: token(this, '--wbal', '#39d0e8'),
            speed: token(this, '--zone-2', '#4c9aff'), alt: token(this, '--muted', '#8c98a8'),
            zones: [1, 2, 3, 4, 5, 6, 7].map(i => token(this, `--zone-${i}`)),
            shade: token(this, '--band', 'rgba(76,154,255,0.10)'), muted: token(this, '--muted'), line: token(this, '--line'),
        };
    }

    valuesFor(series, win) {
        if(!series.smooth || win <= 1) return series.raw;
        // cadence gets a lighter window than power so pedalling pauses stay crisp
        const w = series.key === 'power' ? win : Math.min(win, 5);
        return smoothSeries(series.raw, w);
    }

    applySmoothing(spanSec) {
        const win = smoothWindow(spanSec);
        if(win === this._smoothWin || !this.plots?.length) return;
        this._smoothWin = win;
        const t = this._times;
        for(const p of this.plots) {
            if(!p.series.some(s => s.smooth)) continue;
            const data = [t, ...p.series.map(s => this.valuesFor(s, win))];
            p.plot?.setData?.(data, false);
        }
    }

    build() {
        if(!this._data || !this.isConnected || !this.$plot) return;
        const {samples, analysis, ftp} = this._data;
        const sz = this.size();
        const narrow = sz.width < 600;
        const prevShow = this.list ? new Map(this.list.map(s => [s.key, s.show])) : null;
        const list = this.series(narrow);
        if(prevShow) {
            for(const s of list) {
                if(prevShow.has(s.key)) s.show = prevShow.get(s.key);
            }
        }
        this.list = list;
        const c = this._colors = this.colors();
        const powerSeries = list.filter(s => s.pane === 'power');
        const otherSeries = list.filter(s => s.pane === 'other');
        const canSplit = powerSeries.length > 0 && otherSeries.length > 0;
        const isSplit = canSplit && this.split !== false;
        this.setSplitButton(canSplit);

        this.$chips.innerHTML = list.map((s, i) => `
            <button type="button" class="rc-chip" data-i="${i}" aria-pressed="${s.show}">
                <span class="rc-swatch" style="background:${esc(c[s.key])}"></span>${esc(s.label)}</button>`).join('');
        this.destroyPlots();
        this.$plot.innerHTML = '';
        if(this.$reset) this.$reset.hidden = true;
        if(!samples.length || !list.length) return;

        const U = RideChart.uPlot;
        const touchDevice = this._touchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
        const font = `${narrow ? 10 : 11}px ${token(this, '--font-text', 'system-ui')}`;
        const axis = {stroke: c.muted, font, gap: narrow ? 2 : 4, grid: {stroke: c.line, width: 1}, ticks: {show: false}};
        const zoneStroke = (u) => {
            const ctx = u.ctx, y = w => u.valToPos(w, 'w', true);
            if(!ctx?.createLinearGradient || !(ftp > 0)) return c.power;
            const top = ftp * 1.6;
            const y0 = y(0), y1 = y(top);
            if(!Number.isFinite(y0) || !Number.isFinite(y1) || y0 === y1) return c.power;
            const g = ctx.createLinearGradient(0, y0, 0, y1);
            const stops = [0, ...DEFAULT_PERCENTAGES.map(p => p * ftp / top), 1];
            for(let i = 0; i < c.zones.length; i++) {
                g.addColorStop(Math.min(1, stops[i]), c.zones[i]);
                g.addColorStop(Math.min(1, stops[i + 1]), c.zones[i]);
            }
            return g;
        };

        const times = this._times = samples.map(s => s.t);
        const fullMin = times[0], fullMax = times[times.length - 1];
        this._fullX = [fullMin, fullMax];
        this._smoothWin = smoothWindow(fullMax - fullMin);
        const syncKey = `rc-${++syncSeq}`;

        const paneSpecs = isSplit
            ? [{id: 'power', series: powerSeries, showX: false}, {id: 'other', series: otherSeries, showX: true}]
            : [{id: 'all', series: list, showX: true}];
        const sizes = this.paneSizes(paneSpecs.length);
        this.plots = [];

        const unitFor = (scale) => ({w: 'W', bpm: 'bpm', kj: 'kJ', rpm: 'rpm', kmh: 'km/h', m: 'm'}[scale] ?? '');

        // Pre-compute left/right scales per pane so both stacked panes share
        // identical left and right gutters and align to the exact pixel on X.
        const paneConfigs = paneSpecs.map(spec => {
            const left = spec.series.find(s => s.scale === 'w')
                ?? spec.series.find(s => s.scale === 'bpm')
                ?? spec.series[0];
            const right = !isSplit
                ? spec.series.find(s => s.scale === 'bpm' && left.scale !== 'bpm')
                : spec.series.find(s => s.scale === 'kj' && left.scale !== 'kj' && s.show);
            return {spec, left, right};
        });
        const leftSize = narrow ? 24 : 30;
        const anyRight = paneConfigs.some(cfg => !!cfg.right);
        const rightSize = anyRight ? (narrow ? 24 : 30) : 2;

        paneConfigs.forEach(({spec, left, right}, paneIdx) => {
            const wrap = document.createElement('div');
            wrap.className = 'rc-pane';
            wrap.dataset.pane = spec.id;
            const leftUnit = unitFor(left.scale);
            const rightUnit = right ? unitFor(right.scale) : '';
            const lbl = document.createElement('div');
            lbl.className = 'rc-ax-labels';
            lbl.innerHTML = `<span class="rc-ax-l">${esc(left.label)}${leftUnit ? ` (${esc(leftUnit)})` : ''}</span>`
                + (right ? `<span class="rc-ax-r">${esc(right.label)}${rightUnit ? ` (${esc(rightUnit)})` : ''}</span>` : '');
            wrap.append(lbl);
            this.$plot.append(wrap);

            const scales = {x: {time: false}};
            for(const s of spec.series) scales[s.scale] = {auto: true};
            if(scales.w) scales.w = {auto: true, range: (u, min, max) => [0, Math.max(max, ftp * 1.2)]};

            const opts = {
                ...sizes[paneIdx],
                padding: [8, right ? 2 : (anyRight ? rightSize + 2 : 4), spec.showX ? 0 : 6, 0],
                legend: {show: false},
                scales,
                series: [{}, ...spec.series.map(s => ({
                    label: s.label, scale: s.scale, show: s.show, width: s.width, dash: s.dash, spanGaps: false,
                    stroke: s.key === 'power' ? zoneStroke : c[s.key],
                    fill: s.fill ? `${c[s.key]}33` : undefined,
                    points: {show: false},
                }))],
                axes: [
                    spec.showX
                        ? {...axis, size: 18, labelSize: 0, labelGap: 0, values: (u, ts) => ts.map(clock)}
                        : {...axis, show: false, size: 0, labelSize: 0, labelGap: 0, grid: {show: true, stroke: c.line, width: 1}},
                    {...axis, scale: left.scale, size: leftSize, label: null, labelSize: 0, labelGap: 0, values: (u, ts) => ts.map(t => `${Math.round(t)}`)},
                    ...(right ? [{...axis, scale: right.scale, side: 1, size: rightSize, label: null, labelSize: 0, labelGap: 0, grid: {show: false}, values: (u, ts) => ts.map(t => `${Math.round(t)}`)}] : []),
                ],
                cursor: {
                    drag: {x: !touchDevice, y: false},
                    y: false,
                    points: {size: 6},
                    ...(paneSpecs.length > 1 ? {sync: {key: syncKey, setSeries: false}} : {}),
                },
                hooks: {
                    drawClear: [u => this.shade(u, analysis.intervals, c)],
                    setCursor: [u => this.tip(u)],
                    setScale: [(u, key) => {
                        if(key !== 'x' || !this._fullX) return;
                        const sx = u.scales.x;
                        if(!sx || !num(sx.min) || !num(sx.max)) return;
                        if(!this._syncingX) {
                            this._syncingX = true;
                            try {
                                for(const other of this.plots) {
                                    if(other.plot && other.plot !== u) other.plot.setScale('x', {min: sx.min, max: sx.max});
                                }
                                this.applySmoothing(sx.max - sx.min);
                            } finally {
                                this._syncingX = false;
                            }
                        }
                        if(this.$reset) {
                            this.$reset.hidden = !(sx.min > this._fullX[0] + 1 || sx.max < this._fullX[1] - 1);
                        }
                    }],
                },
            };
            const data = [times, ...spec.series.map(s => this.valuesFor(s, this._smoothWin))];
            const plot = new U(opts, data, wrap);
            this.plots.push({id: spec.id, wrap, plot, series: spec.series});
            this.bindTouch(plot, touchDevice);
        });
        this.plot = this.plots[0]?.plot ?? null;
        this.updatePaneVisibility();
    }

    bindTouch(plot, touchDevice) {
        if(!plot?.over) return;
        plot.over.addEventListener('mouseleave', () => {
            if(!touchDevice) {
                this.tooltip?.hide();
                this.dispatchEvent(new CustomEvent('ride-chart:cursor', {detail: {index: null}, bubbles: true}));
            }
        });
        const scrub = (e) => {
            const t = e.touches?.[0];
            if(!t) return;
            const r = plot.over.getBoundingClientRect();
            plot.setCursor?.({left: t.clientX - r.left, top: t.clientY - r.top});
        };
        let start = null;
        plot.over.addEventListener('touchstart', e => {
            const t = e.touches?.[0];
            start = t ? {x: t.clientX, y: t.clientY} : null;
            scrub(e);
        }, {passive: true});
        plot.over.addEventListener('touchmove', e => {
            const t = e.touches?.[0];
            if(!t || !start || Math.abs(t.clientY - start.y) > Math.abs(t.clientX - start.x)) return;
            scrub(e);
            e.preventDefault();
        }, {passive: false});
        plot.over.style.touchAction = 'pan-y';
    }

    updatePaneVisibility() {
        for(const p of this.plots ?? []) {
            const anyShown = p.series.some(s => s.show);
            p.wrap.hidden = !anyShown;
        }
    }

    resetZoom() {
        if(!this.plots?.length || !this._fullX) return;
        const [min, max] = this._fullX;
        this._syncingX = true;
        try {
            for(const p of this.plots) p.plot?.setScale('x', {min, max});
            this.applySmoothing(max - min);
        } finally {
            this._syncingX = false;
        }
        if(this.$reset) this.$reset.hidden = true;
    }

    // the work intervals shaded
    shade(u, intervals = [], c) {
        const ctx = u.ctx;
        if(!ctx || !u.bbox) return;
        ctx.save();
        ctx.fillStyle = c.shade;
        for(const iv of intervals) {
            if(iv.kind === 'rest' || iv.start === null) continue;
            const x0 = u.valToPos(iv.start, 'x', true), x1 = u.valToPos(iv.end, 'x', true);
            ctx.fillRect(x0, u.bbox.top, Math.max(1, x1 - x0), u.bbox.height);
        }
        ctx.restore();
    }

    tip(u) {
        const i = u.cursor?.idx;
        if(i == null || !(u.cursor.left >= 0)) {
            this.tooltip?.hide();
            this.dispatchEvent(new CustomEvent('ride-chart:cursor', {detail: {index: null}, bubbles: true}));
            return;
        }
        this.dispatchEvent(new CustomEvent('ride-chart:cursor', {detail: {index: i}, bubbles: true}));
        const c = this._colors ?? this.colors();
        const rows = this.list
            .filter(s => s.show && num(s.raw[i]))
            .map(s => {
                const v = s.raw[i];
                return `<div><dt><i style="background:${esc(c[s.key])}"></i>${esc(s.label)}</dt><dd>${(s.digits ? v.toFixed(s.digits) : Math.round(v))} <small>${esc(s.unit)}</small></dd></div>`;
            });
        const win = this._smoothWin > 1 ? ` <small class="rc-tip__avg">${this._smoothWin}s avg</small>` : '';
        const html = `<div class="rc-tip__title">${exact(this._times[i])}${win}</div>${rows.length ? `<dl>${rows.join('')}</dl>` : '<p>No data here (paused)</p>'}`;
        const over = u.over?.getBoundingClientRect() ?? this.$plot.getBoundingClientRect();
        // Anchor above the top visible pane so the tooltip never covers either track
        const topPane = this.plots?.find(p => !p.wrap.hidden)?.plot?.over?.getBoundingClientRect() ?? over;
        this.tooltip?.show({html, x: over.left + u.cursor.left, plotTop: topPane.top, touch: !!this._touchDevice});
    }

    toggle(e) {
        const b = e.target.closest('[data-i]');
        if(!b || !this.plots?.length) return;
        const i = Number(b.dataset.i);
        const s = this.list[i];
        if(!s) return;
        const show = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(show));
        s.show = show;
        // Toggling W′bal changes whether the right-hand kJ axis is needed, so rebuild cleanly
        if(s.key === 'wbal' && this.plots.length > 1) {
            this.build();
            return;
        }
        for(const p of this.plots) {
            const idx = p.series.indexOf(s);
            if(idx >= 0) p.plot?.setSeries(idx + 1, {show});
        }
        this.updatePaneVisibility();
    }

    zoomTo(start, end) {
        if(!this.plots?.length || !num(start) || !num(end)) return;
        const pad = Math.max(10, Math.round((end - start) * 0.1));
        const min = Math.max(0, start - pad);
        const max = end + pad;
        this._syncingX = true;
        try {
            for(const p of this.plots) p.plot?.setScale('x', {min, max});
            this.applySmoothing(max - min);
        } finally {
            this._syncingX = false;
        }
        if(this.$reset && this._fullX) {
            this.$reset.hidden = !(min > this._fullX[0] + 1 || max < this._fullX[1] - 1);
        }
        const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.scrollIntoView?.({behavior: reduce ? 'instant' : 'smooth', block: 'nearest'});
    }
}

customElements.define('ride-chart', RideChart);

export { RideChart, smoothWindow, smoothSeries };
