//
// <training-calendar>: rides and plan entries per day. A week list on a
// phone, a month grid from 600 px. Tapping a day dispatches 'day-open'
// (bubbles) with {day}; the page opens the day dialog.
//
// data = {today, summaries, plan}; attribute `layout` overrides the
// screen-size check (tests).
//

import { addDays, weekStart, monthStart, dayToDate } from '../../training/dates.js';
import { planStatus, plannedTss } from '../../training/plan.js';
import { currentLayout, isPhone } from '../layout.js';
import { esc, fmtDuration, fmtDay, fmtMonth, fmtTss } from './format.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

class TrainingCalendar extends HTMLElement {
    connectedCallback() {
        this.anchor = null;
        this.addEventListener('click', e => {
            const nav = e.target.closest('[data-nav]');
            if(nav) return this.navigate(nav.dataset.nav);
            const open = e.target.closest('.cal-open');
            if(open) this.dispatchEvent(new CustomEvent('day-open', {bubbles: true, detail: {day: open.closest('.cal-day').dataset.day}}));
        });
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

    itemsFor(day) {
        const {summaries = [], plan = [], today} = this._data;
        const rides = summaries.filter(s => s.day === day);
        const entries = plan.filter(e => !e.deleted && e.day === day);
        const matched = new Set(entries.map(e => e.rideId).filter(Boolean));
        const planHtml = entries.map(e => {
            const status = planStatus(e, today);
            const planned = Math.round(plannedTss(e.workout, this._data.ftp));
            const ride = e.rideId ? summaries.find(s => s.id === e.rideId) : null;
            const detail = status === 'done' && ride ?
                  `planned ${planned} / actual ${fmtTss(ride.tss)} TSS` :
                  `${planned} TSS`;
            const icu = e.origin === 'intervals' ? ' <span class="badge badge-icu">intervals.icu</span>' : '';
            return `<li class="cal-item cal-plan" data-status="${status}">
                        <span class="cal-item__name">${esc(e.workout?.meta?.name ?? e.name ?? 'Workout')}</span>
                        <span class="cal-item__meta"><span class="badge cal-status">${status}</span> ${e.workout ? detail : 'not readable'}${icu}</span>
                    </li>`;
        }).join('');
        const rideHtml = rides.filter(r => !matched.has(r.id)).map(r => `
                    <li class="cal-item cal-ride">
                        <span class="cal-item__name">${esc(r.name)}</span>
                        <span class="cal-item__meta">${fmtDuration(r.duration)} · ${fmtTss(r.tss)} TSS</span>
                    </li>`).join('');
        return planHtml + rideHtml;
    }

    render() {
        if(!this._data) return;
        const week = this.week();
        this.lastWeek = week;
        const {today} = this._data;
        const days = this.days();
        const month = monthStart(this.anchor).slice(0, 7);
        const title = week ?
              `${fmtDay(days[0], {day: 'numeric', month: 'short'})} – ${fmtDay(days[6], {day: 'numeric', month: 'short', year: 'numeric'})}` :
              fmtMonth(this.anchor);

        this.innerHTML = `
            <div class="cal-bar">
                <h2 class="card__title cal-title">${esc(title)}</h2>
                <div class="cal-nav">
                    <button type="button" class="btn btn--icon" data-nav="prev" aria-label="Previous ${week ? 'week' : 'month'}">‹</button>
                    <button type="button" class="btn btn--quiet" data-nav="today">Today</button>
                    <button type="button" class="btn btn--icon" data-nav="next" aria-label="Next ${week ? 'week' : 'month'}">›</button>
                </div>
            </div>
            ${week ? '' : `<div class="cal-head">${WEEKDAYS.map(d => `<span>${d}</span>`).join('')}</div>`}
            <ol class="cal-days ${week ? 'cal-days--week' : 'cal-days--month'}">
                ${days.map(day => `
                <li class="cal-day${day === today ? ' is-today' : ''}${!week && day.slice(0, 7) !== month ? ' is-other' : ''}" data-day="${day}">
                    <button type="button" class="cal-open" aria-label="${esc(fmtDay(day, {weekday: 'long', day: 'numeric', month: 'long'}))}">
                        <span class="cal-date">${week ? esc(fmtDay(day)) : Number(day.slice(8))}</span>
                    </button>
                    <ul class="cal-items">${this.itemsFor(day)}</ul>
                </li>`).join('')}
            </ol>`;
    }
}

customElements.define('training-calendar', TrainingCalendar);

export { TrainingCalendar };
