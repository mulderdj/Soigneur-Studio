//
// Training analytics
//
// Pure, incremental (O(1) per sample) session statistics used by the
// desktop dashboard: Normalized Power, IF, TSS, VI, work, efficiency,
// aerobic decoupling, time in zone, best efforts and interval compliance.
//
// Feed it exactly one sample per second with `push()`.
//

// Zone boundaries mirror the app's own FTP model (models.ftp.percentages)
// so colours and numbers match the workout graph.
const DEFAULT_PERCENTAGES = [0.54, 0.75, 0.87, 0.94, 1.05, 1.20];

const ZONES = [
    {key: 'one',   short: 'Z1', name: 'Recovery',   color: 'var(--zone-gray)'},
    {key: 'two',   short: 'Z2', name: 'Endurance',  color: 'var(--zone-blue)'},
    {key: 'three', short: 'Z3', name: 'Tempo',      color: 'var(--zone-teal)'},
    {key: 'four',  short: 'Z4', name: 'Sweet Spot', color: 'var(--zone-green)'},
    {key: 'five',  short: 'Z5', name: 'Threshold',  color: 'var(--zone-yellow)'},
    {key: 'six',   short: 'Z6', name: 'VO2 Max',    color: 'var(--zone-orange)'},
    {key: 'seven', short: 'Z7', name: 'Anaerobic',  color: 'var(--zone-red)'},
];

// GoldenCheetah's peak power durations (PeakPower.cpp), trimmed to the
// ones that matter for indoor sessions
const BEST_WINDOWS = [
    {seconds: 5,    label: '5s'},
    {seconds: 30,   label: '30s'},
    {seconds: 60,   label: '1min'},
    {seconds: 300,  label: '5min'},
    {seconds: 600,  label: '10min'},
    {seconds: 1200, label: '20min'},
    {seconds: 3600, label: '60min'},
];

// W'bal fatigue zones, as in GoldenCheetah WPrime.cpp (percent of W' used)
const WBAL_ZONES = [
    {key: 'w1', short: 'W1', name: 'Low fatigue',      lo: 0,  hi: 25},
    {key: 'w2', short: 'W2', name: 'Moderate fatigue', lo: 25, hi: 50},
    {key: 'w3', short: 'W3', name: 'Heavy fatigue',    lo: 50, hi: 75},
    {key: 'w4', short: 'W4', name: 'Severe fatigue',   lo: 75, hi: 100},
];

const DEFAULT_WPRIME = 20000;      // J, GoldenCheetah default (Zones.cpp)
const MATCH_SMOOTHING = 25;        // s, WprimeMatchSmoothing
const MATCH_MIN_JOULES = 2000;     // J, what GoldenCheetah plots as a match
const XPOWER_WINDOW = 25;          // s, Skiba xPower EWMA (BikeScore.cpp)

// Skiba TISS coefficients (BikeScore.cpp)
const ATISS = {a: 0.663788683661645, b: -7.5095428451195, c: -0.86118031563782};
const ANTISS = {a: 0.238923886004611, b: -61.849, c: -1.73549567522521};

const NP_WINDOW = 30;
// a sample is "on target" when within this fraction of the target power
const TARGET_TOLERANCE = 0.05;
const TARGET_TOLERANCE_MIN_WATTS = 5;

function zoneIndex(power, ftp, percentages = DEFAULT_PERCENTAGES) {
    if(!(ftp > 0)) return 0;
    for(let i = 0; i < percentages.length; i++) {
        if(power < ftp * percentages[i]) return i;
    }
    return percentages.length;
}

function isNum(x) {
    return typeof x === 'number' && Number.isFinite(x);
}

class RollingMax {
    // tracks the best average over a fixed window of seconds
    constructor(seconds) {
        this.seconds = seconds;
        this.reset();
    }
    reset() {
        this.sum = 0;
        this.best = 0;
    }
    push(series, index) {
        this.sum += series[index];
        if(index >= this.seconds) this.sum -= series[index - this.seconds];
        if(index + 1 >= this.seconds) {
            const avg = this.sum / this.seconds;
            if(avg > this.best) this.best = avg;
        }
    }
}

