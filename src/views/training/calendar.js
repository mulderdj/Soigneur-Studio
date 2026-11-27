//
// <training-calendar>: rides and plan entries per day. A week list on a
// phone, a month grid from 600 px. Tapping a day dispatches 'day-open'
// (bubbles) with {day}; the page opens the day dialog.
//
// data = {today, summaries, plan}; attribute `layout` overrides the
// screen-size check (tests).
//

import { addDays, weekStart, monthStart, dayToDate } from '../../training/dates.js';
import { planStatus, plannedTss, isGoalEvent } from '../../training/plan.js';
import { goalEventsFromPlan, eventTypeLabel, phaseForWeek } from '../../training/season.js';
import { currentLayout, isPhone } from '../layout.js';
import { esc, fmtDuration, fmtDay, fmtMonth, fmtTss, sportLabelFor, loadTag, loadTitle } from './format.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

class TrainingCalendar extends HTMLElement {
    connectedCallback() {
        // connected again when the rider moves the card (Edit layout): keep
        // the month in view, and the click handler is added once
        this.anchor ??= this._data?.today ?? null;
        if(!this.clicks) {
            this.clicks = true;
            this.addEventListener('click', e => {
                const nav = e.target.closest('[data-nav]');
                if(nav) return this.navigate(nav.dataset.nav);
                const addGoal = e.target.closest('[data-add-goal]');
                if(addGoal && this._data) {
                    const target = this.anchor && this.anchor >= this._data.today ? this.anchor : this._data.today;
                    this.dispatchEvent(new CustomEvent('day-open', {bubbles: true, detail: {day: target, goal: true}}));
                    return;
                }
                const open = e.target.closest('.cal-open');
                if(open) this.dispatchEvent(new CustomEvent('day-open', {bubbles: true, detail: {day: open.closest('.cal-day').dataset.day}}));
            });
        }
        this.onResize = () => { if(this.week() !== this.lastWeek) this.render(); };
        window.addEventListener('resize', this.onResize);
        this.render();
    }

    disconnectedCallback() {
        window.removeEventListener('resize', this.onResize);
    }

    set data(d) {
        this._data = d;
        if(!this.anchor) this.anchor = d.today;
        this.render();
    }

    get data() { return this._data; }

    week() {
        const forced = this.getAttribute('layout');
        return forced ? isPhone(forced) : isPhone(currentLayout());
    }

