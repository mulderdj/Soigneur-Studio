// @ts-check
//
// <test-result>: the result of a built-in test, on the Ride page, when the
// test ends or is stopped after its first effort. One-tap offers; Close
// keeps everything as it was.
//
// open({test, result, ftp, current, fit, mode, weight})
//   current  what W′bal uses now {cp, wprime, source}
//   fit      the 90-day model ({ok, cp, wprime} or {ok: false})
//   mode     the rider model's mode ('ask' | 'auto')
// TestResult.actions = {useModel({cp, wprime}, mode), useFtp(ftp)}; tests swap it.
//

import { xf } from '../functions.js';
import { modelSettings } from '../training/rider-model-settings.js';
import { esc } from './training/format.js';

const NAMES = {'3-12': '3 + 12 min Test', 'ramp': 'Ramp Test', '20min': '20 min Test', '2x8': '2 × 8 min Test', 'sprint': 'Sprint Test'};
const kj = j => `${(j / 1000).toFixed(1)} kJ`;
const signed = n => n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0';
const row = (label, value, k) => `<div><dt>${esc(label)}</dt><dd${k ? ` data-k="${k}"` : ''}>${esc(value)}</dd></div>`;

const defaultActions = {
    useModel({cp, wprime}, mode) {
        // in Automatically the model wins over `use`: switch to Ask me so this test is what W′bal uses
        modelSettings.set(mode === 'auto' ? {use: {cp, wprime}, mode: 'ask'} : {use: {cp, wprime}});
    },
    useFtp(ftp) { xf.dispatch('ui:ftp-set', ftp); },
};

class TestResult extends HTMLElement {
    static actions = defaultActions;

    connectedCallback() {
        if(this.$dialog) return;
        this.innerHTML = `<dialog class="dialog test-result" aria-label="Test result"></dialog>`;
        this.$dialog = this.querySelector('dialog');
        this.$dialog.addEventListener('click', e => this.onClick(e));
    }
    open(ctx) {
        this.connectedCallback();
        this.ctx = ctx;
        this.done = null;
        this.render();
        if(typeof this.$dialog.showModal === 'function' && !this.$dialog.open) this.$dialog.showModal();
        else this.$dialog.setAttribute('open', '');
    }
    close() {
        if(typeof this.$dialog?.close === 'function') this.$dialog.close();
        this.$dialog?.removeAttribute('open');
    }
    onClick(e) {
        const b = e.target.closest('[data-tr]');
        if(!b) return;
        const {test, result, mode} = this.ctx;
        const v = result.values ?? {};
        if(b.dataset.tr === 'close') return this.close();
        if(b.dataset.tr === 'use-model') {
            TestResult.actions.useModel({cp: v.cp, wprime: v.wprime}, mode);
            this.done = 'W′bal now uses this CP and W′.';
        }
        if(b.dataset.tr === 'use-ftp') {
            TestResult.actions.useFtp(v.ftp);
            this.done = `Your FTP is now ${v.ftp} W.`;
        }
        this.render();
    }
    body() {
        const {test, result, ftp, current, fit, mode} = this.ctx;
        const v = result.values ?? {};
        if(!result.ok) {
            const efforts = test === '3-12' && v.p3 ? `<dl class="tr-values">${row('3 min', `${v.p3} W`)}${row('12 min', `${v.p12} W`)}</dl>` : '';
            return `<p class="tr-reason" data-k="reason">${esc(result.reason)}</p>${efforts}
                <p class="tr-note">Nothing was changed. The ride is saved as usual.</p>`;
        }
        if(test === '3-12') {
            const now = current ? `${current.cp} W · ${kj(current.wprime)} (${current.source === 'model' ? 'from a model' : 'your settings'})` : '—';
            const model = fit?.ok ? `${fit.cp} W · ${kj(fit.wprime)}` : 'not enough efforts yet';
            const same = current && current.cp === v.cp && current.wprime === v.wprime;
            const offer = this.done || same ? '' :
                `<button type="button" class="btn btn--primary" data-tr="use-model">Use for W′bal${mode === 'auto' ? ' (switches to Ask me)' : ''}</button>`;
            return `<dl class="tr-values tr-main">${row('CP', `${v.cp} W`, 'cp')}${row('W′', kj(v.wprime), 'wprime')}</dl>
                <dl class="tr-values">${row('3 min', `${v.p3} W`)}${row('12 min', `${v.p12} W`)}
                ${row('W′bal uses now', now)}${row('90-day model', model)}</dl>${offer}`;
        }
        if(test === 'sprint') {
            const wkg = v.peakWkg !== undefined ?
                  `<dl class="tr-values">${row('Peak', `${v.peakWkg} W/kg`, 'peak-wkg')}${row('Best 5 s', `${v.best5Wkg} W/kg`, 'best5-wkg')}</dl>` : '';
            return `<dl class="tr-values tr-main">${row('Peak', `${v.peak} W`, 'peak')}${row('Best 5 s', `${v.best5} W`, 'best5')}</dl>${wkg}
                <p class="tr-note">From ${v.sprints} sprint${v.sprints === 1 ? '' : 's'}.${v.peakWkg === undefined ? ' Set your weight in Settings to see W/kg.' : ''}</p>`;
        }
        const detail = test === 'ramp' ? row('Best minute', `${v.best60} W`) :
                       test === '20min' ? row('20 min', `${v.p20} W`) :
                       `${row('8 min, first', `${v.p8a} W`)}${row('8 min, second', `${v.p8b} W`)}`;
        const diff = ftp > 0 ? `${ftp} W (${signed(v.ftp - ftp)} W)` : '—';
        const offer = this.done || v.ftp === ftp ? '' : `<button type="button" class="btn btn--primary" data-tr="use-ftp">Use as FTP</button>`;
        return `<dl class="tr-values tr-main">${row('FTP', `${v.ftp} W`, 'ftp')}</dl>
            <dl class="tr-values">${detail}${row('Your FTP now', diff)}</dl>${offer}`;
    }
    render() {
        const {test, result} = this.ctx;
        this.$dialog.innerHTML = `
            <h2 class="card__title">${esc(NAMES[test] ?? 'Test')}${result.ok ? '' : ': no result'}</h2>
            ${this.body()}
            ${this.done ? `<p class="tr-done" role="status">${esc(this.done)}</p>` : ''}
            <div class="tr-actions"><button type="button" class="btn btn--secondary" data-tr="close">Close</button></div>`;
    }
}

customElements.define('test-result', TestResult);

export { TestResult };