class SessionStats {
    constructor(args = {}) {
        this.ftp         = args.ftp ?? 200;
        this.weight      = args.weight ?? 75;
        this.percentages = args.percentages ?? DEFAULT_PERCENTAGES;
        this.wprime      = args.wprime ?? DEFAULT_WPRIME;
        this.cp          = args.cp > 0 ? args.cp : null;   // the rider model's CP for W′bal; FTP when not set
        this.reset();
    }

    reset() {
        this.power   = [];
        this.hr      = [];
        this.cadence = [];
        this.target  = [];

        this.count     = 0;
        this.sumPower  = 0;
        this.maxPower  = 0;

        this.sumHR     = 0;
        this.countHR   = 0;
        this.maxHR     = 0;

        this.sumCadence   = 0;
        this.countCadence = 0;

        // Normalized Power
        this.rollSum   = 0;
        this.np4Sum    = 0;
        this.npCount   = 0;

        // prefix sums for decoupling (power & hr only where hr > 0)
        this.prefixPowerWithHR = [0];
        this.prefixHR          = [0];
        this.prefixCountHR     = [0];

        this.zoneSeconds = ZONES.map(() => 0);
        this.best = BEST_WINDOWS.map(w => new RollingMax(w.seconds));

        // W'bal, differential model (Skiba 2015 / Froncioni-Clarke), as used
        // by GoldenCheetah. CP is taken to be FTP.
        this.wbal = this.wprime;
        this.wbalSeries = [];
        this.wbalMin = this.wprime;
        this.wbalZoneSeconds = WBAL_ZONES.map(() => 0);
        this.aboveCPWork = 0;

        // matches: efforts above CP that cost at least MATCH_MIN_JOULES
        this.matchSmoothSum = 0;
        this.inMatch = false;
        this.matchStartW = 0;
        this.matchMinW = 0;
        this.matches = [];

        // Skiba xPower / BikeScore
        this.xWeighted = 0;
        this.x4Sum = 0;

        // Skiba aerobic / anaerobic TISS
        this.aTISS = 0;
        this.anTISS = 0;

        // target adherence over the whole session
        this.targetSeconds = 0;
        this.onTargetSeconds = 0;

        this.resetInterval(undefined);
    }

    resetInterval(id) {
        this.interval = {
            id,
            count: 0,
            sumPower: 0,
            sumHR: 0,
            countHR: 0,
            sumCadence: 0,
            countCadence: 0,
            sumTarget: 0,
            targetSeconds: 0,
            onTargetSeconds: 0,
        };
    }

    setFtp(ftp) {
        if(ftp > 0) this.ftp = ftp;
    }

    // W′bal and matches against this CP instead of FTP (null: FTP again)
    setCp(cp) {
        this.cp = cp > 0 ? cp : null;
    }

    setWeight(weight) {
        if(weight > 0) this.weight = weight;
    }

    // changing W' rescales the current balance so the percentage is kept
    setWprime(wprime) {
        if(!(wprime > 0) || wprime === this.wprime) return;
        const k = wprime / this.wprime;
        this.wbal *= k;
        this.wbalMin *= k;
        this.matchStartW *= k;
        this.matchMinW *= k;
        this.wbalSeries = this.wbalSeries.map(w => w * k);
        this.wprime = wprime;
    }

