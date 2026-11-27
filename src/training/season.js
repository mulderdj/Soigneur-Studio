// @ts-check
//
// Season planning: goal events (A, B or C priority) and weekly training
// phases (Base, Build, Peak, Taper) derived working backward from upcoming
// A-priority goals, plus mini-taper markers for B-priority tune-up events.
//

import { addDays, daysBetween, weekStart } from './dates.js';

/** @typedef {'A' | 'B' | 'C'} GoalPriority */
/** @typedef {'base' | 'build' | 'peak' | 'taper'} TrainingPhase */

/**
 * @typedef {object} GoalEventData
 * @property {string} name
 * @property {GoalPriority} priority
 * @property {string | null} [eventType]
 * @property {number | null} [targetDurationS]
 * @property {number | null} [targetTss]
 * @property {string | null} [notes]
 */

/**
 * @typedef {GoalEventData & {id: string, day: string, origin: string}} GoalEvent
 */

const PRIORITIES = /** @type {const} */ (['A', 'B', 'C']);

const EVENT_TYPES = [
    {key: 'road-race', label: 'Road race'},
    {key: 'gran-fondo', label: 'Gran fondo'},
    {key: 'tt', label: 'Time trial'},
    {key: 'crit', label: 'Criterium'},
    {key: 'sportive', label: 'Sportive'},
    {key: 'gravel', label: 'Gravel'},
    {key: 'mtb', label: 'MTB'},
    {key: 'stage-race', label: 'Stage race'},
    {key: 'other', label: 'Event'},
];

const EVENT_TYPE_LABELS = new Map(EVENT_TYPES.map(t => [t.key, t.label]));

const PHASE_LABELS = /** @type {Record<TrainingPhase, string>} */ ({
    base: 'Base',
    build: 'Build',
    peak: 'Peak',
    taper: 'Taper',
});

// Maximum lookahead (in weeks) for a single A-goal macro-cycle.
const MAX_CYCLE_WEEKS = 52;

const PRIORITY_RANK = {A: 0, B: 1, C: 2};

/**
 * Whether a plan store entry represents a goal event rather than a workout.
 * @param {any} entry
 * @returns {boolean}
 */
function isGoalEvent(entry) {
    return Boolean(entry && !entry.deleted && (entry.kind === 'event' || (entry.event && typeof entry.event === 'object')));
}

/**
 * Human-readable label for an eventType key (or '' if unset).
 * @param {string | null | undefined} eventType
 * @returns {string}
 */
function eventTypeLabel(eventType) {
    if(!eventType) return '';
    const key = String(eventType).trim().toLowerCase();
    if(!key) return '';
    if(EVENT_TYPE_LABELS.has(key)) return EVENT_TYPE_LABELS.get(key) ?? '';
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/[-_]+/g, ' ');
}

/**
 * Validate and normalize a goal event payload.
 * @param {any} raw
 * @returns {GoalEventData}
 */
function normalizeGoalEvent(raw) {
    if(!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Goal event must be an object.');
    }
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : '';
    if(!name) throw new Error('Goal event needs a name.');
    const priority = /** @type {GoalPriority} */ (String(raw.priority ?? 'A').trim().toUpperCase());
    if(!PRIORITIES.includes(priority)) {
        throw new Error("Goal event priority must be 'A', 'B' or 'C'.");
    }
    const rawType = typeof raw.eventType === 'string' ? raw.eventType.trim().slice(0, 40) : '';
    const eventType = rawType || null;
    const dur = raw.targetDurationS !== undefined && raw.targetDurationS !== null && raw.targetDurationS !== ''
        ? Number(raw.targetDurationS) : null;
    if(dur !== null && (!Number.isFinite(dur) || dur <= 0 || dur > 7 * 86400)) {
        throw new Error('Target duration must be a positive number of seconds.');
    }
    const targetDurationS = dur !== null ? Math.round(dur) : null;
    const tss = raw.targetTss !== undefined && raw.targetTss !== null && raw.targetTss !== ''
        ? Number(raw.targetTss) : null;
    if(tss !== null && (!Number.isFinite(tss) || tss <= 0 || tss > 2000)) {
        throw new Error('Target TSS must be between 1 and 2000.');
    }
    const targetTss = tss !== null ? Math.round(tss) : null;
    const rawNotes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 500) : '';
    const notes = rawNotes || null;

    return {name, priority, eventType, targetDurationS, targetTss, notes};
}

/**
 * Extract normalized goal events from either a plan entry array or goal list,
 * sorted chronologically and then by priority (A, B, C).
 * @param {any[]} items
 * @returns {GoalEvent[]}
 */
