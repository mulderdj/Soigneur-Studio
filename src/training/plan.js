//
// The training plan: planned TSS of a workout, the status of a plan entry,
// matching a saved ride to the plan, and whether to pick today's workout.
//
// PlanEntry = {id, day, workout, rideId, updatedAt, deleted}
// The entry keeps its own copy of the workout, so removing a workout from
// the library doesn't break the plan.
//

const SLOPE_ONLY_POWER = 0.65; // relative power assumed for steps without a power target

// workout steps carry power relative to FTP, so TSS needs no FTP:
// TSS = Σ duration × IF² / 3600 × 100
function plannedTss(workout) {
    let tss = 0;
    for(const interval of workout?.intervals ?? []) {
        for(const s of interval.steps ?? []) {
            const duration = Number.isFinite(s.duration) ? s.duration : (interval.duration ?? 0);
            const p = Number.isFinite(s.power) ? s.power : SLOPE_ONLY_POWER;
            tss += duration * p * p / 36;
        }
    }
    return tss;
}

function planStatus(entry, today) {
    if(entry.rideId) return 'done';
    return entry.day < today ? 'missed' : 'planned';
}

function matchRide(summary, entries) {
    const open = entries.filter(e => !e.deleted && !e.rideId && e.day === summary.day);
    const same = open.find(e => e.workout?.id && e.workout.id === summary.workoutId);
    return (same ?? open[0])?.id ?? null;
}

function autoSelectWorkout({entries, today, watchStatus, handPickedDay}) {
    if(watchStatus === 'started' || watchStatus === 'paused') return null;
    if(handPickedDay === today) return null;
    const entry = entries.find(e => !e.deleted && e.day === today && planStatus(e, today) === 'planned');
    return entry?.workout ?? null;
}

export { plannedTss, planStatus, matchRide, autoSelectWorkout, SLOPE_ONLY_POWER };
