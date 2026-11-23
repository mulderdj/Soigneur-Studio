//
// <health-card>: last night from Garmin. HRV against the rider's normal
// range, resting heart rate against its 30-day average, sleep and Body
// Battery; below, HRV with each night's normal range as a band and resting
// heart rate on uPlot: a read-out per night, zoom (1 month / 3 months /
// all), the cursor shared with the form card, a click opens the day.
// Hidden when there is no health data.
//
// data = {today, wellness: Day[]}
//

import { hrvRange, hrvState, latestNight, restingTrend, sortedDays } from '../../training/wellness.js';
import { UPlotCard, token } from './uplot-chart.js';
import { healthChart } from './chart-models.js';
import { esc, fmtDay, fmtDuration } from './format.js';

const STATE_TEXT = {in: 'in your normal range', below: 'below your normal range', above: 'above your normal range'};

class HealthCard extends UPlotCard {
    night() {
        return latestNight(sortedDays(this.data?.wellness));
    }

    head() {
        const night = this.night();
        this.hidden = !night;
        const when = !night ? '' : night.day === this.data.today ? 'last night' : fmtDay(night.day);
        return `<h2 class="card__title hc-title">Health <small class="hc-when" data-k="when">${esc(when)}</small></h2>`;
    }

    intro() {
        const days = sortedDays(this.data.wellness);
        const night = this.night();
        if(!night) return '';
        const range = hrvRange(days);
        const state = hrvState(night.hrv, range);
        const rest = restingTrend(days);
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
        return `<dl class="hc-grid">${items.join('')}</dl>`;
    }

    foot() {
        return '<p class="card__note hc-legend"><span class="hc-key hc-key--hrv"></span>HRV (ms) <span class="hc-key hc-key--rest"></span>Resting heart rate (bpm) <span class="hc-key hc-key--band"></span>Normal HRV range</p>';
    }

    chart() {
        return healthChart(this.data, {accent: token(this, '--accent'), hr: token(this, '--hr'), band: token(this, '--band', 'rgba(76,154,255,0.15)')});
    }
}

customElements.define('health-card', HealthCard);

export { HealthCard };
