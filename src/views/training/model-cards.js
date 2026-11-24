//
// The rider model's cards on the Training page (src/training/rider-model.js):
//
//   <model-card>    CP and W′ from the best efforts of 2–20 min in 90 days,
//                   what W′bal uses, and the offer or the automatic setting
//   <profile-card>  the power profile: 5 s, 1 min, 5 min and FTP in W/kg,
//                   against a category table (men's or women's)
//
// The model arrives with 'rider-model:changed' (rider-model-wiring.js); the
// last one is kept here, so a card shown later has it at once.
// data = {today, ftp, weight, summaries}
//

import { xf } from '../../functions.js';
import { powerProfile, CATEGORIES } from '../../training/rider-model.js';
import { modelSettings } from '../../training/rider-model-settings.js';
import { durationLabel } from './chart-models.js';
import { esc, fmtDay } from './format.js';

let latest = null;
const cards = new Set();
window.addEventListener('rider-model:changed', e => {
    latest = e.detail?.data ?? null;
    for(const c of cards) c.render();
});
// the test button is hidden during a ride
let riding = false;
xf.sub('db:watchStatus', s => {
    const now = s === 'started' || s === 'paused';
    if(now === riding) return;
    riding = now;
    for(const c of cards) c.render();
});

const kj = w => `${(w / 1000).toFixed(1)} kJ`;

function segmented(name, attr, options, value) {
    return `<div class="segmented" role="group" aria-label="${esc(name)}">${options.map(([k, label]) =>
        `<button type="button" class="segmented__opt" data-${attr}="${k}" aria-pressed="${k === value}">${label}</button>`).join('')}</div>`;
}

class ModelCardBase extends HTMLElement {
    set data(d) { this._data = d; this.render(); }
    get data() { return this._data; }
    connectedCallback() {
        cards.add(this);
        if(!this.listening) {
            this.listening = true;
            this.addEventListener('click', e => this.onClick(e));
        }
        this.render();
    }
    disconnectedCallback() { cards.delete(this); }
    get model() { return latest; }
}

class ModelCard extends ModelCardBase {
    onClick(e) {
        const b = e.target.closest('[data-mc], [data-mode]');
        if(!b) return;
        if(b.dataset.mode) modelSettings.set({mode: b.dataset.mode});
        else if(b.dataset.mc === 'use' && this.model?.offer) modelSettings.set({use: {cp: this.model.offer.cp, wprime: this.model.offer.wprime}});
        else if(b.dataset.mc === 'unuse') modelSettings.set({use: null});
        else if(b.dataset.mc === 'ride-test' && !riding) { xf.dispatch('tests:ride', '3-12'); return; }
        this.render();
    }

