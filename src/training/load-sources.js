// @ts-check
//
// A training load (TSS) for every workout, from the best data it has:
//
//   power     the summary's own TSS (power, or a source's own load such as
//             intervals.icu's, which already falls back to heart rate)
//   hr        heart rate against the rider's threshold heart rate for the
//             sport: IF = (avg − rest) / (threshold − rest), TSS = h × IF² × 100
//   rpe       how hard the rider said it was (1–10): empirically calibrated
//             Borg CR-10 TSS/hr table (TrainingPeaks / intervals.icu rTSS)
//   estimate  hours × a typical load per hour for the sport
//
// Each workout says which one it got (loadSource), so the page can mark it.
//

const PER_HOUR = {cycling: 50, run: 60, swim: 50, walk: 20, hike: 35, weighttraining: 30, yoga: 15, other: 40};
const RPE_PER_HOUR = [0, 20, 30, 40, 50, 60, 70, 80, 100, 120, 140];
const DEFAULT_REST = 60;
const MAX_IF = 1.2;
const REST_LOOKBACK_DAYS = 7;

const round1 = (x) => Math.round(x * 10) / 10;
const pos = (x) => (Number.isFinite(x) && x > 0 ? x : null);

// which threshold a sport uses; null = heart rate doesn't say enough
function thresholdFor(sport, thresholds = {}) {
    const s = sport || 'cycling';
    if(s === 'cycling') return pos(thresholds?.cycling);
    if(s === 'run' || s === 'walk' || s === 'hike') return pos(thresholds?.running);
    return null;
}

function effectiveLoad(summary, {rating = null, thresholds = null, restingHr = null} = {}) {
    if(Number.isFinite(summary?.tss) && summary.tss > 0) return {tss: summary.tss, loadSource: 'power'};
    const hours = Math.max(0, Number(summary?.duration) || 0) / 3600;

    const threshold = thresholdFor(summary?.sport, thresholds);
    const avgHr = pos(summary?.avgHr);
    const rest = pos(restingHr) ?? DEFAULT_REST;
    if(avgHr && threshold && threshold > rest) {
        const intensity = Math.min(MAX_IF, Math.max(0, (avgHr - rest) / (threshold - rest)));
        return {tss: round1(hours * intensity * intensity * 100), loadSource: 'hr'};
    }
    if(Number.isInteger(rating) && rating >= 1 && rating <= 10) {
        return {tss: round1(hours * RPE_PER_HOUR[rating]), loadSource: 'rpe'};
    }
    const perHour = PER_HOUR[summary?.sport || 'cycling'] ?? PER_HOUR.other;
    return {tss: round1(hours * perHour), loadSource: 'estimate'};
}

// the rider's own setting wins, per sport; Garmin's fills the rest
function mergeThresholds(own, garmin) {
    return {
        cycling: pos(own?.cycling) ?? pos(garmin?.cycling),
        running: pos(own?.running) ?? pos(garmin?.running),
    };
}

// resting heart rate on a day: that day, else the nearest earlier day
// within a week; days = Map(day → {restingHr, ...})
function restingHrOn(day, days) {
    if(!day || !days?.size) return null;
    const t = Date.parse(day);
    for(let i = 0; i <= REST_LOOKBACK_DAYS; i++) {
        const d = new Date(t - i * 86400000).toISOString().slice(0, 10);
        const r = pos(days.get(d)?.restingHr);
        if(r) return r;
    }
    return null;
}

export { effectiveLoad, mergeThresholds, restingHrOn, thresholdFor, PER_HOUR };
