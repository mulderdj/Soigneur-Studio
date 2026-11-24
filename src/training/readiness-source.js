//
// What the Ride page's readiness note needs: today's verdict, today's
// planned workout, the next free day, and the plan actions (history).
//

import { db } from '../db.js';
import { history } from './history.js';
import { countable } from './merge.js';
import { planStatus } from './plan.js';
import { today } from './dates.js';
import { readiness, nextFreeDay } from './readiness.js';

const readinessSource = {
    async context() {
        const [summaries, plan, wellness] = await Promise.all([history.summaries(), history.planEntries(), history.wellnessDays()]);
        const t = today();
        return {
            today: t,
            ftp: db.ftp,
            verdict: readiness({today: t, days: wellness, summaries: countable(summaries), ftp: db.ftp}),
            entry: plan.find(e => !e.deleted && e.day === t && planStatus(e, t) === 'planned' && e.workout) ?? null,
            nextFree: nextFreeDay(plan, t),
        };
    },
    actions: history,
};

export { readinessSource };
