//
// <ride-cards>: what the ride says about the body — endurance (decoupling,
// efficiency factor), W′bal and its matches, durability, best efforts and
// time in zones. Without power only the heart-rate side shows. A match
// zooms the chart to it ('interval-zoom', bubbles).
//
//   el.data = {analysis, ftp}
//

import { esc } from '../training/format.js';

const num = x => Number.isFinite(x);
const clock = s => {
    const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const span = s => (s < 60 ? `${s} s` : `${s / 60} min`);
const kj = j => (j / 1000).toFixed(1);
const thousands = n => n.toLocaleString('en-US');
const change = (now, fresh) => (num(now) && num(fresh) && fresh > 0 ? Math.round((now / fresh - 1) * 100) : null);
const signed = x => (num(x) ? `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x)} %` : '–');
const RECORD = {all: 'Best ever', recent: 'Best in 6 weeks'};

class RideCards extends HTMLElement {
    connectedCallback() {
        if(!this.listening) {
            this.listening = true;
            this.addEventListener('click', e => {
                const b = e.target.closest('[data-zoom]');
                if(!b) return;
                const [start, end] = b.dataset.zoom.split(',').map(Number);
                this.dispatchEvent(new CustomEvent('interval-zoom', {bubbles: true, detail: {start, end}}));
            });
        }
        this.render();
    }

    set data(d) { this._data = d; this.render(); }

    card(name, title, body, note = '') {
        return `<section class="card rc-card" data-card="${name}"><h2 class="card__title">${title}</h2>${body}${note ? `<p class="card__note">${note}</p>` : ''}</section>`;
    }

    endurance(a) {
        const items = [];
        if(num(a.decoupling)) items.push(['Decoupling', `${a.decoupling.toFixed(1)}<small> %</small>`,
            a.decoupling < 5 ? 'steady: your heart rate held with your power' : 'your heart rate drifted up against your power']);
        if(num(a.ef)) items.push(['Efficiency factor', a.ef.toFixed(2), 'NP ÷ average heart rate']);
        if(num(a.avgHr)) items.push(['Average HR', `${a.avgHr}<small> bpm</small>`, '']);
        if(!items.length) return '';
        return this.card('endurance', 'Endurance', `<dl class="rc-facts">${items.map(([l, v, n]) => `<div><dt>${l}</dt><dd>${v}</dd>${n ? `<small>${esc(n)}</small>` : ''}</div>`).join('')}</dl>`,
            num(a.decoupling) ? 'Decoupling compares power per heartbeat in the second half with the first (the first 10 minutes left out).' : '');
    }

    wbal(a) {
        if(!a.wbal) return '';
        const w = a.wbal, low = w.series.reduce((m, v, t) => (num(v) && v < m.v ? {v, t} : m), {v: Infinity, t: 0});
        const matches = w.matches.length ? `<ul class="rc-matches">${w.matches.map((m, i) => `
            <li><button type="button" class="rc-match" data-zoom="${m.start},${m.end}" aria-label="Zoom the chart to match ${i + 1}">
                <span>Match ${i + 1}</span><span>${clock(m.start)}</span><strong>${kj(m.cost)}<small> kJ</small></strong></button></li>`).join('')}</ul>` :
            '<p class="card__note">No matches: no effort above FTP cost 2 kJ or more.</p>';
        return this.card('wbal', 'W′bal and matches', `
            <dl class="rc-facts">
                <div><dt>Lowest</dt><dd>${kj(w.min)}<small> kJ</small></dd><small>${Math.round(w.min / w.wprime * 100)} % of W′, at ${clock(low.t)}</small></div>
                <div><dt>Matches</dt><dd>${w.matches.length}</dd></div>
            </dl>${matches}`, `${this._data.wbalSource === 'model' ?
                `With CP ${w.cp} W and W′ ${kj(w.wprime)} kJ from the rider model.` :
                `With your FTP (${w.cp} W) as CP and W′ ${kj(w.wprime)} kJ.`} A match: an effort above CP that cost 2 kJ or more.`);
    }

    durability(a) {
        if(!a.durability?.length) return '';
        const rows = a.durability.map(d => `<tr><th scope="row">After ${thousands(d.kj)} kJ</th>
            <td>${num(d.best5) ? `${d.best5} W <small>${signed(change(d.best5, d.fresh5))}</small>` : '–'}</td>
            <td>${num(d.best20) ? `${d.best20} W <small>${signed(change(d.best20, d.fresh20))}</small>` : '–'}</td></tr>`).join('');
        return this.card('durability', 'Durability', `<table class="rc-table"><thead><tr><th></th><th scope="col">Best 5 min</th><th scope="col">Best 20 min</th></tr></thead><tbody>${rows}</tbody></table>`,
            'Your best after that much work, against your best fresh in this ride.');
    }

    bests(a) {
        if(!a.bests?.length) return '';
        return this.card('bests', 'Best efforts', `<ul class="rc-bests">${a.bests.map(b => `
            <li><span>${span(b.seconds)}</span><strong>${b.watts}<small> W</small></strong>${b.record ? `<span class="badge rc-record">${RECORD[b.record]}</span>` : ''}</li>`).join('')}</ul>`);
    }

    zones(a) {
        const block = (title, zones) => {
            const total = zones.reduce((x, z) => x + z.seconds, 0) || 1;
            return `<h3 class="rc-sub">${title}</h3><ul class="rc-zones">${zones.map((z, i) => `
                <li class="rc-zone"><span class="rc-zone__name">${esc(z.short)} ${esc(z.name)}</span>
                    <span class="rc-zone__bar"><i style="width:${(z.seconds / total * 100).toFixed(1)}%;background:${z.color ? esc(z.color) : `var(--zone-${Math.min(7, i + 2)})`}"></i></span>
                    <span class="rc-zone__time">${clock(z.seconds)}</span></li>`).join('')}</ul>`;
        };
        const parts = [];
        if(a.powerZones) parts.push(block('Power', a.powerZones));
        if(a.hrZones) parts.push(block('Heart rate', a.hrZones));
        return parts.length ? this.card('zones', 'Time in zones', parts.join('')) : '';
    }

    render() {
        if(!this._data || !this.isConnected) return;
        const a = this._data.analysis;
        this.innerHTML = [this.endurance(a), this.wbal(a), this.durability(a), this.bests(a), this.zones(a)].join('');
    }
}

customElements.define('ride-cards', RideCards);

export { RideCards };
