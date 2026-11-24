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
import { weeklyVolume, zoneTotals, powerCurve, ftpEstimates, WINDOWS } from '../../training/progress.js';
import { addDays } from '../../training/dates.js';
import { ZONES } from '../../analytics.js';
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

// "23–29 Nov 2026", "26 Oct – 1 Nov 2026": the browser's own date-range
// format, in the rider's language
function weekTitle(week, locale = undefined) {
    const f = new Intl.DateTimeFormat(locale, {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
    return f.formatRange(new Date(daySec(week) * 1000), new Date(daySec(addDays(week, 6)) * 1000));
}
const monthTitle = (month) => fmtDay(month, {month: 'long', year: 'numeric'});
const shortDay = (day) => fmtDay(day, {day: 'numeric', month: 'short'});

// weekly hours, TSS or kJ as bars, a year of weeks, opening on 12
function volumeChart(data, metric = 'hours', colors = {}) {
    const weeks = weeklyVolume(data.summaries ?? [], data.today, 52);
    const model = {
        x: weeks.map(w => daySec(w.week)),
        series: [{label: metric, color: colors.accent, kind: 'bars', values: weeks.map(w => w[metric] ?? 0)}],
        ranges: [['12w', '12 weeks'], ['1y', '1 year']],
        defaultRange: '12w',
        today: daySec(data.today),
        xFormat: (t) => shortDay(new Date(t * 1000).toISOString().slice(0, 10)),
    };
    const readout = (i) => {
        const w = weeks[i];
        if(!w) return null;
        return {
            title: weekTitle(w.week),
            rows: [
                {label: 'Hours', value: fmtDuration(w.hours * 3600)},
                {label: 'TSS', value: String(Math.round(w.tss))},
                {label: 'kJ', value: String(Math.round(w.kj))},
                {label: 'Rides', value: String(w.rides)},
            ],
            more: [],
        };
    };
    return {model, readout};
}

// time in each zone as stacked bars: 52 weeks (opening on 12) or 12 months.
// Stacking: each series holds the running total from zone 1 up, the top
// one first, so the bars drawn later (lower zones) sit in front.
function zonesChart(data, by = 'week', colors = {}) {
    const periods = zoneTotals(data.summaries ?? [], data.today, by, by === 'month' ? 12 : 52);
    const hours = periods.map(p => p.seconds.map(s => s / 3600));
    const cumulative = (z) => hours.map(h => h.slice(0, z + 1).reduce((a, x) => a + x, 0));
    const model = {
        x: periods.map(p => daySec(p.period)),
        series: [6, 5, 4, 3, 2, 1, 0].map(z => ({label: ZONES[z].name, color: colors.zones?.[z], kind: 'bars', values: cumulative(z)})),
        ranges: by === 'month' ? [] : [['12w', '12 weeks'], ['52w', '1 year']],
        defaultRange: by === 'month' ? 'all' : '12w',
        today: daySec(data.today),
        xFormat: (t) => {
            const d = new Date(t * 1000).toISOString().slice(0, 10);
            return by === 'month' ? fmtDay(d, {month: 'short'}) : shortDay(d);
        },
        yFormat: (v) => `${v}h`,
    };
    const readout = (i) => {
        const p = periods[i];
        if(!p) return null;
        const total = p.seconds.reduce((a, s) => a + s, 0);
        return {
            title: by === 'month' ? monthTitle(p.period) : weekTitle(p.period),
            rows: [
                ...p.seconds.map((s, z) => ({label: ZONES[z].name, color: colors.zones?.[z], value: fmtDuration(s), s})).filter(r => r.s > 0)
                    .map(({s, ...r}) => r),
                {label: 'Total', value: fmtDuration(total)},
            ],
            more: [],
        };
    };
    return {model, readout};
}

const DURATION_LABEL = {5: '5 s', 60: '1 min', 300: '5 min', 1200: '20 min', 3600: '60 min'};
// 1 s … 59 s, 1 min … 59 min, 1 h, 1.5 h, 2 h
const durationLabel = s => (DURATION_LABEL[s] ?? (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${+(s / 3600).toFixed(1)} h`));
const recordNote = (from) => (from ? `${shortDay(from.day)}${from.name ? ` · ${from.name}` : ''}` : undefined);

// best power at 5 s … 60 min: the last 6 weeks against all time, as lines
// with points on a log time axis; W or W/kg (unit 'w' or 'wkg')
// the rider model's curve, P = CP + W′/t, over the durations it's fitted on
const MODEL_FROM = 120, MODEL_TO = 1200;
// the labelled durations on the log axis
const TICKS = [1, 5, 15, 60, 300, 1200, 3600, 7200];

function curveChart(data, unit = 'w', colors = {}, fit = null) {
    const c = powerCurve(data.summaries ?? [], data.today);
    const key = unit === 'wkg' ? 'wkg' : 'watts';
    const val = (v) => (v === null || v === undefined ? null : key === 'wkg' ? Math.round(v * 100) / 100 : Math.round(v));
    const show = (v) => (v === null ? '–' : key === 'wkg' ? `${v.toFixed(2)} W/kg` : `${v} W`);
    // only the durations with data (older rides keep five of them)
    const keep = WINDOWS.map((w, i) => i).filter(i => c.recent.watts[i] !== null || c.allTime.watts[i] !== null);
    const xs = keep.map(i => WINDOWS[i]);
    const recent = keep.map(i => val(c.recent[key][i])), all = keep.map(i => val(c.allTime[key][i]));
    const fromRecent = keep.map(i => c.recent.from[i]), fromAll = keep.map(i => c.allTime.from[i]);
    const model = {
        x: xs,
        time: false,
        log: true,
        series: [
            {label: 'Last 6 weeks', color: colors.accent, width: 2.5, points: true, values: recent},
            {label: 'All time', color: colors.muted, width: 1.5, points: true, values: all},
        ],
        xTicks: TICKS.filter(t => t >= xs[0] && t <= xs.at(-1)),
        xFormat: (v) => (Number.isFinite(v) ? durationLabel(v) : ''),
    };
    const perKg = key === 'wkg' ? (data.weight > 0 ? data.weight : null) : 1;
    const fitted = fit?.ok && perKg ? xs.map(t => (t >= MODEL_FROM && t <= MODEL_TO ? val((fit.cp + fit.wprime / t) / perKg) : null)) : null;
    if(fitted) {
        model.series.push({label: `Model (CP ${fit.cp} W, W′ ${(fit.wprime / 1000).toFixed(1)} kJ)`, color: colors.model, width: 1.5, dash: [5, 4], values: fitted});
    }
    const readout = (i) => {
        if(i < 0 || i >= xs.length) return null;
        const from = fromRecent[i] ?? fromAll[i];
        return {
            title: durationLabel(xs[i]),
            rows: [
                {label: 'Last 6 weeks', color: colors.accent, value: show(recent[i]), note: recordNote(fromRecent[i])},
                {label: 'All time', color: colors.muted, value: show(all[i]), note: recordNote(fromAll[i])},
                ...(fitted && fitted[i] !== null ? [{label: 'Model', color: colors.model, value: show(fitted[i]), note: 'CP + W′ / time'}] : []),
            ],
            more: [],
            day: from?.day,   // the recent record first: today's form
        };
    };
    return {model, readout};
}

// estimated FTP per week (52, opening on 12) and the set FTP
function ftpChart(data, colors = {}) {
    const est = ftpEstimates(data.summaries ?? [], data.today, 52);
    const set = Number.isFinite(data.ftp) ? data.ftp : null;
    const model = {
        x: est.map(e => daySec(e.week)),
        series: [
            {label: 'Set FTP', color: colors.muted, width: 1, dash: [4, 4], values: est.map(() => set)},
            {label: 'Estimate', color: colors.accent, width: 2.5, points: true, values: est.map(e => (e.ftp === null ? null : Math.round(e.ftp)))},
        ],
        ranges: [['12w', '12 weeks'], ['1y', '1 year']],
        defaultRange: '12w',
        today: daySec(data.today),
        xFormat: (t) => shortDay(new Date(t * 1000).toISOString().slice(0, 10)),
    };
    const readout = (i) => {
        const e = est[i];
        if(!e) return null;
        const f = e.from;
        const source = !f ? 'No 20 or 60-minute effort in the 6 weeks before' :
              f.seconds === 1200 ? `95 % of ${Math.round(f.watts)} W over 20 min · ${shortDay(f.day)}${f.name ? ` · ${f.name}` : ''}` :
              `60 min best ${Math.round(f.watts)} W · ${shortDay(f.day)}${f.name ? ` · ${f.name}` : ''}`;
        return {
            title: weekTitle(e.week),
            rows: [
                {label: 'Estimate', color: colors.accent, value: e.ftp === null ? '–' : `${Math.round(e.ftp)} W`},
                {label: 'Set', color: colors.muted, value: set === null ? '–' : `${set} W`},
            ],
            more: [source],
            day: f?.day,
        };
    };
    return {model, readout};
}

export { formModel, formChart, healthChart, volumeChart, zonesChart, curveChart, ftpChart, PAST_DAYS, AHEAD_DAYS, daySec, longDay, weekTitle, shortDay, durationLabel };
