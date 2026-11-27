// @ts-check
//
// Fitness (CTL, 42 days), fatigue (ATL, 7 days) and form (TSB): the
// exponentially weighted daily TSS model. Form is yesterday's fitness minus
// yesterday's fatigue, as TrainingPeaks shows it.
//

import { addDays, daysBetween, weekStart } from './dates.js';
import { goalEventsFromPlan, eventLoadTss } from './season.js';

const CTL_DAYS = 42;
const ATL_DAYS = 7;
const GOAL_HORIZON_DAYS = 90;

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

// Daily load multiplier leading into an A or B goal: A goals get a 2-week
// progressive taper; B goals get a 5-day mini-taper.
function taperFactor(daysBeforeGoal, priority = 'A') {
    if(daysBeforeGoal <= 0) return 0;
    if(priority === 'B') {
        if(daysBeforeGoal === 1) return 0.35;
        if(daysBeforeGoal <= 5) return 0.6;
        return 1;
    }
    if(daysBeforeGoal === 1) return 0.3;
    if(daysBeforeGoal <= 7) return 0.45;
    if(daysBeforeGoal <= 14) return 0.7;
    return 1;
}

const fmtSigned = x => `${Math.round(x) > 0 ? '+' : ''}${Math.round(x)}`;

// Plain-language race-day form assessment & taper guidance.
function taperGuidance(tsb, {priority = 'A', withIdealTaper = null, daysToGoal = 0} = {}) {
    if(tsb < -5) {
        const windowText = priority === 'A' ? 'final 10–14 days' : 'final 4–5 days';
        const lift = withIdealTaper && withIdealTaper.tsb > tsb + 2 ?
            ` (a ~45% taper would lift form to about ${fmtSigned(withIdealTaper.tsb)})` : '';
        return {
            status: 'fatigued',
            level: 'warn',
            guidance: daysToGoal <= 1 ?
                `Projected form ${fmtSigned(tsb)} carries residual fatigue — keep any pre-race spin very easy.` :
                `Projected form ${fmtSigned(tsb)} is fatigued (< −5) — trim load in the ${windowText} so fatigue clears before race day${lift}.`,
        };
    }
    if(tsb > 25) {
        return {
            status: 'flat',
            level: 'warn',
            guidance: `Projected form ${fmtSigned(tsb)} is very high (> +25) and risks feeling flat — keep light aerobic rides and a short race-pace opener so form stays near +5 to +20.`,
        };
    }
    if(tsb >= 5) {
        return {
            status: 'ready',
            level: 'good',
            guidance: `On track for fresh legs on race day (sweet spot +5 to +20).`,
        };
    }
    return {
        status: 'ready',
        level: 'ok',
        guidance: daysToGoal <= 2 ?
            `Balanced form (${fmtSigned(tsb)}) for race day — rest or spin easy beforehand.` :
            `Close to ideal race freshness — easing the final 3–5 days slightly lifts form into +5 to +15.`,
    };
}

/**
 * Project CTL/ATL/TSB onto an upcoming goal event day (`goal.day >= today`).
 *
 * Days up through the last week with planned workouts use the rider's exact
 * planned TSS (plus intermediate event load when a day has an earlier goal
 * event and no workout). Unplanned weeks further out (when the rider has
 * existing CTL >= 5) assume baseline daily load (`now.ctl`) with a progressive
 * taper into race day so distant goals don't assume months of zero riding.
 */
