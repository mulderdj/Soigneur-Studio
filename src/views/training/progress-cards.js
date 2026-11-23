//
// <progress-cards>: weekly volume, power curve, FTP trend and time in zones.
//
// data = {today, summaries, ftp}
//

import { xf } from '../../functions.js';
import { weeklyVolume, powerCurve, ftpEstimates, zoneTotals } from '../../training/progress.js';
import { ChartElement, token, drawBars, drawLines } from './chart.js';
import { UPlotCard } from './uplot-chart.js';
import { volumeChart, zonesChart } from './chart-models.js';
import { fmtDay } from './format.js';

const NUDGE = 0.05;

// the FTP to offer when the estimate is more than 5 % away from the set FTP
function ftpNudge(estimate, ftp) {
    if(!Number.isFinite(estimate) || !(ftp > 0)) return null;
    return Math.abs(estimate - ftp) / ftp > NUDGE ? Math.round(estimate) : null;
}

const weekLabel = w => fmtDay(w, {day: 'numeric', month: 'short'});
const zoneColors = el => [1, 2, 3, 4, 5, 6, 7].map(i => token(el, `--zone-${i}`));

function segmented(name, options, value) {
    return `<div class="segmented" role="group" aria-label="${name}">${options.map(([k, label]) =>
        `<button type="button" class="segmented__opt" data-opt="${k}" aria-pressed="${k === value}">${label}</button>`).join('')}</div>`;
}

class ProgressCard extends ChartElement {
    connectedCallback() {
        this.option = this.option ?? this.defaultOption;
        this.addEventListener('click', e => {
            const opt = e.target.closest('[data-opt]');
            if(opt) { this.option = opt.dataset.opt; this.render(); return; }
            const use = e.target.closest('[data-use-ftp]');
            if(use) xf.dispatch('ui:ftp-set', Number(use.dataset.useFtp));
        });
        this.render();
    }

    set data(d) {
        this._data = d;
        this.render();
    }

    render() {
        if(!this._data || !this.isConnected) return;
        this.innerHTML = `
            <div class="pc-head">
                <h2 class="card__title">${this.title}</h2>
                ${this.options ? segmented(this.title, this.options, this.option) : ''}
            </div>
            ${this.extra ? this.extra() : ''}
            <div class="tc-plot"><canvas class="tc-canvas" role="img" aria-label="${this.title}"></canvas></div>`;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.connectChart();
        this.redraw();
    }
}

// a uPlot card with a toggle in its header (data-opt), e.g. the metric
class ToggleCard extends UPlotCard {
    head() {
        this.option = this.option ?? this.defaultOption;
        return `<h2 class="card__title">${this.title}</h2>${segmented(this.title, this.options, this.option)}`;
    }

    onHeadClick(e) {
        const opt = e.target.closest('[data-opt]');
        if(opt) { this.option = opt.dataset.opt; this.range = null; this.rebuild(); }
    }
}

class VolumeCard extends ToggleCard {
    get title() { return 'Weekly volume'; }
    get defaultOption() { return 'hours'; }
    get options() { return [['hours', 'Hours'], ['tss', 'TSS'], ['kj', 'kJ']]; }
    chart() { return volumeChart(this.data, this.option, {accent: token(this, '--accent')}); }
}

class CurveCard extends ProgressCard {
    get title() { return 'Power curve'; }
    get defaultOption() { return 'w'; }
    get options() { return [['w', 'W'], ['wkg', 'W/kg']]; }
    extra() { return '<p class="card__note pc-legend"><span class="pc-key pc-key--recent"></span> Last 6 weeks <span class="pc-key pc-key--all"></span> All time</p>'; }
    draw(ctx, w, h) {
        const c = powerCurve(this._data.summaries, this._data.today);
        const key = this.option === 'wkg' ? 'wkg' : 'watts';
        drawBars(ctx, this, w, h, {
            labels: ['5 s', '1 min', '5 min', '20 min', '60 min'],
            series: [
                {values: c.allTime[key].map(v => v ?? 0), color: token(this, '--line')},
                {values: c.recent[key].map(v => v ?? 0), color: token(this, '--accent')},
            ],
        });
    }
}

class FtpCard extends ProgressCard {
    get title() { return 'FTP trend'; }
    extra() {
        const est = ftpEstimates(this._data.summaries, this._data.today, 12);
        const latest = [...est].reverse().find(x => x.ftp !== null)?.ftp ?? null;
        const offer = ftpNudge(latest, this._data.ftp);
        return offer ?
            `<p class="card__note pc-nudge">Your rides suggest an FTP of ${offer} W (set: ${this._data.ftp} W).
                <button type="button" class="btn btn--secondary" data-use-ftp="${offer}">Use ${offer} W</button></p>` :
            `<p class="card__note">Estimated from your best 20 and 60 minutes over 6 weeks; set FTP ${this._data.ftp} W.</p>`;
    }
    draw(ctx, w, h) {
        const est = ftpEstimates(this._data.summaries, this._data.today, 12);
        drawLines(ctx, this, w, h, {
            labels: est.map((x, i) => (i % 3 === 0 ? weekLabel(x.week) : '')),
            lines: [
                {values: est.map(() => this._data.ftp), color: token(this, '--muted'), width: 1},
                {values: est.map(x => x.ftp), color: token(this, '--accent'), width: 2.5},
            ],
        });
    }
}

class ZonesCard extends ToggleCard {
    get title() { return 'Time in zones'; }
    get defaultOption() { return 'week'; }
    get options() { return [['week', 'Weeks'], ['month', 'Months']]; }
    chart() { return zonesChart(this.data, this.option, {zones: zoneColors(this)}); }
}

customElements.define('volume-card', VolumeCard);
customElements.define('curve-card', CurveCard);
customElements.define('ftp-card', FtpCard);
customElements.define('zones-card', ZonesCard);

export { ftpNudge };