    push(sample = {}) {
        const power   = isNum(sample.power) && sample.power > 0 ? sample.power : 0;
        const hr      = isNum(sample.heartRate) && sample.heartRate > 0 ? sample.heartRate : 0;
        const cadence = isNum(sample.cadence) && sample.cadence > 0 ? sample.cadence : 0;
        const target  = isNum(sample.target) && sample.target > 0 ? sample.target : 0;

        if(sample.interval !== this.interval.id) {
            this.resetInterval(sample.interval);
        }

        const i = this.count;
        this.power.push(power);
        this.hr.push(hr);
        this.cadence.push(cadence);
        this.target.push(target);
        this.count += 1;

        // power
        this.sumPower += power;
        if(power > this.maxPower) this.maxPower = power;

        // NP: 30s rolling average, raised to 4th power, averaged
        this.rollSum += power;
        if(i >= NP_WINDOW) this.rollSum -= this.power[i - NP_WINDOW];
        if(i + 1 >= NP_WINDOW) {
            this.np4Sum += Math.pow(this.rollSum / NP_WINDOW, 4);
            this.npCount += 1;
        }

        // best efforts
        this.best.forEach(b => b.push(this.power, i));

        // heart rate
        if(hr > 0) {
            this.sumHR += hr;
            this.countHR += 1;
            if(hr > this.maxHR) this.maxHR = hr;
        }
        this.prefixPowerWithHR.push(this.prefixPowerWithHR[i] + (hr > 0 ? power : 0));
        this.prefixHR.push(this.prefixHR[i] + hr);
        this.prefixCountHR.push(this.prefixCountHR[i] + (hr > 0 ? 1 : 0));

        // cadence (coasting excluded)
        if(cadence > 0) {
            this.sumCadence += cadence;
            this.countCadence += 1;
        }

        // W'bal (against the rider model's CP when set, else FTP)
        const cp = this.wbalCp();
        const W0 = this.wprime;
        if(power < cp) {
            this.wbal += (cp - power) * (W0 - this.wbal) / W0;
        } else {
            this.wbal -= (power - cp);
            this.aboveCPWork += power - cp;
        }
        this.wbalSeries.push(this.wbal);
        if(this.wbal < this.wbalMin) this.wbalMin = this.wbal;
        const used = Math.min(99.999, Math.max(0, (1 - this.wbal / W0) * 100));
        this.wbalZoneSeconds[Math.floor(used / 25)] += 1;

        // matches (WPrime.cpp: start when raw or 25s-smoothed >= CP, end when both < CP)
        this.matchSmoothSum += power;
        if(i >= MATCH_SMOOTHING) this.matchSmoothSum -= this.power[i - MATCH_SMOOTHING];
        const smooth = this.matchSmoothSum / Math.min(i + 1, MATCH_SMOOTHING);
        if(!this.inMatch && (power >= cp || smooth >= cp)) {
            this.inMatch = true;
            this.matchStartW = i > 0 ? this.wbalSeries[i - 1] : W0;
            this.matchMinW = this.wbal;
            this.matchStart = i;
        } else if(this.inMatch) {
            if(this.wbal < this.matchMinW) this.matchMinW = this.wbal;
            if(power < cp && smooth < cp) {
                this.inMatch = false;
                const cost = this.matchStartW - this.matchMinW;
                if(cost >= MATCH_MIN_JOULES) {
                    this.matches.push({start: this.matchStart, stop: i, cost});
                }
            }
        }

        // xPower: 25 s exponentially weighted average, 4th power mean
        this.xWeighted = this.xWeighted * (XPOWER_WINDOW / (XPOWER_WINDOW + 1)) +
                         power * (1 / (XPOWER_WINDOW + 1));
        this.x4Sum += Math.pow(this.xWeighted, 4);

        // TISS
        if(this.ftp > 0) {
            const f = power / this.ftp;
            this.aTISS  += ATISS.a  * Math.exp(ATISS.b  * Math.exp(ATISS.c  * f));
            this.anTISS += ANTISS.a * Math.exp(ANTISS.b * Math.exp(ANTISS.c * f));
        }

        // zones (coasting counts as Z1)
        this.zoneSeconds[zoneIndex(power, this.ftp, this.percentages)] += 1;

        // target adherence
        const onTarget = target > 0 &&
              Math.abs(power - target) <= Math.max(target * TARGET_TOLERANCE, TARGET_TOLERANCE_MIN_WATTS);
        if(target > 0) {
            this.targetSeconds += 1;
            if(onTarget) this.onTargetSeconds += 1;
        }

        // current interval
        const iv = this.interval;
        iv.count += 1;
        iv.sumPower += power;
        if(hr > 0) { iv.sumHR += hr; iv.countHR += 1; }
        if(cadence > 0) { iv.sumCadence += cadence; iv.countCadence += 1; }
        if(target > 0) {
            iv.sumTarget += target;
            iv.targetSeconds += 1;
            if(onTarget) iv.onTargetSeconds += 1;
        }
    }

