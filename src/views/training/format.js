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

export { esc, fmtDuration, fmtHours, fmtDay, fmtMonth, fmtTss };
