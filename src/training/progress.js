//
// Progress statistics over ride summaries: weekly volume, this week vs.
// last week, power curve, estimated FTP and time in zones.
//

import { addDays, daysBetween, weekStart, monthStart } from './dates.js';

const WINDOWS = [5, 60, 300, 1200, 3600];
const RECENT_DAYS = 42;

function num(x) {
    return Number.isFinite(x) ? x : 0;
}

function totals(list) {
    return {
        rides: list.length,
        hours: list.reduce((a, s) => a + num(s.duration), 0) / 3600,
        tss:   list.reduce((a, s) => a + num(s.tss), 0),
        kj:    list.reduce((a, s) => a + num(s.kj), 0),
    };
}

function between(summaries, from, to) {
    return summaries.filter(s => s.day >= from && s.day <= to);
}

// the last `weeks` Monday-starting weeks, oldest first, ending with this week
function weekStarts(today, weeks) {
    const current = weekStart(today);
    return Array.from({length: weeks}, (_, i) => addDays(current, -7 * (weeks - 1 - i)));
}

function weeklyVolume(summaries, today, weeks = 12) {
    return weekStarts(today, weeks).map(week => ({week, ...totals(between(summaries, week, addDays(week, 6)))}));
}

function weekCompare(summaries, today) {
    const monday = weekStart(today);
    const upTo = daysBetween(monday, today);
    const lastMonday = addDays(monday, -7);
    return {
        current:  totals(between(summaries, monday, today)),
        previous: totals(between(summaries, lastMonday, addDays(lastMonday, upTo))),
    };
}

function bests(list) {
    const watts = WINDOWS.map(() => null);
    const wkg = WINDOWS.map(() => null);
    for(const s of list) {
        WINDOWS.forEach((w, i) => {
            const b = s.best?.[w];
            if(Number.isFinite(b) && b > 0 && (watts[i] === null || b > watts[i])) {
                watts[i] = b;
                wkg[i] = s.weight > 0 ? b / s.weight : null;
            }
        });
    }
    return {watts, wkg};
}

function powerCurve(summaries, today) {
    return {
        windows: WINDOWS,
        recent: bests(between(summaries, addDays(today, -(RECENT_DAYS - 1)), today)),
        allTime: bests(summaries.filter(s => s.day <= today)),
    };
}

function ftpEstimate(list) {
    const {watts} = bests(list);
    const b20 = watts[WINDOWS.indexOf(1200)];
    const b60 = watts[WINDOWS.indexOf(3600)];
    if(b20 === null && b60 === null) return null;
    return Math.max(b20 === null ? 0 : 0.95 * b20, b60 ?? 0);
}

function ftpEstimates(summaries, today, weeks = 12) {
    return weekStarts(today, weeks).map(week => {
        const end = addDays(week, 6) < today ? addDays(week, 6) : today;
        return {week, ftp: ftpEstimate(between(summaries, addDays(end, -(RECENT_DAYS - 1)), end))};
    });
}

function sumZones(list) {
    const seconds = Array(7).fill(0);
    for(const s of list) (s.zoneSeconds ?? []).forEach((x, i) => { if(i < 7) seconds[i] += num(x); });
    return seconds;
}

function zoneTotals(summaries, today, by = 'week', count = 12) {
    if(by === 'month') {
        const months = [monthStart(today)];
        while(months.length < count) months.unshift(monthStart(addDays(months[0], -1)));
        return months.map((period, i) => {
            const next = months[i + 1] ?? addDays(monthStart(addDays(period, 31)), 0);
            return {period, seconds: sumZones(summaries.filter(s => s.day >= period && s.day < next && s.day <= today))};
        });
    }
    return weekStarts(today, count).map(period =>
        ({period, seconds: sumZones(between(summaries, period, addDays(period, 6)))}));
}

export { weeklyVolume, weekCompare, powerCurve, ftpEstimates, zoneTotals, WINDOWS, RECENT_DAYS };