    // average power over the last n seconds
    recentPower(n) {
        const len = Math.min(n, this.count);
        if(len === 0) return 0;
        let s = 0;
        for(let i = this.count - len; i < this.count; i++) s += this.power[i];
        return s / len;
    }

    recentCadence(n) {
        const len = Math.min(n, this.count);
        let s = 0, c = 0;
        for(let i = this.count - len; i < this.count; i++) {
            if(this.cadence[i] > 0) { s += this.cadence[i]; c += 1; }
        }
        return c > 0 ? s / c : 0;
    }

    xpower() {
        if(this.count === 0) return 0;
        return Math.pow(this.x4Sum / this.count, 0.25);
    }

    // seconds until W' is empty if the last 10 s of power is held
    // the CP W′bal works against: the rider model's, else FTP
    wbalCp() { return this.cp > 0 ? this.cp : this.ftp; }

    timeToEmpty() {
        const p = this.recentPower(10), cp = this.wbalCp();
        if(p <= cp || this.wbal <= 0) return null;
        return this.wbal / (p - cp);
    }

    np() {
        if(this.npCount === 0) return 0;
        return Math.pow(this.np4Sum / this.npCount, 0.25);
    }

    // Pa:Hr aerobic decoupling, first half vs second half, in percent.
    // Positive = heart rate drifting up relative to power.
    decoupling() {
        const n = this.count;
        if(n < 600) return null; // needs at least 10 minutes to mean anything
        const half = Math.floor(n / 2);
        const ef = (a, b) => {
            const c = this.prefixCountHR[b] - this.prefixCountHR[a];
            if(c < 60) return null;
            const p = (this.prefixPowerWithHR[b] - this.prefixPowerWithHR[a]) / c;
            const h = (this.prefixHR[b] - this.prefixHR[a]) / c;
            return h > 0 ? p / h : null;
        };
        const ef1 = ef(0, half);
        const ef2 = ef(half, n);
        if(!ef1 || !ef2) return null;
        return (ef1 - ef2) / ef1 * 100;
    }

