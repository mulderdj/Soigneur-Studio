//
// The extra charts as UPlotCard models (see uplot-chart.js): {model, readout(i)}.
// The numbers come from src/analysis/insights.js.
//
//   repsChart(ride, colors)           ride = {analysis, ftp}
//   recoveryChart(ride, colors)       ride = {samples, analysis, ftp, pauses}
//   rideCurveChart(ride, colors)      ride = {samples, summaries, today, id}
//   powerHrChart(ride, colors)        ride = {samples, pauses}
//   efficiencyChart(data, colors)     data = {summaries}
//   readinessChart(data, x, colors)   data = {summaries, wellness}; x 'hrv' | 'sleep'
//   polarisedChart(data, colors)      data = {summaries, today}
//

import { reps, hrRecovery, rideCurve, powerHr, efficiency, readinessPairs, polarised } from '../../analysis/insights.js';
import { meanMaximal } from '../../training/rider-model.js';
import { DURATIONS } from '../../training/summary.js';
import { fmtDay } from '../training/format.js';
import { daySec, shortDay, durationLabel, weekTitle } from '../training/chart-models.js';

const num = x => Number.isFinite(x);
const pct = x => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)} %`;
const empty = () => ({model: {x: [], series: []}, readout: () => null});

// --- per ride ---------------------------------------------------------------

function repsChart({analysis, ftp}, c = {}) {
    const list = reps(analysis, ftp);
    if(list.length < 2) return empty();
    const model = {
        time: false,
        x: list.map(r => r.n),
        xTicks: list.map(r => r.n),
        xRange: [0.5, list.length + 0.5],
        xFormat: n => `${n}`,
        series: [
            {label: 'Power', color: c.accent, kind: 'bars', values: list.map(r => r.power)},
            ...(list.some(r => num(r.target)) ? [{label: 'Target', color: c.muted, values: list.map(r => r.target), dash: [5, 4], width: 2, points: true}] : []),
            ...(list.some(r => num(r.hr)) ? [
                {label: 'Heart rate', color: c.hr, values: list.map(r => r.hr), scale: 'y2', width: 2, points: true},
                {label: 'Max heart rate', color: c.hr, values: list.map(r => r.maxHr), scale: 'y2', width: 1, dash: [2, 3]},
            ] : []),
        ],
        yRange: [0, null],
        yFormat: v => `${v}`,
        y2Format: v => `${v}`,
    };
    const readout = (i) => {
        const r = list[i];
        if(!r) return null;
        return {title: `Effort ${r.n}`, rows: [
            {label: 'Power', color: c.accent, value: num(r.power) ? `${r.power} W` : '–'},
            ...(num(r.target) ? [{label: 'Target', color: c.muted, value: `${r.target} W`}] : []),
            ...(num(r.hr) ? [{label: 'Heart rate', color: c.hr, value: `${r.hr} bpm`, note: num(r.maxHr) ? `max ${r.maxHr}` : undefined}] : []),
        ], more: []};
    };
    return {model, readout, list};
}

function recoveryChart({samples, analysis, ftp, pauses}, c = {}) {
    const list = hrRecovery(samples, analysis, ftp, pauses);
    if(!list.length) return empty();
    const model = {
        time: false,
        x: list.map(r => r.n),
        xTicks: list.map(r => r.n),
        xRange: [0.5, list.length + 0.5],
        xFormat: n => `${n}`,
        series: [{label: 'Drop in 60 s', color: c.good, kind: 'bars', values: list.map(r => r.drop)}],
        yRange: [0, null],
        yFormat: v => `${v}`,
    };
    const readout = (i) => {
        const r = list[i];
        if(!r) return null;
        return {title: `After effort ${r.n}`, rows: [
            {label: 'Drop in 60 s', color: c.good, value: `${r.drop} bpm`},
            {label: 'At the end', value: `${r.hrEnd} bpm`},
            {label: '60 s later', value: `${r.hr60} bpm`},
        ], more: []};
    };
    return {model, readout, list};
}

function rideCurveChart({samples, summaries = [], today, id}, c = {}) {
    const mine = rideCurve(samples);
    const others = summaries.filter(s => s.id !== id);
    const best = meanMaximal(others, today);
    const xs = DURATIONS.filter(d => num(mine[d]));
    if(xs.length < 3) return empty();
    const ref = d => (num(best[d]?.watts) ? best[d].watts : (num(best[d]) ? best[d] : null));
    const model = {
        time: false, log: true,
        x: xs,
        xTicks: [1, 5, 15, 60, 300, 1200, 3600].filter(t => t <= xs[xs.length - 1]),
        xFormat: durationLabel,
        series: [
            {label: 'Last 90 days', color: c.muted, values: xs.map(ref), width: 2, dash: [5, 4]},
            {label: 'This ride', color: c.accent, values: xs.map(d => mine[d]), width: 2, points: true},
        ],
        yFormat: v => `${v}`,
    };
    const readout = (i) => {
        const d = xs[i];
        if(!num(d)) return null;
        const r = ref(d);
        return {title: durationLabel(d), rows: [
            {label: 'This ride', color: c.accent, value: `${mine[d]} W`, note: num(r) && r > 0 ? `${Math.round(mine[d] / r * 100)} % of your 90-day best` : undefined},
            ...(num(r) ? [{label: 'Last 90 days', color: c.muted, value: `${r} W`}] : []),
        ], more: []};
    };
    return {model, readout, mine, best: Object.fromEntries(xs.map(d => [d, ref(d)]))};
}

function powerHrChart({samples, pauses}, c = {}) {
    const pts = powerHr(samples, pauses).sort((a, b) => a.power - b.power || a.t - b.t);
    if(!pts.length) return empty();
    const model = {
        time: false,
        x: pts.map(p => p.power),
        xFormat: v => `${v} W`,
        series: [
            {label: 'First half', color: c.accent, kind: 'points', values: pts.map(p => (p.half === 1 ? p.hr : null))},
            {label: 'Second half', color: c.hr, kind: 'points', values: pts.map(p => (p.half === 2 ? p.hr : null))},
        ],
        yFormat: v => `${v}`,
    };
    const readout = (i) => {
        const p = pts[i];
        if(!p) return null;
        const m = Math.floor(p.t / 60), s = p.t % 60;
        return {title: `${m}:${String(s).padStart(2, '0')} into the ride`, rows: [
            {label: 'Power', value: `${p.power} W`},
            {label: 'Heart rate', color: p.half === 1 ? c.accent : c.hr, value: `${p.hr} bpm`, note: p.half === 1 ? 'first half' : 'second half'},
        ], more: []};
    };
    return {model, readout, points: pts};
}

// --- over time --------------------------------------------------------------

function efficiencyChart({summaries = []}, c = {}) {
    const list = efficiency(summaries);
    if(!list.length) return empty();
    const model = {
        x: list.map(p => daySec(p.day)),
        series: [
            {label: 'Ride', color: c.accent, kind: 'points', values: list.map(p => p.ef)},
            {label: '28 days', color: c.good, values: list.rolling, width: 2},
        ],
        ranges: [['3m', '3 months'], ['1y', '1 year'], ['all', 'All']],
        defaultRange: '1y',
        yFormat: v => v.toFixed(2),
    };
    const readout = (i) => {
        const p = list[i];
        if(!p) return null;
        return {title: shortDay(p.day), day: p.day, rows: [
            {label: 'Efficiency', color: c.accent, value: p.ef.toFixed(2), note: p.name},
            {label: '28-day mean', color: c.good, value: num(list.rolling[i]) ? list.rolling[i].toFixed(2) : '–'},
        ], more: []};
    };
    return {model, readout, list};
}

function readinessChart({summaries = [], wellness = []}, x = 'hrv', c = {}) {
    const out = readinessPairs(summaries, wellness, x);
    const pts = [...out.points].sort((a, b) => a.x - b.x);
    if(!pts.length) return {...empty(), stats: out};
    const model = {
        time: false,
        x: pts.map(p => p.x),
        xFormat: x === 'sleep' ? v => `${v} h` : v => `${v > 0 ? '+' : ''}${v} %`,
        series: [{label: 'Ride', color: c.accent, kind: 'points', values: pts.map(p => p.y)}],
        yFormat: v => `${v > 0 ? '+' : ''}${v} %`,
        marks: {zero: true},
    };
    const readout = (i) => {
        const p = pts[i];
        if(!p) return null;
        return {title: shortDay(p.day), day: p.day, rows: [
            {label: x === 'sleep' ? 'Sleep' : 'HRV', value: x === 'sleep' ? `${p.x} h` : `${pct(p.x)} of your normal`},
            {label: 'Efficiency', color: c.accent, value: `${pct(p.y)} of your usual`, note: p.name},
        ], more: []};
    };
    return {model, readout, stats: out};
}

function polarisedChart({summaries = [], today}, c = {}) {
    const weeks = polarised(summaries, today, 52);
    if(!weeks.some(w => w.seconds > 0)) return empty();
    const p = v => Math.round(v * 1000) / 10;
    const model = {
        x: weeks.map(w => daySec(w.week)),
        // stacked: each bar is drawn up to its running total
        series: [
            {label: 'Hard (Z6–Z7)', color: c.hard, kind: 'bars', values: weeks.map(w => (w.seconds ? 100 : null))},
            {label: 'Middle (Z3–Z5)', color: c.middle, kind: 'bars', values: weeks.map(w => (w.seconds ? p(w.easy + w.middle) : null))},
            {label: 'Easy (Z1–Z2)', color: c.easy, kind: 'bars', values: weeks.map(w => (w.seconds ? p(w.easy) : null))},
        ],
        ranges: [['12w', '12 weeks'], ['52w', '1 year']],
        defaultRange: '12w',
        today: daySec(today),
        xFormat: t => shortDay(new Date(t * 1000).toISOString().slice(0, 10)),
        yRange: [0, 100],
        yFormat: v => `${v} %`,
    };
    const readout = (i) => {
        const w = weeks[i];
        if(!w || !w.seconds) return null;
        return {title: weekTitle(w.week), rows: [
            {label: 'Easy (Z1–Z2)', color: c.easy, value: `${Math.round(w.easy * 100)} %`},
            {label: 'Middle (Z3–Z5)', color: c.middle, value: `${Math.round(w.middle * 100)} %`},
            {label: 'Hard (Z6–Z7)', color: c.hard, value: `${Math.round(w.hard * 100)} %`},
        ], more: []};
    };
    return {model, readout, weeks};
}

export { repsChart, recoveryChart, rideCurveChart, powerHrChart, efficiencyChart, readinessChart, polarisedChart };
