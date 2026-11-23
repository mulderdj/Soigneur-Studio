//
// Small canvas charts for the Training page, drawn like the live ride
// chart: colours come from the design tokens, they redraw on resize and
// on theme change.
//

function token(el, name, fallback = '#888') {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
}

// a custom element with one <canvas class="tc-canvas"> that redraws itself
class ChartElement extends HTMLElement {
    connectChart() {
        this.$canvas = this.querySelector('canvas.tc-canvas');
        if(!this.$canvas || this.resizeObserver) return;
        this.resizeObserver = new ResizeObserver(() => this.redraw());
        this.resizeObserver.observe(this.$canvas.parentElement);
        this.themeObserver = new MutationObserver(() => this.redraw());
        this.themeObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
    }

    disconnectedCallback() {
        this.resizeObserver?.disconnect();
        this.themeObserver?.disconnect();
        this.resizeObserver = null;
    }

    redraw() {
        const canvas = this.$canvas;
        const ctx = canvas?.getContext?.('2d');
        if(!ctx) return; // no canvas (tests)
        const box = canvas.parentElement.getBoundingClientRect();
        if(box.width === 0 || box.height === 0) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(box.width * dpr);
        canvas.height = Math.round(box.height * dpr);
        canvas.style.width = `${box.width}px`;
        canvas.style.height = `${box.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, box.width, box.height);
        this.draw?.(ctx, box.width, box.height);
    }
}

const PAD = {l: 36, r: 8, t: 8, b: 20};

// a round step (1, 2, 2.5 or 5 × 10^k) giving about `ticks` gridlines
function niceStep(range, ticks = 4) {
    const raw = (range || 1) / ticks;
    const p = 10 ** Math.floor(Math.log10(raw));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function scale(min, max) {
    const step = niceStep(max - min);
    const lo = Math.floor(min / step) * step;
    const hi = Math.max(lo + step, Math.ceil(max / step) * step);
    return {min: lo, max: hi, ticks: Math.round((hi - lo) / step)};
}

function axis(ctx, el, w, h, {min, max, ticks = 4, labels = [], every = 1, unit = ''}) {
    const muted = token(el, '--muted');
    const line = token(el, '--line');
    const font = getComputedStyle(el).getPropertyValue('--font-text') || 'sans-serif';
    ctx.font = `11px ${font}`;
    ctx.fillStyle = muted;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    const ph = h - PAD.t - PAD.b;
    for(let i = 0; i <= ticks; i++) {
        const v = min + (max - min) * i / ticks;
        const y = Math.round(PAD.t + ph - (v - min) / (max - min || 1) * ph) + 0.5;
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(`${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`, PAD.l - 4, y);
    }
    const pw = w - PAD.l - PAD.r;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    labels.forEach((label, i) => {
        if(i % every !== 0 || !label) return;
        ctx.fillText(label, PAD.l + (i + 0.5) * pw / labels.length, h - PAD.b + 4);
    });
}

// series: [{values: number[], color}] — stacked when `stacked`
function drawBars(ctx, el, w, h, {labels, series, stacked = false, every = 1, unit = '', highlightLast = false}) {
    const n = labels.length;
    const totals = labels.map((_, i) => stacked ?
        series.reduce((a, s) => a + (s.values[i] || 0), 0) :
        Math.max(...series.map(s => s.values[i] || 0)));
    const {max, ticks} = scale(0, Math.max(...totals, 0) || 1);
    axis(ctx, el, w, h, {min: 0, max, ticks, labels, every, unit});
    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
    const slot = pw / n, bw = Math.max(2, slot * (series.length > 1 && !stacked ? 0.8 / series.length : 0.6));
    for(let i = 0; i < n; i++) {
        let base = 0;
        series.forEach((s, k) => {
            const v = s.values[i] || 0;
            if(v <= 0) return;
            const x = stacked || series.length === 1 ?
                  PAD.l + i * slot + (slot - bw) / 2 :
                  PAD.l + i * slot + slot * 0.1 + k * bw;
            const y0 = PAD.t + ph - (base + v) / max * ph;
            const bh = v / max * ph;
            ctx.globalAlpha = highlightLast && i !== n - 1 ? 0.7 : 1;
            ctx.fillStyle = s.color;
            ctx.fillRect(x, y0, bw, Math.max(1, bh));
            if(stacked) base += v;
        });
    }
    ctx.globalAlpha = 1;
}

// lines: [{values: (number|null)[], color, width, dashedFrom}] over the same x positions
function drawLines(ctx, el, w, h, {labels, lines, every = 1, zero = false, markIndex = null}) {
    const all = lines.flatMap(l => l.values).filter(Number.isFinite);
    const {min, max, ticks} = scale(Math.min(0, ...all), Math.max(10, ...all));
    axis(ctx, el, w, h, {min, max, ticks, labels, every});
    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
    const xOf = i => PAD.l + (i + 0.5) * pw / labels.length;
    const yOf = v => PAD.t + ph - (v - min) / (max - min || 1) * ph;
    if(zero && min < 0) {
        ctx.strokeStyle = token(el, '--muted');
        ctx.beginPath(); ctx.moveTo(PAD.l, yOf(0)); ctx.lineTo(w - PAD.r, yOf(0)); ctx.stroke();
    }
    if(markIndex !== null) {
        ctx.strokeStyle = token(el, '--line');
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(xOf(markIndex), PAD.t); ctx.lineTo(xOf(markIndex), h - PAD.b); ctx.stroke();
        ctx.setLineDash([]);
    }
    for(const l of lines) {
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l.width ?? 2;
        let started = false;
        const segment = (from, to, dashed) => {
            ctx.setLineDash(dashed ? [5, 4] : []);
            ctx.beginPath(); started = false;
            for(let i = from; i <= to; i++) {
                const v = l.values[i];
                if(!Number.isFinite(v)) { started = false; continue; }
                if(!started) { ctx.moveTo(xOf(i), yOf(v)); started = true; } else ctx.lineTo(xOf(i), yOf(v));
            }
            ctx.stroke();
        };
        const split = l.dashedFrom ?? labels.length;
        if(split > 0) segment(0, Math.min(split, labels.length - 1), false);
        if(split < labels.length) segment(Math.max(0, split - 1), labels.length - 1, true);
    }
    ctx.setLineDash([]);
}

export { ChartElement, token, drawBars, drawLines };
