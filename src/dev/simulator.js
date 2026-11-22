//
// Simulated rider for development: lets you try the dashboard, statistics
// and recording without a trainer or heart-rate strap.
//
// Open the dev server (npm start) with ?simulate in the address, e.g.
// http://localhost:1234/?simulate. Production builds leave this file out.
//
// The rider follows the app like a smart trainer would: in ERG mode power
// settles on the target within a few seconds; with no target, or in
// resistance / virtual gear mode, it rides at an endurance pace; in slope
// mode it pushes harder uphill. Heart rate follows power with a lag and a
// slow cardiac drift; cadence drops a little on hard efforts and climbs.
//

const REST_HR = 60;
const MAX_HR  = 188;
const MASS    = 80;     // kg, rider + bike
const CDA     = 0.32;   // m², hoods
const CRR     = 0.004;
const RHO     = 1.225;  // kg/m³
const G       = 9.81;

function initialState() {
    return {
        power: 0, heartRate: REST_HR, cadence: 0, speed: 0,
        // smoothed values, before noise and rounding
        p: 0, hr: REST_HR, cad: 0, drift: 0,
    };
}

function approach(x, goal, dt, tau) {
    return x + (goal - x) * (1 - Math.exp(-dt / tau));
}

function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
}

// power the rider aims for, in W
function powerGoal({mode = 'erg', powerTarget = 0, slopeTarget = 0, ftp = 250}) {
    if(mode === 'erg' && powerTarget > 0) return powerTarget;
    if(mode === 'sim') return ftp * clamp(0.62 + 0.04 * slopeTarget, 0.3, 1.2);
    return 0.65 * ftp;
}

// steady speed in m/s for a power and grade (%), by bisection
function speedFor(power, grade = 0) {
    if(power <= 0) return 0;
    const slope = grade / 100;
    const need = v => 0.5 * RHO * CDA * v ** 3 + (CRR + slope) * MASS * G * v;
    let lo = 0, hi = 30;
    for(let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if(need(mid) < power) lo = mid; else hi = mid;
    }
    return lo;
}

// rand() returns [0, 1); 0.5 means no noise
function step(state, inputs, dt, rand = Math.random) {
    const ftp = inputs.ftp > 0 ? inputs.ftp : 250;
    const grade = inputs.mode === 'sim' ? (inputs.slopeTarget ?? 0) : 0;
    const noise = (scale) => (rand() - 0.5) * 2 * scale;

    const p = approach(state.p, powerGoal({...inputs, ftp}), dt, 1.2);
    const load = p / ftp;

    const drift = state.drift + (load > 0.5 ? dt * 0.003 : 0); // ~2 bpm per 10 min
    const hrGoal = REST_HR + (MAX_HR - REST_HR) * clamp(load / 1.15, 0, 1) + drift;
    const hr = approach(state.hr, Math.min(hrGoal, MAX_HR), dt, 30);

    const cadGoal = p > 0 ? 90 - 40 * Math.max(0, load - 1) - 2 * Math.max(0, grade) : 0;
    const cad = approach(state.cad, clamp(cadGoal, 0, 110), dt, 3);

    return {
        p, hr, cad, drift,
        power:     Math.max(0, Math.round(p * (1 + noise(0.03)))),
        heartRate: Math.round(hr + noise(1)),
        cadence:   Math.max(0, Math.round(cad + noise(2))),
        speed:     speedFor(p, grade),
    };
}

// Feed the simulated rider into the app, the same way a connected trainer
// and heart-rate strap do.
function start({xf, hz = 4} = {}) {
    const inputs = {mode: 'erg', powerTarget: 0, slopeTarget: 0, ftp: 250};
    xf.sub('db:mode',        x => { inputs.mode = x; });
    xf.sub('db:powerTarget', x => { inputs.powerTarget = x; });
    xf.sub('db:slopeTarget', x => { inputs.slopeTarget = x; });
    xf.sub('db:ftp',         x => { inputs.ftp = x; });

    let state = initialState();
    const dt = 1 / hz;
    const timer = setInterval(() => {
        state = step(state, inputs, dt);
        xf.dispatch('power',     state.power);
        xf.dispatch('cadence',   state.cadence);
        xf.dispatch('speed',     state.speed);
        xf.dispatch('heartRate', state.heartRate);
    }, 1000 * dt);

    const badge = document.createElement('div');
    badge.textContent = 'Simulated rider';
    badge.title = 'Power, cadence, speed and heart rate are simulated (?simulate in the address).';
    badge.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9999;padding:4px 10px;' +
        'border-radius:999px;background:#b45309;color:#fff;font:600 12px/1.4 sans-serif;pointer-events:none;';
    document.body.append(badge);

    console.log(':simulator :started');
    return () => { clearInterval(timer); badge.remove(); };
}

export {
    initialState,
    step,
    speedFor,
    start,
};
