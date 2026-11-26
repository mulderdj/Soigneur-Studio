// @ts-check
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

// 7-day CTL change (TSS/day per week). Null when fewer than 8 days exist.
function rampRate(rows) {
    if(!Array.isArray(rows) || rows.length < 8) return null;
    const now = rows.at(-1)?.ctl;
    const weekAgo = rows.at(-8)?.ctl;
    if(!Number.isFinite(now) || !Number.isFinite(weekAgo)) return null;
    return now - weekAgo;
}

// Sustainable CTL ramp is roughly +3 to +5 TSS/day per week; > 7–8 flags
// elevated overreaching/injury risk.
function rampStatus(rate) {
    if(!Number.isFinite(rate)) return null;
    if(rate > 8) return {level: 'danger', text: `Rapid ramp (+${rate.toFixed(1)}/wk) — high overreaching risk`};
    if(rate > 5) return {level: 'warn', text: `Fast ramp (+${rate.toFixed(1)}/wk)`};
    if(rate < -5) return {level: 'muted', text: `Ramp ${rate.toFixed(1)}/wk`};
    return {level: 'ok', text: `Ramp ${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/wk`};
}

export { dailyTss, pmc, forecast, formLabel, rampRate, rampStatus, CTL_DAYS, ATL_DAYS };
