//
// <ride-page>: one ride, analysed (page `analysis`, link `#ride=<id>`).
// The summary shows at once; the ride's file follows (this device, or the
// account server for Garmin and intervals.icu rides). Back returns to the
// page the ride was opened from.
//
//   openRide(id, from)   from: 'training' (default) or 'workouts'
//

import { xf } from '../../functions.js';
import { analyseRide } from '../../analysis/ride.js';
import { esc, fmtDuration, fmtDay, sportLabelFor } from '../training/format.js';
import { openRide, rideFromHash } from './open-ride.js';
import './ride-chart.js';
import './ride-insights.js';
import './interval-table.js';
import './ride-cards.js';

const SOURCES = {garmin: 'Garmin', intervals: 'intervals.icu', fit: 'Imported .fit'};
const sourceOf = s => SOURCES[s?.source] ?? (String(s?.id ?? '').startsWith('garmin-') ? 'Garmin' : String(s?.id ?? '').startsWith('icu-') ? 'intervals.icu' : 'Soigneur');

function problemText(reason, summary) {
    const from = sourceOf(summary);
    return ({
        'not-connected': `This ride comes from ${from}, which is no longer connected to your account. Connect it again in the rider menu to analyse the ride.`,
        'strava': 'intervals.icu doesn\'t hand out rides that came from Strava, so this one can\'t be analysed here.',
        'refused': `${from} refused to send this ride. Try again later.`,
        'unreadable': 'The ride\'s file couldn\'t be read.',
        'not-found': `${from} no longer has this ride.`,
        'no-account': 'Sign in to your account to analyse rides from Garmin or intervals.icu.',
        'offline': 'The account server can\'t be reached right now.',
    })[reason] ?? 'The ride couldn\'t be loaded.';
}

let lastFrom = 'training';

class RidePage extends HTMLElement {
    static source = null;          // set by views.js (ride-source.js); replaced in tests

    connectedCallback() {
        if(this.abort) return;
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.addEventListener('click', e => { if(e.target.closest('[data-rp-back]')) this.back(); }, signal);
        window.addEventListener('ride:open', e => { this.from = e.detail.from; this.open(e.detail.id); }, signal);
        window.addEventListener('hashchange', () => this.fromHash(), signal);
        window.addEventListener('popstate', () => this.fromHash(), signal);
        xf.sub('db:page', page => {
            // the app remembers its page: back on this one with no ride in the link → Training
            if(page === 'analysis' && !rideFromHash()) setTimeout(() => { if(!rideFromHash()) xf.dispatch('ui:page-set', 'training'); }, 0);
            // left by a tab: the ride goes from the link (a reload doesn't reopen it)
            if(page !== 'analysis' && rideFromHash()) {
                this.showing = false;
                this.rideId = null;
                history.replaceState(null, '', location.pathname + location.search);
            }
        }, signal);
        this.innerHTML = '';
        setTimeout(() => this.fromHash(), 0);          // the app opened with a ride's link
    }

    disconnectedCallback() {
        this.abort?.abort();
        this.abort = null;
    }

    fromHash() {
        const id = rideFromHash();
        // Back (the browser's or the phone's) took the ride out of the link
        if(!id) {
            if(this.showing) { this.showing = false; this.rideId = null; xf.dispatch('ui:page-set', this.from ?? lastFrom ?? 'training'); }
            return;
        }
        if(id === this.rideId) return;
        xf.dispatch('ui:page-set', 'analysis');
        this.open(id);
    }

    back() {
        const to = this.from ?? lastFrom ?? 'training';
        this.rideId = null;
        this.showing = false;
        history.replaceState(null, '', location.pathname + location.search);
        xf.dispatch('ui:page-set', to);
    }

    async open(id) {
        const src = RidePage.source;
        this.rideId = id;
        this.showing = true;
        const token = this.token = Symbol();
        const summary = src ? await src.summary(id) : null;
        if(token !== this.token) return;
        if(!summary) { this.renderNotFound(); return; }
        this.summary = summary;
        this.renderShell(summary);
        try {
            const [got, context] = await Promise.all([src.ride(id), src.context(summary)]);
            if(token !== this.token) return;
            if(!got.ride) { this.renderProblem(problemText(got.reason, summary)); return; }
            const ride = got.ride;
            // the FTP the ride was ridden with (kept in its summary), else today's
            context.ftp = summary.ftp > 0 ? summary.ftp : context.ftp;
            const analysis = analyseRide({
                samples: ride.samples, pauses: ride.pauses ?? [], laps: ride.laps ?? [], workout: context.workout,
                ftp: context.ftp, weight: context.weight, wprime: context.wprime, cp: context.cp ?? null, lthr: context.lthr,
                summaries: context.summaries, day: summary.day, id,
            });
            this.ride = ride; this.analysis = analysis; this.context = context;
            this.renderRide();
        } catch(e) {
            console.error(':ride-page', e);
            if(token === this.token) this.renderProblem('Something went wrong while analysing this ride.');
        }
    }

