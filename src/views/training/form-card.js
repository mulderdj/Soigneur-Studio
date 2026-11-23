//
// <form-card>: today's fitness, fatigue and form, with 90 days of history
// and a 28-day forecast from the plan.
//
// data = {today, summaries, plan}
//

import { dailyTss, pmc, forecast, formLabel } from '../../training/load.js';
import { planStatus, plannedTss } from '../../training/plan.js';
import { ChartElement, token, drawLines } from './chart.js';
import { fmtDay } from './format.js';

const PAST_DAYS = 90;
const AHEAD_DAYS = 28;

function formModel({today, summaries = [], plan = [], ftp}) {
    const byDay = dailyTss(summaries);
    const first = summaries.length ? summaries.reduce((a, s) => (s.day < a ? s.day : a), today) : today;
    const rows = pmc(byDay, first < today ? first : today, today);
    const now = rows.at(-1) ?? {ctl: 0, atl: 0, tsb: 0};

    const planned = new Map();
    for(const e of plan) {
        if(e.deleted || e.day <= today || planStatus(e, today) !== 'planned') continue;
        planned.set(e.day, (planned.get(e.day) ?? 0) + plannedTss(e.workout, ftp));
    }
    const ahead = forecast(now, planned, today, AHEAD_DAYS);
    const past = rows.slice(-PAST_DAYS);
    return {now, past, ahead, hasPlan: planned.size > 0};
}

class FormCard extends ChartElement {
    connectedCallback() {
        if(!this.querySelector('canvas')) {
            this.innerHTML = `
                <h2 class="card__title">Form</h2>
                <dl class="fc-numbers">
                    <div><dt>Fitness</dt><dd data-k="ctl">–</dd></div>
                    <div><dt>Fatigue</dt><dd data-k="atl">–</dd></div>
                    <div><dt>Form</dt><dd><span data-k="tsb">–</span> <small data-k="label"></small></dd></div>
                </dl>
                <div class="tc-plot fc-plot"><canvas class="tc-canvas" role="img" aria-label="Fitness, fatigue and form over the last 90 days and the next 4 weeks"></canvas></div>
                <p class="card__note fc-note" data-k="note"></p>`;
        }
        this.connectChart();
        this.render();
    }

    set data(d) {
        this._data = d;
        this.render();
    }

    render() {
        if(!this._data || !this.isConnected) return;
        this.model = formModel(this._data);
        const {now, ahead, hasPlan} = this.model;
        const set = (k, v) => { const el = this.querySelector(`[data-k="${k}"]`); if(el) el.textContent = v; };
        set('ctl', Math.round(now.ctl));
        set('atl', Math.round(now.atl));
        set('tsb', `${now.tsb > 0 ? '+' : ''}${Math.round(now.tsb)}`);
        set('label', formLabel(now.tsb));
        const end = ahead.at(-1);
        set('note', hasPlan && end ?
            `With your plan: form ${end.tsb > 0 ? '+' : ''}${Math.round(end.tsb)} (${formLabel(end.tsb).toLowerCase()}) on ${fmtDay(end.day)}.` :
            'Plan workouts on the calendar to see where your form is heading.');
        this.redraw();
    }

    draw(ctx, w, h) {
        if(!this.model) return;
        const {past, ahead} = this.model;
        const rows = [...past, ...ahead];
        const labels = rows.map((r, i) => (i % 14 === 0 ? fmtDay(r.day, {day: 'numeric', month: 'short'}) : ''));
        drawLines(ctx, this, w, h, {
            labels, every: 1, zero: true, markIndex: past.length - 1,
            lines: [
                {values: rows.map(r => r.ctl), color: token(this, '--accent'), width: 2.5, dashedFrom: past.length},
                {values: rows.map(r => r.atl), color: token(this, '--hr'), width: 1.5, dashedFrom: past.length},
                {values: rows.map(r => r.tsb), color: token(this, '--warn'), width: 1.5, dashedFrom: past.length},
            ],
        });
    }
}

customElements.define('form-card', FormCard);

export { formModel, PAST_DAYS, AHEAD_DAYS };
