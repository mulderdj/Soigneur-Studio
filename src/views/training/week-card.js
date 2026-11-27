//
// <week-card>: this week so far against the same days of last week, plus a
// concise summary of what changed vs last week and the 4-week norm.
//
// data = {today, summaries, plan, ftp}
//

import { weekCompare } from '../../training/progress.js';
import { weeklySummary } from '../../analysis/insights.js';
import { esc, fmtHours } from './format.js';

function delta(now, before, fmt = x => Math.round(x)) {
    const d = now - before;
    if(Math.abs(d) < 0.05) return '<small class="wc-delta">same as last week</small>';
    return `<small class="wc-delta" data-dir="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))} vs last week</small>`;
}

class WeekCard extends HTMLElement {
    set data(d) {
        this._data = d;
        this.render();
    }

    get data() { return this._data; }

    connectedCallback() {
        this.render();
    }

    render() {
        if(!this._data || !this.isConnected) return;
        const summaries = this._data.summaries ?? [];
        const {current: c, previous: p} = weekCompare(summaries, this._data.today);
        const brief = weeklySummary({
            summaries,
            plan: this._data.plan ?? [],
            today: this._data.today,
            ftp: this._data.ftp > 0 ? this._data.ftp : 250,
        });
        const notes = brief.items.length ?
            `<ul class="wc-summary">${brief.items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
        this.innerHTML = `
            <h2 class="card__title">This week</h2>
            <dl class="wc-grid">
                <div><dt>Rides</dt><dd>${c.rides}</dd>${delta(c.rides, p.rides)}</div>
                <div><dt>Hours</dt><dd>${fmtHours(c.hours)}</dd>${delta(c.hours, p.hours, fmtHours)}</div>
                <div><dt>TSS</dt><dd>${Math.round(c.tss)}</dd>${delta(c.tss, p.tss)}</div>
                <div><dt>kJ</dt><dd>${Math.round(c.kj)}</dd>${delta(c.kj, p.kj)}</div>
            </dl>${notes}`;
    }
}

customElements.define('week-card', WeekCard);

export { WeekCard };
