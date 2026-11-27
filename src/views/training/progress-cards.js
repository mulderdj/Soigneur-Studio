//
// <progress-cards>: weekly volume, power curve, FTP trend and time in zones,
// on uPlot with read-outs (see chart-models.js for what each one shows).
//
// data = {today, summaries, ftp}
//

import { xf } from '../../functions.js';
import { ftpEstimates } from '../../training/progress.js';
import { UPlotCard, token } from './uplot-chart.js';
import { volumeChart, zonesChart, curveChart, ftpChart } from './chart-models.js';
import { polarisedChart } from '../charts/insight-models.js';
import { classifyIntensity } from '../../analysis/insights.js';
import { esc } from './format.js';

const NUDGE = 0.05;

// the rider model's fit, drawn over the power curve (rider-model-wiring.js)
let modelFit = null;
window.addEventListener('rider-model:changed', e => {
    const fit = e.detail?.data?.fit ?? null;
    if(fit?.ok === modelFit?.ok && fit?.cp === modelFit?.cp && fit?.wprime === modelFit?.wprime) return;
    modelFit = fit;
    for(const c of document.querySelectorAll('curve-card')) if(c.data) c.rebuild?.();
});

// the FTP to offer when the estimate is more than 5 % away from the set FTP
function ftpNudge(estimate, ftp) {
    if(!Number.isFinite(estimate) || !(ftp > 0)) return null;
    return Math.abs(estimate - ftp) / ftp > NUDGE ? Math.round(estimate) : null;
}

const zoneColors = el => [1, 2, 3, 4, 5, 6, 7].map(i => token(el, `--zone-${i}`));

function segmented(name, options, value) {
    return `<div class="segmented" role="group" aria-label="${esc(name)}">${options.map(([k, label]) =>
        `<button type="button" class="segmented__opt" data-opt="${k}" aria-pressed="${k === value}">${label}</button>`).join('')}</div>`;
}

// a chart card whose header has a toggle (data-opt): the metric or the unit
class ToggleCard extends UPlotCard {
    head() {
        this.option = this.option ?? this.defaultOption;
        return `<h2 class="card__title">${this.title}</h2>${this.options ? segmented(this.title, this.options, this.option) : ''}`;
    }

    onHeadClick(e) {
        const opt = e.target.closest('[data-opt]');
        if(opt) { this.option = opt.dataset.opt; this.range = null; this.rebuild(); return; }
        const use = e.target.closest('[data-use-ftp]');
        if(use) xf.dispatch('ui:ftp-set', Number(use.dataset.useFtp));
    }
}

class VolumeCard extends ToggleCard {
    get title() { return 'Weekly volume'; }
    get defaultOption() { return 'hours'; }
    get options() { return [['hours', 'Hours'], ['tss', 'TSS'], ['kj', 'kJ']]; }
    chart() { return volumeChart(this.data, this.option, {accent: token(this, '--accent')}); }
}

const CURVE_LEGEND = {
    all:   ['Last 6 weeks', 'All time'],
    '90d': ['Last 90 days', 'All time'],
    prior: ['Last 90 days', 'Prior season'],
};

class CurveCard extends ToggleCard {
    get title() { return 'Power curve'; }
    get defaultOption() { return 'w'; }
    get options() { return [['w', 'W'], ['wkg', 'W/kg']]; }
    head() {
        this.option = this.option ?? this.defaultOption;
        this.compare = this.compare ?? 'all';
        const unitSeg = segmented(this.title, this.options, this.option);
        const cmpSeg = `<div class="segmented" role="group" aria-label="Compare">${[['all', 'All time'], ['90d', '90 days'], ['prior', 'Prior season']].map(([k, label]) =>
            `<button type="button" class="segmented__opt" data-compare="${k}" aria-pressed="${k === this.compare}">${label}</button>`).join('')}</div>`;
        return `<h2 class="card__title">${this.title}</h2><div class="mc-toggles">${cmpSeg}${unitSeg}</div>`;
    }
    onHeadClick(e) {
        const cmp = e.target.closest('[data-compare]');
        if(cmp) { this.compare = cmp.dataset.compare; this.rebuild(); return; }
        super.onHeadClick(e);
    }
    foot() {
        const [rec, ref] = CURVE_LEGEND[this.compare ?? 'all'] ?? CURVE_LEGEND.all;
        return `<p class="card__note pc-legend"><span class="pc-key pc-key--recent"></span> ${rec} <span class="pc-key pc-key--all"></span> ${ref}${
            modelFit?.ok ? ' <span class="pc-key pc-key--model"></span> Model' : ''}</p>`;
    }
    chart() {
        return curveChart(this.data, this.option, {accent: token(this, '--accent'), muted: token(this, '--muted'), model: token(this, '--good')}, modelFit, this.compare ?? 'all');
    }
}

