//
// <health-card>: last night from Garmin. HRV against the rider's normal
// range, resting heart rate against its 30-day average, sleep and Body
// Battery, with 60 days of HRV (normal range shaded) and resting heart
// rate. Hidden when there is no health data.
//
// data = {today, wellness: Day[]}
//

import { hrvRange, hrvState, latestNight, restingTrend, sortedDays } from '../../training/wellness.js';
import { ChartElement, token, drawLines } from './chart.js';
import { esc, fmtDay, fmtDuration } from './format.js';

const CHART_DAYS = 60;
const STATE_TEXT = {in: 'in your normal range', below: 'below your normal range', above: 'above your normal range'};

class HealthCard extends ChartElement {
    connectedCallback() {
        if(!this.querySelector('.hc-plot')) {
            this.innerHTML = `
                <h2 class="card__title hc-title">Health <small class="hc-when" data-k="when"></small></h2>
                <dl class="hc-grid"></dl>
                <div class="tc-plot hc-plot"><canvas class="tc-canvas" role="img" aria-label="HRV and resting heart rate over the last 60 days, with the normal HRV range shaded"></canvas></div>
                <p class="card__note hc-legend"><span class="hc-key hc-key--hrv"></span>HRV (ms) <span class="hc-key hc-key--rest"></span>Resting heart rate (bpm) <span class="hc-key hc-key--band"></span>Normal HRV range</p>`;
        }
        this.connectChart();
        this.render();
    }

    set data(d) {
        this._data = d;
        this.render();
    }

    render() {
        if(!this._data) return;
        const days = sortedDays(this._data.wellness);
        const night = latestNight(days);
        this.hidden = !night;
        if(!night || !this.isConnected || !this.querySelector('.hc-grid')) return;

        const range = hrvRange(days);
        const state = hrvState(night.hrv, range);
        const rest = restingTrend(days);
        const when = this.querySelector('[data-k="when"]');
        when.textContent = night.day === this._data.today ? 'last night' : fmtDay(night.day);

        const item = (label, value, note = '', attrs = '') => `<div ${attrs}><dt>${label}</dt><dd>${value}</dd>${note ? `<small>${note}</small>` : ''}</div>`;
        const items = [];
        if(Number.isFinite(night.hrv)) {
            const note = state ? `${STATE_TEXT[state]} (${range.low}–${range.high})` : 'normal range after 2 weeks of nights';
            items.push(item('HRV', `${Math.round(night.hrv)}<small> ms</small>`, esc(note), `class="hc-hrv" data-hrv-state="${state ?? 'none'}"`));
        }
        if(rest && rest.day === night.day) {
            const note = Number.isFinite(rest.average) ?
                  `${rest.value - rest.average > 0 ? '+' : rest.value === rest.average ? '±' : '−'}${Math.abs(rest.value - rest.average)} vs 30-day average` : '';
            items.push(item('Resting HR', `${rest.value}<small> bpm</small>`, note));
        }
        if(Number.isFinite(night.sleepSeconds)) {
            items.push(item('Sleep', fmtDuration(night.sleepSeconds), Number.isFinite(night.sleepScore) ? `score ${night.sleepScore}` : ''));
        }
        if(Number.isFinite(night.bodyBattery)) items.push(item('Body Battery', String(night.bodyBattery)));
        this.querySelector('.hc-grid').innerHTML = items.join('');

        const from = new Date(Date.parse(this._data.today ?? night.day) - (CHART_DAYS - 1) * 86400000).toISOString().slice(0, 10);
        this.model = {days: days.filter(d => d.day >= from), range};
        this.redraw();
    }

    draw(ctx, w, h) {
        if(!this.model || this.model.days.length === 0) return;
        const {days, range} = this.model;
        const labels = days.map((d, i) => (i % 14 === 0 ? fmtDay(d.day, {day: 'numeric', month: 'short'}) : ''));
        drawLines(ctx, this, w, h, {
            labels, every: 1, fromZero: false,
            band: range ? {low: range.low, high: range.high, color: token(this, '--band', 'rgba(76,154,255,0.15)')} : null,
            lines: [
                {values: days.map(d => d.hrv), color: token(this, '--accent'), width: 2.5},
                {values: days.map(d => d.restingHr), color: token(this, '--hr'), width: 1.5},
            ],
        });
    }
}

customElements.define('health-card', HealthCard);

export { HealthCard };
