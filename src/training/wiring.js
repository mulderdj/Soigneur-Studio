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

history.connect({
    api,
    linked: () => !!riders.current()?.account?.token,
    planSince: {
        get: () => { try { return Number(localStorage.getItem(riders.key('training:planSince')) ?? 0) || 0; } catch(e) { return 0; } },
        set: (v) => { try { localStorage.setItem(riders.key('training:planSince'), String(v)); } catch(e) {} },
    },
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
