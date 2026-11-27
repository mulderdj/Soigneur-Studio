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
import { eventTypeLabel } from '../../training/season.js';
import { esc, fmtDay } from './format.js';

const signedInt = (x) => `${Math.round(x) > 0 ? '+' : ''}${Math.round(x)}`;
const daysAwayLabel = (n) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

function raceCalloutHtml(rf) {
    if(!rf) return '';
    const type = eventTypeLabel(rf.goal.eventType);
    const taperText = rf.taperGain >= 2 ? ` · taper +${rf.taperGain} form` : '';
    const assumedText = rf.assumedUnplanned ? ' (assuming build + taper on unplanned weeks)' : '';
    const tuneUpHtml = rf.tuneUp ? `<p class="fc-goal__tuneup">Tune-up: <span class="badge cal-goal__prio" data-priority="B">B</span> <button type="button" class="fc-goal__open" data-open-day="${esc(rf.tuneUp.goal.day)}">${esc(rf.tuneUp.goal.name)}</button> ${esc(daysAwayLabel(rf.tuneUp.daysToGoal))} (${esc(fmtDay(rf.tuneUp.goal.day))}) · form ${esc(signedInt(rf.tuneUp.projected.tsb))}</p>` : '';
    return `
        <div class="fc-goal" data-status="${esc(rf.status)}" data-level="${esc(rf.level)}" data-priority="${esc(rf.goal.priority)}">
            <div class="fc-goal__head">
                <span class="badge cal-goal__prio" data-priority="${esc(rf.goal.priority)}">${esc(rf.goal.priority)}</span>
                <button type="button" class="fc-goal__open" data-open-day="${esc(rf.goal.day)}">${esc(rf.goal.name)}</button>
                <span class="fc-goal__when">${esc(daysAwayLabel(rf.daysToGoal))} · ${esc(fmtDay(rf.goal.day))}${type ? ` · ${esc(type)}` : ''}</span>
            </div>
            <p class="fc-goal__metrics">Race-day form: <strong data-k="race-tsb">${esc(signedInt(rf.projected.tsb))}</strong> (${esc(formLabel(rf.projected.tsb).toLowerCase())}) · Fitness ${Math.round(rf.projected.ctl)}${esc(taperText)}${esc(assumedText)}</p>
            <p class="fc-goal__guidance" data-k="race-guidance">${esc(rf.guidance)}</p>
            ${tuneUpHtml}
        </div>`;
}

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
        const {ahead, hasPlan, ramp, raceForecast} = formModel(this.data);
        const end = ahead.at(-1);
        const rs = ramp !== null && Math.abs(ramp) >= 0.5 ? rampStatus(ramp) : null;
        const rampHtml = rs ? `<p class="card__note fc-ramp" data-level="${esc(rs.level)}">${esc(rs.text)}</p>` : '';
        const goalHtml = raceCalloutHtml(raceForecast);
        return `${goalHtml}${rampHtml}<p class="card__note fc-note" data-k="note">${esc(hasPlan && end ?
            `With your plan: form ${end.tsb > 0 ? '+' : ''}${Math.round(end.tsb)} (${formLabel(end.tsb).toLowerCase()}) on ${fmtDay(end.day)}.` :
            'Plan workouts on the calendar to see where your form is heading.')}</p>`;
    }

    chart() {
        return formChart(this.data, {accent: token(this, '--accent'), hr: token(this, '--hr'), warn: token(this, '--warn')});
    }
}

customElements.define('form-card', FormCard);

export { formModel, PAST_DAYS, AHEAD_DAYS };
