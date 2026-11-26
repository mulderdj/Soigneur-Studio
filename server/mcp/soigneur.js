//
// The rider's training as the app sees it, for the MCP server: fetched from
// the account server with an access token (AI access) and worked out with the
// app's own modules (src/), so the numbers match the Training and ride pages.
//
// Everything here returns plain, compact objects with units in the key names
// (_s seconds, _w watts, _bpm, _j joules, _pct percent); no per-second data.
//

import { fitToSamples, readRide } from '../../src/training/fit-records.js';
import { rideSummary, SUMMARY_VERSION } from '../../src/training/summary.js';
import { mergeRides, countable, isCycling } from '../../src/training/merge.js';
import { effectiveLoad, restingHrOn, mergeThresholds } from '../../src/training/load-sources.js';
import { dailyTss, pmc, forecast, formLabel } from '../../src/training/load.js';
import { plannedTss, planStatus } from '../../src/training/plan.js';
import { weeklyVolume, weekCompare, powerCurve, ftpEstimates } from '../../src/training/progress.js';
import { readiness } from '../../src/training/readiness.js';
import { currentModel, powerProfile, meanMaximal } from '../../src/training/rider-model.js';
import { hrvRangeOn, hrvState, restingTrend, sortedDays } from '../../src/training/wellness.js';
import { localDay, today as localToday, addDays, daysBetween } from '../../src/training/dates.js';
import { analyseRide } from '../../src/analysis/ride.js';
import { reps, hrRecovery, rideCurve, efficiency, polarised } from '../../src/analysis/insights.js';
import { workouts as builtinZwo } from '../../src/workouts/workouts.js';
import { protocols } from '../../src/tests/protocols.js';
import { readWorkout } from './zwo.js';

const CACHE_MS = 60 * 1000;
const MAX_RANGE_DAYS = 400;
const MAX_RIDES = 200;
// the rider model's settings live on the rider's device; the MCP server uses the defaults
const MODEL_SETTINGS = {mode: 'ask', use: null, table: 'men'};

class SoigneurError extends Error {
    constructor(message, status = 0) {
        super(message);
        this.status = status;
    }
}

const num = x => Number.isFinite(x);
const r0 = x => (num(x) ? Math.round(x) : null);
const r1 = x => (num(x) ? Math.round(x * 10) / 10 : null);
const r2 = x => (num(x) ? Math.round(x * 100) / 100 : null);
const pct = x => (num(x) ? Math.round(x * 1000) / 10 : null);

// --- the account server -------------------------------------------------------

