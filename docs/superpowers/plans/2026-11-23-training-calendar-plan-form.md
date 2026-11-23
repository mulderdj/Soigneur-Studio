# Training Page (3a): Calendar, Plan, Form and Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Training page placeholder into a calendar of rides and planned workouts, fitness/fatigue/form with a 4-week forecast, and four progress cards, built on small per-ride summaries.

**Architecture:** Pure calculation modules in `src/training/` (dates, load, plan, progress, summary, fit-records) with unit tests; `history.js` owns storage (IndexedDB), backfill and account sync; views in `src/views/training/` render from those. The server gets a `plan` table and a summary PATCH. Ride saving writes a summary; app start can auto-select today's planned workout.

**Tech Stack:** Vanilla JS custom elements, Canvas 2D charts (like `live-chart`), IndexedDB via `src/storage/idb.js`, Node built-ins server (`node:sqlite`), Jest 30 + jsdom + fake-indexeddb, node:test, the Playwright visual check.

**Spec:** `docs/superpowers/specs/2026-11-23-training-calendar-plan-form-design.md`

## Global Constraints

- Days are local calendar days as `YYYY-MM-DD` strings; weeks start Monday; all day math goes through `src/training/dates.js` (DST-safe: compute via local-noon `Date`s).
- Fitness (CTL) time constant 42 days, fatigue (ATL) 7 days: `X_d = X_{d−1} + (TSS_d − X_{d−1}) / k`; start at 0 on the first ride's day; form `TSB_d = CTL_{d−1} − ATL_{d−1}`.
- Form labels: TSB > 25 "Very fresh"; 5…25 "Fresh"; −10…5 "Neutral"; −30…−10 "Building"; < −30 "Overreaching" (bounds: `> 25`, `>= 5`, `>= -10`, `>= -30`).
- Forecast: 28 days; days without plan count 0 TSS.
- Planned TSS = Σ over steps of `duration_s × p² / 36`, `p` = step relative power (`step.power`), steps without `power` use `0.65`; step duration falls back to its interval's duration.
- Best-effort windows stored per ride: 5, 60, 300, 1200, 3600 s. "Recent" = the last 42 days including today.
- FTP estimate = max(0.95 × best 1200 s, best 3600 s) over the 42 days ending each week; nudge when |estimate − set FTP| / set FTP > 0.05.
- Weekly volume and zones: 12 periods; zones also per calendar month.
- Summary `version` = 1. TSS/zones use the FTP and weight stored with the ride; backfilled rides with no stored FTP use the rider's current FTP and weight.
- No raw colours or spacing in page CSS (tokens only); charts read colours from tokens (`--zone-1..7`, `--ink`, `--muted`, `--line`, `--accent`, `--good`, `--warn`, `--danger`).
- Don't change: `src/ble/`, `src/ant/`, `src/fit/` (read only), `src/analytics.js` behaviour.
- Every task ends with the test gate: Jest shows exactly the 50 inherited failures, `npm run test:server` passes.

## Review Focus

1. **Rider with no account and more than 7 rides:** the Training page must still show all rides ever saved on this device (summaries are kept even when `.fit` files are trimmed). Pinned in Task 7.
2. **Daylight-saving weeks and late-evening rides:** a ride at 23:30 on the last Sunday of October stays on that Sunday and in that week. Pinned in Task 1.
3. **A `.fit` that can't be read during backfill** (truncated file, a ride without power): backfill carries on; the ride shows with duration only; nothing throws. Pinned in Tasks 5 and 7.
4. **Plan entry whose workout was deleted from the library:** the entry still shows, can still be ridden (auto-select uses the stored copy) and removed. Pinned in Tasks 3 and 10.
5. **Today's planned workout vs. a workout picked by hand:** auto-select never overrides a hand pick made today or a running ride. Pinned in Task 10.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/training/dates.js` | Local-day strings and week math |
| `src/training/load.js` | Daily TSS, CTL/ATL/TSB, forecast, form label |
| `src/training/plan.js` | Planned TSS, plan status, ride matching, auto-select decision |
| `src/training/progress.js` | Weekly volume, week compare, power curve, FTP estimates, zone totals |
| `src/training/summary.js` | Ride summary from per-second samples (via `SessionStats`) |
| `src/training/fit-records.js` | `.fit` bytes → per-second samples |
| `src/training/history.js` | IndexedDB stores, save hook, backfill, plan CRUD, server sync |
| `src/dev/history-seed.js` | Dev-only generated history and plan (`?simulate&history`) |
| `src/views/training/*.js` | Page, form card, week card, calendar, day dialog, progress cards, chart helper |
| `src/css/training.css` | Layout |
| `server/app.js` | `plan` table and routes; summary PATCH |
| tests | `test/training/*.test.js`, `server/app.spec.mjs` additions, visual check additions |

