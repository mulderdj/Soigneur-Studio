// Synthetic rides for the analysis tests: 1 s samples as readRide gives them.

const FTP = 250;

// warm-up 5 min at 60 %, 5 × (4 min at 110 %, 3 min at 50 %), cool-down 5 min at 50 %
function workout() {
    const iv = (duration, power) => ({duration, steps: [{duration, power}]});
    const intervals = [iv(300, 0.6)];
    for(let r = 0; r < 5; r++) intervals.push(iv(240, 1.1), iv(180, 0.5));
    intervals.push(iv(300, 0.5));
    return {name: '5x4', intervals, meta: {duration: intervals.reduce((a, b) => a + b.duration, 0)}};
}

// the rider follows the workout: power = target (+ a small wobble), HR follows
// pauses: [{at, seconds}] in workout time; stopAt: the ride ends there
function rideOf(w, {ftp = FTP, pauses = [], stopAt = Infinity, fade = 0} = {}) {
    const samples = [], gaps = [];
    let t = 0, wt = 0;
    for(const iv of w.intervals) {
        for(let s = 0; s < iv.duration; s++, wt++) {
            if(wt >= stopAt) return {samples, pauses: gaps};
            const p = pauses.find(x => x.at === wt);
            if(p) {
                gaps.push({start: t, end: t + p.seconds});
                for(let k = 0; k < p.seconds; k++, t++) samples.push({t, power: null, heartRate: null, cadence: null, speed: null, distance: null, altitude: null});
            }
            const target = iv.steps[0].power * ftp;
            const tired = fade && iv.steps[0].power > 1 ? 1 - fade * (s / iv.duration) : 1;
            samples.push({t, power: Math.round(target * tired) + (s % 2 ? 2 : -2), heartRate: Math.round(100 + 60 * iv.steps[0].power), cadence: 90, speed: 9, distance: t * 9, altitude: 200});
            t++;
        }
    }
    return {samples, pauses: gaps};
}

// a steady ride: power constant, HR drifting up by `drift` (fraction) over the ride
function steady({seconds = 7200, power = 200, hr = 140, drift = 0.05, withPower = true} = {}) {
    return Array.from({length: seconds}, (_, t) => ({
        t, power: withPower ? power : null, heartRate: Math.round(hr * (1 + drift * t / seconds)), cadence: withPower ? 88 : null,
        speed: 8, distance: t * 8, altitude: 300 + Math.sin(t / 600) * 50,
    }));
}

module.exports = { FTP, workout, rideOf, steady };
