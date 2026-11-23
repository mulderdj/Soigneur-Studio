//
// Training history: ride summaries and the plan, stored per rider in
// IndexedDB, filled in for old rides (backfill), and synced with the
// account server when the rider is signed in.
//
// Stores (in the rider's database, see src/db.js):
//   rideSummaries  one summary per ride; never trimmed, unlike the
//                  'activity' store that keeps only the last 7 .fit files
//   plan           PlanEntry {id, day, workout, rideId, updatedAt, deleted, dirty}
//   externalRides  ride summaries from intervals.icu, synced by the account
//                  server; summaries() merges them in without duplicates
//   hiddenRides    {id, hidden, dirty}: rides the rider hid (still listed in
//                  the day dialog, marked hidden: true; see countable())
//
// The account connection is injected with connect({api, linked}) so this
// module stays free of the app's start-up code.
//

import { xf } from '../functions.js';
import { idb } from '../storage/idb.js';
import { uuid } from '../storage/uuid.js';
import { rideSummary, SUMMARY_VERSION } from './summary.js';
import { fitToSamples } from './fit-records.js';
import { matchRide } from './plan.js';
import { mergeRides } from './merge.js';

const SUMMARIES = 'rideSummaries';
const PLAN = 'plan';
const EXTERNAL = 'externalRides';
const HIDDEN = 'hiddenRides';

let remote = {
    api: null, linked: () => false,
    planSince: {get: () => 0, set: () => {}},
    externalSince: {get: () => 0, set: () => {}},
    parseWorkout: null, // .zwo text -> workout (models.workout.parse)
    toZwo: null,        // workout -> .zwo text, for intervals.icu
};

function connect(options = {}) {
    remote = {...remote, ...options};
}

function changed() {
    xf.dispatch('training:changed', Date.now());
}

// --- ride summaries ---------------------------------------------------------

