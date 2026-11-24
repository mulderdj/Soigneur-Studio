//
// <ride-chart>: one ride on uPlot — power (coloured by zone), target, heart
// rate, cadence, W′bal, speed and elevation, each on its own scale; the
// intervals shaded; a read-out per second; drag to zoom, double-click back;
// a chip per series to show or hide it. zoomTo(start, end) zooms to an
// interval (seconds from the start). The full-screen button opens the chart
// over the whole screen, in landscape on a phone (where the browser allows
// it; otherwise it fills the window); Close or Back returns.
//
//   el.data = {samples, analysis, ftp}
//

import uPlot from 'uplot';
import { DEFAULT_PERCENTAGES } from '../../analytics.js';
import { esc, fmtDuration } from '../training/format.js';

const token = (el, name, fallback = '#888') => getComputedStyle(el).getPropertyValue(name).trim() || fallback;
const clock = s => (Number.isFinite(s) ? fmtDuration(Math.round(s)) : '');
// the read-out: 4:05 or 1:02:30
const exact = s => {
    if(!Number.isFinite(s)) return '';
    const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const num = x => Number.isFinite(x);

function tipLeft(x, w, width) {
    const left = x + 14 + w > width - 8 ? x - 14 - w : x + 14;
    return Math.max(8, Math.min(left, width - w - 8));
}

class RideChart extends HTMLElement {
    static uPlot = uPlot;

    connectedCallback() {
        if(!this.$plot) {
            this.innerHTML = `<div class="rc-head"><div class="rc-chips" role="group" aria-label="Series"></div>
                <button type="button" class="btn btn--icon rc-full" aria-label="Full screen" title="Full screen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div>
                <div class="rc-plot"></div><div class="rc-tip" hidden></div>`;
            this.$chips = this.querySelector('.rc-chips');
            this.$full = this.querySelector('.rc-full');
            this.$full.addEventListener('click', () => this.full ? this.exitFull() : this.enterFull());
            document.addEventListener('fullscreenchange', () => { if(this.full && document.fullscreenElement !== this) this.exitFull(); });
            document.addEventListener('keydown', e => { if(e.key === 'Escape' && this.full) this.exitFull(); });
            // turning the phone changes the height too, which the ResizeObserver (width) can miss
            window.addEventListener('resize', () => { if(this.full) this.plot?.setSize(this.size()); });
            this.$plot = this.querySelector('.rc-plot');
            this.$tip = this.querySelector('.rc-tip');
            this.$chips.addEventListener('click', e => this.toggle(e));
        }
        this.resize = new ResizeObserver(() => this.plot?.setSize(this.size()));
        this.resize.observe(this.$plot);
        this.theme = new MutationObserver(() => this.build());
        this.theme.observe(document.body, {attributes: true, attributeFilter: ['class']});
        this.build();
    }

    disconnectedCallback() {
        this.resize?.disconnect();
        this.theme?.disconnect();
        this.plot?.destroy();
        this.plot = null;
    }

    set data(d) { this._data = d; this.build(); }
    get data() { return this._data; }

    size() {
        const w = this.$plot?.clientWidth || 800;
        if(this.full) {
            // the whole screen, less the chips row
            const head = this.querySelector('.rc-head')?.offsetHeight ?? 0;
            return {width: w, height: Math.max(160, (window.innerHeight || 400) - head - 24)};
        }
        return {width: w, height: Math.max(220, Math.min(480, Math.round(w * 0.42)))};
    }

    // --- full screen ---

    async enterFull() {
        this.full = true;
        this.classList.add('is-full');
        this.setFullButton();
        try {
            if(this.requestFullscreen) await this.requestFullscreen({navigationUI: 'hide'});
        } catch(e) {}                                     // not allowed: the window-filling view stays
        try { await screen.orientation?.lock?.('landscape'); } catch(e) {}   // phones only, in full screen
        // a Back on Android closes the view instead of leaving the page
        if(!document.fullscreenElement) { history.pushState({rcFull: true}, ''); this.popped = () => this.exitFull({fromBack: true}); window.addEventListener('popstate', this.popped, {once: true}); }
        this.plot?.setSize(this.size());
    }

    exitFull({fromBack = false} = {}) {
        if(!this.full) return;
        this.full = false;
        this.classList.remove('is-full');
        this.setFullButton();
        try { screen.orientation?.unlock?.(); } catch(e) {}
        if(document.fullscreenElement === this) document.exitFullscreen?.().catch(() => {});
        if(this.popped && !fromBack) { window.removeEventListener('popstate', this.popped); this.popped = null; history.back(); }
        this.popped = null;
        this.plot?.setSize(this.size());
    }

    setFullButton() {
        this.$full.setAttribute('aria-label', this.full ? 'Close full screen' : 'Full screen');
        this.$full.title = this.full ? 'Close' : 'Full screen';
        this.$full.innerHTML = this.full ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    }

    // the series this ride has, with their default visibility
    series() {
        const {samples, analysis} = this._data;
        const has = k => samples.some(s => num(s[k]) && s[k] > 0);
        const power = analysis.hasPower, hr = has('heartRate');
        const list = [];
        if(power) list.push({key: 'power', label: 'Power', scale: 'w', unit: 'W', values: samples.map(s => s.power), show: true, width: 1.5});
        if(analysis.target?.some(num)) list.push({key: 'target', label: 'Target', scale: 'w', unit: 'W', values: analysis.target, show: true, dash: [5, 4], width: 1.5});
        if(hr) list.push({key: 'hr', label: 'Heart rate', scale: 'bpm', unit: 'bpm', values: samples.map(s => s.heartRate), show: true, width: 1.5});
        if(has('cadence')) list.push({key: 'cadence', label: 'Cadence', scale: 'rpm', unit: 'rpm', values: samples.map(s => s.cadence), show: false, width: 1});
        if(analysis.wbal) list.push({key: 'wbal', label: 'W′bal', scale: 'kj', unit: 'kJ', values: analysis.wbal.series.map(w => (num(w) ? w / 1000 : null)), show: true, width: 1.5, digits: 1});
        if(has('speed')) list.push({key: 'speed', label: 'Speed', scale: 'kmh', unit: 'km/h', values: samples.map(s => (num(s.speed) ? s.speed * 3.6 : null)), show: !power, width: 1, digits: 1});
        if(samples.some(s => num(s.altitude))) list.push({key: 'alt', label: 'Elevation', scale: 'm', unit: 'm', values: samples.map(s => s.altitude), show: !power, width: 1, fill: true});
        return list;
    }

    colors() {
        return {
            power: token(this, '--accent'), target: token(this, '--muted'), hr: token(this, '--hr', '#e5484d'),
            cadence: token(this, '--zone-3', '#2bb3a3'), wbal: token(this, '--zone-6', '#f5a623'),
            speed: token(this, '--zone-2', '#4c9aff'), alt: token(this, '--muted', '#8c98a8'),
            zones: [1, 2, 3, 4, 5, 6, 7].map(i => token(this, `--zone-${i}`)),
            shade: token(this, '--band', 'rgba(76,154,255,0.12)'), muted: token(this, '--muted'), line: token(this, '--line'),
        };
    }

    build() {
        if(!this._data || !this.isConnected || !this.$plot) return;
        const {samples, analysis, ftp} = this._data;
        const list = this.series();
        this.list = list;
        const c = this.colors();
        this.$chips.innerHTML = list.map((s, i) => `
            <button type="button" class="rc-chip" data-i="${i}" aria-pressed="${s.show}">
                <span class="rc-swatch" style="background:${esc(c[s.key])}"></span>${esc(s.label)}</button>`).join('');
        this.plot?.destroy();
        this.plot = null;
        this.$plot.innerHTML = '';
        if(!samples.length || !list.length) return;

        const U = RideChart.uPlot;
        const font = `11px ${token(this, '--font-text', 'system-ui')}`;
        const axis = {stroke: c.muted, font, grid: {stroke: c.line, width: 1}, ticks: {show: false}};
        // power stroked by zone: a hard-stop gradient over the W scale
        const zoneStroke = (u) => {
            const ctx = u.ctx, y = w => u.valToPos(w, 'w', true);
            if(!ctx?.createLinearGradient || !(ftp > 0)) return c.power;
            const top = ftp * 1.6;
            const g = ctx.createLinearGradient(0, y(0), 0, y(top));
            const stops = [0, ...DEFAULT_PERCENTAGES.map(p => p * ftp / top), 1];
            for(let i = 0; i < c.zones.length; i++) {
                g.addColorStop(Math.min(1, stops[i]), c.zones[i]);
                g.addColorStop(Math.min(1, stops[i + 1]), c.zones[i]);
            }
            return g;
        };
        const scales = {x: {time: false}};
        for(const s of list) scales[s.scale] = {auto: true};
        if(scales.w) scales.w = {auto: true, range: (u, min, max) => [0, Math.max(max, ftp * 1.2)]};
        const left = list.find(s => s.scale === 'w') ?? list[0];
        const right = list.find(s => s.scale === 'bpm' && left.scale !== 'bpm');
        const opts = {
            ...this.size(),
            legend: {show: false},
            scales,
            series: [{}, ...list.map(s => ({
                label: s.label, scale: s.scale, show: s.show, width: s.width, dash: s.dash, spanGaps: false,
                stroke: s.key === 'power' ? zoneStroke : c[s.key],
                fill: s.fill ? `${c[s.key]}33` : undefined,
                points: {show: false},
            }))],
            axes: [
                {...axis, values: (u, ts) => ts.map(clock)},
                {...axis, scale: left.scale, size: 44, label: '', values: (u, ts) => ts.map(t => `${Math.round(t)}`)},
                ...(right ? [{...axis, scale: 'bpm', side: 1, size: 40, grid: {show: false}, values: (u, ts) => ts.map(t => `${Math.round(t)}`)}] : []),
            ],
            cursor: {drag: {x: true, y: false}, y: false, points: {size: 6}},
            hooks: {
                drawClear: [u => this.shade(u, analysis.intervals, c)],
                setCursor: [u => this.tip(u)],
            },
        };
        const data = [samples.map(s => s.t), ...list.map(s => s.values)];
        this.plot = new U(opts, data, this.$plot);
        this.plot.over?.addEventListener('mouseleave', () => { this.$tip.hidden = true; });
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
        if(i == null || !(u.cursor.left >= 0)) { this.$tip.hidden = true; return; }
        const c = this.colors();
        const rows = this.list.map((s, k) => ({s, v: u.data[k + 1][i]}))
            .filter(({s, v}) => u.series[this.list.indexOf(s) + 1]?.show !== false && num(v))
            .map(({s, v}) => `<div><dt><i style="background:${esc(c[s.key])}"></i>${esc(s.label)}</dt><dd>${(s.digits ? v.toFixed(s.digits) : Math.round(v))} <small>${esc(s.unit)}</small></dd></div>`);
        this.$tip.innerHTML = `<div class="rc-tip__title">${exact(u.data[0][i])}</div>${rows.length ? `<dl>${rows.join('')}</dl>` : '<p>No data here (paused)</p>'}`;
        this.$tip.hidden = false;
        const plot = this.$plot.getBoundingClientRect(), box = this.getBoundingClientRect();
        const x = plot.left - box.left + (u.over?.offsetLeft ?? 0) + u.cursor.left;
        this.$tip.style.left = `${tipLeft(x, this.$tip.offsetWidth, box.width)}px`;
        this.$tip.style.top = `${plot.top - box.top + 8}px`;
    }

    toggle(e) {
        const b = e.target.closest('[data-i]');
        if(!b || !this.plot) return;
        const i = Number(b.dataset.i);
        const show = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(show));
        this.list[i].show = show;
        this.plot.setSeries(i + 1, {show});
    }

    zoomTo(start, end) {
        if(!this.plot || !num(start) || !num(end)) return;
        const pad = Math.max(10, Math.round((end - start) * 0.1));
        this.plot.setScale('x', {min: Math.max(0, start - pad), max: end + pad});
        this.scrollIntoView?.({behavior: 'smooth', block: 'nearest'});
    }
}

customElements.define('ride-chart', RideChart);

export { RideChart };
