//
// <readiness-card>: today's verdict — ready, take care or rest — with its
// reasons (src/training/readiness.js), and today's planned workout.
//
// data = {today, summaries, plan, wellness, ftp}
//

import { readiness, isHard } from '../../training/readiness.js';
import { planStatus } from '../../training/plan.js';
import { esc } from './format.js';

const WORD = {'ready': 'Ready', 'take-care': 'Take care', 'rest': 'Rest'};
const ADVICE = {
    'ready': 'Train as planned.',
    'take-care': 'Keep it easier today: no hard efforts.',
    'rest': 'A rest day, or an easy spin at most.',
};

class ReadinessCard extends HTMLElement {
    set data(d) { this._data = d; this.render(); }
    get data() { return this._data; }
    connectedCallback() { this.render(); }

    render() {
        const d = this._data;
        if(!d || !this.isConnected) return;
        const r = readiness({today: d.today, days: d.wellness ?? [], summaries: d.summaries ?? [], ftp: d.ftp});
        const entry = (d.plan ?? []).find(e => !e.deleted && e.day === d.today && planStatus(e, d.today) === 'planned' && e.workout);
        const hard = entry ? isHard(entry.workout, d.ftp) : false;
        const name = entry?.workout?.meta?.name ?? entry?.name ?? 'Workout';
        const plan = entry ? `<p class="rd-plan">Planned today: <strong>${esc(name)}</strong>${hard ? ' · hard' : ''}${
            hard && r.state !== 'ready' ? ' — the Ride page offers an easier option before you start.' : ''}</p>` : '';
        const noGarmin = !(d.wellness ?? []).length;
        this.innerHTML = `
            <div class="rd" data-state="${r.state}">
                <div class="rd-head">
                    <span class="rd-dot" aria-hidden="true"></span>
                    <div>
                        <h2 class="card__title">Readiness</h2>
                        <p class="rd-word">${WORD[r.state]}</p>
                    </div>
                </div>
                <p class="rd-advice">${ADVICE[r.state]}${r.basis === 'form' ? ' Judging by your training load only.' : ''}</p>
                <ul class="rd-reasons">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
                ${plan}
                ${noGarmin ? '<p class="card__note">Connect Garmin in the rider menu for HRV, resting heart rate and sleep.</p>' : ''}
            </div>`;
    }
}

customElements.define('readiness-card', ReadinessCard);

export { ReadinessCard };
