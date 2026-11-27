//
// The extra charts as UPlotCard models (see uplot-chart.js): {model, readout(i)}.
// The numbers come from src/analysis/insights.js.
//
//   repsChart(ride, colors)           ride = {analysis, ftp}
//   recoveryChart(ride, colors)       ride = {samples, analysis, ftp, pauses}
//   rideCurveChart(ride, colors)      ride = {samples, summaries, today, id}
//   powerHrChart(ride, colors)        ride = {samples, pauses}
//   efficiencyChart(data, colors)     data = {summaries}
//   decouplingChart(data, colors)     data = {summaries, today}
//   durabilityChart(data, dur, colors) data = {summaries, today}; dur 300 | 1200
//   readinessChart(data, x, colors)   data = {summaries, wellness}; x 'hrv' | 'sleep'
//   polarisedChart(data, colors)      data = {summaries, today}
//

import { reps, hrRecovery, rideCurve, powerHr, efficiency, decouplingTrend, durabilityTrend, readinessPairs, polarised, classifyIntensity, planCompliance, DURABILITY_KJ } from '../../analysis/insights.js';
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
    // the bars side by side, each labelled with its effort's number (efforts
    // without a full minute after them, like 40/20s, have no bar)
    const model = {
        time: false,
        x: list.map((_, i) => i + 1),
        xTicks: list.map((_, i) => i + 1),
        xRange: [0.5, list.length + 0.5],
        xFormat: i => `${list[i - 1]?.n ?? ''}`,
        series: [{label: 'Drop in 60 s', color: c.good, kind: 'bars', values: list.map(r => r.drop)}],
        // a heart rate still rising after an effort shows below zero
        yRange: [Math.min(0, ...list.map(r => r.drop)), null],
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

function decouplingChart({summaries = [], today}, c = {}) {
    const list = decouplingTrend(summaries);
    if(!list.length) return empty();
    const model = {
        x: list.map(p => daySec(p.day)),
        series: [
            {label: '5 % threshold', color: c.muted, width: 1, dash: [4, 4], values: list.map(() => 5)},
            {label: 'Ride', color: c.accent, kind: 'points', values: list.map(p => p.decoupling)},
            {label: '28 days', color: c.good, values: list.rolling, width: 2},
        ],
        ranges: [['3m', '3 months'], ['1y', '1 year'], ['all', 'All']],
        defaultRange: '1y',
        ...(today ? {today: daySec(today)} : {}),
        yFormat: v => `${v} %`,
        marks: {zero: true},
    };
    const readout = (i) => {
        const p = list[i];
        if(!p) return null;
        return {
            title: shortDay(p.day),
            day: p.day,
            rows: [
                {label: 'Decoupling', color: c.accent, value: `${p.decoupling.toFixed(1)} %`, note: p.name},
                {label: '28-day mean', color: c.good, value: num(list.rolling[i]) ? `${list.rolling[i].toFixed(1)} %` : '–'},
            ],
            more: [p.decoupling < 5 ? 'Under 5 %: heart rate held steady with power' : 'Above 5 %: heart rate drifted up against power'],
        };
    };
    return {model, readout, list};
}

const KJ_LABEL = {1000: 'After 1,000 kJ', 2000: 'After 2,000 kJ', 3000: 'After 3,000 kJ'};

function durabilityChart({summaries = [], today}, duration = 300, c = {}) {
    const colorOf = {1000: c.accent, 2000: c.good, 3000: c.warn};
    const byKj = DURABILITY_KJ.map(kj => ({kj, rows: durabilityTrend(summaries, today, {kj, duration, weeks: 52})}))
        .filter(g => g.rows.some(r => r.pct !== null));
    if(!byKj.length) return {...empty(), thresholds: []};
    const weeks = byKj[0].rows.map(r => r.week);
    const allPct = byKj.flatMap(g => g.rows.map(r => r.pct).filter(num));
    const minY = Math.min(85, Math.max(0, Math.floor((Math.min(...allPct) - 5) / 5) * 5));
    const model = {
        x: weeks.map(w => daySec(w)),
        series: byKj.map(g => ({
            label: KJ_LABEL[g.kj],
            color: colorOf[g.kj],
            width: 2,
            points: true,
            values: g.rows.map(r => r.pct),
        })),
        ranges: [['12w', '12 weeks'], ['1y', '1 year']],
        defaultRange: '12w',
        today: daySec(today),
        xFormat: t => shortDay(new Date(t * 1000).toISOString().slice(0, 10)),
        yRange: [minY, 100],
        yFormat: v => `${v} %`,
    };
    const readout = (i) => {
        const w = weeks[i];
        if(!w) return null;
        const rows = [];
        let day;
        for(const g of byKj) {
            const r = g.rows[i];
            if(!r || r.pct === null) continue;
            day = r.from?.day ?? day;
            rows.push({
                label: KJ_LABEL[g.kj],
                color: colorOf[g.kj],
                value: `${Math.round(r.pct)} %`,
                note: `${r.watts} W of ${r.fresh} W fresh${r.from?.name ? ` · ${r.from.name}` : ''}`,
            });
        }
        return {
            title: weekTitle(w),
            rows,
            more: rows.length ? [] : ['No ride past 1,000 kJ this week'],
            ...(day ? {day} : {}),
        };
    };
    return {model, readout, thresholds: byKj.map(g => g.kj)};
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
    const classification = classifyIntensity(summaries, today, {weeks: 4});
    if(!weeks.some(w => w.seconds > 0)) return {...empty(), classification};
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
    return {model, readout, weeks, classification};
}

function complianceChart({plan = [], summaries = [], today, ftp = 250}, metric = 'workouts', c = {}) {
    const out = planCompliance(plan, summaries, today, {weeks: 24, blockWeeks: 4, ftp});
    const rows = out.weeks;
    if(!rows.some(w => w.due > 0)) return {...empty(), compliance: out};
    const byLoad = metric === 'load';
    if(byLoad && !rows.some(w => w.loadPct !== null)) return {...empty(), compliance: out};
    const model = byLoad ? {
        x: rows.map(w => daySec(w.week)),
        series: [
            {label: 'Target (100 %)', color: c.muted, width: 1, dash: [4, 4], values: rows.map(() => 100)},
            {label: 'Load adherence', color: c.accent, kind: 'bars', values: rows.map(w => w.loadPct)},
            ...(rows.some(w => w.durationPct !== null) ? [{label: 'Duration adherence', color: c.good, width: 2, points: true, values: rows.map(w => w.durationPct)}] : []),
        ],
        ranges: [['12w', '12 weeks'], ['24w', '24 weeks']],
        defaultRange: '12w',
        today: daySec(today),
        xFormat: t => shortDay(new Date(t * 1000).toISOString().slice(0, 10)),
        yRange: [0, null],
        yFormat: v => `${Math.round(v)} %`,
    } : {
        x: rows.map(w => daySec(w.week)),
        // stacked: due (done + missed) behind, completed in front
        series: [
            {label: 'Missed', color: c.warn, kind: 'bars', values: rows.map(w => (w.due > 0 ? w.due : null))},
            {label: 'Completed', color: c.good, kind: 'bars', values: rows.map(w => (w.due > 0 ? w.done : null))},
        ],
        ranges: [['12w', '12 weeks'], ['24w', '24 weeks']],
        defaultRange: '12w',
        today: daySec(today),
        xFormat: t => shortDay(new Date(t * 1000).toISOString().slice(0, 10)),
        yRange: [0, null],
        yFormat: v => (Number.isInteger(v) ? `${v}` : ''),
    };
    const readout = (i) => {
        const w = rows[i];
        if(!w) return null;
        if(w.due === 0 && w.upcoming === 0) return {title: weekTitle(w.week), rows: [], more: ['No workouts planned this week']};
        return {
            title: weekTitle(w.week),
            rows: [
                ...(w.due > 0 ? [{label: 'Completed', color: c.good, value: `${w.done} of ${w.due}`, note: `${w.completionPct} %`}] : []),
                ...(w.missed > 0 ? [{label: 'Missed', color: c.warn, value: String(w.missed)}] : []),
                ...(w.upcoming > 0 ? [{label: 'Upcoming', color: c.muted, value: String(w.upcoming)}] : []),
                ...(w.loadPct !== null ? [{label: 'Load', color: c.accent, value: `${w.loadPct} %`, note: `${Math.round(w.actualTss)} / ${Math.round(w.plannedTss)} TSS`}] : []),
                ...(w.durationPct !== null ? [{label: 'Duration', color: c.good, value: `${w.durationPct} %`}] : []),
            ],
            more: [],
        };
    };
    return {model, readout, compliance: out};
}

export { repsChart, recoveryChart, rideCurveChart, powerHrChart, efficiencyChart, decouplingChart, durabilityChart, readinessChart, polarisedChart, complianceChart };
