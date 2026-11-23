//
// Formatting for the Training page.
//

import { dayToDate } from '../../training/dates.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// 3900 s -> "1:05"
function fmtDuration(seconds) {
    const m = Math.round((seconds ?? 0) / 60);
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

function fmtHours(hours) {
    return hours >= 10 ? hours.toFixed(0) : hours.toFixed(1);
}

function fmtDay(day, opts = {weekday: 'short', day: 'numeric', month: 'short'}) {
    return dayToDate(day).toLocaleDateString(undefined, opts);
}

function fmtMonth(day) {
    return dayToDate(day).toLocaleDateString('en-GB', {month: 'long', year: 'numeric'});
}

function fmtTss(x) {
    return Number.isFinite(x) ? String(Math.round(x)) : '–';
}

// a ride's sport from intervals.icu; '' for cycling (the default)
const SPORTS = {weighttraining: 'Strength', virtualrun: 'Virtual run', alpineski: 'Ski', backcountryski: 'Ski touring'};

function sportLabel(sport) {
    if(!sport || sport === 'cycling') return '';
    const s = String(sport).toLowerCase();
    return SPORTS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

// the intervals.icu sync status: "412 activities · 12 from Strava weren't available"
const SOURCES = {STRAVA: 'Strava', GARMIN_CONNECT: 'Garmin', GARMIN: 'Garmin', WAHOO: 'Wahoo', ZWIFT: 'Zwift',
                 POLAR: 'Polar', SUUNTO: 'Suunto', COROS: 'Coros', UPLOAD: 'uploads', UNKNOWN: 'an unknown source'};

function syncCounts(sync) {
    if(!sync) return '';
    const n = Number(sync.stored) || 0;
    const text = `${n} ${n === 1 ? 'activity' : 'activities'}`;
    const skipped = Object.entries(sync.skipped ?? {}).filter(([, k]) => k > 0)
          .map(([src, k]) => `${k} from ${SOURCES[src] ?? src.charAt(0) + src.slice(1).toLowerCase()}`);
    return skipped.length ? `${text} · ${skipped.join(', ')} weren't available` : text;
}

export { esc, fmtDuration, fmtHours, fmtDay, fmtMonth, fmtTss, sportLabel, syncCounts };
