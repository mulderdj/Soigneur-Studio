//
// Training page cards for trends (charts/insight-models.js):
//   <efficiency-card>       aerobic efficiency (NP ÷ heart rate) of steady rides
//   <readiness-perf-card>   morning HRV or sleep against how the ride went
//
// data = {today, summaries, wellness}
//

import { token } from './uplot-chart.js';
import { ToggleCard } from './progress-cards.js';
import { efficiencyChart, readinessChart } from '../charts/insight-models.js';

const colors = el => ({accent: token(el, '--accent'), good: token(el, '--good'), muted: token(el, '--muted')});

class EfficiencyCard extends ToggleCard {
    get title() { return 'Aerobic efficiency'; }
    emptyText() { return 'Steady rides of 30 minutes or more with power and heart rate show up here.'; }
    foot() {
        return '<p class="card__note">Normalized power per heartbeat (NP ÷ average heart rate) on steady rides. Going up: more power for the same heart rate, your aerobic fitness growing.</p>';
    }
    chart() { return efficiencyChart(this.data, colors(this)); }
}

// what a correlation coefficient means, in words
function strength(r) {
    const a = Math.abs(r);
    const word = a < 0.2 ? 'no clear link' : a < 0.4 ? 'a weak link' : a < 0.6 ? 'a moderate link' : 'a strong link';
    if(a < 0.2) return word;
    return `${word}: ${r > 0 ? 'higher' : 'lower'} values go with better rides`;
}

class ReadinessPerfCard extends ToggleCard {
    get title() { return 'Readiness and rides'; }
    get defaultOption() { return 'hrv'; }
    get options() { return [['hrv', 'HRV'], ['sleep', 'Sleep']]; }
    emptyText() { return 'Needs morning health data (Garmin) and steady rides with power and heart rate.'; }
    foot() {
        const s = this.result?.stats;
        const what = this.option === 'sleep' ? 'last night\'s sleep' : 'that morning\'s HRV against your normal range';
        const base = `<p class="card__note">Each point is a steady ride: ${what} (across) and its efficiency against your usual (up).</p>`;
        if(!s || !s.n) return base;
        if(!s.enough) return `${base}<p class="card__note" data-k="stat">${s.n} ride${s.n === 1 ? '' : 's'} so far; from 8 on it says how strong the link is.</p>`;
        return `${base}<p class="card__note" data-k="stat">r = ${s.r?.toFixed(2) ?? '–'} over ${s.n} rides: ${s.r === null ? 'no clear link' : strength(s.r)}.</p>`;
    }
    chart() {
        this.result = readinessChart(this.data, this.option, colors(this));
        return this.result;
    }
}

customElements.define('efficiency-card', EfficiencyCard);
customElements.define('readiness-perf-card', ReadinessPerfCard);

export { EfficiencyCard, ReadinessPerfCard, strength };
