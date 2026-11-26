// @ts-check
//
// Local calendar days as 'YYYY-MM-DD' strings. All day arithmetic goes
// through local-noon Dates, so daylight-saving changes never move a day.
// Weeks start on Monday.
//

const DAY_MS = 86400000;

function pad(n) {
    return String(n).padStart(2, '0');
}

function format(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDay(ms) {
    return format(new Date(ms));
}

function dayToDate(day) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function addDays(day, n) {
    const date = dayToDate(day);
    date.setDate(date.getDate() + n);
    return format(date);
}

function daysBetween(a, b) {
    return Math.round((dayToDate(b).getTime() - dayToDate(a).getTime()) / DAY_MS);
}

function weekStart(day) {
    const weekday = (dayToDate(day).getDay() + 6) % 7; // Monday = 0
    return addDays(day, -weekday);
}

function monthStart(day) {
    return `${day.slice(0, 7)}-01`;
}

function today() {
    return localDay(Date.now());
}

export { localDay, dayToDate, addDays, daysBetween, weekStart, monthStart, today };
