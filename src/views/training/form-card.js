//
// <form-card>: today's fitness, fatigue and form, with the history and a
// 28-day forecast from the plan, on uPlot: a read-out per day, zoom (3
// months / 1 year / all, or drag on desktop), the cursor shared with the
// health card, a click opens the day.
//
// data = {today, summaries, plan, ftp}
//

import { UPlotCard, token } from './uplot-chart.js';
import { formModel, formChart, PAST_DAYS, AHEAD_DAYS } from './chart-models.js';
import { formLabel, rampStatus } from '../../training/load.js';
import { esc, fmtDay } from './format.js';

class FormCard extends UPlotCard {
    head() {
        return '<h2 class="card__title">Form</h2>';
    }

    intro() {
        const {now} = formModel(this.data);
        return `
            <dl class="fc-numbers">
                <div><dt>Fitness</dt><dd data-k="ctl">${Math.round(now.ctl)}</dd></div>
                <div><dt>Fatigue</dt><dd data-k="atl">${Math.round(now.atl)}</dd></div>
                <div><dt>Form</dt><dd><span data-k="tsb">${now.tsb > 0 ? '+' : ''}${Math.round(now.tsb)}</span> <small data-k="label">${esc(formLabel(now.tsb))}</small></dd></div>
            </dl>`;
    }

    foot() {
        const {ahead, hasPlan, ramp} = formModel(this.data);
        const end = ahead.at(-1);
        const rs = ramp !== null && Math.abs(ramp) >= 0.5 ? rampStatus(ramp) : null;
        const rampHtml = rs ? `<p class="card__note fc-ramp" data-level="${esc(rs.level)}">${esc(rs.text)}</p>` : '';
        return `${rampHtml}<p class="card__note fc-note" data-k="note">${esc(hasPlan && end ?
            `With your plan: form ${end.tsb > 0 ? '+' : ''}${Math.round(end.tsb)} (${formLabel(end.tsb).toLowerCase()}) on ${fmtDay(end.day)}.` :
            'Plan workouts on the calendar to see where your form is heading.')}</p>`;
    }

    chart() {
        return formChart(this.data, {accent: token(this, '--accent'), hr: token(this, '--hr'), warn: token(this, '--warn')});
    }
}

customElements.define('form-card', FormCard);

export { formModel, PAST_DAYS, AHEAD_DAYS };
