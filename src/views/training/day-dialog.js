//
// <day-dialog>: one day of the calendar. Its rides, its plan entries (move
// to another day, remove) and "Plan a workout" from the library. A ride can
// be hidden ("Hide this ride", e.g. a duplicate) and shown again; hidden
// rides stay listed here, greyed, and count nowhere else.
//
// open(day, data) with data = {today, summaries, plan, workouts};
// `actions` defaults to the training history (tests swap it).
//

import { history } from '../../training/history.js';
import { planStatus, plannedTss } from '../../training/plan.js';
import { esc, fmtDuration, fmtDay, fmtTss, sportLabelFor, loadTag, loadTitle } from './format.js';
import { intervalsToGraph } from '../workout-graph.js';

const GRAPH_HEIGHT = 48;
const minutes = (s) => `${Math.round(s / 60)} min`;
const workoutSeconds = (w) => (w?.intervals ?? []).reduce((a, i) => a + (Number(i.duration) || 0), 0);

// a ride's time in each power zone as one thin bar (rides with power only)
function zoneBar(r) {
    const zones = (r.zoneSeconds ?? []).map((s, i) => ({zone: i + 1, s: Number(s) || 0})).filter(z => z.s > 0);
    if(zones.length === 0) return '';
    const label = 'Time in zones: ' + zones.map(z => `Z${z.zone} ${minutes(z.s)}`).join(', ');
    return `<div class="dd-zones" role="img" aria-label="${esc(label)}" title="${esc(label)}">${
        zones.map(z => `<span class="dd-zone" data-zone="${z.zone}" style="flex-grow: ${z.s}"></span>`).join('')}</div>`;
}

// "How hard was it?" 1–10, for a workout without power or heart rate
function rating(r) {
    const buttons = Array.from({length: 10}, (_, i) => i + 1).map(n =>
        `<button type="button" class="dd-rpe" data-rate="${esc(r.id)}" data-rpe="${n}" aria-pressed="${r.rating === n}" aria-label="${n} out of 10">${n}</button>`).join('');
    return `<div class="dd-rating" role="group" aria-label="How hard was ${esc(r.name)}?">
                <span class="dd-rating__label">How hard was it?</span><span class="dd-rating__scale">${buttons}</span>
                <small class="dd-rating__hint">1 very easy · 5 steady · 10 all-out</small>
            </div>`;
}

class DayDialog extends HTMLElement {
    constructor() {
        super();
        this.actions = history;
    }

    connectedCallback() {
        this.innerHTML = `<dialog class="dialog day-dialog" aria-label="Day"></dialog>`;
        this.$dialog = this.querySelector('dialog');
        this.$dialog.addEventListener('click', e => this.onClick(e));
        this.$dialog.addEventListener('change', e => this.onChange(e));
        this.$dialog.addEventListener('input', e => {
            if(e.target.matches('input[type=search]')) this.renderLibrary(e.target.value);
        });
    }

    open(day, data) {
        this.day = day;
        this.data = data;
        this.render();
        if(typeof this.$dialog.showModal === 'function' && !this.$dialog.open) this.$dialog.showModal();
        else this.$dialog.setAttribute('open', '');
        this.fillGraphs(); // after opening: the profiles take the dialog's width
    }

    // planned workouts: the same profile as in the Workouts list
    fillGraphs() {
        const plan = this.data?.plan ?? [];
        for(const el of this.$dialog.querySelectorAll('.dd-graph[data-graph]')) {
            const entry = plan.find(e => String(e.id) === el.dataset.graph);
            if(!entry?.workout) continue;
            const w = entry.workout;
            const workout = {...w, meta: {...w.meta, duration: w.meta?.duration || workoutSeconds(w)}};
            el.innerHTML = intervalsToGraph(workout, this.data.ftp || 250, {width: el.clientWidth || 320, height: GRAPH_HEIGHT});
        }
    }

    close() {
        if(typeof this.$dialog.close === 'function') this.$dialog.close();
        this.$dialog.removeAttribute('open');
    }

    async onClick(e) {
        const pick = e.target.closest('.dd-pick');
        if(pick) {
            const workout = (this.data.workouts ?? []).find(w => String(w.id) === pick.dataset.id);
            if(workout) { await this.actions.addPlanEntry(this.day, workout); this.close(); }
            return;
        }
        const ride = e.target.closest('[data-ride]');
        if(ride) { this.actions.rideWorkout(ride.dataset.ride); this.close(); return; }
        const rate = e.target.closest('[data-rate]');
        if(rate) {
            const rpe = Number(rate.dataset.rpe);
            const ride = (this.data.allSummaries ?? this.data.summaries ?? []).find(s => s.id === rate.dataset.rate);
            this.actions.rateRide(rate.dataset.rate, ride?.rating === rpe ? null : rpe); // the same again takes it away
            this.close();
            return;
        }
        const hide = e.target.closest('[data-hide]');
        if(hide) { this.actions.hideRide(hide.dataset.hide); this.close(); return; }
        const show = e.target.closest('[data-show]');
        if(show) { this.actions.showRide(show.dataset.show); this.close(); return; }
        const remove = e.target.closest('[data-remove]');
        if(remove) { this.actions.removePlanEntry(remove.dataset.remove); this.close(); return; }
        if(e.target.closest('[data-close]')) this.close();
    }

