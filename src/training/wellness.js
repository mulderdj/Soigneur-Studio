//
// Health days (from Garmin): last night's HRV against the rider's normal
// range, and resting heart rate against its recent average.
//
// Day = {day, hrv, hrvBaseline: {low, high}, restingHr, sleepSeconds,
//        sleepScore, bodyBattery, stress, weight, vo2max}
//

const OWN_DAYS = 60;      // the rider's own normal range: the last 60 days
const MIN_NIGHTS = 14;    // ...from at least 14 nights
const REST_DAYS = 30;

const DAY_MS = 86400000;
const minus = (day, n) => new Date(Date.parse(day) - n * DAY_MS).toISOString().slice(0, 10);
const has = (x) => Number.isFinite(x) && x > 0;

function sorted(days) {
    return [...(days ?? [])].filter(d => typeof d?.day === 'string').sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

function latestNight(days) {
    const list = sorted(days);
    for(let i = list.length - 1; i >= 0; i--) {
        const d = list[i];
        if(has(d.hrv) || has(d.restingHr) || has(d.sleepSeconds) || has(d.bodyBattery)) return d;
    }
    return null;
}

// Garmin's baseline for the latest night with HRV, else mean ± 1 SD of the
// rider's own last 60 days
function hrvRange(days) {
    const withHrv = sorted(days).filter(d => has(d.hrv));
    const last = withHrv.at(-1);
    if(!last) return null;
    const b = last.hrvBaseline;
    if(has(b?.low) && has(b?.high)) return {low: b.low, high: b.high, source: 'garmin'};
    const from = minus(last.day, OWN_DAYS - 1);
    const values = withHrv.filter(d => d.day >= from).map(d => d.hrv);
    if(values.length < MIN_NIGHTS) return null;
    const mean = values.reduce((a, x) => a + x, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, x) => a + (x - mean) ** 2, 0) / values.length);
    return {low: Math.round(mean - sd), high: Math.round(mean + sd), source: 'own'};
}

// the normal range of one night: Garmin's baseline stored with it, else
// mean ± 1 SD over the 60 days before it (at least 14 nights); so a night
// months ago is judged against the range it had then, not today's
function hrvRangeOn(day, days) {
    const list = sorted(days);
    const night = list.find(d => d.day === day);
    const b = night?.hrvBaseline;
    if(has(b?.low) && has(b?.high)) return {low: b.low, high: b.high, source: 'garmin'};
    const from = minus(day, OWN_DAYS);
    const values = list.filter(d => d.day >= from && d.day < day && has(d.hrv)).map(d => d.hrv);
    if(values.length < MIN_NIGHTS) return null;
    const mean = values.reduce((a, x) => a + x, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, x) => a + (x - mean) ** 2, 0) / values.length);
    return {low: Math.round(mean - sd), high: Math.round(mean + sd), source: 'own'};
}

function hrvState(value, range) {
    if(!has(value) || !range) return null;
    if(value < range.low) return 'below';
    if(value > range.high) return 'above';
    return 'in';
}

function restingTrend(days) {
    const withRest = sorted(days).filter(d => has(d.restingHr));
    const last = withRest.at(-1);
    if(!last) return null;
    const from = minus(last.day, REST_DAYS);
    const before = withRest.filter(d => d.day >= from && d.day < last.day).map(d => d.restingHr);
    return {
        value: last.restingHr,
        average: before.length ? Math.round(before.reduce((a, x) => a + x, 0) / before.length) : null,
        day: last.day,
    };
}

export { hrvRange, hrvRangeOn, hrvState, latestNight, restingTrend, sorted as sortedDays };
