//
// What each Training chart shows: its series and, per point, the read-out.
// Pure functions (no drawing): uplot-chart.js draws them; tests check them.
//
// Every chart function returns {model, readout(i)}; see uplot-chart.js for
// the model's shape. colors = {accent, hr, warn, band, muted, line, zones: []}.
//

import { dailyTss, pmc, forecast, formLabel } from '../../training/load.js';
import { planStatus, plannedTss } from '../../training/plan.js';
import { hrvRangeOn, sortedDays } from '../../training/wellness.js';
import { fmtDay, fmtDuration } from './format.js';

const PAST_DAYS = 90;
const AHEAD_DAYS = 28;

const daySec = (day) => Date.parse(`${day}T12:00:00Z`) / 1000;
const longDay = (day) => fmtDay(day, {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'});
const signed = (x) => `${x > 0 ? '+' : ''}${Math.round(x)}`;
const has = (x) => Number.isFinite(x);

// fitness, fatigue and form; pastDays: how far back (null: since the first ride)
function formModel({today, summaries = [], plan = [], ftp}, {pastDays = PAST_DAYS} = {}) {
    const byDay = dailyTss(summaries);
    const first = summaries.length ? summaries.reduce((a, s) => (s.day < a ? s.day : a), today) : today;
    const rows = pmc(byDay, first < today ? first : today, today);
    const now = rows.at(-1) ?? {ctl: 0, atl: 0, tsb: 0};

    const planned = new Map();
    for(const e of plan) {
        if(e.deleted || e.day <= today || planStatus(e, today) !== 'planned') continue;
        planned.set(e.day, (planned.get(e.day) ?? 0) + plannedTss(e.workout, ftp));
    }
    const ahead = forecast(now, planned, today, AHEAD_DAYS);
    const past = pastDays === null ? rows : rows.slice(-pastDays);
    return {now, past, ahead, hasPlan: planned.size > 0};
}

// all history (zoom out to it) with the forecast; opens on 3 months
function formChart(data, colors = {}) {
    const {past, ahead} = formModel(data, {pastDays: null});
    const rows = [...past, ...ahead.filter(r => r.day > (past.at(-1)?.day ?? ''))];
    const split = past.length - 1;
    const load = dailyTss(data.summaries ?? []);
    const plans = new Map();
    for(const e of data.plan ?? []) {
        if(e.deleted || planStatus(e, data.today) !== 'planned' || e.day <= data.today) continue;
        const list = plans.get(e.day) ?? [];
        list.push(`Planned: ${e.workout?.meta?.name ?? e.name ?? 'Workout'} · ${Math.round(plannedTss(e.workout, data.ftp))} TSS`);
        plans.set(e.day, list);
    }
    const until = (k) => rows.map((r, i) => (i <= split ? r[k] : null));
    const after = (k) => rows.map((r, i) => (i >= split ? r[k] : null));
    const model = {
        x: rows.map(r => daySec(r.day)),
        series: [
            {label: 'Fitness', color: colors.accent, width: 2.5, values: until('ctl')},
            {label: 'Fatigue', color: colors.hr, width: 1.5, values: until('atl')},
            {label: 'Form', color: colors.warn, width: 1.5, values: until('tsb')},
            {label: 'Fitness (plan)', color: colors.accent, width: 2.5, dash: [5, 4], values: after('ctl')},
            {label: 'Fatigue (plan)', color: colors.hr, width: 1.5, dash: [5, 4], values: after('atl')},
            {label: 'Form (plan)', color: colors.warn, width: 1.5, dash: [5, 4], values: after('tsb')},
        ],
        ranges: [['3m', '3 months'], ['1y', '1 year'], ['all', 'All']],
        defaultRange: '3m',
        today: daySec(data.today),
        zoom: true,
        sync: 'days',
        marks: {zero: true, today: daySec(data.today)},
    };
    const readout = (i) => {
        const r = rows[i];
        if(!r) return null;
        const future = i > split;
        const dayLoad = load.get(r.day);
        return {
            title: `${longDay(r.day)}${future ? ' · forecast' : ''}`,
            rows: [
                {label: 'Fitness', color: colors.accent, value: String(Math.round(r.ctl))},
                {label: 'Fatigue', color: colors.hr, value: String(Math.round(r.atl))},
                {label: 'Form', color: colors.warn, value: signed(r.tsb), note: formLabel(r.tsb).toLowerCase()},
            ],
            more: future ? (plans.get(r.day) ?? []) : (dayLoad > 0 ? [`Load that day: ${Math.round(dayLoad)} TSS`] : []),
            day: r.day,
        };
    };
    return {model, readout};
}

// HRV with each night's own normal range as a band, and resting heart rate
function healthChart(data, colors = {}) {
    const days = sortedDays(data.wellness ?? []);
    const ranges = days.map(d => hrvRangeOn(d.day, days));
    const model = {
        x: days.map(d => daySec(d.day)),
        series: [
            {label: 'Range high', color: 'transparent', width: 0, values: ranges.map(r => r?.high ?? null)},
            {label: 'Range low', color: 'transparent', width: 0, values: ranges.map(r => r?.low ?? null)},
            {label: 'HRV', color: colors.accent, width: 2.5, values: days.map(d => (has(d.hrv) ? d.hrv : null))},
            {label: 'Resting HR', color: colors.hr, width: 1.5, values: days.map(d => (has(d.restingHr) ? d.restingHr : null))},
        ],
        bands: [[1, 2, colors.band]],
        ranges: [['1m', '1 month'], ['3m', '3 months'], ['all', 'All']],
        defaultRange: '3m',
        today: daySec(data.today),
        zoom: true,
        sync: 'days',
    };
    const readout = (i) => {
        const d = days[i];
        if(!d) return null;
        const range = ranges[i];
        const rows = [];
        if(has(d.hrv)) {
            const state = !range ? null : d.hrv < range.low ? 'below' : d.hrv > range.high ? 'above' : 'in';
            rows.push({label: 'HRV', color: colors.accent, value: `${Math.round(d.hrv)} ms`,
                       note: state ? `${state} your range (${range.low}–${range.high})` : 'no range yet'});
        }
        if(has(d.restingHr)) rows.push({label: 'Resting HR', color: colors.hr, value: `${d.restingHr} bpm`});
        if(has(d.sleepSeconds)) rows.push({label: 'Sleep', value: fmtDuration(d.sleepSeconds), note: has(d.sleepScore) ? `score ${d.sleepScore}` : undefined});
        if(has(d.bodyBattery)) rows.push({label: 'Body Battery', value: String(d.bodyBattery)});
        return {title: longDay(d.day), rows, more: [], day: d.day};
    };
    return {model, readout};
}

export { formModel, formChart, healthChart, PAST_DAYS, AHEAD_DAYS, daySec, longDay };
