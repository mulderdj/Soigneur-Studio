//
// The built-in tests in the app: a TestSession per run of a test workout,
// fed every second the watch runs; the Ramp ends with a lap; the result
// opens in <test-result> when the test is done, or when the ride is stopped
// after the first effort.
//

import { xf } from '../functions.js';
import { db } from '../db.js';
import { TestSession } from './session.js';
import { TEST_IDS } from './protocols.js';
import { modelNow } from '../training/rider-model-wiring.js';

let workout = null;
let run = null;

async function show(test, result) {
    const el = document.querySelector('test-result');
    if(!el || !result) return;
    let m = null;
    try { m = await modelNow(); } catch(e) {}
    el.open({test, result, ftp: db.ftp, current: m?.effective ?? null, fit: m?.fit ?? null, mode: m?.settings?.mode ?? 'ask', weight: db.weight});
}

// the log survives a page reload in this tab: the restored session starts a
// new run (db:workoutStatus), then workout:restore hands it the kept log
const KEY = 'soigneur:test-run';
function keep(r) {
    try { sessionStorage.setItem(KEY, JSON.stringify({id: r.workout.id, log: r.log, rampEnded: r.ramp.ended})); } catch(e) {}
}
function forget() { try { sessionStorage.removeItem(KEY); } catch(e) {} }
function kept(id) {
    try { const k = JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); return k?.id === id ? k : null; } catch(e) { return null; }
}

xf.sub('db:workout', w => { workout = w; run = null; restorePending = false; });
let restorePending = false;
function takeKept(r) {
    const k = kept(r.workout.id);
    if(k && !r.log.length) { r.log = k.log ?? []; r.ramp.ended = !!k.rampEnded; }
}
// the run may be made before workout:restore or just after it (the watch
// sends workout:started again), depending on the order the session is restored
xf.sub('workout:restore', () => {
    if(run) takeKept(run); else restorePending = true;
});

xf.sub('db:workoutStatus', status => {
    if(status === 'started' && workout?.meta?.test && !run) {
        run = new TestSession(workout);
        if(restorePending) takeKept(run);
        restorePending = false;
    }
    if(status === 'done' && run) { forget(); show(run.test, run.finish({weight: db.weight})); }
});

xf.sub('db:elapsed', elapsed => {
    if(!run || elapsed <= 0 || db.workoutStatus !== 'started' || db.watchStatus !== 'started') return;
    const step = run.tick({i: db.intervalIndex, s: db.stepIndex, power: db.power1s, ftp: db.ftp});
    if(elapsed % 10 === 0) keep(run);
    // after the watch's tick has written its lap and step times, or it would
    // write the ramp's back over the cool-down's
    if(step === 'lap') queueMicrotask(() => xf.dispatch('ui:watchLap'));
});

// stopped mid-test: the result if the first effort began; the next start is a new run
xf.sub('watch:stopped', () => {
    if(!run) return;
    forget();
    show(run.test, run.finish({stopped: true, weight: db.weight}));   // null if already shown
    run = null;
});

// "Ride the 3 + 12 min test" (the CP and W′ card): load it on the Ride page,
// as picked by hand — never during a ride
xf.sub('tests:ride', test => {
    if(db.watchStatus === 'started' || db.watchStatus === 'paused') return;
    if(!TEST_IDS[test]) return;
    xf.dispatch('ui:workout:select', TEST_IDS[test]);
    xf.dispatch('ui:page-set', 'home');
});