async function ownSummaries() {
    const all = (await idb.getAll(SUMMARIES)) ?? [];
    return all.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

async function externalRides() {
    try { return (await idb.getAll(EXTERNAL)) ?? []; } catch(e) { return []; }
}

// every ride: Auuki's own and intervals.icu's, each counted once; hidden
// rides are marked hidden: true
async function summaries() {
    const hidden = await hiddenIds();
    const all = mergeRides(await ownSummaries(), await externalRides());
    return hidden.size ? all.map(s => hidden.has(s.id) ? {...s, hidden: true} : s) : all;
}

// --- hidden rides ------------------------------------------------------------

async function hiddenRecords() {
    try { return (await idb.getAll(HIDDEN)) ?? []; } catch(e) { return []; }
}

async function hiddenIds() {
    return new Set((await hiddenRecords()).filter(r => r.hidden).map(r => r.id));
}

async function setHidden(id, hidden) {
    await idb.put(HIDDEN, {id, hidden, dirty: true});
    changed();
    schedulePush();
}

const hideRide = (id) => setHidden(id, true);
const showRide = (id) => setHidden(id, false);

// push this device's changes, then take the server's list
async function syncHidden() {
    for(const r of await hiddenRecords()) {
        if(!r.dirty) continue;
        const path = `/me/hidden-rides/${encodeURIComponent(r.id)}`;
        if(r.hidden) await remote.api.put(path, {});
        else await remote.api.delete(path);
        const now = await idb.get(HIDDEN, r.id);
        if(now && now.hidden === r.hidden) await idb.put(HIDDEN, {...now, dirty: false});
    }
    const res = await remote.api.get('/me/hidden-rides');
    if(!Array.isArray(res?.ids)) return;
    const server = new Set(res.ids);
    let any = false;
    for(const r of await hiddenRecords()) {
        if(r.dirty) continue;
        if(!server.has(r.id)) { await idb.remove(HIDDEN, r.id); any = any || r.hidden; }
        server.delete(r.id);
    }
    for(const id of server) { await idb.put(HIDDEN, {id, hidden: true, dirty: false}); any = true; }
    if(any) changed();
}

// rides intervals.icu has, through the account server (changed since the cursor)
async function pullExternal() {
    if(!remote.linked() || !remote.api) return 0;
    const since = remote.externalSince.get() ?? 0;
    const res = await remote.api.get(`/me/external-rides?since=${since}`);
    const rides = (res?.rides ?? []).filter(r => r?.id);
    for(const r of rides) await idb.put(EXTERNAL, r);
    if(Number.isFinite(res?.now)) remote.externalSince.set(res.now);
    if(rides.length > 0) changed();
    return rides.length;
}

// a ride imported from a .fit file: kept with the external rides and sent
// to the account (pendingUpload until the server has it)
async function saveImported(summary) {
    await idb.put(EXTERNAL, {...summary, pendingUpload: true});
    changed();
    await pushImported().catch(() => {}); // retried on the next sync
}

async function pushImported() {
    if(!remote.linked() || !remote.api) return;
    for(const r of await externalRides()) {
        if(!r.pendingUpload) continue;
        const {pendingUpload, ...summary} = r;
        await remote.api.put(`/me/external-rides/${encodeURIComponent(r.id)}`, {summary});
        await idb.put(EXTERNAL, summary);
    }
}

// ask the account server to sync intervals.icu now (no-op when not connected)
async function requestIntervalsSync() {
    if(!remote.linked() || !remote.api) return false;
    try { await remote.api.post('/me/intervals/sync', {}); return true; } catch(e) { return false; }
}

async function saveSummary(summary) {
    await idb.put(SUMMARIES, summary);
    changed();
}

async function toDataView(blob) {
    if(blob instanceof DataView) return blob;
    if(blob instanceof ArrayBuffer) return new DataView(blob);
    if(ArrayBuffer.isView(blob)) return new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    if(typeof blob?.arrayBuffer === 'function') return new DataView(await blob.arrayBuffer());
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new DataView(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

// meta: {id, name, timestamp (end, ms), duration (s), workoutId}
async function summaryFromFit(blob, meta, {ftp, weight}) {
    let read;
    try {
        read = fitToSamples(await toDataView(blob));
    } catch(e) {
        return null;
    }
    if(read.samples.length === 0) return null;
    const start = read.start ?? ((meta.timestamp ?? Date.now()) - read.samples.length * 1000);
    return rideSummary(read.samples, {
        id: meta.id, start, name: meta.name, workoutId: meta.workoutId ?? null,
        ftp, weight, distance: read.distance,
    });
}

// what the ride's own record knows when its .fit can't be read
function durationOnly(meta, {ftp, weight}) {
    const duration = Number.isFinite(meta.duration) ? meta.duration : 0;
    const start = (meta.timestamp ?? Date.now()) - duration * 1000;
    const s = rideSummary(new Array(duration).fill({power: 0}), {
        id: meta.id, start, name: meta.name, workoutId: meta.workoutId ?? null, ftp, weight, distance: null,
    });
    return {...s, unreadable: true};
}

// summaries for rides that have none of the current version yet: first the
// .fit files on this device, then (signed in) rides only on the server
async function backfill({ftp, weight, onProgress = () => {}} = {}) {
    const have = new Map((await ownSummaries()).map(s => [s.id, s]));
    const isCurrent = id => have.get(id)?.version === SUMMARY_VERSION;
    const local = ((await idb.getAll('activity')) ?? []).filter(r => r?.id && !isCurrent(r.id));

    let serverRides = [];
    if(remote.linked() && remote.api) {
        try {
            serverRides = (await remote.api.get('/me/activities')).activities ?? [];
        } catch(e) {
            serverRides = [];
        }
    }
    // rides the server already has a summary for: take it
    for(const r of serverRides) {
        if(r.training?.version === SUMMARY_VERSION && !isCurrent(r.id)) {
            await idb.put(SUMMARIES, r.training);
            have.set(r.id, r.training);
        }
    }
    const localIds = new Set(local.map(r => r.id));
    const remoteOnly = serverRides.filter(r => !isCurrent(r.id) && !localIds.has(r.id));

    const total = local.length + remoteOnly.length;
    let done = 0, added = 0;
    const skipped = [];
    const progress = () => onProgress({done, total});
    // a ride whose .fit can't be read stays on the calendar with its duration
    const keep = async (s, unreadable) => {
        if(unreadable) skipped.push(s.id);
        await idb.put(SUMMARIES, s);
        have.set(s.id, s);
        added++;
    };

    for(const record of local) {
        const meta = {...record.summary, id: record.id};
        const s = await summaryFromFit(record.blob, meta, {ftp, weight});
        await keep(s ?? durationOnly(meta, {ftp, weight}), !s);
        done++; progress();
    }
    for(const ride of remoteOnly) {
        let s = null;
        try {
            const res = await remote.api.raw(`/me/activities/${encodeURIComponent(ride.id)}/fit`);
            s = await summaryFromFit(await res.arrayBuffer(), {...ride, id: ride.id}, {ftp, weight});
        } catch(e) {
            s = null;
        }
        await keep(s ?? durationOnly({...ride, id: ride.id}, {ftp, weight}), !s);
        done++; progress();
    }
    // the server keeps summaries too, for the rider's other devices
    if(remote.linked() && remote.api) {
        for(const ride of serverRides) {
            const s = have.get(ride.id);
            if(s && ride.training?.version !== SUMMARY_VERSION) {
                try { await remote.api.patch(`/me/activities/${encodeURIComponent(ride.id)}/summary`, {training: s}); } catch(e) {}
            }
        }
    }
    if(total === 0) progress();
    if(added > 0) changed();
    return {added, skipped};
}

// a ride just saved: summary from the live samples, then match it to the plan
async function recordRide(meta, samples) {
    const s = rideSummary(samples, meta);
    await idb.put(SUMMARIES, s);
    const entries = await planEntries();
    const entryId = matchRide(s, entries);
    if(entryId) await linkRide(entryId, s.id);
    changed();
    return s;
}

// --- plan --------------------------------------------------------------------

async function allPlanEntries() {
    return (await idb.getAll(PLAN)) ?? [];
}

async function planEntries() {
    return (await allPlanEntries())
        .filter(e => !e.deleted)
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.updatedAt ?? 0) - (b.updatedAt ?? 0)));
}

