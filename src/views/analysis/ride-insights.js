//
// The ride page's extra charts (charts/insight-models.js): rep by rep,
// heart-rate recovery, this ride's power curve against the 90 days before
// it, and power against heart rate. <ride-insights> shows those the ride has
// data for.
//
//   el.data = {samples, pauses, analysis, ftp, summaries, day, id}
//

import { UPlotCard, token } from '../training/uplot-chart.js';
import { repsChart, recoveryChart, rideCurveChart, powerHrChart } from '../charts/insight-models.js';
import { esc } from '../training/format.js';

const colors = el => ({
    accent: token(el, '--accent'), muted: token(el, '--muted'), hr: token(el, '--hr', '#e5484d'), good: token(el, '--good'), ref: token(el, '--ref'),
});

class InsightCard extends UPlotCard {
    head() { return `<h2 class="card__title">${esc(this.title)}</h2>`; }
    foot() { return this.note ? `<p class="card__note">${this.note}</p>` : ''; }
}

class RepsCard extends InsightCard {
    get title() { return 'Rep by rep'; }
    get note() { return 'Average power per effort (bars) against the target, and heart rate (right-hand scale). Rising heart rate at the same power is fatigue building.'; }
    chart() { return repsChart({analysis: this.data.analysis, ftp: this.data.ftp}, colors(this)); }
}

class RecoveryCard extends InsightCard {
    get title() { return 'Heart-rate recovery'; }
    get note() { return 'How far your heart rate drops in the 60 s after each effort (numbered as in Rep by rep). Bigger is fitter; it gets smaller as the session tires you. Efforts followed by another within a minute, like 40/20s, have no bar.'; }
    chart() { return recoveryChart(this.data, colors(this)); }
}

class RideCurveCard extends InsightCard {
    get title() { return 'Power curve: this ride'; }
    get note() { return 'This ride\'s best power for each duration against your best of the 90 days before it.'; }
    chart() { return rideCurveChart({samples: this.data.samples, summaries: this.data.summaries, today: this.data.day, id: this.data.id}, colors(this)); }
}

class PowerHrCard extends InsightCard {
    get title() { return 'Power and heart rate'; }
    get note() { return 'Every 30 s of the ride as a point. When the second half (red) lies higher than the first (blue) at the same power, your heart rate drifted.'; }
    chart() { return powerHrChart(this.data, colors(this)); }
}

const CARDS = [
    ['reps-card', RepsCard, d => repsChart({analysis: d.analysis, ftp: d.ftp})],
    ['recovery-card', RecoveryCard, d => recoveryChart(d)],
    ['ride-curve-card', RideCurveCard, d => rideCurveChart({samples: d.samples, summaries: d.summaries, today: d.day, id: d.id})],
    ['power-hr-card', PowerHrCard, d => powerHrChart(d)],
];
for(const [tag, cls] of CARDS) customElements.define(tag, cls);

class RideInsights extends HTMLElement {
    set data(d) {
        this.innerHTML = '';
        for(const [tag, , has] of CARDS) {
            let ok = false;
            try { ok = has(d).model.x.length > 0; } catch(e) { console.warn(`:ride-insights :${tag}`, e); }
            if(!ok) continue;
            const card = document.createElement(tag);
            card.className = 'card rp-insight';
            this.append(card);
            // one chart that fails never takes the ride page down
            try { card.data = d; } catch(e) { console.warn(`:ride-insights :${tag}`, e); card.remove(); }
        }
        this.hidden = !this.children.length;
    }
}

customElements.define('ride-insights', RideInsights);

export { RideInsights };
