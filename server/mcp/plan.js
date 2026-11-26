// @ts-check
//
// Planning through the MCP server: workouts from a compact description, and
// Soigneur's own check of what an AI proposes, before anything is stored.
//
// The rules (findings come back in words a model can act on):
//   workout    steps with a duration, power 30–200 % FTP, at most 6 h a day
//   day        not in the past; not over a ridden day or an intervals.icu
//              workout; not over another planned workout unless replacing
//   ramp       fitness (CTL) rising at most 8 a week in the forecast
//   recovery   in a block of 4 weeks or more, an easier week (≤ 75 % of the
//              hardest of the 3 before it) at least every 4th week
//   rest       at least one day without training each week
//   hard days  no two days above 90 TSS in a row, unless the rider allows it
//   base       in a base week, at least 75 % of the riding in Z1–Z2 (< 75 % FTP)
//   readiness  no hard workout today when today's verdict isn't 'ready'
//

import crypto from 'node:crypto';
import { plannedTss, planStatus } from '../../src/training/plan.js';
import { dailyTss, pmc, forecast } from '../../src/training/load.js';
import { isHard } from '../../src/training/readiness.js';
import { countable } from '../../src/training/merge.js';
import { addDays, daysBetween, weekStart } from '../../src/training/dates.js';
import { ramp, writeWorkout } from './zwo.js';

const LIMITS = {
    minPct: 30, maxPct: 200, maxDayS: 6 * 3600,
    rampPerWeek: 8, hardDayTss: 90, baseEasyShare: 0.75, easyPct: 75,
    recoveryEvery: 4, recoveryShare: 0.75, aheadDays: 366,
};

const r0 = x => Math.round(x);
const r1 = x => Math.round(x * 10) / 10;

// --- workouts -------------------------------------------------------------------

// a step: {duration_s, power_pct | power_pct_from + power_pct_to | free_ride, cadence_rpm?}
// a block: {repeat, steps: [step, ...]}
function intervalsOf(blocks = []) {
    const out = [];
    const one = s => {
        const duration = Math.round(Number(s.duration_s) || 0);
        const cad = Number.isFinite(s.cadence_rpm) ? {cadence: String(s.cadence_rpm)} : {};
        if(s.free_ride) return {duration, steps: [{duration, slope: 0, power: 0}]};
        if(Number.isFinite(s.power_pct_from) && Number.isFinite(s.power_pct_to)) {
            return ramp(duration, Math.round(s.power_pct_from) / 100, Math.round(s.power_pct_to) / 100, cad);
        }
        const step = {duration, power: Math.round(Number(s.power_pct) || 0) / 100};
        if(Number.isFinite(s.cadence_rpm)) step.cadence = s.cadence_rpm;
        return {duration, steps: [step]};
    };
    for(const b of blocks) {
        if(Array.isArray(b?.steps)) {
            const n = Math.max(1, Math.round(b.repeat ?? 1));
            for(let i = 0; i < n; i++) for(const s of b.steps) out.push(one(s));
        } else {
            out.push(one(b ?? {}));
        }
    }
    return out;
}

function buildWorkout({name, description, steps}) {
    const intervals = intervalsOf(steps);
    return {
        id: `ai-${crypto.randomUUID()}`,
        meta: {name: String(name ?? 'Workout').slice(0, 80), author: 'Soigneur AI', category: 'AI',
               description: description ? String(description).slice(0, 500) : '', sportType: 'bike',
               duration: intervals.reduce((a, iv) => a + iv.duration, 0)},
        intervals,
    };
}

// a workout from the library (by id) or described; {workout} or {error}
function resolveWorkout(spec, library) {
    if(spec?.workout_id) {
        const w = library.find(x => x.id === spec.workout_id);
        if(!w) return {error: `No workout with id ${spec.workout_id} in the library (list_workouts gives the ids).`};
        const {source, ...copy} = JSON.parse(JSON.stringify(w));
        return {workout: copy};
    }
    if(spec?.workout) return {workout: buildWorkout(spec.workout)};
    return {error: 'Give a workout_id from list_workouts, or a workout with steps.'};
}

const stepsOf = w => (w?.intervals ?? []).flatMap(iv => (iv.steps?.length ? iv.steps : [{duration: iv.duration, power: iv.power}]));
const durationOf = w => (w?.intervals ?? []).reduce((a, iv) => a + (iv.duration ?? 0), 0);

function workoutProblems(w, ftp) {
    const out = [];
    const steps = stepsOf(w);
    if(!steps.length) out.push('it has no steps');
    if(steps.some(s => !(s.duration > 0))) out.push('a step has no duration');
    const pcts = steps.filter(s => !(s.slope === 0 && !(s.power > 0)) && Number.isFinite(s.power) && !Number.isFinite(s.slope))
        .map(s => (s.power >= 10 ? s.power / ftp : s.power) * 100);
    if(pcts.some(p => p < LIMITS.minPct)) out.push(`a step is under ${LIMITS.minPct} % FTP (use free_ride for coasting)`);
    if(pcts.some(p => p > LIMITS.maxPct)) out.push(`a step is over ${LIMITS.maxPct} % FTP`);
    if(durationOf(w) > LIMITS.maxDayS) out.push(`it is longer than ${LIMITS.maxDayS / 3600} h`);
    return out;
}

