//
// Where the ride page gets a ride from (replaceable in tests):
//   summary(id)       the ride's summary (calendar data), or null
//   ride(id)          {ride: readRide(...)} or {reason, message}
//   context(summary)  the rider's FTP, weight, W′, LTHR, the workout the
//                     ride followed, and every summary (for records)
//

import { db } from '../../db.js';
import { history } from '../../training/history.js';
import { readRide } from '../../training/fit-records.js';
import { thresholds } from '../../training/rider-thresholds.js';
import { session } from '../training-dashboard.js';

const rideSource = {
    async summary(id) {
        return (await history.summaries()).find(s => s.id === id) ?? null;
    },
    async ride(id) {
        const out = await history.rideFile(id);
        if(!out.view) return out;
        const ride = readRide(out.view);
        return ride.samples.length ? {ride} : {reason: 'unreadable', message: 'The ride\'s file holds no samples.'};
    },
    async context(summary) {
        const entries = await history.planEntries().catch(() => []);
        // the plan entry the ride is linked to, else one that day with the ride's workout
        const planned = (entries.find(e => e.rideId && e.rideId === summary?.id) ??
                         entries.find(e => summary?.workoutId && e.day === summary.day && e.workout?.id === summary.workoutId))?.workout ?? null;
        const own = summary?.workoutId ? (db.workouts ?? []).find(w => w.id === summary.workoutId) : null;
        return {
            ftp: db.ftp, weight: db.weight, wprime: session.wprime,
            // a run's heart-rate zones from the running threshold
            lthr: (/run/.test(summary?.sport ?? '') ? thresholds.effective().running : thresholds.effective().cycling) ?? null,
            workout: planned ?? own ?? null,
            summaries: await history.summaries(),
        };
    },
};

export { rideSource };
