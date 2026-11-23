//
// <training-page>: the Training page. Loads ride summaries and the plan,
// fills in old rides the first time the page is opened (backfill), and
// hands the data to the cards.
//

import { xf } from '../../functions.js';
import { history } from '../../training/history.js';
import { today } from '../../training/dates.js';
import { countable } from '../../training/merge.js';
import { importFitFiles, importMessage } from '../../training/fit-import.js';
import './calendar.js';
import './day-dialog.js';
import './form-card.js';
import './week-card.js';
import './health-card.js';
import './hr-thresholds.js';
import './progress-cards.js';

class TrainingPage extends HTMLElement {
    connectedCallback() {
        this.state = {ftp: 250, weight: 75, workouts: []};
        this.innerHTML = `
            <div class="tp-tools">
                <button type="button" class="btn" data-import-fit>Import .fit files</button>
                <input type="file" class="tp-file" accept=".fit,application/vnd.ant.fit" multiple hidden>
            </div>
            <p class="tp-status card__note" hidden></p>
            <div class="tp-empty empty" hidden>
                <h2 class="empty__title">No rides yet</h2>
                <p>Ride with Auuki and your rides, plan, form and progress show up here.
                   Signed in? Rides saved to your account appear too.</p>
            </div>
            <div class="training">
                <form-card class="card tp-form"></form-card>
                <week-card class="card tp-week"></week-card>
                <health-card class="card tp-health" hidden></health-card>
                <training-calendar class="card tp-calendar"></training-calendar>
                <volume-card class="card"></volume-card>
                <curve-card class="card"></curve-card>
                <zones-card class="card"></zones-card>
                <ftp-card class="card"></ftp-card>
            </div>
            <day-dialog></day-dialog>`;
        this.$status = this.querySelector('.tp-status');
        this.$empty = this.querySelector('.tp-empty');
        this.$dialog = this.querySelector('day-dialog');
        this.$file = this.querySelector('.tp-file');
        this.querySelector('[data-import-fit]').addEventListener('click', () => this.$file.click());
        this.$file.addEventListener('change', () => this.importFiles());

        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        xf.sub('db:ftp', x => { this.state.ftp = x; this.refresh(); }, signal);
        xf.sub('db:weight', x => { this.state.weight = x; }, signal);
        xf.sub('db:workouts', x => { this.state.workouts = x ?? []; }, signal);
        xf.sub('training:changed', () => this.refresh(), signal);
        xf.sub('db:page', page => { if(page === 'training') this.onShow(); }, signal);
        xf.sub('activity:restore', () => this.refresh(), signal);
        this.addEventListener('day-open', e => this.$dialog.open(e.detail.day, this.data()), signal);
    }

    disconnectedCallback() {
        this.abort?.abort();
    }

    // the cards and the calendar count only rides that aren't hidden; the
    // day dialog lists every ride (allSummaries) so a hidden one can be shown
    data() {
        const all = this.state.summaries ?? [];
        return {...this.state, summaries: countable(all), allSummaries: all, today: today()};
    }

    async onShow() {
        await this.refresh();
        if(this.backfilled) return;
        this.backfilled = true;
        try {
            const result = await history.backfill({
                ftp: this.state.ftp, weight: this.state.weight,
                onProgress: ({done, total}) => {
                    if(total === 0) return;
                    this.$status.hidden = done >= total;
                    this.$status.textContent = `Reading ${done} of ${total} rides…`;
                },
            });
            if(result.skipped.length) {
                this.$status.hidden = false;
                this.$status.textContent = `${result.skipped.length} ride${result.skipped.length === 1 ? '' : 's'} could not be read and ${result.skipped.length === 1 ? 'is' : 'are'} left out.`;
            }
        } catch(e) {
            console.warn(':training :backfill', e);
        }
        this.refresh();
    }

    // rides from other devices or apps (e.g. a Garmin export), as .fit files
    async importFiles() {
        const files = [...(this.$file.files ?? [])];
        this.$file.value = '';
        if(files.length === 0) return;
        this.$status.hidden = false;
        this.$status.textContent = `Reading ${files.length} file${files.length === 1 ? '' : 's'}…`;
        try {
            const result = await importFitFiles(files, {ftp: this.state.ftp, weight: this.state.weight});
            this.$status.textContent = importMessage(result);
        } catch(e) {
            console.warn(':training :import', e);
            this.$status.textContent = 'The files could not be imported.';
        }
        this.refresh();
    }

    async refresh() {
        try {
            this.state.summaries = await history.summaries();
            this.state.plan = await history.planEntries();
            this.state.wellness = await history.wellnessDays();
        } catch(e) {
            return; // database not open yet
        }
        const d = this.data();
        const empty = d.allSummaries.length === 0 && d.plan.length === 0;
        this.$empty.hidden = !empty;
        for(const el of this.querySelectorAll('.training > *')) el.data = d;
    }
}

customElements.define('training-page', TrainingPage);

export { TrainingPage };
