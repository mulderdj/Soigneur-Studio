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

class CurveCard extends ToggleCard {
    get title() { return 'Power curve'; }
    get defaultOption() { return 'w'; }
    get options() { return [['w', 'W'], ['wkg', 'W/kg']]; }
    foot() {
        return `<p class="card__note pc-legend"><span class="pc-key pc-key--recent"></span> Last 6 weeks <span class="pc-key pc-key--all"></span> All time${
            modelFit?.ok ? ' <span class="pc-key pc-key--model"></span> Model' : ''}</p>`;
    }
    chart() { return curveChart(this.data, this.option, {accent: token(this, '--accent'), muted: token(this, '--muted'), model: token(this, '--good')}, modelFit); }
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
    foot() {
        return this.option === 'polar' ?
            '<p class="card__note">Each week\'s riding as easy (Z1–Z2), middle (Z3–Z5) and hard (Z6–Z7). Polarised training is mostly easy with some very hard, and little in the middle.</p>' : '';
    }
    chart() {
        if(this.option === 'polar') {
            const z = zoneColors(this);
            return polarisedChart(this.data, {easy: z[1], middle: z[4], hard: z[6]});
        }
        return zonesChart(this.data, this.option, {zones: zoneColors(this)});
    }
}

customElements.define('volume-card', VolumeCard);
customElements.define('curve-card', CurveCard);
customElements.define('ftp-card', FtpCard);
customElements.define('zones-card', ZonesCard);

export { ftpNudge, ToggleCard };
