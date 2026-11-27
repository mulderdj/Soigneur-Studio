//
// Soigneur's MCP tools and prompts. Provider-neutral: every tool says what it
// returns and in which units; nothing here is written for one AI model.
//

import { z } from 'zod';
import { SoigneurError } from './soigneur.js';

const validDay = s => {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const DAY = z.string().refine(validDay, 'a real calendar day as YYYY-MM-DD');
const READ = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};

const UNITS = 'Units are in the key names: _s seconds, _w watts, _bpm beats per minute, _j joules, _kj kilojoules, _pct percent, _h hours. Days are YYYY-MM-DD in the rider\'s time zone.';

function result(value) {
    return {content: [{type: 'text', text: JSON.stringify(value)}]};
}

function failure(e) {
    const message = e instanceof SoigneurError ? e.message : `Something went wrong in Soigneur's MCP server: ${e?.message ?? e}`;
    if(!(e instanceof SoigneurError)) console.error(':mcp', e);
    return {isError: true, content: [{type: 'text', text: message}]};
}

const run = fn => async (args) => {
    try { return result(await fn(args ?? {})); } catch(e) { return failure(e); }
};

const STEP = z.object({
    duration_s: z.number().int().min(1).max(21600).describe('seconds'),
    power_pct: z.number().min(0).max(300).optional().describe('steady power, % of FTP'),
    power_pct_from: z.number().min(0).max(300).optional().describe('a ramp: start, % of FTP (with power_pct_to)'),
    power_pct_to: z.number().min(0).max(300).optional().describe('a ramp: end, % of FTP'),
    cadence_rpm: z.number().int().min(30).max(150).optional(),
    free_ride: z.boolean().optional().describe('no power target (coasting, free riding)'),
}).refine(s => (s.power_pct_from === undefined) === (s.power_pct_to === undefined),
    'a ramp needs both power_pct_from and power_pct_to');
const BLOCK = z.union([STEP, z.object({
    repeat: z.number().int().min(2).max(50),
    steps: z.array(STEP).min(1).max(20).describe('the steps repeated, e.g. on and off'),
})]);
const WORKOUT = z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional().describe('the purpose, shown to the rider'),
    steps: z.array(BLOCK).min(1).max(100).describe('in order: warm-up, main set, cool-down'),
});
const WRITE = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false};
const RULES = 'Soigneur checks it first: steps of 30–200 % FTP, at most 6 h a day, not on a ridden day or over a workout planned on intervals.icu, fitness (CTL) rising at most 8 a week, a day without training each week, no two days above 90 TSS in a row (unless the rider allows it), base weeks at least 75 % in Z1–Z2, no hard workout today unless today\'s readiness is ready. When a rule fails, nothing is stored and the findings say what to change.';

