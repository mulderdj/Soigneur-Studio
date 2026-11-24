//
// <interval-table>: a ride's intervals — from the workout's steps, the
// file's laps, or found from power — with their numbers; for a workout also
// planned against actual. A row's first cell zooms the chart to it
// ('interval-zoom' {start, end}, bubbles). On a phone the rows become cards.
//
//   el.data = {analysis, ftp}
//

import { esc } from '../training/format.js';

const SOURCE = {
    workout: 'From the workout\'s steps.',
    laps: 'From the laps in the ride\'s file.',
    detected: 'Found from your power: 30 s or more at 88 % of FTP or above.',
};
const STATUS = {'done': 'Done', 'cut-short': 'Cut short', 'skipped': 'Skipped'};
const num = x => Number.isFinite(x);
const w = x => (num(x) ? `${Math.round(x)}` : '–');
const pct = x => (num(x) ? `${Math.round(x * 100)} %` : '–');
const signed = (x, unit = '') => {
    if(!num(x)) return '–';
    const r = Math.round(x);
    return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}${unit}`;
};
// 4:00, 1:02:30
const clock = s => {
    if(!num(s)) return '–';
    const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

class IntervalTable extends HTMLElement {
    connectedCallback() {
        if(this.listening) return;
        this.listening = true;
        this.addEventListener('click', e => {
            const b = e.target.closest('[data-zoom]');
            if(!b) return;
            const [start, end] = b.dataset.zoom.split(',').map(Number);
            this.dispatchEvent(new CustomEvent('interval-zoom', {bubbles: true, detail: {start, end}}));
        });
        this.render();
    }

    set data(d) { this._data = d; this.render(); }

    label(iv) {
        if(iv.kind === 'work') return `Rep ${iv.rep}`;
        if(iv.kind === 'lap') return `Lap ${iv.lap}`;
        return 'Rest';
    }

    render() {
        if(!this._data || !this.isConnected) return;
        const {analysis} = this._data;
        const list = analysis.intervals ?? [];
        if(!list.length) {
            this.innerHTML = `<div class="card it"><h2 class="card__title">Intervals</h2>
                <p class="card__note">${analysis.hasPower ?
                    'No intervals in this ride: no workout, no laps, and no efforts of 30 s or more at 88 % of FTP.' :
                    'No intervals in this ride: no workout or laps, and no power to find efforts from.'}</p></div>`;
            return;
        }
        const planned = analysis.intervalSource === 'workout';
        const reps = new Map((analysis.reps ?? []).map(r => [r.rep, r]));
        const power = analysis.hasPower;
        const head = [
            '<th scope="col">Interval</th>', '<th scope="col">Time</th>',
            ...(power ? ['<th scope="col">Avg W</th>', '<th scope="col">NP</th>', '<th scope="col">% FTP</th>'] : []),
            ...(planned && power ? ['<th scope="col">Target</th>', '<th scope="col">± target</th>', '<th scope="col">On target</th>', '<th scope="col">Status</th>'] : []),
            ...(power ? ['<th scope="col">Fade</th>'] : []),
            '<th scope="col">HR</th>', '<th scope="col">HR drift</th>', '<th scope="col">Cadence</th>',
        ].join('');
        const rows = list.map((iv, i) => {
            const s = iv.stats;
            const rep = iv.kind === 'work' ? reps.get(iv.rep) : null;
            const status = rep ? rep.status : null;
            const cells = [
                iv.start === null ? `<th scope="row" class="it-name">${esc(this.label(iv))}</th>` :
                    `<th scope="row" class="it-name"><button type="button" class="it-zoom" data-zoom="${iv.start},${iv.end}"
                        aria-label="Zoom the chart to ${esc(this.label(iv))}">${esc(this.label(iv))}</button></th>`,
                `<td data-l="Time">${clock(s ? s.duration : iv.planned)}</td>`,
                ...(power ? [`<td data-l="Avg W">${w(s?.avgPower)}</td>`, `<td data-l="NP">${w(s?.np)}</td>`, `<td data-l="% FTP">${num(s?.pctFtp) ? Math.round(s.pctFtp) : '–'}</td>`] : []),
                ...(planned && power ? [
                    `<td data-l="Target">${w(iv.target)}</td>`,
                    `<td data-l="± target">${rep ? signed(rep.diffW, ' W') : '–'}</td>`,
                    `<td data-l="On target">${pct(s?.onTarget)}</td>`,
                    `<td data-l="Status">${status ? `<span class="badge it-status" data-status="${status}">${STATUS[status]}</span>` : ''}</td>`,
                ] : []),
                ...(power ? [`<td data-l="Fade">${num(s?.fade) ? signed(s.fade * 100, ' %') : '–'}</td>`] : []),
                `<td data-l="HR">${num(s?.avgHr) ? `${s.avgHr}${num(s.maxHr) ? `<small> / ${s.maxHr}</small>` : ''}` : '–'}</td>`,
                `<td data-l="HR drift">${num(s?.hrDrift) ? signed(s.hrDrift) : '–'}</td>`,
                `<td data-l="Cadence">${w(s?.avgCadence)}</td>`,
            ];
            return `<tr class="it-row${iv.kind === 'work' ? ' is-work' : ''}${iv.kind === 'rest' ? ' is-rest' : ''}" data-iv="${i}">${cells.join('')}</tr>`;
        }).join('');
        this.innerHTML = `<div class="card it">
            <h2 class="card__title">Intervals</h2>
            <p class="card__note it-source">${esc(SOURCE[analysis.intervalSource] ?? '')} Tap an interval to zoom the chart to it.</p>
            <div class="it-scroll"><table class="it-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
        </div>`;
    }
}

customElements.define('interval-table', IntervalTable);

export { IntervalTable };
