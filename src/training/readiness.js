//
// Readiness: one verdict for today — 'ready', 'take-care' or 'rest' — with
// its reasons, from last night's health data (Garmin) and the training load;
// and the helpers for a hard planned workout on a bad morning.
//
//   readiness({today, days, summaries, plan, ftp}) → {state, reasons, signals, basis}
//   isHard(workout, ftp), easier(workout, ftp), recoverySpin(), nextFreeDay(plan, today)
//
// Rules (the rider's choice, "Balanced"):
//   rest       HRV below its range 2+ nights running; or HRV below and resting
//              HR +5 bpm or more; or under 5 h of sleep after a hard day (≥ 100 TSS)
//   take care  one of: HRV below range; resting HR +3 bpm or more; under 6 h of
//              sleep; Body Battery under 30; form under −30
//   ready      otherwise
//

import { dailyTss, pmc } from './load.js';
import { hrvRangeOn, sortedDays } from './wellness.js';
import { fmtDuration } from '../views/training/format.js';

const DAY_MS = 86400000;
const addDays = (day, n) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);
const has = x => Number.isFinite(x) && x > 0;
const ordinal = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

const RHR_UP = 3, RHR_WAY_UP = 5;
const SLEEP_SHORT = 6 * 3600, SLEEP_VERY_SHORT = 5 * 3600;
const BATTERY_LOW = 30;
const FORM_TIRED = -30;
const HARD_DAY_TSS = 100;
const REST_AVERAGE_DAYS = 30;

const anyHealth = d => [d?.hrv, d?.restingHr, d?.sleepSeconds, d?.bodyBattery].some(has);

function readiness({today, days = [], summaries = [], ftp = 250} = {}) {
    const list = sortedDays(days);
    // last night: Garmin files it under the morning's date; a day behind still counts
    const night = [today, addDays(today, -1)].map(d => list.find(x => x.day === d)).find(anyHealth) ?? null;

    // training load: form today, yesterday's load
    const byDay = dailyTss(summaries);
    const first = summaries.reduce((a, s) => (s?.day && s.day < a ? s.day : a), today);
    const rows = pmc(byDay, first, today);
    const form = rows.length ? Math.round(rows.at(-1).tsb) : 0;
    const yesterday = Math.round(byDay.get(addDays(today, -1)) ?? 0);

    const rest = [], care = [], fine = [];
    const signals = {form, yesterdayTss: yesterday};

    if(form < FORM_TIRED) care.push(`Very fatigued from training: form ${signed(form)}`);
    const formFine = form < FORM_TIRED ? [] : [`Form ${signed(form)}`];      // last among the good signs

    if(!night) {
        const reasons = [...care, 'No health data from last night: this is from your training load only.', ...formFine];
        return {state: care.length ? 'take-care' : 'ready', reasons, signals, basis: 'form'};
    }

    // HRV against that night's range, and nights below in a row
    const range = has(night.hrv) ? hrvRangeOn(night.day, list) : null;
    if(range) {
        signals.hrv = night.hrv; signals.range = range;
        const span = `${range.low}–${range.high}`;
        let below = 0;
        for(let d = night.day; ; d = addDays(d, -1)) {
            const n = list.find(x => x.day === d);
            const r = n && has(n.hrv) ? hrvRangeOn(d, list) : null;
            if(!r || n.hrv >= r.low) break;
            below++;
        }
        signals.nightsBelow = below;
        if(below >= 2) rest.push(`HRV ${night.hrv} ms, below your range (${span}) for the ${ordinal(below)} night`);
        else if(below === 1) care.push(`HRV ${night.hrv} ms, below your range (${span})`);
        else if(night.hrv > range.high) fine.push(`HRV ${night.hrv} ms, above your range (${span})`);
        else fine.push(`HRV ${night.hrv} ms in your range (${span})`);
    }

    // resting HR against its 30-day average before that night (at least 7 nights)
    if(has(night.restingHr)) {
        const from = addDays(night.day, -REST_AVERAGE_DAYS);
        const before = list.filter(d => d.day >= from && d.day < night.day && has(d.restingHr)).map(d => d.restingHr);
        if(before.length >= 7) {
            const diff = Math.round(night.restingHr - before.reduce((a, x) => a + x, 0) / before.length);
            signals.restingDiff = diff;
            const text = `Resting heart rate ${signed(diff)} bpm against your 30-day average`;
            if(diff >= RHR_UP) care.push(text); else fine.push(`Resting heart rate ${night.restingHr} bpm, as usual`);
            if(diff >= RHR_WAY_UP && signals.nightsBelow >= 1 && rest.length === 0) {
                rest.push(care.splice(care.findIndex(r => r.startsWith('HRV')), 1)[0] ?? `HRV below your range`);
            }
        }
    }

    // sleep and Body Battery
    if(has(night.sleepSeconds)) {
        signals.sleep = night.sleepSeconds;
        const slept = fmtDuration(night.sleepSeconds);
        if(night.sleepSeconds < SLEEP_VERY_SHORT && yesterday >= HARD_DAY_TSS) rest.push(`Short night after a hard day: slept ${slept} after ${yesterday} TSS`);
        else if(night.sleepSeconds < SLEEP_SHORT) care.push(`Short night: slept ${slept}`);
        else fine.push(`Slept ${slept}`);
    }
    if(has(night.bodyBattery)) {
        signals.bodyBattery = night.bodyBattery;
        if(night.bodyBattery < BATTERY_LOW) care.push(`Body Battery ${night.bodyBattery} this morning`);
        else fine.push(`Body Battery ${night.bodyBattery}`);
    }

    const state = rest.length ? 'rest' : care.length ? 'take-care' : 'ready';
    return {state, reasons: [...rest, ...care, ...fine, ...formFine], signals, basis: 'health'};
}