    summary() {
        const n        = this.count;
        const ftp      = this.ftp;
        const avgPower = n > 0 ? this.sumPower / n : 0;
        const np       = this.np();
        const intensity = ftp > 0 ? np / ftp : 0;
        const tss      = ftp > 0 ? (n * np * intensity) / (ftp * 3600) * 100 : 0;
        const avgHR    = this.countHR > 0 ? this.sumHR / this.countHR : 0;
        const iv       = this.interval;
        const xp       = this.xpower();
        const ri       = ftp > 0 ? xp / ftp : 0;
        const W0       = this.wprime;
        const matchesNow = this.matches.length +
              (this.inMatch && this.matchStartW - this.matchMinW >= MATCH_MIN_JOULES ? 1 : 0);

        return {
            seconds:   n,
            ftp,
            weight:    this.weight,
            avgPower,
            maxPower:  this.maxPower,
            np,
            intensity,
            tss,
            vi:        avgPower > 0 && np > 0 ? np / avgPower : 0,
            kj:        this.sumPower / 1000,
            wkg:       this.weight > 0 ? avgPower / this.weight : 0,
            npWkg:     this.weight > 0 ? np / this.weight : 0,
            avgHR,
            maxHR:     this.maxHR,
            ef:        avgHR > 0 ? np / avgHR : 0,
            decoupling: this.decoupling(),
            avgCadence: this.countCadence > 0 ? this.sumCadence / this.countCadence : 0,
            xpower:    xp,
            ri,
            bikescore: ftp > 0 ? (n * xp * ri) / (ftp * 3600) * 100 : 0,
            skibaVI:   avgPower > 0 && xp > 0 ? xp / avgPower : 0,
            aTISS:     this.aTISS,
            anTISS:    this.anTISS,
            aerobicity: this.aTISS + this.anTISS > 0 ? this.aTISS / (this.aTISS + this.anTISS) : null,
            wprime:    W0,
            wbal:      this.wbal,
            wbalPct:   W0 > 0 ? this.wbal / W0 : 1,
            wbalMin:   this.wbalMin,
            wExpendedMax: Math.max(0, W0 - this.wbalMin),
            aboveCPkj: this.aboveCPWork / 1000,
            matches:   matchesNow,
            inMatch:   this.inMatch,
            timeToEmpty: this.timeToEmpty(),
            wbalZones: WBAL_ZONES.map((z, i) => ({
                ...z,
                seconds: this.wbalZoneSeconds[i],
                fraction: n > 0 ? this.wbalZoneSeconds[i] / n : 0,
            })),
            zones: ZONES.map((z, i) => ({
                ...z,
                seconds: this.zoneSeconds[i],
                fraction: n > 0 ? this.zoneSeconds[i] / n : 0,
            })),
            best: BEST_WINDOWS.map((w, i) => ({
                ...w,
                watts: this.best[i].best,
                wkg: this.weight > 0 ? this.best[i].best / this.weight : 0,
                available: n >= w.seconds,
            })),
            adherence: this.targetSeconds > 0 ? this.onTargetSeconds / this.targetSeconds : null,
            interval: {
                id:        iv.id,
                seconds:   iv.count,
                avgPower:  iv.count > 0 ? iv.sumPower / iv.count : 0,
                avgHR:     iv.countHR > 0 ? iv.sumHR / iv.countHR : 0,
                avgCadence: iv.countCadence > 0 ? iv.sumCadence / iv.countCadence : 0,
                avgTarget: iv.targetSeconds > 0 ? iv.sumTarget / iv.targetSeconds : 0,
                adherence: iv.targetSeconds > 0 ? iv.onTargetSeconds / iv.targetSeconds : null,
            },
        };
    }

    // Short, actionable cues for the rider. Highest priority first.
    cues(current = {}) {
        const out = [];
        const target = current.target ?? 0;
        const n = this.count;
        if(n < 10) return out;

        if(target > 0) {
            const p10 = this.recentPower(10);
            const diff = p10 - target;
            const tol = Math.max(target * 0.08, 10);
            if(diff > tol) {
                out.push({level: 'warn', text: `Above target by ${Math.round(diff)} W — ease off`});
            } else if(diff < -tol) {
                out.push({level: 'warn', text: `Below target by ${Math.round(-diff)} W — push a little`});
            } else {
                out.push({level: 'good', text: 'On target — hold it steady'});
            }
        }

        const W0 = this.wprime;
        if(this.wbalMin < -W0 * 0.05) {
            out.push({level: 'info', text: 'W′ went below zero: FTP or W′ is probably set too low'});
        }
        const tte = this.timeToEmpty();
        if(tte !== null && tte < 600) {
            const m = Math.floor(tte / 60), sec = Math.floor(tte % 60);
            out.push({level: tte < 60 ? 'warn' : 'info',
                      text: `At this power W′ is empty in ${m}:${String(sec).padStart(2, '0')}`});
        } else if(this.wbal < W0 * 0.25 && this.recentPower(10) < this.wbalCp()) {
            out.push({level: 'info', text: `W′ at ${Math.round(this.wbal / W0 * 100)}% — recover before the next effort`});
        }

        const cad30 = this.recentCadence(30);
        if(cad30 > 0 && cad30 < 75 && this.recentPower(30) > this.ftp * 0.75) {
            out.push({level: 'info', text: `Cadence ${Math.round(cad30)} rpm under load — spin a bit faster`});
        }

        const dec = this.decoupling();
        if(dec !== null && n >= 1200 && dec > 5) {
            out.push({level: 'warn', text: `HR drift ${dec.toFixed(1)}% — drink and cool down`});
        }

        return out;
    }
}

export {
    SessionStats,
    zoneIndex,
    ZONES,
    BEST_WINDOWS,
    WBAL_ZONES,
    DEFAULT_PERCENTAGES,
    DEFAULT_WPRIME,
};
