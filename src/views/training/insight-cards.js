//
// Training page cards for trends (charts/insight-models.js):
//   <efficiency-card>       aerobic efficiency (NP ÷ heart rate) of steady rides
//   <decoupling-card>       aerobic decoupling (%) across long steady rides
//   <durability-card>       best 5 / 20 min power after 1,000–3,000 kJ (% of fresh best)
//   <readiness-perf-card>   morning HRV or sleep against how the ride went
//   <compliance-card>       planned workouts completed vs missed and load / duration adherence
//
// data = {today, summaries, wellness, plan, ftp}
//

import { token } from './uplot-chart.js';
import { ToggleCard } from './progress-cards.js';
import { efficiencyChart, decouplingChart, durabilityChart, readinessChart, complianceChart } from '../charts/insight-models.js';

const colors = el => ({accent: token(el, '--accent'), good: token(el, '--good'), warn: token(el, '--warn'), muted: token(el, '--muted')});

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
        const base = `<p class="card__note">Each point is a steady ride (IF 0.60–0.80): ${what} (across) and its efficiency against comparable rides before it (up).</p>`;
        if(!s || !s.n) return base;
        if(!s.enough) return `${base}<p class="card__note" data-k="stat">${s.n} ride${s.n === 1 ? '' : 's'} so far; from 12 on it says how strong the link is.</p>`;
        return `${base}<p class="card__note" data-k="stat">r = ${s.r?.toFixed(2) ?? '–'} over ${s.n} rides: ${s.r === null ? 'no clear link' : strength(s.r)}. A link, not proof of cause.</p>`;
    }
    chart() {
        this.result = readinessChart(this.data, this.option, colors(this));
        return this.result;
    }
}

class DecouplingCard extends ToggleCard {
    get title() { return 'Aerobic decoupling'; }
    emptyText() { return 'Steady rides of 45 minutes or more with power and heart rate show up here.'; }
    foot() {
        return '<p class="card__note">How much your heart rate drifts up against power in the second half of a long steady ride (first 10 minutes left out). Under 5 % shows a solid aerobic base; falling over time means better endurance.</p>';
    }
    chart() { return decouplingChart(this.data, colors(this)); }
}

const DURABILITY_KEYS = {
    1000: '<span class="pc-key pc-key--recent"></span> 1,000 kJ',
    2000: '<span class="pc-key pc-key--good"></span> 2,000 kJ',
    3000: '<span class="pc-key pc-key--warn"></span> 3,000 kJ',
};

class DurabilityCard extends ToggleCard {
    get title() { return 'Durability'; }
    get defaultOption() { return '300'; }
    get options() { return [['300', '5 min'], ['1200', '20 min']]; }
    emptyText() { return 'Long rides past 1,000 kJ of work with power show up here.'; }
    foot() {
        const keys = (this.result?.thresholds ?? []).map(kj => DURABILITY_KEYS[kj]).filter(Boolean).join(' ');
        const legend = keys ? `<p class="card__note pc-legend">${keys}</p>` : '';
        return `${legend}<p class="card__note">Best 5- or 20-minute power after 1,000, 2,000 or 3,000 kJ of work, as a share of your 90-day fresh best. Higher means you hold more power late in long rides.</p>`;
    }
    chart() {
        this.result = durabilityChart(this.data, Number(this.option ?? this.defaultOption), colors(this));
        return this.result;
    }
}

class ComplianceCard extends ToggleCard {
    get title() { return 'Plan compliance'; }
    get defaultOption() { return 'workouts'; }
    get options() { return [['workouts', 'Workouts'], ['load', 'Load %']]; }
    emptyText() { return 'Plan workouts on the calendar to track completed vs missed sessions and load adherence.'; }
    intro() {
        const b = this.result?.compliance?.block;
        if(!b || b.due === 0) return '';
        return `<dl class="cc-stats">
            <div><dt>4-wk done</dt><dd data-k="done">${b.done}/${b.due} <small>${b.completionPct} %</small></dd></div>
            <div><dt>Load</dt><dd data-k="load">${b.loadPct !== null ? `${b.loadPct} %` : '–'}</dd></div>
            <div><dt>Duration</dt><dd data-k="duration">${b.durationPct !== null ? `${b.durationPct} %` : '–'}</dd></div>
        </dl>`;
    }
    foot() {
        const legend = this.option === 'load' ?
            '<p class="card__note pc-legend"><span class="pc-key pc-key--recent"></span> Load % <span class="pc-key pc-key--good"></span> Duration %</p>' :
            '<p class="card__note pc-legend"><span class="pc-key pc-key--good"></span> Completed <span class="pc-key pc-key--warn"></span> Missed</p>';
        return `${legend}<p class="card__note">Planned workouts completed vs missed each week, and actual against planned TSS and time.</p>`;
    }
    chart() {
        this.result = complianceChart(this.data, this.option ?? this.defaultOption, colors(this));
        return this.result;
    }
}

customElements.define('efficiency-card', EfficiencyCard);
customElements.define('decoupling-card', DecouplingCard);
customElements.define('durability-card', DurabilityCard);
customElements.define('readiness-perf-card', ReadinessPerfCard);
customElements.define('compliance-card', ComplianceCard);

export { EfficiencyCard, DecouplingCard, DurabilityCard, ReadinessPerfCard, ComplianceCard, strength };