// --- hard workouts and easier versions ---------------------------------------

const WATTS_FROM = 10;              // as plan.js: 10 and up is watts, below is relative to FTP
const HARD = {at: 0.88, minutes: 10, above: 1.05, aboveMinutes: 3};
const EASIER_CAP = 0.85;

const fraction = (p, ftp) => (p >= WATTS_FROM ? (ftp > 0 ? p / ftp : 0) : p);

function steps(workout) {
    return (workout?.intervals ?? []).flatMap(iv => (iv.steps?.length ? iv.steps : [{duration: iv.duration, power: iv.power}])
        .map(s => ({duration: Number.isFinite(s.duration) ? s.duration : (iv.duration ?? 0), power: s.power})));
}

function isHard(workout, ftp = 250) {
    let at = 0, above = 0;
    for(const s of steps(workout)) {
        if(!has(s.power)) continue;
        const f = fraction(s.power, ftp);
        if(f >= HARD.at) at += s.duration;
        if(f > HARD.above) above += s.duration;
    }
    return at >= HARD.minutes * 60 || above >= HARD.aboveMinutes * 60;
}

// the same workout, every step above 85 % FTP brought down to 85 % (units kept)
function easier(workout, ftp = 250) {
    const w = JSON.parse(JSON.stringify(workout));
    const cap = p => {
        if(!has(p)) return p;
        if(p >= WATTS_FROM) return ftp > 0 && p / ftp > EASIER_CAP ? Math.round(EASIER_CAP * ftp) : p;
        return p > EASIER_CAP ? EASIER_CAP : p;
    };
    for(const iv of w.intervals ?? []) {
        if(has(iv.power)) iv.power = cap(iv.power);
        for(const s of iv.steps ?? []) if(has(s.power)) s.power = cap(s.power);
    }
    w.meta = {...(w.meta ?? {}), name: `${w.meta?.name ?? 'Workout'} (easier)`};
    w.id = `${w.id ?? 'workout'}-easier`;
    return w;
}

function recoverySpin() {
    const iv = (duration, power) => ({duration, steps: [{duration, power}]});
    return {
        id: 'readiness-recovery-spin',
        meta: {name: 'Recovery spin', category: 'Recovery', author: 'Soigneur', description: '30 minutes easy, to recover.'},
        intervals: [iv(300, 0.45), iv(1200, 0.52), iv(300, 0.45)],
    };
}

function nextFreeDay(plan = [], today) {
    const taken = new Set(plan.filter(e => !e.deleted).map(e => e.day));
    for(let i = 1; i <= 7; i++) {
        const d = addDays(today, i);
        if(!taken.has(d)) return d;
    }
    return null;
}

export { readiness, isHard, easier, recoverySpin, nextFreeDay };