function registerTools(server, data) {
    server.registerTool('get_athlete', {
        title: 'Athlete and readiness',
        description: `The rider now: FTP, weight, typed W′, threshold heart rates per sport, the rider model (critical power and W′ fitted from the last 90 days, and the ones in use), the power profile (W/kg against reference tables) and today's readiness verdict (ready, take-care or rest) with its reasons. Start here. ${UNITS}`,
        inputSchema: {},
        annotations: READ,
    }, run(() => data.athlete()));

    server.registerTool('list_rides', {
        title: 'Rides',
        description: `Rides and other workouts in a date range (default: the last 28 days), each counted once across Soigneur, Garmin, intervals.icu and imported files. Per ride: id (for get_ride_analysis), day, start time, name, sport, source, duration, distance, TSS and what it was worked out from (power, hr, rpe or estimate), IF, NP, average power, kJ, average and max heart rate, the rider's RPE, the FTP it was ridden with, and the planned workout it fulfilled. Hidden rides (duplicates the rider hid) are marked hidden and don't count for form. ${UNITS}`,
        inputSchema: {
            from: DAY.optional().describe('first day, YYYY-MM-DD'),
            to: DAY.optional().describe('last day, YYYY-MM-DD (default today)'),
            sport: z.string().optional().describe('only this sport, e.g. cycling, running'),
        },
        annotations: READ,
    }, run(a => data.listRides(a)));

    server.registerTool('get_ride_analysis', {
        title: 'Ride analysis',
        description: `One ride analysed as the ride page shows it: the planned workout and its steps (power as % FTP; repeated blocks as {repeat, steps}), every interval (target, average and normalised power, % FTP, heart rate, cadence, time on target, power fade and heart-rate drift within the interval), planned against done per rep, the efforts with heart-rate recovery 60 s after each, W′ balance (lowest, matches burnt), time in power and heart-rate zones, best efforts and records, this ride's best power against the 90 days before it, aerobic decoupling (steady rides of 45 min or more), efficiency factor (NP ÷ HR), and durability (best 5 and 20 min power after 1000, 2000, 3000 kJ). ride_id: an id from list_rides, or "latest" (the last cycling ride). ${UNITS}`,
        inputSchema: {ride_id: z.string().min(1).describe('a ride id from list_rides, or "latest" (the last cycling ride)')},
        annotations: READ,
    }, run(a => data.rideAnalysis(a.ride_id)));

    server.registerTool('get_form', {
        title: 'Fitness, fatigue and form',
        description: `Per day: TSS, fitness (CTL, 42-day load), fatigue (ATL, 7-day load) and form (TSB) with its label (Very fresh, Fresh, Neutral, Building, Overreaching); a forecast from the planned workouts; and race_forecast when an A or B goal event is within 90 days (projected race-day form, taper effect and taper guidance). Default range: the last 42 days, forecast 14 days. ${UNITS}`,
        inputSchema: {
            from: DAY.optional(), to: DAY.optional(),
            forecast_days: z.number().int().min(0).max(90).optional().describe('days of forecast after today (default 14)'),
        },
        annotations: READ,
    }, run(a => data.formRows({from: a.from, to: a.to, forecastDays: a.forecast_days ?? 14})));

    server.registerTool('get_progress', {
        title: 'Progress',
        description: `Trends over the last weeks (default 12): weekly volume (rides, hours, TSS, kJ), this week so far against the same days last week, intensity distribution per week in 3 zones (easy Z1–Z2, middle Z3–Z5, hard Z6–Z7), the power curve (last 42 days against all time), weekly FTP estimates from the best 20 or 60 minutes, aerobic efficiency of steady rides with its 28-day rolling mean, aerobic decoupling of long steady rides with its 28-day rolling mean, and weekly durability (best 5- and 20-minute power after 1,000 / 2,000 / 3,000 kJ as % of 90-day fresh best). ${UNITS}`,
        inputSchema: {weeks: z.number().int().min(1).max(52).optional().describe('how many weeks (default 12)')},
        annotations: READ,
    }, run(a => data.progress({weeks: a.weeks ?? 12})));

    server.registerTool('get_health', {
        title: 'Health data',
        description: `Per night (from Garmin): HRV with the rider's normal range and whether it was below, in or above it, resting heart rate, sleep and Body Battery; and the resting heart-rate trend. Default: the last 14 days. ${UNITS}`,
        inputSchema: {from: DAY.optional(), to: DAY.optional()},
        annotations: READ,
    }, run(a => data.health(a)));

    server.registerTool('get_plan', {
        title: 'Training plan',
        description: `Planned workouts, goal events (A/B/C priority, event type, target duration/TSS and notes) and derived weekly training phases (base, build, peak, taper and mini_taper) in a date range (default: a week back to three weeks ahead; upcoming season goals after 'from' are always included). Per workout entry: id, day, name, status (planned, done or missed), the ride that fulfilled it, where it was planned (Soigneur, intervals.icu, AI), planned TSS at the current FTP, duration and steps (power as % FTP, ramps as from/to, free ride, slope for all-out test efforts; repeated blocks as {repeat, steps}). ${UNITS}`,
        inputSchema: {from: DAY.optional(), to: DAY.optional()},
        annotations: READ,
    }, run(a => data.plan(a)));

    server.registerTool('list_workouts', {
        title: 'Workout library',
        description: `The workout library: built-in workouts, the built-in tests (FTP, ramp, 3/12, sprint) and the rider's own. Per workout: id, name, where it comes from, category, duration, planned TSS at the current FTP and a short description. query filters on name, category and description. ${UNITS}`,
        inputSchema: {query: z.string().optional().describe('words to look for, e.g. "vo2", "threshold", "test"')},
        annotations: READ,
    }, run(a => data.workouts(a)));

    // --- planning: needs an access key that may change the plan ---

    server.registerTool('plan_workout', {
        title: 'Plan a workout',
        description: `Adds one workout to the rider's plan on a day: a workout from list_workouts (workout_id), or one described step by step (workout: power as % FTP; repeat blocks for intervals). ${RULES} Ask the rider before planning. The plan syncs to the app and to intervals.icu. ${UNITS}`,
        inputSchema: {
            day: DAY,
            workout_id: z.string().optional().describe('a workout id from list_workouts'),
            workout: WORKOUT.optional().describe('a new workout, when none in the library fits'),
            allow_back_to_back_hard_days: z.boolean().optional().describe('only when the rider said two hard days in a row are fine'),
        },
        annotations: WRITE,
    }, run(a => data.planWorkout(a)));

    server.registerTool('move_planned', {
        title: 'Move a planned workout',
        description: `Moves a planned workout (not ridden, today or later) to another day; checked as plan_workout is. entry_id from get_plan. Ask the rider first. ${UNITS}`,
        inputSchema: {
            entry_id: z.string().min(1), day: DAY,
            allow_back_to_back_hard_days: z.boolean().optional(),
        },
        annotations: {...WRITE, idempotentHint: true},
    }, run(a => data.movePlanned(a)));

    server.registerTool('remove_planned', {
        title: 'Remove a planned workout',
        description: 'Removes a planned workout (not ridden, today or later) from the plan; one planned on intervals.icu is removed there too. entry_id from get_plan. Ask the rider first.',
        inputSchema: {entry_id: z.string().min(1)},
        annotations: {...WRITE, destructiveHint: true, idempotentHint: true},
    }, run(a => data.removePlanned(a)));

    server.registerTool('set_goal_event', {
        title: 'Add or update a goal event',
        description: `Adds or updates a season goal event (priority A for main peaks driving Base/Build/Peak/Taper phases, B for tune-up races with a mini-taper, C for low-priority events). Pass goal_id from get_plan.goal_events to edit an existing goal. Ask the rider first. ${UNITS}`,
        inputSchema: {
            goal_id: z.string().min(1).optional().describe('existing goal id from get_plan.goal_events to update'),
            day: DAY.optional().describe('event date YYYY-MM-DD (required when creating)'),
            name: z.string().min(1).max(120).optional().describe('event name (required when creating)'),
            priority: z.enum(['A', 'B', 'C']).optional().describe('A (main peak), B (tune-up), or C (training event)'),
            event_type: z.string().max(40).nullable().optional().describe('e.g. road-race, gran-fondo, tt, crit, sportive, gravel, mtb, stage-race'),
            target_duration_s: z.number().int().min(1).max(604800).nullable().optional().describe('expected event duration in seconds'),
            target_tss: z.number().int().min(1).max(2000).nullable().optional().describe('expected event TSS'),
            notes: z.string().max(500).nullable().optional(),
        },
        annotations: {...WRITE, idempotentHint: true},
    }, run(a => data.setGoalEvent(a)));

    server.registerTool('remove_goal_event', {
        title: 'Remove a goal event',
        description: 'Removes a goal event from the rider\'s season plan. goal_id from get_plan.goal_events. Ask the rider first.',
        inputSchema: {goal_id: z.string().min(1)},
        annotations: {...WRITE, destructiveHint: true, idempotentHint: true},
    }, run(a => data.removeGoalEvent(a)));

    server.registerTool('propose_plan', {
        title: 'Check a training block',
        description: `Checks a block of weeks before anything is planned, and stores nothing: per week (week_of: its Monday) a focus (e.g. base, build, peak, taper, recovery) and the workouts per day (workout_id or a described workout). ${RULES} In a block of 4 weeks or more, also an easier week at least every 4th week. Returns a proposal_id, the findings, and per week the TSS and fitness (CTL) at its start and end. Fix the findings and propose again; when it passes, show the rider the plan and call apply_plan only after they agree. replace_planned: the workouts already planned in Soigneur on those days are replaced (never intervals.icu's). ${UNITS}`,
        inputSchema: {
            goal: z.string().max(300).describe('what the block is for, e.g. "a 120 km gran fondo on 2027-03-15"'),
            weeks: z.array(z.object({
                week_of: DAY.describe('the Monday of the week'),
                focus: z.string().max(60).describe('base, build, peak, taper, recovery, ...'),
                days: z.array(z.object({
                    day: DAY,
                    workout_id: z.string().optional(),
                    workout: WORKOUT.optional(),
                })).max(7),
            })).min(1).max(16),
            replace_planned: z.boolean().optional(),
            allow_back_to_back_hard_days: z.boolean().optional().describe('only when the rider said so'),
        },
        annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    }, run(a => data.proposePlan(a)));

    server.registerTool('apply_plan', {
        title: 'Plan a checked block',
        description: 'Puts a block that passed propose_plan into the rider\'s plan, only after the rider agreed to it. It is checked again against the plan and rides as they are now; when something changed, nothing is stored. The plan syncs to the app and to intervals.icu.',
        inputSchema: {proposal_id: z.string().min(1)},
        annotations: WRITE,
    }, run(a => data.applyPlan(a)));
}

