// @ts-check
//
// <readiness-note>: above the Ride screens, before a hard planned workout on
// a take-care or rest morning. One tap: ride it easier (take care), a
// recovery spin instead (rest), or move it to the next free day; Undo for
// 10 s. Never while riding, never for a workout picked by hand, and not
// again today after "Not now".
//
// ReadinessNote.source = {context(), actions}; set by views.js
// (src/training/readiness-source.js), replaced in tests.
//

import { xf } from '../functions.js';
import { riders } from '../riders.js';
import { isHard, easier, recoverySpin } from '../training/readiness.js';
import { esc, fmtDay } from './training/format.js';

const UNDO_MS = 10000;
const WORD = {'take-care': 'Take care', 'rest': 'Rest'};
const notNowKey = () => riders.key('readiness:notNow');

class ReadinessNote extends HTMLElement {
    static source = null;

    connectedCallback() {
        if(this.abort) return;
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.hidden = true;
        this.workout = null;
        this.watch = 'stopped';
        this.addEventListener('click', e => this.onClick(e), signal);
        xf.sub('db:workout', w => { this.workout = w; this.refresh(); }, signal);
        xf.sub('db:watchStatus', s => {
            this.watch = s;
            // riding: no note and no Undo (Undo would swap the workout mid-ride)
            if(this.riding()) { clearTimeout(this.undoTimer); this.undoing = null; this.hidden = true; this.innerHTML = ''; return; }
            this.refresh();
        }, signal);
        xf.sub('training:changed', () => this.refresh(), signal);
        xf.sub('db:page', p => { if(p === 'home') this.refresh(); }, signal);
    }

    disconnectedCallback() {
        this.abort?.abort();
        this.abort = null;
        clearTimeout(this.undoTimer);
        this.undoing = null;
        this.busy = false;
    }

    riding() { return this.watch === 'started' || this.watch === 'paused'; }

    notNow(today) {
        try { return localStorage.getItem(notNowKey()) === today; } catch(e) { return false; }
    }

    async refresh() {
        if(this.undoing) return;                     // the Undo line stays its 10 s
        const src = ReadinessNote.source;
        if(!src) return;
        const c = await src.context().catch(() => null);
        if(this.undoing || this.busy) return;        // a change happened meanwhile: its Undo line stays
        this.c = c;
        const e = c?.entry;
        const show = !!e && this.watch !== 'started' && this.watch !== 'paused' &&
              (c.verdict?.state === 'take-care' || c.verdict?.state === 'rest') &&
              !this.notNow(c.today) &&
              this.workout && e.workout && String(this.workout.id) === String(e.workout.id) &&
              isHard(e.workout, c.ftp);
        if(!show) { this.hidden = true; this.innerHTML = ''; return; }
        const state = c.verdict.state;
        const name = e.workout.meta?.name ?? 'This workout';
        this.innerHTML = `
            <div class="rn" data-state="${state}" role="status">
                <p class="rn-text"><strong>${WORD[state]}.</strong> ${esc(c.verdict.reasons?.[0] ?? '')} — and ${esc(name)} is hard.</p>
                <div class="rn-actions">
                    ${state === 'take-care' ? '<button type="button" class="btn btn--primary" data-rn="easier">Ride it easier</button>' : ''}
                    ${state === 'rest' ? '<button type="button" class="btn btn--primary" data-rn="recovery">Recovery spin instead</button>' : ''}
                    ${c.nextFree ? `<button type="button" class="btn btn--secondary" data-rn="move">Move to ${esc(fmtDay(c.nextFree, {weekday: 'short', day: 'numeric', month: 'short'}))}</button>` : ''}
                    <button type="button" class="btn btn--secondary" data-rn="later">Not now</button>
                </div>
            </div>`;
        this.hidden = false;
    }

    // after a change: what happened, and Undo for 10 s
    showUndo(text, undo) {
        clearTimeout(this.undoTimer);
        this.undoing = undo;
        this.innerHTML = `<div class="rn rn--done" role="status"><p class="rn-text">${esc(text)}</p>
            <div class="rn-actions"><button type="button" class="btn btn--secondary" data-rn="undo">Undo</button></div></div>`;
        this.hidden = false;
        this.undoTimer = setTimeout(() => { this.undoing = null; this.refresh(); }, UNDO_MS);
    }

    async onClick(ev) {
        const b = ev.target.closest('[data-rn]');
        if(!b || !ReadinessNote.source || this.busy || this.riding()) return;      // one change at a time, never while riding
        const {actions} = ReadinessNote.source;
        const c = this.c, e = c?.entry;
        const what = b.dataset.rn;
        if(what === 'undo') {
            const undo = this.undoing;
            clearTimeout(this.undoTimer);
            this.undoing = null;
            this.hidden = true;
            await undo?.();
            this.refresh();
            return;
        }
        if(what === 'later') {
            try { localStorage.setItem(notNowKey(), c.today); } catch(err) {}
            this.hidden = true;
            this.innerHTML = '';
            return;
        }
        if(!e) return;
        this.busy = true;                           // refreshes from the change itself wait
        try {
            await this.change(what, c, e, actions);
        } finally {
            this.busy = false;
        }
    }

    async change(what, c, e, actions) {
        if(what === 'easier' || what === 'recovery') {
            const workout = what === 'easier' ? easier(e.workout, c.ftp) : recoverySpin();
            await actions.replacePlanWorkout(e.id, workout);
            await actions.rideWorkout(e.id);
            this.showUndo(`Changed to ${workout.meta.name}.`, async () => {
                await actions.restorePlanWorkout(e.id);
                await actions.rideWorkout(e.id);
            });
        } else if(what === 'move' && c.nextFree) {
            await actions.movePlanEntry(e.id, c.nextFree);
            this.showUndo(`Moved to ${fmtDay(c.nextFree, {weekday: 'long', day: 'numeric', month: 'long'})}.`, async () => {
                await actions.movePlanEntry(e.id, c.today);
            });
        }
    }
}

customElements.define('readiness-note', ReadinessNote);

export { ReadinessNote };
