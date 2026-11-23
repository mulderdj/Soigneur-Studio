//
// Connects the Training history to the running app: each saved ride gets a
// summary from the live session, and the plan syncs through the rider's
// account.
//

import { xf } from '../functions.js';
import { db } from '../db.js';
import { riders } from '../riders.js';
import { api } from '../account/api.js';
import { session } from '../views/training-dashboard.js';
import { history } from './history.js';
import { today } from './dates.js';
import { todayChecker } from './today.js';
import { models } from '../models/models.js';
import { zwo } from '../workouts/zwo.js';

history.connect({
    api,
    linked: () => !!riders.current()?.account?.token,
    planSince: cursor('training:planSince'),
    externalSince: cursor('training:externalSince'),
    // workouts planned on intervals.icu arrive as .zwo, Auuki's go out as .zwo
    parseWorkout: text => models.workout.parse(text),
    toZwo: workout => zwo.write(zwo.fromInterval(workout)),
});

function cursor(name) {
    return {
        get: () => { try { return Number(localStorage.getItem(riders.key(name)) ?? 0) || 0; } catch(e) { return 0; } },
        set: (v) => { try { localStorage.setItem(riders.key(name), String(v)); } catch(e) {} },
    };
}

// intervals.icu: ask the account server to sync when the app opens, and
// fetch what it found once it has had time to run
async function pullIntervals() {
    await history.syncPlan().catch(() => {});
    await history.pullExternal().catch(e => console.warn(':training :intervals', e));
}

xf.sub('activity:restore', async () => {
    if(!(await history.requestIntervalsSync())) return;
    setTimeout(pullIntervals, 30 * 1000);
    setTimeout(pullIntervals, 3 * 60 * 1000);
});

// 'activity:add' fires as the ride is saved; the session still holds the
// ride's samples at that moment (it is reset right after), so copy them now
xf.sub('activity:add', (saved) => {
    const n = session.count;
    if(!saved?.id || n === 0) return;
    const samples = new Array(n);
    for(let i = 0; i < n; i++) {
        samples[i] = {power: session.power[i], heartRate: session.hr[i], cadence: session.cadence[i]};
    }
    const meta = {
        id: saved.id,
        start: (saved.timestamp ?? Date.now()) - n * 1000,
        name: saved.name,
        workoutId: db.workout?.id ?? null,
        ftp: db.ftp,
        weight: db.weight,
        distance: Number.isFinite(db.distance) ? db.distance : null,
    };
    history.recordRide(meta, samples).catch(e => console.warn(':training :record', e));
});

// today's planned workout: selected on start and when the day changes,
// never over a workout the rider picked by hand today or during a ride
const handPickedKey = () => riders.key('training:handPicked');

xf.sub('ui:workout:select', () => {
    try { localStorage.setItem(handPickedKey(), today()); } catch(e) {}
});

const checker = todayChecker({
    getToday: today,
    getWatchStatus: () => db.watchStatus,
    getHandPicked: () => { try { return localStorage.getItem(handPickedKey()); } catch(e) { return null; } },
    select: workout => xf.dispatch('workout', workout),
});

function checkToday() {
    checker.check().catch(e => console.warn(':training :today', e));
}

// the rider's database is open once their activities are restored
xf.sub('activity:restore', () => {
    checkToday();
    setInterval(checkToday, 60 * 1000);
    // a plan made on another device arrives with the first sync
    xf.sub('training:changed', checkToday);
});
