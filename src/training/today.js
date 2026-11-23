//
// Today's planned workout: selected on the Ride page when the app starts
// (or the day changes), unless a ride is running or the rider picked a
// workout by hand today.
//

import { history } from './history.js';
import { autoSelectWorkout } from './plan.js';

async function selectTodaysWorkout({today, watchStatus, handPickedDay, select}) {
    const entries = await history.planEntries();
    const workout = autoSelectWorkout({entries, today, watchStatus, handPickedDay});
    if(workout) select(workout);
    return workout;
}

// checks again whenever asked (start, plan changes, every minute) until
// today's planned workout has been selected once; after that the rider's
// own choices for the day are left alone
function todayChecker({getToday, getWatchStatus, getHandPicked, select}) {
    let selectedDay = null;
    let running = null;

    async function run() {
        const today = getToday();
        if(selectedDay === today) return;
        const workout = await selectTodaysWorkout({
            today, watchStatus: getWatchStatus(), handPickedDay: getHandPicked(), select,
        });
        if(workout) selectedDay = today;
    }

    return {
        check() {
            running = (running ?? Promise.resolve()).then(run, run);
            return running;
        },
    };
}

export { selectTodaysWorkout, todayChecker };
