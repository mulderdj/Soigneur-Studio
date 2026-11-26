// node --test server/mcp/mcp.spec.mjs
//
// End to end: a real account server with a rider, a ride (.fit), a plan,
// health data and an access key; the MCP server on it, through the SDK's
// own client (in memory, and once over stdio as an AI app starts it).
//
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fit } from '../../src/fit/fit.js';
import { readRide } from '../../src/training/fit-records.js';
import { rideSummary } from '../../src/training/summary.js';
import { addDays } from '../../src/training/dates.js';
import { createApi, createSoigneur } from './soigneur.js';
import { createServer } from './server.js';

const require = createRequire(import.meta.url);
const { createApp } = require('../app.js');

const TODAY = '2026-11-26';
const RIDE_DAY = '2026-11-24';
const FTP = 200;
const T0 = new Date(`${RIDE_DAY}T17:00:00`).getTime();

// 10 min at 50 %, 4 × (4 min at 115 %, 3 min at 50 %), 10 min at 50 %
const VO2 = {id: 'w-vo2', meta: {name: 'VO2 4×4'}, intervals: [
    {duration: 600, steps: [{duration: 600, power: 0.5}]},
    ...[1, 2, 3, 4].flatMap(() => [
        {duration: 240, steps: [{duration: 240, power: 1.15, cadence: 95}]},
        {duration: 180, steps: [{duration: 180, power: 0.5}]},
    ]),
    {duration: 600, steps: [{duration: 600, power: 0.5}]},
]};

const VO2_DESCRIBED = {name: 'VO2 4×4', steps: [
    {duration_s: 600, power_pct: 50},
    {repeat: 4, steps: [{duration_s: 240, power_pct: 115}, {duration_s: 180, power_pct: 50}]},
    {duration_s: 600, power_pct: 50}]};

function vo2Ride(start = T0, ftp = FTP) {
    const records = [];
    let t = 0;
    for(const iv of VO2.intervals) {
        const hard = iv.steps[0].power > 1;
        for(let i = 0; i < iv.duration; i++, t++) {
            const power = Math.round(iv.steps[0].power * FTP + (hard ? 3 : 0));
            // heart rate climbs in an effort and drops in the rest after it
            const hr = hard ? 150 + Math.min(30, i / 6) : 125 + Math.max(0, 30 - i / 2);
            records.push({timestamp: start + t * 1000, power, heart_rate: Math.round(hr), cadence: hard ? 95 : 85, speed: 9, distance: t * 9});
        }
    }
    return fit.localActivity.encode({records, laps: [], events: [], ftp});
}

let app, base, token, readToken, client;

