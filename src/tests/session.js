//
// One run of a built-in test, without the app around it (src/tests/wiring.js
// feeds it): the per-second log, the Ramp's end, and when to show the result.
//
//   const run = new TestSession(workout)     workout.meta.test set, else run.test is null
//   run.tick({i, s, power, ftp})  → 'lap' once when the Ramp ends, else null
//   run.finish({stopped})         → the result to show, or null (stopped before the first effort, or already shown)
//

import { testResult, reachedEffort, rampEnded } from './results.js';

class TestSession {
    constructor(workout, {weight} = {}) {
        this.workout = workout;
        this.test = workout?.meta?.test ?? null;
        this.weight = weight;
        this.log = [];
        this.ramp = {powers: [], targets: [], ended: false};
        this.shown = false;
    }
    tick({i, s, power, ftp}) {
        if(!this.test) return null;
        this.log.push({i, s, power});
        if(this.test !== 'ramp' || this.ramp.ended) return null;
        const interval = this.workout.intervals[i];
        if(!interval?.ramp) return null;
        const target = (interval.steps[s]?.power ?? 0) * ftp;
        this.ramp.powers.push(power);
        this.ramp.targets.push(target);
        if(this.ramp.powers.length > 10) { this.ramp.powers.shift(); this.ramp.targets.shift(); }
        if(rampEnded(this.ramp.powers, this.ramp.targets)) { this.ramp.ended = true; return 'lap'; }
        return null;
    }
    finish({stopped = false, weight} = {}) {
        if(!this.test || this.shown) return null;
        if(stopped && !reachedEffort(this.test, this.log, this.workout)) return null;
        this.shown = true;
        return testResult(this.test, this.log, this.workout, {weight: weight ?? this.weight});
    }
}

export { TestSession };