    render() {
        if(!this.isConnected) return;
        const m = this.model, d = this._data ?? {};
        const settings = modelSettings.get();
        const head = `<div class="pc-head"><h2 class="card__title">CP and W′</h2>${
            segmented('Use the model', 'mode', [['ask', 'Ask me'], ['auto', 'Automatically']], settings.mode)}</div>`;
        if(!m) { this.innerHTML = `${head}<p class="card__note">Working out your model…</p>`; return; }
        const fit = m.fit, eff = m.effective;
        let body;
        if(fit.ok) {
            const ftp = d.ftp > 0 ? d.ftp : null;
            const ofFtp = ftp ? `<p class="mc-ftp">CP is ${Math.round(fit.cp / ftp * 100)} % of your FTP (${ftp} W).</p>` : '';
            const efforts = fit.points.map(p => `<li class="mc-effort"><span class="mc-dur">${durationLabel(p.seconds)}</span>
                <span class="mc-w">${Math.round(p.watts)} W</span>
                <span class="mc-from">${esc(p.name ?? 'Ride')} · ${esc(fmtDay(p.day))}</span></li>`).join('');
            body = `
                <dl class="mc-values">
                    <div><dt>CP</dt><dd data-k="cp">${fit.cp} W</dd></div>
                    <div><dt>W′</dt><dd data-k="wprime">${kj(fit.wprime)}</dd></div>
                    <div><dt>Fit</dt><dd data-k="r2" title="How well the efforts follow the model: 1 is a perfect fit">R² ${fit.r2.toFixed(3)}</dd></div>
                </dl>
                ${ofFtp}
                <details class="mc-details"><summary>From your best efforts in the last 90 days</summary><ul class="mc-efforts">${efforts}</ul></details>`;
        } else {
            const ride = riding ? '' : ` <button type="button" class="btn btn--secondary" data-mc="ride-test">Ride the 3 + 12 min test</button>`;
            body = `<p class="mc-missing">Not enough to fit your model yet. Needed: ${esc(fit.missing)}</p>
                <p class="card__note mc-test">One trainer session gives both efforts.${ride}</p>`;
        }
        const using = eff.source === 'model' ?
            `<p class="card__note mc-using">W′bal uses the model: CP ${eff.cp} W, W′ ${kj(eff.wprime)}.${
                settings.mode === 'ask' ? ' <button type="button" class="btn btn--secondary" data-mc="unuse">Back to my settings</button>' : ''}</p>` :
            `<p class="card__note mc-using">W′bal uses your FTP (${eff.cp} W) as CP and W′ ${kj(eff.wprime)} from Settings.${
                settings.mode === 'auto' ? ' The model takes over once it can be fitted.' : ''}</p>`;
        const offer = m.offer ? `<p class="card__note pc-nudge">Your rides suggest CP ${m.offer.cp} W and W′ ${kj(m.offer.wprime)}.
            <button type="button" class="btn btn--secondary" data-mc="use">Use for W′bal</button></p>` : '';
        this.innerHTML = `${head}${body}${offer}${using}<p class="card__note">FTP is never changed by the model.</p>`;
    }
}

class ProfileCard extends ModelCardBase {
    onClick(e) {
        const b = e.target.closest('[data-table]');
        if(!b) return;
        modelSettings.set({table: b.dataset.table});
        this.render();
    }

    render() {
        if(!this.isConnected) return;
        const m = this.model, d = this._data ?? {};
        const table = modelSettings.get().table;
        const head = `<div class="pc-head"><h2 class="card__title">Power profile</h2>${
            segmented('Category table', 'table', [['men', 'Men'], ['women', 'Women']], table)}</div>`;
        if(!m) { this.innerHTML = `${head}<p class="card__note">Working out your profile…</p>`; return; }
        const p = powerProfile({meanMax: m.meanMax, ftp: d.ftp, weight: d.weight, table});
        if(p.needsWeight) {
            this.innerHTML = `${head}<p class="mc-missing">Set your weight in Settings to see your power profile in W/kg.</p>`;
            return;
        }
        const top = CATEGORIES.length;
        const rows = p.rows.map(r => `<li class="pp-row">
            <span class="pp-label">${r.label}</span>
            <span class="pp-wkg">${r.wkg === null ? '–' : `${r.wkg.toFixed(2)} W/kg`}</span>
            <span class="pp-bar" aria-hidden="true"><span style="width: ${r.score === null ? 0 : Math.round(r.score / top * 100)}%"></span></span>
            <span class="pp-cat">${r.category ?? 'No effort yet'}</span></li>`).join('');
        this.innerHTML = `${head}<ul class="pp-rows">${rows}</ul>
            ${p.sentence ? `<p class="pp-sentence">${esc(p.sentence)}</p>` : ''}
            <p class="card__note">Best efforts of the last 90 days and your FTP, at ${d.weight} kg. Categories from the CTS chart, after Allen &amp; Coggan.</p>`;
    }
}

customElements.define('model-card', ModelCard);
customElements.define('profile-card', ProfileCard);

export { ModelCard, ProfileCard };