    // --- rendering ---

    header(s) {
        const fact = (label, value) => (value === null || value === undefined || value === '' ? '' : `<div><dt>${label}</dt><dd>${value}</dd></div>`);
        const when = s.start ? new Date(s.start).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'}) : '';
        const km = Number.isFinite(s.distance) && s.distance > 0 ? `${(s.distance / 1000).toFixed(1)}<small> km</small>` : null;
        return `
            <div class="rp-head">
                <button type="button" class="btn btn--icon rp-back" data-rp-back aria-label="Back">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>
                </button>
                <div class="rp-titles">
                    <h1 class="rp-title">${esc(s.name ?? 'Ride')}</h1>
                    <p class="rp-sub">${esc(fmtDay(s.day, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}))}${when ? ` · ${esc(when)}` : ''}
                        · ${esc(sportLabelFor(s) || 'Ride')} <span class="badge rp-source">${esc(sourceOf(s))}</span></p>
                </div>
            </div>
            <dl class="rp-facts">
                ${fact('Time', esc(fmtDuration(s.duration ?? 0)))}
                ${fact('Distance', km)}
                ${fact('TSS', Number.isFinite(s.tss) ? Math.round(s.tss) : null)}
                ${fact('IF', Number.isFinite(s.if) ? s.if.toFixed(2) : null)}
                ${fact('NP', Number.isFinite(s.np) ? `${Math.round(s.np)}<small> W</small>` : null)}
                ${fact('Avg HR', Number.isFinite(s.avgHr) ? `${Math.round(s.avgHr)}<small> bpm</small>` : null)}
            </dl>`;
    }

    renderNotFound() {
        this.innerHTML = `<div class="rp">
            <div class="rp-head"><button type="button" class="btn btn--icon rp-back" data-rp-back aria-label="Back">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg></button>
                <h1 class="rp-title">Ride not found</h1></div>
            <p class="card__note">This ride isn't on this device or in your account (any more).</p>
            <button type="button" class="btn btn--secondary" data-rp-back>Back</button></div>`;
    }

    renderShell(s) {
        this.innerHTML = `<div class="rp">${this.header(s)}
            <div class="rp-body"><p class="card__note rp-loading">Reading the ride…</p></div></div>`;
    }

    renderProblem(text) {
        this.querySelector('.rp-body').innerHTML = `<p class="rp-problem card">${esc(text)}</p>`;
    }

    renderRide() {
        const a = this.analysis;
        const workout = this.context.workout?.name ? `<p class="card__note rp-workout">Planned: ${esc(this.context.workout.name)}</p>` : '';
        this.querySelector('.rp-body').innerHTML = `
            ${workout}
            <section class="card rp-chart"><ride-chart></ride-chart></section>
            <section class="rp-intervals"></section>
            <ride-insights class="rp-insights"></ride-insights>
            <section class="rp-cards"></section>`;
        this.$chart = this.querySelector('ride-chart');
        this.$chart.data = {samples: this.ride.samples, analysis: a, ftp: this.context.ftp};
        const table = document.createElement('interval-table');
        this.querySelector('.rp-intervals').append(table);
        table.data = {analysis: a, ftp: this.context.ftp};
        table.addEventListener('interval-zoom', e => this.$chart.zoomTo(e.detail.start, e.detail.end));
        this.querySelector('ride-insights').data = {samples: this.ride.samples, pauses: this.ride.pauses ?? [], analysis: a,
            ftp: this.context.ftp, summaries: this.context.summaries ?? [], day: this.summary.day, id: this.rideId};
        const cards = document.createElement('ride-cards');
        this.querySelector('.rp-cards').append(cards);
        cards.data = {analysis: a, ftp: this.context.ftp, wbalSource: this.context.wbalSource};
        cards.addEventListener('interval-zoom', e => this.$chart.zoomTo(e.detail.start, e.detail.end));
        this.dispatchEvent(new CustomEvent('ride-analysed', {detail: {analysis: a}}));
    }
}

customElements.define('ride-page', RidePage);

export { RidePage, openRide, problemText };
