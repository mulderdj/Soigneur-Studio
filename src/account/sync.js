//
// Account sync
//
// When the current rider is linked to a server account:
// - profile (FTP, weight, the typed W'): newest wins on start, changes are pushed
// - imported workouts: two-way, incremental, deletions included
// - rides: every saved ride is uploaded (.fit + summary) and kept on the
//   server without the 7-ride limit; uploads that fail are retried
//
// Status is broadcast as 'account:sync' {state, message} for the rider menu.
//

import { xf } from '../functions.js';
// note: this is the plain store; views only update on an explicit xf.dispatch
import { db } from '../db.js';
import { models } from '../models/models.js';
import { idb } from '../storage/idb.js';
import { riders } from '../riders.js';
import { api, ApiError } from './api.js';
import { session, setWprime, loadWprime } from '../views/training-dashboard.js';
import { history } from '../training/history.js';
import { thresholds } from '../training/rider-thresholds.js';
import { layouts } from '../layout/store.js';

const DEFAULT_WORKOUT_CATEGORY = 'Imported';

let state = {state: 'off', message: ''};
let started = false;
let pushTimer = null;
let applyingRemote = false;

function local(k, fallback) {
    try {
        const v = localStorage.getItem(riders.key(`sync:${k}`));
        return v === null ? fallback : JSON.parse(v);
    } catch(e) { return fallback; }
}

function setLocal(k, v) {
    try { localStorage.setItem(riders.key(`sync:${k}`), JSON.stringify(v)); } catch(e) {}
}

function setState(s, message = '') {
    state = {state: s, message};
    xf.dispatch('account:sync', state);
}

function linked() {
    return !!riders.current()?.account?.token;
}

const isOffline = err => err instanceof ApiError && err.status === 0;

// what is kept on this device until the server can be reached
function offlineMessage() {
    const n = local('pendingRides', []).length;
    return n ? `Offline: ${n} ride${n === 1 ? '' : 's'} waiting to sync` : 'Offline: changes sync when you\'re back online';
}

function handleError(err, what) {
    console.warn(`:sync :${what}`, err);
    if(err instanceof ApiError && err.status === 401) return; // account:signed-out handles it
    if(isOffline(err)) setState('offline', offlineMessage());
    else setState('error', err?.message ?? `Could not sync ${what}.`);
}

// --- profile ---------------------------------------------------------------

function localProfile() {
    return {ftp: db.ftp, weight: db.weight, wprime: loadWprime(), hrThresholds: thresholds.own(), layouts: layouts.forProfile()};
}

async function pullProfile() {
    const remote = await api.get('/me/profile');
    const localStamp = local('profileChangedAt', 0);
    if(remote.data && remote.updatedAt > localStamp) {
        applyingRemote = true;
        try {
            if(remote.data.ftp > 0 && remote.data.ftp !== db.ftp) xf.dispatch('ui:ftp-set', remote.data.ftp);
            if(remote.data.weight > 0 && remote.data.weight !== db.weight) xf.dispatch('ui:weight-set', remote.data.weight);
            if(remote.data.wprime > 0 && remote.data.wprime !== loadWprime()) setWprime(remote.data.wprime);   // the typed W′, not the model's
            if(remote.data.hrThresholds) {
                thresholds.setOwn(remote.data.hrThresholds, {silent: true}); // not pushed back
                xf.dispatch('training:changed', Date.now());                  // loads change
            }
            layouts.fromProfile(remote.data);                                  // not pushed back
        } finally {
            applyingRemote = false;
        }
        setLocal('profileChangedAt', remote.updatedAt);
    } else {
        await pushProfile();
    }
}

async function pushProfile() {
    const res = await api.put('/me/profile', {data: localProfile()});
    setLocal('profileChangedAt', res.updatedAt);
}

function profileChanged() {
    if(applyingRemote || !linked()) return;
    setLocal('profileChangedAt', Date.now());
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
        setState('syncing');
        pushProfile().then(() => setState('ok')).catch(e => handleError(e, 'profile'));
    }, 1500);
}

// --- workouts --------------------------------------------------------------

function storable(workout) {
    // the built-in library is not stored in IndexedDB; only user workouts sync
    const {id, ...rest} = workout;
    return rest;
}

async function syncWorkouts() {
    const since = local('workoutsSince', 0);
    const known = new Set(local('workoutIds', []));

    // pull
    const remote = await api.get(`/me/workouts?since=${since}`);
    const stored = await idb.getAll('workouts') ?? [];
    const storedIds = new Set(stored.map(w => w.id));

    for(const w of remote.workouts) {
        if(w.deleted) {
            if(storedIds.has(w.id)) {
                applyingRemote = true;
                try {
                    db.workouts = models.workouts.remove(db.workouts, w.id);
                    xf.dispatch('db:workouts', db);
                } finally { applyingRemote = false; }
            }
            known.delete(w.id);
            continue;
        }
        if(!storedIds.has(w.id) && !local('pendingDeletes', []).includes(w.id)) {
            const workout = {...w.data, id: w.id};
            workout.meta = {category: DEFAULT_WORKOUT_CATEGORY, ...(workout.meta ?? {})};
            applyingRemote = true;
            try {
                db.workouts = models.workouts.add(db.workouts, workout);
                xf.dispatch('db:workouts', db);
            } finally { applyingRemote = false; }
            storedIds.add(w.id);
        }
        known.add(w.id);
    }

    // push the ones the server has never seen
    for(const w of stored) {
        if(!known.has(w.id)) {
            await api.put(`/me/workouts/${encodeURIComponent(w.id)}`, {data: storable(w)});
            known.add(w.id);
        }
    }

    setLocal('workoutIds', [...known]);
    setLocal('workoutsSince', remote.now);
}

