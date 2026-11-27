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
import { planStatus, plannedTss, isGoalEvent } from '../../training/plan.js';
import { goalEventsFromPlan, EVENT_TYPES, eventTypeLabel } from '../../training/season.js';
import { esc, fmtDuration, fmtDay, fmtTss, sportLabelFor, loadTag, loadTitle } from './format.js';
import { intervalsToGraph } from '../workout-graph.js';
import { openRide } from '../analysis/open-ride.js';
import { confirmAction } from '../confirm.js';

const GRAPH_HEIGHT = 80;
const minutes = (s) => `${Math.round(s / 60)} min`;
const workoutSeconds = (w) => (w?.intervals ?? []).reduce((a, i) => a + (Number(i.duration) || 0), 0);

const PRIORITY_DESC = {
    A: 'A — Main season peak',
    B: 'B — Tune-up race',
    C: 'C — Training event',
};

function goalFormHtml(goalForm, defaultDay) {
    if(!goalForm) {
        return `<div class="dd-goal-bar"><button type="button" class="btn" data-add-goal>+ Goal event</button></div>`;
    }
    const g = goalForm.goal ?? null;
    const prio = g?.priority ?? 'A';
    const day = g?.day ?? defaultDay;
    const type = g?.eventType ?? '';
    const durMin = g?.targetDurationS ? Math.round(g.targetDurationS / 60) : '';
    const tss = g?.targetTss ?? '';
    const notes = g?.notes ?? '';
    return `
        <form class="dd-goal-form" aria-label="${g ? 'Edit goal event' : 'Add goal event'}">
            <h3 class="dd-sub">${g ? 'Edit goal event' : 'Add goal event'}</h3>
            <div class="dd-goal-grid">
                <label class="field dd-goal-name">Event name
                    <input type="text" class="input" name="goalName" required maxlength="120" value="${esc(g?.name ?? '')}" placeholder="e.g. Solstice Gran Fondo">
                </label>
                <label class="field">Priority
                    <select class="input" name="goalPriority">
                        ${['A', 'B', 'C'].map(p => `<option value="${p}"${prio === p ? ' selected' : ''}>${esc(PRIORITY_DESC[p])}</option>`).join('')}
                    </select>
                </label>
                <label class="field">Date
                    <input type="date" class="input" name="goalDay" required value="${esc(day)}">
                </label>
                <label class="field">Event type
                    <select class="input" name="goalType">
                        <option value="">Optional</option>
                        ${EVENT_TYPES.map(t => `<option value="${esc(t.key)}"${type === t.key ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
                    </select>
                </label>
                <label class="field">Target duration (min)
                    <input type="number" class="input" name="goalDurationMin" min="1" max="10080" step="1" value="${esc(durMin)}" placeholder="e.g. 180">
                </label>
                <label class="field">Target TSS
                    <input type="number" class="input" name="goalTss" min="1" max="2000" step="1" value="${esc(tss)}" placeholder="e.g. 200">
                </label>
                <label class="field dd-goal-notes">Notes
                    <input type="text" class="input" name="goalNotes" maxlength="500" value="${esc(notes)}" placeholder="Course notes, target power or pacing…">
                </label>
            </div>
            <div class="dd-goal-actions">
                <button type="submit" class="btn btn--primary">${g ? 'Save goal' : 'Add goal'}</button>
                <button type="button" class="btn" data-cancel-goal>Cancel</button>
            </div>
        </form>`;
}

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
        this.$dialog.addEventListener('submit', e => this.onSubmit(e));
        this.$dialog.addEventListener('input', e => {
            if(e.target.matches('input[type=search]')) this.renderLibrary(e.target.value);
        });
    }

    open(day, data, opts = {}) {
        this.day = day;
        this.data = data;
        this.goalForm = opts.goal ? {mode: 'add'} : null;
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
        const analyse = e.target.closest('[data-analyse]');
        if(analyse) { this.close(); openRide(analyse.dataset.analyse, 'training'); return; }
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
        const delRide = e.target.closest('[data-delete-ride]');
        if(delRide) {
            const id = delRide.dataset.deleteRide;
            const ok = await confirmAction({
                title: 'Delete ride?',
                message: 'Permanently delete this ride from this device and your account?',
                confirmLabel: 'Delete',
                danger: true,
            });
            if(ok) {
                await (this.actions.deleteRide ? this.actions.deleteRide(id) : history.deleteRide(id));
                this.close();
            }
            return;
        }
        const addGoal = e.target.closest('[data-add-goal]');
        if(addGoal) {
            this.goalForm = {mode: 'add'};
            this.render();
            this.fillGraphs();
            this.$dialog.querySelector('input[name="goalName"]')?.focus();
            return;
        }
        const editGoal = e.target.closest('[data-edit-goal]');
        if(editGoal) {
            const goal = goalEventsFromPlan(this.data.plan ?? []).find(g => String(g.id) === editGoal.dataset.editGoal);
            if(goal) {
                this.goalForm = {mode: 'edit', goal};
                this.render();
                this.fillGraphs();
            }
            return;
        }
        const cancelGoal = e.target.closest('[data-cancel-goal]');
        if(cancelGoal) {
            this.goalForm = null;
            this.render();
            this.fillGraphs();
            return;
        }
        const removeGoal = e.target.closest('[data-remove-goal]');
        if(removeGoal) {
            const fn = this.actions.removeGoalEvent ?? this.actions.removePlanEntry;
            if(fn) await fn.call(this.actions, removeGoal.dataset.removeGoal);
            this.close();
            return;
        }
        const remove = e.target.closest('[data-remove]');
        if(remove) { this.actions.removePlanEntry(remove.dataset.remove); this.close(); return; }
        if(e.target.closest('[data-close]')) this.close();
    }

    async onSubmit(e) {
        const form = e.target.closest('.dd-goal-form');
        if(!form) return;
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get('goalName') ?? '').trim();
        if(!name) return;
        const priority = String(fd.get('goalPriority') ?? 'A').trim().toUpperCase();
        const goalDay = String(fd.get('goalDay') ?? this.day).trim() || this.day;
        const eventType = String(fd.get('goalType') ?? '').trim() || null;
        const durMin = Number(fd.get('goalDurationMin'));
        const targetDurationS = Number.isFinite(durMin) && durMin > 0 ? Math.round(durMin * 60) : null;
        const tss = Number(fd.get('goalTss'));
        const targetTss = Number.isFinite(tss) && tss > 0 ? Math.round(tss) : null;
        const notes = String(fd.get('goalNotes') ?? '').trim() || null;
        const payload = {name, priority, eventType, targetDurationS, targetTss, notes};

        if(this.goalForm?.mode === 'edit' && this.goalForm.goal) {
            await this.actions.updateGoalEvent(this.goalForm.goal.id, {day: goalDay, ...payload});
        } else {
            await this.actions.addGoalEvent(goalDay, payload);
        }
        this.goalForm = null;
        this.close();
    }

    onChange(e) {
        const move = e.target.closest('input[data-move]');
        if(move && move.value) { this.actions.movePlanEntry(move.dataset.move, move.value); this.close(); }
    }

    render() {
        const {summaries = [], allSummaries, plan = [], today} = this.data;
        const allRides = (allSummaries ?? summaries).filter(s => s.day === this.day);
        const goals = goalEventsFromPlan(plan).filter(g => g.day === this.day);
        const allEntries = plan.filter(e => !e.deleted && !isGoalEvent(e) && e.day === this.day);
        // a planned workout that was ridden is one item: the ride, with its plan
        const planOf = r => r.hidden ? null : allEntries.find(e => e.rideId && e.rideId === r.id) ?? null;
        const rides = allRides;
        const entries = allEntries.filter(e => !allRides.some(r => planOf(r) === e));
        const graph = e => e.workout?.intervals?.length ? `<div class="dd-graph workout-list--graph-cont" data-graph="${esc(e.id)}" role="img"
                        aria-label="${esc(`Workout profile, ${minutes(workoutSeconds(e.workout))}`)}"></div>` : '';
        const planned = e => e?.workout ? ` (planned ${Math.round(plannedTss(e.workout, this.data.ftp))})` : '';
        const goalMeta = g => [
            eventTypeLabel(g.eventType),
            g.targetDurationS ? fmtDuration(g.targetDurationS) : '',
            g.targetTss ? `${g.targetTss} TSS` : '',
        ].filter(Boolean).join(' · ');
        this.$dialog.innerHTML = `
            <div class="dd-head">
                <h2 class="card__title">${esc(fmtDay(this.day, {weekday: 'long', day: 'numeric', month: 'long'}))}</h2>
                <button type="button" class="btn btn--icon" data-close aria-label="Close">×</button>
            </div>
            ${goals.length ? `<h3 class="dd-sub">Goal events</h3><ul class="dd-list dd-goals">${goals.map(g => `
                <li class="list-row dd-goal" data-priority="${esc(g.priority)}">
                    <div class="list-row__main">
                        <div class="list-row__title"><span class="badge cal-goal__prio" data-priority="${esc(g.priority)}">${esc(g.priority)}</span> ${esc(g.name)}</div>
                        ${goalMeta(g) || g.origin === 'ai' ? `<div class="list-row__meta">${esc(goalMeta(g))}${g.origin === 'ai' ? ' <span class="badge badge-ai">AI</span>' : ''}</div>` : ''}
                        ${g.notes ? `<div class="dd-goal__notes">${esc(g.notes)}</div>` : ''}
                    </div>
                    <button type="button" class="btn" data-edit-goal="${esc(g.id)}">Edit</button>
                    <button type="button" class="btn btn--danger" data-remove-goal="${esc(g.id)}">Remove</button>
                </li>`).join('')}</ul>` : ''}
            ${goalFormHtml(this.goalForm, this.day)}
            ${rides.length ? `<h3 class="dd-sub">Rides</h3><ul class="dd-list">${rides.map(r => { const e = planOf(r); return `
                <li class="list-row dd-ride${r.hidden ? ' is-hidden' : ''}${e ? ' dd-done' : ''}"><div class="list-row__main"><div class="list-row__title">${esc(r.name)}</div>
                    <div class="list-row__meta">${e ? `<span class="badge">done</span> ` : ''}${sportLabelFor(r) ? `${esc(sportLabelFor(r))} · ` : ''}${fmtDuration(r.duration)} · ${fmtTss(r.tss)} TSS${planned(e)}${loadTag(r.loadSource) ? ` <span class="badge cal-load" title="${esc(loadTitle(r.loadSource))}">${loadTag(r.loadSource)}</span>` : ''}${Number.isFinite(r.np) ? ` · NP ${Math.round(r.np)} W` : ''}${r.hidden ? ' · hidden' : ''}${e?.origin === 'intervals' ? ' <span class="badge badge-icu">intervals.icu</span>' : ''}</div>${zoneBar(r)}${e ? graph(e) : ''}</div>
                    ${r.hidden ? '' : `<button type="button" class="btn btn--primary" data-analyse="${esc(r.id)}">Analyse ride</button>`}
                    ${r.hidden ?
                      `<button type="button" class="btn" data-show="${esc(r.id)}">Show</button>` :
                      `<button type="button" class="btn" data-hide="${esc(r.id)}">Hide this ride</button>`}
                    <button type="button" class="btn btn--danger" data-delete-ride="${esc(r.id)}">Delete</button>
                    ${r.loadSource === 'rpe' || r.loadSource === 'estimate' ? rating(r) : ''}</li>`; }).join('')}</ul>` : ''}
            ${entries.length ? `<h3 class="dd-sub">Planned</h3><ul class="dd-list">${entries.map(e => `
                <li class="list-row"><div class="list-row__main"><div class="list-row__title">${esc(e.workout?.meta?.name ?? e.name ?? 'Workout')}</div>
                    <div class="list-row__meta"><span class="badge">${planStatus(e, today)}</span>
                        ${e.workout ? `${Math.round(plannedTss(e.workout, this.data.ftp))} TSS` : 'The workout from intervals.icu could not be read, so it can\'t be ridden here.'}
                        ${e.origin === 'intervals' ? '<span class="badge badge-icu">intervals.icu</span>' : e.origin === 'ai' ? '<span class="badge badge-ai" title="Planned by an AI app, with your OK">AI</span>' : ''}</div>
                    ${graph(e)}</div>
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