    navigate(dir) {
        const {today} = this._data;
        if(dir === 'today') this.anchor = today;
        else if(this.week()) this.anchor = addDays(this.anchor, dir === 'next' ? 7 : -7);
        else {
            const m = dayToDate(monthStart(this.anchor));
            m.setMonth(m.getMonth() + (dir === 'next' ? 1 : -1));
            this.anchor = monthStart(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`);
        }
        this.render();
    }

    days() {
        if(this.week()) {
            const start = weekStart(this.anchor);
            return Array.from({length: 7}, (_, i) => addDays(start, i));
        }
        const first = weekStart(monthStart(this.anchor));
        return Array.from({length: 42}, (_, i) => addDays(first, i));
    }

    itemsFor(day, goalsByDay) {
        const {summaries = [], plan = [], today} = this._data;
        const rides = summaries.filter(s => s.day === day);
        const dayGoals = goalsByDay.get(day) ?? [];
        const entries = plan.filter(e => !e.deleted && !isGoalEvent(e) && e.day === day);
        const matched = new Set(entries.map(e => e.rideId).filter(Boolean));
        const goalHtml = dayGoals.map(g => {
            const parts = [
                eventTypeLabel(g.eventType),
                g.targetDurationS ? fmtDuration(g.targetDurationS) : '',
                g.targetTss ? `${g.targetTss} TSS` : '',
            ].filter(Boolean);
            const ai = g.origin === 'ai' ? ' <span class="badge badge-ai" title="Added by an AI app, with your OK">AI</span>' : '';
            return `<li class="cal-item cal-goal" data-priority="${esc(g.priority)}">
                        <span class="cal-item__name"><span class="badge cal-goal__prio" data-priority="${esc(g.priority)}">${esc(g.priority)}</span> ${esc(g.name)}</span>
                        <span class="cal-item__meta">${esc(parts.join(' · ') || 'Goal event')}${ai}</span>
                    </li>`;
        }).join('');
        const planHtml = entries.map(e => {
            const status = planStatus(e, today);
            const planned = Math.round(plannedTss(e.workout, this._data.ftp));
            const ride = e.rideId ? summaries.find(s => s.id === e.rideId) : null;
            const detail = status === 'done' && ride ?
                  `planned ${planned} / actual ${fmtTss(ride.tss)} TSS` :
                  `${planned} TSS`;
            const icu = e.origin === 'intervals' ? ' <span class="badge badge-icu">intervals.icu</span>' :
                        e.origin === 'ai' ? ' <span class="badge badge-ai" title="Planned by an AI app, with your OK">AI</span>' : '';
            return `<li class="cal-item cal-plan" data-status="${status}">
                        <span class="cal-item__name">${esc(e.workout?.meta?.name ?? e.name ?? 'Workout')}</span>
                        <span class="cal-item__meta"><span class="badge cal-status">${status}</span> ${e.workout ? detail : 'not readable'}${icu}</span>
                    </li>`;
        }).join('');
        const rideHtml = rides.filter(r => !matched.has(r.id)).map(r => {
            const sport = sportLabelFor(r);
            const load = loadTag(r.loadSource);
            return `
                    <li class="cal-item cal-ride">
                        <span class="cal-item__name">${esc(r.name)}</span>
                        <span class="cal-item__meta">${sport ? `<span class="badge cal-sport">${esc(sport)}</span> ` : ''}${load ? `<span class="badge cal-load" title="${esc(loadTitle(r.loadSource))}">${load}</span> ` : ''}${fmtDuration(r.duration)} · ${fmtTss(r.tss)} TSS</span>
                    </li>`;
        }).join('');
        return goalHtml + planHtml + rideHtml;
    }

    weekRowHtml(monday, goals) {
        const wp = phaseForWeek(goals, monday);
        if(!wp.phase && !wp.miniTaper) return '';
        const pills = [];
        if(wp.phase) pills.push(`<span class="cal-phase" data-phase="${esc(wp.phase)}">${esc(wp.label)}</span>`);
        if(wp.miniTaper) pills.push('<span class="cal-phase cal-phase--mini" data-phase="mini-taper">Mini-taper</span>');
        let meta = '';
        if(wp.targetGoal) {
            meta = wp.weeksToGoal === 0 ? `Race week · ${wp.targetGoal.name}` : `${wp.weeksToGoal}w to ${wp.targetGoal.name}`;
        } else if(wp.miniTaper) {
            const bGoal = wp.goals.find(g => g.priority === 'B');
            if(bGoal) meta = `Tune-up · ${bGoal.name}`;
        }
        return `<li class="cal-week" data-week="${monday}"${wp.phase ? ` data-phase="${esc(wp.phase)}"` : ''}>
                    <span class="cal-week__pills">${pills.join(' ')}</span>
                    ${meta ? `<span class="cal-week__meta">${esc(meta)}</span>` : ''}
                </li>`;
    }

    render() {
        if(!this._data) return;
        const week = this.week();
        this.lastWeek = week;
        const {today, plan = []} = this._data;
        const goals = goalEventsFromPlan(plan);
        const goalsByDay = new Map();
        for(const g of goals) {
            const list = goalsByDay.get(g.day) ?? [];
            list.push(g);
            goalsByDay.set(g.day, list);
        }
        const days = this.days();
        const month = monthStart(this.anchor).slice(0, 7);
        const title = week ?
              `${fmtDay(days[0], {day: 'numeric', month: 'short'})} – ${fmtDay(days[6], {day: 'numeric', month: 'short', year: 'numeric'})}` :
              fmtMonth(this.anchor);

        this.innerHTML = `
            <div class="cal-bar">
                <h2 class="card__title cal-title">${esc(title)}</h2>
                <div class="cal-nav">
                    <button type="button" class="btn btn--quiet" data-add-goal>+ Goal</button>
                    <button type="button" class="btn btn--icon" data-nav="prev" aria-label="Previous ${week ? 'week' : 'month'}">‹</button>
                    <button type="button" class="btn btn--quiet" data-nav="today">Today</button>
                    <button type="button" class="btn btn--icon" data-nav="next" aria-label="Next ${week ? 'week' : 'month'}">›</button>
                </div>
            </div>
            ${week ? '' : `<div class="cal-head">${WEEKDAYS.map(d => `<span>${d}</span>`).join('')}</div>`}
            <ol class="cal-days ${week ? 'cal-days--week' : 'cal-days--month'}">
                ${days.map((day, idx) => {
                    const weekHead = idx % 7 === 0 ? this.weekRowHtml(day, goals) : '';
                    const dayGoals = goalsByDay.get(day) ?? [];
                    const goalAttr = dayGoals.length ? ` data-goal="${esc(dayGoals[0].priority)}"` : '';
                    return `${weekHead}
                <li class="cal-day${day === today ? ' is-today' : ''}${!week && day.slice(0, 7) !== month ? ' is-other' : ''}${dayGoals.length ? ' has-goal' : ''}" data-day="${day}"${goalAttr}>
                    <button type="button" class="cal-open" aria-label="${esc(fmtDay(day, {weekday: 'long', day: 'numeric', month: 'long'}))}">
                        <span class="cal-date">${week ? esc(fmtDay(day)) : Number(day.slice(8))}</span>
                    </button>
                    <ul class="cal-items">${this.itemsFor(day, goalsByDay)}</ul>
                </li>`;
                }).join('')}
            </ol>`;
    }
}

customElements.define('training-calendar', TrainingCalendar);

export { TrainingCalendar };
