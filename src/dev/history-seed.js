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

    return {summaries, plan};
}

async function seedHistory({ftp, weight} = {}) {
    const { history } = await import('../training/history.js');
    const { idb } = await import('../storage/idb.js');
    const { today } = await import('../training/dates.js');
    if((await history.summaries()).length > 0) return false;
    const {summaries, plan} = generateHistory({today: today(), ftp: ftp || 250, weight: weight || 75});
    for(const s of summaries) await idb.put('rideSummaries', s);
    for(const e of plan) await idb.put('plan', e);
    await history.saveSummary(summaries.at(-1)); // announce the change once
    console.log(`:dev :history ${summaries.length} rides, ${plan.length} plan entries`);
    return true;
}

export { generateHistory, seedHistory };