async function pushWorkout(workout) {
    if(!linked() || applyingRemote || !workout?.id) return;
    try {
        await api.put(`/me/workouts/${encodeURIComponent(workout.id)}`, {data: storable(workout)});
        const known = new Set(local('workoutIds', []));
        known.add(workout.id);
        setLocal('workoutIds', [...known]);
    } catch(e) { handleError(e, 'workouts'); }
}

async function deleteWorkout(id) {
    if(!linked() || applyingRemote || !id) return;
    try {
        await api.delete(`/me/workouts/${encodeURIComponent(id)}`);
        setLocal('workoutIds', local('workoutIds', []).filter(x => x !== id));
    } catch(e) {
        // not reached: delete it on the server at the next sync
        if(!(e instanceof ApiError && e.status === 404)) setLocal('pendingDeletes', [...new Set([...local('pendingDeletes', []), id])]);
        handleError(e, 'workouts');
    }
}

// workouts deleted while the server couldn't be reached
async function flushDeletes() {
    const pending = local('pendingDeletes', []);
    const left = [];
    let failure = null;
    for(const id of pending) {
        if(failure) { left.push(id); continue; }
        try {
            await api.delete(`/me/workouts/${encodeURIComponent(id)}`);
        } catch(e) {
            if(e instanceof ApiError && e.status === 404) continue;   // already gone
            left.push(id);
            failure = e;
        }
    }
    setLocal('pendingDeletes', left);
    const done = pending.filter(id => !left.includes(id));
    if(done.length) setLocal('workoutIds', local('workoutIds', []).filter(x => !done.includes(x)));
    if(failure) throw failure;
}

// --- rides -----------------------------------------------------------------

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function rideStats() {
    const s = session.summary();
    if(!(s.seconds > 0)) return undefined;
    const r = (x, d = 0) => Number(x.toFixed(d));
    return {
        seconds: s.seconds, avgPower: r(s.avgPower), np: r(s.np), tss: r(s.tss),
        intensity: r(s.intensity, 2), kj: r(s.kj), avgHR: r(s.avgHR), maxHR: r(s.maxHR),
        xpower: r(s.xpower), bikescore: r(s.bikescore), matches: s.matches, ftp: s.ftp,
    };
}

async function uploadRide(entry) {
    let record;
    for(let i = 0; i < 10 && !record; i++) {
        record = await idb.get('activity', entry.id);
        if(!record) await new Promise(r => setTimeout(r, 300));
    }
    if(!record?.blob) throw new Error('Ride file not found on this device.');
    const fit = await blobToBase64(record.blob);
    const training = await history.summaryFor(entry.id).catch(() => undefined);
    await api.post('/me/activities', {
        id: entry.id,
        fit,
        summary: {...record.summary, stats: entry.stats, ...(training ? {training} : {})},
    });
}

async function flushRides() {
    const pending = local('pendingRides', []);
    const left = [];
    for(const entry of pending) {
        try {
            await uploadRide(entry);
        } catch(e) {
            if(e instanceof ApiError && e.status === 400) continue; // unusable, drop
            left.push(entry);
            handleError(e, 'rides');
        }
    }
    setLocal('pendingRides', left);
    return left.length === 0;
}

function onRideSaved(summary) {
    if(!linked() || !summary?.id) return;
    // capture the statistics now; the session is reset right after saving
    const pending = local('pendingRides', []);
    pending.push({id: summary.id, stats: rideStats()});
    setLocal('pendingRides', pending);
    setState('syncing', 'Uploading ride');
    flushRides().then(ok => { if(ok) setState('ok', 'Ride saved to your account'); });
}

// --- lifecycle -------------------------------------------------------------

async function syncNow() {
    if(!linked()) { setState('off'); return; }
    setState('syncing');
    try {
        await pullProfile();
        await flushDeletes();
        await syncWorkouts();
        await history.syncPlan();
        await history.pullExternal().catch(e => console.warn(':sync :external-rides', e)); // never blocks the rest
        const ridesOk = await flushRides();
        if(ridesOk) setState('ok', `Synced ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`);
    } catch(e) {
        handleError(e, 'account');
    }
}

function start() {
    if(started) return;
    started = true;

    xf.sub('db:ftp', profileChanged);
    xf.sub('db:weight', profileChanged);
    xf.sub('dashboard:wprime', profileChanged);
    xf.sub('training:thresholds', profileChanged);
    xf.sub('layouts:saved', profileChanged);

    // a workout added through upload or the editor
    xf.sub('db:workouts', () => {
        if(applyingRemote || !linked()) return;
        idb.getAll('workouts').then(stored => {
            const known = new Set(local('workoutIds', []));
            (stored ?? []).filter(w => !known.has(w.id)).forEach(pushWorkout);
        }).catch(() => {});
    });
    xf.sub('ui:workout:remove', deleteWorkout);
    xf.sub('activity:add', onRideSaved);

    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => { if(linked()) setState('offline', offlineMessage()); });
    window.addEventListener('account:signed-out', () => {
        setState('error', 'Your session has ended. Sign in again.');
    });

    // db.js restores the rider's data on app start; sync after that
    xf.sub('activity:restore', () => setTimeout(syncNow, 500));
}

function status() { return state; }

start();

export { syncNow, status };
