//
// Soigneur's MCP tools and prompts. Provider-neutral: every tool says what it
// returns and in which units; nothing here is written for one AI model.
//

import { z } from 'zod';
import { SoigneurError } from './soigneur.js';

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a day as YYYY-MM-DD');
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
        description: `Per day: TSS, fitness (CTL, 42-day load), fatigue (ATL, 7-day load) and form (TSB) with its label (Very fresh, Fresh, Neutral, Building, Overreaching); and a forecast from the planned workouts. Default range: the last 42 days, forecast 14 days. ${UNITS}`,
        inputSchema: {
            from: DAY.optional(), to: DAY.optional(),
            forecast_days: z.number().int().min(0).max(90).optional().describe('days of forecast after today (default 14)'),
        },
        annotations: READ,
    }, run(a => data.formRows({from: a.from, to: a.to, forecastDays: a.forecast_days ?? 14})));

    server.registerTool('get_progress', {
        title: 'Progress',
        description: `Trends over the last weeks (default 12): weekly volume (rides, hours, TSS, kJ), this week so far against the same days last week, intensity distribution per week in 3 zones (easy Z1–Z2, middle Z3–Z5, hard Z6–Z7), the power curve (last 42 days against all time), weekly FTP estimates from the best 20 or 60 minutes, and aerobic efficiency of steady rides with its 28-day rolling mean. ${UNITS}`,
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
        description: `Planned workouts in a date range (default: a week back to three weeks ahead): id, day, name, status (planned, done or missed), the ride that fulfilled it, where it was planned (Soigneur, intervals.icu, AI), planned TSS at the current FTP, duration and steps (power as % FTP, ramps as from/to, free ride, slope for all-out test efforts; repeated blocks as {repeat, steps}). ${UNITS}`,
        inputSchema: {from: DAY.optional(), to: DAY.optional()},
        annotations: READ,
    }, run(a => data.plan(a)));

    server.registerTool('list_workouts', {
        title: 'Workout library',
        description: `The workout library: built-in workouts, the built-in tests (FTP, ramp, 3/12, sprint) and the rider's own. Per workout: id, name, where it comes from, category, duration, planned TSS at the current FTP and a short description. query filters on name, category and description. ${UNITS}`,
        inputSchema: {query: z.string().optional().describe('words to look for, e.g. "vo2", "threshold", "test"')},
        annotations: READ,
    }, run(a => data.workouts(a)));
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
}

export { registerTools, registerPrompts, GUARDRAILS };