class FtpCard extends ToggleCard {
    get title() { return 'FTP trend'; }
    foot() {
        const est = ftpEstimates(this.data.summaries ?? [], this.data.today, 12);
        const latest = [...est].reverse().find(x => x.ftp !== null)?.ftp ?? null;
        const offer = ftpNudge(latest, this.data.ftp);
        return offer ?
            `<p class="card__note pc-nudge">Your rides suggest an FTP of ${offer} W (set: ${this.data.ftp} W).
                <button type="button" class="btn btn--secondary" data-use-ftp="${offer}">Use ${offer} W</button></p>` :
            `<p class="card__note">Estimated from your best 20 and 60 minutes over 6 weeks; set FTP ${this.data.ftp} W.</p>`;
    }
    chart() { return ftpChart(this.data, {accent: token(this, '--accent'), muted: token(this, '--muted')}); }
}

class ZonesCard extends ToggleCard {
    get title() { return 'Time in zones'; }
    get defaultOption() { return 'week'; }
    get options() { return [['week', 'Weeks'], ['month', 'Months'], ['polar', '3 zones']]; }
    intro() {
        if(this.option !== 'polar') return '';
        const cls = this.result?.classification ?? classifyIntensity(this.data?.summaries ?? [], this.data?.today);
        if(!cls?.enough) return '';
        const e = Math.round(cls.easy * 100), m = Math.round(cls.middle * 100), h = Math.round(cls.hard * 100);
        return `<div class="zc-pattern" data-pattern="${esc(cls.pattern)}">
            <span class="badge zc-badge">${esc(cls.label)}</span>
            <span class="zc-split">Last 4 weeks: ${e} % easy · ${m} % middle · ${h} % hard</span>
        </div>`;
    }
    foot() {
        const cls = this.option === 'polar' ? (this.result?.classification ?? null) : classifyIntensity(this.data?.summaries ?? [], this.data?.today);
        if(this.option === 'polar') {
            const detail = cls?.enough ? esc(cls.note) : 'Polarised training is mostly easy with some very hard, and little in the middle.';
            return `<p class="card__note">Each week's riding as easy (Z1–Z2), middle (Z3–Z5) and hard (Z6–Z7). ${detail}</p>`;
        }
        return cls?.enough ? `<p class="card__note" data-k="intensity-pattern">Last 4 weeks: <strong>${esc(cls.label)}</strong> (${Math.round(cls.easy * 100)} / ${Math.round(cls.middle * 100)} / ${Math.round(cls.hard * 100)} % easy / middle / hard).</p>` : '';
    }
    chart() {
        if(this.option === 'polar') {
            const z = zoneColors(this);
            this.result = polarisedChart(this.data, {easy: z[1], middle: z[4], hard: z[6]});
            return this.result;
        }
        this.result = zonesChart(this.data, this.option, {zones: zoneColors(this)});
        return this.result;
    }
}

customElements.define('volume-card', VolumeCard);
customElements.define('curve-card', CurveCard);
customElements.define('ftp-card', FtpCard);
customElements.define('zones-card', ZonesCard);

export { ftpNudge, ToggleCard };