// share of the riding under 75 % FTP (Z1–Z2)
function easySeconds(w, ftp) {
    let easy = 0, all = 0;
    for(const s of stepsOf(w)) {
        const d = s.duration ?? 0;
        all += d;
        const f = s.power >= 10 ? s.power / ftp : (s.power ?? 0);
        if(f * 100 < LIMITS.easyPct) easy += d;
    }
    return {easy, all};
}

// --- the check ------------------------------------------------------------------
//
// ctx: {today, ftp, summaries, entries (plan, not deleted), verdict}
// change: {add: [{day, workout, week_of?, focus?}], remove: Set(entry ids), move: Map(entry id → day)}
// opts: {allowBackToBack, recovery (check recovery weeks), replacePlanned}

function checkPlan(ctx, change, opts = {}) {
    const {today, ftp} = ctx;
    const findings = [];
    const add = change.add ?? [];
    const remove = new Set(change.remove ?? []);
    const move = change.move ?? new Map();
    const rides = countable(ctx.summaries ?? []);
    const ridden = new Set(rides.filter(s => s.day <= today).map(s => s.day));

    // the plan as it would be
    const kept = (ctx.entries ?? []).filter(e => !remove.has(e.id)).map(e => (move.has(e.id) ? {...e, day: move.get(e.id)} : e));
    const open = e => planStatus(e, today) === 'planned';
    const touched = new Set([...add.map(a => a.day), ...[...move.values()]]);

    // workouts and days
    const addByDay = new Map();
    for(const a of add) {
        const where = `${a.day} (${a.workout?.meta?.name ?? 'workout'})`;
        for(const p of workoutProblems(a.workout, ftp)) findings.push({rule: 'workout', day: a.day, message: `${where}: ${p}.`});
        addByDay.set(a.day, [...(addByDay.get(a.day) ?? []), a]);
    }
    for(const [day, items] of addByDay) {
        if(items.length > 1) findings.push({rule: 'day', day, message: `${day} has ${items.length} workouts proposed; plan at most one workout per day.`});
        const totalS = items.reduce((s, a) => s + durationOf(a.workout), 0);
        if(items.length > 1 && totalS > LIMITS.maxDayS) findings.push({rule: 'workout', day, message: `${day}: combined workouts exceed ${LIMITS.maxDayS / 3600} h.`});
    }
    for(const day of touched) {
        if(day < today) findings.push({rule: 'day', day, message: `${day} is in the past.`});
        if(daysBetween(today, day) > LIMITS.aheadDays) findings.push({rule: 'day', day, message: `${day} is more than a year ahead.`});
        if(ridden.has(day) && day <= today) findings.push({rule: 'day', day, message: `${day} already has a ride; plan another day.`});
        const icu = kept.find(e => e.day === day && e.origin === 'intervals' && open(e) && !move.has(e.id));
        if(icu) findings.push({rule: 'day', day, message: `${day} has "${icu.workout?.meta?.name ?? icu.name ?? 'a workout'}" planned on intervals.icu, which Soigneur doesn't overwrite; plan another day, or the rider changes it on intervals.icu.`});
        const other = kept.filter(e => e.day === day && e.origin !== 'intervals' && open(e) && !move.has(e.id));
        if(other.length && !opts.replacePlanned) {
            findings.push({rule: 'day', day, message: `${day} already has ${other.map(e => `"${e.workout?.meta?.name ?? e.name ?? 'a workout'}" (${e.id})`).join(', ')} planned; remove it first, choose another day, or propose with replace_planned.`});
        }
    }
    const finalPlan = opts.replacePlanned ?
        kept.filter(e => !(touched.has(e.day) && e.origin !== 'intervals' && open(e) && !move.has(e.id))) : kept;

    // TSS per day: rides up to yesterday (and today's when ridden), the plan from today
    const byDay = dailyTss(rides.filter(s => s.day <= today));
    const planned = new Map();
    const plannedWorkouts = new Map();       // day → [workout]
    const put = (day, w) => {
        if(!w || day < today || (day === today && ridden.has(today))) return;
        planned.set(day, (planned.get(day) ?? 0) + plannedTss(w, ftp));
        plannedWorkouts.set(day, [...(plannedWorkouts.get(day) ?? []), w]);
    };
    for(const e of finalPlan) if(open(e)) put(e.day, e.workout);
    for(const a of add) put(a.day, a.workout);
    const tssOn = day => (day < today || (day === today && ridden.has(today)) ? (byDay.get(day) ?? 0) : (planned.get(day) ?? 0));

    // readiness: no hard workout today unless ready
    if(touched.has(today) && ctx.verdict && ctx.verdict.state !== 'ready') {
        const hard = (plannedWorkouts.get(today) ?? []).find(w => isHard(w, ftp));
        if(hard) findings.push({rule: 'readiness', day: today, message: `Today's readiness is ${ctx.verdict.state} (${(ctx.verdict.reasons ?? []).slice(0, 2).join('; ')}): no hard workout today. Plan it on another day, or ride something easy.`});
    }

    // the weeks that change
    const weeks = [...new Set([...touched].map(d => weekStart(d)))].sort();

    // fitness ramp per week, from the forecast
    const first = rides.reduce((a, s) => (s.day && s.day < a ? s.day : a), today);
    const rows = pmc(byDay, first, addDays(today, -1));
    const last = rows.at(-1) ?? {ctl: 0, atl: 0};
    const lastDay = [...touched, ...[...planned.keys()]].sort().at(-1) ?? today;
    const fcPlan = new Map(planned);
    if(ridden.has(today)) fcPlan.set(today, byDay.get(today) ?? 0);
    const fc = forecast(last, fcPlan, addDays(today, -1), Math.max(1, daysBetween(today, lastDay) + 1));
    const ctlOn = new Map(fc.map(r => [r.day, r.ctl]));
    for(const r of rows) ctlOn.set(r.day, r.ctl);
    const ctlAt = day => ctlOn.get(day) ?? (day < first ? 0 : last.ctl);
    const weekly = [];
    for(const w of weeks) {
        const end = addDays(w, 6);
        const tss = Array.from({length: 7}, (_, i) => tssOn(addDays(w, i))).reduce((a, b) => a + b, 0);
        const gain = ctlAt(end) - ctlAt(addDays(w, -1));
        weekly.push({week_of: w, tss: r0(tss), fitness_start: r1(ctlAt(addDays(w, -1))), fitness_end: r1(ctlAt(end)), fitness_change: r1(gain)});
        if(gain > LIMITS.rampPerWeek) {
            findings.push({rule: 'ramp', week_of: w, message: `Week of ${w}: fitness +${r1(gain)}, more than ${LIMITS.rampPerWeek} a week; lower that week's TSS by about ${r0((gain - LIMITS.rampPerWeek) * 42)}.`});
        }
    }

    // a day without training each week
    for(const w of weeks) {
        const days = Array.from({length: 7}, (_, i) => addDays(w, i));
        const free = days.filter(d => (d < today || (d === today && ridden.has(today)) ? !ridden.has(d) && !(byDay.get(d) > 0) : !(planned.get(d) > 0)));
        if(!free.length) findings.push({rule: 'rest', week_of: w, message: `Week of ${w} has no day without training; make one a rest day.`});
    }

    // no two hard days in a row
    if(!opts.allowBackToBack) {
        const seen = new Set();
        for(const day of touched) {
            for(const [a, b] of [[addDays(day, -1), day], [day, addDays(day, 1)]]) {
                const key = `${a}|${b}`;
                if(seen.has(key)) continue;
                seen.add(key);
                if(tssOn(a) > LIMITS.hardDayTss && tssOn(b) > LIMITS.hardDayTss) {
                    findings.push({rule: 'hard-days', day: b, message: `${a} (${r0(tssOn(a))} TSS) and ${b} (${r0(tssOn(b))} TSS) are both above ${LIMITS.hardDayTss} TSS; put an easier day between them, or ask the rider whether back-to-back hard days are fine.`});
                }
            }
        }
    }

    // base weeks: mostly easy
    for(const w of weeks) {
        const focus = add.find(a => a.week_of === w)?.focus ?? '';
        if(!/base/i.test(focus)) continue;
        let easy = 0, all = 0;
        for(let i = 0; i < 7; i++) for(const wk of plannedWorkouts.get(addDays(w, i)) ?? []) {
            const e = easySeconds(wk, ftp);
            easy += e.easy; all += e.all;
        }
        if(all && easy / all < LIMITS.baseEasyShare) {
            findings.push({rule: 'base', week_of: w, message: `Week of ${w} is a base week but only ${r0(easy / all * 100)} % of its riding is in Z1–Z2 (under ${LIMITS.easyPct} % FTP); at least ${LIMITS.baseEasyShare * 100} %.`});
        }
    }

    // recovery weeks in a longer block
    if(opts.recovery && weeks.length >= LIMITS.recoveryEvery) {
        const weekTss = w => Array.from({length: 7}, (_, i) => tssOn(addDays(w, i))).reduce((a, b) => a + b, 0);
        let run = 0;
        for(const w of weeks) {
            const before = [1, 2, 3].map(k => weekTss(addDays(w, -7 * k)));
            const easier = weekTss(w) <= LIMITS.recoveryShare * Math.max(...before, 0);
            run = easier ? 0 : run + 1;
            if(run >= LIMITS.recoveryEvery) {
                findings.push({rule: 'recovery', week_of: w, message: `Week of ${w} is the ${LIMITS.recoveryEvery}th week in a row without an easier week; make it (or one before it) a recovery week at about ${r0(LIMITS.recoveryShare * 100)} % or less of the hardest week before it.`});
                run = 0;
            }
        }
    }

    return {passed: findings.length === 0, findings, weeks: weekly};
}

export { buildWorkout, resolveWorkout, checkPlan, workoutProblems, intervalsOf, writeWorkout, LIMITS };