---

### Task 1: Local days

**Files:** Create `src/training/dates.js`, `test/training/dates.test.js`

**Interfaces — Produces:**
- `localDay(ms: number) -> string` (`YYYY-MM-DD` in local time)
- `dayToDate(day: string) -> Date` (local noon of that day)
- `addDays(day: string, n: number) -> string`
- `daysBetween(a: string, b: string) -> number` (b − a, whole days)
- `weekStart(day: string) -> string` (Monday of that week)
- `monthStart(day: string) -> string` (`YYYY-MM-01`)
- `today() -> string`

- [ ] **Step 1: Write the failing tests.** They build times with the local `new Date(y, m, d, h, min)`, so they hold in any time zone; the DST cases only exercise a real clock change when run with `TZ=Europe/Amsterdam`, so Step 4 runs them both ways:

```js
import { localDay, addDays, daysBetween, weekStart, monthStart, dayToDate } from '../../src/training/dates.js';
test('local day of a late-evening time', () => {
    expect(localDay(new Date(2026, 9, 25, 23, 30).getTime())).toBe('2026-10-25');
});
test('days across a DST change are one apart', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
});
test('weeks start on Monday', () => {
    expect(weekStart('2026-11-23')).toBe('2026-11-23'); // Monday
    expect(weekStart('2026-11-29')).toBe('2026-11-23'); // Sunday
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // DST Sunday
});
test('month start and day round trip', () => {
    expect(monthStart('2026-11-23')).toBe('2026-11-01');
    expect(localDay(dayToDate('2026-02-28').getTime())).toBe('2026-02-28');
});
```

- [ ] **Step 2: Run** `TZ=Europe/Amsterdam npx jest test/training/dates.test.js` — expected FAIL (module not found).
- [ ] **Step 3: Implement** (all arithmetic on local-noon `Date`s; `daysBetween` = `Math.round((dayToDate(b) - dayToDate(a)) / 86400000)`).
- [ ] **Step 4: Run** the same command and plain `npx jest test/training/dates.test.js` — expected PASS both.
- [ ] **Step 5: Commit** `git commit -m "training: local day helpers"`

---

### Task 2: Fitness, fatigue, form

**Files:** Create `src/training/load.js`, `test/training/load.test.js`

**Interfaces:**
- Consumes: `addDays`, `daysBetween` (Task 1).
- Produces:
  - `dailyTss(summaries: Summary[]) -> Map<day, number>` (sums `tss ?? 0` by `day`)
  - `pmc(tssByDay: Map, from: day, to: day) -> {day, tss, ctl, atl, tsb}[]` (one row per day inclusive; CTL/ATL start at 0 on `from`)
  - `forecast(last: {ctl, atl}, plannedByDay: Map, fromDay: day, days = 28) -> same row shape` (starts the day after `fromDay`)
  - `formLabel(tsb: number) -> 'Very fresh'|'Fresh'|'Neutral'|'Building'|'Overreaching'`

- [ ] **Step 1: Failing tests**

