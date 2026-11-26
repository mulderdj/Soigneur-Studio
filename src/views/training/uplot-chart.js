//
// <UPlotCard>: the base of the Training tab's charts, drawn with uPlot.
//
// A subclass gives two things:
//   head()  -> the card's header HTML (title, toggles)
//   intro() -> optional HTML between the header and the chart (headline numbers)
//   foot()  -> optional HTML under the chart (notes, buttons)
//   chart() -> {model, readout(i)}
//     model = {
//       x: number[]                     x values (unix seconds, or seconds for the power curve)
//       series: [{label, color, values, width?, dash?, kind?: 'line'|'bars'|'points', points?: true,
//                 fill?: colour, scale?: 'y2' (a second scale, drawn on the right)}]
//       y2Format?: v => label (the right-hand axis)
//       bands?: [[upperSeries, lowerSeries, fill]]   (1-based series index, as in uPlot)
//       time?: true (default), log?: false, xFormat?: v => label, yFormat?: v => label,
//       xTicks?: [x] (where the x axis's labels go),
//       ranges?: [[key, label]], defaultRange?: key, today?: unix seconds,
//       zoom?: false (drag to zoom on desktop), sync?: 'days', marks?: {zero?, today?},
//     }
//     readout(i) = {title, rows: [{label, color?, value, note?}], more: string[], day?: 'YYYY-MM-DD'}
//
// The base draws it with the design tokens, keeps it sized to its card,
// rebuilds on a theme change, shows the read-out next to the cursor (mouse,
// tap or a sliding finger), switches ranges, shares the cursor between
// charts with the same sync key, and opens a day's dialog on click (on
// touch, through the read-out's "Open day" button).
//

import uPlot from 'uplot';
import { esc, fmtDay } from './format.js';

const DAY = 86400;
const RANGE_DAYS = {'1m': 30, '3m': 90, '1y': 365};
const RANGE_ENTRIES = {'12w': 12, '52w': 52, '12m': 12};

