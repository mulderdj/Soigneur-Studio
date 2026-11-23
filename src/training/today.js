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

export { selectTodaysWorkout };
