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
//       series: [{label, color, values, width?, dash?, kind?: 'line'|'bars', points?: true,
//                 fill?: colour}]
//       bands?: [[upperSeries, lowerSeries, fill]]   (1-based series index, as in uPlot)
//       time?: true (default), log?: false, xFormat?: v => label, yFormat?: v => label,
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
        this.resize?.disconnect();
        this.theme?.disconnect();
        this.plot?.destroy();
        this.plot = null;
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
        const {model, readout} = this.chart();
        this.readout = readout;
        this.model = model;
        this.range = this.range && model.ranges?.some(([k]) => k === this.range) ? this.range : model.defaultRange;
        this.$head.innerHTML = this.head() + this.rangeButtons(model);
        this.$intro.innerHTML = this.intro?.() ?? '';
        this.$foot.innerHTML = this.foot?.() ?? '';
        this.$tip.hidden = true;
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
        const series = [{}, ...model.series.map(s => ({
            label: s.label,
            stroke: s.kind === 'bars' ? 'transparent' : (s.color),
            fill: s.kind === 'bars' ? s.color : s.fill,
            width: s.width ?? (s.kind === 'bars' ? 0 : 2),
            dash: s.dash,
            paths: s.kind === 'bars' ? bars : undefined,
            points: {show: !!s.points, size: 6, fill: s.color, stroke: s.color},
            spanGaps: false,
        }))];
        const span = rangeWindow(model.x, this.range ?? 'all', model.today ?? model.x[model.x.length - 1]);
        const window = span && model.series.some(s => s.kind === 'bars') ? padForBars(span, model.x) : span;
        const marks = model.marks ?? {};
        const opts = {
            ...this.size(),
            legend: {show: false},
            series,
            bands: (model.bands ?? []).map(([a, b, fill]) => ({series: [a, b], fill})),
            scales: {
                x: {time, distr: model.log ? 3 : 1, ...(window && !model.log ? {range: () => window} : {})},
                y: model.yRange ? {range: model.yRange} : {},
            },
            axes: [
                {...axis, values: model.xFormat ? (u, ts) => ts.map(model.xFormat) :
                    (time ? (u, ts) => ts.map(t => fmtDay(new Date(t * 1000).toISOString().slice(0, 10), {day: 'numeric', month: 'short'})) : undefined)},
                {...axis, size: 40, values: model.yFormat ? (u, ts) => ts.map(model.yFormat) : undefined},
            ],
            cursor: {
                drag: {x: model.zoom === true && !touchDevice(), y: false},
                y: false,
                points: {size: 7, fill: (u, i) => series[i].stroke === 'transparent' ? series[i].fill : series[i].stroke},
                ...(model.sync ? {sync: {key: model.sync}} : {}),
            },
            hooks: {
                drawClear: [u => this.drawMarks(u, marks, {muted, line})],
                setCursor: [u => this.showTip(u)],
            },
        };
        const data = [model.x, ...model.series.map(s => s.values)];
        this.plot = new U(opts, data, this.$plot);
        if(this.plot.over) {
            this.plot.over.addEventListener('mouseleave', () => { if(!touchDevice()) this.$tip.hidden = true; });
            this.plot.over.addEventListener('click', () => {
                if(touchDevice() || (this.plot.select?.width ?? 0) > 0) return;
                const i = this.plot.cursor?.idx;
                if(i != null) this.openDay(this.readout(i)?.day);
            });
            const touch = (e) => {
                const t = e.touches?.[0];
                if(!t) return;
                const r = this.plot.over.getBoundingClientRect();
                this.plot.setCursor({left: t.clientX - r.left, top: t.clientY - r.top});
            };
            this.plot.over.addEventListener('touchstart', touch, {passive: true});
            this.plot.over.addEventListener('touchmove', e => { touch(e); e.preventDefault(); }, {passive: false});
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
        if(i == null || u.cursor.left < 0) { this.$tip.hidden = true; return; }
        const r = this.readout(i);
        if(!r) { this.$tip.hidden = true; return; }
        const touchy = touchDevice();
        this.$tip.innerHTML = `
            <div class="uc-tip__title">${esc(r.title)}</div>
            ${r.rows?.length ? `<dl>${r.rows.map(row => `
                <div><dt>${row.color ? `<i style="background:${esc(row.color)}"></i>` : ''}${esc(row.label)}</dt>
                <dd>${esc(row.value)}${row.note ? ` <small>${esc(row.note)}</small>` : ''}</dd></div>`).join('')}</dl>` : ''}
            ${(r.more ?? []).map(m => `<div class="uc-tip__more">${esc(m)}</div>`).join('')}
            ${touchy && r.day ? `<button type="button" class="btn btn--secondary uc-tip__open" data-open-day="${esc(r.day)}">Open day ›</button>` : ''}`;
        this.$tip.classList.toggle('is-touch', touchy);
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
