//
// Fitness (CTL, 42 days), fatigue (ATL, 7 days) and form (TSB): the
// exponentially weighted daily TSS model. Form is yesterday's fitness minus
// yesterday's fatigue, as TrainingPeaks shows it.
//

import { addDays, daysBetween } from './dates.js';

const CTL_DAYS = 42;
const ATL_DAYS = 7;

function dailyTss(summaries) {
    const byDay = new Map();
    for(const s of summaries) {
        if(!s?.day) continue;
        byDay.set(s.day, (byDay.get(s.day) ?? 0) + (Number.isFinite(s.tss) ? s.tss : 0));
    }
    return byDay;
}

function step(prev, tss, day) {
    const ctl = prev.ctl + (tss - prev.ctl) / CTL_DAYS;
    const atl = prev.atl + (tss - prev.atl) / ATL_DAYS;
    return {day, tss, ctl, atl, tsb: prev.ctl - prev.atl};
}

function pmc(tssByDay, from, to) {
    const rows = [];
    let prev = {ctl: 0, atl: 0};
    const n = daysBetween(from, to);
    for(let i = 0; i <= n; i++) {
        const day = addDays(from, i);
        prev = step(prev, tssByDay.get(day) ?? 0, day);
        rows.push(prev);
    }
    return rows;
}

function forecast(last, plannedByDay, fromDay, days = 28) {
    const rows = [];
    let prev = {ctl: last.ctl, atl: last.atl};
    for(let i = 1; i <= days; i++) {
        const day = addDays(fromDay, i);
        prev = step(prev, plannedByDay.get(day) ?? 0, day);
        rows.push(prev);
    }
    return rows;
}

function formLabel(tsb) {
    if(tsb > 25) return 'Very fresh';
    if(tsb >= 5) return 'Fresh';
    if(tsb >= -10) return 'Neutral';
    if(tsb >= -30) return 'Building';
    return 'Overreaching';
}

export { dailyTss, pmc, forecast, formLabel, CTL_DAYS, ATL_DAYS };