function projectGoalForm({today, now, plannedByDay = new Map(), eventLoads = new Map(), goal}) {
    const daysToGoal = daysBetween(today, goal.day);
    if(daysToGoal <= 0) {
        const cur = {day: today, tss: 0, ctl: now.ctl ?? 0, atl: now.atl ?? 0, tsb: now.tsb ?? ((now.ctl ?? 0) - (now.atl ?? 0))};
        const g = taperGuidance(cur.tsb, {priority: goal.priority, daysToGoal: 0});
        return {
            goal, daysToGoal: 0, projected: cur, withoutTaper: cur, withIdealTaper: cur,
            taperGain: 0, assumedUnplanned: false, forecastByDay: new Map(), ...g,
        };
    }

    let lastPlannedDay = null;
    for(const [d, v] of plannedByDay) {
        if(d > today && v > 0 && (!lastPlannedDay || d > lastPlannedDay)) lastPlannedDay = d;
    }
    const coveredThroughWeek = lastPlannedDay ? weekStart(lastPlannedDay) : null;
    const baseline = Number.isFinite(now.ctl) && now.ctl >= 5 ? now.ctl : 0;

    let assumedUnplanned = false;
    const forecastByDay = new Map();
    for(let i = 1; i <= daysToGoal; i++) {
        const d = addDays(today, i);
        const daysBefore = daysBetween(d, goal.day);
        const inCovered = coveredThroughWeek !== null && weekStart(d) <= coveredThroughWeek;
        if(inCovered) {
            const wTss = plannedByDay.get(d);
            const evTss = d < goal.day ? (eventLoads.get(d) ?? 0) : 0;
            forecastByDay.set(d, (wTss ?? 0) > 0 ? wTss : evTss);
        } else if(baseline > 0) {
            assumedUnplanned = true;
            const evTss = d < goal.day ? (eventLoads.get(d) ?? 0) : 0;
            forecastByDay.set(d, evTss > 0 ? evTss : baseline * taperFactor(daysBefore, goal.priority));
        } else {
            forecastByDay.set(d, d < goal.day ? (eventLoads.get(d) ?? 0) : 0);
        }
    }

    const projRows = forecast(now, forecastByDay, today, daysToGoal);
    const projected = projRows.at(-1);

    // Pre-taper daily reference load: average daily load before the taper window, or current CTL.
    const taperWindow = goal.priority === 'B' ? 5 : 14;
    let preSum = 0, preCount = 0;
    for(let i = 1; i < daysToGoal; i++) {
        const d = addDays(today, i);
        if(daysBetween(d, goal.day) > taperWindow) {
            preSum += forecastByDay.get(d) ?? 0;
            preCount++;
        }
    }
    const holdLoad = Math.max(baseline, preCount > 0 ? preSum / preCount : 0);

    const noTaperMap = new Map(forecastByDay);
    const idealTaperMap = new Map(forecastByDay);
    for(let i = 1; i < daysToGoal; i++) {
        const d = addDays(today, i);
        const daysBefore = daysBetween(d, goal.day);
        if(daysBefore <= taperWindow) {
            if(holdLoad > 0) noTaperMap.set(d, holdLoad);
            const curLoad = forecastByDay.get(d) ?? 0;
            const f = taperFactor(daysBefore, goal.priority);
            idealTaperMap.set(d, holdLoad > 0 ? Math.min(curLoad > 0 ? curLoad * f : holdLoad * f, holdLoad * f) : curLoad * f);
        }
    }
    const withoutTaper = forecast(now, noTaperMap, today, daysToGoal).at(-1);
    const withIdealTaper = forecast(now, idealTaperMap, today, daysToGoal).at(-1);
    const taperGain = Math.round(projected.tsb - withoutTaper.tsb);
    const g = taperGuidance(projected.tsb, {priority: goal.priority, withIdealTaper, daysToGoal});

    return {
        goal,
        daysToGoal,
        projected,
        withoutTaper,
        withIdealTaper,
        taperGain,
        assumedUnplanned,
        forecastByDay,
        ...g,
    };
}

/**
 * Find the primary upcoming A/B goal within `horizonDays` (default 90) and
 * compute its race-day form forecast (plus an earlier B tune-up if the primary
 * goal is an A race).
 */
function raceForecast({today, now, plannedByDay = new Map(), plan = [], horizonDays = GOAL_HORIZON_DAYS}) {
    if(!today || !now) return null;
    const latest = addDays(today, horizonDays);
    const goals = goalEventsFromPlan(plan).filter(g => (g.priority === 'A' || g.priority === 'B') && g.day >= today && g.day <= latest);
    if(goals.length === 0) return null;

    const eventLoads = new Map();
    for(const g of goalEventsFromPlan(plan)) {
        if(g.day > today) {
            const tss = eventLoadTss(g);
            if(tss > 0) eventLoads.set(g.day, Math.max(eventLoads.get(g.day) ?? 0, tss));
        }
    }

    const nextA = goals.find(g => g.priority === 'A') ?? null;
    const primaryGoal = nextA ?? goals[0];
    const primary = projectGoalForm({today, now, plannedByDay, eventLoads, goal: primaryGoal});

    const earlierB = nextA ? goals.find(g => g.priority === 'B' && g.day < nextA.day) : null;
    const tuneUp = earlierB ? projectGoalForm({today, now, plannedByDay, eventLoads, goal: earlierB}) : null;

    return {...primary, tuneUp};
}

export {
    dailyTss, pmc, forecast, formLabel, rampRate, rampStatus,
    taperFactor, taperGuidance, projectGoalForm, raceForecast,
    CTL_DAYS, ATL_DAYS, GOAL_HORIZON_DAYS,
};