```js
test('one 100 TSS day', () => {
    const rows = pmc(new Map([['2026-01-01', 100]]), '2026-01-01', '2026-01-02');
    expect(rows[0].atl).toBeCloseTo(100 / 7);
    expect(rows[0].ctl).toBeCloseTo(100 / 42);
    expect(rows[0].tsb).toBe(0);                       // yesterday's values
    expect(rows[1].tsb).toBeCloseTo(100 / 42 - 100 / 7);
});
test('constant load converges', () => {
    const m = new Map(); let d = '2026-01-01';
    for(let i = 0; i < 400; i++) { m.set(d, 100); d = addDays(d, 1); }
    const last = pmc(m, '2026-01-01', addDays('2026-01-01', 399)).at(-1);
    expect(last.ctl).toBeGreaterThan(99); expect(last.atl).toBeCloseTo(100, 3);
});
test('forecast decays without plan and rises with plan', () => {
    const rest = forecast({ctl: 60, atl: 80}, new Map(), '2026-01-10', 28);
    expect(rest).toHaveLength(28); expect(rest[0].day).toBe('2026-01-11');
    expect(rest.at(-1).tsb).toBeGreaterThan(0);
    const busy = forecast({ctl: 60, atl: 80}, new Map([['2026-01-11', 150]]), '2026-01-10', 1);
    expect(busy[0].atl).toBeGreaterThan(80);
});
test.each([[30,'Very fresh'],[25,'Fresh'],[5,'Fresh'],[0,'Neutral'],[-10,'Neutral'],[-11,'Building'],[-30,'Building'],[-31,'Overreaching']])
    ('form %d is %s', (t, l) => expect(formLabel(t)).toBe(l));
test('daily TSS sums rides and ignores rides without power', () => {
    const m = dailyTss([{day:'2026-01-01', tss: 50}, {day:'2026-01-01', tss: 30}, {day:'2026-01-02', tss: null}]);
    expect(m.get('2026-01-01')).toBe(80); expect(m.get('2026-01-02') ?? 0).toBe(0);
});
```

- [ ] **Step 2: Run** `npx jest test/training/load.test.js` — expected FAIL.
- [ ] **Step 3: Implement** per Global Constraints.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `training: fitness, fatigue, form and forecast`

---

### Task 3: Plan calculations

**Files:** Create `src/training/plan.js`, `test/training/plan.test.js`

**Interfaces:**
- Produces:
  - `plannedTss(workout) -> number` (Global Constraints formula over `workout.intervals[].steps[]`)
  - `planStatus(entry, today: day) -> 'done'|'missed'|'planned'`
  - `matchRide(summary, entries) -> entryId|null` (same `day`, not deleted, `rideId` null; prefer `entry.workout.id === summary.workoutId`, else first by array order)
  - `autoSelectWorkout({entries, today, watchStatus, handPickedDay}) -> workout|null` — returns the stored `workout` of the first entry for `today` with status `planned`, unless `watchStatus` is `'started'`/`'paused'` or `handPickedDay === today`.
  - `PlanEntry = {id, day, workout, rideId, updatedAt, deleted}`

- [ ] **Step 1: Failing tests** — include:
  - 1 h at `power: 1.0` → 100; two 30-min steps at 0.5 and 1.0 → 12.5 + 50 = 62.5; a slope-only step of 3600 s → `0.65² × 100` = 42.25; a step without `duration` uses its interval's duration.
  - `planStatus`: rideId set → done; past day unmatched → missed; today unmatched → planned.
  - `matchRide`: prefers same workout id over an earlier entry; skips matched and deleted entries; returns null on a day with no entries.
  - `autoSelectWorkout`: returns today's planned copy even when the workout no longer exists in the library (the copy is used); null while `watchStatus === 'started'`; null when `handPickedDay === today`; null when today's only entry is done.
- [ ] **Step 2: Run** `npx jest test/training/plan.test.js` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `training: planned TSS, plan status and ride matching`

---

### Task 4: Progress calculations

**Files:** Create `src/training/progress.js`, `test/training/progress.test.js`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces (all take `summaries` and `today`):
  - `weeklyVolume(summaries, today, weeks = 12) -> {week, rides, hours, tss, kj}[]` oldest first, ending with the current week
  - `weekCompare(summaries, today) -> {current: {rides, hours, tss, kj}, previous: {…}}` (previous = same weekdays of last week, Monday up to the same weekday)
  - `powerCurve(summaries, today) -> {windows: [5,60,300,1200,3600], recent: {watts: (number|null)[], wkg: (number|null)[]}, allTime: {…}}` (`wkg` from the ride the best came from)
  - `ftpEstimates(summaries, today, weeks = 12) -> {week, ftp: number|null}[]`
  - `zoneTotals(summaries, today, by: 'week'|'month', count = 12) -> {period, seconds: number[7]}[]`

