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

xf.sub('db:workout', w => { workout = w; run = null; });

xf.sub('db:workoutStatus', status => {
    if(status === 'started' && workout?.meta?.test && !run) run = new TestSession(workout);
    if(status === 'done' && run) show(run.test, run.finish({weight: db.weight}));
});

xf.sub('db:elapsed', elapsed => {
    if(elapsed <= 0 || db.workoutStatus !== 'started' || db.watchStatus !== 'started') return;
    // a test picked while a workout was already running starts its run here
    if(!run && workout?.meta?.test) run = new TestSession(workout);
    if(!run) return;
    const step = run.tick({i: db.intervalIndex, s: db.stepIndex, power: db.power1s, ftp: db.ftp});
    if(step === 'lap') xf.dispatch('ui:watchLap');
});

// stopped mid-test: the result if the first effort began; the next start is a new run
xf.sub('watch:stopped', () => {
    if(!run) return;
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