    onChange(e) {
        const move = e.target.closest('input[data-move]');
        if(move && move.value) { this.actions.movePlanEntry(move.dataset.move, move.value); this.close(); }
    }

    render() {
        const {summaries = [], allSummaries, plan = [], today} = this.data;
        const rides = (allSummaries ?? summaries).filter(s => s.day === this.day);
        const entries = plan.filter(e => !e.deleted && e.day === this.day);
        this.$dialog.innerHTML = `
            <div class="dd-head">
                <h2 class="card__title">${esc(fmtDay(this.day, {weekday: 'long', day: 'numeric', month: 'long'}))}</h2>
                <button type="button" class="btn btn--icon" data-close aria-label="Close">×</button>
            </div>
            ${rides.length ? `<h3 class="dd-sub">Rides</h3><ul class="dd-list">${rides.map(r => `
                <li class="list-row dd-ride${r.hidden ? ' is-hidden' : ''}"><div class="list-row__main"><div class="list-row__title">${esc(r.name)}</div>
                    <div class="list-row__meta">${sportLabelFor(r) ? `${esc(sportLabelFor(r))} · ` : ''}${fmtDuration(r.duration)} · ${fmtTss(r.tss)} TSS${loadTag(r.loadSource) ? ` <span class="badge cal-load" title="${esc(loadTitle(r.loadSource))}">${loadTag(r.loadSource)}</span>` : ''}${Number.isFinite(r.np) ? ` · NP ${Math.round(r.np)} W` : ''}${r.hidden ? ' · hidden' : ''}</div>${zoneBar(r)}</div>
                    ${r.hidden ?
                      `<button type="button" class="btn" data-show="${esc(r.id)}">Show</button>` :
                      `<button type="button" class="btn" data-hide="${esc(r.id)}">Hide this ride</button>`}
                    ${r.loadSource === 'rpe' || r.loadSource === 'estimate' ? rating(r) : ''}</li>`).join('')}</ul>` : ''}
            ${entries.length ? `<h3 class="dd-sub">Planned</h3><ul class="dd-list">${entries.map(e => `
                <li class="list-row"><div class="list-row__main"><div class="list-row__title">${esc(e.workout?.meta?.name ?? e.name ?? 'Workout')}</div>
                    <div class="list-row__meta"><span class="badge">${planStatus(e, today)}</span>
                        ${e.workout ? `${Math.round(plannedTss(e.workout, this.data.ftp))} TSS` : 'The workout from intervals.icu could not be read, so it can\'t be ridden here.'}
                        ${e.origin === 'intervals' ? '<span class="badge badge-icu">intervals.icu</span>' : ''}</div>
                    ${e.workout?.intervals?.length ? `<div class="dd-graph workout-list--graph-cont" data-graph="${esc(e.id)}" role="img"
                        aria-label="${esc(`Workout profile, ${minutes(workoutSeconds(e.workout))}`)}"></div>` : ''}</div>
                    <label class="field dd-move">Move to<input type="date" class="input" data-move="${esc(e.id)}" value="${esc(e.day)}"></label>
                    ${e.workout && !e.rideId ? `<button type="button" class="btn btn--primary" data-ride="${esc(e.id)}">Ride this workout</button>` : ''}
                    <button type="button" class="btn btn--danger" data-remove="${esc(e.id)}">Remove</button></li>`).join('')}</ul>` : ''}
            <h3 class="dd-sub">Plan a workout</h3>
            <input type="search" class="input dd-search" placeholder="Search your workouts" aria-label="Search your workouts">
            <ul class="dd-library"></ul>`;
        this.renderLibrary('');
    }

    renderLibrary(query) {
        const q = query.trim().toLowerCase();
        const list = (this.data.workouts ?? [])
            .filter(w => !q || `${w.meta?.name ?? ''} ${w.meta?.category ?? ''}`.toLowerCase().includes(q))
            .slice(0, 50);
        this.$dialog.querySelector('.dd-library').innerHTML = list.length ? list.map(w => `
            <li><button type="button" class="dd-pick list-row" data-id="${esc(w.id)}">${esc(w.meta?.name ?? 'Workout')}</button></li>`).join('') :
            '<li class="card__note">No workouts match.</li>';
    }
}

customElements.define('day-dialog', DayDialog);

export { DayDialog };