async function call(method, path, {body, auth} = {}) {
    const res = await fetch(base + path, {
        method,
        headers: {...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...(auth ? {Authorization: `Bearer ${auth}`} : {})},
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

async function connect(data) {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createServer(data);
    await server.connect(a);
    const c = new Client({name: 'test', version: '1'});
    await c.connect(b);
    return c;
}

const tool = async (name, args = {}, c = client) => {
    const r = await c.callTool({name, arguments: args});
    return {error: !!r.isError, text: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text)};
};

before(async () => {
    app = createApp();
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${app.server.address().port}`;
    const session = (await call('POST', '/api/auth/register', {body: {username: 'dj', password: 'password123'}})).token;
    await call('PUT', '/api/me/profile', {auth: session, body: {data: {ftp: FTP, weight: 70, wprime: 18000, hrThresholds: {cycling: 172, running: null}}}});

    // the ride: .fit and its summary, as the app saves them
    const view = vo2Ride();
    const fitB64 = Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64');
    const samples = readRide(view).samples;
    await call('POST', '/api/me/activities', {auth: session, body: {id: 'r-vo2', fit: fitB64, summary: {name: 'VO2 4×4', timestamp: T0 + samples.length * 1000, duration: samples.length}}});
    const training = rideSummary(samples, {id: 'r-vo2', start: T0, name: 'VO2 4×4', workoutId: VO2.id, ftp: FTP, weight: 70, distance: samples.length * 9});
    await call('PATCH', '/api/me/activities/r-vo2/summary', {auth: session, body: {training}});

    // an older ride the server has only as a .fit (no summary yet): read from its file
    const old = vo2Ride(T0 - 7 * 864e5, 190);     // ridden when the FTP was 190 W
    await call('POST', '/api/me/activities', {auth: session, body: {id: 'r-old', fit: Buffer.from(old.buffer).toString('base64'),
        summary: {name: 'Older', timestamp: T0 - 7 * 864e5, duration: 4200}}});

    // a Garmin run, without power
    const uid = app.db.prepare("SELECT id FROM users WHERE username = 'dj'").get().id;
    app.db.prepare('INSERT INTO external_rides (user_id, id, summary, day, updated_at) VALUES (?, ?, ?, ?, ?)').run(uid, 'garmin-1',
        JSON.stringify({id: 'garmin-1', source: 'garmin', sport: 'running', day: '2026-11-25', start: new Date('2026-11-25T07:00:00').getTime(), duration: 2400, avgHr: 150, name: 'Morning run'}),
        '2026-11-25', Date.now());
    // health data: two weeks, the last night's HRV low
    for(let i = 14; i >= 0; i--) {
        const day = addDays(TODAY, -i);
        app.db.prepare('INSERT INTO wellness (user_id, day, data, updated_at) VALUES (?, ?, ?, ?)').run(uid, day,
            JSON.stringify({day, hrv: i === 0 ? 40 : 60 + (i % 3), hrvBaseline: {low: 55, high: 70}, restingHr: 48, sleepSeconds: 7.5 * 3600, bodyBattery: 70}), Date.now());
    }
    // the plan: the ride's workout (done), and one ahead
    await call('PUT', '/api/me/plan/p-done', {auth: session, body: {data: {day: RIDE_DAY, workout: VO2, rideId: 'r-vo2', origin: 'auuki', name: 'VO2 4×4'}}});
    await call('PUT', '/api/me/plan/p-next', {auth: session, body: {data: {day: '2026-11-28', workout: VO2, rideId: null, origin: 'auuki', name: 'VO2 4×4'}}});
    // the rider's own workout
    await call('PUT', '/api/me/workouts/w-own', {auth: session, body: {data: {id: 'w-own', meta: {name: 'Sweet spot 3×12', category: 'Sweet spot'}, intervals: [{duration: 720, steps: [{duration: 720, power: 0.9}]}]}}});

    token = (await call('POST', '/api/me/tokens', {auth: session, body: {name: 'test', scope: 'plan'}})).token;
    readToken = (await call('POST', '/api/me/tokens', {auth: session, body: {name: 'read', scope: 'read'}})).token;
    client = await connect(createSoigneur({api: createApi({url: base, token: readToken}), today: () => TODAY}));
});

after(() => app.close());

test('the tools and prompts, all read-only, described with units', async () => {
    const {tools} = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(),
        ['apply_plan', 'get_athlete', 'get_form', 'get_health', 'get_plan', 'get_progress', 'get_ride_analysis', 'list_rides',
         'list_workouts', 'move_planned', 'plan_workout', 'propose_plan', 'remove_planned']);
    const writes = ['apply_plan', 'move_planned', 'plan_workout', 'remove_planned'];
    for(const t of tools) {
        assert.equal(t.annotations.readOnlyHint, !writes.includes(t.name), t.name);
        if(!['remove_planned', 'apply_plan'].includes(t.name)) assert.match(t.description, /_w watts/, t.name);
    }
    const {prompts} = await client.listPrompts();
    assert.deepEqual(prompts.map(p => p.name).sort(), ['ride_debrief', 'training_plan', 'weekly_review']);
    const p = await client.getPrompt({name: 'ride_debrief', arguments: {}});
    assert.match(p.messages[0].content.text, /latest/);
    assert.match(p.messages[0].content.text, /see a doctor/);
});

test('athlete: profile, thresholds, readiness from last night', async () => {
    const {json} = await tool('get_athlete');
    assert.equal(json.ftp_w, FTP);
    assert.equal(json.weight_kg, 70);
    assert.equal(json.threshold_hr_bpm.cycling, 172);
    assert.equal(json.today, TODAY);
    assert.notEqual(json.readiness_today.verdict, 'ready');                  // HRV under its range last night
    assert.ok(json.readiness_today.reasons.some(r => /HRV/.test(r)));
    assert.ok(json.rider_model.best_power_90_days_w['240'] >= 230);
});

test('rides: merged across sources, with load, the planned workout and units', async () => {
    const {json} = await tool('list_rides', {from: '2026-11-01', to: TODAY});
    assert.deepEqual(json.rides.map(r => r.id), ['r-old', 'r-vo2', 'garmin-1']);
    const vo2 = json.rides[1];
    assert.equal(vo2.planned_workout, 'VO2 4×4');
    assert.equal(vo2.load_from, 'power');
    assert.ok(vo2.tss > 55 && vo2.tss < 75, String(vo2.tss));        // 64 from the samples
    assert.equal(vo2.duration_s, 2880);
    const run = json.rides[2];
    assert.equal(run.sport, 'running');
    assert.equal(run.source, 'garmin');
    assert.ok(['hr', 'estimate'].includes(run.load_from));
    // the ride without a summary was read from its .fit, with the FTP it was ridden with (the .fit's), not today's
    assert.ok(json.rides[0].np_w > 100);
    assert.equal(json.rides[0].ftp_w, 190);
    assert.equal((await tool('list_rides', {from: '2026-11-01', to: TODAY, sport: 'running'})).json.count, 1);
});

test('ride analysis: the workout, reps planned against done, recovery, W′bal, zones', async () => {
    // latest: the last cycling ride (the run after it isn't one)
    const {json} = await tool('get_ride_analysis', {ride_id: 'latest'});
    assert.equal(json.ride.id, 'r-vo2');
    assert.equal(json.intervals_from, 'workout');
    assert.equal(json.planned_workout.name, 'VO2 4×4');
    assert.deepEqual(json.planned_workout.steps[1], {repeat: 4, steps: [{duration_s: 240, power_pct: 115, cadence_rpm: 95}, {duration_s: 180, power_pct: 50}]});
    assert.equal(json.planned_vs_done.length, 4);
    for(const r of json.planned_vs_done) {
        assert.equal(r.target_w, 230);
        assert.equal(r.done_w, 233);
        assert.equal(r.status, 'done');
    }
    assert.equal(json.efforts.length, 4);
    assert.ok(json.hr_recovery_60s.length >= 2);
    assert.ok(json.hr_recovery_60s.every(x => x.drop_bpm > 0));
    assert.ok(json.wbal.lowest_j < json.wbal.wprime_j);
    assert.equal(json.power_zones_s.length, 7);
    assert.equal(json.hr_zones_s.length, 5);
    assert.ok(json.ride_vs_last_90_days.find(x => x.seconds === 240).pct_of_best > 0);
    // no per-second data
    assert.ok(JSON.stringify(json).length < 20000);
});

test('an unknown ride says where ids come from', async () => {
    const r = await tool('get_ride_analysis', {ride_id: 'nope'});
    assert.equal(r.error, true);
    assert.match(r.text, /list_rides/);
});

test('form: days and a forecast from the plan', async () => {
    const {json} = await tool('get_form', {from: '2026-11-20', to: TODAY, forecast_days: 5});
    assert.equal(json.days.at(-1).day, TODAY);
    assert.equal(json.days.find(d => d.day === RIDE_DAY).tss, 64);
    assert.equal(json.forecast.length, 5);
    assert.equal(json.forecast.find(d => d.day === '2026-11-28').tss, 49);   // the workout's planned TSS
    assert.equal(json.forecast.find(d => d.day === '2026-11-27').tss, 0);
});

test('health, plan, progress and the library', async () => {
    const health = (await tool('get_health')).json;
    const last = health.days.at(-1);
    assert.equal(last.day, TODAY);
    assert.equal(last.hrv_vs_range, 'below');
    assert.deepEqual(last.hrv_normal_range_ms, {low: 55, high: 70, from: 'garmin'});
    assert.equal(last.sleep_h, 7.5);

    const plan = (await tool('get_plan')).json;
    assert.deepEqual(plan.entries.map(e => [e.id, e.status, e.from]), [['p-done', 'done', 'Soigneur'], ['p-next', 'planned', 'Soigneur']]);
    assert.equal(plan.entries[1].planned_tss, 49);

    const progress = (await tool('get_progress', {weeks: 4})).json;
    assert.equal(progress.weekly_volume.length, 4);
    assert.ok(progress.power_curve_w.find(x => x.seconds === 240).all_time >= 230);

    const lib = (await tool('list_workouts', {query: 'test'})).json.workouts;
    assert.ok(lib.some(w => w.from === 'test'));
    const own = (await tool('list_workouts', {query: 'sweet'})).json.workouts;
    assert.deepEqual(own.filter(w => w.from === 'own').map(w => [w.id, w.planned_tss]), [['w-own', 16]]);
    assert.ok(own.some(w => w.from === 'built-in'));                       // the built-in sweet-spot workouts too
});

test('repeated blocks are folded, the longest run first', async () => {
    const {foldRepeats} = await import('./soigneur.js');
    const a = {d: 40}, b = {d: 20}, w = {d: 600};
    assert.deepEqual(foldRepeats([w, a, b, a, b, a, b, w]), [w, {repeat: 3, steps: [a, b]}, w]);
    assert.deepEqual(foldRepeats([a, a, a, b]), [{repeat: 3, steps: [a]}, b]);
    assert.deepEqual(foldRepeats([a, b, w]), [a, b, w]);
});

test('a wrong range or key comes back as a message, not a crash', async () => {
    const r = await tool('list_rides', {from: '2026-11-26', to: '2026-11-01'});
    assert.equal(r.error, true);
    assert.match(r.text, /after/);
    const bad = await connect(createSoigneur({api: createApi({url: base, token: 'sst_' + 'x'.repeat(43)}), today: () => TODAY}));
    const r2 = await tool('get_athlete', {}, bad);
    assert.equal(r2.error, true);
    assert.match(r2.text, /AI access/);
});

test('over stdio, as an AI app starts it: only the protocol on stdout', async () => {
    const transport = new StdioClientTransport({
        command: process.execPath, args: [new URL('./index.mjs', import.meta.url).pathname],
        env: {...process.env, SOIGNEUR_URL: base, SOIGNEUR_TOKEN: readToken}, stderr: 'pipe',
    });
    const c = new Client({name: 'stdio-test', version: '1'});
    await c.connect(transport);
    const {tools} = await c.listTools();
    assert.equal(tools.length, 13);
    const r = await tool('get_athlete', {}, c);
    assert.equal(r.json.ftp_w, FTP);
    await c.close();
});

// --- planning (after the read tests: these change the plan) ---

const easy = (name, hours, pct = 65) => ({name, steps: [{duration_s: Math.round(hours * 3600), power_pct: pct}]});
const rules = r => r.json.findings.map(f => f.rule);

test('a read-only key can\'t plan; the server says why', async () => {
    const r = await tool('plan_workout', {day: '2026-11-30', workout_id: 'w-own'});
    assert.equal(r.error, true);
    assert.match(r.text, /can only read/);
});

test('plan_workout: checked, then stored for the app and intervals.icu', async () => {
    const writer = await connect(createSoigneur({api: createApi({url: base, token}), today: () => TODAY}));

    // a step far above FTP, a past day, a day that has a workout, a hard workout today on a take-care morning
    const tooHard = await tool('plan_workout', {day: '2026-12-01', workout: {name: 'Silly', steps: [{duration_s: 60, power_pct: 250}]}}, writer);
    assert.deepEqual(rules(tooHard), ['workout']);
    assert.match(tooHard.json.findings[0].message, /over 200 % FTP/);
    assert.deepEqual(rules(await tool('plan_workout', {day: '2026-11-20', workout_id: 'w-own'}, writer)), ['day']);
    const taken = await tool('plan_workout', {day: '2026-11-28', workout_id: 'w-own'}, writer);
    assert.deepEqual(rules(taken), ['day']);
    assert.match(taken.json.findings[0].message, /p-next/);
    const today = await tool('plan_workout', {day: TODAY, workout: {name: 'VO2', steps: [{repeat: 5, steps: [{duration_s: 180, power_pct: 115}, {duration_s: 180, power_pct: 50}]}]}}, writer);
    assert.deepEqual(rules(today), ['readiness']);
    assert.equal(today.json.planned, false);

    // a good one
    const ok = await tool('plan_workout', {day: '2026-12-01', workout: {name: 'Tempo 2×15', description: 'Tempo', steps: [
        {duration_s: 600, power_pct_from: 50, power_pct_to: 70},
        {repeat: 2, steps: [{duration_s: 900, power_pct: 82}, {duration_s: 300, power_pct: 55}]},
        {duration_s: 300, power_pct: 50}]}}, writer);
    assert.equal(ok.json.planned, true, JSON.stringify(ok.json));
    const row = app.db.prepare('SELECT data FROM plan WHERE id = ?').get(ok.json.entry_id);
    const data = JSON.parse(row.data);
    assert.equal(data.origin, 'ai');
    assert.equal(data.day, '2026-12-01');
    assert.match(data.zwo, /<SteadyState Duration="900" Power="0.82"\/>/);
    const plan = (await tool('get_plan', {}, writer)).json.entries;
    const mine = plan.find(e => e.id === ok.json.entry_id);
    assert.equal(mine.from, 'AI');
    assert.deepEqual(mine.steps[1], {repeat: 2, steps: [{duration_s: 900, power_pct: 82}, {duration_s: 300, power_pct: 55}]});

    // move and remove; a done workout can't change
    const moved = await tool('move_planned', {entry_id: ok.json.entry_id, day: '2026-12-02'}, writer);
    assert.equal(moved.json.moved, true);
    assert.equal(JSON.parse(app.db.prepare('SELECT data FROM plan WHERE id = ?').get(ok.json.entry_id).data).day, '2026-12-02');
    const done = await tool('remove_planned', {entry_id: 'p-done'}, writer);
    assert.equal(done.error, true);
    assert.match(done.text, /done/);
    assert.equal((await tool('remove_planned', {entry_id: ok.json.entry_id}, writer)).json.removed, true);
    assert.equal(app.db.prepare('SELECT deleted FROM plan WHERE id = ?').get(ok.json.entry_id).deleted, 1);
});

test('propose_plan finds what is wrong with a block; a good block is applied only by its id', async () => {
    const writer = await connect(createSoigneur({api: createApi({url: base, token}), today: () => TODAY}));
    const weeks = ['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21'];

    // too much too soon: 3 h a day, every day
    const heavy = await tool('propose_plan', {goal: 'too much', weeks: weeks.map(w => ({week_of: w, focus: 'build',
        days: [0, 1, 2, 3, 4, 5, 6].map(i => ({day: addDays(w, i), workout: easy('Long', 3, 70)}))}))}, writer);
    assert.equal(heavy.json.passed, false);
    for(const rule of ['ramp', 'rest', 'hard-days', 'recovery']) assert.ok(rules(heavy).includes(rule), rule);
    assert.match(heavy.json.findings.find(f => f.rule === 'ramp').message, /lower that week's TSS by about \d+/);

    // a base week with intervals is not a base week
    const baseWeek = await tool('propose_plan', {goal: 'base', weeks: [{week_of: weeks[0], focus: 'base', days: [
        {day: '2026-12-01', workout_id: 'w-own'}, {day: '2026-12-03', workout: VO2_DESCRIBED}]}]}, writer);
    assert.deepEqual(rules(baseWeek), ['base']);

    // a reasonable block: three rides a week, the fourth week easier
    const good = {goal: 'consistency', weeks: weeks.map((w, k) => ({week_of: w, focus: k === 3 ? 'recovery' : 'build',
        days: (k === 3 ? [1] : [1, 3, 5]).map(i => ({day: addDays(w, i), workout: easy(`Endurance ${k + 1}.${i}`, 1.5)}))}))};
    const ok = await tool('propose_plan', good, writer);
    assert.equal(ok.json.passed, true, JSON.stringify(ok.json.findings));
    assert.equal(ok.json.days.length, 10);
    assert.ok(ok.json.weeks.every(w => w.fitness_change <= 8));
    assert.match(ok.json.next, /only when they agree/i);
    // nothing stored yet
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM plan WHERE json_extract(data, '$.origin') = 'ai' AND deleted = 0").get().n, 0);

    const applied = await tool('apply_plan', {proposal_id: ok.json.proposal_id}, writer);
    assert.equal(applied.json.applied, true);
    assert.equal(applied.json.planned.length, 10);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM plan WHERE json_extract(data, '$.origin') = 'ai' AND deleted = 0").get().n, 10);
    const again = await tool('apply_plan', {proposal_id: ok.json.proposal_id}, writer);
    assert.equal(again.error, true);
    assert.match(again.text, /propose it again/);

    // the same block again collides with itself, unless it replaces what is planned
    assert.ok(rules(await tool('propose_plan', good, writer)).every(r => r === 'day'));
    const replace = await tool('propose_plan', {...good, replace_planned: true}, writer);
    assert.equal(replace.json.passed, true, JSON.stringify(replace.json.findings));
    assert.equal(replace.json.replaces.length, 10);
});

test('the training-plan prompt asks for a check and the rider\'s yes', async () => {
    const p = await client.getPrompt({name: 'training_plan', arguments: {goal: 'gran fondo', date: '2027-03-15'}});
    const text = p.messages[0].content.text;
    assert.match(text, /propose_plan/);
    assert.match(text, /Only when I say yes: apply_plan/);
    assert.match(text, /2027-03-15/);
});