function createApi({url, token, fetch = globalThis.fetch}) {
    const base = String(url ?? '').replace(/\/+$/, '');
    async function request(method, path, {body, raw = false} = {}) {
        let res;
        try {
            res = await fetch(`${base}/api${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`, Accept: 'application/json',
                    ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        } catch(e) {
            throw new SoigneurError(`Soigneur can't be reached at ${base} (${e.cause?.code ?? e.message}).`);
        }
        if(!res.ok) {
            let message = null;
            try { message = (await res.json())?.error ?? null; } catch(e) { /* not JSON */ }
            if(res.status === 401) message = 'Soigneur refused the access key: it was removed, or is wrong. Create a new one under Account, AI access.';
            throw new SoigneurError(message ?? `Soigneur answered ${res.status}.`, res.status);
        }
        if(raw) return new DataView(await res.arrayBuffer());
        return res.json();
    }
    return {
        get: (path, opts) => request('GET', path, opts),
        put: (path, body) => request('PUT', path, {body}),
        delete: path => request('DELETE', path),
    };
}

// --- shaping ------------------------------------------------------------------

const sourceOf = s => s.source ?? 'soigneur';
const clock = ms => (num(ms) ? new Date(ms).toTimeString().slice(0, 5) : null);

function rideRow(s, plannedName = null) {
    return {
        id: s.id, day: s.day, start: clock(s.start), name: s.name ?? null,
        sport: s.sport ?? 'cycling', source: sourceOf(s),
        duration_s: r0(s.duration), distance_km: num(s.distance) && s.distance > 0 ? r1(s.distance / 1000) : null,
        tss: r0(s.tss), load_from: s.loadSource ?? null,
        if: r2(s.if), np_w: r0(s.np), avg_power_w: r0(s.avgPower), kj: r0(s.kj),
        avg_hr_bpm: r0(s.avgHr), max_hr_bpm: r0(s.maxHr),
        rpe: s.rating ?? null, ftp_w: s.ftp > 0 ? r0(s.ftp) : null,
        ...(plannedName ? {planned_workout: plannedName} : {}),
        ...(s.hidden ? {hidden: true} : {}),
        ...(s.unreadable ? {unreadable: true} : {}),
    };
}

// a workout's steps, compact: one line per interval, power as % FTP
function stepsOf(workout) {
    return foldRepeats((workout?.intervals ?? []).map(iv => {
        const steps = iv.steps?.length ? iv.steps : [{duration: iv.duration, power: iv.power}];
        const first = steps[0], last = steps[steps.length - 1];
        const out = {duration_s: r0(iv.duration ?? steps.reduce((a, s) => a + (s.duration ?? 0), 0))};
        if(num(first.slope) && !(first.power > 0)) {
            if(first.slope === 0) out.free_ride = true;
            else out.slope_pct = first.slope;
        } else if(steps.length > 1 && first.power !== last.power) {
            out.power_pct_from = pct(first.power);
            out.power_pct_to = pct(last.power);
        } else {
            out.power_pct = first.power >= 10 ? null : pct(first.power ?? 0);
            if(first.power >= 10) out.power_w = r0(first.power);
        }
        if(num(first.cadence)) out.cadence_rpm = first.cadence;
        if(first.effort) out.all_out = true;
        return out;
    }));
}

// repeated blocks folded: [a, b, a, b, a, b] → [{repeat: 3, steps: [a, b]}]
function foldRepeats(list, maxPeriod = 8) {
    const key = list.map(x => JSON.stringify(x));
    const out = [];
    let i = 0;
    while(i < list.length) {
        let best = null;
        for(let p = 1; p <= maxPeriod && i + 2 * p <= list.length; p++) {
            let k = 1;
            while(i + (k + 1) * p <= list.length && key.slice(i + k * p, i + (k + 1) * p).every((x, j) => x === key[i + j])) k++;
            if(k >= 2 && (!best || p * k > best.p * best.k)) best = {p, k};
        }
        if(best) {
            out.push({repeat: best.k, steps: list.slice(i, i + best.p)});
            i += best.p * best.k;
        } else {
            out.push(list[i]);
            i++;
        }
    }
    return out;
}

function workoutDuration(workout) {
    return r0((workout?.intervals ?? []).reduce((a, iv) => a + (iv.duration ?? 0), 0));
}

// --- the data -------------------------------------------------------------------

function createSoigneur({api, today = localToday, cacheMs = CACHE_MS, now = () => Date.now()}) {
    const cache = new Map();
    const fitSummaries = new Map();      // own rides without a current summary, read from their .fit once

    function cached(key, fn) {
        const hit = cache.get(key);
        if(hit && now() - hit.at < cacheMs) return hit.value;
        const value = fn();
        cache.set(key, {at: now(), value});
        value.catch(() => cache.delete(key));
        return value;
    }
    const forget = () => cache.clear();

    const profile = () => cached('profile', async () => (await api.get('/me/profile'))?.data ?? {});
    const ftpNow = async () => ((await profile()).ftp > 0 ? (await profile()).ftp : 250);

    const thresholds = () => cached('thresholds', async () => {
        const own = (await profile()).hrThresholds ?? null;
        let garmin = null;
        try { garmin = (await api.get('/me/thresholds'))?.garmin ?? null; } catch(e) { garmin = null; }
        return mergeThresholds(own, garmin);
    });

    const wellness = () => cached('wellness', async () =>
        sortedDays(((await api.get('/me/wellness?since=0'))?.days ?? []).filter(d => typeof d?.day === 'string')));

    async function summaryFromFit(r, p) {
        // the FTP the ride was ridden with (as the app: its .fit's, else its saved stats), never today's
        const pos = x => (Number.isFinite(x) && x > 0 ? x : null);
        const meta = {id: r.id, name: r.name ?? 'Ride', workoutId: r.workoutId ?? null, ftp: pos(r.stats?.ftp) ?? p.ftp, weight: p.weight};
        try {
            const read = fitToSamples(await api.get(`/me/activities/${encodeURIComponent(r.id)}/fit`, {raw: true}));
            if(pos(read.ftp)) meta.ftp = read.ftp;
            if(read.samples.length) {
                const start = read.start ?? ((r.timestamp ?? now()) - read.samples.length * 1000);
                return rideSummary(read.samples, {...meta, start, distance: read.distance});
            }
        } catch(e) { /* below: what the ride's record knows */ }
        const duration = num(r.duration) ? r.duration : 0;
        const start = (r.timestamp ?? now()) - duration * 1000;
        return {...rideSummary(new Array(duration).fill({power: 0}), {...meta, start, distance: null}), unreadable: true};
    }

    const ownSummaries = () => cached('own', async () => {
        const [{activities = []}, p] = await Promise.all([api.get('/me/activities'), profile()]);
        const out = [];
        for(const r of activities) {
            if(r.training?.version === SUMMARY_VERSION) { out.push(r.training); continue; }
            if(!fitSummaries.has(r.id)) fitSummaries.set(r.id, await summaryFromFit(r, p));
            out.push(fitSummaries.get(r.id));
        }
        return out;
    });

    // every workout, each counted once, with its effective load; as history.summaries()
    const summaries = () => cached('summaries', async () => {
        const [own, external, ratings, hidden, days, th] = await Promise.all([
            ownSummaries(),
            api.get('/me/external-rides?since=0').then(r => r?.rides ?? []),
            api.get('/me/ride-ratings').then(r => r?.ratings ?? {}).catch(() => ({})),
            api.get('/me/hidden-rides').then(r => new Set(r?.ids ?? [])).catch(() => new Set()),
            wellness().then(list => new Map(list.map(d => [d.day, d]))),
            thresholds(),
        ]);
        return mergeRides(own, external).map(s => {
            const rating = Number.isInteger(ratings[s.id]) ? ratings[s.id] : null;
            const load = effectiveLoad(s, {rating, thresholds: th, restingHr: restingHrOn(s.day, days)});
            const out = {...s, rawTss: num(s.tss) ? s.tss : null, ...load, rating};
            if(hidden.has(s.id)) out.hidden = true;
            return out;
        });
    });

    // plan entries; intervals.icu's are read from their .zwo, as the app does
    const planEntries = () => cached('plan', async () => {
        const {entries = []} = await api.get('/me/plan?since=0');
        return entries.filter(e => !e.deleted && e.data).map(e => {
            const entry = {...e.data, id: e.id, updatedAt: e.updatedAt};
            if(entry.origin === 'intervals' && entry.zwo && !(entry.workout?.intervals?.length > 0)) {
                const name = entry.workout?.meta?.name ?? entry.name ?? 'Workout';
                const w = readWorkout(entry.zwo);
                entry.workout = w.intervals.length ? {...w, id: entry.workout?.id ?? `icu-${entry.id}`, meta: {...w.meta, name}} : null;
                entry.name = name;
            }
            return entry;
        }).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.updatedAt ?? 0) - (b.updatedAt ?? 0)));
    });

    // the workout library: built-in, the tests, and the rider's own
    const library = () => cached('library', async () => {
        const own = ((await api.get('/me/workouts?since=0'))?.workouts ?? [])
            .filter(w => !w.deleted && w.data?.intervals).map(w => ({...w.data, id: w.data.id ?? w.id, source: 'own'}));
        const builtin = builtinZwo.map(xml => {
            const w = readWorkout(xml);
            return {...w, id: `builtin-${w.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, source: 'built-in'};
        });
        const tests = protocols().map(w => ({...w, source: 'test'}));
        return [...builtin, ...tests, ...own];
    });

    // --- answers ---

    async function athlete() {
        const [p, th, all, days] = await Promise.all([profile(), thresholds(), summaries(), wellness()]);
        const t = today();
        const ftp = p.ftp > 0 ? p.ftp : null;
        const list = countable(all);
        const model = currentModel({summaries: list, today: t, ftp: ftp ?? 250, typedWprime: p.wprime > 0 ? p.wprime : null, settings: MODEL_SETTINGS});
        const prof = powerProfile({meanMax: model.meanMax, ftp, weight: p.weight, table: MODEL_SETTINGS.table});
        const verdict = readiness({today: t, days, summaries: list, ftp: ftp ?? 250});
        const best = Object.fromEntries(Object.entries(model.meanMax ?? {})
            .map(([d, v]) => [d, r0(num(v?.watts) ? v.watts : v)]).filter(([, w]) => num(w)));
        return {
            today: t,
            ftp_w: ftp, weight_kg: p.weight > 0 ? p.weight : null, wprime_typed_j: p.wprime > 0 ? p.wprime : null,
            threshold_hr_bpm: th,
            rider_model: {
                fit: model.fit.ok ? {cp_w: model.fit.cp, wprime_j: model.fit.wprime, r2: model.fit.r2} : {missing: model.fit.missing},
                in_use: {cp_w: r0(model.effective.cp), wprime_j: r0(model.effective.wprime), source: model.effective.source},
                best_power_90_days_w: best,
            },
            power_profile: prof.needsWeight ? {missing: 'Set your weight in Soigneur for W/kg.'} :
                {rows: prof.rows.map(r => ({duration: r.label, watts: r.watts, w_per_kg: r.wkg, category: r.category})), summary: prof.sentence ?? null, table: prof.table},
            readiness_today: {verdict: verdict.state, reasons: verdict.reasons, form: verdict.signals?.form ?? null,
                              yesterday_tss: verdict.signals?.yesterdayTss ?? null, based_on: verdict.basis ?? null},
        };
    }

    async function listRides({from, to, sport} = {}) {
        const t = today();
        to ??= t;
        from ??= addDays(to, -27);
        checkRange(from, to);
        const [all, plan] = await Promise.all([summaries(), planEntries()]);
        const plannedName = new Map(plan.filter(e => e.rideId).map(e => [e.rideId, e.workout?.meta?.name ?? e.name ?? null]));
        let list = all.filter(s => s.day >= from && s.day <= to);
        if(sport) list = list.filter(s => (s.sport ?? 'cycling') === sport);
        const rows = list.map(s => rideRow(s, plannedName.get(s.id)));
        return {
            from, to, count: rows.length,
            rides: rows.slice(-MAX_RIDES),
            ...(rows.length > MAX_RIDES ? {note: `Only the last ${MAX_RIDES} rides; ask for a shorter range.`} : {}),
        };
    }

    // the last cycling ride
    async function latestRideId() {
        const all = countable(await summaries()).filter(isCycling);
        return all.at(-1)?.id ?? null;
    }

    async function rideAnalysis(id) {
        if(id === 'latest') id = await latestRideId();
        const all = await summaries();
        const summary = all.find(s => s.id === id);
        if(!summary) throw new SoigneurError(`No ride with id ${id}. list_rides gives the ids.`);
        const [p, th, plan, lib] = await Promise.all([profile(), thresholds(), planEntries(), library()]);
        let view;
        try {
            view = await api.get(`/me/rides/${encodeURIComponent(id)}/file`, {raw: true});
        } catch(e) {
            return {ride: rideRow(summary), problem: `The ride's file can't be read: ${e.message} The summary above is all there is.`};
        }
        const ride = readRide(view);
        if(!ride.samples.length) return {ride: rideRow(summary), problem: 'The ride\'s file holds no samples.'};

        // as the ride page: the plan entry the ride is linked to, else the workout by id or name
        const entry = plan.find(e => e.rideId === id) ??
                      plan.find(e => summary.workoutId && e.day === summary.day && e.workout?.id === summary.workoutId);
        const workout = entry?.workout ?? lib.find(w => summary.workoutId && w.id === summary.workoutId) ??
                        (summary.workoutId ? lib.find(w => w.meta?.name === summary.name) : null) ?? null;
        const ftp = summary.ftp > 0 ? summary.ftp : (p.ftp > 0 ? p.ftp : 250);
        const model = currentModel({summaries: countable(all), today: today(), ftp: p.ftp > 0 ? p.ftp : 250,
                                    typedWprime: p.wprime > 0 ? p.wprime : null, settings: MODEL_SETTINGS});
        const eff = model.effective;
        const lthr = (/run/.test(summary.sport ?? '') ? th.running : th.cycling) ?? null;
        const a = analyseRide({
            samples: ride.samples, pauses: ride.pauses ?? [], laps: ride.laps ?? [], workout,
            ftp, weight: p.weight > 0 ? p.weight : 75, wprime: eff.wprime, cp: eff.source === 'model' ? eff.cp : null, lthr,
            summaries: all, day: summary.day, id,
        });

        // this ride's best power against the 90 days before it (other rides)
        const mine = rideCurve(ride.samples);
        const before = meanMaximal(all.filter(s => s.id !== id), summary.day);
        const vs90 = Object.entries(mine).filter(([, w]) => num(w)).map(([d, w]) => {
            const b = before?.[d];
            const best = num(b?.watts) ? b.watts : (num(b) ? b : null);
            return {seconds: Number(d), ride_w: w, best_90_days_w: r0(best), pct_of_best: best > 0 ? r1(w / best * 100) : null};
        });

        const pausedS = (ride.pauses ?? []).reduce((acc, x) => acc + (x.end - x.start), 0);
        return {
            ride: rideRow(summary, entry?.workout?.meta?.name ?? entry?.name ?? null),
            ftp_used_w: r0(ftp), threshold_hr_used_bpm: lthr,
            planned_workout: workout ? {name: workout.meta?.name ?? null, duration_s: workoutDuration(workout), steps: stepsOf(workout)} : null,
            moving_s: a.activeSeconds, paused_s: pausedS, laps: (ride.laps ?? []).length,
            np_w: a.np, avg_hr_bpm: a.avgHr,
            intervals_from: a.intervalSource,
            intervals: a.intervals.filter(iv => iv.stats).map(iv => ({
                kind: iv.kind, ...(iv.rep ? {rep: iv.rep} : {}), ...(iv.lap ? {lap: iv.lap} : {}),
                start_s: iv.start, duration_s: iv.stats.duration, target_w: r0(iv.target ?? iv.stats.avgTarget),
                avg_power_w: iv.stats.avgPower, np_w: iv.stats.np, pct_ftp: iv.stats.pctFtp,
                avg_hr_bpm: iv.stats.avgHr, max_hr_bpm: iv.stats.maxHr, avg_cadence_rpm: iv.stats.avgCadence,
                on_target_pct: pct(iv.stats.onTarget), fade_pct: pct(iv.stats.fade), hr_drift_bpm: iv.stats.hrDrift,
            })),
            planned_vs_done: a.reps.map(x => ({rep: x.rep, target_w: x.target, done_w: x.done, diff_pct: x.diffPct, planned_s: x.planned, ridden_s: x.duration, status: x.status})),
            efforts: reps(a, ftp).map(x => ({n: x.n, start_s: x.start, duration_s: x.end - x.start, avg_power_w: x.power, target_w: x.target, avg_hr_bpm: x.hr, max_hr_bpm: x.maxHr})),
            hr_recovery_60s: hrRecovery(ride.samples, a, ftp, ride.pauses ?? []).map(x => ({effort: x.n, hr_at_end_bpm: x.hrEnd, hr_60s_later_bpm: x.hr60, drop_bpm: x.drop})),
            wbal: a.wbal ? {lowest_j: a.wbal.min, wprime_j: a.wbal.wprime, cp_w: a.wbal.cp, from: eff.source === 'model' ? 'rider model' : 'FTP and typed W′',
                            matches_burnt: a.wbal.matches.map(m => ({start_s: m.start, duration_s: m.end - m.start, cost_j: m.cost}))} : null,
            power_zones_s: a.powerZones?.map(z => ({zone: z.short, name: z.name, seconds: z.seconds})) ?? null,
            hr_zones_s: a.hrZones?.map(z => ({zone: z.short, name: z.name, seconds: z.seconds})) ?? null,
            best_efforts: a.bests.map(b => ({seconds: b.seconds, watts: b.watts, record: b.record === 'all' ? 'all-time best' : b.record === 'recent' ? 'best in 42 days' : null})),
            ride_vs_last_90_days: vs90,
            decoupling_pct: a.decoupling,
            efficiency_factor: a.ef,
            durability: a.durability.map(d => ({after_kj: d.kj, best_5min_w_after: d.best5, best_20min_w_after: d.best20, best_5min_w_before: d.fresh5, best_20min_w_before: d.fresh20})),
        };
    }

    async function formRows({from, to, forecastDays = 14} = {}) {
        const t = today();
        to ??= t;
        from ??= addDays(t, -41);
        checkRange(from, to);
        const [all, plan, p] = await Promise.all([summaries(), planEntries(), profile()]);
        const list = countable(all);
        const byDay = dailyTss(list);
        const first = list.reduce((a, s) => (s.day && s.day < a ? s.day : a), from < t ? from : t);
        const rows = pmc(byDay, first, t);
        const row = r => ({day: r.day, tss: r0(r.tss), fitness: r1(r.ctl), fatigue: r1(r.atl), form: r1(r.tsb), label: formLabel(r.tsb)});
        const planned = new Map();
        for(const e of plan) {
            if(e.day > t && planStatus(e, t) === 'planned' && e.workout) planned.set(e.day, (planned.get(e.day) ?? 0) + plannedTss(e.workout, p.ftp > 0 ? p.ftp : 250));
        }
        const last = rows.at(-1) ?? {ctl: 0, atl: 0};
        const days = Math.max(0, Math.min(90, forecastDays));
        return {
            today: t,
            explain: 'fitness = CTL (42-day load), fatigue = ATL (7-day load), form = TSB (yesterday\'s fitness − fatigue). Forecast: from the planned workouts.',
            days: rows.filter(r => r.day >= from && r.day <= to).map(row),
            forecast: days ? forecast(last, planned, t, days).map(row) : [],
        };
    }

    async function progress({weeks = 12} = {}) {
        weeks = Math.max(1, Math.min(52, Math.round(weeks)));
        const t = today();
        const list = countable(await summaries());
        const curve = powerCurve(list, t);
        const eff = efficiency(list);
        const since = addDays(t, -7 * weeks);
        const effRecent = eff.map((x, i) => ({...x, rolling: eff.rolling[i]})).filter(x => x.day >= since);
        const cmp = weekCompare(list, t);
        const vol = v => ({rides: v.rides, hours: r1(v.hours), tss: r0(v.tss), kj: r0(v.kj)});
        return {
            today: t,
            weekly_volume: weeklyVolume(list, t, weeks).map(w => ({week_of: w.week, ...vol(w)})),
            this_week_vs_last: {this_week_so_far: vol(cmp.current), last_week_same_days: vol(cmp.previous)},
            intensity_3_zones: polarised(list, t, weeks).map(w => ({week_of: w.week, riding_s: w.seconds, easy_pct: pct(w.easy), middle_pct: pct(w.middle), hard_pct: pct(w.hard)})),
            power_curve_w: curve.windows.map((d, i) => ({seconds: d, last_42_days: r0(curve.recent.watts[i]), all_time: r0(curve.allTime.watts[i]), all_time_day: curve.allTime.from[i]?.day ?? null})),
            ftp_estimate_w: ftpEstimates(list, t, weeks).map(w => ({week_of: w.week, ftp_w: r0(w.ftp), from: w.from ? `${w.from.seconds / 60} min at ${r0(w.from.watts)} W on ${w.from.day}` : null})),
            aerobic_efficiency: {
                explain: 'NP ÷ average heart rate of steady rides (cycling, ≥ 30 min, IF ≤ 0.85); rising = more power for the same heart rate.',
                rides: effRecent.map(x => ({day: x.day, ef: x.ef, rolling_28_days: x.rolling, name: x.name})),
            },
            zones: 'easy = Z1–Z2, middle = Z3–Z5, hard = Z6–Z7 (power zones from FTP).',
        };
    }

    async function health({from, to} = {}) {
        const t = today();
        to ??= t;
        from ??= addDays(t, -13);
        checkRange(from, to);
        const days = await wellness();
        const rest = restingTrend(days);
        return {
            days: days.filter(d => d.day >= from && d.day <= to).map(d => {
                const range = num(d.hrv) ? hrvRangeOn(d.day, days) : null;
                return {
                    day: d.day,
                    hrv_ms: d.hrv ?? null, hrv_normal_range_ms: range ? {low: range.low, high: range.high, from: range.source} : null,
                    hrv_vs_range: hrvState(d.hrv, range), garmin_hrv_status: d.hrvStatus ?? null,
                    resting_hr_bpm: d.restingHr ?? null,
                    sleep_h: num(d.sleepSeconds) ? r1(d.sleepSeconds / 3600) : null,
                    body_battery: d.bodyBattery ?? null,
                };
            }),
            resting_hr_trend: rest ? {last_bpm: rest.value, avg_30_days_bpm: rest.average, day: rest.day} : null,
            note: 'Nights are filed under the morning\'s date (Garmin).',
        };
    }

    async function plan({from, to} = {}) {
        const t = today();
        from ??= addDays(t, -7);
        to ??= addDays(t, 21);
        checkRange(from, to);
        const [entries, p] = await Promise.all([planEntries(), profile()]);
        const ftp = p.ftp > 0 ? p.ftp : 250;
        return {
            today: t,
            entries: entries.filter(e => e.day >= from && e.day <= to).map(e => ({
                id: e.id, day: e.day, name: e.workout?.meta?.name ?? e.name ?? null,
                status: planStatus(e, t), ride_id: e.rideId ?? null,
                from: e.origin === 'intervals' ? 'intervals.icu' : e.origin === 'ai' ? 'AI' : 'Soigneur',
                planned_tss: e.workout ? r0(plannedTss(e.workout, ftp)) : null,
                duration_s: e.workout ? workoutDuration(e.workout) : null,
                steps: e.workout ? stepsOf(e.workout) : null,
                ...(e.original ? {replaced_by_readiness: true} : {}),
            })),
        };
    }

    async function workouts({query} = {}) {
        const [lib, p] = await Promise.all([library(), profile()]);
        const ftp = p.ftp > 0 ? p.ftp : 250;
        const q = String(query ?? '').trim().toLowerCase();
        const match = w => !q || [w.meta?.name, w.meta?.category, w.meta?.subcategory, w.meta?.description]
            .some(x => String(x ?? '').toLowerCase().includes(q));
        return {
            workouts: lib.filter(match).map(w => ({
                id: w.id, name: w.meta?.name ?? null, from: w.source, category: w.meta?.category ?? null,
                duration_s: workoutDuration(w), planned_tss: r0(plannedTss(w, ftp)),
                description: w.meta?.description ? String(w.meta.description).slice(0, 240) : null,
            })),
        };
    }

    return {athlete, listRides, rideAnalysis, latestRideId, formRows, progress, health, plan, workouts, forget,
            // for the write tools
            summaries, planEntries, library, profile};
}

function checkRange(from, to) {
    if(from > to) throw new SoigneurError(`'from' (${from}) is after 'to' (${to}).`);
    if(daysBetween(from, to) > MAX_RANGE_DAYS) throw new SoigneurError(`At most ${MAX_RANGE_DAYS} days at once.`);
}

export { createApi, createSoigneur, SoigneurError, stepsOf, foldRepeats, localDay };