function token(el, name, fallback = '#888') {
    return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

// [min, max] for a range key over sorted xs; null without data
function rangeWindow(xs, range, todaySec) {
    if(!xs || xs.length === 0) return null;
    const first = xs[0], last = xs[xs.length - 1];
    let lo = first;
    if(RANGE_DAYS[range]) lo = Math.max(first, todaySec - RANGE_DAYS[range] * DAY);
    else if(RANGE_ENTRIES[range]) lo = xs[Math.max(0, xs.length - RANGE_ENTRIES[range])];
    if(RANGE_DAYS[range] && todaySec - RANGE_DAYS[range] * DAY < first) lo = todaySec - RANGE_DAYS[range] * DAY;
    let hi = last;
    if(hi - lo < DAY) { lo -= DAY / 2; hi += DAY / 2; }
    return [lo, hi];
}

// the read-out's left edge: right of the cursor, flipped near the right
// edge, always inside the card
function tipLeft(cursorX, tipWidth, cardWidth) {
    const x = cursorX + 14 + tipWidth > cardWidth - 8 ? cursorX - 14 - tipWidth : cursorX + 14;
    return Math.max(8, Math.min(x, cardWidth - tipWidth - 8));
}

// bars are centred on their x: widen the window by half a step on each side
// so the first and last bars aren't cut in half
function padForBars([lo, hi], xs) {
    const steps = xs.slice(1).map((x, i) => x - xs[i]).filter(d => d > 0).sort((a, b) => a - b);
    const half = (steps[Math.floor(steps.length / 2)] ?? DAY) / 2;
    return [lo - half, hi + half];
}

const touchDevice = () => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
let activeTipCard = null;

class UPlotCard extends HTMLElement {
    static uPlot = uPlot;

    connectedCallback() {
        this.classList.add('uc-card');   // the read-out is placed within the card
        if(!this.$plot) {
            this.innerHTML = `<div class="uc-head"></div><div class="uc-intro"></div><div class="uc-plot"></div><div class="uc-foot"></div><div class="uc-tip" hidden></div>`;
            this.$head = this.querySelector('.uc-head');
            this.$intro = this.querySelector('.uc-intro');
            this.$foot = this.querySelector('.uc-foot');
            this.$plot = this.querySelector('.uc-plot');
            this.$tip = this.querySelector('.uc-tip');
            this.addEventListener('click', e => this.onClick(e));
        }
        this.resize = new ResizeObserver(() => this.plot?.setSize(this.size()));
        this.resize.observe(this.$plot);
        this.theme = new MutationObserver(() => this.rebuild());
        this.theme.observe(document.body, {attributes: true, attributeFilter: ['class']});
        this.rebuild();
    }

    disconnectedCallback() {
        clearTimeout(this.clickTimer);
        this.hideTip();
        this.resize?.disconnect();
        this.theme?.disconnect();
        this.plot?.destroy();
        this.plot = null;
    }

    hideTip() {
        if(this.$tip) this.$tip.hidden = true;
        this.classList.remove('has-tip');
        if(activeTipCard === this) activeTipCard = null;
    }

    set data(d) {
        this._data = d;
        this.rebuild();
    }

    get data() { return this._data; }

    size() {
        const w = this.$plot?.clientWidth || 600;
        return {width: w, height: this.plotHeight?.(w) ?? Math.max(170, Math.min(240, Math.round(w * 0.4)))};
    }

    onClick(e) {
        const r = e.target.closest('[data-range]');
        if(r) { this.range = r.dataset.range; this.rebuild(); return; }
        const open = e.target.closest('[data-open-day]');
        if(open) { this.openDay(open.dataset.openDay); return; }
        this.onHeadClick?.(e);
    }

    openDay(day) {
        if(day) this.dispatchEvent(new CustomEvent('day-open', {bubbles: true, detail: {day}}));
    }

    rangeButtons(model) {
        if(!model.ranges?.length) return '';
        return `<div class="segmented uc-ranges" role="group" aria-label="Period">${model.ranges.map(([k, label]) =>
            `<button type="button" class="segmented__opt" data-range="${k}" aria-pressed="${k === this.range}">${label}</button>`).join('')}</div>`;
    }

    rebuild() {
        if(!this._data || !this.isConnected || !this.$plot) return;
        clearTimeout(this.clickTimer);
        const {model, readout} = this.chart();
        this.readout = readout;
        this.model = model;
        this.range = this.range && model.ranges?.some(([k]) => k === this.range) ? this.range : model.defaultRange;
        this.$head.innerHTML = this.head() + this.rangeButtons(model);
        this.$intro.innerHTML = this.intro?.() ?? '';
        this.$foot.innerHTML = this.foot?.() ?? '';
        this.hideTip();
        this.plot?.destroy();
        this.plot = null;
        this.$plot.innerHTML = '';
        if(!model.x?.length) {
            this.$plot.innerHTML = `<p class="card__note uc-empty">${esc(this.emptyText?.() ?? 'Nothing to show yet.')}</p>`;
            return;
        }
        const U = UPlotCard.uPlot;
        const muted = token(this, '--muted'), line = token(this, '--line');
        const font = `11px ${token(this, '--font-text', 'system-ui')}`;
        const axis = {stroke: muted, font, grid: {stroke: line, width: 1}, ticks: {show: false}};
        const bars = U.paths?.bars ? U.paths.bars({size: [0.7, 48], align: 0}) : null;
        const time = model.time !== false;
        const y2 = model.series.some(s => s.scale === 'y2');
        const series = [{}, ...model.series.map(s => ({
            label: s.label,
            stroke: s.kind === 'bars' ? 'transparent' : (s.color),
            fill: s.kind === 'bars' ? s.color : s.fill,
            width: s.width ?? (s.kind === 'bars' ? 0 : 2),
            dash: s.dash,
            scale: s.scale === 'y2' ? 'y2' : 'y',
            // points: no line between them (a scatter)
            paths: s.kind === 'bars' ? bars : s.kind === 'points' ? () => null : undefined,
            points: {show: !!s.points || s.kind === 'points', size: s.kind === 'points' ? 7 : 6, fill: s.color, stroke: s.color},
            spanGaps: false,
        }))];
        // a window of days only for a time axis (reps, watts: their own range)
        const span = model.time === false ? null : rangeWindow(model.x, this.range ?? 'all', model.today ?? model.x[model.x.length - 1]);
        const window = span && model.series.some(s => s.kind === 'bars') ? padForBars(span, model.x) : span;
        const marks = model.marks ?? {};
        const opts = {
            ...this.size(),
            legend: {show: false},
            series,
            bands: (model.bands ?? []).map(([a, b, fill]) => ({series: [a, b], fill})),
            // days are UTC days throughout (daySec): put the ticks on them,
            // not on local midnights
            tzDate: ts => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
            scales: {
                x: {time, distr: model.log ? 3 : 1, ...(model.xRange ? {range: model.xRange} : {})},
                y: model.yRange ? {range: model.yRange} : {},
                ...(y2 ? {y2: model.y2Range ? {range: model.y2Range} : {}} : {}),
            },
            axes: [
                {...axis, ...(model.xTicks ? {splits: () => model.xTicks, filter: (u, splits) => splits} : {}), values: model.xFormat ? (u, ts) => ts.map(model.xFormat) :
                    (time ? (u, ts) => ts.map(t => fmtDay(new Date(t * 1000).toISOString().slice(0, 10), {day: 'numeric', month: 'short'})) : undefined)},
                {...axis, size: 40, values: model.yFormat ? (u, ts) => ts.map(model.yFormat) : undefined},
                ...(y2 ? [{...axis, scale: 'y2', side: 1, size: 40, grid: {show: false}, values: model.y2Format ? (u, ts) => ts.map(model.y2Format) : undefined}] : []),
            ],
            cursor: {
                drag: {x: model.zoom === true && !touchDevice(), y: false},
                y: false,
                points: {size: 7, fill: (u, i) => series[i].stroke === 'transparent' ? series[i].fill : series[i].stroke},
                ...(model.sync ? {sync: {key: model.sync}} : {}),
                // a double-click goes back to the chosen period, not to all data
                ...(window && !model.log ? {bind: {dblclick: u => e => {
                    if(e.button === 0) u.setScale('x', {min: window[0], max: window[1]});
                    return null;
                }}} : {}),
            },
            hooks: {
                drawClear: [u => this.drawMarks(u, marks, {muted, line})],
                setCursor: [u => this.showTip(u)],
            },
        };
        const data = [model.x, ...model.series.map(s => s.values)];
        this.plot = new U(opts, data, this.$plot);
        // open on the chosen period; a drag-zoom then sets its own scale
        if(window && !model.log) this.plot.setScale?.('x', {min: window[0], max: window[1]});
        if(this.plot.over) {
            this.plot.over.addEventListener('mouseleave', () => { if(!touchDevice()) this.hideTip(); });
            // a click opens the day; where a double-click zooms out, wait to
            // see that it isn't one (uPlot already swallows the click ending a drag)
            const zooms = opts.cursor.drag.x;
            this.plot.over.addEventListener('click', (e) => {
                if(touchDevice() || e.detail > 1) return;
                const i = this.plot.cursor?.idx;
                if(i == null) return;
                const day = this.readout(i)?.day;
                clearTimeout(this.clickTimer);
                if(zooms) this.clickTimer = setTimeout(() => this.openDay(day), 250);
                else this.openDay(day);
            });
            this.plot.over.addEventListener('dblclick', () => clearTimeout(this.clickTimer));
            const touch = (e) => {
                const t = e.touches?.[0];
                if(!t) return;
                const r = this.plot.over.getBoundingClientRect();
                this.touching = true;
                this.plot.setCursor({left: t.clientX - r.left, top: t.clientY - r.top});
                this.touching = false;
            };
            // a finger sliding sideways moves the read-out; a vertical swipe
            // is left to the page, so it scrolls
            let start = null;
            this.plot.over.addEventListener('touchstart', e => {
                const t = e.touches?.[0];
                start = t ? {x: t.clientX, y: t.clientY} : null;
                touch(e);
            }, {passive: true});
            this.plot.over.addEventListener('touchmove', e => {
                const t = e.touches?.[0];
                if(!t || !start || Math.abs(t.clientY - start.y) > Math.abs(t.clientX - start.x)) return;
                touch(e);
                e.preventDefault();
            }, {passive: false});
            this.plot.over.style.touchAction = 'pan-y';
        }
    }

    drawMarks(u, marks, {muted, line}) {
        const ctx = u.ctx;
        if(!ctx || !u.bbox) return;
        ctx.save();
        ctx.lineWidth = 1;
        if(marks.zero) {
            const y = u.valToPos(0, 'y', true);
            ctx.strokeStyle = muted;
            ctx.beginPath(); ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y); ctx.stroke();
        }
        if(marks.today != null) {
            const x = u.valToPos(marks.today, 'x', true);
            ctx.setLineDash([2, 3]);
            ctx.strokeStyle = line;
            ctx.beginPath(); ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height); ctx.stroke();
        }
        ctx.restore();
    }

    showTip(u) {
        const i = u.cursor?.idx;
        // a day from the shared cursor outside this chart's view: no read-out
        const outside = u.cursor?.left < 0 || u.cursor?.left > (u.over?.clientWidth ?? Infinity);
        // only the chart under the mouse or finger shows a read-out; a chart
        // following the shared cursor (no event of its own) shows just the line
        const own = this.touching || u.cursor?.event != null || !('event' in (u.cursor ?? {}));
        if(i == null || outside || !own) { this.hideTip(); return; }
        const r = this.readout(i);
        if(!r) { this.hideTip(); return; }
        if(activeTipCard && activeTipCard !== this) activeTipCard.hideTip();
        activeTipCard = this;
        this.classList.add('has-tip');
        const touchy = touchDevice();
        this.$tip.innerHTML = `
            <div class="uc-tip__title">${esc(r.title)}</div>
            ${r.rows?.length ? `<dl>${r.rows.map(row => `
                <div><dt>${row.color ? `<i style="background:${esc(row.color)}"></i>` : ''}${esc(row.label)}</dt>
                <dd>${esc(row.value)}${row.note ? ` <small>${esc(row.note)}</small>` : ''}</dd></div>`).join('')}</dl>` : ''}
            ${(r.more ?? []).map(m => `<div class="uc-tip__more">${esc(m)}</div>`).join('')}
            ${touchy && r.day ? `<button type="button" class="btn btn--secondary uc-tip__open" data-open-day="${esc(r.day)}">Open day ›</button>` : ''}`;
        this.$tip.classList.toggle('is-touch', touchy);
        this.$tip.style.left = '0px';
        this.$tip.style.top = '0px';
        this.$tip.hidden = false;
        const plot = this.$plot.getBoundingClientRect(), card = this.getBoundingClientRect();
        const x = plot.left - card.left + (u.over?.offsetLeft ?? 0) + u.cursor.left;
        this.$tip.style.left = `${tipLeft(x, this.$tip.offsetWidth, card.width)}px`;
        // below the header when it fits, else moved up: always inside the card
        const top = plot.top - card.top + 8;
        this.$tip.style.top = `${Math.max(8, Math.min(top, card.height - this.$tip.offsetHeight - 8))}px`;
    }
}

export { UPlotCard, rangeWindow, tipLeft, padForBars, token };