async function putEntry(entry) {
    const e = {...entry, updatedAt: Date.now(), dirty: true};
    await idb.put(PLAN, e);
    changed();
    schedulePush();
    return e;
}

// the .zwo goes to intervals.icu with the entry; a workout that can't be
// written as .zwo (e.g. some .erg files) is planned without one
function zwoOf(workout) {
    if(!remote.toZwo || !workout) return null;
    try { return remote.toZwo(workout) || null; } catch(e) { return null; }
}

async function addPlanEntry(day, workout) {
    return putEntry({id: uuid(), day, workout: structuredCloneSafe(workout), rideId: null, deleted: false,
                     origin: 'auuki', zwo: zwoOf(workout), name: workout?.meta?.name ?? null});
}

// an entry planned on intervals.icu: its workout comes from the .zwo
function readWorkout(entry) {
    if(entry.origin !== 'intervals' || !entry.zwo || !remote.parseWorkout) return entry;
    const name = entry.workout?.meta?.name ?? entry.name ?? 'Workout';
    try {
        const w = remote.parseWorkout(entry.zwo);
        if(!w || !(w.intervals?.length > 0)) throw new Error('no steps');
        w.id = entry.workout?.id ?? `icu-${entry.id}`;
        w.meta = {...w.meta, name};
        return {...entry, workout: w, name};
    } catch(e) {
        return {...entry, workout: null, name};
    }
}

async function movePlanEntry(id, day) {
    const e = await idb.get(PLAN, id);
    if(e) await putEntry({...e, day});
}

async function removePlanEntry(id) {
    const e = await idb.get(PLAN, id);
    if(e) await putEntry({...e, deleted: true});
}

async function linkRide(entryId, rideId) {
    const e = await idb.get(PLAN, entryId);
    if(e) await putEntry({...e, rideId});
}

function structuredCloneSafe(x) {
    return JSON.parse(JSON.stringify(x ?? null));
}

// --- plan sync with the account server ----------------------------------------

let pushTimer = null;

function schedulePush() {
    if(!remote.linked() || !remote.api) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { syncPlan().catch(() => {}); }, 1000);
}

function storable(entry) {
    const {id, dirty, updatedAt, deleted, ...data} = entry;
    return data;
}

let syncing = null;

// one sync at a time (the debounced push and the account sync both call it)
function syncPlan() {
    syncing = (syncing ?? Promise.resolve()).then(syncPlanOnce, syncPlanOnce);
    return syncing;
}

async function syncPlanOnce() {
    if(!remote.linked() || !remote.api) return;
    const since = remote.planSince.get() ?? 0;
    const pulled = await remote.api.get(`/me/plan?since=${since}`);
    const local = new Map((await allPlanEntries()).map(e => [e.id, e]));
    let any = false;

    for(const r of pulled.entries ?? []) {
        const mine = local.get(r.id);
        if(mine?.dirty && (mine.updatedAt ?? 0) >= r.updatedAt) continue; // our change is newer
        const entry = r.deleted ?
              {...(mine ?? {id: r.id, day: '', workout: null, rideId: null}), deleted: true, updatedAt: r.updatedAt, dirty: false} :
              readWorkout({...r.data, id: r.id, deleted: false, updatedAt: r.updatedAt, dirty: false});
        await idb.put(PLAN, entry);
        local.set(r.id, entry);
        any = true;
    }
    for(const e of local.values()) {
        if(!e.dirty) continue;
        if(e.deleted) await remote.api.delete(`/me/plan/${encodeURIComponent(e.id)}`);
        else await remote.api.put(`/me/plan/${encodeURIComponent(e.id)}`, {data: storable(e)});
        // changed again while it was being sent: keep it dirty for the next push
        const now = await idb.get(PLAN, e.id);
        if(now && now.updatedAt === e.updatedAt) await idb.put(PLAN, {...now, dirty: false});
    }
    if(Number.isFinite(pulled.now)) remote.planSince.set(pulled.now);
    if(any) changed();
    // hidden rides ride along with the plan; an older server without them is fine
    await syncHidden().catch(e => console.warn(':training :hidden', e));
    await pushImported().catch(e => console.warn(':training :imported', e));
}

async function summaryFor(id) {
    return idb.get(SUMMARIES, id);
}

const history = Object.freeze({
    connect,
    summaries,
    hideRide,
    showRide,
    hiddenIds,
    pullExternal,
    requestIntervalsSync,
    saveImported,
    saveSummary,
    summaryFor,
    backfill,
    recordRide,
    planEntries,
    addPlanEntry,
    movePlanEntry,
    removePlanEntry,
    linkRide,
    syncPlan,
});

export { history, toDataView };
