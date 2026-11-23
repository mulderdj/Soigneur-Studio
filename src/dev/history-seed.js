//
// Development only: a generated training history and plan, so the Training
// page can be tried and checked without months of real rides.
//
// Open the dev server with ?simulate&history. It fills the current rider
// once (skipped when the rider already has ride summaries). Production
// builds leave this file out, like the simulated rider.
//

import { rideSummary } from '../training/summary.js';
import { addDays, dayToDate, daysBetween, weekStart } from '../training/dates.js';

// small deterministic random numbers (mulberry32)
function random(seed) {
    let t = seed >>> 0;
    return () => {
        t = (t + 0x6D2B79F5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

// workout shapes as [seconds, relative power] blocks
const SESSIONS = {
    recovery:  {name: 'Recovery spin',  blocks: [[2700, 0.5]]},
    endurance: {name: 'Endurance',      blocks: [[600, 0.55], [3600, 0.68], [300, 0.5]]},
    sweetspot: {name: 'Sweet spot 2x20', blocks: [[900, 0.6], [1200, 0.9], [300, 0.5], [1200, 0.9], [600, 0.5]]},
    vo2:       {name: 'VO2 max 5x4',    blocks: [[900, 0.6], ...Array.from({length: 5}, () => [[240, 1.15], [240, 0.5]]).flat(), [600, 0.5]]},
    long:      {name: 'Long ride',      blocks: [[600, 0.55], [6600, 0.67], [300, 0.5]]},
};

// Monday rest, Friday easy, Saturday long
const WEEK = ['rest', 'vo2', 'endurance', 'sweetspot', 'recovery', 'long', 'endurance'];

function toWorkout(key) {
    const s = SESSIONS[key];
    return {
        id: `seed-${key}`,
        meta: {name: s.name, category: 'Generated', author: 'Auuki', description: ''},
        intervals: s.blocks.map(([duration, power]) => ({duration, steps: [{duration, power}]})),
    };
}

function samplesFor(key, ftp, rnd) {
    const samples = [];
    for(const [duration, rel] of SESSIONS[key].blocks) {
        for(let i = 0; i < duration; i++) {
            const power = Math.max(0, Math.round(ftp * rel * (1 + (rnd() - 0.5) * 0.12)));
            samples.push({power, heartRate: Math.round(95 + 85 * rel), cadence: 88});
        }
    }
    return samples;
}

function generateHistory({today, days = 120, ftp = 250, weight = 75, seed = 1} = {}) {
    const rnd = random(seed);
    const first = addDays(today, -(days - 1));
    const summaries = [];

    for(let d = 0; d < days; d++) {
        const day = addDays(first, d);
        const weekday = (dayToDate(day).getDay() + 6) % 7;
        const weekIndex = Math.floor(daysBetween(weekStart(first), weekStart(day)) / 7);
        const restWeek = weekIndex % 4 === 3;
        let key = WEEK[weekday];
        if(key === 'rest') continue;
        if(restWeek && (key === 'vo2' || key === 'long')) key = 'endurance';
        if(rnd() < 0.12) continue; // life happens

        const dayFtp = Math.round(ftp - 15 + 15 * (d / days)); // getting fitter
        const start = dayToDate(day).getTime() + 6 * 3600 * 1000 + Math.round(rnd() * 3600) * 1000; // evening
        summaries.push(rideSummary(samplesFor(key, dayFtp, rnd), {
            id: `seed-${day}`, start, name: SESSIONS[key].name, workoutId: `seed-${key}`,
            ftp: dayFtp, weight, distance: null,
        }));
    }

    const rodeOn = new Set(summaries.map(s => s.day));
    const plan = [];
    // the last week: planned days, ridden or missed
    for(let d = -6; d <= 21; d++) {
        const day = addDays(today, d);
        const key = WEEK[(dayToDate(day).getDay() + 6) % 7];
        if(key === 'rest') continue;
        const done = d < 0 && rodeOn.has(day);
        if(d < 0 && !done && rnd() < 0.3) continue;
        plan.push({
            id: `seed-plan-${day}`, day, workout: toWorkout(key),
            rideId: done ? `seed-${day}` : null, deleted: false, updatedAt: 0, dirty: false,
        });
    }
    // make sure there's a missed day to see
    const past = plan.filter(e => e.day < today && !e.rideId);
    if(past.length === 0) {
        const day = addDays(today, -7);
        plan.push({id: `seed-plan-${day}`, day, workout: toWorkout('endurance'), rideId: null, deleted: false, updatedAt: 0, dirty: false});
    }

    // intervals.icu: Monday runs over the last weeks, and two planned
    // workouts from there (one whose .zwo can't be read)
    const external = [];
    for(let w = 0; w < 4; w++) {
        const day = addDays(weekStart(today), -7 * w);
        if(day > today) continue;
        const duration = 2400 + Math.round(rnd() * 1800);
        external.push({
            version: 1, id: `icu-seed-run-${day}`, source: 'intervals', sport: 'run', day, name: 'Lunch run',
            start: dayToDate(day).getTime() + 12 * 3600 * 1000, duration, distance: duration * 2.8,
            tss: Math.round(duration / 3600 * 55), if: null, np: null, avgPower: null, kj: null,
            zoneSeconds: Array(7).fill(0), best: {5: null, 60: null, 300: null, 1200: null, 3600: null},
            ftp: null, weight, workoutId: null, remote: {source: 'GARMIN_CONNECT', externalId: null}, auukiRideId: null,
        });
    }
    const icuDay = addDays(today, 2);
    plan.push({id: 'seed-icu-1', day: icuDay, origin: 'intervals', intervalsEventId: 1, name: 'Threshold 3x10',
               workout: {...toWorkout('sweetspot'), id: 'icu-ev-1', meta: {name: 'Threshold 3x10', category: 'intervals.icu'}},
               rideId: null, deleted: false, updatedAt: 0, dirty: false});
    plan.push({id: 'seed-icu-2', day: addDays(today, 4), origin: 'intervals', intervalsEventId: 2, name: 'Strength circuit',
               workout: null, rideId: null, deleted: false, updatedAt: 0, dirty: false});

    // Garmin: a gym session (no heart rate) on Wednesday mornings and a run
    // with heart rate only on Thursday mornings, over the last weeks
    const blank = {if: null, np: null, avgPower: null, kj: null, zoneSeconds: Array(7).fill(0),
                   best: {5: null, 60: null, 300: null, 1200: null, 3600: null}, ftp: null, weight,
                   workoutId: null, auukiRideId: null, version: 1, source: 'garmin', tss: null};
    for(let w = 0; w < 4; w++) {
        const wed = addDays(weekStart(today), 2 - 7 * w);
        if(wed <= today) {
            external.push({...blank, id: `garmin-seed-gym-${wed}`, sport: 'weighttraining', day: wed, name: 'Strength',
                           start: dayToDate(wed).getTime() - 5 * 3600 * 1000, duration: 2700 + Math.round(rnd() * 900),
                           distance: null, avgHr: null, maxHr: null, remote: {source: 'garmin', externalId: null}});
        }
        const thu = addDays(weekStart(today), 3 - 7 * w);
        if(thu <= today) {
            const duration = 2400 + Math.round(rnd() * 1500);
            external.push({...blank, id: `garmin-seed-run-${thu}`, sport: 'run', day: thu, name: 'Easy run',
                           start: dayToDate(thu).getTime() - 5 * 3600 * 1000, duration, distance: duration * 2.9,
                           avgHr: 148 + Math.round(rnd() * 8), maxHr: 168, remote: {source: 'garmin', externalId: null}});
        }
    }

    // 90 days of health data from a Garmin watch: HRV dips after hard days
    const loadByDay = new Map(summaries.map(x => [x.day, x.tss]));
    const wellness = [];
    for(let d = 89; d >= 0; d--) {
        const day = addDays(today, -d);
        const hard = (loadByDay.get(addDays(day, -1)) ?? 0) > 80;
        const hrv = Math.round(58 + (rnd() - 0.5) * 10 - (hard ? 7 : 0));
        wellness.push({
            id: day, day, hrv, hrvWeekly: 58, hrvStatus: hrv < 52 ? 'UNBALANCED' : 'BALANCED', hrvBaseline: {low: 52, high: 65},
            restingHr: Math.round(47 + (rnd() - 0.5) * 4 + (hard ? 2 : 0)),
            sleepSeconds: Math.round((7 + (rnd() - 0.5) * 1.5) * 3600), sleepScore: Math.round(62 + rnd() * 28),
            bodyBattery: Math.round(55 + rnd() * 40 - (hard ? 12 : 0)),
        });
    }

    return {summaries, plan, external, wellness, thresholds: {cycling: 165, running: 172}};
}

async function seedHistory({ftp, weight} = {}) {
    const { history } = await import('../training/history.js');
    const { idb } = await import('../storage/idb.js');
    const { today } = await import('../training/dates.js');
    if((await history.summaries()).length > 0) return false;
    const {summaries, plan, external, wellness, thresholds} = generateHistory({today: today(), ftp: ftp || 250, weight: weight || 75});
    for(const s of summaries) await idb.put('rideSummaries', s);
    for(const r of external) await idb.put('externalRides', r);
    for(const d of wellness) await idb.put('wellness', d);
    (await import('../training/rider-thresholds.js')).thresholds.setGarmin(thresholds);
    for(const e of plan) await idb.put('plan', e);
    await history.saveSummary(summaries.at(-1)); // announce the change once
    console.log(`:dev :history ${summaries.length} rides, ${plan.length} plan entries`);
    return true;
}

export { generateHistory, seedHistory };