function goalEventsFromPlan(items = []) {
    /** @type {GoalEvent[]} */
    const out = [];
    for(const item of items ?? []) {
        if(!item || item.deleted) continue;
        const day = typeof item.day === 'string' ? item.day : null;
        if(!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const src = item.event && typeof item.event === 'object' ? item.event :
            (item.kind === 'event' || (item.priority && item.name && !item.workout) ? item : null);
        if(!src) continue;
        try {
            const norm = normalizeGoalEvent(src);
            out.push({
                id: String(item.id ?? `${day}-${norm.name}`),
                day,
                origin: typeof item.origin === 'string' ? item.origin : 'auuki',
                ...norm,
            });
        } catch(e) {
            // ignore malformed records rather than breaking rendering
        }
    }
    return out.sort((a, b) => (
        a.day < b.day ? -1 : a.day > b.day ? 1 :
        (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || a.name.localeCompare(b.name)
    ));
}

/**
 * Estimated training load (TSS) of an event itself, used for days *after* an
 * intermediate event when no structured workout is planned on that day.
 * @param {GoalEventData | null | undefined} event
 * @returns {number}
 */
function eventLoadTss(event) {
    if(!event) return 0;
    if(Number.isFinite(event.targetTss) && (event.targetTss ?? 0) > 0) return Math.round(/** @type {number} */ (event.targetTss));
    if(Number.isFinite(event.targetDurationS) && (event.targetDurationS ?? 0) > 0) {
        const hours = /** @type {number} */ (event.targetDurationS) / 3600;
        const perHour = event.priority === 'C' ? 55 : 70;
        return Math.round(hours * perHour);
    }
    return 0;
}

/**
 * Map weeks remaining until an A-goal's race week to a training phase:
 *   0–1 weeks out (race week & prior week) -> Taper (last 1–2 weeks)
 *   2–3 weeks out                          -> Peak  (prior 2 weeks)
 *   4–8 weeks out                          -> Build (prior 5 weeks)
 *   9+ weeks out (up to MAX_CYCLE_WEEKS)   -> Base  (earlier weeks)
 *
 * @param {number} weeksOut
 * @returns {TrainingPhase | null}
 */
function phaseFromWeeksOut(weeksOut) {
    if(!Number.isFinite(weeksOut) || weeksOut < 0 || weeksOut > MAX_CYCLE_WEEKS) return null;
    if(weeksOut <= 1) return 'taper';
    if(weeksOut <= 3) return 'peak';
    if(weeksOut <= 8) return 'build';
    return 'base';
}

/**
 * Derive the training phase and event markers for a single Monday week.
 * Multiple A goals are handled by anchoring each week to the nearest A goal
 * whose race week is on or after `monday`: leading into A1 builds Base ->
 * Build -> Peak -> Taper; after A1's week passes, the cycle transitions to
 * the next A goal (jumping straight into Build, Peak or Taper when A2 is
 * close, or Base when A2 is further out). B goals add a `miniTaper` badge on
 * their week without resetting the A-goal macro-cycle.
 *
 * @param {any[]} eventsOrPlan
 * @param {string} dayOrWeek
 */
function phaseForWeek(eventsOrPlan, dayOrWeek) {
    const monday = weekStart(dayOrWeek);
    const sunday = addDays(monday, 6);
    const goals = goalEventsFromPlan(eventsOrPlan);
    const aGoals = goals.filter(g => g.priority === 'A');
    const weekGoals = goals.filter(g => g.day >= monday && g.day <= sunday);

    const targetGoal = aGoals.find(g => weekStart(g.day) >= monday) ?? null;
    const weeksToGoal = targetGoal ? Math.round(daysBetween(monday, weekStart(targetGoal.day)) / 7) : null;
    const phase = weeksToGoal !== null ? phaseFromWeeksOut(weeksToGoal) : null;
    const label = phase ? PHASE_LABELS[phase] : null;
    const hasBGoal = weekGoals.some(g => g.priority === 'B');
    const miniTaper = hasBGoal && phase !== 'taper';

    return {
        week: monday,
        phase,
        label,
        targetGoal: phase ? targetGoal : null,
        weeksToGoal: phase ? weeksToGoal : null,
        miniTaper,
        goals: weekGoals,
    };
}

/**
 * Derive weekly phase rows across `[fromDay, toDay]` (inclusive of each
 * endpoint's Monday week).
 *
 * @param {any[]} eventsOrPlan
 * @param {string} fromDay
 * @param {string} toDay
 */
function weeklyPhases(eventsOrPlan, fromDay, toDay) {
    if(!fromDay || !toDay || fromDay > toDay) return [];
    const goals = goalEventsFromPlan(eventsOrPlan);
    const start = weekStart(fromDay);
    const end = weekStart(toDay);
    const count = Math.floor(daysBetween(start, end) / 7) + 1;
    const rows = [];
    for(let i = 0; i < count; i++) {
        rows.push(phaseForWeek(goals, addDays(start, i * 7)));
    }
    return rows;
}

export {
    PRIORITIES,
    EVENT_TYPES,
    PHASE_LABELS,
    MAX_CYCLE_WEEKS,
    isGoalEvent,
    eventTypeLabel,
    normalizeGoalEvent,
    goalEventsFromPlan,
    eventLoadTss,
    phaseFromWeeksOut,
    phaseForWeek,
    weeklyPhases,
};