const GUARDRAILS = [
    'Ground everything in the numbers the Soigneur tools return; say which numbers you base a point on, with their units. Don\'t guess numbers the tools didn\'t give.',
    'Respect today\'s readiness verdict (get_athlete): don\'t push a hard session when it says take-care or rest.',
    'You are a training assistant, not a doctor: for chest pain, fainting, unusual breathlessness, palpitations, illness or injury, tell the rider to stop training and see a doctor.',
    'Be brief and concrete; the rider reads this on a phone.',
].map(x => `- ${x}`).join('\n');

function registerPrompts(server) {
    server.registerPrompt('ride_debrief', {
        title: 'Ride debrief',
        description: 'A coach\'s debrief of one ride: what went well, what stood out, what it means for the next days.',
        argsSchema: {ride: z.string().optional().describe('a ride id, or "latest" (default)')},
    }, ({ride}) => ({messages: [{role: 'user', content: {type: 'text', text:
`Debrief my ride (${ride?.trim() || 'latest'}) as my cycling coach.

Use the Soigneur tools: get_ride_analysis for the ride; get_athlete for my FTP, rider model and readiness; get_form for my fitness and fatigue; get_plan for the next days; list_rides for the rides before it when a comparison helps.

Cover, in this order:
1. In one or two sentences: what kind of ride it was and how it went.
2. Execution: planned against done per rep (if it was a planned workout), pacing, power fade, cadence.
3. Heart rate: drift within the efforts, recovery after them, decoupling; what that says about fatigue or fitness.
4. Anything that stands out: records, W′ matches, durability, the ride against my last 90 days.
5. What it means for the next 2–3 days, against my plan and form.

Rules:
${GUARDRAILS}`}}]}));

    server.registerPrompt('weekly_review', {
        title: 'Weekly review',
        description: 'A review of a training week: volume, intensity, the plan, form and recovery, with two or three suggestions.',
        argsSchema: {week: z.string().optional().describe('"last" (default), "this", or a day in the week, YYYY-MM-DD')},
    }, ({week}) => ({messages: [{role: 'user', content: {type: 'text', text:
`Review my training week (${week?.trim() || 'last'}; weeks run Monday to Sunday) as my cycling coach.

Use the Soigneur tools: list_rides and get_plan for the week; get_progress for volume, intensity distribution, the power curve and efficiency against the weeks before; get_form for fitness, fatigue and form; get_health for HRV, resting heart rate and sleep; get_athlete for readiness today.

Cover:
1. The week in numbers: rides, hours, TSS, against the weeks before.
2. Intensity: easy / middle / hard, and whether it fits the kind of training I'm doing.
3. The plan: what was done, missed or changed.
4. Recovery: form, HRV against its range, resting heart rate, sleep.
5. Progress: power curve, FTP estimate, aerobic efficiency.
6. Two or three concrete suggestions for next week.

Rules:
${GUARDRAILS}`}}]}));

    server.registerPrompt('training_plan', {
        title: 'Training plan',
        description: 'Builds a block of training towards a goal, checked by Soigneur, planned only after you agree.',
        argsSchema: {
            goal: z.string().describe('what you train for, e.g. "a 120 km gran fondo", "FTP up", "a 3-week base block"'),
            date: z.string().optional().describe('the event date or the end of the block, YYYY-MM-DD'),
            days_per_week: z.string().optional().describe('training days a week, e.g. "4"'),
            hours_per_week: z.string().optional().describe('hours a week, e.g. "6"'),
        },
    }, ({goal, date, days_per_week, hours_per_week}) => ({messages: [{role: 'user', content: {type: 'text', text:
`Build me a training plan as my cycling coach.

Goal: ${goal}${date ? `\nBy: ${date}` : ''}${days_per_week ? `\nDays a week: ${days_per_week}` : ''}${hours_per_week ? `\nHours a week: ${hours_per_week}` : ''}

First look at where I am: get_athlete (FTP, rider model, readiness), get_form (fitness, fatigue, form), get_progress (recent volume, intensity, power curve), list_rides for the last weeks, get_plan for what's already planned, and list_workouts for the workouts I have. Ask me what you need to know and can't find (other sports, days I can't ride, the event's demands).

Then:
1. Outline the block: weeks, the focus of each, and why.
2. Fill it with workouts: from my library where one fits, else describe them step by step. Build fitness gradually, with recovery weeks, and keep most riding easy in base weeks.
3. Check it with propose_plan. Fix every finding and propose again until it passes.
4. Show me the plan week by week (focus, workouts, TSS, fitness at the end of each week) and ask whether I agree.
5. Only when I say yes: apply_plan.

Rules:
${GUARDRAILS}
- Never plan without my yes; never work around a finding without asking me (e.g. back-to-back hard days).`}}]}));
}

export { registerTools, registerPrompts, GUARDRAILS };