- [ ] **Step 1: Failing tests** over a fixed list of ~8 hand-made summaries spanning 3 weeks and two months, asserting exact numbers: weekly hours/TSS/kJ and ride counts; week compare up to the same weekday; recent vs. all-time bests (an old 400 W 5 s best only in all-time); W/kg uses that ride's weight; FTP estimate takes max(0.95 × 1200 s, 3600 s) and `null` for weeks with no qualifying ride; zone seconds summed per week and per month; rides with `tss: null` count for hours but not TSS.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `training: progress statistics`

---

### Task 5: Ride summaries from samples and from `.fit`

**Files:** Create `src/training/summary.js`, `src/training/fit-records.js`, `test/training/summary.test.js`

**Interfaces:**
- Consumes: `SessionStats`, `BEST_WINDOWS` (`src/analytics.js`); `fit.localActivity.encode`, `FITjs.decode` (`src/fit/`); `localDay` (Task 1).
- Produces:
  - `SUMMARY_VERSION = 1`
  - `rideSummary(samples: {power, heartRate, cadence}[], meta: {id, start, name, workoutId, ftp, weight, distance}) -> Summary` (fields as the spec's table; `best` as `{5, 60, 300, 1200, 3600}` keyed object with `null` when shorter; load fields `null` when no sample has power > 0)
  - `fitToSamples(view: DataView) -> {start: number|null, distance: number|null, samples: {power, heartRate, cadence, speed, distance}[]}` — from decoded records with `type === 'data' && name === 'record'`; one sample per record; `start` from the first record's `timestamp`. Throws nothing: returns `{start: null, samples: []}` when the file can't be read.

- [ ] **Step 1: Failing tests**
  - 3600 samples at 250 W, FTP 250 → `tss` ≈ 100, `if` ≈ 1, `zoneSeconds[4]` (Z5 Threshold at 100 %) = 3600 per `zoneIndex`, `best[3600]` = 250, `day` = `localDay(start)`.
  - 30 samples → `best[60]` null.
  - All-zero power → `tss`, `np`, `if`, `avgPower`, `kj` null; `duration` 3600.
  - Round trip: build `records` like the app does (`{timestamp, power, cadence, heart_rate, speed, distance}` for 120 s), `fit.localActivity.encode({records, laps: [...], events: [...], ftp: 250})` as `models.activity.encode` does, then `fitToSamples` → 120 samples with the same powers and `start` = first timestamp.
  - `fitToSamples(new DataView(new ArrayBuffer(10)))` → `{start: null, samples: []}`.
- [ ] **Step 2: Run** `npx jest test/training/summary.test.js` — FAIL.
- [ ] **Step 3: Implement** (`rideSummary` pushes each sample into a fresh `SessionStats({ftp, weight})` and maps `summary()`; seconds of `zones[i].seconds`; best from `best[]` by `seconds`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `training: ride summaries from samples and .fit`

---

### Task 6: Server — plan sync and summary updates

**Files:** Modify `server/app.js` (schema, queries, routes), `server/app.spec.mjs`

**Interfaces — Produces:**
- Table `plan (user_id, id, data TEXT, deleted INTEGER, updated_at INTEGER, PRIMARY KEY(user_id, id))`.
- `GET /api/me/plan?since=<ms>` → `{entries: [{id, deleted, updatedAt, data|null}], now}`; `PUT /api/me/plan/:id` body `{data}` → `{updatedAt}`; `DELETE /api/me/plan/:id` → `{ok: true}` (soft delete with `updated_at`). Same validation and size limits as workouts.
- `PATCH /api/me/activities/:id/summary` body `{training: {...}}` → merges `training` into the stored summary JSON; 404 for a ride that isn't the caller's.
- `GET /api/me/activities` already returns summaries (now including `training` when present).

- [ ] **Step 1: Failing tests** in `server/app.spec.mjs` (node:test, same helpers as the workout sync test): create two entries, change one, delete one, `since` returns only newer changes incl. the deletion; another user can't see them; PATCH summary on own ride then list shows `training`; PATCH on someone else's ride → 404.
- [ ] **Step 2: Run** `npm run test:server` — expected the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:server` — all PASS.
- [ ] **Step 5: Commit** `server: training plan sync and ride summary updates`

---

### Task 7: History — storage, save hook, backfill, sync

**Files:** Create `src/training/history.js`, `test/training/history.test.js`; Modify `src/db.js` (IndexedDB version 4 with stores `rideSummaries`, `plan`), `src/storage/idb.js` (upgrade from version 3 creates missing stores), `src/models/models.js` (`Activity.createFromCurrent` dispatches `activity:summary` with the live session's samples), `src/account/sync.js` (plan sync; `training` in ride uploads; pull training summaries)

**Interfaces:**
- Consumes: Tasks 1–6; `idb` (`get`, `getAll`, `put`, `remove`); `api` (`src/account/api.js`); `session` (`src/views/training-dashboard.js`).
- Produces (`history.js`):
  - `summaries() -> Promise<Summary[]>` (all, sorted by `start`)
  - `saveSummary(summary) -> Promise<void>` (put; dispatches `training:changed`)
  - `summaryFromSession({id, start, name, workoutId}) -> Summary` (from `session.power/hr/cadence` arrays and its ftp/weight)
  - `backfill(onProgress: ({done, total}) => void) -> Promise<{added: number, skipped: string[]}>`: rides in the `activity` store without a summary of `SUMMARY_VERSION` → `fitToSamples(blob)`; when linked to an account, rides from `GET /me/activities` without `training` and not on the device → `GET /me/activities/:id/fit` → summary → `PATCH .../summary`; rides that can't be read are listed in `skipped`, never thrown.
  - `planEntries() -> Promise<PlanEntry[]>` (not deleted)
  - `addPlanEntry(day, workout)`, `movePlanEntry(id, day)`, `removePlanEntry(id)` (soft delete), `linkRide(entryId, rideId)` — each stamps `updatedAt`, dispatches `training:changed`, and queues a plan push when linked.
  - Event `activity:summary` handler: build the summary, `saveSummary`, then `matchRide` + `linkRide`.
- `sync.js`: `syncPlan()` mirrors `syncWorkouts()` (`since` cursor in rider storage `planSince`); ride uploads include `summary.training`; on sync, training summaries from the server not on the device are saved locally.

- [ ] **Step 1: Failing tests** with `fake-indexeddb` (jsdom): saving a summary survives reopening; 9 saved summaries stay 9 after the `activity` store trims to 7 (Review Focus 1); `backfill` creates summaries for 2 activity records with encoded `.fit` blobs and reports a broken blob in `skipped` while still adding the good one (Review Focus 3); plan add/move/remove round trip; `activity:summary` with a ride on a planned day links the entry.
- [ ] **Step 2: Run** `npx jest test/training/history.test.js` — FAIL.
- [ ] **Step 3: Implement** history.js; idb upgrade (`case 3: createStores(storeNames)` before `latest`); version 4 in `db.js`; the save-path dispatch.
- [ ] **Step 4: Run** the history tests — PASS; run `npm run test:server` — PASS.
- [ ] **Step 5: Manual check** on the dev server: ride 1 min with `?simulate`, stop, save → IndexedDB shows a `rideSummaries` entry (DevTools or a Playwright read).
- [ ] **Step 6: Commit** `training: ride summary storage, backfill and plan sync`

---

### Task 8: Dev history generator

**Files:** Create `src/dev/history-seed.js`, `test/training/history-seed.test.js`; Modify `src/index.js` (`?simulate&history` loads it on the dev server only, like `?simulate`)

**Interfaces — Produces:** `generateHistory({today, days = 120, ftp = 250, weight = 75, seed = 1}) -> {summaries: Summary[], plan: PlanEntry[]}` — deterministic for a seed: 4–6 rides a week (endurance, sweet spot, VO2 days), a gradually rising FTP, one rest week every fourth week, and plan entries for the next 21 days plus a few past (some matched, some missed). `seedHistory()` writes them through `history.js` once per rider (skips if summaries exist).

- [ ] **Step 1: Failing test**: same seed → identical output; 120 days produce 60–90 rides; every summary passes a shape check (fields of the spec table, `version` 1); plan has future and past entries with at least one `done` and one `missed` relative to `today`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `dev: generated training history for the Training page`

---

### Task 9: Training page views

**Files:** Create `src/views/training/{chart.js,training-page.js,form-card.js,week-card.js,calendar.js,day-dialog.js,progress-cards.js}`, `test/training/views.test.js`; Modify `src/index.html` (Training page content: `<training-page>`), `src/views/views.js` (import), `src/css/training.css`, `test/visual/check.js` (Training uses `?simulate&history`; add a `training-day` pseudo-page that opens today's day dialog)

**Interfaces:**
- Consumes: Tasks 1–4, 7; components (`.card`, `.card__title`, `.segmented`, `.btn`, `.dialog`, `.list-row`, `.badge`, `.empty`).
- Produces:
  - `<training-page>` builds the cards, runs `backfill` once on first show (progress text inside the page), re-renders on `training:changed` and `db:ftp`.
  - `chart.js`: `drawBars(ctx, {width, height, series, stacked, colors})`, `drawLines(ctx, {width, height, lines, dashedFrom})` with token colours via `getComputedStyle`; canvases resize with `ResizeObserver` and redraw on theme change.
  - `<form-card>`: CTL/ATL/TSB numbers, `formLabel`, 90-day + 28-day forecast chart.
  - `<week-card>`: `weekCompare`.
  - `<training-calendar>`: week list (< 600 px) / month grid (≥ 600 px), ‹ › and Today; day cells show rides (name, duration, TSS) and plan entries with `planStatus` badge; click/Enter opens `<day-dialog>`.
  - `<day-dialog>`: rides of the day; plan entries with Move (date input) and Remove; "Plan a workout": search field + library list (`db.workouts`), selecting adds an entry.
  - `<progress-cards>`: weekly volume (segmented hours/TSS/kJ), power curve (segmented W/W·kg), FTP trend with nudge button (dispatches `ui:ftp-set` like Settings), time in zones (segmented week/month).
  - Empty state when there are no summaries.

- [ ] **Step 1: Failing jsdom tests** for the non-canvas logic: the calendar renders 7 rows for a week on a 390 px layout and a 6×7 grid at 1200 px for a given month (use `layoutFor` input via attribute `layout`); a day with a done entry shows "done" and "planned 62 / actual 70 TSS"; the day dialog's search filters the library list; adding from the dialog calls `addPlanEntry` with that day; the FTP nudge appears only beyond 5 %.
- [ ] **Step 2: Run** `npx jest test/training/views.test.js` — FAIL.
- [ ] **Step 3: Implement** views and `training.css` (layout per the spec: phone column; ≥ 600 px grid with calendar full width and progress 2 per row; ≥ 1200 px form card and week card side by side above the calendar).
- [ ] **Step 4: Run** the view tests — PASS.
- [ ] **Step 5: Visual check** (`npm start` running): `npm run check:visual -- --pages training,training-day` — expected PASS at all sizes and themes; read the phone and desktop screenshots.
- [ ] **Step 6: Commit** `ui: Training page — form, calendar, plan and progress`

---

### Task 10: Riding the plan

**Files:** Modify `src/db.js` (on `app:start` after workouts restore, and on a day-change timer, apply `autoSelectWorkout`; record `handPickedDay` in rider storage when the rider selects a workout in the library), `test/training/plan.test.js` (already covers the decision), `test/training/ride-plan.test.js`

**Interfaces:**
- Consumes: `autoSelectWorkout` (Task 3), `planEntries`, `linkRide` (Task 7).
- Produces: on start or day change, when the decision returns a workout, `db.workout` is set to that copy and `ui:workout:select`'s effects run (Ride page shows it); a hand pick stores `handPickedDay = today()` under `riders.key('training:handPicked')`.

- [ ] **Step 1: Failing test** (`ride-plan.test.js`, jsdom + fake-indexeddb): with a plan entry for today and no hand pick, starting the app selects its workout; with `training:handPicked` = today it doesn't; a plan entry whose workout id is not in the library still gets selected (stored copy) (Review Focus 4, 5).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: End-to-end check** (Playwright script, dev server, `?simulate&history`): today's planned workout is selected on the Ride page; ride 20 s, stop, save → Training calendar shows today's entry as done with actual TSS.
- [ ] **Step 6: Commit** `training: select today's planned workout and match rides to the plan`

---

### Task 11: Final verification

- [ ] **Step 1:** `npx jest` (50 inherited failures only), `npm run test:server`, `npm run build`, `npm run check:visual` (all pages incl. Training) — all pass.
- [ ] **Step 2:** README: a short "Training page" section (what it shows, backfill, plan, `?simulate&history`).
- [ ] **Step 3:** Ask the user to look at the Training screenshots in `test/visual/out/`.
- [ ] **Step 4: Commit** `docs: Training page`
